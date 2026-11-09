package agentapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	stddraw "image/draw"
	"image/png"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	xdraw "golang.org/x/image/draw"

	"github.com/mps233/la-pluma/go/internal/app"
	"github.com/mps233/la-pluma/go/internal/app/activity"
	runapp "github.com/mps233/la-pluma/go/internal/app/agentrun"
	appconfig "github.com/mps233/la-pluma/go/internal/app/config"
	"github.com/mps233/la-pluma/go/internal/app/copilot"
	maaapp "github.com/mps233/la-pluma/go/internal/app/maa"
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
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const apiVersion = "2026-07-12"

const (
	screenFrameMaxWidth = 720
	screenFrameCacheTTL = 500 * time.Millisecond
)

type Handler struct {
	app     *app.App
	logger  *slog.Logger
	handler http.Handler

	frameMu    sync.Mutex
	frameCache map[string]screenFrameCacheEntry
}

type screenFrameCacheEntry struct {
	data []byte
	at   time.Time
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
	mux.HandleFunc("GET /clipboard", handler.getClipboard)
	mux.HandleFunc("POST /clipboard", handler.setClipboard)
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
	mux.HandleFunc("GET /manifest", handler.manifest)
	mux.HandleFunc("GET /openapi.json", handler.openapi)
	handler.handler = mux
	return handler
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.handler.ServeHTTP(w, r)
}

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	connection, err := h.resolveRequestConnectionFor(r, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	slim := r.URL.Query().Get("slim")
	api := map[string]any{
		"name":     "la-pluma-agent-api",
		"version":  apiVersion,
		"manifest": "/api/agent/manifest",
		"openapi":  "/api/agent/openapi.json",
	}
	task := h.app.TaskStatus()
	schedule := h.app.Scheduler.ExecutionStatus()
	current, hasRun := h.app.CurrentRun()
	taskPayload := taskStatusPayload(h.app, task, schedule, current, hasRun)

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	var (
		versionInfo updates.MaaVersionInfo
		versionErr  error
		devices     []adb.Device
		deviceErr   error
	)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		versionInfo, versionErr = h.app.Updates.GetVersion(ctx)
	}()
	go func() {
		defer wg.Done()
		devices, deviceErr = adb.New(connection.ADBPath).Devices(ctx)
	}()
	wg.Wait()

	var maaVersion any
	if versionErr == nil {
		maaVersion = versionInfo
	}
	connected := false
	deviceList := make([]any, 0, len(devices))
	for _, device := range devices {
		if device.Serial == connection.Address && device.State == "device" {
			connected = true
		}
		deviceList = append(deviceList, map[string]any{"serial": device.Serial, "state": device.State, "model": device.Model})
	}
	connectionPayload := map[string]any{
		"adbPath":    connection.ADBPath,
		"address":    connection.Address,
		"clientType": connection.ClientType,
	}
	maa := map[string]any{"version": maaVersion, "task": taskPayload}
	if slim == "true" || slim == "1" {
		httpx.Success(w, http.StatusOK, map[string]any{
			"api":        api,
			"maa":        maa,
			"connection": connectionPayload,
		}, "", nil)
		return
	}
	recommendations := make([]string, 0, 2)
	if deviceErr != nil || !connected {
		recommendations = append(recommendations, "模拟器未连接，请检查 ADB 路径与地址")
	}
	if versionErr != nil {
		recommendations = append(recommendations, "无法读取 MAA 版本，请检查 MAA CLI 路径")
	}
	preview := h.app.WebRTC.Status()
	screen := map[string]any{
		"previewRunning": preview["serverRunning"],
		"width":          preview["width"],
		"height":         preview["height"],
	}
	if address, ok := preview["address"]; ok {
		screen["address"] = address
	}
	httpx.Success(w, http.StatusOK, map[string]any{
		"api":             api,
		"maa":             maa,
		"connection":      connectionPayload,
		"device":          map[string]any{"connected": connected, "adbPath": connection.ADBPath, "address": connection.Address, "devices": deviceList},
		"screen":          screen,
		"schedule":        schedule,
		"recentLogs":      h.app.Logs.Recent(parseBoundedInt(r.URL.Query().Get("lines"), 25, 1, 500)),
		"recommendations": recommendations,
	}, "", nil)
}

func (h *Handler) currentRun(w http.ResponseWriter, r *http.Request) {
	lines := parseBoundedInt(r.URL.Query().Get("lines"), 80, 1, 500)
	task := h.app.TaskStatus()
	schedule := h.app.Scheduler.ExecutionStatus()
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
	data := map[string]any{
		"isRunning":  task.IsRunning || schedule.IsRunning,
		"taskName":   runStatusTaskName(task, schedule, current, ok),
		"task":       taskStatusPayload(h.app, task, schedule, current, ok),
		"schedule":   schedule,
		"recentLogs": h.app.Logs.Recent(lines),
		"run":        run,
		"lastRun":    lastRun,
		"lease":      h.app.LeaseSnapshot(),
	}
	httpx.Success(w, http.StatusOK, data, "", nil)
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
	task := h.app.TaskStatus()
	schedule := h.app.Scheduler.ExecutionStatus()
	current, ok := h.app.CurrentRun()
	httpx.Success(w, http.StatusOK, taskStatusPayload(h.app, task, schedule, current, ok), "", nil)
}

func runStatusTaskName(task app.TaskStatus, schedule scheduler.ExecutionStatus, run agentrun.DTO, hasRun bool) string {
	if schedule.IsRunning && schedule.CurrentTask != nil && *schedule.CurrentTask != "" {
		return *schedule.CurrentTask
	}
	if task.TaskName != "" {
		return task.TaskName
	}
	if hasRun {
		if record, ok := run.Metadata.(map[string]any); ok {
			if name, ok := record["taskName"].(string); ok && name != "" {
				return name
			}
		}
	}
	return ""
}

