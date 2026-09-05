package server

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

// Voice chat needs a STUN/TURN server so browsers behind NAT can reach each
// other (STUN) or fall back to a relay (TURN). Both come from the bundled
// coturn service (docker-compose `coturn`), which runs with
// `--use-auth-secret`: instead of a user database it shares one secret with
// this server, and this server mints short-lived credentials per client
// (the "TURN REST API" scheme coturn implements):
//
//	username   = "<unix expiry>:<account uuid>"
//	credential = base64(HMAC-SHA1(secret, username))
//
// Credentials are handed out over the socket (get-ice-servers → ice-servers)
// to logged-in clients only, so the relay cannot be used anonymously.

const (
	defaultTurnPort = 3478
	defaultTurnTTL  = 24 * time.Hour
)

// turnSettings is the TURN_* environment configuration.
type turnSettings struct {
	// host is the public hostname or IP of the coturn server (TURN_HOST). When
	// empty the host the page was loaded from is used, which is right whenever
	// coturn runs next to the game server (the compose default).
	host string
	// port is the coturn listening port (TURN_PORT, default 3478).
	port int
	// secret is coturn's --static-auth-secret (TURN_SECRET). Empty disables
	// TURN: clients only get a STUN URL.
	secret string
	// ttl is how long minted credentials stay valid (TURN_TTL_HOURS, 24).
	ttl time.Duration
}

func turnSettingsFromEnv() turnSettings {
	s := turnSettings{
		host:   strings.TrimSpace(os.Getenv("TURN_HOST")),
		port:   envInt("TURN_PORT", defaultTurnPort),
		secret: os.Getenv("TURN_SECRET"),
		ttl:    time.Duration(envInt("TURN_TTL_HOURS", int(defaultTurnTTL/time.Hour))) * time.Hour,
	}
	if s.port <= 0 || s.port > 65535 {
		s.port = defaultTurnPort
	}
	if s.ttl <= 0 {
		s.ttl = defaultTurnTTL
	}
	return s
}

// iceServer mirrors the browser's RTCIceServer dictionary.
type iceServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// configured reports whether a STUN/TURN server exists at all: either its
// address (TURN_HOST) or its shared secret (TURN_SECRET, the bundled coturn on
// the page host) is set. When neither is, no coturn is running and clients
// get an empty list — they then connect directly, which works on a LAN, rather
// than waiting on a dead STUN address.
func (s turnSettings) configured() bool {
	return s.host != "" || s.secret != ""
}

// iceServersFor builds the ICE server list for one account: a STUN URL, plus
// TURN URLs with fresh credentials when a secret is configured. pageHost is
// the host the client loaded the page from, used when TURN_HOST is unset. It
// returns nil when no STUN/TURN server is configured or no host can be
// determined.
func (s turnSettings) iceServersFor(account string, pageHost string, now time.Time) []iceServer {
	if !s.configured() {
		return nil
	}
	host := s.host
	if host == "" {
		host = pageHost
	}
	if host == "" {
		return nil
	}
	port := s.port
	if port == 0 {
		port = defaultTurnPort
	}
	hostPort := net.JoinHostPort(host, strconv.Itoa(port))

	servers := []iceServer{{URLs: []string{"stun:" + hostPort}}}
	if s.secret == "" {
		return servers
	}

	ttl := s.ttl
	if ttl <= 0 {
		ttl = defaultTurnTTL
	}
	username := fmt.Sprintf("%d:%s", now.Add(ttl).Unix(), account)
	servers = append(servers, iceServer{
		URLs: []string{
			"turn:" + hostPort + "?transport=udp",
			"turn:" + hostPort + "?transport=tcp",
		},
		Username:   username,
		Credential: turnCredential(s.secret, username),
	})
	return servers
}

// turnCredential computes coturn's REST-API password for a username.
func turnCredential(secret string, username string) string {
	mac := hmac.New(sha1.New, []byte(secret))
	mac.Write([]byte(username))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// validPageHost accepts a bare hostname or IP literal as reported by the
// browser (window.location.hostname); anything that could smuggle a scheme,
// port, path or userinfo into the URL is rejected.
func validPageHost(host string) bool {
	if host == "" || len(host) > 253 {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return true
	}
	for _, r := range host {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '.':
		default:
			return false
		}
	}
	return true
}

// handleGetIceServers answers a logged-in client with the STUN/TURN servers
// (and TURN credentials) it should use for voice chat.
func handleGetIceServers(c *Client, pageHost string) {
	if c.accountUUID == "" {
		c.send <- createError("not logged in")
		return
	}
	if !validPageHost(pageHost) {
		pageHost = ""
	}
	var settings turnSettings
	if c.hub != nil {
		settings = c.hub.turn
	}
	servers := settings.iceServersFor(c.accountUUID, pageHost, time.Now())
	ttl := settings.ttl
	if ttl <= 0 {
		ttl = defaultTurnTTL
	}
	c.send <- createIceServers(servers, ttl)
}

func createIceServers(servers []iceServer, ttl time.Duration) []byte {
	if servers == nil {
		servers = []iceServer{}
	}
	resp := iceServers{
		base{actionIceServers},
		servers,
		int(ttl / time.Second),
	}
	bytes, err := json.Marshal(resp)
	if err != nil {
		slog.Default().Warn("Marshal ice servers", "error", err)
	}
	return bytes
}
