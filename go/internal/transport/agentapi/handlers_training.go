package agentapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/mps233/la-pluma/go/internal/app/training"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

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
