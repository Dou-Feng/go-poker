package server

import (
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// In-room voice chat runs on LiveKit (https://livekit.io), a self-hostable
// WebRTC SFU: every browser sends and receives audio through one LiveKit
// server instead of opening a mesh of direct peer connections. All WebRTC
// signalling, NAT traversal and (optional) TURN relaying live inside
// livekit-server, so the game server no longer relays SDP/ICE at all — it
// only mints the short-lived access tokens that admit a player to the
// LiveKit room matching their poker room:
//
//   - identity = account UUID, the same stable id the rest of the protocol
//     keys peers by. LiveKit admits one connection per identity, which
//     matches the game's one-live-connection-per-account rule (session.go).
//   - room = "gopoker-<tablename>", so a shared LiveKit deployment cannot
//     mix poker rooms or collide with other apps.
//   - publish/subscribe audio only (no data channels, no video).
//
// Configuration is env-driven (LIVEKIT_URL / LIVEKIT_API_KEY /
// LIVEKIT_API_SECRET; see .env.example). Without a key pair the handler
// answers ok:false and clients explain that voice is unavailable instead of
// failing to connect.

const (
	defaultLiveKitTokenTTL = 6 * time.Hour
	// liveKitRoomPrefix namespaces poker rooms on a shared LiveKit server.
	liveKitRoomPrefix = "gopoker-"
)

// livekitSettings is the LIVEKIT_* environment configuration.
type livekitSettings struct {
	// url is the WebSocket address browsers use to reach the LiveKit server
	// (LIVEKIT_URL), e.g. ws://livekit:7880 or wss://voice.example.com. It is
	// handed to clients verbatim: the game server never talks to LiveKit
	// itself, so this must be reachable from the browser, not from inside
	// the docker network. Clients may instead bake an address at build time
	// with NEXT_PUBLIC_LIVEKIT_URL, which then takes precedence.
	url string
	// apiKey / apiSecret are the LiveKit project credentials
	// (LIVEKIT_API_KEY / LIVEKIT_API_SECRET) used to sign access tokens.
	apiKey    string
	apiSecret string
	// ttl is how long minted tokens stay valid (LIVEKIT_TOKEN_TTL_HOURS, 6).
	ttl time.Duration
}

func livekitSettingsFromEnv() livekitSettings {
	s := livekitSettings{
		url:       strings.TrimSpace(os.Getenv("LIVEKIT_URL")),
		apiKey:    strings.TrimSpace(os.Getenv("LIVEKIT_API_KEY")),
		apiSecret: strings.TrimSpace(os.Getenv("LIVEKIT_API_SECRET")),
		ttl: time.Duration(
			envInt("LIVEKIT_TOKEN_TTL_HOURS", int(defaultLiveKitTokenTTL/time.Hour)),
		) * time.Hour,
	}
	if s.ttl <= 0 {
		s.ttl = defaultLiveKitTokenTTL
	}
	return s
}

// configured reports whether tokens can be minted at all: both halves of the
// API key pair must be set. When they are not, the token handler answers
// ok:false and clients keep voice chat off.
func (s livekitSettings) configured() bool {
	return s.apiKey != "" && s.apiSecret != ""
}

// liveKitRoomName maps a poker room name to its LiveKit room.
func liveKitRoomName(tablename string) string {
	return liveKitRoomPrefix + tablename
}

// liveKitVideoGrant mirrors the LiveKit protocol's VideoGrant JSON for the
// subset this game grants (field names are LiveKit's stable token contract,
// implemented by every official server SDK). Pointer booleans keep "explicitly
// false" (canPublishData) distinct from "unset".
type liveKitVideoGrant struct {
	RoomJoin          bool     `json:"roomJoin,omitempty"`
	Room              string   `json:"room,omitempty"`
	CanPublish        *bool    `json:"canPublish,omitempty"`
	CanSubscribe      *bool    `json:"canSubscribe,omitempty"`
	CanPublishData    *bool    `json:"canPublishData,omitempty"`
	CanPublishSources []string `json:"canPublishSources,omitempty"`
}

// liveKitClaims is the full access-token payload: the LiveKit grant block
// ("video") plus the registered claims livekit-server validates (iss = API
// key, sub = identity, exp required).
type liveKitClaims struct {
	Name     string             `json:"name,omitempty"`
	Identity string             `json:"identity,omitempty"`
	Video    *liveKitVideoGrant `json:"video,omitempty"`
	jwt.RegisteredClaims
}

// The microphone source name in CanPublishSources. LiveKit's TrackSource
// enum serializes to this string; publishing any other source (camera,
// screen share) is rejected by the token.
const liveKitSourceMicrophone = "microphone"

// mintToken signs one player's access token for one room. Publishing is
// limited to the microphone (an audio-only game voice chat: no screen shares
// or camera); data channels stay closed — the game socket already carries
// everything else.
//
// The token is a plain HS256 JWT, minted here with golang-jwt instead of the
// official livekit/protocol module: that module drags in protobuf, psrpc and
// friends (~70 packages) for what is, on our side, ~40 lines of claims
// (backend/server/livekit_equiv_test.go verified field-for-field equivalence
// before the dependency was dropped).
func (s livekitSettings) mintToken(identity, name, room string) (string, error) {
	canPublish, canSubscribe := true, true
	noData := false
	claims := liveKitClaims{
		Name:     name,
		Identity: identity,
		Video: &liveKitVideoGrant{
			RoomJoin:          true,
			Room:              room,
			CanPublish:        &canPublish,
			CanSubscribe:      &canSubscribe,
			CanPublishData:    &noData,
			CanPublishSources: []string{liveKitSourceMicrophone},
		},
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.apiKey,
			Subject:   identity,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(s.ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).
		SignedString([]byte(s.apiSecret))
}

// handleGetLiveKitToken answers a logged-in client attached to a room with a
// fresh LiveKit access token for that room's voice session. Unconfigured
// servers (or unexpected state) answer ok:false rather than an error, so the
// voice UI can degrade gracefully.
func handleGetLiveKitToken(c *Client) {
	if c.accountUUID == "" {
		c.send <- createError("not logged in")
		return
	}
	var settings livekitSettings
	if c.hub != nil {
		settings = c.hub.livekit
	}
	if !settings.configured() || c.table == nil {
		c.send <- createLiveKitToken("", "", 0)
		return
	}
	token, err := settings.mintToken(c.accountUUID, c.username, liveKitRoomName(c.table.name))
	if err != nil {
		slog.Default().Warn("Mint LiveKit token", "error", err)
		c.send <- createLiveKitToken("", "", 0)
		return
	}
	c.send <- createLiveKitToken(settings.url, token, settings.ttl)
}

func createLiveKitToken(url, token string, ttl time.Duration) []byte {
	resp := liveKitToken{
		base:  base{actionLiveKitToken},
		OK:    token != "",
		URL:   url,
		Token: token,
		TTL:   int(ttl / time.Second),
	}
	bytes, err := json.Marshal(resp)
	if err != nil {
		slog.Default().Warn("Marshal livekit token", "error", err)
	}
	return bytes
}
