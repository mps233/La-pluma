package agentapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	runapp "github.com/mps233/la-pluma/go/internal/app/agentrun"
	"github.com/mps233/la-pluma/go/internal/app/scheduler"
	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	"github.com/mps233/la-pluma/go/internal/domain/snapshot"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

func (h *Handler) openStages(w http.ResponseWriter, r *http.Request) {
	clientType := firstNonEmpty(r.URL.Query().Get("clientType"), "Official")
	value := h.app.Training.TodayOpenStages(clientType, h.app.Training.ResourceCollectionOpen(clientType))
	httpx.Success(w, http.StatusOK, value, "已获取今日开放日常关卡", nil)
}

func (h *Handler) operboxData(w http.ResponseWriter, r *http.Request) {
	value, err := jsonstore.Read(h.app.Config().Paths.OperBoxPath(), nil)
	if err != nil {
		writeError(w, err)
		return
	}
	if value == nil {
		httpx.Success(w, http.StatusOK, map[string]any{}, "", nil)
		return
	}
	document, err := snapshot.DecodeOperBox(value)
	if err != nil {
		// Keep the stored shape for documents that predate the typed schema
		// instead of failing a read-only endpoint.
		httpx.Success(w, http.StatusOK, value, "", nil)
		return
	}
	httpx.Success(w, http.StatusOK, document, "", nil)
}

func (h *Handler) depotData(w http.ResponseWriter, r *http.Request) {
	value, err := jsonstore.Read(h.app.Config().Paths.DepotPath(), nil)
	if err != nil {
		writeError(w, err)
		return
	}
	if value == nil {
		httpx.Success(w, http.StatusOK, map[string]any{}, "", nil)
		return
	}
	document, err := snapshot.DecodeDepot(value)
	if err != nil {
		httpx.Success(w, http.StatusOK, value, "", nil)
		return
	}
	httpx.Success(w, http.StatusOK, document, "", nil)
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
			return nil, runapp.ErrActionStopped
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
			return nil, runapp.ErrActionStopped
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
