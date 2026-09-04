package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// newTestGuard returns a guard with a controllable clock.
func newTestGuard(cfg guardConfig) (*guard, func(d time.Duration)) {
	g := newGuard(cfg)
	now := time.Unix(1_700_000_000, 0)
	g.nowFunc = func() time.Time { return now }
	return g, func(d time.Duration) { now = now.Add(d) }
}

func TestTokenBucketRefillsAtRate(t *testing.T) {
	now := time.Unix(0, 0)
	b := newBucket(2, 4, now) // 2 tokens/s, burst 4

	for i := 0; i < 4; i++ {
		if !b.allow(now) {
			t.Fatalf("burst token %d should be allowed", i)
		}
	}
	if b.allow(now) {
		t.Fatalf("5th immediate request must be refused")
	}
	// Half a second later one token has been refilled.
	now = now.Add(500 * time.Millisecond)
	if !b.allow(now) {
		t.Fatalf("one token should have refilled after 500ms")
	}
	if b.allow(now) {
		t.Fatalf("only one token should have refilled")
	}
	// Refill never exceeds the burst.
	now = now.Add(time.Hour)
	for i := 0; i < 4; i++ {
		if !b.allow(now) {
			t.Fatalf("token %d after long idle should be allowed", i)
		}
	}
	if b.allow(now) {
		t.Fatalf("bucket must be capped at burst")
	}
}

func TestTokenBucketZeroRateDisablesLimit(t *testing.T) {
	b := newBucket(0, 0, time.Unix(0, 0))
	for i := 0; i < 1000; i++ {
		if !b.allow(time.Unix(0, 0)) {
			t.Fatalf("zero rate must always allow")
		}
	}
}

