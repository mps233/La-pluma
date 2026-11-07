package scheduler

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestSequentialExecution(t *testing.T) {
	executor := &fakeExecutor{}
	service := newTestService(executor, Options{})
	defer service.Close()

	flow := []any{
		map[string]any{"id": "a-1", "name": "A", "enabled": true, "commandId": "alpha", "params": map[string]any{}},
		map[string]any{"id": "b-1", "name": "B", "enabled": true, "commandId": "beta", "params": map[string]any{}},
		map[string]any{"id": "c-1", "name": "C", "enabled": false, "commandId": "gamma", "params": map[string]any{}},
	}
	result := service.StartDailyFlow(context.Background(), DailyFlowRequest{ScheduleID: "seq", TaskFlow: flow})
	if !result.Success || result.Stopped || result.Busy {
		t.Fatalf("result = %+v", result)
	}
	calls := executor.callsSnapshot()
	if len(calls) != 2 || calls[0].Command != "alpha" || calls[1].Command != "beta" {
		t.Fatalf("calls = %+v", calls)
	}
	for _, call := range calls {
		if !call.Wait {
			t.Fatalf("scheduled command should wait: %+v", call)
		}
	}
	if result.Summary.SuccessCount != 2 || result.Summary.FailedCount != 0 || result.Summary.SkippedCount != 0 {
		t.Fatalf("summary = %+v", result.Summary)
	}
	if len(result.Summary.TaskResults) != 2 {
		t.Fatalf("task results = %+v", result.Summary.TaskResults)
	}
	for _, entry := range result.Summary.TaskResults {
		if entry.State != "success" || entry.FinishedAt == "" {
			t.Fatalf("task result = %+v", entry)
		}
	}
	if len(result.Summary.Actions) != 0 {
		t.Fatalf("generic commands should not add actions: %+v", result.Summary.Actions)
	}

	status := service.ExecutionStatus()
	if status.IsRunning || !status.HasLastResult || status.LastResultRevision != 1 {
		t.Fatalf("status = %+v", status)
	}
	if status.CurrentStep != 2 || status.CurrentTask != nil || status.ScheduleID != nil {
		t.Fatalf("status after completion = %+v", status)
	}
	withResult := service.ExecutionStatusWithResult()
	if withResult.LastResult == nil {
		t.Fatal("includeResult should expose the summary")
	}
}

func TestDryRunReturnsPlanWithoutExecuting(t *testing.T) {
	executor := &fakeExecutor{}
	service := newTestService(executor, Options{})
	defer service.Close()

	flow := []any{
		map[string]any{"id": "startup-1", "commandId": "startup", "enabled": true, "params": map[string]any{}},
		map[string]any{"id": "fight-1", "commandId": "fight", "enabled": true, "params": map[string]any{"stage": "CE-6", "times": "2"}},
	}
	result := service.StartDailyFlow(context.Background(), DailyFlowRequest{ScheduleID: "dry", TaskFlow: flow, DryRun: true})
	if !result.Success || !result.DryRun || result.TotalSteps != 2 || len(result.Plan) != 2 {
		t.Fatalf("dry run = %+v", result)
	}
	if result.Plan[0].Command != "startup" || result.Plan[1].Command != "fight" {
		t.Fatalf("plan = %+v", result.Plan)
	}
	if calls := executor.callsSnapshot(); len(calls) != 0 {
		t.Fatalf("dry run executed commands: %+v", calls)
	}
	if status := service.ExecutionStatus(); status.IsRunning {
		t.Fatalf("dry run should not mark execution running: %+v", status)
	}
}

func TestStartupRetrySkipsRemainingTasksExceptClosedown(t *testing.T) {
	executor := &fakeExecutor{commandErrors: map[string]error{"startup": errors.New("no device")}}
	service := newTestService(executor, Options{})
	defer service.Close()

	flow := []any{
		map[string]any{"id": "startup-1", "commandId": "startup", "name": "启动游戏", "enabled": true, "params": map[string]any{}},
		map[string]any{"id": "fight-1", "commandId": "fight", "name": "理智作战", "enabled": true, "params": map[string]any{"stage": "CE-6", "times": "2"}},
		map[string]any{"id": "closedown-1", "commandId": "closedown", "name": "关闭游戏", "enabled": true, "params": map[string]any{}},
	}
	result := service.StartDailyFlow(context.Background(), DailyFlowRequest{ScheduleID: "startup-fail", TaskFlow: flow})
	if !result.Success || result.Stopped {
		t.Fatalf("result = %+v", result)
	}

	attempts := 0
	for _, call := range executor.callsSnapshot() {
		if call.Command == "startup" {
			attempts++
		}
		if call.Command == "fight" {
			t.Fatalf("fight should be skipped after startup failure: %+v", call)
		}
	}
	if attempts != 3 {
		t.Fatalf("startup attempts = %d, want 3", attempts)
	}
	summary := result.Summary
	if summary.FailedCount != 1 || summary.SuccessCount != 1 || summary.SkippedCount != 1 {
		t.Fatalf("summary = %+v", summary)
	}
	states := map[string]string{}
	for _, entry := range summary.TaskResults {
		states[entry.ID] = entry.State
	}
	if states["startup-1"] != "failed" || states["fight-1"] != "skipped" || states["closedown-1"] != "success" {
		t.Fatalf("task states = %+v", states)
	}
	if len(summary.Errors) != 1 || len(summary.Actions) != 3 {
		t.Fatalf("errors/actions = %+v / %+v", summary.Errors, summary.Actions)
	}
	if result.Message != "任务流程执行完成，1 项任务失败，1 项任务跳过" {
		t.Fatalf("message = %q", result.Message)
	}
}

