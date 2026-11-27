package agentapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/mps233/la-pluma/go/internal/app/notifications"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

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