func TestHTTPLimitReturns429PerIP(t *testing.T) {
	g, advance := newTestGuard(guardConfig{httpRPS: 1}) // burst 2
	h := g.httpLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	do := func(ip string) int {
		req := httptest.NewRequest(http.MethodGet, "/ping", nil)
		req.RemoteAddr = ip + ":12345"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	if do("10.0.0.1") != 200 || do("10.0.0.1") != 200 {
		t.Fatalf("burst of 2 should pass")
	}
	if code := do("10.0.0.1"); code != http.StatusTooManyRequests {
		t.Fatalf("3rd request should be 429, got %d", code)
	}
	// Another IP is unaffected.
	if do("10.0.0.2") != 200 {
		t.Fatalf("a different IP must have its own bucket")
	}
	// The limited IP recovers after a second.
	advance(time.Second)
	if do("10.0.0.1") != 200 {
		t.Fatalf("IP should recover after refill")
	}
}

func TestClientIPIgnoresProxyHeadersUnlessTrusted(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.0.2.10:5555"
	req.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.1")
	req.Header.Set("X-Real-IP", "203.0.113.8")

	untrusted := newGuard(guardConfig{})
	if ip := untrusted.clientIP(req); ip != "192.0.2.10" {
		t.Fatalf("without TRUST_PROXY the socket peer must win, got %s", ip)
	}

	trusted := newGuard(guardConfig{trustProxy: true})
	if ip := trusted.clientIP(req); ip != "203.0.113.7" {
		t.Fatalf("with TRUST_PROXY the first X-Forwarded-For entry must win, got %s", ip)
	}

	// Garbage in the header falls through to X-Real-IP, then to the peer.
	req.Header.Set("X-Forwarded-For", "not-an-ip")
	if ip := trusted.clientIP(req); ip != "203.0.113.8" {
		t.Fatalf("invalid XFF should fall back to X-Real-IP, got %s", ip)
	}
	req.Header.Del("X-Real-IP")
	if ip := trusted.clientIP(req); ip != "192.0.2.10" {
		t.Fatalf("invalid headers should fall back to the peer, got %s", ip)
	}

	// IPv6 peers are normalised too.
	req.RemoteAddr = "[2001:db8::1]:443"
	if ip := untrusted.clientIP(req); ip != "2001:db8::1" {
		t.Fatalf("ipv6 peer should be extracted, got %s", ip)
	}
}

func TestConnectionCapsPerIPAndGlobal(t *testing.T) {
	g, _ := newTestGuard(guardConfig{maxConnsPerIP: 2, maxConns: 3})

	r1, ok := g.admitConn("10.0.0.1")
	if !ok {
		t.Fatalf("first conn should be admitted")
	}
	if _, ok := g.admitConn("10.0.0.1"); !ok {
		t.Fatalf("second conn from same IP should be admitted")
	}
	if _, ok := g.admitConn("10.0.0.1"); ok {
		t.Fatalf("third conn from same IP must be refused (per-IP cap 2)")
	}
	// A different IP still fits under the global cap of 3...
	if _, ok := g.admitConn("10.0.0.2"); !ok {
		t.Fatalf("other IP should be admitted while under the global cap")
	}
	// ...but the global cap is now full for everyone.
	if _, ok := g.admitConn("10.0.0.3"); ok {
		t.Fatalf("global cap of 3 must refuse a 4th connection")
	}

	// Releasing a slot frees capacity; releasing twice is harmless.
	r1()
	r1()
	if _, ok := g.admitConn("10.0.0.3"); !ok {
		t.Fatalf("released slot should be reusable")
	}
	if g.conns != 3 {
		t.Fatalf("live connection count should be 3, got %d", g.conns)
	}
}

func TestAuthLimiterThrottlesLoginAttempts(t *testing.T) {
	g, advance := newTestGuard(guardConfig{authPerMin: 3})

	for i := 0; i < 3; i++ {
		if !g.allowAuth("10.0.0.1") {
			t.Fatalf("attempt %d should be allowed", i)
		}
	}
	if g.allowAuth("10.0.0.1") {
		t.Fatalf("4th attempt inside a minute must be refused")
	}
	// Other IPs are independent.
	if !g.allowAuth("10.0.0.9") {
		t.Fatalf("another IP should not be throttled")
	}
	// One more attempt is earned every 20s at 3/min.
	advance(20 * time.Second)
	if !g.allowAuth("10.0.0.1") {
		t.Fatalf("one attempt should have refilled after 20s")
	}
	if g.allowAuth("10.0.0.1") {
		t.Fatalf("only one attempt should have refilled")
	}
}

func TestAllowOrigin(t *testing.T) {
	req := func(origin string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/ws", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		return r
	}

	open := newGuard(guardConfig{})
	if !open.allowOrigin(req("https://evil.example")) {
		t.Fatalf("with no allow-list every origin is accepted")
	}

	strict := newGuard(guardConfig{allowedOrigins: []string{"https://poker.example.com", "http://localhost:8080"}})
	if !strict.allowOrigin(req("https://poker.example.com")) {
		t.Fatalf("listed origin should be accepted")
	}
	if !strict.allowOrigin(req("HTTPS://Poker.Example.com/")) {
		t.Fatalf("origin match should ignore case and a trailing slash")
	}
	if !strict.allowOrigin(req("http://localhost:8080")) {
		t.Fatalf("second listed origin should be accepted")
	}
	if strict.allowOrigin(req("https://evil.example")) {
		t.Fatalf("unlisted origin must be refused")
	}
	if !strict.allowOrigin(req("")) {
		t.Fatalf("a missing Origin (non-browser client) is accepted")
	}
}

func TestGuardConfigFromEnvDefaultsAndOverrides(t *testing.T) {
	for _, k := range []string{"TRUST_PROXY", "RATE_HTTP_RPS", "RATE_WS_MSGS", "RATE_AUTH_PER_MIN",
		"MAX_CONNS_PER_IP", "MAX_CONNS", "MAX_TABLES", "ALLOWED_ORIGINS"} {
		t.Setenv(k, "")
	}
	def := guardConfigFromEnv()
	if def.trustProxy || def.httpRPS != 30 || def.wsMsgsPerSec != 20 || def.authPerMin != 10 ||
		def.maxConnsPerIP != 10 || def.maxConns != 2000 || def.maxTables != 200 || len(def.allowedOrigins) != 0 {
		t.Fatalf("unexpected defaults: %+v", def)
	}

	t.Setenv("TRUST_PROXY", "true")
	t.Setenv("RATE_HTTP_RPS", "5")
	t.Setenv("MAX_CONNS_PER_IP", "3")
	t.Setenv("MAX_TABLES", "notanumber") // invalid → default
	t.Setenv("ALLOWED_ORIGINS", " https://A.example/ ,, http://b.example ")
	cfg := guardConfigFromEnv()
	if !cfg.trustProxy || cfg.httpRPS != 5 || cfg.maxConnsPerIP != 3 || cfg.maxTables != 200 {
		t.Fatalf("overrides not applied: %+v", cfg)
	}
	if len(cfg.allowedOrigins) != 2 || cfg.allowedOrigins[0] != "https://a.example" || cfg.allowedOrigins[1] != "http://b.example" {
		t.Fatalf("origins should be trimmed, lower-cased and de-slashed: %v", cfg.allowedOrigins)
	}
}

func TestIdleIPStateIsCollected(t *testing.T) {
	g, advance := newTestGuard(guardConfig{httpRPS: 10})
	g.allowHTTP("10.0.0.1")
	release, _ := g.admitConn("10.0.0.2") // holds a connection: must survive
	if len(g.ips) != 2 {
		t.Fatalf("expected 2 tracked IPs, got %d", len(g.ips))
	}
	advance(ipStateTTL + 2*time.Minute)
	g.allowHTTP("10.0.0.3") // triggers gc
	if _, ok := g.ips["10.0.0.1"]; ok {
		t.Fatalf("idle IP without connections should be dropped")
	}
	if _, ok := g.ips["10.0.0.2"]; !ok {
		t.Fatalf("IP holding a live connection must be kept")
	}
	release()
}

// The room cap stops a client from creating rooms without bound; existing
// rooms can still be joined once the cap is hit.
func TestCreateTableRespectsMaxTables(t *testing.T) {
	// Two live rooms already exist (built without running them: a running
	// table needs Redis). The cap is 2.
	r1 := newTable("r1", nil, nil)
	r2 := newTable("r2", nil, nil)
	hub := &Hub{tables: map[*table]bool{r1: true, r2: true}, guard: newGuard(guardConfig{maxTables: 2})}

	if _, _, err := hub.createTableIfAbsent("r3", ""); err != errTooManyTables {
		t.Fatalf("r3 should hit the cap, got err=%v", err)
	}
	// Re-joining an existing room is not creation and still works at the cap.
	if tbl, created, err := hub.createTableIfAbsent("r1", ""); err != nil || created || tbl != r1 {
		t.Fatalf("existing room should be returned: created=%v err=%v", created, err)
	}

	// Below the cap creation is allowed; without a guard or with a cap of 0
	// there is no limit at all.
	if (&Hub{tables: map[*table]bool{r1: true}, guard: newGuard(guardConfig{maxTables: 2})}).tableCapReached() {
		t.Fatalf("1 of 2 rooms should not be capped")
	}
	if (&Hub{tables: map[*table]bool{r1: true, r2: true}}).tableCapReached() {
		t.Fatalf("no guard → no cap")
	}
	if (&Hub{tables: map[*table]bool{r1: true, r2: true}, guard: newGuard(guardConfig{maxTables: 0})}).tableCapReached() {
		t.Fatalf("MAX_TABLES=0 → no cap")
	}
}
