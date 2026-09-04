package server

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTLSSettingsFromEnv(t *testing.T) {
	for _, k := range []string{"TLS_CERT_FILE", "TLS_KEY_FILE", "TLS_DOMAINS", "TLS_CACHE_DIR", "TLS_EMAIL", "HTTPS_PORT"} {
		t.Setenv(k, "")
	}
	off := tlsSettingsFromEnv()
	if off.enabled() {
		t.Fatalf("no TLS variables → disabled")
	}
	if off.httpsPort != "443" || off.cacheDir != "/app/certs" {
		t.Fatalf("defaults wrong: %+v", off)
	}

	t.Setenv("TLS_DOMAINS", " Poker.Example.com, ,api.example.com ")
	t.Setenv("HTTPS_PORT", "8443")
	t.Setenv("TLS_CACHE_DIR", "/data/certs")
	acme := tlsSettingsFromEnv()
	if !acme.enabled() {
		t.Fatalf("TLS_DOMAINS should enable TLS")
	}
	if len(acme.domains) != 2 || acme.domains[0] != "poker.example.com" || acme.domains[1] != "api.example.com" {
		t.Fatalf("domains should be trimmed and lower-cased: %v", acme.domains)
	}
	if acme.httpsPort != "8443" || acme.cacheDir != "/data/certs" {
		t.Fatalf("overrides not applied: %+v", acme)
	}
}

func TestTLSBuildRequiresBothCertAndKey(t *testing.T) {
	if _, _, err := (tlsSettings{certFile: "/x/cert.pem"}).build(); err == nil {
		t.Fatalf("cert without key must fail")
	}
	if _, _, err := (tlsSettings{keyFile: "/x/key.pem"}).build(); err == nil {
		t.Fatalf("key without cert must fail")
	}
	if _, _, err := (tlsSettings{}).build(); err == nil {
		t.Fatalf("nothing configured must fail")
	}
}

// writeSelfSigned writes a throwaway certificate/key pair for the test.
func writeSelfSigned(t *testing.T, dir string) (certFile, keyFile string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		DNSNames:     []string{"localhost"},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	certFile = filepath.Join(dir, "cert.pem")
	keyFile = filepath.Join(dir, "key.pem")
	if err := os.WriteFile(certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		t.Fatal(err)
	}
	return certFile, keyFile
}

// Certificate-file mode: the config loads the pair, enforces TLS 1.2+, keeps
// http/1.1 first for the WebSocket upgrade, and a real TLS handshake works.
func TestTLSBuildFromCertFilesServesHTTPS(t *testing.T) {
	certFile, keyFile := writeSelfSigned(t, t.TempDir())
	cfg, plain, err := (tlsSettings{certFile: certFile, keyFile: keyFile}).build()
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if cfg.MinVersion != tls.VersionTLS12 {
		t.Fatalf("min version should be TLS 1.2, got %x", cfg.MinVersion)
	}
	if len(cfg.NextProtos) == 0 || cfg.NextProtos[0] != "http/1.1" {
		t.Fatalf("http/1.1 must be the first ALPN protocol, got %v", cfg.NextProtos)
	}
	if plain == nil {
		t.Fatalf("plain-port handler (redirect) must be returned")
	}

	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	srv.TLS = cfg
	srv.StartTLS()
	defer srv.Close()

	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	resp, err := client.Get(srv.URL + "/ping")
	if err != nil {
		t.Fatalf("https request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.TLS == nil {
		t.Fatalf("expected a 200 over TLS, got %d tls=%v", resp.StatusCode, resp.TLS != nil)
	}
}

// ACME mode: the plain handler must answer the challenge path itself and
// redirect everything else; the certificate cache directory is created.
func TestTLSBuildACMEHandlerRedirectsAndCreatesCache(t *testing.T) {
	cache := filepath.Join(t.TempDir(), "certs")
	cfg, plain, err := (tlsSettings{domains: []string{"poker.example.com"}, cacheDir: cache}).build()
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if cfg.GetCertificate == nil {
		t.Fatalf("ACME mode must supply certificates dynamically")
	}
	if st, err := os.Stat(cache); err != nil || !st.IsDir() {
		t.Fatalf("cache dir should be created: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://poker.example.com:8080/lobby?x=1", nil)
	rec := httptest.NewRecorder()
	plain.ServeHTTP(rec, req)
	if rec.Code != http.StatusMovedPermanently {
		t.Fatalf("non-challenge request should redirect, got %d", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "https://poker.example.com/lobby?x=1" {
		t.Fatalf("redirect should drop the port and keep the path/query, got %s", loc)
	}

	// The ACME challenge path is handled locally (404 for an unknown token,
	// never a redirect).
	req = httptest.NewRequest(http.MethodGet, "http://poker.example.com/.well-known/acme-challenge/abc", nil)
	rec = httptest.NewRecorder()
	plain.ServeHTTP(rec, req)
	if rec.Code == http.StatusMovedPermanently {
		t.Fatalf("ACME challenge path must not be redirected")
	}
}

func TestRedirectToHTTPSHandlesIPv6Host(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Host = "[2001:db8::1]:8080"
	rec := httptest.NewRecorder()
	redirectToHTTPS(rec, req)
	if loc := rec.Header().Get("Location"); loc != "https://2001:db8::1/" {
		t.Fatalf("unexpected location %s", loc)
	}
}

func TestSecurityHeaders(t *testing.T) {
	h := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("hardening headers missing: %v", rec.Header())
	}
	if rec.Header().Get("Strict-Transport-Security") != "" {
		t.Fatalf("HSTS must not be sent over plain HTTP")
	}

	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.TLS = &tls.ConnectionState{}
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Strict-Transport-Security") == "" {
		t.Fatalf("HSTS should be sent over TLS")
	}
}
