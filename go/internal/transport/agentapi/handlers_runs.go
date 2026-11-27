package agentapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/app"
	maaapp "github.com/mps233/la-pluma/go/internal/app/maa"
	"github.com/mps233/la-pluma/go/internal/app/scheduler"
	"github.com/mps233/la-pluma/go/internal/app/updates"
	"github.com/mps233/la-pluma/go/internal/contract"
	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	"github.com/mps233/la-pluma/go/internal/infra/adb"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

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
	run, replayed, err := h.app.MAAService.StartGameWithOptions(ctx, maaapp.StartGameOptions{
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
		run, replayed, err := h.app.MAAService.RunTaskWithOptions(ctx, taskConfig, wait, idempotencyKey(r), maaapp.RunTaskOptions{
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
	run, replayed, err := h.app.MAAService.Run(ctx, maaapp.RunRequest{
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
	run, replayed, err := h.app.MAAService.RunTaskWithOptions(ctx, taskConfig, effectiveWait, idempotencyKey(r), maaapp.RunTaskOptions{
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
	outcome := h.app.MAAService.StopCurrent(ctx)
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
