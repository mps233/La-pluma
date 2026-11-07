package httpx

import (
	"net/http"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// FromError maps an application error to the public API error body. Unknown
// errors become INTERNAL_ERROR so implementation details do not leak.
func FromError(err error) *APIError {
	if appErr, ok := apperrors.As(err); ok {
		return &APIError{
			Code:       appErr.Code,
			Message:    appErr.Message,
			Details:    appErr.Details,
			Retryable:  appErr.Retryable,
			StatusCode: appErr.StatusCode,
		}
	}
	return &APIError{Code: "INTERNAL_ERROR", Message: "服务器内部错误", Retryable: false, StatusCode: http.StatusInternalServerError}
}

// StatusFromError returns the HTTP status carried by an application error.
func StatusFromError(err error) int {
	if appErr, ok := apperrors.As(err); ok && appErr.StatusCode >= 400 && appErr.StatusCode <= 599 {
		return appErr.StatusCode
	}
	return http.StatusInternalServerError
}
