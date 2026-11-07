package mastery

import (
	"context"
	"strings"
	"testing"
	"time"

	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

func TestBuildOperProgressTaskConfig(t *testing.T) {
	role := "Caster"
	item := MasteryQueueItem{
		ID:           "char_test:2",
		OperatorID:   "char_test",
		OperatorName: "测试干员",
		Role:         &role,
		SkillIndex:   2,
		SkillName:    "测试技能二",
	}
	config, err := BuildOperProgressTaskConfig(item, 2, "Official", TaskBuildOptions{})
	if err != nil {
		t.Fatalf("build config: %v", err)
	}
	if config["client_type"] != "Official" {
		t.Fatalf("client_type: %v", config["client_type"])
	}
	tasks, _ := config["tasks"].([]any)
	if len(tasks) != 2 {
		t.Fatalf("expected StartUp and OperProgress, got %+v", tasks)
	}
	startup, _ := tasks[0].(map[string]any)
	if startup["type"] != "StartUp" || startup["name"] != "启动游戏" {
		t.Fatalf("unexpected startup: %+v", startup)
	}
	startupParams, _ := startup["params"].(map[string]any)
	if startupParams["start_game_enabled"] != false || startupParams["client_type"] != "Official" {
		t.Fatalf("unexpected startup params: %+v", startupParams)
	}
	operProgress, _ := tasks[1].(map[string]any)
	if operProgress["type"] != "OperProgress" || operProgress["name"] != "专精 测试干员 测试技能二 M2" {
		t.Fatalf("unexpected oper progress: %+v", operProgress)
	}
	params, _ := operProgress["params"].(map[string]any)
	plans, _ := params["plans"].([]any)
	plan, _ := plans[0].(map[string]any)
	if plan["name"] != "测试干员" || plan["role"] != "Caster" {
		t.Fatalf("unexpected plan: %+v", plan)
	}
	mastery, _ := plan["skill_mastery"].([]int)
	if len(mastery) != 3 || mastery[0] != 0 || mastery[1] != 2 || mastery[2] != 0 {
		t.Fatalf("unexpected skill_mastery: %+v", mastery)
	}
	if _, exists := plan["elite"]; exists {
		t.Fatal("plan must not contain elite")
	}
	if _, exists := plan["skill_level"]; exists {
		t.Fatal("plan must not contain skill_level")
	}

	withClose, err := BuildOperProgressTaskConfig(item, 3, "Official", TaskBuildOptions{StartGameEnabled: true, CloseDown: true})
	if err != nil {
		t.Fatalf("build close config: %v", err)
	}
	closeTasks, _ := withClose["tasks"].([]any)
	if len(closeTasks) != 3 {
		t.Fatalf("expected close/start/oper tasks: %+v", closeTasks)
	}
	closeTask, _ := closeTasks[0].(map[string]any)
	if closeTask["type"] != "CloseDown" {
		t.Fatalf("unexpected close task: %+v", closeTask)
	}
	startTask, _ := closeTasks[1].(map[string]any)
	startParams, _ := startTask["params"].(map[string]any)
	if startParams["start_game_enabled"] != true {
		t.Fatalf("start game flag: %+v", startParams)
	}

	noRole := item
	noRole.Role = nil
	noRoleConfig, err := BuildOperProgressTaskConfig(noRole, 1, "Official", TaskBuildOptions{})
	if err != nil {
		t.Fatalf("no role config: %v", err)
	}
	noRoleTasks, _ := noRoleConfig["tasks"].([]any)
	noRoleOper, _ := noRoleTasks[1].(map[string]any)
	noRoleParams, _ := noRoleOper["params"].(map[string]any)
	noRolePlans, _ := noRoleParams["plans"].([]any)
	noRolePlan, _ := noRolePlans[0].(map[string]any)
	if _, exists := noRolePlan["role"]; exists {
		t.Fatal("role must be omitted when empty")
	}

	if _, err := BuildOperProgressTaskConfig(item, 1, "NotAClient", TaskBuildOptions{}); err == nil {
		t.Fatal("invalid client type must error")
	}
}

func TestExtractResultDetail(t *testing.T) {
	item := MasteryQueueItem{OperatorName: "测试干员"}
	parsed := ExtractResultDetail(completedCallback, item)
	if parsed.ResultDetail != "Completed" || parsed.Result == nil || *parsed.Result != "Success" {
		t.Fatalf("unexpected parse: %+v", parsed)
	}
	if !parsed.LogCheckpointPresent || len(parsed.SkillMastery) != 3 {
		t.Fatalf("unexpected parse markers: %+v", parsed)
	}
	if parsed.SkillMastery[2] == nil || *parsed.SkillMastery[2] != 2 {
		t.Fatalf("skill mastery: %+v", parsed.SkillMastery)
	}

	for _, detail := range []string{"AlreadySatisfied", "TrainingRoomBusy", "PrerequisiteNotMet", "RecognitionFailed", "ResourceInsufficient"} {
		logLine := `Assistant::append_callback | SubTaskExtraInfo {"what":"OperProgressDetail","taskchain":"OperProgress","details":{"role":"Caster","name":"测试干员","result":"Success","result_detail":"` + detail + `","skill_mastery":[2,0,0]}}`
		got := ExtractResultDetail(logLine, item)
		if got.ResultDetail != detail {
			t.Fatalf("detail %s = %s", detail, got.ResultDetail)
		}
	}

	events := []string{
		`Assistant::append_callback | SubTaskExtraInfo {"what":"OperProgressDetail","details":{"name":"测试干员","result_detail":"ResourceInsufficient","skill_mastery":[1,0,0]}}`,
		`Assistant::append_callback | SubTaskExtraInfo {"what":"OperProgressDetail","details":{"name":"其他干员","result_detail":"Completed","skill_mastery":[0,1,0]}}`,
	}
	matched := ExtractResultDetail(strings.Join(events, "\n"), item)
	if matched.ResultDetail != "ResourceInsufficient" {
		t.Fatalf("last matching event was not selected: %+v", matched)
	}

	unknown := ExtractResultDetail("no callbacks here", item)
	if unknown.ResultDetail != "Unknown" || unknown.LogCheckpointPresent || unknown.Result != nil || unknown.SkillMastery != nil {
		t.Fatalf("unexpected unknown parse: %+v", unknown)
	}

	invalid := ExtractResultDetail("Assistant::append_callback | SubTaskExtraInfo {broken", item)
	if invalid.LogCheckpointPresent {
		t.Fatalf("invalid json must be skipped: %+v", invalid)
	}
}

func TestCompareVersions(t *testing.T) {
	if CompareVersions(ParseVersion("v0.7.8"), ParseVersion("0.7.8")) != 0 {
		t.Fatal("equal versions")
	}
	if CompareVersions(ParseVersion("0.7.7"), ParseVersion("0.7.8")) >= 0 {
		t.Fatal("0.7.7 should be older")
	}
	if CompareVersions(ParseVersion("6.21.5"), ParseVersion("6.21.4")) <= 0 {
		t.Fatal("6.21.5 should be newer")
	}
	if CompareVersions(nil, ParseVersion("0.7.8")) != -1 {
		t.Fatal("nil version should be older")
	}
	if ParseVersion("not-a-version") != nil {
		t.Fatal("invalid version should be nil")
	}
	if got := ParseVersion("v6.21.4"); len(got) != 3 || got[0] != 6 || got[2] != 4 {
		t.Fatalf("parse: %+v", got)
	}
}

func TestExecuteStep(t *testing.T) {
	fixture := newTestFixture(t, func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error) {
		return domainrun.DTO{
			RunID:  "run-42",
			Result: map[string]any{"stdout": completedCallback},
		}, nil
	})
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	item := added.Items[0]

	outcome, err := fixture.service.Run.ExecuteStep(context.Background(), item, "Official", StepOptions{})
	if err != nil {
		t.Fatalf("execute step: %v", err)
	}
	if outcome.ResultDetail != "Completed" || outcome.RunID == nil || *outcome.RunID != "run-42" || !outcome.LogCheckpointPresent {
		t.Fatalf("unexpected outcome: %+v", outcome)
	}
	call := fixture.executor.lastCall()
	if call == nil || call["client_type"] != "Official" {
		t.Fatalf("unexpected executor task config: %+v", call)
	}
	tasks, _ := call["tasks"].([]any)
	operProgress, _ := tasks[1].(map[string]any)
	params, _ := operProgress["params"].(map[string]any)
	plans, _ := params["plans"].([]any)
	plan, _ := plans[0].(map[string]any)
	mastery, _ := plan["skill_mastery"].([]int)
	if len(mastery) != 3 || mastery[0] != 1 {
		t.Fatalf("step target should be confirmed+1: %+v", mastery)
	}

	completed := item
	completed.ConfirmedLevel = 3
	_, err = fixture.service.Run.ExecuteStep(context.Background(), completed, "Official", StepOptions{})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_ALREADY_COMPLETED" {
		t.Fatalf("already completed error: %v", err)
	}

	fixture.versions.cli = "0.7.7"
	_, err = fixture.service.Run.ExecuteStep(context.Background(), item, "Official", StepOptions{})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_UNSUPPORTED_VERSION" || appErr.StatusCode != 409 || !appErr.Retryable {
		t.Fatalf("unsupported version error: %v", err)
	}
}

