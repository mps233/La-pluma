package httpx

import (
	"encoding/json"
	"errors"
	"net/http"
)

// APIError is the stable error body used by the Agent API and the rest of the
// La Pluma HTTP surface.
type APIError struct {
	Code       string         `json:"code"`
	Message    string         `json:"message"`
	Details    map[string]any `json:"details,omitempty"`
	Retryable  bool           `json:"retryable"`
	StatusCode int            `json:"statusCode,omitempty"`
}

func (e *APIError) Error() string {
	if e == nil {
		return ""
	}
	return e.Code + ": " + e.Message
}

// Envelope preserves the existing success/message/data/error/meta contract.
type Envelope struct {
	Success bool           `json:"success"`
	Message string         `json:"message,omitempty"`
	Data    any            `json:"data,omitempty"`
	Error   *APIError      `json:"error,omitempty"`
	Meta    map[string]any `json:"meta,omitempty"`
}

// NewError builds an APIError with a non-retryable default. Callers that know
// the operation is retryable must set the field explicitly.
func NewError(code, message string) *APIError {
	return &APIError{Code: code, Message: message, Retryable: false}
}

// WriteJSON writes a JSON response with the given status.
func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// Success writes the standard success envelope.
func Success(w http.ResponseWriter, status int, data any, message string, meta map[string]any) {
	if status == 0 {
		status = http.StatusOK
	}
	body := Envelope{Success: true, Data: data, Message: message, Meta: meta}
	if body.Data == nil {
		body.Data = map[string]any{}
	}
	WriteJSON(w, status, body)
}

// Failure writes the standard error envelope.
func Failure(w http.ResponseWriter, status int, err *APIError) {
	if status == 0 {
		status = http.StatusInternalServerError
	}
	if err == nil {
		err = NewError("INTERNAL_ERROR", "服务器内部错误")
	}
	if err.StatusCode == 0 {
		err.StatusCode = status
	}
	WriteJSON(w, status, Envelope{Success: false, Error: err})
}

// ErrorCode extracts the stable code from an error when it carries one.
func ErrorCode(err error) string {
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr != nil {
		return apiErr.Code
	}
	return ""
}
