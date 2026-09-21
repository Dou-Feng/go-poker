package server

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Tests for the LiveKit access-token minting (livekit.go) that replaced the
// former coturn STUN/TURN credential handout and the voice-signal relay. No
// LiveKit server is needed: tokens are plain HS256 JWTs, verified here by
// re-parsing them with the same secret the server signed with.

var testLiveKit = livekitSettings{
	url:       "wss://voice.example.com",
	apiKey:    "testkey",
	apiSecret: "testsecret-testsecret-testsecret-testsecret",
	ttl:       2 * time.Hour,
}

// verifyToken parses, signature- and issuer-checks a minted token and returns
// its claims as a map.
func verifyToken(t *testing.T, token string) jwt.MapClaims {
	t.Helper()
	claims := jwt.MapClaims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (interface{}, error) {
		return []byte(testLiveKit.apiSecret), nil
	},
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithIssuer(testLiveKit.apiKey),
		jwt.WithExpirationRequired(),
	)
	if err != nil || !parsed.Valid {
		t.Fatalf("verify token: %v", err)
	}
	return claims
}

// A minted token admits exactly one account (by subject, identity and display
// name) to exactly one prefixed room, may publish audio from the microphone
// only, and expires after the configured lifetime.
func TestLiveKitTokenGrant(t *testing.T) {
	// Callers pass the already-prefixed room (handleGetLiveKitToken applies
	// liveKitRoomName); mintToken itself never rewrites the name.
	token, err := testLiveKit.mintToken("acc-a", "alice", liveKitRoomName("friday-night"))
	if err != nil {
		t.Fatalf("mint token: %v", err)
	}
	claims := verifyToken(t, token)
	if claims["sub"] != "acc-a" || claims["identity"] != "acc-a" {
		t.Fatalf("identity = %v / %v, want acc-a", claims["sub"], claims["identity"])
	}
	if claims["name"] != "alice" {
		t.Fatalf("name = %v, want alice", claims["name"])
	}

	video, ok := claims["video"].(map[string]interface{})
	if !ok {
		t.Fatalf("no video grant: %v", claims["video"])
	}
	if video["roomJoin"] != true || video["room"] != liveKitRoomName("friday-night") {
		t.Fatalf("grant = %v, want roomJoin on %q", video, liveKitRoomName("friday-night"))
	}
	if video["canPublish"] != true {
		t.Fatalf("canPublish must be granted: %v", video["canPublish"])
	}
	if video["canSubscribe"] != true {
		t.Fatalf("canSubscribe must be granted: %v", video["canSubscribe"])
	}
	// Explicitly false, not omitted: data channels stay closed.
	if video["canPublishData"] != false {
		t.Fatalf("canPublishData must be explicitly false: %v", video["canPublishData"])
	}
	sources, _ := video["canPublishSources"].([]interface{})
	if len(sources) != 1 || sources[0] != "microphone" {
		t.Fatalf("publish sources = %v, want microphone only", video["canPublishSources"])
	}

	// Expiry matches the configured lifetime (±2s for the mint call itself).
	exp, err := claims.GetExpirationTime()
	if err != nil || exp == nil {
		t.Fatalf("token must carry exp: %v", err)
	}
	want := time.Now().Add(testLiveKit.ttl).Unix()
	if d := exp.Unix() - want; d < -2 || d > 2 {
		t.Fatalf("exp = %d, want ~%d", exp.Unix(), want)
	}
}

// The token a client receives names the room as the LiveKit server address
// configured server-side, and stays valid for the configured lifetime.
func TestHandleGetLiveKitToken(t *testing.T) {
	tbl, _ := newTestTable(t)
	hub := newSessionHub(tbl)
	hub.livekit = testLiveKit
	c := newTestClient(hub, "acc-a")
	c.username = "alice"
	c.table = tbl

	handleGetLiveKitToken(c)

	var msg liveKitToken
	select {
	case raw := <-c.send:
		if err := json.Unmarshal(raw, &msg); err != nil {
			t.Fatalf("decode livekit token: %v", err)
		}
	default:
		t.Fatalf("expected a queued token reply")
	}
	if !msg.OK || msg.URL != testLiveKit.url {
		t.Fatalf("reply = %+v, want ok with url %q", msg, testLiveKit.url)
	}
	if msg.TTL != int(testLiveKit.ttl/time.Second) {
		t.Fatalf("ttl = %d, want %d", msg.TTL, int(testLiveKit.ttl/time.Second))
	}
	claims := verifyToken(t, msg.Token)
	video, _ := claims["video"].(map[string]interface{})
	if claims["sub"] != "acc-a" || video["room"] != liveKitRoomName(tbl.name) {
		t.Fatalf("token identity/room = %v / %v", claims["sub"], video["room"])
	}
}

// Without API credentials the handler answers ok:false (not an error) so the
// client can explain that voice is unavailable; the same applies to a client
// that somehow has no table.
func TestHandleGetLiveKitTokenUnconfigured(t *testing.T) {
	t.Run("no-credentials", func(t *testing.T) {
		tbl, _ := newTestTable(t)
		hub := newSessionHub(tbl) // zero livekitSettings: not configured
		c := newTestClient(hub, "acc-a")
		c.table = tbl
		handleGetLiveKitToken(c)
		var msg liveKitToken
		select {
		case raw := <-c.send:
			if err := json.Unmarshal(raw, &msg); err != nil {
				t.Fatalf("decode reply: %v", err)
			}
		default:
			t.Fatalf("expected a queued reply")
		}
		if msg.OK || msg.Token != "" {
			t.Fatalf("reply = %+v, want ok:false without a token", msg)
		}
	})

	t.Run("no-table", func(t *testing.T) {
		tbl, _ := newTestTable(t)
		hub := newSessionHub(tbl)
		hub.livekit = testLiveKit
		c := newTestClient(hub, "acc-a") // no table attached
		handleGetLiveKitToken(c)
		var msg liveKitToken
		select {
		case raw := <-c.send:
			if err := json.Unmarshal(raw, &msg); err != nil {
				t.Fatalf("decode reply: %v", err)
			}
		default:
			t.Fatalf("expected a queued reply")
		}
		if msg.OK || msg.Token != "" {
			t.Fatalf("reply = %+v, want ok:false without a token", msg)
		}
	})
}

// A token minted with one secret must not verify with another: the signature
// really binds the credentials.
func TestLiveKitTokenRejectsWrongSecret(t *testing.T) {
	token, err := testLiveKit.mintToken("acc-a", "alice", "room")
	if err != nil {
		t.Fatalf("mint token: %v", err)
	}
	parsed, err := jwt.ParseWithClaims(token, jwt.MapClaims{}, func(*jwt.Token) (interface{}, error) {
		return []byte("other-secret"), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err == nil || parsed.Valid {
		t.Fatalf("token must not verify with a different secret")
	}
}
