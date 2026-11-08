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
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mps233/la-pluma/go/internal/app"
	"github.com/mps233/la-pluma/go/internal/app/activity"
	"github.com/mps233/la-pluma/go/internal/app/copilot"
	"github.com/mps233/la-pluma/go/internal/app/mastery"
	"github.com/mps233/la-pluma/go/internal/app/notifications"
	"github.com/mps233/la-pluma/go/internal/app/scheduler"
	"github.com/mps233/la-pluma/go/internal/app/training"
	"github.com/mps233/la-pluma/go/internal/app/updates"
	webrtcapp "github.com/mps233/la-pluma/go/internal/app/webrtc"
	"github.com/mps233/la-pluma/go/internal/contract"
	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	"github.com/mps233/la-pluma/go/internal/infra/adb"
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
	mux.HandleFunc("GET /operator-mastery/preflight", handler.masteryPreflight)
	mux.HandleFunc("GET /operator-mastery/catalog", handler.masteryCatalog)
	mux.HandleFunc("GET /operator-mastery/operators/{operatorId}", handler.masteryOperator)
	mux.HandleFunc("GET /operator-mastery/status", handler.masteryStatus)
	mux.HandleFunc("POST /operator-mastery/items", handler.addMasteryItems)
	mux.HandleFunc("PATCH /operator-mastery/items/{id}", handler.updateMasteryItem)
	mux.HandleFunc("DELETE /operator-mastery/items/{id}", handler.removeMasteryItem)
	mux.HandleFunc("PUT /operator-mastery/items/order", handler.reorderMasteryItems)
	mux.HandleFunc("PUT /operator-mastery/settings", handler.updateMasterySettings)
	mux.HandleFunc("POST /operator-mastery/start", handler.startMastery)
	mux.HandleFunc("POST /operator-mastery/pause", handler.pauseMastery)
	mux.HandleFunc("POST /operator-mastery/resume", handler.resumeMastery)
	mux.HandleFunc("POST /operator-mastery/stop", handler.stopMastery)
	mux.HandleFunc("POST /operator-mastery/items/{id}/retry", handler.retryMasteryItem)
	mux.HandleFunc("GET /version", handler.version)
	mux.HandleFunc("GET /activity", handler.activity)
	mux.HandleFunc("GET /activity/preflight", handler.activityPreflight)
	mux.HandleFunc("GET /activity/copilot-candidates", handler.activityCandidates)
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
	mux.HandleFunc("POST /preview/orientation", handler.previewOrientation)
	mux.HandleFunc("GET /changelog/core", handler.changelogCore)
	mux.HandleFunc("GET /changelog/cli", handler.changelogCLI)
	mux.HandleFunc("POST /actions/test-connection", handler.testConnection)
	mux.HandleFunc("GET /actions/discover-devices", handler.discoverDevices)
	mux.HandleFunc("POST /actions/open-config-directory", handler.openConfigDirectory)
	mux.HandleFunc("POST /actions/configure-auto-update", handler.configureAutoUpdate)
	mux.HandleFunc("POST /actions/depot-recognition", handler.depotRecognition)
	mux.HandleFunc("POST /actions/operbox-recognition", handler.operboxRecognition)
	mux.HandleFunc("POST /activity/run", handler.activityRun)
	mux.HandleFunc("GET /copilot-sets/{id}/manual/{runId}", handler.manualCopilotSession)
	mux.HandleFunc("GET /paradox/search", handler.paradoxSearch)
	mux.HandleFunc("POST /copilot-sets/{id}/execute", handler.executeCopilotSet)
	mux.HandleFunc("POST /copilot-sets/{id}/manual/start", handler.startManualCopilotSet)
	mux.HandleFunc("POST /actions/continue-copilot-set", handler.continueManualCopilotSet)
	mux.HandleFunc("POST /actions/update-core", handler.updateCore)
	mux.HandleFunc("POST /actions/update-cli", handler.updateCLI)
	mux.HandleFunc("POST /actions/hot-update-resources", handler.hotUpdateResources)
	mux.HandleFunc("GET /logs/files", handler.logFiles)
	mux.HandleFunc("GET /logs/files/{filePath...}", handler.readLogFile)
	mux.HandleFunc("POST /logs/cleanup", handler.cleanupLogs)
	mux.HandleFunc("GET /device-stats", handler.deviceStats)
	mux.HandleFunc("GET /paradox/operators", handler.paradoxOperators)
	mux.HandleFunc("GET /custom-tools", handler.customTools)
	mux.HandleFunc("POST /actions/run-custom-tool", handler.runCustomTool)
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
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	info, err := h.app.Updates.GetVersion(ctx)
	if err != nil {
		httpx.Failure(w, http.StatusServiceUnavailable, &httpx.APIError{Code: "AGENT_MAA_VERSION_UNAVAILABLE", Message: "无法读取 MAA 版本", Retryable: true})
		return
	}
	httpx.Success(w, http.StatusOK, info, "", nil)
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
	tools, err := h.app.CustomTools.ListTools()
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"tools": tools}, "", nil)
}

