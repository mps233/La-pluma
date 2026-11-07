package copilot

import (
	"context"
	"fmt"
	"testing"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

func newManualHarness(t *testing.T, completed map[int]bool) (*ManualManager, *[]int) {
	t.Helper()
	executed := &[]int{}
	build := func(ctx context.Context, setID, raid string) (*Plan, error) {
		entries := make([]PlanEntry, 2)
		for index := 0; index < 2; index++ {
			done := completed[index]
			entries[index] = PlanEntry{
				Key:          fmt.Sprintf("%d:%d:normal", index, 100+index),
				ItemIndex:    index,
				CopilotID:    100 + index,
				DisplayStage: fmt.Sprintf("TL-%d", index+1),
				Mode:         "normal",
				Completed:    &done,
			}
		}
		return &Plan{SetID: setID, Name: "手动测试集", Items: []PlanItem{}, Entries: entries}, nil
	}
	execute := func(ctx context.Context, request ManualStepRequest) ([]any, error) {
		*executed = append(*executed, request.ItemIndex)
		completed[request.ItemIndex] = true
		return []any{map[string]any{"itemIndex": request.ItemIndex}}, nil
	}
	return NewManualManager(build, execute), executed
}

func TestManualSetWaitsBetweenEntriesAndContinues(t *testing.T) {
	manager, executed := newManualHarness(t, map[int]bool{})
	started, err := manager.StartManualSet(context.Background(), ManualStartRequest{
		SetID:           "set-1",
		SelectedIndexes: []any{0, 1},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !started.WaitingForNext || started.NextItemIndex == nil || *started.NextItemIndex != 1 {
		t.Fatalf("started = %#v", started)
	}
	if started.State != ManualStateWaiting || started.RunID == "" {
		t.Fatalf("started state = %#v", started)
	}
	if len(*executed) != 1 || (*executed)[0] != 0 {
		t.Fatalf("executed = %#v", *executed)
	}
	if _, ok := manager.ManualSession(started.RunID); !ok {
		t.Fatal("session should still exist")
	}

	continued, err := manager.ContinueManualSet(context.Background(), started.RunID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if continued.WaitingForNext || !continued.Finished || continued.State != ManualStateSucceeded {
		t.Fatalf("continued = %#v", continued)
	}
	if len(*executed) != 2 || (*executed)[1] != 1 {
		t.Fatalf("executed = %#v", *executed)
	}
	if _, ok := manager.ManualSession(started.RunID); ok {
		t.Fatal("finished session must be removed")
	}
}

func TestManualSetCanBeStoppedWhileWaiting(t *testing.T) {
	manager, executed := newManualHarness(t, map[int]bool{})
	started, err := manager.StartManualSet(context.Background(), ManualStartRequest{
		SetID:           "set-1",
		SelectedIndexes: []any{0, 1},
	})
	if err != nil {
		t.Fatal(err)
	}
	stopped, ok := manager.StopManualSetRun(started.RunID)
	if !ok || stopped.State != ManualStateStopped || !stopped.Stopped {
		t.Fatalf("stopped = %#v, %v", stopped, ok)
	}
	if len(*executed) != 1 {
		t.Fatalf("executed = %#v", *executed)
	}
	if _, ok := manager.ManualSession(started.RunID); ok {
		t.Fatal("stopped session must be removed")
	}
	if _, ok := manager.StopManualSetRun(started.RunID); ok {
		t.Fatal("stopping twice must report no session")
	}
}

func TestManualSetWithoutExecutorIsUnsupported(t *testing.T) {
	manager := NewManualManager(func(ctx context.Context, setID, raid string) (*Plan, error) {
		return &Plan{SetID: setID}, nil
	}, nil)
	_, err := manager.StartManualSet(context.Background(), ManualStartRequest{SetID: "set-1"})
	appError, ok := apperrors.As(err)
	if !ok || appError.Code != "COPILOT_MANUAL_UNSUPPORTED" {
		t.Fatalf("error = %#v", err)
	}
}

func TestManualSetNoPendingEntries(t *testing.T) {
	manager, executed := newManualHarness(t, map[int]bool{0: true, 1: true})
	result, err := manager.StartManualSet(context.Background(), ManualStartRequest{SetID: "set-1"})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Finished || result.State != ManualStateSucceeded || result.RunID != "" {
		t.Fatalf("result = %#v", result)
	}
	if len(*executed) != 0 {
		t.Fatalf("executed = %#v", *executed)
	}
}

func TestContinueUnknownSessionReturnsStableCode(t *testing.T) {
	manager, _ := newManualHarness(t, map[int]bool{})
	_, err := manager.ContinueManualSet(context.Background(), "missing", nil)
	appError, ok := apperrors.As(err)
	if !ok || appError.Code != "COPILOT_MANUAL_SESSION_NOT_FOUND" || appError.StatusCode != 404 {
		t.Fatalf("error = %#v", err)
	}
}
