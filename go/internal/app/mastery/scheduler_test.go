package mastery

import (
	"context"
	"errors"
	"testing"
	"time"

	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

func startQueue(t *testing.T, fixture *testFixture) {
	t.Helper()
	if _, err := fixture.service.Queue.StartCampaign(CampaignContext{}); err != nil {
		t.Fatalf("start campaign: %v", err)
	}
}

func TestSchedulerTickCompletesCampaign(t *testing.T) {
	fixture := newTestFixture(t, func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error) {
		return domainrun.DTO{
			RunID: "run-a",
			Result: map[string]any{
				"stdout": `Assistant::append_callback | SubTaskExtraInfo {"what":"OperProgressDetail","details":{"name":"测试干员","result":"Success","result_detail":"AlreadySatisfied","skill_mastery":[3,0,0]}}`,
			},
		}, nil
	})
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 2)
	startQueue(t, fixture)
	fixture.service.Scheduler.Tick(context.Background())

	if fixture.executor.callCount() != 1 {
		t.Fatalf("expected one executor call, got %d", fixture.executor.callCount())
	}
	status, err := fixture.service.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Campaign.Status != CampaignCompleted {
		t.Fatalf("campaign should complete: %+v", status.Campaign)
	}
	item := status.Items[0]
	if item.ID != added.Items[0].ID || item.Phase != PhaseCompleted || item.ConfirmedLevel != 3 {
		t.Fatalf("unexpected completed item: %+v", item)
	}
	if status.Counts.Completed != 1 {
		t.Fatalf("unexpected counts: %+v", status.Counts)
	}
	notifications := fixture.notifier.snapshot()
	if len(notifications) != 2 {
		t.Fatalf("expected item and queue notifications, got %+v", notifications)
	}
	if notifications[0].Title != "专精目标完成" || notifications[0].Content != "测试干员 · 测试技能一 已确认达到 M3" || notifications[0].Level != "success" {
		t.Fatalf("unexpected item notification: %+v", notifications[0])
	}
	if notifications[1].Title != "专精队列完成" || notifications[1].Content != "所有专精目标已处理完成" {
		t.Fatalf("unexpected queue notification: %+v", notifications[1])
	}

	// A skipped disabled notification still completes. Now verify a second
	// tick is a no-op because the campaign is terminal.
	fixture.service.Scheduler.Tick(context.Background())
	if fixture.executor.callCount() != 1 {
		t.Fatalf("terminal campaign must not execute again: %d", fixture.executor.callCount())
	}
}

func TestSchedulerSkipsPausedBusyAndFutureProbe(t *testing.T) {
	fixture := newTestFixture(t, func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error) {
		return domainrun.DTO{
			Result: map[string]any{
				"stdout": `Assistant::append_callback | SubTaskExtraInfo {"what":"OperProgressDetail","details":{"name":"测试干员","result_detail":"AlreadySatisfied","skill_mastery":[3,0,0]}}`,
			},
		}, nil
	})
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 2)
	id := added.Items[0].ID

	// Idle campaign: no execution.
	fixture.service.Scheduler.Tick(context.Background())
	if fixture.executor.callCount() != 0 {
		t.Fatalf("idle campaign executed: %d", fixture.executor.callCount())
	}

	startQueue(t, fixture)
	fixture.probe.busy = true
	fixture.service.Scheduler.Tick(context.Background())
	if fixture.executor.callCount() != 0 {
		t.Fatalf("external execution should defer: %d", fixture.executor.callCount())
	}
	fixture.probe.busy = false

	// An in-flight phase must not be started again.
	if _, err := fixture.service.Queue.MarkItemStarting(id, MarkStartingInput{RunID: "run-x", Attempt: 1}); err != nil {
		t.Fatalf("mark starting: %v", err)
	}
	fixture.service.Scheduler.Tick(context.Background())
	if fixture.executor.callCount() != 0 {
		t.Fatalf("in-flight step executed: %d", fixture.executor.callCount())
	}
	// Clear the in-flight marker and seed a future probe on the queued item.
	if _, err := fixture.service.Queue.ApplyStepOutcome(id, StepOutcome{ResultDetail: "Unknown"}, defaultQueueSettings); err != nil {
		t.Fatalf("seed probe: %v", err)
	}
	item, _ := fixture.service.Queue.GetItem(id)
	if item.NextProbeAt == nil {
		t.Fatal("expected next probe")
	}
	fixture.service.Scheduler.Tick(context.Background())
	if fixture.executor.callCount() != 0 {
		t.Fatalf("future probe executed: %d", fixture.executor.callCount())
	}

	fixture.clock.Advance(6 * time.Minute)
	fixture.service.Scheduler.Tick(context.Background())
	if fixture.executor.callCount() != 1 {
		t.Fatalf("due probe did not execute: %d", fixture.executor.callCount())
	}
}

