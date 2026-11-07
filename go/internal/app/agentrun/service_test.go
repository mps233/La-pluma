package agentrun

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newService(t *testing.T) *Service {
	t.Helper()
	service := New(filepath.Join(t.TempDir(), "agent-runs.json"), testLogger())
	if _, err := service.Initialize(); err != nil {
		t.Fatal(err)
	}
	return service
}

func key(value string) *string { return &value }

func TestBeginReplayAndConflict(t *testing.T) {
	service := newService(t)
	input := map[string]any{"stage": "1-7", "times": 1}
	first, replayed, err := service.Begin(BeginInput{
		OperationID:    "run_task",
		IdempotencyKey: key("daily-1"),
		Input:          input,
	})
	if err != nil {
		t.Fatal(err)
	}
	if replayed || first.State != agentrun.StatusAccepted {
		t.Fatalf("unexpected first run: %+v replayed=%v", first, replayed)
	}

	second, replayed, err := service.Begin(BeginInput{
		OperationID:    "run_task",
		IdempotencyKey: key("daily-1"),
		Input:          input,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !replayed || second.RunID != first.RunID {
		t.Fatalf("expected idempotent replay, got %+v replayed=%v", second, replayed)
	}

	_, _, err = service.Begin(BeginInput{
		OperationID:    "run_task",
		IdempotencyKey: key("daily-1"),
		Input:          map[string]any{"stage": "1-7", "times": 2},
	})
	if err == nil {
		t.Fatal("expected idempotency conflict")
	}
	if code := errorCode(err); code != "AGENT_IDEMPOTENCY_KEY_REUSED" {
		t.Fatalf("unexpected error code: %s", code)
	}
}

func TestTransitionsAndPersistence(t *testing.T) {
	service := newService(t)
	dto, _, err := service.Begin(BeginInput{OperationID: "run_task", Input: map[string]any{"a": 1}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(dto.RunID); err != nil {
		t.Fatal(err)
	}
	completed, err := service.Complete(dto.RunID, map[string]any{"ok": true})
	if err != nil {
		t.Fatal(err)
	}
	if completed.State != agentrun.StatusSucceeded || completed.DurationMS == nil {
		t.Fatalf("unexpected completion: %+v", completed)
	}
	got, ok := service.Get(dto.RunID)
	if !ok || got.State != agentrun.StatusSucceeded {
		t.Fatalf("unexpected stored run: %+v", got)
	}
	if err := service.Flush(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(service.FilePath()); err != nil {
		t.Fatalf("expected store file: %v", err)
	}
}

func TestRestoreInterruptsActiveRuns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-runs.json")
	first := New(path, testLogger())
	if _, err := first.Initialize(); err != nil {
		t.Fatal(err)
	}
	dto, _, err := first.Begin(BeginInput{OperationID: "run_task", Input: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := first.Start(dto.RunID); err != nil {
		t.Fatal(err)
	}
	if err := first.Flush(); err != nil {
		t.Fatal(err)
	}

	second := New(path, testLogger())
	summary, err := second.Initialize()
	if err != nil {
		t.Fatal(err)
	}
	if summary.InterruptedRuns != 1 {
		t.Fatalf("expected 1 interrupted run, got %+v", summary)
	}
	restored, ok := second.Get(dto.RunID)
	if !ok || restored.State != agentrun.StatusInterrupted {
		t.Fatalf("unexpected restored run: %+v", restored)
	}
	if restored.Error == nil || restored.Error.Code != "AGENT_RUN_INTERRUPTED" {
		t.Fatalf("unexpected interrupted error: %+v", restored.Error)
	}
}

func TestFailAndCurrent(t *testing.T) {
	service := newService(t)
	dto, _, err := service.Begin(BeginInput{OperationID: "run_task", Input: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	current, ok := service.Current()
	if !ok || current.RunID != dto.RunID {
		t.Fatalf("expected current run, got %+v", current)
	}
	if _, err := service.Start(dto.RunID); err != nil {
		t.Fatal(err)
	}
	failed, err := service.Fail(dto.RunID, apperrors.WithStatus("MAA_FAILED", "设备不可用", 422, true, map[string]any{"device": "mumu"}))
	if err != nil {
		t.Fatal(err)
	}
	if failed.State != agentrun.StatusFailed || failed.Error == nil || failed.Error.Code != "MAA_FAILED" || !failed.Error.Retryable {
		t.Fatalf("unexpected failed run: %+v", failed)
	}
	if _, ok := service.Current(); ok {
		t.Fatal("terminal run must not be current")
	}
}

func TestInvalidStoreFailsClosed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-runs.json")
	if err := os.WriteFile(path, []byte(`{"version":99,"runs":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	service := New(path, testLogger())
	if _, err := service.Initialize(); err == nil {
		t.Fatal("expected invalid store error")
	}
	if service.Ready() {
		t.Fatal("invalid store must not be ready")
	}
	if _, _, err := service.Begin(BeginInput{OperationID: "run_task"}); err == nil {
		t.Fatal("begin must fail closed")
	}
}

func TestPruneTerminalRuns(t *testing.T) {
	service := newService(t)
	service.maxTerminal = 1
	service.retention = time.Hour

	first, _, err := service.Begin(BeginInput{OperationID: "a"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Complete(first.RunID, nil); err != nil {
		t.Fatal(err)
	}
	second, _, err := service.Begin(BeginInput{OperationID: "b"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Complete(second.RunID, nil); err != nil {
		t.Fatal(err)
	}
	third, _, err := service.Begin(BeginInput{OperationID: "c"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := service.Get(first.RunID); ok {
		t.Fatal("oldest terminal run should be pruned")
	}
	if _, ok := service.Get(second.RunID); !ok {
		t.Fatal("newer terminal run should remain")
	}
	if _, ok := service.Get(third.RunID); !ok {
		t.Fatal("active run should remain")
	}
}

func errorCode(err error) string {
	if appErr, ok := apperrors.As(err); ok {
		return appErr.Code
	}
	return ""
}