func (h *Handler) runCustomTool(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	toolID, _ := body["toolId"].(string)
	params := body["params"]
	dryRun, _ := body["dryRun"].(bool)
	if strings.TrimSpace(toolID) == "" {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_VALIDATION_TOOL_ID_REQUIRED", Message: "缺少 toolId", Retryable: false})
		return
	}
	if dryRun {
		plan, err := h.app.CustomTools.Plan(toolID, params)
		if err != nil {
			writeError(w, err)
			return
		}
		httpx.Success(w, http.StatusOK, plan, "Dry run only", nil)
		return
	}
	wait := true
	if value, ok := body["waitForCompletion"].(bool); ok {
		wait = value
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	run, err := h.app.CustomTools.Run(ctx, toolID, params, wait)
	if err != nil {
		writeError(w, err)
		return
	}
	sendRunResponse(w, run, false, !wait, nil)
}

func (h *Handler) autoUpdateStatus(w http.ResponseWriter, r *http.Request) {
	config, _ := h.app.ConfigStore.Load("auto-update")
	enabled, _ := config["enabled"].(bool)
	clock, _ := config["time"].(string)
	status := updates.BuildAutoUpdateStatus(enabled, clock)
	httpx.Success(w, http.StatusOK, map[string]any{"config": config, "status": status}, "", nil)
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

func defaultADBPath() string {
	if value := os.Getenv("ADB_PATH"); strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	if runtime.GOOS == "darwin" {
		return "/opt/homebrew/bin/adb"
	}
	return "adb"
}

func defaultADBAddress() string {
	if value := os.Getenv("ADB_ADDRESS"); strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return "127.0.0.1:16384"
}

func (h *Handler) testConnection(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	adbPath := firstNonEmpty(stringField(body, "adbPath"), defaultADBPath())
	address := firstNonEmpty(stringField(body, "address"), defaultADBAddress())
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	client := adb.New(adbPath)
	devices, err := client.Devices(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	connected := false
	state := "offline"
	for _, device := range devices {
		if device.Serial == address {
			connected = device.State == "device"
			state = device.State
			break
		}
	}
	if !connected && strings.Contains(address, ":") {
		_, _ = client.Connect(ctx, address)
		devices, _ = client.Devices(ctx)
		for _, device := range devices {
			if device.Serial == address {
				connected = device.State == "device"
				state = device.State
				break
			}
		}
	}
	httpx.Success(w, http.StatusOK, map[string]any{
		"connected": connected, "state": state, "adbPath": adbPath, "address": address,
	}, "", nil)
}

func (h *Handler) discoverDevices(w http.ResponseWriter, r *http.Request) {
	adbPath := firstNonEmpty(r.URL.Query().Get("adbPath"), defaultADBPath())
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	devices, err := adb.New(adbPath).Devices(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(devices))
	for _, device := range devices {
		out = append(out, map[string]any{"serial": device.Serial, "state": device.State, "model": device.Model, "raw": device.Raw})
	}
	httpx.Success(w, http.StatusOK, map[string]any{"devices": out, "adbPath": adbPath}, "", nil)
}

func (h *Handler) openConfigDirectory(w http.ResponseWriter, r *http.Request) {
	httpx.Success(w, http.StatusOK, map[string]any{"path": h.app.Config().Paths.MaaConfigDir}, "配置目录已定位", nil)
}

func (h *Handler) configureAutoUpdate(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	if err := h.app.ConfigStore.Save("auto-update", body); err != nil {
		writeError(w, err)
		return
	}
	clientType := firstNonEmpty(stringField(body, "clientType"), "Official")
	result := h.app.Scheduler.SetupAutoUpdate(body, clientType)
	httpx.Success(w, http.StatusOK, result, result.Message, nil)
}

func (h *Handler) depotRecognition(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	if dryRun, _ := body["dryRun"].(bool); dryRun {
		httpx.Success(w, http.StatusOK, map[string]any{"action": "depot-recognition", "sideEffects": []string{"parse_maa_logs", "update_local_depot_cache"}}, "Dry run only", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	run, _, err := h.app.MAAService.RunTask(ctx, map[string]any{
		"name": "仓库识别", "type": "Depot", "params": map[string]any{},
	}, true, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := h.app.Recognition.RecognizeDepot(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"run": run, "data": result.Data, "written": result.Written}, "仓库识别完成", nil)
}

func (h *Handler) operboxRecognition(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	if dryRun, _ := body["dryRun"].(bool); dryRun {
		httpx.Success(w, http.StatusOK, map[string]any{"action": "operbox-recognition", "sideEffects": []string{"parse_maa_logs", "update_local_operbox_cache"}}, "Dry run only", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	run, _, err := h.app.MAAService.RunTask(ctx, map[string]any{
		"name": "干员识别", "type": "OperBox", "params": map[string]any{},
	}, true, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := h.app.Recognition.RecognizeOperBox(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"run": run, "data": result.Data, "written": result.Written}, "干员识别完成", nil)
}

func (h *Handler) copilotUnsupported(w http.ResponseWriter, r *http.Request) {
	httpx.Failure(w, http.StatusNotImplemented, &httpx.APIError{
		Code: "COPILOT_EXECUTION_UNSUPPORTED", Message: "作业执行尚未接入 Go 后端",
		Retryable: false, Details: map[string]any{"todo": "wire copilot PlanExecutor"},
	})
}

func (h *Handler) updateCore(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	version := firstNonEmpty(stringField(body, "version"), "stable")
	dryRun, _ := body["dryRun"].(bool)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	outcome, err := h.app.Updates.UpdateCoreAction(ctx, version, dryRun)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, outcome.Data, outcome.Message, map[string]any{"dryRun": outcome.DryRun})
}

func (h *Handler) updateCLI(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	dryRun, _ := body["dryRun"].(bool)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()
	outcome, err := h.app.Updates.UpdateCLIAction(ctx, dryRun)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, outcome.Data, outcome.Message, map[string]any{"dryRun": outcome.DryRun})
}

func (h *Handler) hotUpdateResources(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	dryRun, _ := body["dryRun"].(bool)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()
	outcome, err := h.app.Updates.HotUpdateResourcesAction(ctx, dryRun)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, outcome.Data, outcome.Message, map[string]any{"dryRun": outcome.DryRun})
}

func (h *Handler) logFiles(w http.ResponseWriter, r *http.Request) {
	dir := filepath.Join(h.app.Config().Paths.MaaStateDir, "debug")
	entries, err := os.ReadDir(dir)
	if err != nil {
		httpx.Success(w, http.StatusOK, map[string]any{"files": []any{}, "path": dir}, "", nil)
		return
	}
	files := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".log") {
			continue
		}
		info, _ := entry.Info()
		modified := ""
		size := int64(0)
		if info != nil {
			modified = info.ModTime().UTC().Format(time.RFC3339)
			size = info.Size()
		}
		files = append(files, map[string]any{"name": entry.Name(), "path": filepath.Join(dir, entry.Name()), "size": size, "modified": modified})
	}
	httpx.Success(w, http.StatusOK, map[string]any{"files": files, "path": dir}, "", nil)
}

func (h *Handler) readLogFile(w http.ResponseWriter, r *http.Request) {
	dir := filepath.Join(h.app.Config().Paths.MaaStateDir, "debug")
	requested := r.PathValue("filePath")
	path := requested
	if !filepath.IsAbs(path) {
		path = filepath.Join(dir, requested)
	}
	cleanDir := filepath.Clean(dir) + string(os.PathSeparator)
	if !strings.HasPrefix(filepath.Clean(path), cleanDir) {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_LOG_PATH_INVALID", Message: "日志路径不合法", Retryable: false})
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{Code: "AGENT_MAA_LOG_UNAVAILABLE", Message: "日志文件不存在", Retryable: false})
		return
	}
	lines := parseBoundedInt(r.URL.Query().Get("lines"), 1000, 1, 5000)
	all := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	total := len(all)
	if len(all) > lines {
		all = all[total-lines:]
	}
	httpx.Success(w, http.StatusOK, map[string]any{
		"path": path, "content": strings.Join(all, "\n"), "totalLines": total, "returnedLines": len(all),
	}, "", nil)
}

func (h *Handler) cleanupLogs(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	maxMB := intField(body, "maxSizeMB")
	if maxMB <= 0 {
		maxMB = 10
	}
	dir := filepath.Join(h.app.Config().Paths.MaaStateDir, "debug")
	entries, _ := os.ReadDir(dir)
	type logFile struct {
		path    string
		size    int64
		modTime time.Time
	}
	files := make([]logFile, 0, len(entries))
	var total int64
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".log") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		files = append(files, logFile{path: path, size: info.Size(), modTime: info.ModTime()})
		total += info.Size()
	}
	sort.Slice(files, func(i, j int) bool { return files[i].modTime.Before(files[j].modTime) })
	limit := int64(maxMB) * 1024 * 1024
	removed := 0
	var freed int64
	for _, file := range files {
		if total <= limit {
			break
		}
		if err := os.Remove(file.path); err == nil {
			removed++
			freed += file.size
			total -= file.size
		}
	}
	httpx.Success(w, http.StatusOK, map[string]any{"removed": removed, "freedBytes": freed, "remainingBytes": total}, "日志清理完成", nil)
}

