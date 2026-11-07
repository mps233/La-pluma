package mastery

import (
	"strings"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

func TestQueueCRUDAndOrder(t *testing.T) {
	fixture := newTestFixture(t, nil)
	status, err := fixture.service.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Campaign.Status != CampaignIdle || len(status.Items) != 0 || status.Counts.Total != 0 {
		t.Fatalf("unexpected default status: %+v", status)
	}
	expectedPath := fixture.paths.DataDir + "/user-configs/operator-mastery-queue.json"
	if fixture.service.Queue.QueuePath() != expectedPath {
		t.Fatalf("queue path = %s, want %s", fixture.service.Queue.QueuePath(), expectedPath)
	}

	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	if added.Added != 1 || len(added.Items) != 1 {
		t.Fatalf("unexpected add result: %+v", added)
	}
	item := added.Items[0]
	if item.ID != "char_test:1" || item.OperatorID != "char_test" || item.OperatorName != "测试干员" {
		t.Fatalf("unexpected item identity: %+v", item)
	}
	if item.Role == nil || *item.Role != "Caster" || item.SkillName != "测试技能一" || item.SkillID == nil || *item.SkillID != "skchr_test_1" {
		t.Fatalf("unexpected item skill: %+v", item)
	}
	if item.TargetLevel != 3 || item.DeclaredLevel != 0 || item.ConfirmedLevel != 0 || item.Order != 1 {
		t.Fatalf("unexpected item levels: %+v", item)
	}
	if item.Phase != PhaseQueued || !item.Enabled || item.LevelVerified {
		t.Fatalf("unexpected item state: %+v", item)
	}

	second := addDefaultItem(t, fixture.service, "char_test", 2, 1, 0)
	if second.Items[0].Order != 2 || second.Items[0].SkillName != "测试技能二" {
		t.Fatalf("unexpected second item: %+v", second.Items[0])
	}

	_, err = fixture.service.AddItems([]AddItemInput{{OperatorID: "char_test", SkillIndex: 1, TargetLevel: 3}}, CampaignContext{})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_DUPLICATE" || appErr.StatusCode != 409 {
		t.Fatalf("duplicate error: %v", err)
	}
	_, err = fixture.service.AddItems(nil, CampaignContext{})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_TARGET_INVALID" {
		t.Fatalf("empty targets error: %v", err)
	}
	many := make([]AddItemInput, 31)
	for index := range many {
		many[index] = AddItemInput{OperatorID: "char_test", SkillIndex: 1, TargetLevel: 1}
	}
	_, err = fixture.service.AddItems(many, CampaignContext{})
	if appErr, ok := asAppError(err); !ok || !strings.Contains(appErr.Message, "30") {
		t.Fatalf("too many targets error: %v", err)
	}
	_, err = fixture.service.AddItems([]AddItemInput{{OperatorID: "", SkillIndex: 1, TargetLevel: 1}}, CampaignContext{})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_TARGET_INVALID" {
		t.Fatalf("invalid operator error: %v", err)
	}
	_, err = fixture.service.AddItems([]AddItemInput{{OperatorID: "char_test", SkillIndex: 1, TargetLevel: 3, DeclaredLevel: 3}}, CampaignContext{})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_TARGET_INVALID" {
		t.Fatalf("invalid declared level error: %v", err)
	}

	target := 2
	updated, err := fixture.service.UpdateItem("char_test:1", ItemPatch{TargetLevel: &target})
	if err != nil || updated.TargetLevel != 2 {
		t.Fatalf("update target: %+v %v", updated, err)
	}
	badTarget := 0
	_, err = fixture.service.UpdateItem("char_test:1", ItemPatch{TargetLevel: &badTarget})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_TARGET_INVALID" {
		t.Fatalf("invalid target error: %v", err)
	}
	disabled := false
	updated, err = fixture.service.UpdateItem("char_test:1", ItemPatch{Enabled: &disabled})
	if err != nil || updated.Enabled {
		t.Fatalf("disable item: %+v %v", updated, err)
	}

	reordered, err := fixture.service.Reorder([]string{"char_test:2", "char_test:1"})
	if err != nil {
		t.Fatalf("reorder: %v", err)
	}
	if reordered[0].ID != "char_test:2" || reordered[0].Order != 1 || reordered[1].Order != 2 {
		t.Fatalf("unexpected reorder result: %+v", reordered)
	}
	_, err = fixture.service.Reorder([]string{"char_test:2"})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_ORDER_INVALID" {
		t.Fatalf("short order error: %v", err)
	}
	_, err = fixture.service.Reorder([]string{"char_test:2", "char_test:2"})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_ORDER_INVALID" {
		t.Fatalf("duplicate order error: %v", err)
	}
	_, err = fixture.service.Reorder([]string{"char_test:2", "char_unknown:1"})
	if appErr, ok := asAppError(err); !ok || !strings.Contains(appErr.Message, "char_unknown:1") {
		t.Fatalf("unknown order error: %v", err)
	}

	if err := fixture.service.RemoveItem("char_test:1"); err != nil {
		t.Fatalf("remove item: %v", err)
	}
	status, err = fixture.service.Status()
	if err != nil || len(status.Items) != 1 || status.Items[0].ID != "char_test:2" {
		t.Fatalf("unexpected status after remove: %+v %v", status, err)
	}
	if err := fixture.service.RemoveItem("char_test:1"); err == nil {
		t.Fatal("removing a missing item must fail")
	}

	settings, err := fixture.service.UpdateSettings(map[string]any{
		"probeIntervalMinutes": 120,
		"onItemBlocked":        "pause",
		"autoStartGame":        false,
	})
	if err != nil {
		t.Fatalf("settings: %v", err)
	}
	if settings.ProbeIntervalMinutes != 120 || settings.OnItemBlocked != "pause" || settings.AutoStartGame {
		t.Fatalf("unexpected settings: %+v", settings)
	}
	settings, err = fixture.service.UpdateSettings(map[string]any{"probeIntervalMinutes": 999})
	if err != nil || settings.ProbeIntervalMinutes != 60 {
		t.Fatalf("invalid interval should normalize to 60: %+v %v", settings, err)
	}

	raw, err := jsonstore.Read(fixture.service.Queue.QueuePath(), nil)
	if err != nil {
		t.Fatalf("read queue file: %v", err)
	}
	root, _ := asRecord(raw)
	if root == nil {
		t.Fatal("queue file must be an object")
	}
	campaign, _ := asRecord(root["campaign"])
	if campaign == nil || campaign["status"] == nil {
		t.Fatalf("persisted campaign missing status: %+v", root)
	}
	items, _ := asArray(root["items"])
	if len(items) != 1 {
		t.Fatalf("persisted items: %+v", items)
	}
	persisted, _ := asRecord(items[0])
	for _, key := range []string{"operatorId", "skillIndex", "targetLevel", "declaredLevel", "confirmedLevel", "lastOutcome", "activeRunId", "recovery", "blocked", "nextProbeAt"} {
		if _, ok := persisted[key]; !ok {
			t.Fatalf("persisted item missing %q: %+v", key, persisted)
		}
	}
	if _, ok := root["schemaVersion"]; !ok {
		t.Fatalf("persisted queue missing schemaVersion: %+v", root)
	}
}

