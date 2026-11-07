package copilot

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

type fakeCommandCall struct {
	command  string
	args     []string
	taskName string
	taskType string
	wait     bool
}

type fakeExecutionExecutor struct {
	mu           sync.Mutex
	taskConfigs  []map[string]any
	taskWaits    []bool
	commandCalls []fakeCommandCall
	runTask      func(ctx context.Context, config map[string]any) (domainrun.DTO, error)
	runCommand   func(ctx context.Context, command string, args []string) (domainrun.DTO, error)
	stopCalls    int
}

func (e *fakeExecutionExecutor) RunTask(_ context.Context, taskConfig map[string]any, wait bool) (domainrun.DTO, error) {
	e.mu.Lock()
	e.taskConfigs = append(e.taskConfigs, taskConfig)
	e.taskWaits = append(e.taskWaits, wait)
	e.mu.Unlock()
	if e.runTask != nil {
		return e.runTask(context.Background(), taskConfig)
	}
	return domainrun.DTO{State: domainrun.StatusSucceeded}, nil
}

func (e *fakeExecutionExecutor) RunCommand(_ context.Context, command string, args []string, taskName, taskType string, wait bool) (domainrun.DTO, error) {
	e.mu.Lock()
	e.commandCalls = append(e.commandCalls, fakeCommandCall{
		command: command, args: append([]string{}, args...),
		taskName: taskName, taskType: taskType, wait: wait,
	})
	e.mu.Unlock()
	if e.runCommand != nil {
		return e.runCommand(context.Background(), command, args)
	}
	return domainrun.DTO{State: domainrun.StatusSucceeded}, nil
}

func (e *fakeExecutionExecutor) Stop(context.Context) error {
	e.mu.Lock()
	e.stopCalls++
	e.mu.Unlock()
	return nil
}

func (e *fakeExecutionExecutor) taskConfig(index int) map[string]any {
	e.mu.Lock()
	defer e.mu.Unlock()
	if index < 0 || index >= len(e.taskConfigs) {
		return nil
	}
	return e.taskConfigs[index]
}

func (e *fakeExecutionExecutor) taskCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.taskConfigs)
}

type fakeLeaseRunner struct {
	mu       sync.Mutex
	requests []LeaseRequest
	runs     int
}

func (l *fakeLeaseRunner) Run(ctx context.Context, request LeaseRequest, fn func(context.Context) error) error {
	l.mu.Lock()
	l.requests = append(l.requests, request)
	l.runs++
	l.mu.Unlock()
	return fn(ctx)
}

type executionFixture struct {
	service   *Service
	configDir string
	dataDir   string
	maaDir    string
}

func newExecutionFixture(t *testing.T, executor Executor, lease LeaseRunner) *executionFixture {
	t.Helper()
	server, _ := newPRTSFixture(t)
	maaDir := t.TempDir()
	writeJSONFile(t, filepath.Join(maaDir, "resource", "tasks", "tasks.json"), map[string]any{
		"BattleStart": map[string]any{"next": []any{"Stop"}},
	})
	configDir := t.TempDir()
	dataDir := t.TempDir()
	prts := NewPRTSClient(PRTSClientOptions{
		BaseURL:       server.URL,
		StageStatsURL: "-",
		HTTPClient:    server.Client(),
		Sleep:         func(context.Context, time.Duration) error { return nil },
	})
	service := NewWithOptions(ServiceOptions{
		Paths: config.Paths{
			DataDir:      dataDir,
			MaaDataDir:   maaDir,
			MaaConfigDir: configDir,
		},
		PRTS:        prts,
		Now:         func() time.Time { return time.UnixMilli(1700000000000).UTC() },
		Executor:    executor,
		LeaseRunner: lease,
	})
	return &executionFixture{service: service, configDir: configDir, dataDir: dataDir, maaDir: maaDir}
}

func nativeExecutionPlan() *Plan {
	return &Plan{
		SetID: "1",
		Name:  "原生命令测试集",
		Items: []PlanItem{
			{ID: 10, StageID: "act_test_01", Stage: "T-1", SupportsRaid: true, Operators: []any{}},
			{ID: 11, StageID: "act_test_s01", Stage: "T-S-1", SupportsRaid: true, Operators: []any{}},
		},
		Entries: []PlanEntry{
			{Key: "0:10:normal", ItemIndex: 0, CopilotID: 10, StageID: "act_test_01", DisplayStage: "T-1", Mode: "normal"},
			{Key: "1:11:normal", ItemIndex: 1, CopilotID: 11, StageID: "act_test_s01", DisplayStage: "T-S-1", Mode: "normal"},
		},
	}
}