func stringField(record map[string]any, key string) string {
	value, _ := record[key].(string)
	return value
}

func (h *Handler) activityCandidates(w http.ResponseWriter, r *http.Request) {
	clientType := firstNonEmpty(r.URL.Query().Get("clientType"), "Official")
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	preflight, err := h.app.Activity.GetActivityRunPreflight(ctx, clientType)
	if err != nil {
		writeError(w, err)
		return
	}
	candidates, err := h.app.Activity.FindActivityCopilotCandidates(ctx, clientType, activity.DiscoveryOptions{Preflight: &preflight})
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, candidates, "", nil)
}

func (h *Handler) activityRun(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	clientType := firstNonEmpty(stringField(body, "clientType"), "Official")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	var result map[string]any
	var err error
	setID := stringField(body, "setId")
	if setID != "" {
		result, err = h.app.Activity.RunCurrentActivitySet(ctx, activity.SetExecutionOptions{
			SetID:           setID,
			SelectedIndexes: intSlice(body["selectedIndexes"]),
			Raid:            firstNonEmpty(stringField(body, "raid"), "normal"),
			Options:         mapField(body["options"]),
			ClientType:      clientType,
		}, nil)
	} else {
		result, err = h.app.Activity.RunCurrentActivityCopilots(ctx, clientType, nil)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, result, "活动作业执行完成", nil)
}

