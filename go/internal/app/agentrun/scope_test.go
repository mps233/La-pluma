package agentrun

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
)

func openTestScope(t *testing.T, service *Service, request Request) *Scope {
	t.Helper()
	scope, replayed, err := service.Open(request)
	if err != nil {
		t.Fatal(err)
	}
	if replayed {
		t.Fatal("unexpected idempotent replay")
	}
	return scope
}

func TestScopeExecuteSettlesStoppedWhenActionReportsStop(t *testing.T) {
	service := newService(t)
	scope := openTestScope(t, service, Request{OperationID: "run_task"})
	run, err := scope.Execute(context.Background(), func(ctx context.Context) (any, error) {
		return nil, ErrActionStopped
	})
	if err != nil {
		t.Fatalf("execute error = %v", err)
	}
	if run.State != agentrun.StatusStopped {
		t.Fatalf("state = %s, want stopped", run.State)
	}
}

func TestScopeExecuteConcurrentStopSettlesStopped(t *testing.T) {
	service := newService(t)
	scope := openTestScope(t, service, Request{OperationID: "run_task"})

	started := make(chan struct{})
	stopRequested := make(chan struct{})
	var executeRun agentrun.DTO
	var executeErr error
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		executeRun, executeErr = scope.Execute(context.Background(), func(ctx context.Context) (any, error) {
			close(started)
			<-stopRequested
			// The process was killed by the stop request, so the action fails
			// after the run already moved through stopping.
			return nil, errors.New("maa process terminated")
		})
	}()

	<-started
	outcome, err := scope.Stop(context.Background(), StopRequest{
		StopResult: map[string]any{"stopped": true},
		StopProcess: func(ctx context.Context) error {
			close(stopRequested)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("stop error = %v", err)
	}
	wg.Wait()

	if executeErr != nil {
		t.Fatalf("execute error = %v", executeErr)
	}
	if outcome.Run.State != agentrun.StatusStopped || executeRun.State != agentrun.StatusStopped {
		t.Fatalf("stop = %s, execute = %s, want stopped", outcome.Run.State, executeRun.State)
	}
	stored, ok := service.Get(scope.RunID())
	if !ok || stored.State != agentrun.StatusStopped {
		t.Fatalf("stored run = %+v", stored)
	}
}

func TestScopeExecuteConcurrentIdempotencyYieldsOneRun(t *testing.T) {
	service := newService(t)
	const workers = 8
	var fresh atomic.Int32
	var executed atomic.Int32
	var wg sync.WaitGroup
	for index := 0; index < workers; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			scope, replayed, err := service.Open(Request{
				OperationID:    "run_task",
				IdempotencyKey: key("same-request"),
				Input:          map[string]any{"stage": "CE-6"},
			})
			if err != nil {
				t.Errorf("open: %v", err)
				return
			}
			if replayed {
				return
			}
			fresh.Add(1)
			if _, err := scope.Execute(context.Background(), func(ctx context.Context) (any, error) {
				executed.Add(1)
				time.Sleep(20 * time.Millisecond)
				return map[string]any{"ok": true}, nil
			}); err != nil {
				t.Errorf("execute: %v", err)
			}
		}()
	}
	wg.Wait()

	if got := fresh.Load(); got != 1 {
		t.Fatalf("fresh runs = %d, want 1", got)
	}
	if got := executed.Load(); got != 1 {
		t.Fatalf("executed actions = %d, want 1", got)
	}
	if runs := service.List(); len(runs) != 1 {
		t.Fatalf("runs = %d, want 1", len(runs))
	}
}

func TestScopeStopCancelsAcceptedAndReleasesIdempotency(t *testing.T) {
	service := newService(t)
	request := Request{
		OperationID:    "run_task",
		IdempotencyKey: key("retry-after-cancel"),
		Input:          map[string]any{"stage": "CE-6"},
	}
	scope := openTestScope(t, service, request)
	outcome, err := scope.Stop(context.Background(), StopRequest{CancelResult: map[string]any{"canceled": true}})
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Canceled || outcome.Run.State != agentrun.StatusStopped {
		t.Fatalf("outcome = %+v", outcome)
	}

	next, replayed, err := service.Open(request)
	if err != nil {
		t.Fatal(err)
	}
	nextRun, _ := next.Run()
	if replayed || nextRun.RunID == outcome.Run.RunID {
		t.Fatalf("canceled run must release its idempotency key: replayed=%v run=%+v", replayed, nextRun)
	}
}