func TestSchedulerBlockedPausesCampaign(t *testing.T) {
	fixture := newTestFixture(t, func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error) {
		return domainrun.DTO{
			Result: map[string]any{
				"stdout": `Assistant::append_callback | SubTaskExtraInfo {"what":"OperProgressDetail","details":{"name":"测试干员","result_detail":"ResourceInsufficient","skill_mastery":[0,0,0]}}`,
			},
		}, nil
	})
	addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	if _, err := fixture.service.UpdateSettings(map[string]any{"onItemBlocked": "pause"}); err != nil {
		t.Fatalf("settings: %v", err)
	}
	startQueue(t, fixture)
	fixture.service.Scheduler.Tick(context.Background())

	status, err := fixture.service.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Campaign.Status != CampaignBlocked {
		t.Fatalf("campaign should be blocked: %+v", status.Campaign)
	}
	item := status.Items[0]
	if item.Phase != PhaseBlocked || item.Blocked == nil || item.Blocked.Code != "AGENT_MASTERY_RESOURCE_INSUFFICIENT" {
		t.Fatalf("unexpected blocked item: %+v", item)
	}
	notifications := fixture.notifier.snapshot()
	if len(notifications) != 1 {
		t.Fatalf("expected one blocked notification, got %+v", notifications)
	}
	if notifications[0].Title != "专精目标受阻" ||
		notifications[0].Content != "测试干员 · 测试技能一：专精材料不足，且无法从仓库继续合成" ||
		notifications[0].Level != "warning" {
		t.Fatalf("unexpected blocked notification: %+v", notifications[0])
	}

	fixture.service.Scheduler.Tick(context.Background())
	if fixture.executor.callCount() != 1 {
		t.Fatalf("blocked campaign executed again: %d", fixture.executor.callCount())
	}
}

func TestSchedulerRetryAndConsecutiveFailures(t *testing.T) {
	fixture := newTestFixture(t, func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error) {
		return domainrun.DTO{}, errors.New("network down")
	})
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	id := added.Items[0].ID
	startQueue(t, fixture)

	fixture.service.Scheduler.Tick(context.Background())
	item, err := fixture.service.Queue.GetItem(id)
	if err != nil || item == nil {
		t.Fatalf("get item: %v", err)
	}
	if item.Phase != PhaseQueued || item.ConsecutiveFailures != 1 || item.LastErrorCode == nil {
		t.Fatalf("unexpected retry state: %+v", item)
	}
	if *item.LastErrorCode != "AGENT_MASTERY_TRANSIENT_ERROR" || item.NextProbeAt == nil {
		t.Fatalf("unexpected retry fields: %+v", item)
	}
	nextProbe, ok := parseTimestamp(*item.NextProbeAt)
	if !ok || nextProbe.Sub(fixture.clock.Now()) != time.Minute {
		t.Fatalf("expected one minute retry: %v", item.NextProbeAt)
	}
	schedulerStatus := fixture.service.SchedulerStatus()
	if schedulerStatus.LastTickError == nil || *schedulerStatus.LastTickError != "network down" {
		t.Fatalf("last tick error: %+v", schedulerStatus)
	}

	for attempt := 2; attempt <= 5; attempt++ {
		fixture.clock.Advance(61 * time.Second)
		fixture.service.Scheduler.Tick(context.Background())
	}
	if fixture.executor.callCount() != 5 {
		t.Fatalf("expected five attempts, got %d", fixture.executor.callCount())
	}
	status, err := fixture.service.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	itemValue := status.Items[0]
	if itemValue.ConsecutiveFailures != 5 || itemValue.Phase != PhaseQueued {
		t.Fatalf("unexpected failure state: %+v", itemValue)
	}
	if status.Campaign.Status != CampaignBlocked {
		t.Fatalf("campaign should block after five failures: %+v", status.Campaign)
	}
	notifications := fixture.notifier.snapshot()
	if len(notifications) != 1 {
		t.Fatalf("expected one pause notification, got %+v", notifications)
	}
	if notifications[0].Title != "专精队列已暂停" || notifications[0].Content != "专精步骤连续失败，已暂停自动执行" {
		t.Fatalf("unexpected pause notification: %+v", notifications[0])
	}

	fixture.clock.Advance(2 * time.Minute)
	fixture.service.Scheduler.Tick(context.Background())
	if fixture.executor.callCount() != 5 {
		t.Fatalf("blocked campaign executed again: %d", fixture.executor.callCount())
	}
}

func TestSchedulerUnsupportedVersionPauses(t *testing.T) {
	fixture := newTestFixture(t, func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error) {
		return domainrun.DTO{}, apperrors.WithStatus("AGENT_MASTERY_UNSUPPORTED_VERSION", "当前 MAA 版本不支持专精任务", 409, true, nil)
	})
	addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	startQueue(t, fixture)
	fixture.service.Scheduler.Tick(context.Background())

	status, err := fixture.service.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Campaign.Status != CampaignBlocked {
		t.Fatalf("campaign should be blocked: %+v", status.Campaign)
	}
	item := status.Items[0]
	if item.LastErrorCode == nil || *item.LastErrorCode != "AGENT_MASTERY_UNSUPPORTED_VERSION" {
		t.Fatalf("unexpected item error: %+v", item)
	}
	notifications := fixture.notifier.snapshot()
	if len(notifications) != 1 || notifications[0].Title != "专精队列已暂停" {
		t.Fatalf("unexpected notifications: %+v", notifications)
	}
}

