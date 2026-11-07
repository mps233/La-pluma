package agentapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/mps233/la-pluma/go/internal/app"
	"github.com/mps233/la-pluma/go/internal/app/notifications"
	"github.com/mps233/la-pluma/go/internal/app/scheduler"
	"github.com/mps233/la-pluma/go/internal/app/training"
	webrtcapp "github.com/mps233/la-pluma/go/internal/app/webrtc"
	"github.com/mps233/la-pluma/go/internal/contract"
	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
	_ "image/png"
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
	mux.HandleFunc("POST /actions/start-game", handler.startGame)
	mux.HandleFunc("POST /actions/run-task", handler.runTask)
	mux.HandleFunc("POST /actions/fight", handler.fight)
	mux.HandleFunc("POST /actions/stop", handler.stopActions)
	mux.HandleFunc("GET /logs/recent", handler.recentLogs)
	mux.HandleFunc("POST /logs/recent/clear", handler.clearLogs)
	mux.HandleFunc("GET /logs/maa-callbacks", handler.maaCallbacks)
	mux.HandleFunc("GET /config/user/{configType}", handler.loadUserConfig)
	mux.HandleFunc("POST /config/user/{configType}", handler.saveUserConfig)
	mux.HandleFunc("DELETE /config/user/{configType}", handler.deleteUserConfig)
	mux.HandleFunc("GET /config/user", handler.listUserConfigs)
	mux.HandleFunc("GET /config/maa/{profileName}", handler.loadMaaProfile)
	mux.HandleFunc("POST /config/maa/{profileName}", handler.saveMaaProfile)
	mux.HandleFunc("GET /config-directory", handler.configDirectory)
	mux.HandleFunc("GET /drops/today", handler.dropsToday)
	mux.HandleFunc("GET /drops/recent", handler.dropsRecent)
	mux.HandleFunc("GET /drops/statistics", handler.dropsStatistics)
	mux.HandleFunc("GET /training/operators", handler.trainingOperators)
	mux.HandleFunc("GET /training/operator-counts", handler.trainingCounts)
	mux.HandleFunc("GET /training/queue", handler.trainingQueue)
	mux.HandleFunc("POST /training/queue", handler.addTrainingQueue)
	mux.HandleFunc("DELETE /training/queue/{operatorId}", handler.removeTrainingQueue)
	mux.HandleFunc("PUT /training/queue/order", handler.reorderTrainingQueue)
	mux.HandleFunc("PUT /training/settings", handler.updateTrainingSettings)
	mux.HandleFunc("POST /training/plan", handler.trainingPlan)
	mux.HandleFunc("POST /actions/apply-training-plan", handler.applyTrainingPlan)
	mux.HandleFunc("POST /actions/fetch-training-materials", handler.fetchTrainingMaterials)
	mux.HandleFunc("GET /version", handler.version)
	mux.HandleFunc("GET /activity", handler.activity)
	mux.HandleFunc("GET /activity/preflight", handler.activityPreflight)
	mux.HandleFunc("GET /copilots/{id}", handler.getCopilot)
	mux.HandleFunc("GET /copilot-sets/{id}", handler.getCopilotSet)
	mux.HandleFunc("GET /copilot-sets/{id}/plan", handler.getCopilotSetPlan)
	mux.HandleFunc("POST /copilot-sets/{id}/reset-progress", handler.resetCopilotProgress)
	mux.HandleFunc("GET /copilot/search", handler.searchCopilots)
	mux.HandleFunc("GET /schedules/status", handler.scheduleStatus)
	mux.HandleFunc("GET /schedules/execution", handler.scheduleExecution)
	mux.HandleFunc("POST /schedules", handler.setupSchedule)
	mux.HandleFunc("DELETE /schedules/{scheduleId}", handler.stopSchedule)
	mux.HandleFunc("POST /schedules/{scheduleId}/execute", handler.executeSchedule)
	mux.HandleFunc("POST /actions/run-daily-flow", handler.runDailyFlow)
	mux.HandleFunc("GET /notifications/config", handler.notificationConfig)
	mux.HandleFunc("POST /notifications/config", handler.saveNotificationConfig)
	mux.HandleFunc("POST /actions/test-notification-channel", handler.testNotificationChannel)
	mux.HandleFunc("POST /actions/send-notification", handler.sendNotification)
	mux.HandleFunc("GET /stages/open-today", handler.openStages)
	mux.HandleFunc("GET /data/operators", handler.operatorsData)
	mux.HandleFunc("GET /data/operbox", handler.operboxData)
	mux.HandleFunc("GET /data/depot", handler.depotData)
	mux.HandleFunc("GET /device-stats", handler.deviceStats)
	mux.HandleFunc("GET /paradox/operators", handler.paradoxOperators)
	mux.HandleFunc("GET /custom-tools", handler.customTools)
	mux.HandleFunc("GET /auto-update/status", handler.autoUpdateStatus)
	mux.HandleFunc("GET /debug-screenshots", handler.debugScreenshots)
	mux.HandleFunc("GET /screen/frame", handler.screenFrame)
	mux.HandleFunc("POST /screen/screenshot", handler.screenScreenshot)
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
		"recentLogs": h.app.Logs.Recent(25),
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
		"recentLogs": h.app.Logs.Recent(25),
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
	httpx.Success(w, http.StatusOK, contract.Manifest(), "", nil)
}

