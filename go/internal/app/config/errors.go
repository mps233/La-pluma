package config

import (
	"net/http"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// Stable Agent API error codes. The storage codes match the fallback codes
// that server/routes/agent.ts applies through sendConfigStorageError; profile
// and CLI codes keep the same message shape with an explicit stable code.
const (
	CodeConfigTypeInvalid     = "AGENT_CONFIG_TYPE_INVALID"
	CodeConfigLoadFailed      = "AGENT_CONFIG_LOAD_FAILED"
	CodeConfigSaveFailed      = "AGENT_CONFIG_SAVE_FAILED"
	CodeConfigListFailed      = "AGENT_CONFIG_LIST_FAILED"
	CodeConfigDeleteFailed    = "AGENT_CONFIG_DELETE_FAILED"
	CodeProfileIDInvalid      = "AGENT_VALIDATION_PROFILE_ID_INVALID"
	CodeProfileSaveFailed     = "MAA_PROFILE_SAVE_FAILED"
	CodeCLIConfigReadFailed   = "MAA_CLI_CONFIG_READ_FAILED"
	CodeCLIConfigWriteFailed  = "MAA_CLI_CONFIG_WRITE_FAILED"
	CodeMaaCoreChannelInvalid = "MAA_CORE_CHANNEL_INVALID"
)

func invalidConfigType(configType string) *apperrors.Error {
	return apperrors.WithStatus(
		CodeConfigTypeInvalid,
		"配置类型不合法",
		http.StatusBadRequest,
		false,
		map[string]any{"configType": configType},
	)
}

func configOperationError(code, message string) *apperrors.Error {
	return apperrors.WithStatus(code, message, http.StatusInternalServerError, true, nil)
}

func invalidProfileName(name string) *apperrors.Error {
	return apperrors.WithStatus(
		CodeProfileIDInvalid,
		"连接配置名称不合法",
		http.StatusBadRequest,
		false,
		map[string]any{"profileId": name},
	)
}

func profileSaveError(cause error) *apperrors.Error {
	return apperrors.WithStatus(
		CodeProfileSaveFailed,
		"保存配置失败: "+cause.Error(),
		http.StatusInternalServerError,
		false,
		nil,
	)
}

func cliConfigReadError(cause error) *apperrors.Error {
	return apperrors.WithStatus(
		CodeCLIConfigReadFailed,
		"读取 MAA CLI 配置失败: "+cause.Error(),
		http.StatusInternalServerError,
		false,
		nil,
	)
}

func cliConfigWriteError(cause error) *apperrors.Error {
	return apperrors.WithStatus(
		CodeCLIConfigWriteFailed,
		"写入 MAA CLI 配置失败: "+cause.Error(),
		http.StatusInternalServerError,
		false,
		nil,
	)
}

func coreChannelInvalid(channel any) *apperrors.Error {
	return apperrors.WithStatus(
		CodeMaaCoreChannelInvalid,
		"不支持的 MaaCore 更新渠道: "+channelDisplay(channel),
		http.StatusBadRequest,
		false,
		nil,
	)
}