func TestSchedulerTrainingProbeSkipsUntilDue(t *testing.T) {
	callCount := 0
	fixture := newTestFixture(t, func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error) {
		callCount++
		return domainrun.DTO{
			Result: map[string]any{
				"stdout": `Assistant::append_callback | SubTaskExtraInfo {"what":"OperProgressDetail","details":{"name":"测试干员","result":"Success","result_detail":"Completed","skill_mastery":[1,0,0]}}`,
			},
		}, nil
	})
	addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	startQueue(t, fixture)
	fixture.service.Scheduler.Tick(context.Background())

	status, err := fixture.service.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	item := status.Items[0]
	if item.Phase != PhaseTraining || item.NextProbeAt == nil {
		t.Fatalf("expected training phase: %+v", item)
	}
	if status.Campaign.Status != CampaignRunning {
		t.Fatalf("campaign should remain running: %+v", status.Campaign)
	}

	fixture.service.Scheduler.Tick(context.Background())
	if callCount != 1 {
		t.Fatalf("training probe executed early: %d", callCount)
	}
	fixture.clock.Advance(61 * time.Minute)
	fixture.service.Scheduler.Tick(context.Background())
	if callCount != 2 {
		t.Fatalf("due training probe did not execute: %d", callCount)
	}
}

func TestSchedulerStartStop(t *testing.T) {
	fixture := newTestFixture(t, nil)
	fixture.service.StartScheduler(context.Background())
	status := fixture.service.SchedulerStatus()
	if !status.Running || status.TickMS != 60000 {
		t.Fatalf("scheduler did not start: %+v", status)
	}
	fixture.service.StopScheduler()
	waitForSchedulerIdle(t, fixture)
	status = fixture.service.SchedulerStatus()
	if status.Running {
		t.Fatalf("scheduler did not stop: %+v", status)
	}
	fixture.service.Scheduler.ResetForTests()
}

func TestServiceStopCampaign(t *testing.T) {
	fixture := newTestFixture(t, nil)
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	id := added.Items[0].ID
	startQueue(t, fixture)
	if _, err := fixture.service.Queue.MarkItemStarting(id, MarkStartingInput{RunID: "run-stop", Attempt: 1}); err != nil {
		t.Fatalf("mark starting: %v", err)
	}
	if _, err := fixture.service.Queue.MarkItemStepRunning(id, "run-stop"); err != nil {
		t.Fatalf("mark running: %v", err)
	}
	stopStatus, err := fixture.service.StopCampaign(context.Background())
	if err != nil {
		t.Fatalf("stop campaign: %v", err)
	}
	if fixture.executor.stopCount() != 1 {
		t.Fatalf("executor stop calls: %d", fixture.executor.stopCount())
	}
	if stopStatus.Campaign.Status != CampaignIdle || stopStatus.Campaign.ActiveItemID != nil {
		t.Fatalf("campaign not idle after stop: %+v", stopStatus.Campaign)
	}
	item, err := fixture.service.Queue.GetItem(id)
	if err != nil || item == nil || item.Phase != PhaseInterrupted || item.Recovery == nil {
		t.Fatalf("item not interrupted: %+v %v", item, err)
	}
	if item.Recovery.PreviousPhase != PhaseRunning || item.Recovery.PreviousRunID == nil || *item.Recovery.PreviousRunID != "run-stop" {
		t.Fatalf("unexpected recovery: %+v", item.Recovery)
	}
}

func TestServiceStartCampaignPreflightGate(t *testing.T) {
	fixture := newTestFixture(t, nil)
	fixture.versions.cli = "0.7.7"
	addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	_, err := fixture.service.StartCampaign(context.Background(), CampaignContext{})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_UNSUPPORTED_VERSION" {
		t.Fatalf("preflight gate: %v", err)
	}
	status, err := fixture.service.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Campaign.Status != CampaignIdle {
		t.Fatalf("campaign must not arm when preflight fails: %+v", status.Campaign)
	}

	fixture.versions.cli = "0.7.8"
	started, err := fixture.service.StartCampaign(context.Background(), CampaignContext{})
	if err != nil {
		t.Fatalf("start campaign: %v", err)
	}
	if started.Campaign.Status != CampaignRunning {
		t.Fatalf("campaign should run: %+v", started.Campaign)
	}
	// The service fires a background tick; wait until it has fully settled
	// before the test tears down its temp directory.
	deadline := time.Now().Add(2 * time.Second)
	for fixture.executor.callCount() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	for fixture.service.SchedulerStatus().TickInFlight && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if fixture.executor.callCount() != 1 {
		t.Fatalf("background tick did not run: %d", fixture.executor.callCount())
	}
	if fixture.service.SchedulerStatus().TickInFlight {
		t.Fatal("background tick did not settle")
	}
}

func waitForSchedulerIdle(t *testing.T, fixture *testFixture) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for fixture.service.SchedulerStatus().TickInFlight && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
}