func taskStatusPayload(application *app.App, task app.TaskStatus, schedule scheduler.ExecutionStatus, run agentrun.DTO, hasRun bool) map[string]any {
	var startTime int64
	if schedule.StartTime != nil {
		startTime = *schedule.StartTime
	} else if hasRun && run.StartedAt != nil {
		if parsed, err := time.Parse(time.RFC3339, *run.StartedAt); err == nil {
			startTime = parsed.UnixMilli()
		}
	}
	currentStage := ""
	if schedule.CurrentTask != nil {
		currentStage = *schedule.CurrentTask
	}
	currentStep := schedule.CurrentStep
	totalSteps := schedule.TotalSteps
	if hasRun {
		if progress, ok := run.Progress.(map[string]any); ok {
			if currentStage == "" {
				if value, ok := progress["currentStage"].(string); ok {
					currentStage = value
				}
			}
			if currentStep <= 0 {
				if _, exists := progress["currentStep"]; exists {
					currentStep = intField(progress, "currentStep")
				}
			}
			if totalSteps <= 0 {
				if _, exists := progress["totalSteps"]; exists {
					totalSteps = intField(progress, "totalSteps")
				}
			}
		}
	}
	taskType := ""
	if hasRun {
		if record, ok := run.Metadata.(map[string]any); ok {
			if value, ok := record["taskType"].(string); ok {
				taskType = value
			}
		}
	}
	stopRequested := schedule.ShouldStop || task.StopRequested
	if hasRun && run.State == agentrun.StatusStopping {
		stopRequested = true
	}
	data := map[string]any{
		"isRunning":     task.IsRunning || schedule.IsRunning,
		"taskName":      runStatusTaskName(task, schedule, run, hasRun),
		"taskType":      taskType,
		"startTime":     startTime,
		"currentStage":  currentStage,
		"currentStep":   currentStep,
		"totalSteps":    totalSteps,
		"stopRequested": stopRequested,
		"pid":           task.PID,
		"logs":          application.Logs.Recent(50),
	}
	if hasRun {
		data["runId"] = run.RunID
		data["operationId"] = run.OperationID
	}
	if schedule.ScheduleID != nil {
		data["scheduleId"] = *schedule.ScheduleID
	}
	return data
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
	ProfileID     string `json:"profileId"`
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
	connection, err := h.resolveRequestConnection(map[string]any{
		"profileId": body.ProfileID,
		"adbPath":   body.ADBPath,
		"address":   body.Address,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	request := webrtcStartRequest(body)
	if request.ADBPath == "" {
		request.ADBPath = connection.ADBPath
	}
	if request.Address == "" {
		request.Address = connection.Address
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	run, replayed, err := h.executeTrackedResult(ctx, "webrtc_start", map[string]any{
		"profileId": body.ProfileID, "adbPath": request.ADBPath, "address": request.Address, "deviceId": request.DeviceID,
	}, map[string]any{"taskName": "启动实时预览", "taskType": "preview"}, idempotencyKey(r), func(actionCtx context.Context) (any, error) {
		status, startErr := h.app.WebRTC.Start(actionCtx, request)
		if startErr != nil {
			return nil, startErr
		}
		return status, nil
	})
	if err != nil {
		if run.State == agentrun.StatusFailed || run.State == agentrun.StatusInterrupted {
			sendRunFailureResponse(w, run)
			return
		}
		writeError(w, err)
		return
	}
	status := structMap(run.Result)
	deviceID, _ := status["deviceId"].(string)
	status["protocol"] = map[string]any{
		"websocket":           "/webrtc-signaling/connect_client?token=",
		"connectMessage":      map[string]any{"message_type": "connect", "device_id": deviceID},
		"requestOfferPayload": map[string]any{"type": "request-offer", "ip_preference": "ipv4"},
		"candidatePolicy":     "relay preferred / ipv4",
	}
	sendRunResponseMessage(w, run, replayed, false, status, "WebRTC 预览已启动")
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
	connection, err := h.resolveRequestConnectionFor(r, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	devices, err := h.app.WebRTC.DevicesWithConnection(ctx, connection.ADBPath)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"devices": devices}, "", nil)
}

func (h *Handler) webrtcSnapshot(w http.ResponseWriter, r *http.Request) {
	deviceID := r.URL.Query().Get("deviceId")
	connection, err := h.resolveRequestConnectionFor(r, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	snapshot, err := h.app.WebRTC.SnapshotWithConnection(ctx, deviceID, connection.ADBPath, connection.Address)
	if err != nil {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{
			Code: "WEBRTC_SNAPSHOT_UNAVAILABLE", Message: "无法读取设备快照，请确认设备已连接",
			Retryable: true, Details: map[string]any{"deviceId": deviceID},
		})
		return
	}
	httpx.Success(w, http.StatusOK, snapshot, "", nil)
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

func parseWaitForCompletion(body map[string]any, defaultValue bool) (bool, error) {
	value, exists := body["waitForCompletion"]
	if !exists || value == nil {
		return defaultValue, nil
	}
	flag, ok := value.(bool)
	if !ok {
		return false, apperrors.Validation(
			"AGENT_VALIDATION_WAIT_FOR_COMPLETION_INVALID",
			"waitForCompletion 必须是布尔值",
			map[string]any{"receivedType": fmt.Sprintf("%T", value)},
		)
	}
	return flag, nil
}

// resolveRequestConnectionFor merges query parameters under the JSON body,
// matching resolveRequestConnection in the Node route.
func (h *Handler) resolveRequestConnectionFor(r *http.Request, body map[string]any) (appconfig.ResolvedConnection, error) {
	input := map[string]any{}
	for key, values := range r.URL.Query() {
		if len(values) > 0 {
			input[key] = values[0]
		}
	}
	for key, value := range body {
		input[key] = value
	}
	return h.resolveRequestConnection(input)
}

func (h *Handler) resolveRequestConnection(body map[string]any) (appconfig.ResolvedConnection, error) {
	profileID := appconfig.DefaultProfileName
	if value, ok := body["profileId"].(string); ok && strings.TrimSpace(value) != "" {
		profileID = strings.TrimSpace(value)
	}
	if _, err := appconfig.ValidateProfileName(profileID); err != nil {
		return appconfig.ResolvedConnection{}, apperrors.Validation(
			"AGENT_VALIDATION_PROFILE_ID_INVALID",
			"连接配置名称不合法",
			map[string]any{"profileId": profileID},
		)
	}
	profile, err := h.app.Profiles.Load(profileID)
	if err != nil {
		return appconfig.ResolvedConnection{}, err
	}
	overrides := map[string]any{}
	for _, key := range []string{"adbPath", "address", "clientType"} {
		if value, ok := body[key]; ok {
			overrides[key] = value
		}
	}
	return appconfig.ResolveConnection(profile, overrides)
}

var errTrackedActionStopped = errors.New("tracked action stopped")

func isTrackedStopError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errTrackedActionStopped) || errors.Is(err, context.Canceled) {
		return true
	}
	if appErr, ok := apperrors.As(err); ok {
		if appErr.Code == "COPILOT_PLAN_STOPPED" {
			return true
		}
		if stopped, _ := appErr.Details["stopped"].(bool); stopped {
			return true
		}
	}
	return false
}

// executeTrackedResult runs a short, synchronous side effect under the shared
// Agent run lifecycle.
func (h *Handler) executeTrackedResult(ctx context.Context, operationID string, input, metadata any, idem *string, action func(context.Context) (any, error)) (agentrun.DTO, bool, error) {
	return h.executeTrackedOperation(ctx, operationID, input, metadata, idem, action)
}

// executeTrackedOperation wraps a long action in one durable Agent run. MAA
// commands invoked by the action attach to this run through the context
// parent, so the stop endpoint and polling see one run id.
func (h *Handler) executeTrackedOperation(ctx context.Context, operationID string, input, metadata any, idem *string, action func(context.Context) (any, error)) (agentrun.DTO, bool, error) {
	run, replayed, err := h.app.Runs.Begin(runapp.BeginInput{
		OperationID:    operationID,
		IdempotencyKey: idem,
		Input:          input,
		Metadata:       metadata,
	})
	if err != nil {
		return agentrun.DTO{}, false, err
	}
	if replayed {
		return run, true, nil
	}
	if _, err := h.app.Runs.StartForExecution(run.RunID); err != nil {
		failed, _ := h.app.Runs.Fail(run.RunID, err)
		return failed, false, err
	}
	actionCtx := runapp.WithParentRun(ctx, run.RunID)
	result, actionErr := action(actionCtx)

	current, ok := h.app.Runs.Get(run.RunID)
	if !ok {
		current = run
	}
	if current.State.Terminal() {
		if current.State == agentrun.StatusStopped {
			return current, false, nil
		}
		return current, false, runFailureError(current)
	}
	if actionErr != nil {
		if isTrackedStopError(actionErr) || current.State == agentrun.StatusStopping {
			stopped, stopErr := h.app.Runs.Stop(run.RunID, map[string]any{"message": actionErr.Error()})
			if stopErr != nil {
				return agentrun.DTO{}, false, stopErr
			}
			return stopped, false, nil
		}
		failed, _ := h.app.Runs.Fail(run.RunID, actionErr)
		return failed, false, actionErr
	}
	if current.State == agentrun.StatusStopping {
		stopped, stopErr := h.app.Runs.Stop(run.RunID, result)
		if stopErr != nil {
			return agentrun.DTO{}, false, stopErr
		}
		return stopped, false, nil
	}
	completed, err := h.app.Runs.Complete(run.RunID, result)
	if err != nil {
		return agentrun.DTO{}, false, err
	}
	return completed, false, nil
}

func runFailureError(run agentrun.DTO) error {
	if run.Error != nil {
		return apperrors.WithStatus(run.Error.Code, run.Error.Message, run.Error.StatusCode, run.Error.Retryable, run.Error.Details)
	}
	return apperrors.New("AGENT_RUN_FAILED", "Agent run 执行失败")
}

type fightStage struct {
	Stage string
	Times string
}

func normalizeFightStages(body map[string]any) []fightStage {
	raw := []any{}
	fallback := []any{map[string]any{"stage": body["stage"], "times": body["times"]}}
	if value, ok := body["stages"]; ok && value != nil {
		if array, ok := value.([]any); ok {
			raw = array
		} else {
			raw = fallback
		}
	} else {
		raw = fallback
	}
	stages := make([]fightStage, 0, len(raw))
	for _, item := range raw {
		switch typed := item.(type) {
		case string:
			stage := strings.TrimSpace(typed)
			if stage != "" {
				stages = append(stages, fightStage{Stage: stage})
			}
		case map[string]any:
			stage, _ := typed["stage"].(string)
			stage = strings.TrimSpace(stage)
			if stage == "" {
				continue
			}
			times := ""
			if value, ok := typed["times"]; ok && value != nil {
				times = scalarText(value)
			}
			stages = append(stages, fightStage{Stage: stage, Times: times})
		}
	}
	return stages
}

func scalarText(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case json.Number:
		return typed.String()
	default:
		return fmt.Sprint(value)
	}
}