func TestScopeStopForceEscalatesAcceptedRuns(t *testing.T) {
	service := newService(t)
	request := Request{
		OperationID:    "run_task",
		IdempotencyKey: key("forced-stop"),
		Input:          map[string]any{"stage": "CE-6"},
	}
	scope := openTestScope(t, service, request)
	processRan := false
	outcome, err := scope.Stop(context.Background(), StopRequest{
		StopResult: map[string]any{"stopped": true},
		StopProcess: func(ctx context.Context) error {
			processRan = true
			return nil
		},
		Force: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !processRan || outcome.Canceled || outcome.Run.State != agentrun.StatusStopped {
		t.Fatalf("outcome = %+v processRan=%v", outcome, processRan)
	}
	// A forced stop keeps the idempotency key, so a retry sees the stopped run.
	replay, replayed, err := service.Open(request)
	if err != nil {
		t.Fatal(err)
	}
	replayRun, _ := replay.Run()
	if !replayed || replayRun.RunID != outcome.Run.RunID {
		t.Fatalf("forced stop must keep the idempotency key: replayed=%v run=%+v", replayed, replayRun)
	}
}

func TestScopeStopStopsWaitingRun(t *testing.T) {
	service := newService(t)
	scope := openTestScope(t, service, Request{OperationID: "run_copilot_set_manual"})
	if _, err := scope.Start(); err != nil {
		t.Fatal(err)
	}
	if err := scope.Settle(Outcome{Result: map[string]any{"waiting": true}}, nil); err != nil {
		t.Fatal(err)
	}
	waiting, _ := scope.Run()
	if waiting.State != agentrun.StatusWaiting {
		t.Fatalf("state = %s, want waiting", waiting.State)
	}
	processRan := false
	outcome, err := scope.Stop(context.Background(), StopRequest{
		StopResult: map[string]any{"stopped": true},
		StopProcess: func(ctx context.Context) error {
			processRan = true
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !processRan || outcome.Run.State != agentrun.StatusStopped {
		t.Fatalf("outcome = %+v processRan=%v", outcome, processRan)
	}
}

func TestScopeStopReportsTerminalRuns(t *testing.T) {
	service := newService(t)
	scope := openTestScope(t, service, Request{OperationID: "run_task"})
	if _, err := scope.Execute(context.Background(), func(ctx context.Context) (any, error) {
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatal(err)
	}
	outcome, err := scope.Stop(context.Background(), StopRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.AlreadyTerminal || outcome.Run.State != agentrun.StatusSucceeded {
		t.Fatalf("outcome = %+v", outcome)
	}
}

func TestScopeStopProcessFailureLeavesRunStopping(t *testing.T) {
	service := newService(t)
	scope := openTestScope(t, service, Request{OperationID: "run_task"})
	if _, err := scope.Start(); err != nil {
		t.Fatal(err)
	}
	processErr := errors.New("process did not stop")
	outcome, err := scope.Stop(context.Background(), StopRequest{
		StopProcess:         func(ctx context.Context) error { return processErr },
		AbortOnProcessError: true,
	})
	if !errors.Is(err, processErr) {
		t.Fatalf("stop error = %v, want the process error", err)
	}
	if outcome.Run.State != agentrun.StatusStopping {
		t.Fatalf("state = %s, want stopping", outcome.Run.State)
	}
	stored, ok := service.Get(scope.RunID())
	if !ok || stored.State != agentrun.StatusStopping {
		t.Fatalf("stored run = %+v", stored)
	}
}

func TestScopeSettleManualOutcomes(t *testing.T) {
	cases := []struct {
		name      string
		outcome   Outcome
		actionErr error
		want      agentrun.Status
		wantError bool
	}{
		{name: "nil result completes", outcome: Outcome{}, want: agentrun.StatusSucceeded},
		{name: "stopped", outcome: Outcome{Result: map[string]any{"stopped": true}, Stopped: true}, want: agentrun.StatusStopped},
		{name: "finished", outcome: Outcome{Result: map[string]any{"finished": true}, Finished: true}, want: agentrun.StatusSucceeded},
		{name: "waiting", outcome: Outcome{Result: map[string]any{"waiting": true}}, want: agentrun.StatusWaiting},
		{name: "stop error", actionErr: ErrActionStopped, want: agentrun.StatusStopped},
		{name: "failure", actionErr: errors.New("step failed"), want: agentrun.StatusFailed, wantError: true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			service := newService(t)
			scope := openTestScope(t, service, Request{OperationID: "run_copilot_set_manual"})
			if _, err := scope.Start(); err != nil {
				t.Fatal(err)
			}
			err := scope.Settle(testCase.outcome, testCase.actionErr)
			if testCase.wantError && err == nil {
				t.Fatal("expected settle error")
			}
			if !testCase.wantError && err != nil {
				t.Fatalf("settle error = %v", err)
			}
			stored, ok := scope.Run()
			if !ok || stored.State != testCase.want {
				t.Fatalf("state = %+v, want %s", stored, testCase.want)
			}
		})
	}
}

func TestScopeSettleSurfacesPersistenceFailure(t *testing.T) {
	service := newService(t)
	scope := openTestScope(t, service, Request{OperationID: "run_copilot_set_manual"})
	if _, err := scope.Start(); err != nil {
		t.Fatal(err)
	}
	// Point the store at a directory so the terminal write fails.
	service.mu.Lock()
	service.filePath = t.TempDir()
	service.mu.Unlock()

	err := scope.Settle(Outcome{}, errors.New("step failed"))
	if code := errorCode(err); code != "AGENT_RUN_PERSISTENCE_FAILED" {
		t.Fatalf("err = %v (code %q), want the persistence error", err, code)
	}
}

func TestScopeExecuteSurfacesPersistenceFailure(t *testing.T) {
	service := newService(t)
	scope := openTestScope(t, service, Request{OperationID: "run_task"})
	_, err := scope.Execute(context.Background(), func(ctx context.Context) (any, error) {
		service.mu.Lock()
		service.filePath = t.TempDir()
		service.mu.Unlock()
		return nil, errors.New("action failed")
	})
	if code := errorCode(err); code != "AGENT_RUN_PERSISTENCE_FAILED" {
		t.Fatalf("err = %v (code %q), want the persistence error", err, code)
	}
}

func TestScopeProgressUpdatesTheRun(t *testing.T) {
	service := newService(t)
	scope := openTestScope(t, service, Request{OperationID: "run_task"})
	if _, err := scope.Start(); err != nil {
		t.Fatal(err)
	}
	updated, err := scope.Progress(
		map[string]any{"currentStep": 2, "totalSteps": 4},
		[]any{map[string]any{"taskName": "作战", "state": "succeeded"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	progress, _ := updated.Progress.(map[string]any)
	step, err := progress["currentStep"].(json.Number).Int64()
	if err != nil || step != 2 {
		t.Fatalf("progress = %#v", updated.Progress)
	}
	if len(updated.TaskResults) != 1 {
		t.Fatalf("task results = %#v", updated.TaskResults)
	}
}