func TestExecuteStepErrorMapping(t *testing.T) {
	fixture := newTestFixture(t, func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error) {
		return domainrun.DTO{}, apperrors.WithStatus("MAA_EXECUTION_BUSY", "busy", 409, true, nil)
	})
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	_, err := fixture.service.Run.ExecuteStep(context.Background(), added.Items[0], "Official", StepOptions{})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_EXECUTION_BUSY" {
		t.Fatalf("busy mapping: %v", err)
	}

	stoppedFixture := newTestFixture(t, func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error) {
		return domainrun.DTO{}, &fakeStoppedError{}
	})
	stoppedAdded := addDefaultItem(t, stoppedFixture.service, "char_test", 1, 3, 0)
	_, err = stoppedFixture.service.Run.ExecuteStep(context.Background(), stoppedAdded.Items[0], "Official", StepOptions{})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_STOPPED" {
		t.Fatalf("stopped mapping: %v", err)
	}

	timeoutFixture := newTestFixture(t, func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error) {
		<-ctx.Done()
		return domainrun.DTO{}, ctx.Err()
	})
	timeoutFixture.service.Run.stepTimeout = 20 * time.Millisecond
	timeoutAdded := addDefaultItem(t, timeoutFixture.service, "char_test", 1, 3, 0)
	_, err = timeoutFixture.service.Run.ExecuteStep(context.Background(), timeoutAdded.Items[0], "Official", StepOptions{})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_STEP_TIMEOUT" {
		t.Fatalf("timeout mapping: %v", err)
	}
	if timeoutFixture.executor.stopCount() != 1 {
		t.Fatalf("timeout should stop the executor once, got %d", timeoutFixture.executor.stopCount())
	}
}