func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed, err == nil
	}
	return 0, false
}

var activityStageAliasPattern = regexp.MustCompile(`(?i)^hd-(\d+)$`)

func (h *Handler) replaceActivityStage(stage, clientType string) string {
	match := activityStageAliasPattern.FindStringSubmatch(strings.TrimSpace(stage))
	if len(match) != 2 {
		return stage
	}
	info, err := h.app.Activity.GetStageActivityInfo(context.Background(), clientType, time.Now())
	if err != nil || info == nil || strings.TrimSpace(info.Code) == "" {
		return stage
	}
	return strings.TrimSpace(info.Code) + "-" + match[1]
}

var agentTaskCommandList = []string{
	"startup", "closedown", "fight", "infrast", "recruit", "mall", "award",
	"copilot", "ssscopilot", "paradoxcopilot", "roguelike", "reclamation",
	"depot", "operbox", "activity", "run", "list",
}

var agentTaskCommandSet = stringSet(agentTaskCommandList)

var agentQueryCommandSet = stringSet([]string{"activity", "list"})

func stringSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func normalizeTaskArgs(value any) ([]string, error) {
	if value == nil {
		return nil, nil
	}
	array, ok := value.([]any)
	if !ok {
		return nil, apperrors.Validation(
			"AGENT_VALIDATION_ARGS_INVALID",
			"args 必须是数组",
			map[string]any{"receivedType": fmt.Sprintf("%T", value)},
		)
	}
	args := make([]string, 0, len(array))
	for _, item := range array {
		args = append(args, scalarText(item))
	}
	return args, nil
}

var fightDropIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func normalizeFightDrops(value any) (map[string]any, error) {
	if value == nil || value == "" {
		return nil, nil
	}
	result := map[string]any{}
	if record, ok := value.(map[string]any); ok {
		for itemID, rawCount := range record {
			count, valid := numberValue(rawCount)
			if !fightDropIDPattern.MatchString(itemID) || !valid || count <= 0 {
				return nil, apperrors.Validation("AGENT_VALIDATION_DROPS_INVALID", "掉落目标格式应为物品 ID=数量，多个目标用逗号分隔", nil)
			}
			result[itemID] = count
		}
		if len(result) == 0 {
			return nil, nil
		}
		return result, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, apperrors.Validation("AGENT_VALIDATION_DROPS_INVALID", "掉落目标格式应为物品 ID=数量，多个目标用逗号分隔", nil)
	}
	for _, entry := range strings.Split(text, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		parts := strings.SplitN(entry, "=", 2)
		if len(parts) != 2 {
			return nil, apperrors.Validation("AGENT_VALIDATION_DROPS_INVALID", "掉落目标格式应为物品 ID=数量，多个目标用逗号分隔", nil)
		}
		itemID := strings.TrimSpace(parts[0])
		count, valid := numberValue(strings.TrimSpace(parts[1]))
		if !fightDropIDPattern.MatchString(itemID) || !valid || count <= 0 {
			return nil, apperrors.Validation("AGENT_VALIDATION_DROPS_INVALID", "掉落目标格式应为物品 ID=数量，多个目标用逗号分隔", nil)
		}
		result[itemID] = count
	}
	if len(result) == 0 {
		return nil, nil
	}
	return result, nil
}

func buildDynamicFightTask(body map[string]any, stages []fightStage, connection appconfig.ResolvedConnection) (map[string]any, error) {
	common := map[string]any{}
	for _, mapping := range []struct{ from, to string }{
		{"medicine", "medicine"},
		{"medicineExpireDays", "medicine_expire_days"},
		{"expiringMedicine", "expiring_medicine"},
		{"stone", "stone"},
		{"series", "series"},
	} {
		raw, exists := body[mapping.from]
		if !exists || raw == nil || raw == "" {
			continue
		}
		if number, ok := numberValue(raw); ok {
			common[mapping.to] = number
		}
	}
	drops, err := normalizeFightDrops(body["drops"])
	if err != nil {
		return nil, err
	}
	if drops != nil {
		common["drops"] = drops
	}
	if server, ok := body["server"].(string); ok && strings.TrimSpace(server) != "" {
		common["server"] = strings.TrimSpace(server)
	}
	for _, mapping := range []struct{ from, to string }{
		{"DrGrandet", "DrGrandet"},
		{"reportToPenguin", "report_to_penguin"},
		{"reportToYituliu", "report_to_yituliu"},
	} {
		if value, ok := body[mapping.from].(bool); ok {
			common[mapping.to] = value
		}
	}
	for _, mapping := range []struct{ from, to string }{
		{"penguinId", "penguin_id"},
		{"yituliuId", "yituliu_id"},
	} {
		if value, ok := body[mapping.from].(string); ok && strings.TrimSpace(value) != "" {
			common[mapping.to] = strings.TrimSpace(value)
		}
	}

	tasks := make([]any, 0, len(stages))
	for _, stage := range stages {
		params := map[string]any{"stage": stage.Stage}
		for key, value := range common {
			params[key] = value
		}
		if stage.Times != "" {
			if number, ok := numberValue(stage.Times); ok {
				params["times"] = number
			}
		}
		tasks = append(tasks, map[string]any{
			"name":   "Agent: 理智作战 (" + stage.Stage + ")",
			"type":   "Fight",
			"params": params,
		})
	}
	task := map[string]any{
		"name":  "Agent: 理智作战",
		"type":  "Fight",
		"tasks": tasks,
	}
	if connection.ClientType != "" {
		task["client_type"] = connection.ClientType
	}
	return task, nil
}

func buildFightPlan(body map[string]any, stages []fightStage, taskConfig map[string]any, connection appconfig.ResolvedConnection) map[string]any {
	semanticStages := make([]any, 0, len(stages))
	for _, stage := range stages {
		semanticStages = append(semanticStages, map[string]any{"stage": stage.Stage, "times": stage.Times})
	}
	semantic := map[string]any{
		"stages":     semanticStages,
		"medicine":   body["medicine"],
		"stone":      body["stone"],
		"series":     body["series"],
		"drops":      body["drops"],
		"clientType": connection.ClientType,
		"server":     body["server"],
	}
	if value, ok := body["medicineExpireDays"]; ok {
		semantic["medicineExpireDays"] = value
	}
	if value, ok := body["expiringMedicine"]; ok {
		semantic["expiringMedicine"] = value
	}
	return map[string]any{
		"command":    "run",
		"taskConfig": taskConfig,
		"semantic":   semantic,
	}
}