// dynamicExecutionPlan makes the second entry a preset formation group so the
// dynamic path exercises group boundaries and the preset resource.
func dynamicExecutionPlan() *Plan {
	return &Plan{
		SetID: "1",
		Name:  "动态任务测试集",
		Items: []PlanItem{
			{ID: 10, StageID: "act_test_01", Stage: "T-1", SupportsRaid: true, Operators: []any{}},
			{ID: 11, StageID: "act_test_s01", Stage: "T-S-1", PresetFormation: true, Operators: []any{}},
		},
		Entries: []PlanEntry{
			{Key: "0:10:normal", ItemIndex: 0, CopilotID: 10, StageID: "act_test_01", DisplayStage: "T-1", Mode: "normal"},
			{Key: "1:11:normal", ItemIndex: 1, CopilotID: 11, StageID: "act_test_s01", DisplayStage: "T-S-1", Mode: "normal", PresetFormation: true},
		},
	}
}

func taskList(t *testing.T, config map[string]any) []any {
	t.Helper()
	tasks, ok := config["tasks"].([]any)
	if !ok || len(tasks) == 0 {
		t.Fatalf("task config = %#v", config)
	}
	return tasks
}

func taskParams(t *testing.T, task any) map[string]any {
	t.Helper()
	record := asRecord(task)
	if record == nil {
		t.Fatalf("task = %#v", task)
	}
	params := asRecord(record["params"])
	if params == nil {
		t.Fatalf("params = %#v", record)
	}
	return params
}

func copilotList(t *testing.T, params map[string]any) []any {
	t.Helper()
	list, ok := params["copilot_list"].([]any)
	if !ok {
		t.Fatalf("copilot_list = %#v", params)
	}
	return list
}

func appErrorCode(t *testing.T, err error) string {
	t.Helper()
	appError, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("expected app error, got %v", err)
	}
	return appError.Code
}

func TestExecutePlanNativeDelegation(t *testing.T) {
	executor := &fakeExecutionExecutor{}
	lease := &fakeLeaseRunner{}
	fixture := newExecutionFixture(t, executor, lease)

	result, err := fixture.service.ExecutePlan(context.Background(), PlanExecution{
		SetID: "1",
		Raid:  "normal",
		Plan:  nativeExecutionPlan(),
	})
	if err != nil {
		t.Fatal(err)
	}
	executor.mu.Lock()
	if len(executor.commandCalls) != 1 || len(executor.taskConfigs) != 0 {
		t.Fatalf("command calls = %#v, task configs = %#v", executor.commandCalls, executor.taskConfigs)
	}
	call := executor.commandCalls[0]
	executor.mu.Unlock()
	if call.command != "copilot" || strings.Join(call.args, " ") != "prts://s1 --batch" {
		t.Fatalf("native call = %#v", call)
	}
	if call.taskName != "原生命令测试集" || call.taskType != "copilot" || !call.wait {
		t.Fatalf("native task identity = %#v", call)
	}
	if lease.runs != 0 {
		t.Fatalf("native path must not wrap the executor lease, runs = %d", lease.runs)
	}
	if result.Data["source"] != "native" {
		t.Fatalf("data source = %#v", result.Data["source"])
	}
	if len(result.Results) != 2 || !result.Results[0].Success || !result.Results[1].Success {
		t.Fatalf("results = %#v", result.Results)
	}
	completed := fixture.service.LoadProgress()["1"]
	if len(completed) != 2 {
		t.Fatalf("completed = %#v", completed)
	}
}

