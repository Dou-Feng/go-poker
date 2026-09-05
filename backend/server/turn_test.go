package server

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Tests for the TURN credential minting (turn.go) that pairs with the coturn
// service in docker-compose (`--use-auth-secret`).

// A configured secret yields a STUN entry plus a TURN entry whose credential
// is the REST-API HMAC of "<expiry>:<account>" with expiry = now + ttl.
func TestIceServersMintTurnCredentials(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	s := turnSettings{host: "turn.example.com", port: 3478, secret: "s3cret", ttl: 6 * time.Hour}

	servers := s.iceServersFor("acc-a", "ignored.example.org", now)
	if len(servers) != 2 {
		t.Fatalf("want stun + turn, got %+v", servers)
	}
	if servers[0].URLs[0] != "stun:turn.example.com:3478" || servers[0].Username != "" {
		t.Fatalf("unexpected stun entry: %+v", servers[0])
	}

	turn := servers[1]
	wantURLs := []string{
		"turn:turn.example.com:3478?transport=udp",
		"turn:turn.example.com:3478?transport=tcp",
	}
	if strings.Join(turn.URLs, ",") != strings.Join(wantURLs, ",") {
		t.Fatalf("unexpected turn urls: %v", turn.URLs)
	}

	parts := strings.SplitN(turn.Username, ":", 2)
	if len(parts) != 2 || parts[1] != "acc-a" {
		t.Fatalf("username must be <expiry>:<account>, got %q", turn.Username)
	}
	expiry, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || expiry != now.Add(6*time.Hour).Unix() {
		t.Fatalf("expiry must be now+ttl, got %q", parts[0])
	}

	// Independent computation of coturn's expected password.
	mac := hmac.New(sha1.New, []byte("s3cret"))
	mac.Write([]byte(turn.Username))
	if want := base64.StdEncoding.EncodeToString(mac.Sum(nil)); turn.Credential != want {
		t.Fatalf("credential mismatch: got %q want %q", turn.Credential, want)
	}
}

// Without a secret only STUN is offered, so the relay can never be used with
// guessed credentials.
func TestIceServersStunOnlyWithoutSecret(t *testing.T) {
	s := turnSettings{host: "poker.example.com"}
	servers := s.iceServersFor("acc-a", "", time.Now())
	if len(servers) != 1 || servers[0].URLs[0] != "stun:poker.example.com:3478" {
		t.Fatalf("want a single default-port stun entry, got %+v", servers)
	}
}

// With neither TURN_HOST nor TURN_SECRET no coturn is running: the list is
// empty (never a dead STUN URL on the page host that browsers would wait on),
// so peers connect directly, which is what works on a LAN.
func TestIceServersEmptyWhenNotConfigured(t *testing.T) {
	var s turnSettings
	if s.configured() {
		t.Fatalf("zero settings must not count as configured")
	}
	if got := s.iceServersFor("acc-a", "lan-box", time.Now()); got != nil {
		t.Fatalf("unconfigured must yield nil, got %+v", got)
	}
	if !(turnSettings{host: "h"}).configured() || !(turnSettings{secret: "k"}).configured() {
		t.Fatalf("either host or secret alone configures STUN/TURN")
	}
}

// TURN_HOST unset falls back to the host the page was loaded from (coturn runs
// next to the game server); TURN_HOST set always wins; no host at all yields
// nothing rather than a broken URL. IPv6 hosts are bracketed.
func TestIceServersHostResolution(t *testing.T) {
	now := time.Now()
	if got := (turnSettings{secret: "x"}).iceServersFor("a", "lan-box", now); got[0].URLs[0] != "stun:lan-box:3478" {
		t.Fatalf("page host fallback: %+v", got)
	}
	if got := (turnSettings{host: "fixed", secret: "x"}).iceServersFor("a", "lan-box", now); got[0].URLs[0] != "stun:fixed:3478" {
		t.Fatalf("TURN_HOST must win: %+v", got)
	}
	if got := (turnSettings{secret: "x"}).iceServersFor("a", "", now); got != nil {
		t.Fatalf("no host must yield nil, got %+v", got)
	}
	if got := (turnSettings{port: 5000, secret: "x"}).iceServersFor("a", "fd00::1", now); got[0].URLs[0] != "stun:[fd00::1]:5000" {
		t.Fatalf("ipv6/custom port: %+v", got)
	}
}

// Two different accounts never share a credential, and the same account gets
// a new one once the clock moves (the expiry is part of the username).
func TestIceServersCredentialsAreDistinct(t *testing.T) {
	s := turnSettings{host: "h", secret: "k", ttl: time.Hour}
	now := time.Now()
	a := s.iceServersFor("acc-a", "", now)[1]
	b := s.iceServersFor("acc-b", "", now)[1]
	later := s.iceServersFor("acc-a", "", now.Add(time.Minute))[1]
	if a.Credential == b.Credential || a.Username == b.Username {
		t.Fatalf("accounts must not share credentials")
	}
	if a.Credential == later.Credential {
		t.Fatalf("credential must rotate with the expiry")
	}
}