func TestQueueNormalizesLegacyState(t *testing.T) {
	fixture := newTestFixture(t, nil)
	legacy := `{
	  "schemaVersion": 99,
	  "campaign": {"status": "running", "settings": {"probeIntervalMinutes": 120, "onItemBlocked": "pause"}},
	  "items": [
	    {"operatorId": "char_test", "skillIndex": 2, "targetLevel": 3},
	    {"operatorId": "char_test", "skillIndex": 9, "targetLevel": 3},
	    {"operatorId": "char_test", "skillIndex": 1, "targetLevel": 0}
	  ]
	}`
	writeFixtureFile(t, fixture.service.Queue.QueuePath(), legacy)
	status, err := fixture.service.Queue.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Campaign.Status != CampaignRunning || status.Campaign.Settings.ProbeIntervalMinutes != 120 || status.Campaign.Settings.OnItemBlocked != "pause" {
		t.Fatalf("unexpected campaign normalization: %+v", status.Campaign)
	}
	if len(status.Items) != 1 {
		t.Fatalf("expected one valid item, got %+v", status.Items)
	}
	item := status.Items[0]
	if item.ID != "char_test:2" || item.SkillIndex != 2 || item.TargetLevel != 3 {
		t.Fatalf("unexpected normalized item: %+v", item)
	}
	if !item.Enabled || item.Phase != PhaseQueued || item.OperatorName != "char_test" {
		t.Fatalf("unexpected item defaults: %+v", item)
	}
	if item.DeclaredLevel != 0 || item.ConfirmedLevel != 0 || item.AddedAt == "" || item.UpdatedAt == "" {
		t.Fatalf("unexpected item timestamps/levels: %+v", item)
	}
	if item.SkillName != "技能 2" {
		t.Fatalf("default skill name: %q", item.SkillName)
	}
}

