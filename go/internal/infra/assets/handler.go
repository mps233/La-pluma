package assets

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	"github.com/mps233/la-pluma/go/internal/config"
)

const (
	itemNamespaceDir   = "template"
	itemAssetsSubdir   = "items"
	avatarAssetsSubdir = "avatar"
)

var webpAcceptPattern = regexp.MustCompile(`(?i)\bimage/webp\b`)

// ItemAssetMapLoader resolves iconId aliases from a resource directory.
type ItemAssetMapLoader func(resourceDir string) (map[string]string, error)

// Config configures a Handler. Zero values use Paths.MaaDataDir/resource, the
// standard MaaResource loader, slog.Default and PNG-only responses.
type Config struct {
	// ResourceDir overrides the MaaResource root. ResourceDirFunc takes
	// precedence when both are set.
	ResourceDir      string
	ResourceDirFunc  func() (string, error)
	LoadItemAssetMap ItemAssetMapLoader
	Logger           *slog.Logger

	// WebPEncoder is optional. A nil encoder always serves the original PNG.
	WebPEncoder WebPEncoder
	// WebP cache limits. Zero uses 256 entries, 64 MiB and the
	// LA_PLUMA_ASSET_WEBP_CONCURRENCY default.
	WebPMaxEntries  int
	WebPMaxBytes    int64
	WebPConcurrency int
}

// Handler serves GET /item/{key} and GET /avatar/{id}. Mount it with
// http.StripPrefix("/api/maa-assets", handler).
type Handler struct {
	logger           *slog.Logger
	resourceDir      string
	resourceDirFunc  func() (string, error)
	loadItemAssetMap ItemAssetMapLoader
	cache            *webPCache
	mux              *http.ServeMux
}

// New builds the asset router for the configured paths.
func New(paths config.Paths, cfg Config) *Handler {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	resourceDir := cfg.ResourceDir
	if resourceDir == "" {
		resourceDir = filepath.Join(paths.MaaDataDir, "resource")
	}
	loader := cfg.LoadItemAssetMap
	if loader == nil {
		loader = LoadItemAssetMap
	}
	handler := &Handler{
		logger:           logger,
		resourceDir:      resourceDir,
		resourceDirFunc:  cfg.ResourceDirFunc,
		loadItemAssetMap: loader,
		cache:            newWebPCache(cfg.WebPEncoder, cfg.WebPMaxEntries, cfg.WebPMaxBytes, cfg.WebPConcurrency),
		mux:              http.NewServeMux(),
	}
	handler.mux.HandleFunc("GET /item/{key}", handler.item)
	handler.mux.HandleFunc("GET /avatar/{id}", handler.avatar)
	handler.mux.HandleFunc("/", notFound)
	return handler
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// StripPrefix leaves an empty path for the mount root.
	if r.URL.Path == "" {
		clone := r.Clone(r.Context())
		clone.URL.Path = "/"
		r = clone
	}
	h.mux.ServeHTTP(w, r)
}

func (h *Handler) item(w http.ResponseWriter, r *http.Request) {
	key := NormalizeItemKey(r.PathValue("key"))
	if key == "" {
		writeError(w, http.StatusBadRequest, "Invalid asset key")
		return
	}
	root, ok := h.resolveRoot(w)
	if !ok {
		return
	}
	itemsDir, ok := safeJoin(root, itemNamespaceDir, itemAssetsSubdir)
	if !ok {
		writeNotFound(w)
		return
	}
	file, ok := safeJoin(itemsDir, key+".png")
	if !ok {
		writeNotFound(w)
		return
	}

	if !isFile(file) {
		assetMap, err := h.loadItemAssetMap(root)
		if err != nil {
			h.logger.Warn("解析 MaaResource 物品图标失败", "key", key, "error", err)
			writeNotFound(w)
			return
		}
		itemID := SelectItemAssetID(key, assetMap)
		if itemID == "" {
			writeNotFound(w)
			return
		}
		file, ok = safeJoin(itemsDir, itemID+".png")
		if !ok || !isFile(file) {
			writeNotFound(w)
			return
		}
	}

	h.sendAsset(w, r, file)
}

func (h *Handler) avatar(w http.ResponseWriter, r *http.Request) {
	id := NormalizeAvatarID(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "Invalid asset key")
		return
	}
	root, ok := h.resolveRoot(w)
	if !ok {
		return
	}
	avatarDir, ok := safeJoin(root, itemNamespaceDir, avatarAssetsSubdir)
	if !ok {
		writeNotFound(w)
		return
	}
	file, ok := safeJoin(avatarDir, id+".png")
	if !ok || !isFile(file) {
		writeNotFound(w)
		return
	}
	h.sendAsset(w, r, file)
}

func (h *Handler) resolveRoot(w http.ResponseWriter) (string, bool) {
	if h.resourceDirFunc == nil {
		return h.resourceDir, true
	}
	root, err := h.resourceDirFunc()
	if err != nil {
		h.logger.Error("解析 MaaResource 目录失败", "error", err)
		writeError(w, http.StatusInternalServerError, "Internal Server Error")
		return "", false
	}
	return root, true
}

func (h *Handler) sendAsset(w http.ResponseWriter, r *http.Request, file string) {
	info, err := os.Stat(file)
	if err != nil || !info.Mode().IsRegular() {
		writeNotFound(w)
		return
	}

	setAssetCacheHeaders(r, w)
	if h.cache != nil && acceptsWebP(r) {
		data, conversionErr := h.cache.variant(file, info)
		if conversionErr != nil {
			h.logger.Warn("MaaResource 图像转换 WebP 失败", "sourcePath", file, "error", conversionErr)
		}
		if data != nil {
			w.Header().Set("Content-Type", "image/webp")
			http.ServeContent(w, r, filepath.Base(file)+".webp", info.ModTime(), bytes.NewReader(data))
			return
		}
	}

	handle, err := os.Open(file)
	if err != nil {
		writeNotFound(w)
		return
	}
	defer handle.Close()
	w.Header().Set("Content-Type", "image/png")
	http.ServeContent(w, r, filepath.Base(file), info.ModTime(), handle)
}

func setAssetCacheHeaders(r *http.Request, w http.ResponseWriter) {
	versioned := false
	if values, ok := r.URL.Query()["v"]; ok && len(values) == 1 && values[0] != "" {
		versioned = true
	}
	w.Header().Set("Vary", "Accept")
	if versioned {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	}
}

func acceptsWebP(r *http.Request) bool {
	return webpAcceptPattern.MatchString(r.Header.Get("Accept"))
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func notFound(w http.ResponseWriter, _ *http.Request) {
	writeNotFound(w)
}

func writeNotFound(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, "Not Found")
}

func writeError(w http.ResponseWriter, status int, message string) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(map[string]string{"error": message})
	body := bytes.TrimSuffix(buffer.Bytes(), []byte("\n"))
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}