func mapField(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return map[string]any{}
}

func (h *Handler) copilotManualUnsupported(w http.ResponseWriter, r *http.Request) {
	httpx.Failure(w, http.StatusNotImplemented, &httpx.APIError{
		Code: "COPILOT_MANUAL_UNSUPPORTED", Message: "手动作业集尚未接入 Go 后端",
		Retryable: false,
	})
}

func (h *Handler) paradoxSearch(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_VALIDATION_OPERATOR_NAME_REQUIRED", Message: "请提供干员名字", Retryable: false})
		return
	}
	value, err := jsonstore.Read(filepath.Join(h.app.Config().Paths.DataDir, "paradox-operators.json"), []any{})
	if err != nil {
		writeError(w, err)
		return
	}
	list, _ := value.([]any)
	matches := make([]any, 0)
	for _, item := range list {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		candidate := firstNonEmpty(stringField(record, "name"), stringField(record, "operator"))
		if strings.Contains(strings.ToLower(candidate), strings.ToLower(name)) {
			matches = append(matches, item)
		}
	}
	httpx.Success(w, http.StatusOK, matches, "", nil)
}

func (h *Handler) executeCopilotSet(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	selectedIndexes := intSlice(body["selectedIndexes"])
	options, _ := body["options"].(map[string]any)
	if options == nil {
		options = map[string]any{}
	}
	raid := firstNonEmpty(stringField(body, "raid"), "normal")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	result, err := h.app.Copilot.ExecutePlan(ctx, copilot.PlanExecution{
		SetID:           r.PathValue("id"),
		Raid:            raid,
		SelectedIndexes: selectedIndexes,
		Options:         options,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	data := map[string]any{"results": result.Results, "taskResults": result.TaskResults}
	for key, value := range result.Data {
		data[key] = value
	}
	httpx.Success(w, http.StatusOK, data, "作业集执行完成", nil)
}

func (h *Handler) startManualCopilotSet(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	options, _ := body["options"].(map[string]any)
	request := copilot.ManualStartRequest{
		SetID:           r.PathValue("id"),
		Raid:            firstNonEmpty(stringField(body, "raid"), "normal"),
		SelectedIndexes: anySlice(body["selectedIndexes"]),
		Options:         options,
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	result, err := h.app.Copilot.Manual().StartManualSet(ctx, request)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, result, result.Message, nil)
}

func (h *Handler) continueManualCopilotSet(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	runID := stringField(body, "runId")
	if strings.TrimSpace(runID) == "" {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_RUN_ID_REQUIRED", Message: "继续手动作业集需要 runId", Retryable: false})
		return
	}
	options, _ := body["options"].(map[string]any)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	result, err := h.app.Copilot.Manual().ContinueManualSet(ctx, runID, options)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, result, result.Message, nil)
}

func (h *Handler) manualCopilotSession(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runId")
	session, ok := h.app.Copilot.Manual().ManualSession(runID)
	if !ok || session.SetID != r.PathValue("id") {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{Code: "COPILOT_MANUAL_SESSION_NOT_FOUND", Message: "手动作业集会话不存在或已结束", Retryable: false})
		return
	}
	data := map[string]any{
		"runId": session.RunID, "setId": session.SetID, "name": session.Name, "raid": session.Raid,
		"selectedItemIndexes": session.SelectedItemIndexes, "options": session.Options,
	}
	if run, exists := h.app.Runs.Get(runID); exists {
		data["run"] = run
	}
	httpx.Success(w, http.StatusOK, data, "", nil)
}

