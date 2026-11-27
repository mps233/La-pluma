package errors

import (
	"errors"
	"fmt"
	"net/http"
	"testing"
)

func TestNewDefaults(t *testing.T) {
	err := New("CODE", "message")

	if err.Code != "CODE" || err.Message != "message" {
		t.Fatalf("err = %#v", err)
	}
	if err.StatusCode != http.StatusInternalServerError || err.Retryable {
		t.Fatalf("status = %d retryable = %v", err.StatusCode, err.Retryable)
	}
	if err.Details == nil {
		t.Fatal("details = nil, want empty map")
	}
	if err.Error() != "CODE: message" {
		t.Fatalf("Error() = %q", err.Error())
	}
}

func TestWithStatusNormalizesNilDetails(t *testing.T) {
	err := WithStatus("CODE", "message", http.StatusConflict, true, nil)

	if err.StatusCode != http.StatusConflict || !err.Retryable {
		t.Fatalf("err = %#v", err)
	}
	if err.Details == nil {
		t.Fatal("details = nil, want empty map")
	}
}

func TestValidationAndNotFoundHelpers(t *testing.T) {
	validation := Validation("BAD_INPUT", "无效输入", map[string]any{"field": "stage"})
	if validation.StatusCode != http.StatusBadRequest || validation.Retryable {
		t.Fatalf("validation = %#v", validation)
	}
	if validation.Details["field"] != "stage" {
		t.Fatalf("details = %#v", validation.Details)
	}

	notFound := NotFound("MISSING", "不存在", nil)
	if notFound.StatusCode != http.StatusNotFound || notFound.Retryable {
		t.Fatalf("notFound = %#v", notFound)
	}
}

func TestAsFindsWrappedApplicationErrors(t *testing.T) {
	source := WithStatus("CODE", "message", 409, false, nil)
	wrapped := fmt.Errorf("outer: %w", source)

	found, ok := As(wrapped)
	if !ok || found != source {
		t.Fatalf("As() = %#v, %v", found, ok)
	}
}

func TestAsRejectsOtherErrors(t *testing.T) {
	if found, ok := As(errors.New("plain")); ok || found != nil {
		t.Fatalf("As() = %#v, %v", found, ok)
	}
	if found, ok := As(nil); ok || found != nil {
		t.Fatalf("As(nil) = %#v, %v", found, ok)
	}
}

func TestIsTransientMAAUpdateFailure(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"plain error", errors.New("network error"), false},
		{"app error without details", New("MAA", "failed"), false},
		{"app error with nil details", WithStatus("MAA", "failed", 500, false, nil), false},
		{
			"network error in stderr",
			WithStatus("MAA", "failed", 500, true, map[string]any{"stderr": "ERROR: Network Error while fetching resource"}),
			true,
		},
		{
			"unexpected end of file in stderr",
			WithStatus("MAA", "failed", 500, true, map[string]any{"stderr": "unexpected end of file"}),
			true,
		},
		{
			"unrelated stderr",
			WithStatus("MAA", "failed", 500, true, map[string]any{"stderr": "invalid task configuration"}),
			false,
		},
		{
			"stderr not a string",
			WithStatus("MAA", "failed", 500, true, map[string]any{"stderr": []byte("network error")}),
			false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsTransientMAAUpdateFailure(tc.err); got != tc.want {
				t.Fatalf("IsTransientMAAUpdateFailure() = %v, want %v", got, tc.want)
			}
		})
	}
}
