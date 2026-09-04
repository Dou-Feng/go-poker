package server

import (
	"crypto/tls"
	"encoding/json"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

const (
	staticDir = "/app/out"

	// Server-side timeouts. They bound how long a slow or idle client may
	// hold a connection (slowloris-style exhaustion) without affecting
	// WebSockets: gorilla clears the deadlines when it hijacks the socket
	// and the read/write pumps apply their own.
	readHeaderTimeout = 10 * time.Second
	readTimeout       = 30 * time.Second
	writeTimeout      = 60 * time.Second // avatar downloads on slow links
	idleTimeout       = 120 * time.Second
	maxHeaderBytes    = 16 << 10
)

type Server struct {
	listener net.Listener
	server   *http.Server
	router   *chi.Mux
	hub      *Hub

	// When TLS is enabled the plain listener/server only answer ACME
	// challenges and redirect to https; the app is served from tlsListener.
	tlsListener net.Listener
	redirect    *http.Server
}

func New() (*Server, error) {
	registerExtensions()

	ln, err := net.Listen("tcp4", ":"+getPort())
	if err != nil {
		return nil, err
	}

	hub, err := newHub()
	if err != nil {
		ln.Close()
		return nil, err
	}

	return newServer(hub, ln, tlsSettingsFromEnv())
}

// newServer wires the router onto an already-bound plain listener. It is
// split from New so tests can boot the real stack on ephemeral ports with a
// hand-built hub (no Redis).
func newServer(hub *Hub, ln net.Listener, settings tlsSettings) (*Server, error) {
	s := &Server{
		listener: ln,
		server:   newHTTPServer(ln.Addr().String()),
		router:   chi.NewRouter(),
		hub:      hub,
	}

	s.server.Handler = s.router
	s.mountMiddleware()
	s.mountSocket()
	s.mountStatus()
	s.mountAvatar()
	s.mountStatic()

	if settings.enabled() {
		if err := s.enableTLS(settings); err != nil {
			ln.Close()
			return nil, err
		}
	}

	return s, nil
}

// newHTTPServer returns an http.Server with the hardening timeouts applied.
func newHTTPServer(addr string) *http.Server {
	return &http.Server{
		Addr:              addr,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
		MaxHeaderBytes:    maxHeaderBytes,
	}
}

// enableTLS moves the application onto an HTTPS listener and turns the plain
// PORT listener into an ACME/redirect endpoint.
func (s *Server) enableTLS(settings tlsSettings) error {
	cfg, plainHandler, err := settings.build()
	if err != nil {
		return err
	}
	tlsAddr := ":" + settings.httpsPort
	raw, err := net.Listen("tcp4", tlsAddr)
	if err != nil {
		return err
	}
	s.tlsListener = tls.NewListener(raw, cfg)
	s.server.Addr = tlsAddr
	s.server.TLSConfig = cfg

	s.redirect = newHTTPServer(s.listener.Addr().String())
	s.redirect.Handler = s.hub.guard.httpLimit(plainHandler)
	slog.Default().Info("TLS enabled", "https", tlsAddr, "domains", settings.domains, "certFile", settings.certFile)
	return nil
}

func (s *Server) mountAvatar() {
	s.router.Route("/api/avatar", func(r chi.Router) {
		r.Post("/", s.uploadAvatar)
		r.Get("/", s.getAvatar)
	})
}

func (s *Server) Run() error {
	go s.hub.run()
	slog.Default().Info("running websocket hub")
	if s.tlsListener != nil {
		go s.server.Serve(s.tlsListener)
		go s.redirect.Serve(s.listener)
		slog.Default().Info("starting https server", "addr", s.server.Addr, "redirectFrom", s.listener.Addr().String())
		return nil
	}
	go s.server.Serve(s.listener)
	slog.Default().Info("starting http server")
	return nil
}

func getPort() string {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
		slog.Default().Info("No port env variable, using default", "port", port)
	}
	return port
}

func (s *Server) mountMiddleware() {
	s.router.Use(middleware.Logger)
	s.router.Use(middleware.Recoverer)
	// Per-IP request rate limit (429) before any routing or CORS work.
	s.router.Use(s.hub.guard.httpLimit)
	s.router.Use(securityHeaders)
	s.router.Use(cors.Handler(cors.Options{
		// The frontend may be served from any origin: production (same
		// origin, no CORS needed) and hot dev (localhost:8080 talking to
		// the backend on :3000). chi/cors only treats a bare "*" as a
		// wildcard — patterns like "http://*" never match.
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Requested-With"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: false,
		MaxAge:           500,
	}))
}

// securityHeaders sets the usual browser hardening headers. HSTS is only sent
// on TLS connections (browsers ignore it over plain HTTP anyway).
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		if r.TLS != nil {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) mountStatus() {
	s.router.Route("/ping", func(r chi.Router) { r.Get("/", s.ping) })
}

func (s *Server) ping(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	enc := json.NewEncoder(w)
	if err := enc.Encode("message: pong"); err != nil {
		slog.Default().Error("encode ping", "error", err)
	}
}

func (s *Server) mountSocket() {
	s.router.Route("/ws", func(r chi.Router) { r.Get("/", s.serveWebsocket) })
}

func (s *Server) serveWebsocket(w http.ResponseWriter, r *http.Request) {
	serveWs(s.hub, w, r)
}

func (s *Server) mountStatic() {
	s.router.Handle("/*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip API and WebSocket routes
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws/") {
			http.NotFound(w, r)
			return
		}

		path := filepath.Join(staticDir, r.URL.Path)
		_, err := os.Stat(path)
		if err == nil {
			ext := filepath.Ext(path)
			if mimeType := mime.TypeByExtension(ext); mimeType != "" {
				w.Header().Set("Content-Type", mimeType)
			}
			// HTML must be revalidated on every load so a redeploy is picked
			// up on refresh; the hashed assets it references can be cached.
			if ext == ".html" {
				w.Header().Set("Cache-Control", "no-cache")
			}
			http.ServeFile(w, r, path)
			return
		}

		// If file not found, serve index.html for client-side routing
		indexPath := filepath.Join(staticDir, "index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, indexPath)
	}))
}

func registerExtensions() {
	mime.AddExtensionType(".js", "application/javascript")
	mime.AddExtensionType(".css", "text/css")
	mime.AddExtensionType(".svg", "image/svg+xml")
	mime.AddExtensionType(".json", "application/json")
	mime.AddExtensionType(".map", "application/json")
	mime.AddExtensionType(".woff", "font/woff")
	mime.AddExtensionType(".woff2", "font/woff2")
	mime.AddExtensionType(".ttf", "font/ttf")
}