func intSlice(value any) []int {
	array, _ := value.([]any)
	out := make([]int, 0, len(array))
	for _, item := range array {
		switch typed := item.(type) {
		case float64:
			out = append(out, int(typed))
		case int:
			out = append(out, typed)
		}
	}
	return out
}

func anySlice(value any) []any {
	array, _ := value.([]any)
	return array
}

func (h *Handler) masteryPreflight(w http.ResponseWriter, r *http.Request) {
	clientType := firstNonEmpty(r.URL.Query().Get("clientType"), "Official")
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	value, err := h.app.Mastery.Preflight(ctx, clientType)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) masteryCatalog(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	var rarity *int
	if raw := query.Get("rarity"); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			rarity = &value
		}
	}
	status := query.Get("status")
	if status != "eligible" && status != "owned" {
		status = "all"
	}
	value, err := h.app.Mastery.Catalog(mastery.CatalogOptions{
		ClientType: query.Get("clientType"),
		Search:     query.Get("search"),
		Rarity:     rarity,
		Status:     mastery.MasteryCandidateStatus(status),
		Limit:      parseBoundedInt(query.Get("limit"), 500, 1, 1000),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) masteryOperator(w http.ResponseWriter, r *http.Request) {
	declaredLevel := 0
	if raw := r.URL.Query().Get("declaredLevel"); raw != "" {
		declaredLevel, _ = strconv.Atoi(raw)
	}
	value, err := h.app.Mastery.OperatorDetail(r.PathValue("operatorId"), mastery.OperatorDetailOptions{
		ClientType: r.URL.Query().Get("clientType"), DeclaredLevel: declaredLevel,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) masteryStatus(w http.ResponseWriter, r *http.Request) {
	value, err := h.app.Mastery.Status()
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) addMasteryItems(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	array, ok := body["items"].([]any)
	if !ok {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_MASTERY_TARGET_INVALID", Message: "items 必须是数组", Retryable: false})
		return
	}
	inputs := make([]mastery.AddItemInput, 0, len(array))
	for _, item := range array {
		record, _ := item.(map[string]any)
		inputs = append(inputs, mastery.AddItemInput{
			OperatorID:    stringField(record, "operatorId"),
			SkillIndex:    intField(record, "skillIndex"),
			TargetLevel:   intField(record, "targetLevel"),
			DeclaredLevel: intField(record, "declaredLevel"),
		})
	}
	clientType := firstNonEmpty(stringField(body, "clientType"), "Official")
	profileID := stringField(body, "profileId")
	context := mastery.CampaignContext{ClientType: &clientType}
	if profileID != "" {
		context.ClientProfileID = &profileID
	}
	result, err := h.app.Mastery.AddItems(inputs, context)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, result, "已加入专精队列", nil)
}

func (h *Handler) updateMasteryItem(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	patch := mastery.ItemPatch{}
	if value, ok := body["targetLevel"].(float64); ok {
		target := int(value)
		patch.TargetLevel = &target
	}
	if value, ok := body["enabled"].(bool); ok && value {
		patch.Enabled = &value
	} else if value, ok := body["enabled"].(bool); ok {
		patch.Enabled = &value
	}
	item, err := h.app.Mastery.UpdateItem(r.PathValue("id"), patch)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, item, "专精目标已更新", nil)
}

func (h *Handler) removeMasteryItem(w http.ResponseWriter, r *http.Request) {
	if err := h.app.Mastery.RemoveItem(r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, nil, "已从专精队列移除", nil)
}

func (h *Handler) reorderMasteryItems(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	array, _ := body["order"].([]any)
	order := make([]string, 0, len(array))
	for _, item := range array {
		if value, ok := item.(string); ok {
			order = append(order, value)
		}
	}
	items, err := h.app.Mastery.Reorder(order)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"items": items}, "队列顺序已更新", nil)
}

