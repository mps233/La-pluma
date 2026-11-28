package agentapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/mps233/la-pluma/go/internal/app/activity"
	runapp "github.com/mps233/la-pluma/go/internal/app/agentrun"
	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

func (h *Handler) operatorsData(w http.ResponseWriter, r *http.Request) {
	operators, err := h.app.Training.AllOperatorsDetailed()
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, operators, "", nil)
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
	result, err := h.app.Connection.Test(ctx, adbPath, address)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, result, result.Message, nil)
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
	result, err := h.app.Connection.Discover(ctx, adbPath)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, result, result.Message, nil)
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
		scope, hasScope := runapp.ScopeFrom(actionCtx)
		lifecycle := &activity.Lifecycle{
			RunID: runapp.ParentRunID(actionCtx),
			OnProgress: func(progress any, taskResults []any) any {
				if !hasScope {
					return nil
				}
				updated, _ := scope.Progress(progress, taskResults)
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
			return nil, runapp.ErrActionStopped
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
