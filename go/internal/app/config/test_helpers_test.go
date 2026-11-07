package config

import (
	"encoding/json"
	stderrors "errors"
	"testing"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/pelletier/go-toml/v2"
)

func requireError(t *testing.T, err error) *apperrors.Error {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error")
	}
	appErr, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("expected application error, got %T: %v", err, err)
	}
	return appErr
}

func requireMap(t *testing.T, value any, label string) map[string]any {
	t.Helper()
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s is %T, want map", label, value)
	}
	return record
}

func parseTOML(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var parsed map[string]any
	if err := toml.Unmarshal(data, &parsed); err != nil {
		t.Fatal(err)
	}
	return parsed
}

func numericValue(value any) int64 {
	switch typed := value.(type) {
	case json.Number:
		parsed, _ := typed.Int64()
		return parsed
	case int:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	}
	return 0
}

func requireSameErrorCode(t *testing.T, err error, code string) *apperrors.Error {
	t.Helper()
	appErr := requireError(t, err)
	if appErr.Code != code {
		t.Fatalf("code = %s, want %s", appErr.Code, code)
	}
	return appErr
}

func isAppError(err error, code string) bool {
	var appErr *apperrors.Error
	return stderrors.As(err, &appErr) && appErr.Code == code
}