func (h *Handler) openapi(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(contract.OpenAPI())
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

func idempotencyKey(r *http.Request) *string {
	value := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if value == "" {
		return nil
	}
	return &value
}

func decodeBody(r *http.Request) map[string]any {
	if r.Body == nil {
		return map[string]any{}
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body == nil {
		return map[string]any{}
	}
	return body
}

func waitForCompletion(body map[string]any) bool {
	value, _ := body["waitForCompletion"].(bool)
	return value
}

func (h *Handler) startGame(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	run, replayed, err := h.app.MAAServiceService().StartGame(ctx, waitForCompletion(body), idempotencyKey(r))
	if err != nil {
		writeError(w, err)
		return
	}
	sendRunResponse(w, run, replayed, !waitForCompletion(body), map[string]any{"action": "start-game"})
}

func (h *Handler) runTask(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	taskConfig, ok := body["taskConfig"]
	if !ok {
		taskConfig = body
	}
	if text, ok := taskConfig.(string); ok {
		var parsed any
		if err := json.Unmarshal([]byte(text), &parsed); err == nil {
			taskConfig = parsed
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	run, replayed, err := h.app.MAAServiceService().RunTask(ctx, taskConfig, waitForCompletion(body), idempotencyKey(r))
	if err != nil {
		writeError(w, err)
		return
	}
	sendRunResponse(w, run, replayed, !waitForCompletion(body), nil)
}

func (h *Handler) fight(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	stage, _ := body["stage"].(string)
	if strings.TrimSpace(stage) == "" {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_VALIDATION_STAGE_REQUIRED", Message: "请提供作战关卡", Retryable: false})
		return
	}
	params := map[string]any{"stage": stage}
	if times, ok := body["times"]; ok {
		params["times"] = times
	}
	if drops, ok := body["drop"]; ok {
		params["drop"] = drops
	}
	taskConfig := map[string]any{
		"name":   "作战",
		"type":   "Fight",
		"params": params,
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	run, replayed, err := h.app.MAAServiceService().RunTask(ctx, taskConfig, waitForCompletion(body), idempotencyKey(r))
	if err != nil {
		writeError(w, err)
		return
	}
	sendRunResponse(w, run, replayed, !waitForCompletion(body), map[string]any{"stage": stage})
}

func (h *Handler) stopActions(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := h.app.MAAServiceService().Stop(ctx); err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"stopped": true}, "任务已停止", nil)
}

func sendRunResponse(w http.ResponseWriter, run agentrun.DTO, replayed bool, accepted bool, extra map[string]any) {
	w.Header().Set("X-La-Pluma-Run-Id", run.RunID)
	w.Header().Set("Idempotency-Replayed", strconv.FormatBool(replayed))
	data := map[string]any{
		"runId":   run.RunID,
		"state":   run.State,
		"pollUrl": run.Links.Self,
		"stopUrl": run.Links.Stop,
		"run":     run,
	}
	for key, value := range extra {
		data[key] = value
	}
	status := http.StatusOK
	message := "操作成功"
	if accepted {
		status = http.StatusAccepted
		message = "任务已接受"
	}
	httpx.Success(w, status, data, message, map[string]any{"runId": run.RunID, "idempotentReplay": replayed})
}

func (h *Handler) recentLogs(w http.ResponseWriter, r *http.Request) {
	lines := parseBoundedInt(r.URL.Query().Get("lines"), 80, 1, 500)
	after, _ := strconv.ParseInt(r.URL.Query().Get("afterSequence"), 10, 64)
	httpx.Success(w, http.StatusOK, h.app.Logs.RecentAfter(lines, after), "", nil)
}

func (h *Handler) clearLogs(w http.ResponseWriter, r *http.Request) {
	h.app.Logs.Clear()
	httpx.Success(w, http.StatusOK, map[string]any{"cleared": true}, "日志已清空", nil)
}

func (h *Handler) maaCallbacks(w http.ResponseWriter, r *http.Request) {
	lines := parseBoundedInt(r.URL.Query().Get("lines"), 2000, 1, 5000)
	logPath := filepath.Join(h.app.Config().Paths.MaaStateDir, "debug", "asst.log")
	data, err := os.ReadFile(logPath)
	if err != nil {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{Code: "AGENT_MAA_LOG_UNAVAILABLE", Message: "无法读取 MAA 日志", Retryable: true, Details: map[string]any{"logPath": logPath}})
		return
	}
	all := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	if len(all) > lines {
		all = all[len(all)-lines:]
	}
	httpx.Success(w, http.StatusOK, map[string]any{
		"content":       strings.Join(all, "\n"),
		"logPath":       logPath,
		"totalLines":    len(all),
		"returnedLines": len(all),
	}, "", nil)
}

func (h *Handler) loadUserConfig(w http.ResponseWriter, r *http.Request) {
	value, err := h.app.ConfigStore.Load(r.PathValue("configType"))
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) saveUserConfig(w http.ResponseWriter, r *http.Request) {
	var body any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_CONFIG_SAVE_FAILED", Message: "配置内容必须是 JSON", Retryable: false})
		return
	}
	if err := h.app.ConfigStore.Save(r.PathValue("configType"), body); err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"saved": true}, "配置已保存", nil)
}

