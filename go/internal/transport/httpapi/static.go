package httpapi

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

// staticHandler serves the built SPA at the configured base path and mirrors
// the Node server's cache policy:
//   - hashed assets and workbox files: immutable for one year
//   - app shell, service worker, manifest: no-cache
//   - API/health/signaling paths never fall back to index.html
type staticHandler struct {
	root     string
	basePath string
	files    http.Handler
}

var reservedAppPaths = []string{"/api", "/health", "/webrtc-signaling"}

func newStaticHandler(root, basePath string) *staticHandler {
	return &staticHandler{
		root:     root,
		basePath: basePath,
		files:    http.FileServer(http.Dir(root)),
	}
}

func (s *staticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		httpx.Failure(w, http.StatusMethodNotAllowed, httpx.NewError("METHOD_NOT_ALLOWED", "请求方法不支持"))
		return
	}

	appPath := s.appPath(r.URL.Path)
	if appPath == "" {
		appPath = "/"
	}
	if isReservedAppPath(appPath) {
		httpx.Failure(w, http.StatusNotFound, httpx.NewError("NOT_FOUND", "资源不存在"))
		return
	}

	clean := path.Clean("/" + appPath)
	if strings.HasSuffix(r.URL.Path, "/") && clean != "/" {
		clean += "/"
	}
	if clean == "/" {
		s.serveIndex(w, r)
		return
	}

	if ext := path.Ext(clean); ext != "" {
		s.serveFile(w, r, clean)
		return
	}
	if info, err := os.Stat(filepath.Join(s.root, filepath.FromSlash(strings.TrimPrefix(clean, "/")))); err == nil && !info.IsDir() {
		s.serveFile(w, r, clean)
		return
	}
	s.serveIndex(w, r)
}

func (s *staticHandler) appPath(requestPath string) string {
	if s.basePath == "/" {
		return requestPath
	}
	base := strings.TrimSuffix(s.basePath, "/")
	if requestPath == base {
		return "/"
	}
	if strings.HasPrefix(requestPath, s.basePath) {
		return requestPath[len(base):]
	}
	return ""
}

func isReservedAppPath(appPath string) bool {
	for _, reserved := range reservedAppPaths {
		if appPath == reserved || strings.HasPrefix(appPath, reserved+"/") {
			return true
		}
	}
	return false
}

func (s *staticHandler) serveIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	indexPath := filepath.Join(s.root, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		httpx.Failure(w, http.StatusNotFound, httpx.NewError("CLIENT_DIST_MISSING", "前端构建产物不存在"))
		return
	}
	http.ServeFile(w, r, indexPath)
}

func (s *staticHandler) serveFile(w http.ResponseWriter, r *http.Request, clean string) {
	w.Header().Set("Cache-Control", cacheControlFor(clean))
	clone := new(http.Request)
	*clone = *r
	clone.URL = newURL(r.URL)
	clone.URL.Path = clean
	s.files.ServeHTTP(w, clone)
}

func cacheControlFor(clean string) string {
	normalized := strings.TrimPrefix(clean, "/")
	base := path.Base(normalized)
	if strings.HasPrefix(normalized, "assets/") || isWorkboxFile(base) {
		return "public, max-age=31536000, immutable"
	}
	switch base {
	case "index.html", "sw.js", "manifest.webmanifest", "registerSW.js":
		return "no-cache"
	}
	return ""
}

func isWorkboxFile(name string) bool {
	return strings.HasPrefix(name, "workbox-") && strings.HasSuffix(name, ".js")
}
