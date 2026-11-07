package httpapi

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mps233/la-pluma/go/internal/config"
)

func newTestConfig(t *testing.T, token, basePath string) config.Config {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "index.html"), "<!doctype html><title>La Pluma</title>")
	writeFile(t, filepath.Join(dir, "assets", "app.js"), "console.log('app')")
	writeFile(t, filepath.Join(dir, "sw.js"), "self.addEventListener('install',()=>{})")
	writeFile(t, filepath.Join(dir, "manifest.webmanifest"), `{"name":"La Pluma"}`)
	return config.Config{
		Host:     "127.0.0.1",
		Port:     3000,
		BasePath: basePath,
		Token:    token,
		Paths:    config.Paths{ClientDist: dir},
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func newTestHandler(t *testing.T, cfg config.Config) http.Handler {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(cfg, logger).Handler()
}

func request(t *testing.T, handler http.Handler, method, target string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestHealth(t *testing.T) {
	handler := newTestHandler(t, newTestConfig(t, "", "/"))
	rec := request(t, handler, http.MethodGet, "/health", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["success"] != true || body["status"] != "ok" {
		t.Fatalf("unexpected health body: %s", rec.Body.String())
	}
	if rec.Header().Get("X-Request-Id") == "" {
		t.Fatal("expected X-Request-Id")
	}
}

func TestStaticCacheAndFallback(t *testing.T) {
	handler := newTestHandler(t, newTestConfig(t, "", "/"))

	index := request(t, handler, http.MethodGet, "/", nil)
	if index.Code != http.StatusOK || !strings.Contains(index.Body.String(), "La Pluma") {
		t.Fatalf("index status = %d, body = %s", index.Code, index.Body.String())
	}
	if got := index.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("index cache = %q", got)
	}

	asset := request(t, handler, http.MethodGet, "/assets/app.js", nil)
	if asset.Code != http.StatusOK {
		t.Fatalf("asset status = %d", asset.Code)
	}
	if got := asset.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Fatalf("asset cache = %q", got)
	}

	sw := request(t, handler, http.MethodGet, "/sw.js", nil)
	if got := sw.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("sw cache = %q", got)
	}

	spa := request(t, handler, http.MethodGet, "/settings", nil)
	if spa.Code != http.StatusOK || !strings.Contains(spa.Body.String(), "La Pluma") {
		t.Fatalf("spa status = %d, body = %s", spa.Code, spa.Body.String())
	}

	api := request(t, handler, http.MethodGet, "/api/nope", nil)
	if api.Code != http.StatusNotFound || !strings.Contains(api.Body.String(), "AGENT_NOT_FOUND") {
		t.Fatalf("api status = %d, body = %s", api.Code, api.Body.String())
	}

	missing := request(t, handler, http.MethodGet, "/assets/missing.js", nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing asset status = %d", missing.Code)
	}
}

func TestAuth(t *testing.T) {
	handler := newTestHandler(t, newTestConfig(t, "secret", "/"))

	unauthorized := request(t, handler, http.MethodGet, "/api/nope", nil)
	if unauthorized.Code != http.StatusUnauthorized || !strings.Contains(unauthorized.Body.String(), "AGENT_AUTH_REQUIRED") {
		t.Fatalf("unauthorized status = %d, body = %s", unauthorized.Code, unauthorized.Body.String())
	}

	bearer := request(t, handler, http.MethodGet, "/api/nope", map[string]string{"Authorization": "Bearer secret"})
	if bearer.Code != http.StatusNotFound {
		t.Fatalf("bearer status = %d", bearer.Code)
	}

	header := request(t, handler, http.MethodGet, "/api/nope", map[string]string{"X-La-Pluma-Token": "secret"})
	if header.Code != http.StatusNotFound {
		t.Fatalf("header status = %d", header.Code)
	}

	if health := request(t, handler, http.MethodGet, "/health", nil); health.Code != http.StatusOK {
		t.Fatalf("health status = %d", health.Code)
	}

	assets := request(t, handler, http.MethodGet, "/api/maa-assets/foo.png", nil)
	if assets.Code != http.StatusNotFound {
		t.Fatalf("public assets status = %d", assets.Code)
	}
}

func TestBasePath(t *testing.T) {
	handler := newTestHandler(t, newTestConfig(t, "", "/la-pluma/"))

	index := request(t, handler, http.MethodGet, "/la-pluma/", nil)
	if index.Code != http.StatusOK || !strings.Contains(index.Body.String(), "La Pluma") {
		t.Fatalf("base index status = %d, body = %s", index.Code, index.Body.String())
	}

	spa := request(t, handler, http.MethodGet, "/la-pluma/settings", nil)
	if spa.Code != http.StatusOK || !strings.Contains(spa.Body.String(), "La Pluma") {
		t.Fatalf("base spa status = %d", spa.Code)
	}

	asset := request(t, handler, http.MethodGet, "/la-pluma/assets/app.js", nil)
	if asset.Code != http.StatusOK {
		t.Fatalf("base asset status = %d", asset.Code)
	}

	api := request(t, handler, http.MethodGet, "/la-pluma/api/nope", nil)
	if api.Code != http.StatusNotFound {
		t.Fatalf("base api status = %d", api.Code)
	}

	root := request(t, handler, http.MethodGet, "/", nil)
	if root.Code != http.StatusNotFound {
		t.Fatalf("root status = %d", root.Code)
	}
}

func TestSignalingPlaceholder(t *testing.T) {
	handler := newTestHandler(t, newTestConfig(t, "", "/"))
	login := request(t, handler, http.MethodPost, "/webrtc-signaling/api/login", nil)
	if login.Code != http.StatusServiceUnavailable {
		t.Fatalf("login status = %d", login.Code)
	}
	admin := request(t, handler, http.MethodGet, "/webrtc-signaling/admin", nil)
	if admin.Code != http.StatusNotFound {
		t.Fatalf("admin status = %d", admin.Code)
	}
}

func TestCORSAndGzip(t *testing.T) {
	handler := newTestHandler(t, newTestConfig(t, "", "/"))

	preflight := request(t, handler, http.MethodOptions, "/api/nope", map[string]string{"Origin": "http://localhost:5173"})
	if preflight.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d", preflight.Code)
	}
	if preflight.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("preflight origin = %q", preflight.Header().Get("Access-Control-Allow-Origin"))
	}

	gz := request(t, handler, http.MethodGet, "/api/nope", map[string]string{"Accept-Encoding": "gzip"})
	if gz.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("expected gzip, got %q", gz.Header().Get("Content-Encoding"))
	}
	reader, err := gzip.NewReader(gz.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	decoded, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(decoded), "AGENT_NOT_FOUND") {
		t.Fatalf("decoded body = %s", string(decoded))
	}
}