func TestExecutePlanDynamicTask(t *testing.T) {
	executor := &fakeExecutionExecutor{}
	lease := &fakeLeaseRunner{}
	fixture := newExecutionFixture(t, executor, lease)
	lifecycle := &ExecutionLifecycle{RunID: "run-dynamic"}

	result, err := fixture.service.ExecutePlan(context.Background(), PlanExecution{
		SetID: "1",
		Raid:  "normal",
		Plan:  dynamicExecutionPlan(),
		Options: map[string]any{
			"loopTimes": 2,
			"preTasks":  []any{map[string]any{"name": "导航", "type": "Stage", "params": map[string]any{}}},
		},
		Lifecycle: lifecycle,
	})
	if err != nil {
		t.Fatal(err)
	}
	if executor.taskCount() != 2 {
		t.Fatalf("task count = %d, configs = %#v", executor.taskCount(), executor.taskConfigs)
	}
	if lease.runs != 1 || lease.requests[0].Source != "copilot-set" || lease.requests[0].Command != "copilot-plan" {
		t.Fatalf("lease requests = %#v", lease.requests)
	}
	first := executor.taskConfig(0)
	tasks := taskList(t, first)
	if len(tasks) != 2 || asRecord(tasks[0])["name"] != "导航" {
		t.Fatalf("first task config = %#v", first)
	}
	copilotTask := tasks[1].(map[string]any)
	if copilotTask["type"] != "Copilot" {
		t.Fatalf("first copilot task = %#v", copilotTask)
	}
	firstList := copilotList(t, taskParams(t, copilotTask))
	if len(firstList) != 2 {
		t.Fatalf("first list = %#v", firstList)
	}
	firstItem := asRecord(firstList[0])
	if firstItem["stage_name"] != "T-1" || firstItem["is_raid"] != false {
		t.Fatalf("first list item = %#v", firstItem)
	}
	if firstItem["filename"] != filepath.Join(fixture.configDir, "copilot-plans", "1", "0-10-normal-1.json") {
		t.Fatalf("first filename = %#v", firstItem["filename"])
	}
	if !jsonstore.Exists(firstItem["filename"].(string)) {
		t.Fatalf("repeat file missing at %s", firstItem["filename"])
	}
	if repeat := asRecord(firstList[1]); repeat["filename"] != filepath.Join(fixture.configDir, "copilot-plans", "1", "0-10-normal-2.json") {
		t.Fatalf("second repeat = %#v", repeat)
	}

	second := executor.taskConfig(1)
	secondTasks := taskList(t, second)
	if len(secondTasks) != 1 {
		t.Fatalf("second task config = %#v", second)
	}
	secondParams := taskParams(t, secondTasks[0])
	secondList := copilotList(t, secondParams)
	if len(secondList) != 2 {
		t.Fatalf("second list = %#v", secondList)
	}
	if secondParams["formation"] != false {
		t.Fatalf("preset formation params = %#v", secondParams)
	}
	if !jsonstore.Exists(filepath.Join(fixture.configDir, "resource", "tasks", "tasks.json")) {
		t.Fatal("preset formation resource was not written")
	}

	if result.Data["source"] != "dynamic" || result.Data["success"] != true || result.Data["loopTimes"] != 2 {
		t.Fatalf("data = %#v", result.Data)
	}
	if len(result.TaskResults) != 2 || result.TaskResults[0].Status != ProgressSuccess || result.TaskResults[1].Status != ProgressSuccess {
		t.Fatalf("task results = %#v", result.TaskResults)
	}
	completed := fixture.service.LoadProgress()["1"]
	if len(completed) != 2 {
		t.Fatalf("completed = %#v", completed)
	}
}

func TestExecuteSelectedEntries(t *testing.T) {
	executor := &fakeExecutionExecutor{}
	lease := &fakeLeaseRunner{}
	fixture := newExecutionFixture(t, executor, lease)
	entries := []PlanEntry{
		{Key: "0:10:normal", ItemIndex: 0, CopilotID: 10, DisplayStage: "T-1", Mode: "normal"},
		{Key: "1:11:normal", ItemIndex: 1, CopilotID: 11, DisplayStage: "T-S-1", Mode: "normal"},
		{Key: "2:10:normal", ItemIndex: 2, CopilotID: 10, DisplayStage: "T-1", Mode: "normal"},
	}

	result, err := fixture.service.ExecuteSelectedEntries(context.Background(), EntriesExecution{
		PlanID:  "activity-ea-1",
		Name:    "活动作业",
		Entries: entries[1:],
	})
	if err != nil {
		t.Fatal(err)
	}
	if executor.taskCount() != 1 {
		t.Fatalf("task count = %d", executor.taskCount())
	}
	visited := fixture.service.LoadProgress()
	if len(visited) != 0 {
		t.Fatalf("selected entries must not write plan progress: %#v", visited)
	}
	params := taskParams(t, taskList(t, executor.taskConfig(0))[0])
	list := copilotList(t, params)
	if len(list) != 2 {
		t.Fatalf("list = %#v", list)
	}
	if asRecord(list[0])["stage_name"] != "T-S-1" || asRecord(list[1])["stage_name"] != "T-1" {
		t.Fatalf("selected entry order = %#v", list)
	}
	if len(result.Results) != 2 || !result.Results[0].Success || !result.Results[1].Success {
		t.Fatalf("results = %#v", result.Results)
	}
	if result.Data["source"] != "dynamic" || result.Data["setId"] != "activity-ea-1" {
		t.Fatalf("data = %#v", result.Data)
	}
	if lease.requests[0].Source != "activity-copilot" {
		t.Fatalf("lease source = %#v", lease.requests)
	}
	if _, exists := result.Data["plan"]; exists {
		t.Fatalf("selected entries must not report a plan: %#v", result.Data)
	}
}

