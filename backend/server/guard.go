package server

import (
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// guard holds the application-level abuse protections: per-IP request and
// message rate limits, per-IP and global WebSocket connection caps, a login
// attempt limiter and a WebSocket origin allow-list. All of it is in-memory
// and per process; it is the layer above the kernel/firewall protections
// described in deploy/HARDENING.md (SYN cookies, conntrack limits, ...).
//
// Every knob is read from the environment with a safe default, so a plain
// deployment is protected without any configuration:
//
//	TRUST_PROXY        "true" to take the client IP from X-Forwarded-For /
//	                   X-Real-IP (only when the server sits behind a reverse
//	                   proxy you control; otherwise clients can spoof it)
//	RATE_HTTP_RPS      HTTP requests per second per IP (default 30, burst 2×)
//	RATE_WS_MSGS       WebSocket messages per second per connection (default 20, burst 2×)
//	RATE_AUTH_PER_MIN  login/register attempts per minute per IP (default 10)
//	MAX_CONNS_PER_IP   concurrent WebSocket connections per IP (default 10)
//	MAX_CONNS          concurrent WebSocket connections in total (default 2000)
//	MAX_TABLES         live rooms (default 200)
//	ALLOWED_ORIGINS    comma-separated list of allowed WebSocket Origin values
//	                   (default empty = any origin, which the hot dev setup needs)
type guard struct {
	cfg guardConfig

	mu      sync.Mutex
	ips     map[string]*ipState
	conns   int // total live WebSocket connections
	lastGC  time.Time
	nowFunc func() time.Time
}

type guardConfig struct {
	trustProxy     bool
	httpRPS        float64
	wsMsgsPerSec   float64
	authPerMin     float64
	maxConnsPerIP  int
	maxConns       int
	maxTables      int
	allowedOrigins []string
}

type ipState struct {
	http     tokenBucket
	auth     tokenBucket
	conns    int
	lastSeen time.Time
}

// idle IP entries are dropped after this long so the map cannot grow without
// bound under a wide address-spoofing flood.
const ipStateTTL = 10 * time.Minute

func guardConfigFromEnv() guardConfig {
	cfg := guardConfig{
		trustProxy:    envBool("TRUST_PROXY", false),
		httpRPS:       envFloat("RATE_HTTP_RPS", 30),
		wsMsgsPerSec:  envFloat("RATE_WS_MSGS", 20),
		authPerMin:    envFloat("RATE_AUTH_PER_MIN", 10),
		maxConnsPerIP: envInt("MAX_CONNS_PER_IP", 10),
		maxConns:      envInt("MAX_CONNS", 2000),
		maxTables:     envInt("MAX_TABLES", 200),
	}
	if raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS")); raw != "" {
		for _, o := range strings.Split(raw, ",") {
			if o = strings.TrimRight(strings.TrimSpace(o), "/"); o != "" {
				cfg.allowedOrigins = append(cfg.allowedOrigins, strings.ToLower(o))
			}
		}
	}
	return cfg
}

func newGuard(cfg guardConfig) *guard {
	return &guard{
		cfg:     cfg,
		ips:     make(map[string]*ipState),
		nowFunc: time.Now,
	}
}

// tokenBucket is a minimal token-bucket limiter: `rate` tokens are added per
// second up to `burst`; each allowed event consumes one token. A zero rate
// disables the limit (always allow).
type tokenBucket struct {
	tokens float64
	last   time.Time
	rate   float64
	burst  float64
}

func newBucket(rate, burst float64, now time.Time) tokenBucket {
	return tokenBucket{tokens: burst, last: now, rate: rate, burst: burst}
}