// Environment parsing: defaults when unset, values when set, and sane
// fallbacks for nonsense.
func TestTurnSettingsFromEnv(t *testing.T) {
	for _, k := range []string{"TURN_HOST", "TURN_PORT", "TURN_SECRET", "TURN_TTL_HOURS"} {
		t.Setenv(k, "")
	}
	def := turnSettingsFromEnv()
	if def.host != "" || def.port != 3478 || def.secret != "" || def.ttl != 24*time.Hour {
		t.Fatalf("unexpected defaults: %+v", def)
	}

	t.Setenv("TURN_HOST", " turn.example.com ")
	t.Setenv("TURN_PORT", "3479")
	t.Setenv("TURN_SECRET", "abc")
	t.Setenv("TURN_TTL_HOURS", "2")
	got := turnSettingsFromEnv()
	if got.host != "turn.example.com" || got.port != 3479 || got.secret != "abc" || got.ttl != 2*time.Hour {
		t.Fatalf("unexpected parsed settings: %+v", got)
	}

	t.Setenv("TURN_PORT", "70000")
	t.Setenv("TURN_TTL_HOURS", "-5")
	bad := turnSettingsFromEnv()
	if bad.port != 3478 || bad.ttl != 24*time.Hour {
		t.Fatalf("out-of-range values must fall back to defaults: %+v", bad)
	}
}

// The browser-reported page host is only trusted as a bare hostname or IP.
func TestValidPageHost(t *testing.T) {
	ok := []string{"localhost", "poker.example.com", "192.168.1.10", "fd00::1", "my-host"}
	bad := []string{"", "host:3478", "host/path", "user@host", "http://host", "host?x=1", "a b", strings.Repeat("a", 254)}
	for _, h := range ok {
		if !validPageHost(h) {
			t.Fatalf("%q should be accepted", h)
		}
	}
	for _, h := range bad {
		if validPageHost(h) {
			t.Fatalf("%q should be rejected", h)
		}
	}
}

// The socket handler: anonymous connections get an error, logged-in clients
// get the server list with the credential TTL, and a malformed page host is
// ignored instead of being reflected into the URLs.
func TestHandleGetIceServers(t *testing.T) {
	hub := newSessionHub()
	hub.turn = turnSettings{secret: "k", ttl: 2 * time.Hour}

	anon := newTestClient(hub, "")
	handleGetIceServers(anon, "lan-box")
	var errMsg errorMessage
	if err := json.Unmarshal(<-anon.send, &errMsg); err != nil || errMsg.Action != actionError {
		t.Fatalf("anonymous client must get an error, got %+v (%v)", errMsg, err)
	}

	c := newTestClient(hub, "acc-a")
	handleGetIceServers(c, "lan-box")
	var reply iceServers
	if err := json.Unmarshal(<-c.send, &reply); err != nil {
		t.Fatalf("decode reply: %v", err)
	}
	if reply.Action != actionIceServers || reply.TTL != 7200 {
		t.Fatalf("unexpected envelope: %+v", reply)
	}
	if len(reply.Servers) != 2 || reply.Servers[1].URLs[0] != "turn:lan-box:3478?transport=udp" {
		t.Fatalf("expected stun+turn on the page host, got %+v", reply.Servers)
	}
	if !strings.HasSuffix(reply.Servers[1].Username, ":acc-a") {
		t.Fatalf("credential must be bound to the account: %q", reply.Servers[1].Username)
	}

	// A hostile page host is dropped; with no TURN_HOST either, the list is
	// empty (never a URL built from the bad value).
	handleGetIceServers(c, "evil.example/steal?")
	if err := json.Unmarshal(<-c.send, &reply); err != nil {
		t.Fatalf("decode reply: %v", err)
	}
	if len(reply.Servers) != 0 {
		t.Fatalf("bad page host must not be reflected, got %+v", reply.Servers)
	}

	// No coturn configured at all (the compose "voice" profile is off): the
	// reply is a well-formed empty list, not an error.
	hub.turn = turnSettings{}
	handleGetIceServers(c, "lan-box")
	if err := json.Unmarshal(<-c.send, &reply); err != nil {
		t.Fatalf("decode reply: %v", err)
	}
	if reply.Action != actionIceServers || len(reply.Servers) != 0 || reply.TTL <= 0 {
		t.Fatalf("unconfigured hub must answer with an empty list, got %+v", reply)
	}
}