func TestStopCancelsActiveFlowAndPropagates(t *testing.T) {
	executor := &fakeExecutor{
		blockCommands: map[string]bool{"alpha": true},
		started:       make(chan string, 1),
	}
	service := newTestService(executor, Options{})
	defer service.Close()

	flow := []any{
		map[string]any{"id": "a-1", "name": "A", "enabled": true, "commandId": "alpha", "params": map[string]any{}},
		map[string]any{"id": "b-1", "name": "B", "enabled": true, "commandId": "beta", "params": map[string]any{}},
	}
	done := make(chan DailyFlowResult, 1)
	go func() {
		done <- service.StartDailyFlow(context.Background(), DailyFlowRequest{ScheduleID: "stop", TaskFlow: flow})
	}()

	select {
	case <-executor.started:
	case <-time.After(2 * time.Second):
		t.Fatal("first command did not start")
	}

	busy := service.StartDailyFlow(context.Background(), DailyFlowRequest{ScheduleID: "second", TaskFlow: flow})
	if !busy.Busy || busy.Success {
		t.Fatalf("concurrent flow should be busy: %+v", busy)
	}
	if !service.Stop(context.Background()) {
		t.Fatal("Stop should report a running flow")
	}

	var result DailyFlowResult
	select {
	case result = <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("flow did not stop")
	}
	if !result.Success || !result.Stopped || result.Message != "任务流程已被用户终止" {
		t.Fatalf("result = %+v", result)
	}
	calls := executor.callsSnapshot()
	if len(calls) != 1 || calls[0].Command != "alpha" {
		t.Fatalf("calls after stop = %+v", calls)
	}
	if executor.stopCountSnapshot() != 1 {
		t.Fatalf("executor stop calls = %d", executor.stopCountSnapshot())
	}
	status := service.ExecutionStatus()
	if status.IsRunning || status.ShouldStop || status.Message != "任务流程已被用户终止" {
		t.Fatalf("status = %+v", status)
	}
	if service.Stop(context.Background()) {
		t.Fatal("Stop should return false when idle")
	}
}

func TestFightSummaryAndDropRecording(t *testing.T) {
	recorder := &fakeDropRecorder{}
	executor := &fakeExecutor{
		stdout: "Fight CE-6 3 times, drops:\ntotal drops: \"源岩\" × 5, 龙门币 × 300\n",
	}
	service := newTestService(executor, Options{DropRecorder: recorder})
	defer service.Close()

	flow := []any{
		map[string]any{
			"id":        "fight-1",
			"commandId": "fight",
			"name":      "理智作战",
			"enabled":   true,
			"params":    map[string]any{"stage": "CE-6", "times": "3"},
		},
	}
	result := service.StartDailyFlow(context.Background(), DailyFlowRequest{ScheduleID: "drops", TaskFlow: flow})
	if !result.Success {
		t.Fatalf("result = %+v", result)
	}
	payloads := recorder.payloadSnapshot()
	if len(payloads) != 1 {
		t.Fatalf("drop payloads = %+v", payloads)
	}
	payload := payloads[0].(map[string]any)
	if payload["stage"] != "CE-6" || payload["times"] != float64(3) {
		t.Fatalf("payload = %+v", payload)
	}
	items := payload["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("items = %+v", items)
	}
	if result.Summary.SuccessCount != 1 || len(result.Summary.Summaries) != 1 {
		t.Fatalf("summary = %+v", result.Summary)
	}
	if len(result.Summary.Actions) != 1 {
		t.Fatalf("actions = %+v", result.Summary.Actions)
	}
	action := result.Summary.Actions[0]
	if action.Status != "success" || action.Stage != "CE-6" || action.DropCount != 2 || action.Times != 3 {
		t.Fatalf("action = %+v", action)
	}
}

func TestMultiStageFightStopsAtSanityDepletion(t *testing.T) {
	recorder := &fakeDropRecorder{}
	executor := &fakeExecutor{
		stdout: "Fight CE-6 1 times, drops:\ntotal drops: 源岩 × 1\nsanity is not enough\n",
	}
	service := newTestService(executor, Options{DropRecorder: recorder})
	defer service.Close()

	flow := []any{
		map[string]any{
			"id":        "fight-1",
			"commandId": "fight",
			"name":      "理智作战",
			"enabled":   true,
			"params": map[string]any{
				"stages": []any{map[string]any{"stage": "CE-6", "times": "1"}, map[string]any{"stage": "LS-6", "times": "1"}},
			},
		},
	}
	result := service.StartDailyFlow(context.Background(), DailyFlowRequest{ScheduleID: "sanity", TaskFlow: flow})
	if !result.Success {
		t.Fatalf("result = %+v", result)
	}
	calls := executor.callsSnapshot()
	if len(calls) != 1 {
		t.Fatalf("second stage should not run after sanity depletion: %+v", calls)
	}
	if len(result.Summary.Actions) != 2 {
		t.Fatalf("actions = %+v", result.Summary.Actions)
	}
	if result.Summary.Actions[0].Status != "success" || result.Summary.Actions[1].Status != "skipped" {
		t.Fatalf("action statuses = %+v", result.Summary.Actions)
	}
	if result.Summary.SuccessCount != 1 || result.Summary.SkippedCount != 0 {
		t.Fatalf("summary = %+v", result.Summary)
	}
}