func TestExecutePlanStop(t *testing.T) {
	executor := &fakeExecutionExecutor{
		runTask: func(context.Context, map[string]any) (domainrun.DTO, error) {
			return domainrun.DTO{State: domainrun.StatusStopped}, nil
		},
	}
	fixture := newExecutionFixture(t, executor, &fakeLeaseRunner{})

	result, err := fixture.service.ExecutePlan(context.Background(), PlanExecution{
		SetID:     "1",
		Raid:      "normal",
		Plan:      nativeExecutionPlan(),
		Lifecycle: &ExecutionLifecycle{RunID: "run-stop"},
	})
	if err == nil {
		t.Fatal("expected stop error")
	}
	if code := appErrorCode(t, err); code != "COPILOT_PLAN_STOPPED" {
		t.Fatalf("error code = %s", code)
	}
	appError, _ := apperrors.As(err)
	if appError.StatusCode != http.StatusConflict || appError.Retryable {
		t.Fatalf("stop error = %#v", appError)
	}
	if result == nil || len(result.Results) != 2 {
		t.Fatalf("partial result = %#v", result)
	}
	for _, item := range result.Results {
		if item.Success {
			t.Fatalf("stopped entry marked success: %#v", item)
		}
	}
	if len(result.TaskResults) != 2 || result.TaskResults[0].Status != ProgressStopped || result.TaskResults[1].Status != ProgressPending {
		t.Fatalf("task results = %#v", result.TaskResults)
	}
	if completed := fixture.service.LoadProgress()["1"]; len(completed) != 0 {
		t.Fatalf("stopped execution must not record completion: %#v", completed)
	}
}

func TestExecutePlanPartialFailure(t *testing.T) {
	executor := &fakeExecutionExecutor{}
	executor.runTask = func(_ context.Context, config map[string]any) (domainrun.DTO, error) {
		executor.mu.Lock()
		calls := len(executor.taskConfigs)
		executor.mu.Unlock()
		if calls >= 2 {
			return domainrun.DTO{}, errors.New("模拟执行失败")
		}
		return domainrun.DTO{State: domainrun.StatusSucceeded}, nil
	}
	fixture := newExecutionFixture(t, executor, &fakeLeaseRunner{})

	result, err := fixture.service.ExecutePlan(context.Background(), PlanExecution{
		SetID:     "1",
		Raid:      "normal",
		Plan:      dynamicExecutionPlan(),
		Lifecycle: &ExecutionLifecycle{RunID: "run-partial"},
	})
	if err == nil {
		t.Fatal("expected execution error")
	}
	if code := appErrorCode(t, err); code != "COPILOT_PLAN_FAILED" {
		t.Fatalf("error code = %s", code)
	}
	appError, _ := apperrors.As(err)
	if appError.StatusCode != http.StatusUnprocessableEntity || !appError.Retryable {
		t.Fatalf("error = %#v", appError)
	}
	if result == nil || len(result.Results) != 2 {
		t.Fatalf("partial result = %#v", result)
	}
	if !result.Results[0].Success || result.Results[1].Success {
		t.Fatalf("partial results = %#v", result.Results)
	}
	if result.Results[1].Error == "" {
		t.Fatalf("failed entry has no error message: %#v", result.Results[1])
	}
	completed := fixture.service.LoadProgress()["1"]
	if len(completed) != 1 || completed[0] != "0:10:normal" {
		t.Fatalf("completed = %#v", completed)
	}
	if result.Data["success"] != false {
		t.Fatalf("data success = %#v", result.Data["success"])
	}
	if results, ok := result.Data["results"].([]ExecutionEntryResult); !ok || len(results) != 2 {
		t.Fatalf("data results = %#v", result.Data["results"])
	}
	if len(result.TaskResults) != 2 || result.TaskResults[0].Status != ProgressSuccess || result.TaskResults[1].Status != ProgressFailed {
		t.Fatalf("task results = %#v", result.TaskResults)
	}
}