func TestCampaignStartPauseResumeStop(t *testing.T) {
	fixture := newTestFixture(t, nil)
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	id := added.Items[0].ID

	clientType := "Official"
	profileID := "profile-1"
	status, err := fixture.service.Queue.StartCampaign(CampaignContext{ClientType: &clientType, ClientProfileID: &profileID})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if status.Campaign.Status != CampaignRunning || status.Campaign.ActiveItemID == nil || *status.Campaign.ActiveItemID != id {
		t.Fatalf("unexpected start status: %+v", status)
	}
	if status.Campaign.ClientType == nil || *status.Campaign.ClientType != "Official" {
		t.Fatalf("client type not recorded: %+v", status.Campaign)
	}
	if status.Campaign.ClientProfileID == nil || *status.Campaign.ClientProfileID != "profile-1" {
		t.Fatalf("profile not recorded: %+v", status.Campaign)
	}
	if status.Campaign.StartedAt == nil {
		t.Fatal("startedAt missing")
	}
	if status.ActiveItem == nil || status.NextActionableItem == nil {
		t.Fatalf("active item missing: %+v", status)
	}

	status, err = fixture.service.Queue.PauseCampaign(nil)
	if err != nil || status.Campaign.Status != CampaignPaused {
		t.Fatalf("pause: %+v %v", status.Campaign, err)
	}
	if status.Campaign.PausedReason == nil || *status.Campaign.PausedReason != "用户暂停" {
		t.Fatalf("pause reason: %v", status.Campaign.PausedReason)
	}

	status, err = fixture.service.Queue.ResumeCampaign()
	if err != nil || status.Campaign.Status != CampaignRunning || status.Campaign.PausedReason != nil {
		t.Fatalf("resume: %+v %v", status.Campaign, err)
	}

	reason := "维护"
	status, err = fixture.service.Queue.PauseCampaign(&reason)
	if err != nil || status.Campaign.PausedReason == nil || *status.Campaign.PausedReason != "维护" {
		t.Fatalf("custom pause reason: %+v %v", status.Campaign, err)
	}

	starting, err := fixture.service.Queue.MarkItemStarting(id, MarkStartingInput{StepTarget: 1, RunID: "run-1", Attempt: 1})
	if err != nil || starting.Phase != PhaseStarting || starting.ActiveRunID == nil || *starting.ActiveRunID != "run-1" {
		t.Fatalf("mark starting: %+v %v", starting, err)
	}
	running, err := fixture.service.Queue.MarkItemStepRunning(id, "run-1")
	if err != nil || running.Phase != PhaseRunning {
		t.Fatalf("mark running: %+v %v", running, err)
	}
	_, err = fixture.service.Queue.UpdateItem(id, ItemPatch{})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_STATE_INVALID" || !appErr.Retryable {
		t.Fatalf("update while running: %v", err)
	}
	_, err = fixture.service.Queue.RetryItem(id)
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_STATE_INVALID" {
		t.Fatalf("retry while running: %v", err)
	}
	_, err = fixture.service.Queue.Reorder([]string{id})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_STATE_INVALID" {
		t.Fatalf("reorder while running: %v", err)
	}

	status, err = fixture.service.Queue.StopCampaign()
	if err != nil {
		t.Fatalf("stop: %v", err)
	}
	if status.Campaign.Status != CampaignIdle || status.Campaign.ActiveItemID != nil || status.Campaign.ActiveStepRunID != nil {
		t.Fatalf("unexpected stop status: %+v", status)
	}
	item, err := fixture.service.Queue.GetItem(id)
	if err != nil || item == nil {
		t.Fatalf("get stopped item: %v", err)
	}
	if item.Phase != PhaseInterrupted || item.ActiveRunID != nil {
		t.Fatalf("item should be interrupted: %+v", item)
	}
	if item.Recovery == nil || item.Recovery.PreviousPhase != PhaseRunning || item.Recovery.PreviousRunID == nil || *item.Recovery.PreviousRunID != "run-1" {
		t.Fatalf("unexpected recovery: %+v", item.Recovery)
	}

	_, err = fixture.service.Queue.ResumeCampaign()
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_QUEUE_EMPTY" {
		t.Fatalf("resume with no actionable item: %v", err)
	}
	retried, err := fixture.service.Queue.RetryItem(id)
	if err != nil || retried.Phase != PhaseQueued || retried.Blocked != nil {
		t.Fatalf("retry interrupted: %+v %v", retried, err)
	}
	status, err = fixture.service.Queue.ResumeCampaign()
	if err != nil || status.Campaign.Status != CampaignRunning || status.ActiveItem == nil || status.ActiveItem.ID != id {
		t.Fatalf("resume after retry: %+v %v", status, err)
	}
}

