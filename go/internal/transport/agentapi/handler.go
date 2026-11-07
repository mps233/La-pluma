package agentapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/mps233/la-pluma/go/internal/app"
	webrtcapp "github.com/mps233/la-pluma/go/internal/app/webrtc"
	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

const apiVersion = "2026-07-12"

type Handler struct {
	app     *app.App
	logger  *slog.Logger
	handler http.Handler
}

func New(application *app.App, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	mux := http.NewServeMux()
	handler := &Handler{app: application, logger: logger}

	mux.HandleFunc("GET /status", handler.status)
	mux.HandleFunc("GET /runs/current", handler.currentRun)
	mux.HandleFunc("GET /runs/{runId}", handler.getRun)
	mux.HandleFunc("POST /runs/{runId}/stop", handler.stopRun)
	mux.HandleFunc("GET /tasks/status", handler.taskStatus)
	mux.HandleFunc("GET /webrtc/status", handler.webrtcStatus)
	mux.HandleFunc("POST /webrtc/start", handler.webrtcStart)
	mux.HandleFunc("POST /webrtc/stop", handler.webrtcStop)
	mux.HandleFunc("GET /webrtc/devices", handler.webrtcDevices)
	mux.HandleFunc("GET /webrtc/snapshot", handler.webrtcSnapshot)
	mux.HandleFunc("POST /webrtc/start-server", handler.webrtcStart)
	mux.HandleFunc("POST /webrtc/stop-server", handler.webrtcStop)
	mux.HandleFunc("POST /webrtc/start-agent", handler.webrtcStart)
	mux.HandleFunc("POST /webrtc/stop-agent", handler.webrtcStop)
	mux.HandleFunc("POST /webrtc/install", handler.webrtcInstall)
	mux.HandleFunc("GET /webrtc/install/status", handler.webrtcInstall)
	mux.HandleFunc("GET /manifest", handler.manifest)
	mux.HandleFunc("GET /openapi.json", handler.openapi)
	handler.handler = mux
	return handler
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.handler.ServeHTTP(w, r)
}

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	task := h.app.TaskStatus()
	slim := r.URL.Query().Get("slim")
	api := map[string]any{
		"name":     "la-pluma-agent-api",
		"version":  apiVersion,
		"manifest": "/api/agent/manifest",
		"openapi":  "/api/agent/openapi.json",
	}
	maa := map[string]any{"version": nil, "task": task}
	if slim == "true" || slim == "1" {
		httpx.Success(w, http.StatusOK, map[string]any{
			"api":        api,
			"maa":        maa,
			"connection": map[string]any{"adbPath": nil, "address": nil},
		}, "", nil)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{
		"api":        api,
		"maa":        maa,
		"device":     map[string]any{"connected": false},
		"screen":     map[string]any{},
		"recentLogs": []any{},
		"recommendations": []string{
			"Go backend migration in progress",
		},
	}, "", nil)
}

func (h *Handler) currentRun(w http.ResponseWriter, r *http.Request) {
	lines := parseBoundedInt(r.URL.Query().Get("lines"), 80, 1, 500)
	_ = lines
	current, ok := h.app.CurrentRun()
	var run any
	if ok {
		run = current
	}
	last, hasLast := h.app.LatestTerminalRun()
	var lastRun any
	if hasLast {
		lastRun = last
	}
	httpx.Success(w, http.StatusOK, map[string]any{
		"isRunning":  h.app.TaskStatus().IsRunning,
		"taskName":   h.app.TaskStatus().TaskName,
		"schedule":   map[string]any{"isRunning": false},
		"recentLogs": []any{},
		"run":        run,
		"lastRun":    lastRun,
		"lease":      h.app.LeaseSnapshot(),
	}, "", nil)
}

func (h *Handler) getRun(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runId")
	run, ok := h.app.Runs.Get(runID)
	if !ok {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{Code: "AGENT_RUN_NOT_FOUND", Message: "未找到 Agent run: " + runID, Retryable: false, Details: map[string]any{"runId": runID}})
		return
	}
	httpx.Success(w, http.StatusOK, run, "", nil)
}

func (h *Handler) stopRun(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runId")
	run, ok := h.app.Runs.Get(runID)
	if !ok {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{Code: "AGENT_RUN_NOT_FOUND", Message: "未找到 Agent run: " + runID, Retryable: false, Details: map[string]any{"runId": runID}})
		return
	}
	if run.State.Terminal() {
		httpx.Success(w, http.StatusOK, map[string]any{"stopped": false, "alreadyTerminal": true, "run": run}, "任务已经结束", nil)
		return
	}
	if run.State == agentrun.StatusAccepted {
		stopped, err := h.app.Runs.Stop(runID, map[string]any{"canceled": true})
		if err != nil {
			writeError(w, err)
			return
		}
		_, _ = h.app.Runs.ReleaseIdempotency(runID)
		httpx.Success(w, http.StatusOK, map[string]any{"stopped": true, "acceptedRunCanceled": true, "run": stopped}, "已取消尚未开始的执行", nil)
		return
	}

	if _, err := h.app.Runs.MarkStopping(runID); err != nil {
		// Waiting/manual runs may not be stoppable here; return the current state.
		current, _ := h.app.Runs.Get(runID)
		httpx.Success(w, http.StatusOK, map[string]any{"stopped": false, "run": current}, "任务未在运行", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if err := h.app.MAA.Stop(ctx, 3*time.Second); err != nil {
		h.logger.Warn("stop MAA", "error", err)
	}
	stopped, err := h.app.Runs.Stop(runID, map[string]any{"stopped": true})
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"stopped": true, "run": stopped}, "任务已停止", nil)
}