func (h *Handler) updateMasterySettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.app.Mastery.UpdateSettings(decodeBody(r))
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, settings, "专精设置已更新", nil)
}

func (h *Handler) startMastery(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	if dryRun, _ := body["dryRun"].(bool); dryRun {
		httpx.Success(w, http.StatusOK, map[string]any{"action": "start-operator-mastery-campaign", "sideEffects": []string{"consume_mastery_materials", "start_training_room_training"}}, "Dry run only", nil)
		return
	}
	clientType := firstNonEmpty(stringField(body, "clientType"), "Official")
	profileID := stringField(body, "profileId")
	context := mastery.CampaignContext{ClientType: &clientType}
	if profileID != "" {
		context.ClientProfileID = &profileID
	}
	status, err := h.app.Mastery.StartCampaign(r.Context(), context)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, status, "专精队列已开始自动执行", nil)
}

func (h *Handler) pauseMastery(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	var reason *string
	if value, ok := body["reason"].(string); ok {
		reason = &value
	}
	status, err := h.app.Mastery.PauseCampaign(reason)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, status, "专精队列已暂停", nil)
}

func (h *Handler) resumeMastery(w http.ResponseWriter, r *http.Request) {
	status, err := h.app.Mastery.ResumeCampaign()
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, status, "专精队列已继续", nil)
}

