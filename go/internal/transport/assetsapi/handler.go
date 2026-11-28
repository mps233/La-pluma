// Package assetsapi exposes the read-only MaaResource image routes. Routing
// and raw image responses live here; infra/assets owns resolution and WebP
// encoding.
package assetsapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	"github.com/mps233/la-pluma/go/internal/infra/assets"
)

var webpAcceptPattern = regexp.MustCompile(`(?i)\bimage/webp\b`)

// Handler serves GET /item/{key} and GET /avatar/{id}. Mount it with
// http.StripPrefix("/api/maa-assets", handler).
type Handler struct {
	service *assets.Service
	logger  *slog.Logger
	mux     *http.ServeMux
}

// New builds the asset router around an asset resolver.
func New(service *assets.Service, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	handler := &Handler{service: service, logger: logger, mux: http.NewServeMux()}
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
	key := assets.NormalizeItemKey(r.PathValue("key"))
	if key == "" {
		writeError(w, http.StatusBadRequest, "Invalid asset key")
		return
	}
	file, found, err := h.service.ItemFile(key)
	if err != nil {
		h.logger.Error("解析 MaaResource 目录失败", "error", err)
		writeError(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if !found {
		writeNotFound(w)
		return
	}
	h.sendAsset(w, r, file)
}

func (h *Handler) avatar(w http.ResponseWriter, r *http.Request) {
	id := assets.NormalizeAvatarID(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "Invalid asset key")
		return
	}
	file, found, err := h.service.AvatarFile(id)
	if err != nil {
		h.logger.Error("解析 MaaResource 目录失败", "error", err)
		writeError(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if !found {
		writeNotFound(w)
		return
	}
	h.sendAsset(w, r, file)
}

func (h *Handler) sendAsset(w http.ResponseWriter, r *http.Request, file string) {
	info, err := os.Stat(file)
	if err != nil || !info.Mode().IsRegular() {
		writeNotFound(w)
		return
	}

	setAssetCacheHeaders(r, w)
	variant, conversionErr := h.service.WebPVariant(file, info, acceptsWebP(r))
	if conversionErr != nil {
		h.logger.Warn("MaaResource 图像转换 WebP 失败", "sourcePath", file, "error", conversionErr)
	}
	if variant != nil {
		w.Header().Set("Content-Type", "image/webp")
		http.ServeContent(w, r, filepath.Base(file)+".webp", info.ModTime(), bytes.NewReader(variant))
		return
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
