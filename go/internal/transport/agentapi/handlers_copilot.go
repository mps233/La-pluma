package agentapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	runapp "github.com/mps233/la-pluma/go/internal/app/agentrun"
	"github.com/mps233/la-pluma/go/internal/app/copilot"
	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

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
	localIDs := h.app.Copilot.Resource().StageIDsByCode(stage)
	copilots, keywords, err := searchCopilotsByKeywords(ctx, h.app.Copilot.PRTS(), stage, localIDs, copilotSearchLimit)
	if err != nil {
		writeError(w, err)
		return
	}
	if len(copilots) == 0 {
		details := map[string]any{"stage": stage}
		if len(keywords) > 0 {
			details["searchKeyword"] = keywords[0]
		}
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{Code: "AGENT_COPILOT_NOT_FOUND", Message: fmt.Sprintf("未找到关卡%q的作业", stage), Retryable: false, Details: details})
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"stage": stage, "copilots": copilots, "recommended": copilots[0]}, "", nil)
}

// searchCopilotsByKeywords resolves the stage to PRTS internal level ids and
// collects matching public copilots. Local catalogs are tried first, then the
// live PRTS level table, then the raw query.
//
// PRTS does not report an unknown level keyword as an error: it silently
// returns its global operation list. Every result therefore has to match the
// operation's own stage_name (or a title that starts with the display code),
// and a keyword that produces no matches simply lets the next candidate run.
func searchCopilotsByKeywords(ctx context.Context, prts *copilot.PRTSClient, stage string, localIDs []string, limit int) ([]map[string]any, []string, error) {
	if limit <= 0 {
		limit = copilotSearchLimit
	}
	normalizedStage := strings.ToUpper(strings.TrimSpace(stage))
	results := make([]map[string]any, 0, limit)
	keywords := make([]string, 0, len(localIDs)+2)
	seenIDs := map[string]struct{}{}
	seenKeywords := map[string]struct{}{}
	var lastErr error
	succeeded := false

	queryGroup := func(group []string) {
		for _, keyword := range group {
			keyword = strings.TrimSpace(keyword)
			if keyword == "" {
				continue
			}
			normalizedKeyword := strings.ToUpper(keyword)
			if _, exists := seenKeywords[normalizedKeyword]; exists {
				continue
			}
			seenKeywords[normalizedKeyword] = struct{}{}
			keywords = append(keywords, keyword)
			for page := 1; page <= copilotSearchMaxPages && len(results) < limit; page++ {
				items, err := prts.QueryCopilots(ctx, keyword, page, copilotSearchPageSize, "hot")
				if err != nil {
					lastErr = err
					break
				}
				succeeded = true
				if len(items) == 0 {
					break
				}
				pageHasStageNameMatch := false
				for _, item := range items {
					parsed := parseCopilotSearchItem(item)
					if parsed == nil {
						continue
					}
					if copilotSearchStageNameMatches(parsed, normalizedStage, normalizedKeyword) {
						pageHasStageNameMatch = true
					}
					if !copilotSearchItemMatches(parsed, normalizedStage, normalizedKeyword) {
						continue
					}
					id := fmt.Sprint(parsed["id"])
					if _, exists := seenIDs[id]; exists {
						continue
					}
					seenIDs[id] = struct{}{}
					results = append(results, parsed)
					if len(results) >= limit {
						break
					}
				}
				// PRTS applies level_keyword as a server-side level filter. When
				// the keyword matches no level it silently returns the global
				// list, so every page looks the same and later pages cannot
				// match by stage name. Stop after the first page in that case.
				if page == 1 && !pageHasStageNameMatch {
					break
				}
				// A page shorter than the requested limit is the last page.
				if len(items) < copilotSearchPageSize {
					break
				}
			}
			if len(results) >= limit {
				return
			}
		}
	}

	queryGroup(localIDs)
	if len(results) == 0 {
		queryGroup(prts.ResolveStageIDs(ctx, stage))
	}
	if len(results) == 0 {
		queryGroup([]string{stage})
	}
	if len(results) == 0 && !succeeded && lastErr != nil {
		return nil, keywords, lastErr
	}
	return results, keywords, nil
}

func copilotSearchStageNameMatches(parsed map[string]any, normalizedStage, normalizedKeyword string) bool {
	stageName := strings.ToUpper(strings.TrimSpace(stringField(parsed, "stageName")))
	return stageName != "" && (stageName == normalizedKeyword || stageName == normalizedStage)
}

func copilotSearchItemMatches(parsed map[string]any, normalizedStage, normalizedKeyword string) bool {
	if copilotSearchStageNameMatches(parsed, normalizedStage, normalizedKeyword) {
		return true
	}
	titleCode := copilotTitleStagePattern.FindString(strings.ToUpper(stringField(parsed, "title")))
	return titleCode != "" && titleCode == normalizedStage
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
		scope, hasScope := runapp.ScopeFrom(actionCtx)
		lifecycle := &copilot.ExecutionLifecycle{
			RunID: runapp.ParentRunID(actionCtx),
			OnProgress: func(progress map[string]any, taskResults []copilot.ProgressEntryResult) {
				if !hasScope {
					return
				}
				results := make([]any, 0, len(taskResults))
				for _, item := range taskResults {
					results = append(results, item)
				}
				_, _ = scope.Progress(progress, results)
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

// manualOutcome maps a manual step result to the transport-neutral settle
// contract owned by agentrun.Scope.
func manualOutcome(result *copilot.ManualStepResult) runapp.Outcome {
	if result == nil {
		return runapp.Outcome{}
	}
	return runapp.Outcome{Result: result, Stopped: result.Stopped, Finished: result.Finished}
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
	// Manual start is intentionally not idempotent: no idempotency key is
	// attached, so Open never replays and every start creates a new run.
	scope, _, err := h.app.Runs.Open(runapp.Request{
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
	runID := scope.RunID()
	if _, err := scope.Start(); err != nil {
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	result, actionErr := h.app.Copilot.Manual().StartManualSet(runapp.WithParentRun(ctx, runID), copilot.ManualStartRequest{
		SetID:           setID,
		Raid:            raid,
		SelectedIndexes: selectedIndexes,
		Options:         options,
		RunID:           runID,
	})
	if result != nil && result.RunID == "" {
		result.RunID = runID
	}
	if err := scope.Settle(manualOutcome(result), actionErr); err != nil {
		if current, ok := scope.Run(); ok && (current.State == agentrun.StatusFailed || current.State == agentrun.StatusInterrupted) {
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
	scope, ok := h.app.Runs.Scope(runID)
	if !ok {
		writeError(w, apperrors.WithStatus("AGENT_RUN_NOT_FOUND", "未找到 Agent run: "+runID, http.StatusNotFound, false, map[string]any{"runId": runID}))
		return
	}
	if run, _ := scope.Run(); run.State.Terminal() {
		writeError(w, apperrors.WithStatus("AGENT_RUN_NOT_RUNNING", "手动作业集 Run 已结束", http.StatusConflict, false, map[string]any{"runId": runID, "state": run.State}))
		return
	}
	if _, err := scope.Start(); err != nil {
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	result, actionErr := h.app.Copilot.Manual().ContinueManualSet(runapp.WithParentRun(ctx, runID), runID, options)
	if err := scope.Settle(manualOutcome(result), actionErr); err != nil {
		if current, ok := scope.Run(); ok && (current.State == agentrun.StatusFailed || current.State == agentrun.StatusInterrupted) {
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
