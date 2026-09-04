package server

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// bootServer starts the real router (TLS on when settings say so) on
// ephemeral loopback ports with a Redis-less hub carrying the given guard.
// It returns the https (or http) base URL for the app and the plain
// listener's base URL.
func bootServer(t *testing.T, cfg guardConfig, settings tlsSettings) (appURL, plainURL string) {
	t.Helper()
	hub := &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		tables:     make(map[*table]bool),
		users:      make(map[string]bool),
		guard:      newGuard(cfg),
	}
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s, err := newServer(hub, ln, settings)
	if err != nil {
		t.Fatalf("newServer: %v", err)
	}
	if err := s.Run(); err != nil {
		t.Fatalf("run: %v", err)
	}
	t.Cleanup(func() {
		s.server.Close()
		if s.redirect != nil {
			s.redirect.Close()
		}
	})
	plainURL = "http://" + ln.Addr().String()
	if s.tlsListener != nil {
		return "https://" + s.tlsListener.Addr().String(), plainURL
	}
	return plainURL, plainURL
}

func insecureClient() *http.Client {
	return &http.Client{
		Transport:     &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Timeout:       5 * time.Second,
	}
}

// End to end: with certificate files configured the app answers over TLS with
// HSTS, the plain port redirects to https, and the per-IP HTTP limiter
// returns 429 after the burst.
func TestServerServesHTTPSRedirectsAndRateLimits(t *testing.T) {
	certFile, keyFile := writeSelfSigned(t, t.TempDir())
	appURL, plainURL := bootServer(t,
		guardConfig{httpRPS: 2, maxConnsPerIP: 10, maxConns: 100},
		tlsSettings{certFile: certFile, keyFile: keyFile, httpsPort: "0"})
	if !strings.HasPrefix(appURL, "https://") {
		t.Fatalf("app should be served over https, got %s", appURL)
	}
	c := insecureClient()

	resp, err := c.Get(appURL + "/ping")
	if err != nil {
		t.Fatalf("https ping: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.TLS == nil || resp.TLS.Version < tls.VersionTLS12 {
		t.Fatalf("expected 200 over TLS>=1.2, got %d tls=%v", resp.StatusCode, resp.TLS)
	}
	if resp.Header.Get("Strict-Transport-Security") == "" {
		t.Fatalf("HSTS header missing on https response")
	}

	resp, err = c.Get(plainURL + "/lobby?x=1")
	if err != nil {
		t.Fatalf("plain request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusMovedPermanently {
		t.Fatalf("plain port should redirect, got %d", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); loc != "https://127.0.0.1/lobby?x=1" {
		t.Fatalf("unexpected redirect target %s", loc)
	}

	// Burst is 2×rps = 4. The https ping and the plain-port redirect above
	// both came from this IP and share one bucket (the redirect endpoint is
	// rate limited too), so two tokens are left: the 3rd request here must
	// be refused.
	codes := []int{}
	for i := 0; i < 4; i++ {
		resp, err := c.Get(appURL + "/ping")
		if err != nil {
			t.Fatalf("ping %d: %v", i, err)
		}
		resp.Body.Close()
		codes = append(codes, resp.StatusCode)
	}
	if fmt.Sprint(codes) != "[200 200 429 429]" {
		t.Fatalf("expected the limiter to kick in on the 3rd request, got %v", codes)
	}
}

// End to end over WebSocket: the per-IP connection cap refuses the handshake
// of the extra socket, and a connection that floods messages is closed with a
// policy-violation close code while a well-behaved one stays open.
func TestServerWebSocketCapsAndMessageFlood(t *testing.T) {
	appURL, _ := bootServer(t,
		guardConfig{httpRPS: 1000, maxConnsPerIP: 2, maxConns: 100, wsMsgsPerSec: 1},
		tlsSettings{})
	wsURL := "ws" + strings.TrimPrefix(appURL, "http") + "/ws"
	dialer := websocket.Dialer{HandshakeTimeout: 3 * time.Second}

	c1, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial 1: %v", err)
	}
	defer c1.Close()
	c2, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial 2: %v", err)
	}
	defer c2.Close()

	// Third socket from the same IP is refused before the upgrade.
	_, resp, err := dialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatalf("third connection should be refused by the per-IP cap")
	}
	if resp == nil || resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("expected a 429 handshake response, got %v", resp)
	}

	// Flood c1: 1 msg/s with burst 2 → the 3rd message trips the limiter and
	// the server closes with 1008.
	for i := 0; i < 3; i++ {
		if err := c1.WriteMessage(websocket.TextMessage, []byte(`{"action":"ping"}`)); err != nil {
			t.Fatalf("write %d: %v", i, err)
		}
	}
	c1.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		_, _, err := c1.ReadMessage()
		if err == nil {
			continue // pong replies before the close
		}
		var ce *websocket.CloseError
		if !asCloseError(err, &ce) || ce.Code != websocket.ClosePolicyViolation {
			t.Fatalf("expected close 1008 after flooding, got %v", err)
		}
		break
	}

	// Once c1 is gone its slot is released: a new connection is admitted.
	deadline := time.Now().Add(3 * time.Second)
	for {
		c3, _, err := dialer.Dial(wsURL, nil)
		if err == nil {
			c3.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("slot should be released after the flooded socket closed: %v", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func asCloseError(err error, target **websocket.CloseError) bool {
	ce, ok := err.(*websocket.CloseError)
	if ok {
		*target = ce
	}
	return ok
}