func TestExecutePlanProgress(t *testing.T) {
	executor := &fakeExecutionExecutor{}
	fixture := newExecutionFixture(t, executor, &fakeLeaseRunner{})
	started := 0
	progressEvents := make([]map[string]any, 0)
	taskSnapshots := make([][]ProgressEntryResult, 0)
	lifecycle := &ExecutionLifecycle{
		RunID:     "run-progress",
		OnStarted: func() { started++ },
		OnProgress: func(progress map[string]any, taskResults []ProgressEntryResult) {
			progressEvents = append(progressEvents, progress)
			taskSnapshots = append(taskSnapshots, taskResults)
		},
	}

	result, err := fixture.service.ExecutePlan(context.Background(), PlanExecution{
		SetID:     "1",
		Raid:      "normal",
		Plan:      dynamicExecutionPlan(),
		Lifecycle: lifecycle,
	})
	if err != nil {
		t.Fatal(err)
	}
	if started != 1 {
		t.Fatalf("started = %d", started)
	}
	if len(progressEvents) < 2 {
		t.Fatalf("progress events = %#v", progressEvents)
	}
	if progressEvents[0]["phase"] != "starting" || progressEvents[0]["totalSteps"] != 2 {
		t.Fatalf("starting progress = %#v", progressEvents[0])
	}
	if len(taskSnapshots) == 0 || len(taskSnapshots[0]) != 2 {
		t.Fatalf("starting snapshot = %#v", taskSnapshots)
	}
	if progressEvents[1]["phase"] != "running" || progressEvents[1]["currentStage"] != "T-1" {
		t.Fatalf("running progress = %#v", progressEvents[1])
	}
	if len(result.TaskResults) != 2 {
		t.Fatalf("result task results = %#v", result.TaskResults)
	}
}

func TestManualManagerUsesExecutionLayer(t *testing.T) {
	executor := &fakeExecutionExecutor{}
	lease := &fakeLeaseRunner{}
	fixture := newExecutionFixture(t, executor, lease)

	started, err := fixture.service.Manual().StartManualSet(context.Background(), ManualStartRequest{
		SetID:           "1",
		Raid:            "normal",
		SelectedIndexes: []any{0, 1},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !started.WaitingForNext || started.NextItemIndex == nil || *started.NextItemIndex != 1 {
		t.Fatalf("started = %#v", started)
	}
	if executor.taskCount() != 1 {
		t.Fatalf("manual steps = %d", executor.taskCount())
	}
	if completed := fixture.service.LoadProgress()["1"]; len(completed) != 1 || completed[0] != "0:10:normal" {
		t.Fatalf("completed after first step = %#v", completed)
	}

	continued, err := fixture.service.Manual().ContinueManualSet(context.Background(), started.RunID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !continued.Finished || continued.State != ManualStateSucceeded {
		t.Fatalf("continued = %#v", continued)
	}
	if executor.taskCount() != 2 {
		t.Fatalf("manual steps after continue = %d", executor.taskCount())
	}
	completed := fixture.service.LoadProgress()["1"]
	if len(completed) != 2 {
		t.Fatalf("completed after continue = %#v", completed)
	}
	if lease.runs != 2 {
		t.Fatalf("manual lease runs = %d", lease.runs)
	}
}

func TestManualManagerWithoutExecutorStaysUnsupported(t *testing.T) {
	service := NewWithOptions(ServiceOptions{Paths: config.Paths{DataDir: t.TempDir()}})
	_, err := service.Manual().StartManualSet(context.Background(), ManualStartRequest{SetID: "1"})
	if err == nil {
		t.Fatal("expected unsupported error")
	}
	if code := appErrorCode(t, err); code != "COPILOT_MANUAL_UNSUPPORTED" {
		t.Fatalf("error code = %s", code)
	}
}