func (h *Handler) deleteUserConfig(w http.ResponseWriter, r *http.Request) {
	if err := h.app.ConfigStore.Delete(r.PathValue("configType")); err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"deleted": true}, "配置已删除", nil)
}

func (h *Handler) listUserConfigs(w http.ResponseWriter, r *http.Request) {
	types, err := h.app.ConfigStore.List()
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"types": types}, "", nil)
}

func (h *Handler) loadMaaProfile(w http.ResponseWriter, r *http.Request) {
	value, err := h.app.Profiles.Load(r.PathValue("profileName"))
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) saveMaaProfile(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_CONFIG_SAVE_FAILED", Message: "配置内容必须是 JSON 对象", Retryable: false})
		return
	}
	if err := h.app.Profiles.Save(r.PathValue("profileName"), body); err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"saved": true}, "配置已保存", nil)
}

func (h *Handler) configDirectory(w http.ResponseWriter, r *http.Request) {
	httpx.Success(w, http.StatusOK, map[string]any{"path": h.app.Config().Paths.MaaConfigDir}, "", nil)
}

func dropDays(r *http.Request) int {
	days := parseBoundedInt(r.URL.Query().Get("days"), 7, 1, 365)
	return days
}

func (h *Handler) dropsToday(w http.ResponseWriter, r *http.Request) {
	value, err := h.app.Drops.GetTodayDrops()
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) dropsRecent(w http.ResponseWriter, r *http.Request) {
	value, err := h.app.Drops.GetRecentDrops(dropDays(r))
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) dropsStatistics(w http.ResponseWriter, r *http.Request) {
	value, err := h.app.Drops.GetDropStatistics(dropDays(r))
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) screenFrame(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	image, err := h.app.WebRTC.Screenshot(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(image)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(image)
}

func (h *Handler) screenScreenshot(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	image, err := h.app.WebRTC.Screenshot(ctx)
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

func (h *Handler) trainingOperators(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	filters := training.OperatorFilters{
		Profession:  query.Get("profession"),
		NeedsElite2: query.Get("needsElite2") == "true",
		Status:      firstNonEmpty(query.Get("status"), "trainable"),
	}
	if raw := query.Get("rarity"); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			filters.Rarity = &value
		}
	}
	if raw := query.Get("owned"); raw == "true" || raw == "false" {
		value := raw == "true"
		filters.Owned = &value
	}
	operators, err := h.app.Training.GetOperatorList(filters)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"operators": operators, "count": len(operators)}, "", nil)
}