func (b *tokenBucket) allow(now time.Time) bool {
	if b.rate <= 0 {
		return true
	}
	if elapsed := now.Sub(b.last).Seconds(); elapsed > 0 {
		b.tokens += elapsed * b.rate
		if b.tokens > b.burst {
			b.tokens = b.burst
		}
		b.last = now
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// state returns the bookkeeping entry for an IP, creating it on first sight.
// The caller must hold g.mu.
func (g *guard) state(ip string, now time.Time) *ipState {
	g.gc(now)
	st, ok := g.ips[ip]
	if !ok {
		st = &ipState{
			http: newBucket(g.cfg.httpRPS, 2*g.cfg.httpRPS, now),
			auth: newBucket(g.cfg.authPerMin/60, g.cfg.authPerMin, now),
		}
		g.ips[ip] = st
	}
	st.lastSeen = now
	return st
}

// gc drops idle IP entries that hold no connection. Runs at most once a
// minute. The caller must hold g.mu.
func (g *guard) gc(now time.Time) {
	if now.Sub(g.lastGC) < time.Minute {
		return
	}
	g.lastGC = now
	for ip, st := range g.ips {
		if st.conns == 0 && now.Sub(st.lastSeen) > ipStateTTL {
			delete(g.ips, ip)
		}
	}
}

// allowHTTP reports whether an HTTP request from ip is within its rate.
func (g *guard) allowHTTP(ip string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.nowFunc()
	return g.state(ip, now).http.allow(now)
}

// allowAuth reports whether ip may make another login/register attempt.
func (g *guard) allowAuth(ip string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.nowFunc()
	return g.state(ip, now).auth.allow(now)
}

// admitConn reserves a WebSocket connection slot for ip. It returns false when
// the per-IP or global cap is reached; otherwise the returned release func
// must be called exactly once when the connection ends.
func (g *guard) admitConn(ip string) (release func(), ok bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.nowFunc()
	st := g.state(ip, now)
	if g.cfg.maxConns > 0 && g.conns >= g.cfg.maxConns {
		return nil, false
	}
	if g.cfg.maxConnsPerIP > 0 && st.conns >= g.cfg.maxConnsPerIP {
		return nil, false
	}
	st.conns++
	g.conns++
	var once sync.Once
	return func() {
		once.Do(func() {
			g.mu.Lock()
			defer g.mu.Unlock()
			st.conns--
			g.conns--
			st.lastSeen = g.nowFunc()
		})
	}, true
}

// newMessageBucket returns the per-connection WebSocket message limiter.
func (g *guard) newMessageBucket() tokenBucket {
	return newBucket(g.cfg.wsMsgsPerSec, 2*g.cfg.wsMsgsPerSec, g.nowFunc())
}

// allowOrigin implements the WebSocket Origin check. With no allow-list every
// origin is accepted (browsers always send Origin; non-browser clients may
// omit it, which is accepted too since they are not subject to CSRF).
func (g *guard) allowOrigin(r *http.Request) bool {
	if len(g.cfg.allowedOrigins) == 0 {
		return true
	}
	origin := strings.ToLower(strings.TrimRight(r.Header.Get("Origin"), "/"))
	if origin == "" {
		return true
	}
	for _, allowed := range g.cfg.allowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

// clientIP extracts the peer address. Proxy headers are only honoured when
// TRUST_PROXY is set, because anyone can send them otherwise.
func (g *guard) clientIP(r *http.Request) string {
	if g.cfg.trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			// The first entry is the original client; later ones are proxies.
			first := strings.TrimSpace(strings.Split(xff, ",")[0])
			if ip := net.ParseIP(first); ip != nil {
				return ip.String()
			}
		}
		if xr := strings.TrimSpace(r.Header.Get("X-Real-IP")); xr != "" {
			if ip := net.ParseIP(xr); ip != nil {
				return ip.String()
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	return host
}

// httpLimit is the chi middleware applying the per-IP request rate limit.
// WebSocket upgrades pass through here once (the handshake) and are then
// governed by the connection caps and the per-connection message bucket.
func (g *guard) httpLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !g.allowHTTP(g.clientIP(r)) {
			w.Header().Set("Retry-After", "1")
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func envBool(key string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "":
		return def
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func envInt(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func envFloat(key string, def float64) float64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return def
	}
	return f
}