func TestOutcomeTransitions(t *testing.T) {
	fixture := newTestFixture(t, nil)
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	id := added.Items[0].ID

	stepOne := []*float64{floatPtr(1), floatPtr(0), floatPtr(0)}
	item, err := fixture.service.Queue.ApplyStepOutcome(id, StepOutcome{
		ResultDetail:         "AlreadySatisfied",
		SkillMastery:         stepOne,
		RunID:                stringPtrValue("run-1"),
		LogCheckpointPresent: true,
	}, defaultQueueSettings)
	if err != nil {
		t.Fatalf("outcome 1: %v", err)
	}
	if item.ConfirmedLevel != 1 || item.Phase != PhaseQueued || !item.LevelVerified || item.NextProbeAt != nil {
		t.Fatalf("unexpected first AlreadySatisfied: %+v", item)
	}
	item, err = fixture.service.Queue.ApplyStepOutcome(id, StepOutcome{
		ResultDetail: "AlreadySatisfied",
		SkillMastery: []*float64{floatPtr(2), floatPtr(0), floatPtr(0)},
	}, defaultQueueSettings)
	if err != nil || item.ConfirmedLevel != 2 || item.Phase != PhaseQueued {
		t.Fatalf("unexpected second AlreadySatisfied: %+v %v", item, err)
	}
	item, err = fixture.service.Queue.ApplyStepOutcome(id, StepOutcome{
		ResultDetail: "AlreadySatisfied",
		SkillMastery: []*float64{floatPtr(3), floatPtr(0), floatPtr(0)},
	}, defaultQueueSettings)
	if err != nil || item.ConfirmedLevel != 3 || item.Phase != PhaseCompleted || item.CompletedAt == nil {
		t.Fatalf("unexpected completion: %+v %v", item, err)
	}

	trainingAdded := addDefaultItem(t, fixture.service, "char_test", 2, 1, 0)
	trainingID := trainingAdded.Items[0].ID
	item, err = fixture.service.Queue.ApplyStepOutcome(trainingID, StepOutcome{
		ResultDetail: "Completed",
		SkillMastery: []*float64{floatPtr(0), floatPtr(2), floatPtr(0)},
	}, defaultQueueSettings)
	if err != nil {
		t.Fatalf("training outcome: %v", err)
	}
	if item.Phase != PhaseTraining || item.StartedLevel == nil || *item.StartedLevel != 2 {
		t.Fatalf("unexpected training state: %+v", item)
	}
	if item.ConfirmedLevel != 0 || item.LevelVerified || item.TrainingStartedAt == nil || item.NextProbeAt == nil {
		t.Fatalf("unexpected training details: %+v", item)
	}
	nextProbe, ok := parseTimestamp(*item.NextProbeAt)
	if !ok || nextProbe.Sub(fixture.clock.Now()) != time.Hour {
		t.Fatalf("expected 60 minute probe: %v (%v)", item.NextProbeAt, nextProbe)
	}

	item, err = fixture.service.Queue.ApplyStepOutcome(trainingID, StepOutcome{ResultDetail: "TrainingRoomBusy"}, defaultQueueSettings)
	if err != nil || item.Phase != PhaseTraining || item.Blocked != nil {
		t.Fatalf("busy with training history: %+v %v", item, err)
	}

	item, err = fixture.service.Queue.ApplyStepOutcome(trainingID, StepOutcome{ResultDetail: "RecognitionFailed"}, defaultQueueSettings)
	if err != nil || item.Phase != PhaseTraining || item.ConsecutiveFailures != 1 {
		t.Fatalf("first recognition failure: %+v %v", item, err)
	}
	if item.LastErrorCode == nil || *item.LastErrorCode != "AGENT_MASTERY_RECOGNITIONFAILED" || item.NextProbeAt == nil {
		t.Fatalf("unexpected first failure details: %+v", item)
	}
	message := "日志无法确认"
	item, err = fixture.service.Queue.ApplyStepOutcome(trainingID, StepOutcome{ResultDetail: "RecognitionFailed", Message: &message}, defaultQueueSettings)
	if err != nil {
		t.Fatalf("second recognition failure: %v", err)
	}
	if item.Phase != PhaseFailed || item.ConsecutiveFailures != 2 || item.Blocked == nil || item.Blocked.Message != message {
		t.Fatalf("unexpected failed state: %+v", item)
	}
	status, err := fixture.service.Queue.Status()
	if err != nil || status.Campaign.Status != CampaignBlocked || status.Campaign.PausedReason == nil || *status.Campaign.PausedReason != message {
		t.Fatalf("campaign should be blocked: %+v %v", status.Campaign, err)
	}

	blockedFixture := newTestFixture(t, nil)
	blockedAdded := addDefaultItem(t, blockedFixture.service, "char_test", 1, 3, 0)
	blockedID := blockedAdded.Items[0].ID
	item, err = blockedFixture.service.Queue.ApplyStepOutcome(blockedID, StepOutcome{ResultDetail: "ResourceInsufficient"}, defaultQueueSettings)
	if err != nil || item.Phase != PhaseBlocked || item.Blocked == nil {
		t.Fatalf("resource blocked: %+v %v", item, err)
	}
	if item.Blocked.Code != "AGENT_MASTERY_RESOURCE_INSUFFICIENT" || !item.Blocked.Retryable {
		t.Fatalf("unexpected resource blocked info: %+v", item.Blocked)
	}
	item, err = blockedFixture.service.Queue.ApplyStepOutcome(blockedID, StepOutcome{ResultDetail: "Unsupported"}, defaultQueueSettings)
	if err != nil || item.Blocked == nil || item.Blocked.Retryable {
		t.Fatalf("unsupported should be non-retryable: %+v %v", item, err)
	}

	advanceFixture := newTestFixture(t, nil)
	advanceAdded := addDefaultItem(t, advanceFixture.service, "char_test", 1, 3, 0)
	awaitingID := advanceAdded.Items[0].ID
	_, _ = advanceFixture.service.Queue.ApplyStepOutcome(awaitingID, StepOutcome{ResultDetail: "ResourceInsufficient"}, defaultQueueSettings)
	// Disable the only remaining item so advancement sees only blocked state.
	disabled := false
	_, _ = advanceFixture.service.Queue.UpdateItem(awaitingID, ItemPatch{Enabled: &disabled})
	advanced, err := advanceFixture.service.Queue.AdvanceCampaign()
	if err != nil {
		t.Fatalf("advance: %v", err)
	}
	if advanced.Campaign.Status != CampaignBlocked || advanced.Campaign.ActiveItemID != nil {
		t.Fatalf("unexpected blocked advance: %+v", advanced.Campaign)
	}
	if advanced.NextActionableItem != nil {
		t.Fatalf("no next actionable expected: %+v", advanced.NextActionableItem)
	}
}

