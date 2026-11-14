package app

import (
	"testing"

	runapp "github.com/mps233/la-pluma/go/internal/app/agentrun"
)

func taskResult(name, state string) map[string]any {
	return map[string]any{"taskName": name, "state": state}
}

func candidate(progress any, results []any) runapp.ResumeCandidate {
	return runapp.ResumeCandidate{Progress: progress, TaskResults: results}
}

func TestNextResumeStepUsesCompletedResults(t *testing.T) {
	results := []any{
		taskResult("启动游戏", "succeeded"),
		taskResult("理智作战", "succeeded"),
	}
	step, ok := nextResumeStep(candidate(nil, results), 7)
	if !ok || step != 2 {
		t.Fatalf("step = %d ok = %v, want 2 true", step, ok)
	}
}

func TestNextResumeStepSkipsTheTaskRunningAtShutdown(t *testing.T) {
	// currentStep is one-based: 3 means the third task was running. Two tasks
	// have terminal results, so the flow continues at index 2 (the third task).
	results := []any{
		taskResult("启动游戏", "succeeded"),
		taskResult("理智作战", "succeeded"),
		taskResult("基建换班", "running"),
	}
	step, ok := nextResumeStep(candidate(map[string]any{"currentStep": float64(3)}, results), 7)
	if !ok || step != 2 {
		t.Fatalf("step = %d ok = %v, want 2 true", step, ok)
	}
}

func TestNextResumeStepRerunsFromTheTopAfterStartupFailure(t *testing.T) {
	results := []any{
		taskResult("启动游戏", "failed"),
		taskResult("理智作战", "skipped"),
	}
	step, ok := nextResumeStep(candidate(map[string]any{"currentStep": float64(6)}, results), 7)
	if !ok || step != 0 {
		t.Fatalf("step = %d ok = %v, want 0 true", step, ok)
	}
}

func TestNextResumeStepRejectsAFinishedFlow(t *testing.T) {
	results := make([]any, 0, 7)
	for index := 0; index < 7; index++ {
		results = append(results, taskResult("task", "succeeded"))
	}
	if _, ok := nextResumeStep(candidate(nil, results), 7); ok {
		t.Fatal("a flow with every task finished must not resume")
	}
}

func TestNextResumeStepAcceptsAFlowThatNeverStarted(t *testing.T) {
	step, ok := nextResumeStep(candidate(nil, nil), 7)
	if !ok || step != 0 {
		t.Fatalf("step = %d ok = %v, want 0 true", step, ok)
	}
}

func TestTerminalResultsDropsTheInFlightTask(t *testing.T) {
	results := []any{
		taskResult("启动游戏", "succeeded"),
		taskResult("理智作战", "running"),
	}
	kept := terminalResults(results)
	if len(kept) != 1 {
		t.Fatalf("kept = %v, want only the finished task", kept)
	}
}

func TestResultStateReadsBothFieldNames(t *testing.T) {
	if got := resultState(map[string]any{"status": "success"}); got != "success" {
		t.Fatalf("status field = %q", got)
	}
	if got := resultState(map[string]any{"state": "succeeded"}); got != "succeeded" {
		t.Fatalf("state field = %q", got)
	}
	if got := resultState(map[string]any{}); got != "" {
		t.Fatalf("empty = %q", got)
	}
}