func (h *Handler) trainingCounts(w http.ResponseWriter, r *http.Request) {
	var rarity *int
	if raw := r.URL.Query().Get("rarity"); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			rarity = &value
		}
	}
	counts, err := h.app.Training.GetOperatorCounts(rarity)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, counts, "", nil)
}

func (h *Handler) trainingQueue(w http.ResponseWriter, r *http.Request) {
	queue, err := h.app.Training.GetTrainingQueue()
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, queue, "", nil)
}

func (h *Handler) addTrainingQueue(w http.ResponseWriter, r *http.Request) {
	var body training.AddToQueueRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.OperatorID) == "" {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_VALIDATION_OPERATOR_ID_REQUIRED", Message: "缺少 operatorId 参数", Retryable: false})
		return
	}
	item, err := h.app.Training.AddToQueue(body.OperatorID, training.AddToQueueOptions{CurrentElite: body.CurrentElite, TargetElite: body.TargetElite})
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, item, "已添加到养成队列", nil)
}

func (h *Handler) removeTrainingQueue(w http.ResponseWriter, r *http.Request) {
	if err := h.app.Training.RemoveFromQueue(r.PathValue("operatorId")); err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, nil, "已从养成队列中移除", nil)
}

func (h *Handler) reorderTrainingQueue(w http.ResponseWriter, r *http.Request) {
	var body training.UpdateQueueOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.OperatorIDs == nil {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_VALIDATION_OPERATOR_IDS_REQUIRED", Message: "operatorIds 必须是数组", Retryable: false})
		return
	}
	if err := h.app.Training.UpdateQueueOrder(body.OperatorIDs); err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, nil, "队列顺序已更新", nil)
}

func (h *Handler) updateTrainingSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		body = map[string]any{}
	}
	settings, err := h.app.Training.UpdateSettings(body)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, settings, "设置已更新", nil)
}

func (h *Handler) trainingPlan(w http.ResponseWriter, r *http.Request) {
	var body training.GeneratePlanRequest
	_ = json.NewDecoder(r.Body).Decode(&body)
	mode := firstNonEmpty(body.Mode, "current")
	clientType := firstNonEmpty(body.ClientType, "Official")
	plan, err := h.app.Training.GenerateTrainingPlan(mode, clientType)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, plan, "", nil)
}

func (h *Handler) applyTrainingPlan(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Plan     *training.TrainingPlan `json:"plan"`
		Settings map[string]any         `json:"settings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Plan == nil {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_VALIDATION_PLAN_REQUIRED", Message: "缺少 plan 参数", Retryable: false})
		return
	}
	result, err := h.app.Training.ApplyPlanToTasks(*body.Plan, body.Settings)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, result, "养成计划已应用到任务流程", nil)
}

func (h *Handler) fetchTrainingMaterials(w http.ResponseWriter, r *http.Request) {
	result, err := h.app.Training.FetchOperatorMaterials(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, result, "养成材料数据已更新", nil)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (h *Handler) notificationConfig(w http.ResponseWriter, r *http.Request) {
	httpx.Success(w, http.StatusOK, h.app.Notifications.GetConfig(), "", nil)
}

func (h *Handler) saveNotificationConfig(w http.ResponseWriter, r *http.Request) {
	var config notifications.Config
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_NOTIFICATION_CONFIG_INVALID", Message: "通知配置格式无效", Retryable: false})
		return
	}
	if err := h.app.Notifications.Validate(config); err != nil {
		writeError(w, err)
		return
	}
	if err := h.app.Notifications.Save(config); err != nil {
		writeError(w, err)
		return
	}
	h.app.Notifications.SetConfig(config)
	httpx.Success(w, http.StatusOK, nil, "通知配置已保存", nil)
}

func (h *Handler) testNotificationChannel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Channel string                      `json:"channel"`
		Config  notifications.ChannelConfig `json:"config"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if strings.TrimSpace(body.Channel) == "" {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_VALIDATION_CHANNEL_REQUIRED", Message: "缺少通知渠道", Retryable: false})
		return
	}
	result, err := h.app.Notifications.TestChannel(r.Context(), body.Channel, body.Config)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"channel": body.Channel, "result": result}, result.Message, nil)
}