func TestTrainingRoomBusyWithoutHistoryAndTransientReset(t *testing.T) {
	fixture := newTestFixture(t, nil)
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	id := added.Items[0].ID

	item, err := fixture.service.Queue.ApplyStepOutcome(id, StepOutcome{ResultDetail: "TrainingRoomBusy"}, defaultQueueSettings)
	if err != nil || item.Phase != PhaseBlocked || item.Blocked == nil {
		t.Fatalf("busy without history: %+v %v", item, err)
	}
	if item.Blocked.Code != "AGENT_MASTERY_TRAINING_ROOM_BUSY" || !item.Blocked.Retryable || item.NextProbeAt != nil {
		t.Fatalf("unexpected busy info: %+v", item)
	}

	retried, err := fixture.service.Queue.RetryItem(id)
	if err != nil || retried.Phase != PhaseQueued || retried.Blocked != nil || retried.ConsecutiveFailures != 0 {
		t.Fatalf("retry blocked: %+v %v", retried, err)
	}
	retryAt := formatISO(fixture.clock.Now().Add(time.Minute))
	reset, err := fixture.service.Queue.ResetItemAfterTransientError(id, TransientReset{
		Code:    "AGENT_MASTERY_TRANSIENT_ERROR",
		Message: "网络错误",
		RetryAt: retryAt,
	})
	if err != nil {
		t.Fatalf("transient reset: %v", err)
	}
	if reset.Phase != PhaseQueued || reset.ConsecutiveFailures != 1 || reset.NextProbeAt == nil || *reset.NextProbeAt != retryAt {
		t.Fatalf("unexpected transient reset: %+v", reset)
	}
	if reset.Blocked == nil || reset.Blocked.Code != "AGENT_MASTERY_TRANSIENT_ERROR" || reset.Blocked.Message != "网络错误" {
		t.Fatalf("unexpected transient blocked info: %+v", reset.Blocked)
	}
}

