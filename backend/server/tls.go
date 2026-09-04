package server

import (
	"crypto/tls"
	"errors"
	"net/http"
	"os"
	"strings"

	"golang.org/x/crypto/acme/autocert"
)

// tlsSettings describes how (and whether) the server terminates HTTPS.
//
// Two modes, picked from the environment:
//
//	TLS_CERT_FILE + TLS_KEY_FILE  serve the given certificate (bought, from
//	                              certbot, or self-signed for a LAN)
//	TLS_DOMAINS                   comma-separated hostnames: obtain and renew
//	                              a Let's Encrypt certificate automatically
//	                              (ACME). Requires ports 80 and 443 reachable
//	                              from the internet. TLS_EMAIL (optional) gets
//	                              expiry notices; TLS_CACHE_DIR (default
//	                              /app/certs) must persist across restarts.
//	HTTPS_PORT                    port for HTTPS (default 443)
//
// When TLS is on, the plain PORT listener only answers ACME challenges and
// redirects everything else to https://. With neither variable set the server
// speaks plain HTTP exactly as before (typical when a reverse proxy or CDN
// terminates TLS in front of it).
type tlsSettings struct {
	certFile  string
	keyFile   string
	domains   []string
	cacheDir  string
	email     string
	httpsPort string
}

func tlsSettingsFromEnv() tlsSettings {
	s := tlsSettings{
		certFile:  strings.TrimSpace(os.Getenv("TLS_CERT_FILE")),
		keyFile:   strings.TrimSpace(os.Getenv("TLS_KEY_FILE")),
		cacheDir:  strings.TrimSpace(os.Getenv("TLS_CACHE_DIR")),
		email:     strings.TrimSpace(os.Getenv("TLS_EMAIL")),
		httpsPort: strings.TrimSpace(os.Getenv("HTTPS_PORT")),
	}
	for _, d := range strings.Split(os.Getenv("TLS_DOMAINS"), ",") {
		if d = strings.ToLower(strings.TrimSpace(d)); d != "" {
			s.domains = append(s.domains, d)
		}
	}
	if s.cacheDir == "" {
		s.cacheDir = "/app/certs"
	}
	if s.httpsPort == "" {
		s.httpsPort = "443"
	}
	return s
}

func (s tlsSettings) enabled() bool {
	return s.certFile != "" || s.keyFile != "" || len(s.domains) > 0
}

// build returns the TLS configuration and, in ACME mode, the handler that must
// serve the plain-HTTP port so http-01 challenges can be answered (it also
// redirects every other request to https). In certificate-file mode the
// returned handler only redirects.
func (s tlsSettings) build() (*tls.Config, http.Handler, error) {
	redirect := http.HandlerFunc(redirectToHTTPS)

	switch {
	case s.certFile != "" || s.keyFile != "":
		if s.certFile == "" || s.keyFile == "" {
			return nil, nil, errors.New("TLS_CERT_FILE and TLS_KEY_FILE must both be set")
		}
		cert, err := tls.LoadX509KeyPair(s.certFile, s.keyFile)
		if err != nil {
			return nil, nil, err
		}
		return hardenTLS(&tls.Config{Certificates: []tls.Certificate{cert}}), redirect, nil

	case len(s.domains) > 0:
		if err := os.MkdirAll(s.cacheDir, 0o700); err != nil {
			return nil, nil, err
		}
		m := &autocert.Manager{
			Prompt:     autocert.AcceptTOS,
			HostPolicy: autocert.HostWhitelist(s.domains...),
			Cache:      autocert.DirCache(s.cacheDir),
			Email:      s.email,
		}
		cfg := m.TLSConfig()
		return hardenTLS(cfg), m.HTTPHandler(redirect), nil
	}
	return nil, nil, errors.New("tls not configured")
}

// hardenTLS applies the protocol floor and ALPN list to a TLS config without
// disturbing the certificate source (static or ACME callback).
func hardenTLS(cfg *tls.Config) *tls.Config {
	cfg.MinVersion = tls.VersionTLS12
	cfg.CurvePreferences = []tls.CurveID{tls.X25519, tls.CurveP256}
	// Keep http/1.1 first: gorilla/websocket needs HTTP/1.1 for the upgrade.
	cfg.NextProtos = append([]string{"http/1.1", "h2"}, cfg.NextProtos...)
	return cfg
}

// redirectToHTTPS sends a permanent redirect to the same URL over https.
func redirectToHTTPS(w http.ResponseWriter, r *http.Request) {
	host := r.Host
	if h, _, err := splitHostPort(host); err == nil {
		host = h
	}
	target := "https://" + host + r.URL.RequestURI()
	w.Header().Set("Connection", "close")
	http.Redirect(w, r, target, http.StatusMovedPermanently)
}

// splitHostPort is net.SplitHostPort tolerant of a bare host (no port).
func splitHostPort(hostport string) (host, port string, err error) {
	i := strings.LastIndex(hostport, ":")
	if i < 0 || strings.Contains(hostport[i:], "]") {
		return hostport, "", errors.New("no port")
	}
	return strings.TrimSuffix(strings.TrimPrefix(hostport[:i], "["), "]"), hostport[i+1:], nil
}
