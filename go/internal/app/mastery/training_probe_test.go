package mastery

import (
	"context"
	"testing"
	"time"
)

type fakeTrainingProbe struct {
	state TrainingState
	ok    bool
}

func (p fakeTrainingProbe) TrainingState(context.Context) (TrainingState, bool) {
	return p.state, p.ok
}

func TestSchedulerSchedulesFromLiveTraining(t *testing.T) {
	fixture := newTestFixture(t, nil)
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	id := added.Items[0].ID
	startQueue(t, fixture)
	if _, err := fixture.service.Queue.ApplyStepOutcome(id, StepOutcome{
		ResultDetail: "Completed",
		SkillMastery: []*float64{floatPtr(1)},
	}, defaultQueueSettings); err != nil {
		t.Fatalf("start training: %v", err)
	}
	fixture.clock.Advance(61 * time.Minute)
	fixture.service.Scheduler.training = fakeTrainingProbe{
		state: TrainingState{TraineeID: "char_test", TraineeName: "测试干员", RemainSecs: 3600, SlotState: 1},
		ok:    true,
	}
	fixture.service.Scheduler.Tick(context.Background())
	if calls := fixture.executor.callCount(); calls != 0 {
		t.Fatalf("live training must skip MAA, got %d calls", calls)
	}
	item, err := fixture.service.Queue.GetItem(id)
	if err != nil || item.NextProbeAt == nil {
		t.Fatalf("read item: %+v %v", item, err)
	}
	next, ok := parseTimestamp(*item.NextProbeAt)
	if !ok {
		t.Fatalf("invalid next probe: %v", *item.NextProbeAt)
	}
	delta := next.Sub(fixture.clock.Now())
	if delta < 61*time.Minute || delta > 63*time.Minute {
		t.Fatalf("next probe should follow remainSecs, got %v", delta)
	}
	if item.Phase != PhaseTraining {
		t.Fatalf("phase changed: %+v", item)
	}
}

func TestSchedulerMarksInterruptedWhenTraineeMismatches(t *testing.T) {
	fixture := newTestFixture(t, nil)
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	id := added.Items[0].ID
	startQueue(t, fixture)
	if _, err := fixture.service.Queue.ApplyStepOutcome(id, StepOutcome{
		ResultDetail: "Completed",
		SkillMastery: []*float64{floatPtr(1)},
	}, defaultQueueSettings); err != nil {
		t.Fatalf("start training: %v", err)
	}
	fixture.clock.Advance(61 * time.Minute)
	fixture.service.Scheduler.training = fakeTrainingProbe{
		state: TrainingState{TraineeID: "char_other", TraineeName: "另一位干员", RemainSecs: 3600, SlotState: 1},
		ok:    true,
	}
	fixture.service.Scheduler.Tick(context.Background())
	item, err := fixture.service.Queue.GetItem(id)
	if err != nil {
		t.Fatalf("read item: %v", err)
	}
	if item.Phase != PhaseFailed || item.Blocked == nil || item.Blocked.Code != "AGENT_MASTERY_TRAINING_INTERRUPTED" {
		t.Fatalf("mismatched trainee should interrupt: %+v", item)
	}
	if calls := fixture.executor.callCount(); calls != 0 {
		t.Fatalf("mismatched training must skip MAA, got %d calls", calls)
	}
}
