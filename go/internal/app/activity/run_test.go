package activity

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
)

type fakeExecutor struct {
	mu          sync.Mutex
	taskCalls   []map[string]any
	commandArgs [][]string
	taskErr     error
}

func (f *fakeExecutor) RunTask(_ context.Context, taskConfig map[string]any, _ bool) (domainrun.DTO, error) {
	f.mu.Lock()
	f.taskCalls = append(f.taskCalls, taskConfig)
	f.mu.Unlock()
	return domainrun.DTO{State: domainrun.StatusSucceeded}, f.taskErr
}

func (f *fakeExecutor) RunCommand(_ context.Context, command string, args []string, _, _ string, _ bool) (domainrun.DTO, error) {
	f.mu.Lock()
	f.commandArgs = append(f.commandArgs, append([]string{command}, args...))
	f.mu.Unlock()
	return domainrun.DTO{State: domainrun.StatusSucceeded, Result: map[string]any{"stdout": ""}}, nil
}

func (f *fakeExecutor) Stop(context.Context) error { return nil }

type fakeLease struct {
	calls int
}

func (l *fakeLease) Run(ctx context.Context, _ LeaseRequest, fn func(context.Context) error) error {
	l.calls++
	return fn(ctx)
}

type fakeNavigationLog struct {
	text string
}

func (l *fakeNavigationLog) Checkpoint(context.Context) string { return "checkpoint" }
func (l *fakeNavigationLog) ReadSince(context.Context, string) string {
	return l.text
}

type fakePlanProvider struct {
	plan Plan
	err  error
}

func (p *fakePlanProvider) BuildPlan(context.Context, string, string) (Plan, error) {
	return p.plan, p.err
}

type fakePlanExecutor struct {
	result        *ExecutionResult
	err           error
	planRequests  []PlanExecution
	entryRequests []EntriesExecution
}

func (e *fakePlanExecutor) ExecutePlan(_ context.Context, request PlanExecution) (*ExecutionResult, error) {
	e.planRequests = append(e.planRequests, request)
	return e.result, e.err
}

func (e *fakePlanExecutor) ExecuteSelectedEntries(_ context.Context, request EntriesExecution) (*ExecutionResult, error) {
	e.entryRequests = append(e.entryRequests, request)
	return e.result, e.err
}

type staticResourceDir struct {
	dir string
}

func (p staticResourceDir) ResourceDir(context.Context) (string, error) { return p.dir, nil }

func boolPointer(value bool) *bool { return &value }

func completionFixture(displayStages ...string) *ExecutionResult {
	results := make([]CompletionEntry, 0, len(displayStages))
	for _, stage := range displayStages {
		results = append(results, CompletionEntry{DisplayStage: stage, Success: boolPointer(true)})
	}
	return &ExecutionResult{Results: results, Data: map[string]any{"plan": map[string]any{"setId": "set-1"}}}
}

func runOptions(t *testing.T, paths config.Paths, executor Executor, lease LeaseRunner, planExecutor PlanExecutor) Options {
	t.Helper()
	return Options{
		Paths:         paths,
		Now:           func() time.Time { return testNow() },
		ResourceDir:   staticResourceDir{dir: filepath.Join(paths.MaaDataDir, "resource")},
		Executor:      executor,
		LeaseRunner:   lease,
		PlanExecutor:  planExecutor,
		NavigationLog: &fakeNavigationLog{text: "TaskChainCompleted {\"taskchain\":\"Custom\",\"taskid\":6}\n"},
	}
}

