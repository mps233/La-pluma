package httpx

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

func decodeEnvelope(t *testing.T, recorder *httptest.ResponseRecorder) Envelope {
	t.Helper()
	var envelope Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v (body %q)", err, recorder.Body.String())
	}
	return envelope
}

func TestSuccessWritesTheStandardEnvelope(t *testing.T) {
	recorder := httptest.NewRecorder()

	Success(recorder, 0, nil, "", nil)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if contentType := recorder.Header().Get("Content-Type"); contentType != "application/json; charset=utf-8" {
		t.Fatalf("content type = %q", contentType)
	}
	envelope := decodeEnvelope(t, recorder)
	if !envelope.Success {
		t.Fatal("success = false, want true")
	}
	data, ok := envelope.Data.(map[string]any)
	if !ok || len(data) != 0 {
		t.Fatalf("data = %#v, want empty object", envelope.Data)
	}
	if envelope.Error != nil {
		t.Fatalf("error = %#v, want nil", envelope.Error)
	}
}

func TestSuccessPreservesDataMessageAndMeta(t *testing.T) {
	recorder := httptest.NewRecorder()

	Success(recorder, http.StatusAccepted, map[string]any{"runId": "run-1"}, "accepted", map[string]any{"count": float64(2)})

	envelope := decodeEnvelope(t, recorder)
	if recorder.Code != http.StatusAccepted || envelope.Message != "accepted" {
		t.Fatalf("status = %d message = %q", recorder.Code, envelope.Message)
	}
	if envelope.Meta["count"] != float64(2) {
		t.Fatalf("meta = %#v", envelope.Meta)
	}
	data, ok := envelope.Data.(map[string]any)
	if !ok || data["runId"] != "run-1" {
		t.Fatalf("data = %#v", envelope.Data)
	}
}

func TestFailureWritesTheStandardErrorEnvelope(t *testing.T) {
	recorder := httptest.NewRecorder()

	Failure(recorder, 0, NewError("SOME_CODE", "无法完成"))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
	envelope := decodeEnvelope(t, recorder)
	if envelope.Success {
		t.Fatal("success = true, want false")
	}
	if envelope.Error == nil {
		t.Fatal("error = nil")
	}
	if envelope.Error.Code != "SOME_CODE" || envelope.Error.Message != "无法完成" {
		t.Fatalf("error = %#v", envelope.Error)
	}
	if envelope.Error.Retryable {
		t.Fatal("retryable = true, want false")
	}
	if envelope.Error.StatusCode != http.StatusInternalServerError {
		t.Fatalf("error status = %d, want 500", envelope.Error.StatusCode)
	}
}

func TestFailureDefaultsNilErrorToInternal(t *testing.T) {
	recorder := httptest.NewRecorder()

	Failure(recorder, 0, nil)

	envelope := decodeEnvelope(t, recorder)
	if envelope.Error == nil || envelope.Error.Code != "INTERNAL_ERROR" {
		t.Fatalf("error = %#v", envelope.Error)
	}
}

func TestFailureKeepsExplicitErrorStatus(t *testing.T) {
	recorder := httptest.NewRecorder()

	Failure(recorder, http.StatusTeapot, &APIError{Code: "X", Message: "y", StatusCode: http.StatusConflict})

	envelope := decodeEnvelope(t, recorder)
	if envelope.Error == nil || envelope.Error.StatusCode != http.StatusConflict {
		t.Fatalf("error = %#v", envelope.Error)
	}
}

func TestFromErrorMapsApplicationErrors(t *testing.T) {
	source := apperrors.WithStatus("MAA_BUSY", "设备忙碌", http.StatusConflict, true, map[string]any{"device": "127.0.0.1:16384"})

	mapped := FromError(source)

	if mapped.Code != "MAA_BUSY" || mapped.Message != "设备忙碌" || mapped.StatusCode != http.StatusConflict || !mapped.Retryable {
		t.Fatalf("mapped = %#v", mapped)
	}
	if mapped.Details["device"] != "127.0.0.1:16384" {
		t.Fatalf("details = %#v", mapped.Details)
	}
}

func TestFromErrorHidesUnknownErrors(t *testing.T) {
	mapped := FromError(errors.New("internal storage detail leaked"))

	if mapped.Code != "INTERNAL_ERROR" || mapped.StatusCode != http.StatusInternalServerError {
		t.Fatalf("mapped = %#v", mapped)
	}
	if mapped.Message == "internal storage detail leaked" || mapped.Details != nil {
		t.Fatalf("unknown error leaked into the envelope: %#v", mapped)
	}
}

func TestStatusFromErrorOnlyAcceptsHTTPErrorStatuses(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"nil", nil, http.StatusInternalServerError},
		{"not app error", errors.New("boom"), http.StatusInternalServerError},
		{"app 400", apperrors.New("X", "x"), http.StatusInternalServerError},
		{"app 404", apperrors.NotFound("X", "x", nil), http.StatusNotFound},
		{"app 599", apperrors.WithStatus("X", "x", 599, false, nil), 599},
		{"app invalid 200", apperrors.WithStatus("X", "x", http.StatusOK, false, nil), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := StatusFromError(tc.err); got != tc.want {
				t.Fatalf("status = %d, want %d", got, tc.want)
			}
		})
	}
}
