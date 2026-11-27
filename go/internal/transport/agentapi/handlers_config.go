package agentapi

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"runtime"

	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

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
