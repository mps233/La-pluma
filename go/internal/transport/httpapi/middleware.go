package httpapi

import (
	"bufio"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

type Middleware func(http.Handler) http.Handler

type requestIDKey struct{}

// RequestID attaches a stable request id for logs and envelopes.
func RequestID() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := strings.TrimSpace(r.Header.Get("X-Request-Id"))
			if id == "" {
				var b [12]byte
				if _, err := rand.Read(b[:]); err == nil {
					id = hex.EncodeToString(b[:])
				} else {
					id = "unknown"
				}
			}
			w.Header().Set("X-Request-Id", id)
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id)))
		})
	}
}

// RequestIDFrom returns the id installed by RequestID.
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// Recover turns panics into a 500 envelope and a structured log entry.
func Recover(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if recovered := recover(); recovered != nil {
					logger.Error("panic recovered", "panic", recovered, "path", r.URL.Path, "stack", string(debug.Stack()))
					httpx.Failure(w, http.StatusInternalServerError, httpx.NewError("INTERNAL_ERROR", "服务器内部错误"))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(p []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(p)
	r.bytes += n
	return n, err
}

func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}

func (r *statusRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// AccessLog logs method, path, status and duration.
func AccessLog(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w}
			next.ServeHTTP(rec, r)
			logger.Info("http", "method", r.Method, "path", r.URL.Path, "status", rec.status, "bytes", rec.bytes, "duration_ms", time.Since(start).Milliseconds())
		})
	}
}

// CORS keeps the same-origin client working while giving LAN PWA clients a
// predictable preflight response. Credentials are unnecessary: auth travels in
// headers, not cookies.
func CORS() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := strings.TrimSpace(r.Header.Get("Origin"))
			if origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Add("Vary", "Origin")
			} else {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, X-La-Pluma-Token, Content-Type, Idempotency-Key, X-Request-Id")
			w.Header().Set("Access-Control-Max-Age", "600")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func requiresAuth(path string) bool {
	if path == "/api/maa-assets" || strings.HasPrefix(path, "/api/maa-assets/") {
		return false
	}
	if path == "/api" || strings.HasPrefix(path, "/api/") {
		return true
	}
	if strings.HasPrefix(path, "/webrtc-signaling/api/") {
		return true
	}
	return false
}

// Auth enforces the optional bearer / X-La-Pluma-Token contract.
func Auth(token string) Middleware {
	return func(next http.Handler) http.Handler {
		if token == "" {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !requiresAuth(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			authHeader := r.Header.Get("Authorization")
			headerToken := r.Header.Get("X-La-Pluma-Token")
			bearer := ""
			if strings.HasPrefix(authHeader, "Bearer ") {
				bearer = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
			}
			if !sameToken(bearer, token) && !sameToken(strings.TrimSpace(headerToken), token) {
				w.Header().Set("WWW-Authenticate", `Bearer realm="la-pluma"`)
				httpx.Failure(w, http.StatusUnauthorized, &httpx.APIError{
					Code: "AGENT_AUTH_REQUIRED", Message: "需要有效的 LA_PLUMA_TOKEN", Retryable: false,
				})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func sameToken(got, want string) bool {
	if len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

type gzipWriter struct {
	http.ResponseWriter
	writer      *gzip.Writer
	status      int
	bypass      bool
	hijacked    bool
	wroteHeader bool
}

func (w *gzipWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.status = status
	contentType := w.Header().Get("Content-Type")
	if (contentType != "" && !compressible(contentType)) || w.hijacked {
		w.bypass = true
		w.ResponseWriter.WriteHeader(status)
		return
	}
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Add("Vary", "Accept-Encoding")
	w.Header().Del("Content-Length")
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipWriter) Write(p []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if w.bypass {
		return w.ResponseWriter.Write(p)
	}
	return w.writer.Write(p)
}

func (w *gzipWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	w.hijacked = true
	w.bypass = true
	return hijacker.Hijack()
}

func (w *gzipWriter) Flush() {
	if w.writer != nil && !w.bypass {
		_ = w.writer.Flush()
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func compressible(contentType string) bool {
	lower := strings.ToLower(contentType)
	return !(strings.HasPrefix(lower, "image/") || strings.HasPrefix(lower, "video/") || strings.HasPrefix(lower, "audio/") || strings.Contains(lower, "zip") || strings.Contains(lower, "octet-stream"))
}

// Gzip compresses text responses when the client accepts gzip.
func Gzip() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.Contains(strings.ToLower(r.Header.Get("Accept-Encoding")), "gzip") {
				next.ServeHTTP(w, r)
				return
			}
			if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") {
				next.ServeHTTP(w, r)
				return
			}
			gw := &gzipWriter{ResponseWriter: w}
			gw.writer = gzip.NewWriter(w)
			defer func() {
				if !gw.bypass && !gw.hijacked {
					_ = gw.writer.Close()
				}
			}()
			next.ServeHTTP(gw, r)
		})
	}
}

// Chain applies middleware in the order given: Chain(h, a, b) runs a then b.
func Chain(h http.Handler, middleware ...Middleware) http.Handler {
	for i := len(middleware) - 1; i >= 0; i-- {
		h = middleware[i](h)
	}
	return h
}