func (h *Handler) sendNotification(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Channel string         `json:"channel"`
		Title   string         `json:"title"`
		Content string         `json:"content"`
		Level   string         `json:"level"`
		Data    map[string]any `json:"data"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	message := notifications.Message{
		Title:   firstNonEmpty(body.Title, "测试通知"),
		Content: firstNonEmpty(body.Content, "这是一条测试通知"),
		Level:   firstNonEmpty(body.Level, "info"),
		Data:    body.Data,
	}
	if strings.TrimSpace(body.Channel) != "" {
		result, err := h.app.Notifications.SendToChannel(r.Context(), body.Channel, message)
		if err != nil {
			writeError(w, err)
			return
		}
		httpx.Success(w, http.StatusOK, result, "通知已发送到指定渠道", nil)
		return
	}
	result := h.app.Notifications.Send(r.Context(), message)
	if !result.Success {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_NOTIFICATION_SEND_FAILED", Message: result.Message, Retryable: false})
		return
	}
	httpx.Success(w, http.StatusOK, result, "通知已发送", nil)
}

func (h *Handler) openStages(w http.ResponseWriter, r *http.Request) {
	clientType := firstNonEmpty(r.URL.Query().Get("clientType"), "Official")
	value := h.app.Training.TodayOpenStages(clientType, false)
	httpx.Success(w, http.StatusOK, value, "已获取今日开放日常关卡", nil)
}

func (h *Handler) operboxData(w http.ResponseWriter, r *http.Request) {
	value, err := jsonstore.Read(filepath.Join(h.app.Config().Paths.DataDir, "operbox.json"), map[string]any{})
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) depotData(w http.ResponseWriter, r *http.Request) {
	value, err := jsonstore.Read(filepath.Join(h.app.Config().Paths.DataDir, "depot.json"), map[string]any{})
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) scheduleStatus(w http.ResponseWriter, r *http.Request) {
	httpx.Success(w, http.StatusOK, h.app.Scheduler.ScheduleStatus(), "", nil)
}

func (h *Handler) scheduleExecution(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("includeResult") == "true" {
		httpx.Success(w, http.StatusOK, h.app.Scheduler.ExecutionStatusWithResult(), "", nil)
		return
	}
	httpx.Success(w, http.StatusOK, h.app.Scheduler.ExecutionStatus(), "", nil)
}

func (h *Handler) setupSchedule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ScheduleID string   `json:"scheduleId"`
		Times      []string `json:"times"`
		TaskFlow   any      `json:"taskFlow"`
		ClientType string   `json:"clientType"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_SCHEDULE_SETUP_FAILED", Message: "定时任务格式无效", Retryable: false})
		return
	}
	if body.ScheduleID == "" {
		body.ScheduleID = "default"
	}
	result := h.app.Scheduler.RegisterScheduleForClient(body.ScheduleID, body.Times, body.TaskFlow, firstNonEmpty(body.ClientType, "Official"))
	if !result.Success {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_SCHEDULE_SETUP_FAILED", Message: result.Message, Retryable: false, Details: map[string]any{"scheduleId": body.ScheduleID}})
		return
	}
	httpx.Success(w, http.StatusOK, result, result.Message, nil)
}

func (h *Handler) stopSchedule(w http.ResponseWriter, r *http.Request) {
	result := h.app.Scheduler.StopSchedule(r.PathValue("scheduleId"))
	httpx.Success(w, http.StatusOK, result, result.Message, nil)
}

func (h *Handler) executeSchedule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TaskFlow any `json:"taskFlow"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	result := h.app.Scheduler.StartDailyFlow(r.Context(), scheduler.DailyFlowRequest{
		ScheduleID: r.PathValue("scheduleId"),
		TaskFlow:   body.TaskFlow,
	})
	if !result.Success {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_SCHEDULE_EXECUTE_FAILED", Message: result.Message, Retryable: false})
		return
	}
	httpx.Success(w, http.StatusOK, result, result.Message, nil)
}

func (h *Handler) runDailyFlow(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ScheduleID string `json:"scheduleId"`
		TaskFlow   any    `json:"taskFlow"`
		DryRun     bool   `json:"dryRun"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	result := h.app.Scheduler.StartDailyFlow(r.Context(), scheduler.DailyFlowRequest{
		ScheduleID: body.ScheduleID,
		TaskFlow:   body.TaskFlow,
		DryRun:     body.DryRun,
	})
	if !result.Success {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_DAILY_FLOW_FAILED", Message: result.Message, Retryable: false})
		return
	}
	httpx.Success(w, http.StatusOK, result, result.Message, nil)
}