func TestExecuteStepUsesLogReader(t *testing.T) {
	fixture := newTestFixture(t, func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error) {
		return domainrun.DTO{RunID: "run-log"}, nil
	})
	fixture.service.Run.logs = &fakeLogReader{content: completedCallback}
	added := addDefaultItem(t, fixture.service, "char_test", 1, 3, 0)
	outcome, err := fixture.service.Run.ExecuteStep(context.Background(), added.Items[0], "Official", StepOptions{})
	if err != nil {
		t.Fatalf("execute with logs: %v", err)
	}
	if outcome.ResultDetail != "Completed" || !outcome.LogCheckpointPresent {
		t.Fatalf("log outcome not used: %+v", outcome)
	}
}

type fakeStoppedError struct{}

func (e *fakeStoppedError) Error() string { return "stopped" }
func (e *fakeStoppedError) Stopped() bool { return true }

type fakeLogReader struct {
	content string
}

func (r *fakeLogReader) CreateCheckpoint(ctx context.Context) (*LogCheckpoint, error) {
	return &LogCheckpoint{Path: "asst.log", Size: 1}, nil
}

func (r *fakeLogReader) ReadSince(ctx context.Context, checkpoint *LogCheckpoint, maxBytes int64) (string, error) {
	return r.content, nil
}