func TestRunCurrentActivitySet(t *testing.T) {
	paths := testPaths(t)
	writeStageActivity(t, paths, stageActivityFixture())
	writeStagesCatalog(t, paths)
	writeReadyStageTasks(t, paths)

	executor := &fakeExecutor{}
	lease := &fakeLease{}
	planExecutor := &fakePlanExecutor{result: completionFixture("EA-6")}
	provider := &fakePlanProvider{plan: Plan{
		SetID: "set-1",
		Name:  "套装",
		Entries: []PlanEntry{
			{ItemIndex: 0, CopilotID: 1, DisplayStage: "EA-6", Mode: "normal"},
			{ItemIndex: 1, CopilotID: 2, DisplayStage: "OL-1", Mode: "normal"},
		},
	}}
	options := runOptions(t, paths, executor, lease, planExecutor)
	options.PlanProvider = provider
	options.PlanExecutor = planExecutor
	service := NewWithOptions(options)

	result, err := service.RunCurrentActivitySet(context.Background(), SetExecutionOptions{SetID: "set-1"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result["executed"] != true || result["source"] != "matching-set" {
		t.Fatalf("result = %#v", result)
	}
	if lease.calls != 1 {
		t.Fatalf("lease calls = %d", lease.calls)
	}
	if len(executor.taskCalls) != 1 {
		t.Fatalf("task calls = %#v", executor.taskCalls)
	}
	tasks, ok := executor.taskCalls[0]["tasks"].([]PreparationTask)
	if !ok || len(tasks) != 6 {
		t.Fatalf("tasks = %#v", executor.taskCalls[0]["tasks"])
	}
	if len(planExecutor.planRequests) != 1 {
		t.Fatalf("plan requests = %#v", planExecutor.planRequests)
	}
	request := planExecutor.planRequests[0]
	if request.SetID != "set-1" || len(request.SelectedIndexes) != 1 || request.SelectedIndexes[0] != 0 {
		t.Fatalf("request = %#v", request)
	}
	if request.Options["navigationStage"] != "EA-6" {
		t.Fatalf("options = %#v", request.Options)
	}
	plan, _ := result["plan"].(map[string]any)
	if plan == nil || plan["activity"] == nil {
		t.Fatalf("plan = %#v", result["plan"])
	}

	progress := service.LoadActivityProgress()
	entry := progress["EA"]
	if len(entry.Stages) != 1 || entry.Stages[0] != "EA-6" {
		t.Fatalf("progress = %#v", entry)
	}
}

func TestRunCurrentActivitySetRequiresSetID(t *testing.T) {
	paths := testPaths(t)
	service := NewWithOptions(Options{Paths: paths, Now: testNow})
	if _, err := service.RunCurrentActivitySet(context.Background(), SetExecutionOptions{}, nil); err == nil {
		t.Fatal("expected error")
	}
}

func TestRunCurrentActivityCopilotsPerStage(t *testing.T) {
	paths := testPaths(t)
	writeStageActivity(t, paths, stageActivityFixture())
	writeStagesCatalog(t, paths)
	writeReadyStageTasks(t, paths)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/copilot/query":
			keyword := r.URL.Query().Get("level_keyword")
			stage := "EA-6"
			if keyword == "main_07" {
				stage = "EA-7"
			}
			_ = json.NewEncoder(w).Encode(prtsEnvelope([]any{
				copilotItem(100, stage+" 作业", stage, 4, 0.8),
			}))
		case "/set/query":
			_ = json.NewEncoder(w).Encode(prtsEnvelope([]any{}))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	executor := &fakeExecutor{}
	lease := &fakeLease{}
	planExecutor := &fakePlanExecutor{result: completionFixture("EA-6", "EA-7")}
	options := runOptions(t, paths, executor, lease, planExecutor)
	options.PRTSBaseURL = server.URL
	options.HTTPClient = server.Client()
	options.PRTSMaxAttempts = 1
	service := NewWithOptions(options)

	result, err := service.RunCurrentActivityCopilots(context.Background(), "Official", nil)
	if err != nil {
		t.Fatal(err)
	}
	if result["executed"] != true || result["source"] != "composed-candidates" {
		t.Fatalf("result = %#v", result)
	}
	if len(planExecutor.entryRequests) != 1 {
		t.Fatalf("entry requests = %#v", planExecutor.entryRequests)
	}
	if len(planExecutor.entryRequests[0].Entries) != 2 {
		t.Fatalf("entries = %#v", planExecutor.entryRequests[0].Entries)
	}
	plan, _ := result["plan"].(map[string]any)
	if plan == nil || plan["planId"] == nil {
		t.Fatalf("plan = %#v", result["plan"])
	}
	progress := service.LoadActivityProgress()
	entry := progress["EA"]
	if len(entry.Stages) != 2 {
		t.Fatalf("progress = %#v", entry)
	}
}

func TestRunCurrentActivityCopilotsMatchingSet(t *testing.T) {
	paths := testPaths(t)
	writeStageActivity(t, paths, stageActivityFixture())
	writeStagesCatalog(t, paths)
	writeReadyStageTasks(t, paths)

	stage6Content, _ := json.Marshal(map[string]any{
		"doc":        map[string]any{"title": "EA-6 作业"},
		"stage_name": "EA-6",
		"opers":      []any{map[string]any{"name": "A"}},
	})
	stage7Content, _ := json.Marshal(map[string]any{
		"doc":        map[string]any{"title": "EA-7 作业"},
		"stage_name": "EA-7",
		"opers":      []any{map[string]any{"name": "A"}},
	})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/copilot/query":
			_ = json.NewEncoder(w).Encode(prtsEnvelope([]any{}))
		case r.URL.Path == "/set/query":
			_ = json.NewEncoder(w).Encode(prtsEnvelope([]any{
				map[string]any{
					"id": "set-9", "name": "活动套装", "status": "PUBLIC",
					"copilot_ids": []any{11, 12},
				},
			}))
		case r.URL.Path == "/copilot/get/11":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"id": 11, "content": string(stage6Content), "rating_level": 5, "rating_ratio": 0.9,
			}})
		case r.URL.Path == "/copilot/get/12":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"id": 12, "content": string(stage7Content), "rating_level": 5, "rating_ratio": 0.9,
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	executor := &fakeExecutor{}
	lease := &fakeLease{}
	planExecutor := &fakePlanExecutor{result: completionFixture("EA-6", "EA-7")}
	provider := &fakePlanProvider{plan: Plan{
		SetID: "set-9",
		Name:  "活动套装",
		Entries: []PlanEntry{
			{ItemIndex: 0, CopilotID: 11, DisplayStage: "EA-6", Mode: "normal"},
			{ItemIndex: 1, CopilotID: 12, DisplayStage: "EA-7", Mode: "normal"},
		},
	}}
	options := runOptions(t, paths, executor, lease, planExecutor)
	options.PRTSBaseURL = server.URL
	options.HTTPClient = server.Client()
	options.PRTSMaxAttempts = 1
	options.PlanProvider = provider
	service := NewWithOptions(options)

	result, err := service.RunCurrentActivityCopilots(context.Background(), "Official", nil)
	if err != nil {
		t.Fatal(err)
	}
	if result["executed"] != true || result["source"] != "matching-set" {
		t.Fatalf("result = %#v", result)
	}
	plan, _ := result["plan"].(map[string]any)
	if plan == nil {
		t.Fatalf("plan = %#v", result["plan"])
	}
	set, _ := plan["set"].(CopilotSetMatch)
	if set.ID != "set-9" {
		t.Fatalf("set = %#v", set)
	}
	if len(planExecutor.planRequests) != 1 || planExecutor.planRequests[0].SetID != "set-9" {
		t.Fatalf("plan requests = %#v", planExecutor.planRequests)
	}
	if len(planExecutor.planRequests[0].SelectedIndexes) != 2 {
		t.Fatalf("selected = %#v", planExecutor.planRequests[0].SelectedIndexes)
	}
	progress := service.LoadActivityProgress()
	if len(progress["EA"].Stages) != 2 {
		t.Fatalf("progress = %#v", progress)
	}
}
