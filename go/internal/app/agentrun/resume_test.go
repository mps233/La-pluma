package agentrun

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

func resumeTestService(t *testing.T) *Service {
	t.Helper()
	path := filepath.Join(t.TempDir(), "agent-runs.json")
	service := New(path, slog.New(slog.NewTextHandler(os.Stderr, nil)))
	if _, err := service.Initialize(); err != nil {
		t.Fatal(err)
	}
	return service
}

// interruptAll marks every active run as the restart path would.
func interruptAll(t *testing.T, service *Service) {
	t.Helper()
	// Re-initializing applies the same restart rule to active records.
	service.mu.Lock()
	service.enabled = false
	service.mu.Unlock()
	if err := service.Flush(); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Initialize(); err != nil {
		t.Fatal(err)
	}
}

func TestResumeCandidatesIncludeRestartInterruptions(t *testing.T) {
	service := resumeTestService(t)
	run, _, err := service.Begin(BeginInput{
		OperationID: "execute_schedule",
		Input:       map[string]any{"scheduleId": "daily"},
		Progress:    map[string]any{"currentStep": 2},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartForExecution(run.RunID); err != nil {
		t.Fatal(err)
	}
	interruptAll(t, service)

	candidates := service.ResumeCandidates()
	if len(candidates) != 1 {
		t.Fatalf("candidates = %+v", candidates)
	}
	if candidates[0].RunID != run.RunID {
		t.Fatalf("candidate runId = %s, want %s", candidates[0].RunID, run.RunID)
	}
	if _, ok := candidates[0].Input.(map[string]any); !ok {
		t.Fatalf("candidate lost its input: %#v", candidates[0].Input)
	}
	if candidates[0].Error == nil || candidates[0].Error.Code != "AGENT_RUN_INTERRUPTED" {
		t.Fatalf("candidate error = %+v", candidates[0].Error)
	}
}

func TestMarkResumedRemovesTheCandidate(t *testing.T) {
	service := resumeTestService(t)
	run, _, err := service.Begin(BeginInput{OperationID: "execute_schedule", Input: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartForExecution(run.RunID); err != nil {
		t.Fatal(err)
	}
	interruptAll(t, service)

	if err := service.MarkResumed(run.RunID, "new-run"); err != nil {
		t.Fatal(err)
	}
	if candidates := service.ResumeCandidates(); len(candidates) != 0 {
		t.Fatalf("resumed run must not be offered again: %+v", candidates)
	}
	stored, ok := service.Get(run.RunID)
	if !ok {
		t.Fatal("interrupted run should stay in history")
	}
	if stored.Error == nil || stored.Error.Details["resumedBy"] != "new-run" {
		t.Fatalf("resume marker missing: %+v", stored.Error)
	}
}

func TestMarkResumeSkippedRemovesTheCandidate(t *testing.T) {
	service := resumeTestService(t)
	run, _, err := service.Begin(BeginInput{OperationID: "run_copilot_set", Input: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartForExecution(run.RunID); err != nil {
		t.Fatal(err)
	}
	interruptAll(t, service)

	if err := service.MarkResumeSkipped(run.RunID, "operation_not_resumable"); err != nil {
		t.Fatal(err)
	}
	if candidates := service.ResumeCandidates(); len(candidates) != 0 {
		t.Fatalf("skipped run must not be offered: %+v", candidates)
	}
}

func TestResumeCandidatesIgnoreUserStops(t *testing.T) {
	service := resumeTestService(t)
	run, _, err := service.Begin(BeginInput{OperationID: "execute_schedule", Input: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartForExecution(run.RunID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Stop(run.RunID, map[string]any{"stopped": true}); err != nil {
		t.Fatal(err)
	}
	interruptAll(t, service)

	if candidates := service.ResumeCandidates(); len(candidates) != 0 {
		t.Fatalf("a stopped run must not resume: %+v", candidates)
	}
}
