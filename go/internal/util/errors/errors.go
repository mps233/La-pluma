package errors

import (
	stderrors "errors"
	"fmt"
	"net/http"
	"strings"
)

// Error is a stable, transport-agnostic application error. HTTP handlers map
// it to the existing success/message/data/error envelope.
type Error struct {
	Code       string
	Message    string
	StatusCode int
	Retryable  bool
	Details    map[string]any
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func New(code, message string) *Error {
	return &Error{Code: code, Message: message, StatusCode: http.StatusInternalServerError, Details: map[string]any{}}
}

func WithStatus(code, message string, status int, retryable bool, details map[string]any) *Error {
	if details == nil {
		details = map[string]any{}
	}
	return &Error{Code: code, Message: message, StatusCode: status, Retryable: retryable, Details: details}
}

func Validation(code, message string, details map[string]any) *Error {
	return WithStatus(code, message, http.StatusBadRequest, false, details)
}

func NotFound(code, message string, details map[string]any) *Error {
	return WithStatus(code, message, http.StatusNotFound, false, details)
}

func Conflict(code, message string, details map[string]any) *Error {
	return WithStatus(code, message, http.StatusConflict, true, details)
}

func As(err error) (*Error, bool) {
	var target *Error
	if stderrors.As(err, &target) {
		return target, true
	}
	return nil, false
}

// IsTransientMAAUpdateFailure reports whether err is maa-cli's automatic
// resource update failing on the network before MaaCore starts. A retry is
// safe because no game action has happened yet, and the next attempt usually
// succeeds.
func IsTransientMAAUpdateFailure(err error) bool {
	appErr, ok := As(err)
	if !ok || appErr.Details == nil {
		return false
	}
	stderr, _ := appErr.Details["stderr"].(string)
	text := strings.ToLower(stderr)
	return strings.Contains(text, "network error") || strings.Contains(text, "unexpected end of file")
}