func (h *Handler) getCopilot(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	value, err := h.app.Copilot.PRTS().GetCopilot(ctx, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) getCopilotSet(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	value, err := h.app.Copilot.PRTS().GetSet(ctx, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) getCopilotSetPlan(w http.ResponseWriter, r *http.Request) {
	raid := firstNonEmpty(r.URL.Query().Get("raid"), "normal")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	plan, err := h.app.Copilot.BuildPlan(ctx, r.PathValue("id"), raid)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, plan, "", nil)
}

func (h *Handler) resetCopilotProgress(w http.ResponseWriter, r *http.Request) {
	if err := h.app.Copilot.ResetProgress(r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"reset": true}, "进度已重置", nil)
}

func (h *Handler) searchCopilots(w http.ResponseWriter, r *http.Request) {
	stage := strings.TrimSpace(r.URL.Query().Get("stage"))
	if stage == "" {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_VALIDATION_STAGE_REQUIRED", Message: "缺少 stage 参数", Retryable: false})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	value, err := h.app.Copilot.PRTS().QueryCopilots(ctx, stage, 1, 20, "hot")
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) version(w http.ResponseWriter, r *http.Request) {
	httpx.Success(w, http.StatusOK, map[string]any{
		"cli":  os.Getenv("MAA_CLI_VERSION"),
		"core": os.Getenv("MAA_CORE_VERSION"),
	}, "", nil)
}

func (h *Handler) deviceStats(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	stats, err := h.app.WebRTC.DeviceStats(ctx)
	if err != nil {
		httpx.Success(w, http.StatusOK, nil, "", nil)
		return
	}
	httpx.Success(w, http.StatusOK, stats, "", nil)
}

func (h *Handler) operatorsData(w http.ResponseWriter, r *http.Request) {
	operators, err := h.app.Training.AllOperatorsDetailed()
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, operators, "", nil)
}

func (h *Handler) paradoxOperators(w http.ResponseWriter, r *http.Request) {
	value, err := jsonstore.Read(filepath.Join(h.app.Config().Paths.DataDir, "paradox-operators.json"), []any{})
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) customTools(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(filepath.Join(h.app.Config().Paths.DataDir, "custom-tools"))
	if err != nil {
		httpx.Success(w, http.StatusOK, map[string]any{"tools": []any{}}, "", nil)
		return
	}
	tools := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		tools = append(tools, map[string]any{"name": strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())), "file": entry.Name()})
	}
	httpx.Success(w, http.StatusOK, map[string]any{"tools": tools}, "", nil)
}

func (h *Handler) autoUpdateStatus(w http.ResponseWriter, r *http.Request) {
	config, _ := h.app.ConfigStore.Load("auto-update")
	httpx.Success(w, http.StatusOK, map[string]any{"enabled": false, "config": config, "running": false}, "", nil)
}

func (h *Handler) debugScreenshots(w http.ResponseWriter, r *http.Request) {
	dir := filepath.Join(h.app.Config().Paths.DataDir, "debug")
	entries, _ := os.ReadDir(dir)
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			files = append(files, entry.Name())
		}
	}
	httpx.Success(w, http.StatusOK, map[string]any{"files": files, "path": dir}, "", nil)
}

func (h *Handler) activity(w http.ResponseWriter, r *http.Request) {
	clientType := firstNonEmpty(r.URL.Query().Get("clientType"), "Official")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	info, err := h.app.Activity.CurrentActivity(ctx, clientType)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, info, "", nil)
}

func (h *Handler) activityPreflight(w http.ResponseWriter, r *http.Request) {
	clientType := firstNonEmpty(r.URL.Query().Get("clientType"), "Official")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	result, err := h.app.Activity.GetActivityRunPreflight(ctx, clientType)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, result, "", nil)
}