func TestRecoverOnStartup(t *testing.T) {
	fixture := newTestFixture(t, nil)
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	id := added.Items[0].ID
	if _, err := fixture.service.Queue.StartCampaign(CampaignContext{}); err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := fixture.service.Queue.MarkItemStarting(id, MarkStartingInput{RunID: "run-9", Attempt: 2}); err != nil {
		t.Fatalf("mark starting: %v", err)
	}
	if err := fixture.service.RecoverOnStartup(); err != nil {
		t.Fatalf("recover: %v", err)
	}
	status, err := fixture.service.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Campaign.Status != CampaignInterrupted || status.Campaign.ActiveStepRunID != nil {
		t.Fatalf("campaign not interrupted: %+v", status.Campaign)
	}
	if status.Campaign.PausedReason == nil || !strings.Contains(*status.Campaign.PausedReason, "服务重启") {
		t.Fatalf("recovery reason: %v", status.Campaign.PausedReason)
	}
	item := status.Items[0]
	if item.Phase != PhaseInterrupted || item.ActiveRunID != nil || item.Recovery == nil {
		t.Fatalf("item not interrupted: %+v", item)
	}
	if item.Recovery.PreviousPhase != PhaseStarting || item.Recovery.PreviousRunID == nil || *item.Recovery.PreviousRunID != "run-9" {
		t.Fatalf("unexpected recovery: %+v", item.Recovery)
	}
}

func floatPtr(value float64) *float64 { return &value }

func stringPtrValue(value string) *string { return &value }
