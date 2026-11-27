package agentapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	stddraw "image/draw"
	"image/png"
	"net/http"
	"strconv"
	"strings"
	"time"

	xdraw "golang.org/x/image/draw"

	"github.com/mps233/la-pluma/go/internal/infra/adb"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

func (h *Handler) screenFrame(w http.ResponseWriter, r *http.Request) {
	connection, err := h.resolveRequestConnectionFor(r, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	key := connection.ADBPath + "\x00" + connection.Address
	frame, err := h.cachedScreenFrame(key, func() ([]byte, error) {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		return h.app.WebRTC.ScreenshotWithConnection(ctx, connection.ADBPath, connection.Address)
	})
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(frame)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(frame)
}

func (h *Handler) cachedScreenFrame(key string, capture func() ([]byte, error)) ([]byte, error) {
	h.frameMu.Lock()
	entry, ok := h.frameCache[key]
	h.frameMu.Unlock()
	if ok && time.Since(entry.at) < screenFrameCacheTTL {
		return entry.data, nil
	}
	data, err := capture()
	if err != nil {
		return nil, err
	}
	data = downscalePNG(data, screenFrameMaxWidth)
	h.frameMu.Lock()
	if h.frameCache == nil {
		h.frameCache = map[string]screenFrameCacheEntry{}
	}
	h.frameCache[key] = screenFrameCacheEntry{data: data, at: time.Now()}
	h.frameMu.Unlock()
	return data, nil
}

// downscalePNG keeps the dashboard fallback near 720px wide. It returns the
// original bytes for small frames or unsupported payloads.
func downscalePNG(data []byte, maxWidth int) []byte {
	source, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return data
	}
	bounds := source.Bounds()
	if bounds.Dx() <= maxWidth || maxWidth <= 0 {
		return data
	}
	height := bounds.Dy() * maxWidth / bounds.Dx()
	if height < 1 {
		height = 1
	}
	target := image.NewRGBA(image.Rect(0, 0, maxWidth, height))
	xdraw.ApproxBiLinear.Scale(target, target.Bounds(), source, bounds, stddraw.Src, nil)
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, target); err != nil {
		return data
	}
	return buffer.Bytes()
}

func (h *Handler) screenScreenshot(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	connection, err := h.resolveRequestConnectionFor(r, body)
	if err != nil {
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	image, err := h.app.WebRTC.ScreenshotWithConnection(ctx, connection.ADBPath, connection.Address)
	if err != nil {
		writeError(w, err)
		return
	}
	width, height := imageDimensions(image)
	httpx.Success(w, http.StatusOK, map[string]any{
		"image":      base64.StdEncoding.EncodeToString(image),
		"mediaType":  "image/png",
		"width":      width,
		"height":     height,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
		"capturedAt": time.Now().UTC().Format(time.RFC3339),
	}, "", nil)
}

func imageDimensions(data []byte) (int, int) {
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, 0
	}
	return config.Width, config.Height
}

func (h *Handler) getClipboard(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	text, err := h.app.WebRTC.GetClipboard(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"text": text}, "", nil)
}

func (h *Handler) setClipboard(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	text, ok := body["text"].(string)
	if !ok {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_VALIDATION_CLIPBOARD_TEXT_REQUIRED", Message: "请提供剪贴板文本", Retryable: false})
		return
	}
	paste := true
	if value, ok := body["paste"].(bool); ok {
		paste = value
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if err := h.app.WebRTC.SetClipboard(ctx, text, paste); err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"set": true, "paste": paste}, "", nil)
}

func (h *Handler) previewOrientation(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	orientation := strings.ToLower(strings.TrimSpace(stringField(body, "orientation")))
	if orientation != "portrait" && orientation != "landscape" && orientation != "auto" {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_VALIDATION_ORIENTATION_INVALID", Message: "orientation 必须是 portrait、landscape 或 auto", Retryable: false})
		return
	}
	connection, err := h.resolveRequestConnection(body)
	if err != nil {
		writeError(w, err)
		return
	}
	adbPath := firstNonEmpty(stringField(body, "adbPath"), connection.ADBPath)
	address := firstNonEmpty(stringField(body, "address"), connection.Address)
	commands := [][]string{}
	if orientation == "auto" {
		commands = append(commands, []string{"settings", "put", "system", "accelerometer_rotation", "1"})
	} else {
		rotation := "0"
		if orientation == "landscape" {
			rotation = "1"
		}
		commands = append(commands,
			[]string{"settings", "put", "system", "accelerometer_rotation", "0"},
			[]string{"settings", "put", "system", "user_rotation", rotation},
			[]string{"cmd", "window", "set-user-rotation", "lock", rotation},
		)
	}
	if dryRun, _ := body["dryRun"].(bool); dryRun {
		httpx.Success(w, http.StatusOK, map[string]any{"action": "preview-orientation", "orientation": orientation, "adbPath": adbPath, "address": address, "commands": commands}, "Dry run only", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	client := adb.New(adbPath)
	results := make([]map[string]any, 0, len(commands))
	for _, command := range commands {
		output, err := client.Shell(ctx, address, command...)
		result := map[string]any{"args": command, "ok": err == nil, "stdout": output}
		if err != nil {
			result["error"] = err.Error()
			if !(len(command) >= 2 && command[0] == "cmd" && command[1] == "window") {
				httpx.Failure(w, http.StatusBadGateway, &httpx.APIError{Code: "AGENT_ORIENTATION_FAILED", Message: "设置屏幕方向失败", Retryable: true, Details: result})
				return
			}
		}
		results = append(results, result)
	}
	httpx.Success(w, http.StatusOK, map[string]any{"action": "preview-orientation", "orientation": orientation, "adbPath": adbPath, "address": address, "commands": commands, "results": results}, "屏幕方向已设置", nil)
}