func (h *Handler) stopMastery(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	status, err := h.app.Mastery.StopCampaign(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, status, "专精队列已停止", nil)
}

func (h *Handler) retryMasteryItem(w http.ResponseWriter, r *http.Request) {
	item, err := h.app.Mastery.RetryItem(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, item, "已重试专精目标", nil)
}

func intField(record map[string]any, key string) int {
	switch value := record[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	}
	return 0
}

func (h *Handler) previewOrientation(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	orientation := strings.ToLower(strings.TrimSpace(stringField(body, "orientation")))
	if orientation != "portrait" && orientation != "landscape" && orientation != "auto" {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_VALIDATION_ORIENTATION_INVALID", Message: "orientation 必须是 portrait、landscape 或 auto", Retryable: false})
		return
	}
	adbPath := firstNonEmpty(stringField(body, "adbPath"), defaultADBPath())
	address := firstNonEmpty(stringField(body, "address"), defaultADBAddress())
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

func (h *Handler) changelogCore(w http.ResponseWriter, r *http.Request) {
	h.changelog(w, r, "MaaAssistantArknights/MaaAssistantArknights")
}

func (h *Handler) changelogCLI(w http.ResponseWriter, r *http.Request) {
	h.changelog(w, r, "MaaAssistantArknights/maa-cli")
}

func (h *Handler) changelog(w http.ResponseWriter, r *http.Request, repo string) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+repo+"/releases?per_page=30", nil)
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "la-pluma-go")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		httpx.Failure(w, http.StatusBadGateway, &httpx.APIError{Code: "AGENT_CHANGELOG_FETCH_FAILED", Message: "获取更新日志失败", Retryable: true})
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		httpx.Failure(w, http.StatusBadGateway, &httpx.APIError{Code: "AGENT_CHANGELOG_FETCH_FAILED", Message: "获取更新日志失败", Retryable: true, Details: map[string]any{"status": response.StatusCode}})
		return
	}
	var releases []struct {
		TagName     string `json:"tag_name"`
		Name        string `json:"name"`
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
		HTMLURL     string `json:"html_url"`
		Prerelease  bool   `json:"prerelease"`
	}
	if err := json.NewDecoder(response.Body).Decode(&releases); err != nil {
		httpx.Failure(w, http.StatusBadGateway, &httpx.APIError{Code: "AGENT_CHANGELOG_FETCH_FAILED", Message: "更新日志格式无效", Retryable: true})
		return
	}
	out := make([]map[string]any, 0, 2)
	var stable, beta *int
	for index := range releases {
		if releases[index].Prerelease && beta == nil {
			value := index
			beta = &value
		}
		if !releases[index].Prerelease && stable == nil {
			value := index
			stable = &value
		}
	}
	for _, index := range []*int{beta, stable} {
		if index == nil {
			continue
		}
		release := releases[*index]
		out = append(out, map[string]any{"version": release.TagName, "name": release.Name, "body": release.Body, "publishedAt": release.PublishedAt, "htmlUrl": release.HTMLURL, "prerelease": release.Prerelease})
	}
	httpx.Success(w, http.StatusOK, out, "", nil)
}
