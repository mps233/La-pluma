package agentapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/app"
	runapp "github.com/mps233/la-pluma/go/internal/app/agentrun"
	appconfig "github.com/mps233/la-pluma/go/internal/app/config"
	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsval"
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
	// Skland routes are UI-only credential/data-source endpoints. They stay out
	// of the Agent manifest because they exchange account credentials.
	mux.HandleFunc("GET /skland/status", handler.sklandStatus)
	mux.HandleFunc("GET /skland/snapshot", handler.sklandSnapshot)
	mux.HandleFunc("POST /skland/login", handler.sklandLogin)
	mux.HandleFunc("POST /skland/credentials", handler.saveSklandCredentials)
	mux.HandleFunc("DELETE /skland/credentials", handler.clearSklandCredentials)
	mux.HandleFunc("POST /skland/sync", handler.syncSkland)
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
	mux.HandleFunc("GET /stages/open-today", handler.openStages)
	mux.HandleFunc("GET /data/operators", handler.operatorsData)
	mux.HandleFunc("GET /data/operbox", handler.operboxData)
	mux.HandleFunc("GET /data/depot", handler.depotData)
	mux.HandleFunc("POST /preview/orientation", handler.previewOrientation)
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
	mux.HandleFunc("GET /custom-tools", handler.customTools)
	mux.HandleFunc("POST /actions/run-custom-tool", handler.runCustomTool)
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

// executeTrackedOperation runs one action under the shared Agent run scope.
// Decoding and validation stay with the endpoint; begin, start, stop, and
// terminal transitions belong to agentrun.Scope.
func (h *Handler) executeTrackedOperation(ctx context.Context, operationID string, input, metadata any, idem *string, action func(context.Context) (any, error)) (agentrun.DTO, bool, error) {
	scope, replayed, err := h.app.Runs.Open(runapp.Request{
		OperationID:    operationID,
		IdempotencyKey: idem,
		Input:          input,
		Metadata:       metadata,
	})
	if err != nil {
		return agentrun.DTO{}, false, err
	}
	if replayed {
		run, _ := scope.Run()
		return run, true, nil
	}
	run, err := scope.Execute(ctx, action)
	return run, false, err
}

// executeTrackedOperationBackground is the non-blocking form used by endpoints
// that accept waitForCompletion=false. It returns the accepted run immediately
// and lets the action finish on a context that survives the HTTP request, so a
// long flow can be followed through /runs/current instead of holding the POST
// open for its whole duration.
func (h *Handler) executeTrackedOperationBackground(operationID string, input, metadata any, idem *string, action func(context.Context) (any, error)) (agentrun.DTO, bool, error) {
	scope, replayed, err := h.app.Runs.Open(runapp.Request{
		OperationID:    operationID,
		IdempotencyKey: idem,
		Input:          input,
		Metadata:       metadata,
	})
	if err != nil {
		return agentrun.DTO{}, false, err
	}
	run, _ := scope.Run()
	if replayed {
		return run, true, nil
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 6*time.Hour)
		defer cancel()
		if _, err := scope.Execute(ctx, action); err != nil {
			h.logger.Warn("background agent run failed", "runId", scope.RunID(), "operationId", operationID, "error", err)
		}
	}()
	return run, false, nil
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
				times = jsval.StringJSON(value)
			}
			stages = append(stages, fightStage{Stage: stage, Times: times})
		}
	}
	return stages
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
		args = append(args, jsval.StringJSON(item))
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
			count, valid := jsval.FiniteNumber(rawCount)
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
		count, valid := jsval.FiniteNumber(strings.TrimSpace(parts[1]))
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
		if number, ok := jsval.FiniteNumber(raw); ok {
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
			if number, ok := jsval.FiniteNumber(stage.Times); ok {
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

// maaCallbackTailBytes bounds the read of asst.log: the newest events live at the end of a log
// that can grow past 40 MB, and a whole-file read on every status poll would stall the server.
const maaCallbackTailBytes = 4 * 1024 * 1024

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

var copilotTitleStagePattern = regexp.MustCompile(`^([A-Z]{2,4}-\d+[A-Z]?)`)

const (
	copilotSearchLimit    = 10
	copilotSearchPageSize = 50
	copilotSearchMaxPages = 5
)

func stringField(record map[string]any, key string) string {
	return jsval.Text(record[key])
}

func mapField(value any) map[string]any {
	if record := jsval.Record(value); record != nil {
		return record
	}
	return map[string]any{}
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

func intSlice(value any) []int {
	array := jsval.Array(value)
	out := make([]int, 0, len(array))
	for _, item := range array {
		if parsed, ok := jsval.Numeric(item); ok {
			out = append(out, int(parsed))
		}
	}
	return out
}

func intField(record map[string]any, key string) int {
	if value, ok := jsval.Numeric(record[key]); ok {
		return int(value)
	}
	return 0
}