func (h *Handler) taskStatus(w http.ResponseWriter, r *http.Request) {
	httpx.Success(w, http.StatusOK, h.app.TaskStatus(), "", nil)
}

func (h *Handler) manifest(w http.ResponseWriter, r *http.Request) {
	httpx.Failure(w, http.StatusServiceUnavailable, &httpx.APIError{Code: "AGENT_CONTRACT_NOT_READY", Message: "Agent contract 尚未迁移", Retryable: true})
}

func (h *Handler) openapi(w http.ResponseWriter, r *http.Request) {
	httpx.Failure(w, http.StatusServiceUnavailable, &httpx.APIError{Code: "AGENT_CONTRACT_NOT_READY", Message: "Agent contract 尚未迁移", Retryable: true})
}

func writeError(w http.ResponseWriter, err error) {
	httpx.Failure(w, httpx.StatusFromError(err), httpx.FromError(err))
}

func parseBoundedInt(raw string, fallback, min, max int) int {
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

type webrtcStartBody struct {
	DeviceID      string `json:"deviceId"`
	Address       string `json:"address"`
	ADBPath       string `json:"adbPath"`
	ServerPath    string `json:"serverPath"`
	ServerVersion string `json:"serverVersion"`
	MaxSize       int    `json:"maxSize"`
	MaxFPS        int    `json:"maxFps"`
	BitRate       int    `json:"bitRate"`
}

func (h *Handler) webrtcStatus(w http.ResponseWriter, r *http.Request) {
	httpx.Success(w, http.StatusOK, h.app.WebRTC.Status(), "", nil)
}

func (h *Handler) webrtcStart(w http.ResponseWriter, r *http.Request) {
	var body webrtcStartBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	status, err := h.app.WebRTC.Start(ctx, webrtcStartRequest(body))
	if err != nil {
		writeError(w, err)
		return
	}
	deviceID, _ := status["deviceId"].(string)
	status["protocol"] = map[string]any{
		"websocket":           "/webrtc-signaling/connect_client?token=",
		"connectMessage":      map[string]any{"message_type": "connect", "device_id": deviceID},
		"requestOfferPayload": map[string]any{"type": "request-offer", "ip_preference": "ipv4"},
		"candidatePolicy":     "relay preferred / ipv4",
	}
	httpx.Success(w, http.StatusOK, status, "WebRTC 预览已启动", nil)
}

func (h *Handler) webrtcStop(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := h.app.WebRTC.Stop(ctx); err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, h.app.WebRTC.Status(), "WebRTC 预览已停止", nil)
}

func (h *Handler) webrtcDevices(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	devices, err := h.app.WebRTC.Devices(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"devices": devices}, "", nil)
}

func (h *Handler) webrtcSnapshot(w http.ResponseWriter, r *http.Request) {
	deviceID := r.URL.Query().Get("deviceId")
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	snapshot, err := h.app.WebRTC.Snapshot(ctx, deviceID)
	if err != nil {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{
			Code: "WEBRTC_SNAPSHOT_UNAVAILABLE", Message: "无法读取设备快照，请确认设备已连接",
			Retryable: true, Details: map[string]any{"deviceId": deviceID},
		})
		return
	}
	httpx.Success(w, http.StatusOK, snapshot, "", nil)
}

func (h *Handler) webrtcInstall(w http.ResponseWriter, r *http.Request) {
	httpx.Success(w, http.StatusOK, map[string]any{
		"status":     "succeeded",
		"installed":  true,
		"startedAt":  time.Now().UTC().Format(time.RFC3339),
		"finishedAt": time.Now().UTC().Format(time.RFC3339),
	}, "Pion + scrcpy 组件已内置", nil)
}

func webrtcStartRequest(body webrtcStartBody) webrtcapp.StartRequest {
	return webrtcapp.StartRequest{
		ADBPath:       body.ADBPath,
		Address:       body.Address,
		DeviceID:      body.DeviceID,
		ServerPath:    body.ServerPath,
		ServerVersion: body.ServerVersion,
		MaxSize:       body.MaxSize,
		MaxFPS:        body.MaxFPS,
		BitRate:       body.BitRate,
	}
}
