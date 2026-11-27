package agentapi

import (
	"context"
	"net/http"
	"strconv"
	"time"

	appconfig "github.com/mps233/la-pluma/go/internal/app/config"
	"github.com/mps233/la-pluma/go/internal/app/mastery"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

func (h *Handler) masteryPreflight(w http.ResponseWriter, r *http.Request) {
	connection, err := h.resolveRequestConnectionFor(r, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	value, err := h.app.Mastery.Preflight(ctx, connection.ClientType)
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
	connection, err := h.resolveRequestConnectionFor(r, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.app.Mastery.Catalog(mastery.CatalogOptions{
		ClientType: connection.ClientType,
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
	connection, err := h.resolveRequestConnectionFor(r, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.app.Mastery.OperatorDetail(r.PathValue("operatorId"), mastery.OperatorDetailOptions{
		ClientType: connection.ClientType, DeclaredLevel: declaredLevel,
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
	connection, err := h.resolveRequestConnection(body)
	if err != nil {
		writeError(w, err)
		return
	}
	clientType := connection.ClientType
	profileID := firstNonEmpty(stringField(body, "profileId"), appconfig.DefaultProfileName)
	context := mastery.CampaignContext{ClientType: &clientType, ClientProfileID: &profileID}
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
	if value, ok := body["enabled"].(bool); ok {
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
		httpx.Success(w, http.StatusOK, map[string]any{"action": "start-operator-mastery-campaign", "sideEffects": []string{"consume_mastery_materials", "start_training_room_training"}}, "仅预演，未执行任何操作", nil)
		return
	}
	connection, err := h.resolveRequestConnection(body)
	if err != nil {
		writeError(w, err)
		return
	}
	clientType := connection.ClientType
	profileID := firstNonEmpty(stringField(body, "profileId"), appconfig.DefaultProfileName)
	context := mastery.CampaignContext{ClientType: &clientType, ClientProfileID: &profileID}
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