func structMap(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	data, err := json.Marshal(value)
	if err != nil {
		return map[string]any{}
	}
	var record map[string]any
	if err := json.Unmarshal(data, &record); err != nil {
		return map[string]any{}
	}
	return record
}

func (h *Handler) startGame(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	wait, err := parseWaitForCompletion(body, true)
	if err != nil {
		writeError(w, err)
		return
	}
	connection, err := h.resolveRequestConnection(body)
	if err != nil {
		writeError(w, err)
		return
	}
	accountName := stringField(body, "accountName")
	startGameEnabled := true
	if value, ok := body["startGameEnabled"].(bool); ok {
		startGameEnabled = value
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	run, replayed, err := h.app.MAAServiceService().StartGameWithOptions(ctx, maaapp.StartGameOptions{
		ClientType:       connection.ClientType,
		Address:          connection.Address,
		AccountName:      accountName,
		StartGameEnabled: startGameEnabled,
		Wait:             wait,
		IdempotencyKey:   idempotencyKey(r),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	sendRunResponse(w, run, replayed, !wait, map[string]any{
		"action":           "start-game",
		"clientType":       connection.ClientType,
		"address":          connection.Address,
		"accountName":      accountName,
		"startGameEnabled": startGameEnabled,
	})
}

func (h *Handler) runTask(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	wait, err := parseWaitForCompletion(body, true)
	if err != nil {
		writeError(w, err)
		return
	}
	connection, err := h.resolveRequestConnection(body)
	if err != nil {
		writeError(w, err)
		return
	}
	taskConfig, hasTaskConfig := body["taskConfig"]
	if hasTaskConfig && taskConfig != nil {
		if text, ok := taskConfig.(string); ok {
			var parsed any
			if err := json.Unmarshal([]byte(text), &parsed); err == nil {
				taskConfig = parsed
			}
		}
		if record, ok := taskConfig.(map[string]any); ok {
			if _, exists := record["client_type"]; !exists {
				record["client_type"] = connection.ClientType
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
		defer cancel()
		run, replayed, err := h.app.MAAServiceService().RunTaskWithOptions(ctx, taskConfig, wait, idempotencyKey(r), maaapp.RunTaskOptions{
			Address: connection.Address,
		})
		if err != nil {
			writeError(w, err)
			return
		}
		sendRunResponse(w, run, replayed, !wait, nil)
		return
	}

	command := strings.TrimSpace(stringField(body, "command"))
	if _, allowed := agentTaskCommandSet[command]; !allowed {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{
			Code:      "AGENT_VALIDATION_COMMAND_NOT_ALLOWED",
			Message:   "不允许的 command: " + command,
			Retryable: false,
			Details:   map[string]any{"command": command, "allowed": agentTaskCommandList},
		})
		return
	}
	args, err := normalizeTaskArgs(body["args"])
	if err != nil {
		writeError(w, err)
		return
	}
	if _, query := agentQueryCommandSet[command]; query {
		wait = true
	}
	taskName := stringField(body, "taskName")
	if taskName == "" {
		taskName = "Agent: " + command
	}
	taskType := stringField(body, "taskType")
	if taskType == "" {
		taskType = "agent"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	run, replayed, err := h.app.MAAServiceService().Run(ctx, maaapp.RunRequest{
		OperationID:    "run_task",
		Command:        command,
		Args:           args,
		TaskName:       taskName,
		TaskType:       taskType,
		Wait:           wait,
		Input:          body,
		Metadata:       map[string]any{"taskName": taskName, "taskType": taskType},
		IdempotencyKey: idempotencyKey(r),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	sendRunResponse(w, run, replayed, !wait, nil)
}

func (h *Handler) fight(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	wait, err := parseWaitForCompletion(body, true)
	if err != nil {
		writeError(w, err)
		return
	}
	connection, err := h.resolveRequestConnection(body)
	if err != nil {
		writeError(w, err)
		return
	}
	stages := normalizeFightStages(body)
	for index := range stages {
		stages[index].Stage = h.replaceActivityStage(stages[index].Stage, connection.ClientType)
	}
	if len(stages) == 0 {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{
			Code:      "AGENT_VALIDATION_MISSING_STAGES",
			Message:   "至少需要一个有效关卡",
			Retryable: false,
			Details:   map[string]any{"fightOptions": body},
		})
		return
	}
	taskConfig, err := buildDynamicFightTask(body, stages, connection)
	if err != nil {
		writeError(w, err)
		return
	}
	plan := buildFightPlan(body, stages, taskConfig, connection)
	if dryRun, _ := body["dryRun"].(bool); dryRun {
		httpx.Success(w, http.StatusOK, map[string]any{"plan": plan}, "Dry run only", map[string]any{"dryRun": true})
		return
	}
	effectiveWait := wait
	if len(stages) > 1 {
		effectiveWait = true
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	run, replayed, err := h.app.MAAServiceService().RunTaskWithOptions(ctx, taskConfig, effectiveWait, idempotencyKey(r), maaapp.RunTaskOptions{
		Address: connection.Address,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	sendRunResponse(w, run, replayed, !effectiveWait, map[string]any{"plan": plan})
}

func (h *Handler) stopActions(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	requestedRunID := strings.TrimSpace(stringField(body, "runId"))
	stopOperationID := ""
	if requestedRunID != "" {
		requested, ok := h.app.Runs.Get(requestedRunID)
		if !ok {
			writeError(w, apperrors.WithStatus("AGENT_RUN_NOT_FOUND", "未找到 Agent run: "+requestedRunID, http.StatusNotFound, false, map[string]any{"runId": requestedRunID}))
			return
		}
		if requested.State.Terminal() {
			if requested.OperationID == "webrtc_start" {
				if running, _ := h.app.WebRTC.Status()["serverRunning"].(bool); running {
					if stopErr := h.app.WebRTC.Stop(ctx); stopErr == nil {
						httpx.Success(w, http.StatusOK, map[string]any{"stopped": true, "webrtcStopped": true, "run": requested}, "实时预览已停止", nil)
						return
					}
				}
			}
			httpx.Success(w, http.StatusOK, map[string]any{"stopped": false, "alreadyTerminal": true, "run": requested}, "任务已经结束", nil)
			return
		}
		if requested.State == agentrun.StatusWaiting {
			if stopped, ok := h.app.Copilot.Manual().StopManualSetRun(requestedRunID); ok {
				updated, stopErr := h.app.Runs.Stop(requestedRunID, stopped)
				if stopErr != nil {
					writeError(w, stopErr)
					return
				}
				httpx.Success(w, http.StatusOK, map[string]any{"stopped": true, "run": updated}, "手动作业集已停止", nil)
				return
			}
		}
		stopOperationID = requested.OperationID
		if requested.State == agentrun.StatusAccepted {
			writeError(w, apperrors.WithStatus("AGENT_RUN_NOT_STARTED", "目标 run 尚未获得执行权，未发送终止命令", http.StatusConflict, true, map[string]any{"requestedRunId": requestedRunID, "state": requested.State}))
			return
		}
		current, hasCurrent := h.app.Runs.Current()
		if !hasCurrent || current.RunID != requestedRunID {
			details := map[string]any{"requestedRunId": requestedRunID}
			if hasCurrent {
				details["currentRunId"] = current.RunID
			}
			writeError(w, apperrors.WithStatus("AGENT_RUN_NOT_CURRENT", "目标 run 不是当前执行，未发送终止命令", http.StatusConflict, false, details))
			return
		}
	}

	if stopOperationID == "" {
		if current, ok := h.app.Runs.Current(); ok {
			stopOperationID = current.OperationID
		}
	}
	outcome := h.app.MAAServiceService().StopCurrent(ctx)
	scheduleStopped := h.app.Scheduler.Stop(ctx)
	webrtcStopped := false
	if stopOperationID == "webrtc_start" {
		if err := h.app.WebRTC.Stop(ctx); err == nil {
			webrtcStopped = true
		}
	}
	stopRequested := outcome.Success || scheduleStopped || webrtcStopped

	var run any
	if requestedRunID != "" {
		if requested, ok := h.app.Runs.Get(requestedRunID); ok {
			run = requested
		}
	} else if current, ok := h.app.Runs.Current(); ok {
		run = current
	}

	data := map[string]any{
		"task":            map[string]any{"success": outcome.Success, "message": outcome.Message},
		"scheduleStopped": scheduleStopped,
		"webrtcStopped":   webrtcStopped,
		"stopRequested":   stopRequested,
		"run":             run,
	}
	message := "当前没有可终止的任务"
	if stopRequested {
		message = "已发送终止请求"
	}
	httpx.Success(w, http.StatusOK, data, message, nil)
}

func sendRunResponse(w http.ResponseWriter, run agentrun.DTO, replayed bool, accepted bool, extra map[string]any) {
	message := "操作成功"
	if accepted {
		message = "任务已接受"
	}
	sendRunResponseMessage(w, run, replayed, accepted, extra, message)
}

func sendRunResponseMessage(w http.ResponseWriter, run agentrun.DTO, replayed bool, accepted bool, extra map[string]any, message string) {
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
	if accepted {
		status = http.StatusAccepted
	}
	httpx.Success(w, status, data, message, map[string]any{"runId": run.RunID, "idempotentReplay": replayed})
}

func sendTrackedRunResponse(w http.ResponseWriter, run agentrun.DTO, replayed bool, message string) {
	if run.State == agentrun.StatusFailed || run.State == agentrun.StatusInterrupted {
		sendRunFailureResponse(w, run)
		return
	}
	if run.State == agentrun.StatusStopped {
		message = "任务已终止"
	}
	sendRunResponseMessage(w, run, replayed, false, structMap(run.Result), message)
}

func sendRunFailureResponse(w http.ResponseWriter, run agentrun.DTO) {
	code := "AGENT_RUN_FAILED"
	message := "Agent run 执行失败"
	status := http.StatusInternalServerError
	retryable := false
	details := map[string]any{}
	if run.Error != nil {
		code = firstNonEmpty(run.Error.Code, code)
		message = firstNonEmpty(run.Error.Message, message)
		if run.Error.StatusCode > 0 {
			status = run.Error.StatusCode
		}
		retryable = run.Error.Retryable
		for key, value := range run.Error.Details {
			details[key] = value
		}
	}
	details["runId"] = run.RunID
	details["run"] = run
	w.Header().Set("X-La-Pluma-Run-Id", run.RunID)
	httpx.Failure(w, status, &httpx.APIError{Code: code, Message: message, Retryable: retryable, Details: details})
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
	if err := h.app.ConfigureTelegramBot(r.Context(), config); err != nil {
		h.logger.Warn("Telegram Bot 重载失败", "error", err)
	}
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
	value := h.app.Training.TodayOpenStages(clientType, h.app.Training.ResourceCollectionOpen(clientType))
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

func dailyFlowError(result scheduler.DailyFlowResult, fallbackCode string) error {
	code := fallbackCode
	status := http.StatusBadRequest
	retryable := false
	if result.Busy {
		code = "AGENT_SCHEDULE_ALREADY_RUNNING"
		status = http.StatusConflict
		retryable = true
	}
	return apperrors.WithStatus(code, firstNonEmpty(result.Message, "任务流程执行失败"), status, retryable, map[string]any{
		"scheduleId": result.ScheduleID,
		"owner":      result.Owner,
	})
}

func (h *Handler) resolveAutomationTaskFlow(requested any) (any, error) {
	if requested != nil {
		if _, ok := requested.([]any); !ok {
			return nil, apperrors.Validation("AGENT_VALIDATION_TASK_FLOW_INVALID", "任务流程格式无效", nil)
		}
		return requested, nil
	}
	value, err := h.app.ConfigStore.Load("automation-tasks")
	if err != nil {
		return nil, err
	}
	if flow, ok := value["taskFlow"]; ok && flow != nil {
		return flow, nil
	}
	return nil, apperrors.Validation("AGENT_VALIDATION_EMPTY_TASK_FLOW", "没有可执行的自动化任务", nil)
}

func (h *Handler) executeSchedule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TaskFlow any `json:"taskFlow"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if _, ok := body.TaskFlow.([]any); !ok {
		writeError(w, apperrors.Validation("AGENT_VALIDATION_TASK_FLOW_INVALID", "任务流程格式无效", nil))
		return
	}
	scheduleID := r.PathValue("scheduleId")
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Hour)
	defer cancel()
	run, replayed, err := h.executeTrackedOperation(ctx, "execute_schedule", map[string]any{
		"scheduleId": scheduleID,
		"taskFlow":   body.TaskFlow,
	}, map[string]any{"taskName": "定时任务 " + scheduleID, "taskType": "schedule"}, idempotencyKey(r), func(actionCtx context.Context) (any, error) {
		result := h.app.Scheduler.StartDailyFlow(actionCtx, scheduler.DailyFlowRequest{
			ScheduleID: scheduleID,
			TaskFlow:   body.TaskFlow,
		})
		if !result.Success {
			return nil, dailyFlowError(result, "AGENT_SCHEDULE_EXECUTE_FAILED")
		}
		if result.Stopped {
			return nil, errTrackedActionStopped
		}
		return structMap(result), nil
	})
	if err != nil {
		if run.State == agentrun.StatusFailed || run.State == agentrun.StatusInterrupted {
			sendRunFailureResponse(w, run)
			return
		}
		writeError(w, err)
		return
	}
	sendTrackedRunResponse(w, run, replayed, "定时任务执行完成")
}

func (h *Handler) runDailyFlow(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ScheduleID string `json:"scheduleId"`
		TaskFlow   any    `json:"taskFlow"`
		DryRun     bool   `json:"dryRun"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	scheduleID := strings.TrimSpace(body.ScheduleID)
	if scheduleID == "" {
		scheduleID = "default"
	}
	taskFlow, err := h.resolveAutomationTaskFlow(body.TaskFlow)
	if err != nil {
		writeError(w, err)
		return
	}
	if body.DryRun {
		result := h.app.Scheduler.StartDailyFlow(r.Context(), scheduler.DailyFlowRequest{
			ScheduleID: scheduleID,
			TaskFlow:   taskFlow,
			DryRun:     true,
		})
		if !result.Success {
			httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_DAILY_FLOW_FAILED", Message: result.Message, Retryable: false})
			return
		}
		httpx.Success(w, http.StatusOK, result, result.Message, map[string]any{"dryRun": true})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Hour)
	defer cancel()
	run, replayed, err := h.executeTrackedOperation(ctx, "run_daily_flow", map[string]any{
		"scheduleId": scheduleID,
		"taskFlow":   taskFlow,
	}, map[string]any{"taskName": "今日流程 " + scheduleID, "taskType": "schedule"}, idempotencyKey(r), func(actionCtx context.Context) (any, error) {
		result := h.app.Scheduler.StartDailyFlow(actionCtx, scheduler.DailyFlowRequest{
			ScheduleID: scheduleID,
			TaskFlow:   taskFlow,
		})
		if !result.Success {
			return nil, dailyFlowError(result, "AGENT_DAILY_FLOW_REJECTED")
		}
		if result.Stopped {
			return nil, errTrackedActionStopped
		}
		return structMap(result), nil
	})
	if err != nil {
		if run.State == agentrun.StatusFailed || run.State == agentrun.StatusInterrupted {
			sendRunFailureResponse(w, run)
			return
		}
		writeError(w, err)
		return
	}
	sendTrackedRunResponse(w, run, replayed, "今日流程执行完成")
}

func (h *Handler) getCopilot(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	value, err := h.app.Copilot.PRTS().GetCopilotRaw(ctx, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) getCopilotSet(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	value, err := h.app.Copilot.PRTS().GetSetRaw(ctx, r.PathValue("id"))
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

var copilotTitleStagePattern = regexp.MustCompile(`^([A-Z]{2,4}-\d+[A-Z]?)`)

func (h *Handler) resolveStageSearchKeyword(stage string) string {
	record, ok, err := h.app.Copilot.Resource().StageByCode(stage)
	if err != nil || !ok {
		return stage
	}
	stageID, _ := record["stageId"].(string)
	stageID = strings.ReplaceAll(stageID, "#f#", "")
	stageID = strings.ReplaceAll(stageID, "#n#", "")
	if strings.TrimSpace(stageID) == "" {
		return stage
	}
	return stageID
}

func parseCopilotSearchItem(item any) map[string]any {
	record, _ := item.(map[string]any)
	if record == nil {
		return nil
	}
	title := "无标题"
	stageName := ""
	if doc, ok := record["doc"].(map[string]any); ok {
		if value, ok := doc["title"].(string); ok && value != "" {
			title = value
		}
	}
	if contentText, ok := record["content"].(string); ok && contentText != "" {
		var content map[string]any
		if json.Unmarshal([]byte(contentText), &content) == nil {
			if doc, ok := content["doc"].(map[string]any); ok {
				if value, ok := doc["title"].(string); ok && value != "" {
					title = value
				}
			}
			if value, ok := content["stage_name"].(string); ok {
				stageName = value
			}
		}
	}
	id := record["id"]
	return map[string]any{
		"id":        id,
		"uri":       "prts://" + fmt.Sprint(id),
		"views":     record["views"],
		"hotScore":  record["hot_score"],
		"uploader":  record["uploader_id"],
		"title":     title,
		"stageName": stageName,
	}
}

func (h *Handler) searchCopilots(w http.ResponseWriter, r *http.Request) {
	stage := strings.TrimSpace(r.URL.Query().Get("stage"))
	if stage == "" {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_VALIDATION_STAGE_REQUIRED", Message: "缺少 stage 参数", Retryable: false})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	searchKeyword := h.resolveStageSearchKeyword(stage)
	normalizedStage := strings.ToUpper(stage)
	normalizedKeyword := strings.ToUpper(searchKeyword)
	copilots := make([]map[string]any, 0, 10)
	for page := 1; page <= 5 && len(copilots) < 10; page++ {
		items, err := h.app.Copilot.PRTS().QueryCopilots(ctx, searchKeyword, page, 50, "hot")
		if err != nil {
			writeError(w, err)
			return
		}
		if len(items) == 0 {
			break
		}
		for _, item := range items {
			parsed := parseCopilotSearchItem(item)
			if parsed == nil {
				continue
			}
			stageName := strings.ToUpper(strings.TrimSpace(stringField(parsed, "stageName")))
			if stageName == "" {
				stageName = normalizedStage
			}
			title := stringField(parsed, "title")
			titleCode := copilotTitleStagePattern.FindString(strings.ToUpper(title))
			if stageName == normalizedStage || stageName == normalizedKeyword || titleCode == normalizedStage {
				copilots = append(copilots, parsed)
				if len(copilots) >= 10 {
					break
				}
			}
		}
	}
	if len(copilots) == 0 {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{Code: "AGENT_COPILOT_NOT_FOUND", Message: fmt.Sprintf("未找到关卡%q的作业", stage), Retryable: false, Details: map[string]any{"stage": stage, "searchKeyword": searchKeyword}})
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"stage": stage, "copilots": copilots, "recommended": copilots[0]}, "", nil)
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
	connection, err := h.resolveRequestConnectionFor(r, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	stats, err := h.app.WebRTC.DeviceStatsWithConnection(ctx, connection.ADBPath, connection.Address)
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
	infoMap := structMap(info)
	infoMap["completion"] = h.app.Activity.GetActivityCompletion(ctx, infoMap)
	infoMap["available"] = info.Code != nil && *info.Code != ""
	httpx.Success(w, http.StatusOK, infoMap, "", nil)
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
	connection, err := h.resolveRequestConnection(body)
	if err != nil {
		writeError(w, err)
		return
	}
	adbPath := firstNonEmpty(stringField(body, "adbPath"), connection.ADBPath)
	address := firstNonEmpty(stringField(body, "address"), connection.Address)
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
	connection, err := h.resolveRequestConnectionFor(r, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	adbPath := firstNonEmpty(r.URL.Query().Get("adbPath"), connection.ADBPath)
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

func (h *Handler) openConfigDirectory(w http.ResponseWriter, r *http.Request) {
	dir := h.app.Config().Paths.MaaConfigDir
	var command string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		command, args = "open", []string{dir}
	case "windows":
		command, args = "explorer", []string{dir}
	default:
		command, args = "xdg-open", []string{dir}
	}
	if err := exec.Command(command, args...).Start(); err != nil {
		httpx.Failure(w, http.StatusInternalServerError, &httpx.APIError{
			Code: "AGENT_OPEN_CONFIG_DIRECTORY_FAILED", Message: "无法打开配置目录", Retryable: false, Details: map[string]any{"path": dir, "error": err.Error()},
		})
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"path": dir}, "配置目录已打开", nil)
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

func recognitionFailure(err error, code, message string) error {
	if _, ok := apperrors.As(err); ok {
		return err
	}
	return apperrors.WithStatus(code, message, http.StatusInternalServerError, false, map[string]any{"error": err.Error()})
}

func (h *Handler) depotRecognition(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	plan := map[string]any{"action": "depot-recognition", "sideEffects": []string{"parse_maa_logs", "update_local_depot_cache"}}
	if dryRun, _ := body["dryRun"].(bool); dryRun {
		httpx.Success(w, http.StatusOK, map[string]any{"plan": plan}, "Dry run only", map[string]any{"dryRun": true})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	run, replayed, err := h.executeTrackedResult(ctx, "depot_recognition", map[string]any{"action": "depot-recognition"}, map[string]any{"taskName": "仓库识别", "taskType": "statistics"}, idempotencyKey(r), func(ctx context.Context) (any, error) {
		result, err := h.app.Recognition.RecognizeDepot(ctx)
		if err != nil {
			return nil, recognitionFailure(err, "AGENT_DEPOT_RECOGNITION_FAILED", "仓库识别失败")
		}
		return structMap(result.Data), nil
	})
	if err != nil {
		writeError(w, err)
		return
	}
	sendRunResponse(w, run, replayed, false, structMap(run.Result))
}

func (h *Handler) operboxRecognition(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	plan := map[string]any{"action": "operbox-recognition", "sideEffects": []string{"parse_maa_logs", "update_local_operbox_cache"}}
	if dryRun, _ := body["dryRun"].(bool); dryRun {
		httpx.Success(w, http.StatusOK, map[string]any{"plan": plan}, "Dry run only", map[string]any{"dryRun": true})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	run, replayed, err := h.executeTrackedResult(ctx, "operbox_recognition", map[string]any{"action": "operbox-recognition"}, map[string]any{"taskName": "干员识别", "taskType": "statistics"}, idempotencyKey(r), func(ctx context.Context) (any, error) {
		result, err := h.app.Recognition.RecognizeOperBox(ctx)
		if err != nil {
			return nil, recognitionFailure(err, "AGENT_OPERBOX_RECOGNITION_FAILED", "干员识别失败")
		}
		return structMap(result.Data), nil
	})
	if err != nil {
		writeError(w, err)
		return
	}
	sendRunResponse(w, run, replayed, false, structMap(run.Result))
}

func (h *Handler) copilotUnsupported(w http.ResponseWriter, r *http.Request) {
	httpx.Failure(w, http.StatusNotImplemented, &httpx.APIError{
		Code: "COPILOT_EXECUTION_UNSUPPORTED", Message: "作业执行尚未接入 Go 后端",
		Retryable: false, Details: map[string]any{"todo": "wire copilot PlanExecutor"},
	})
}

func (h *Handler) updateCore(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	version := firstNonEmpty(stringField(body, "version"), "current")
	dryRun, _ := body["dryRun"].(bool)
	if dryRun {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
		defer cancel()
		outcome, err := h.app.Updates.UpdateCoreAction(ctx, version, true)
		if err != nil {
			writeError(w, err)
			return
		}
		httpx.Success(w, http.StatusOK, outcome.Data, outcome.Message, map[string]any{"dryRun": true})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	run, replayed, err := h.executeTrackedOperation(ctx, "update_core", map[string]any{"version": version}, map[string]any{"taskName": "更新 MaaCore 与资源", "taskType": "maintenance"}, idempotencyKey(r), func(actionCtx context.Context) (any, error) {
		outcome, runErr := h.app.Updates.UpdateCoreAction(actionCtx, version, false)
		if runErr != nil {
			return nil, runErr
		}
		return structMap(outcome.Data), nil
	})
	if err != nil {
		if run.State == agentrun.StatusFailed || run.State == agentrun.StatusInterrupted {
			sendRunFailureResponse(w, run)
			return
		}
		writeError(w, err)
		return
	}
	sendTrackedRunResponse(w, run, replayed, "更新 MaaCore 与资源完成")
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
	if dryRun {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
		defer cancel()
		outcome, err := h.app.Updates.HotUpdateResourcesAction(ctx, true)
		if err != nil {
			writeError(w, err)
			return
		}
		httpx.Success(w, http.StatusOK, outcome.Data, outcome.Message, map[string]any{"dryRun": true})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	run, replayed, err := h.executeTrackedOperation(ctx, "hot_update_resources", map[string]any{"action": "hot-update"}, map[string]any{"taskName": "同步 MAA 资源", "taskType": "maintenance"}, idempotencyKey(r), func(actionCtx context.Context) (any, error) {
		outcome, runErr := h.app.Updates.HotUpdateResourcesAction(actionCtx, false)
		if runErr != nil {
			return nil, runErr
		}
		return structMap(outcome.Data), nil
	})
	if err != nil {
		if run.State == agentrun.StatusFailed || run.State == agentrun.StatusInterrupted {
			sendRunFailureResponse(w, run)
			return
		}
		writeError(w, err)
		return
	}
	sendTrackedRunResponse(w, run, replayed, "资源更新完成")
}

func (h *Handler) logFiles(w http.ResponseWriter, r *http.Request) {
	dir := filepath.Join(h.app.Config().Paths.MaaStateDir, "debug")
	files := make([]map[string]any, 0)
	_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() || !strings.HasSuffix(info.Name(), ".log") {
			return nil
		}
		files = append(files, map[string]any{
			"name":     info.Name(),
			"path":     path,
			"size":     info.Size(),
			"modified": info.ModTime().UTC().Format(time.RFC3339),
		})
		return nil
	})
	sort.Slice(files, func(i, j int) bool {
		left, _ := files[i]["modified"].(string)
		right, _ := files[j]["modified"].(string)
		return left > right
	})
	httpx.Success(w, http.StatusOK, files, "", nil)
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
	type logFile struct {
		path    string
		size    int64
		modTime time.Time
	}
	files := make([]logFile, 0)
	var total int64
	_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() || !strings.HasSuffix(info.Name(), ".log") {
			return nil
		}
		files = append(files, logFile{path: path, size: info.Size(), modTime: info.ModTime()})
		total += info.Size()
		return nil
	})
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
	connection, err := h.resolveRequestConnection(body)
	if err != nil {
		writeError(w, err)
		return
	}
	clientType := firstNonEmpty(stringField(body, "clientType"), connection.ClientType)
	options := mapField(body["options"])
	if _, exists := options["address"]; !exists && connection.Address != "" {
		options["address"] = connection.Address
	}
	setID := stringField(body, "setId")
	selectedIndexes := intSlice(body["selectedIndexes"])
	raid := firstNonEmpty(stringField(body, "raid"), "normal")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	run, replayed, err := h.executeTrackedOperation(ctx, "run_current_activity_copilots", map[string]any{
		"clientType":      clientType,
		"setId":           setID,
		"selectedIndexes": selectedIndexes,
		"raid":            raid,
		"options":         options,
	}, map[string]any{"taskName": "当前活动作业", "taskType": "activity"}, idempotencyKey(r), func(actionCtx context.Context) (any, error) {
		runID := runapp.ParentRunID(actionCtx)
		lifecycle := &activity.Lifecycle{
			RunID: runID,
			OnProgress: func(progress any, taskResults []any) any {
				updated, _ := h.app.Runs.UpdateProgress(runID, progress, taskResults)
				return updated
			},
		}
		var result map[string]any
		var runErr error
		if setID != "" {
			result, runErr = h.app.Activity.RunCurrentActivitySet(actionCtx, activity.SetExecutionOptions{
				SetID:           setID,
				SelectedIndexes: selectedIndexes,
				Raid:            raid,
				Options:         options,
				ClientType:      clientType,
			}, lifecycle)
		} else {
			result, runErr = h.app.Activity.RunCurrentActivityCopilotsWithConnection(actionCtx, clientType, connection.Address, lifecycle)
		}
		if runErr != nil {
			return nil, runErr
		}
		if stopped, _ := result["stopped"].(bool); stopped {
			return nil, errTrackedActionStopped
		}
		return result, nil
	})
	if err != nil {
		if run.State == agentrun.StatusFailed || run.State == agentrun.StatusInterrupted {
			sendRunFailureResponse(w, run)
			return
		}
		writeError(w, err)
		return
	}
	sendTrackedRunResponse(w, run, replayed, "活动作业执行完成")
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
	var operator map[string]any
	for _, item := range list {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		candidate := firstNonEmpty(stringField(record, "name"), stringField(record, "operator"))
		if strings.Contains(candidate, name) || strings.Contains(name, candidate) {
			operator = record
			break
		}
	}
	if operator == nil {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{Code: "AGENT_PARADOX_OPERATOR_NOT_FOUND", Message: fmt.Sprintf("未找到干员%q的悖论模拟关卡", name), Retryable: false, Details: map[string]any{"name": name}})
		return
	}
	operatorName := firstNonEmpty(stringField(operator, "name"), stringField(operator, "operator"))
	stageID := firstNonEmpty(stringField(operator, "stage_id"), stringField(operator, "stageId"))
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	items, err := h.app.Copilot.PRTS().QueryCopilots(ctx, stageID, 1, 10, "hot")
	if err != nil {
		writeError(w, err)
		return
	}
	copilots := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if parsed := parseCopilotSearchItem(item); parsed != nil {
			copilots = append(copilots, parsed)
		}
	}
	if len(copilots) == 0 {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{Code: "AGENT_PARADOX_COPILOT_NOT_FOUND", Message: fmt.Sprintf("未找到干员%q的作业", operatorName), Retryable: false, Details: map[string]any{"operator": operatorName, "stageId": stageID}})
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"operator": operatorName, "stageId": stageID, "copilots": copilots, "recommended": copilots[0]}, "", nil)
}

func injectConnectionOptions(options map[string]any, connection appconfig.ResolvedConnection) {
	if _, exists := options["clientType"]; !exists {
		if _, exists := options["client_type"]; !exists && connection.ClientType != "" {
			options["clientType"] = connection.ClientType
		}
	}
	if _, exists := options["address"]; !exists && connection.Address != "" {
		options["address"] = connection.Address
	}
}

func (h *Handler) executeCopilotSet(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	connection, err := h.resolveRequestConnection(body)
	if err != nil {
		writeError(w, err)
		return
	}
	selectedIndexes := intSlice(body["selectedIndexes"])
	options, _ := body["options"].(map[string]any)
	if options == nil {
		options = map[string]any{}
	}
	injectConnectionOptions(options, connection)
	raid := firstNonEmpty(stringField(body, "raid"), "normal")
	setID := r.PathValue("id")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	run, replayed, err := h.executeTrackedOperation(ctx, "run_copilot_set", map[string]any{
		"clientType":      connection.ClientType,
		"setId":           setID,
		"selectedIndexes": selectedIndexes,
		"raid":            raid,
		"options":         options,
	}, map[string]any{"taskName": "作业集执行", "taskType": "copilot"}, idempotencyKey(r), func(actionCtx context.Context) (any, error) {
		runID := runapp.ParentRunID(actionCtx)
		lifecycle := &copilot.ExecutionLifecycle{
			RunID: runID,
			OnProgress: func(progress map[string]any, taskResults []copilot.ProgressEntryResult) {
				results := make([]any, 0, len(taskResults))
				for _, item := range taskResults {
					results = append(results, item)
				}
				_, _ = h.app.Runs.UpdateProgress(runID, progress, results)
			},
		}
		result, runErr := h.app.Copilot.ExecutePlan(actionCtx, copilot.PlanExecution{
			SetID:           setID,
			Raid:            raid,
			SelectedIndexes: selectedIndexes,
			Options:         options,
			Lifecycle:       lifecycle,
		})
		if runErr != nil {
			return nil, runErr
		}
		data := map[string]any{"results": result.Results, "taskResults": result.TaskResults}
		for key, value := range result.Data {
			data[key] = value
		}
		return data, nil
	})
	if err != nil {
		if run.State == agentrun.StatusFailed || run.State == agentrun.StatusInterrupted {
			sendRunFailureResponse(w, run)
			return
		}
		writeError(w, err)
		return
	}
	sendTrackedRunResponse(w, run, replayed, "作业集执行完成")
}

func (h *Handler) settleManualRun(runID string, result *copilot.ManualStepResult, actionErr error) error {
	if current, ok := h.app.Runs.Get(runID); ok && current.State.Terminal() {
		if current.State == agentrun.StatusStopped {
			return nil
		}
		return runFailureError(current)
	}
	if actionErr != nil {
		if isTrackedStopError(actionErr) {
			_, stopErr := h.app.Runs.Stop(runID, map[string]any{"message": actionErr.Error()})
			return stopErr
		}
		_, _ = h.app.Runs.Fail(runID, actionErr)
		return actionErr
	}
	if result == nil {
		_, err := h.app.Runs.Complete(runID, nil)
		return err
	}
	if result.Stopped {
		_, err := h.app.Runs.Stop(runID, result)
		return err
	}
	if result.Finished {
		_, err := h.app.Runs.Complete(runID, result)
		return err
	}
	if _, err := h.app.Runs.MarkWaiting(runID); err != nil {
		return err
	}
	_, err := h.app.Runs.SetAcceptedResult(runID, result)
	return err
}

func (h *Handler) sendManualResult(w http.ResponseWriter, runID string, result *copilot.ManualStepResult) {
	data := structMap(result)
	if run, ok := h.app.Runs.Get(runID); ok {
		data["run"] = run
	}
	httpx.Success(w, http.StatusOK, data, result.Message, nil)
}

func (h *Handler) startManualCopilotSet(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	connection, err := h.resolveRequestConnection(body)
	if err != nil {
		writeError(w, err)
		return
	}
	options, _ := body["options"].(map[string]any)
	if options == nil {
		options = map[string]any{}
	}
	injectConnectionOptions(options, connection)
	setID := r.PathValue("id")
	raid := firstNonEmpty(stringField(body, "raid"), "normal")
	selectedIndexes := anySlice(body["selectedIndexes"])
	run, replayed, err := h.app.Runs.Begin(runapp.BeginInput{
		OperationID: "run_copilot_set_manual",
		Input: map[string]any{
			"clientType":      connection.ClientType,
			"setId":           setID,
			"selectedIndexes": selectedIndexes,
			"raid":            raid,
			"options":         options,
		},
		Metadata: map[string]any{"taskName": "手动作业集", "taskType": "copilot"},
	})
	if err != nil {
		writeError(w, err)
		return
	}
	if replayed {
		data := map[string]any{"runId": run.RunID, "state": run.State, "run": run}
		httpx.Success(w, http.StatusOK, data, "返回已有手动作业集", nil)
		return
	}
	if _, err := h.app.Runs.StartForExecution(run.RunID); err != nil {
		_, _ = h.app.Runs.Fail(run.RunID, err)
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	result, actionErr := h.app.Copilot.Manual().StartManualSet(runapp.WithParentRun(ctx, run.RunID), copilot.ManualStartRequest{
		SetID:           setID,
		Raid:            raid,
		SelectedIndexes: selectedIndexes,
		Options:         options,
		RunID:           run.RunID,
	})
	if result != nil && result.RunID == "" {
		result.RunID = run.RunID
	}
	if err := h.settleManualRun(run.RunID, result, actionErr); err != nil {
		current, ok := h.app.Runs.Get(run.RunID)
		if ok && (current.State == agentrun.StatusFailed || current.State == agentrun.StatusInterrupted) {
			sendRunFailureResponse(w, current)
			return
		}
		writeError(w, err)
		return
	}
	if result == nil {
		result = &copilot.ManualStepResult{RunID: run.RunID, State: copilot.ManualStateSucceeded, Finished: true}
	}
	h.sendManualResult(w, run.RunID, result)
}

func (h *Handler) continueManualCopilotSet(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	runID := strings.TrimSpace(stringField(body, "runId"))
	if runID == "" {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_RUN_ID_REQUIRED", Message: "继续手动作业集需要 runId", Retryable: false})
		return
	}
	connection, err := h.resolveRequestConnection(body)
	if err != nil {
		writeError(w, err)
		return
	}
	options, _ := body["options"].(map[string]any)
	if options == nil {
		options = map[string]any{}
	}
	injectConnectionOptions(options, connection)
	run, ok := h.app.Runs.Get(runID)
	if !ok {
		writeError(w, apperrors.WithStatus("AGENT_RUN_NOT_FOUND", "未找到 Agent run: "+runID, http.StatusNotFound, false, map[string]any{"runId": runID}))
		return
	}
	if run.State.Terminal() {
		writeError(w, apperrors.WithStatus("AGENT_RUN_NOT_RUNNING", "手动作业集 Run 已结束", http.StatusConflict, false, map[string]any{"runId": runID, "state": run.State}))
		return
	}
	if _, err := h.app.Runs.StartForExecution(runID); err != nil {
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	result, actionErr := h.app.Copilot.Manual().ContinueManualSet(runapp.WithParentRun(ctx, runID), runID, options)
	if err := h.settleManualRun(runID, result, actionErr); err != nil {
		current, exists := h.app.Runs.Get(runID)
		if exists && (current.State == agentrun.StatusFailed || current.State == agentrun.StatusInterrupted) {
			sendRunFailureResponse(w, current)
			return
		}
		writeError(w, err)
		return
	}
	if result == nil {
		result = &copilot.ManualStepResult{RunID: runID, State: copilot.ManualStateSucceeded, Finished: true}
	}
	h.sendManualResult(w, runID, result)
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
