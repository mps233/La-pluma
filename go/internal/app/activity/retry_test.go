package activity

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

type retryPlanExecutor struct {
	calls    int
	requests []PlanExecution
}

func (e *retryPlanExecutor) ExecutePlan(_ context.Context, request PlanExecution) (*ExecutionResult, error) {
	e.calls++
	e.requests = append(e.requests, request)
	if e.calls == 1 {
		success := false
		return &ExecutionResult{
			Results: []CompletionEntry{{
				Key:               "1:1:normal",
				ItemIndex:         1,
				CopilotID:         999,
				OriginalCopilotID: 1,
				StageID:           "act_ea_ex08",
				DisplayStage:      "EA-EX-8",
				Mode:              "normal",
				Success:           &success,
				Error:             "MAA 退出码 1",
			}},
			Data: map[string]any{"pending": []any{map[string]any{"itemIndex": 1}}},
		}, errors.New("MAA 退出码 1")
	}
	return completionFixture("EA-EX-8"), nil
}

func (e *retryPlanExecutor) ExecuteSelectedEntries(context.Context, EntriesExecution) (*ExecutionResult, error) {
	return nil, nil
}

func TestRunCurrentActivitySetRetriesNextCandidateAfterFormationFailure(t *testing.T) {
	paths := testPaths(t)
	writeStageActivity(t, paths, stageActivityFixture())
	writeReadyStageTasks(t, paths)
	writeJSON(t, filepath.Join(paths.MaaDataDir, "resource", "stages.json"), []any{
		map[string]any{"code": "EA-6", "stageId": "main_06"},
		map[string]any{"code": "EA-7", "stageId": "main_07"},
		map[string]any{"code": "EA-EX-8", "stageId": "act_ea_ex08"},
	})
	writeJSON(t, filepath.Join(paths.DataDir, "stages.json"), map[string]any{
		"EA-EX-8": map[string]any{"code": "EA-EX-8", "zoneName": "测试章节"},
	})
	writeJSON(t, filepath.Join(paths.DataDir, "operbox.json"), map[string]any{
		"data": []any{map[string]any{"name": "甲", "own": true, "elite": 2, "level": 90}},
	})

	original := `{"stage_name":"act_ea_ex08","doc":{"title":"测试活动 - EA-EX-8 - 原作业"},"opers":[{"name":"缺失干员"}]}`
	candidate1 := `{"stage_name":"act_ea_ex08","doc":{"title":"测试活动 - EA-EX-8 - 候选一"},"opers":[{"name":"甲"}]}`
	candidate2 := `{"stage_name":"act_ea_ex08","doc":{"title":"测试活动 - EA-EX-8 - 候选二"},"opers":[{"name":"甲"}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/copilot/get/1":
			_ = json.NewEncoder(w).Encode(map[string]any{"status_code": 200, "data": map[string]any{"id": 1, "content": original}})
		case "/copilot/query":
			_ = json.NewEncoder(w).Encode(map[string]any{"status_code": 200, "data": map[string]any{"data": []any{
				map[string]any{"id": 999, "available": true, "status": "PUBLIC", "rating_level": 10, "rating_ratio": 1.0, "hot_score": 100, "views": 1000, "content": candidate1},
				map[string]any{"id": 1000, "available": true, "status": "PUBLIC", "rating_level": 10, "rating_ratio": 1.0, "hot_score": 90, "views": 900, "content": candidate2},
			}}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	executor := &fakeExecutor{}
	planExecutor := &retryPlanExecutor{}
	provider := &fakePlanProvider{plan: Plan{
		SetID: "set-1",
		Name:  "套装",
		Entries: []PlanEntry{
			{Key: "0:1:normal", ItemIndex: 0, CopilotID: 1, StageID: "main_06", DisplayStage: "EA-6", Mode: "normal"},
			{Key: "1:1:normal", ItemIndex: 1, CopilotID: 1, StageID: "act_ea_ex08", DisplayStage: "EA-EX-8", Mode: "normal"},
		},
	}}
	options := runOptions(t, paths, executor, &fakeLease{}, planExecutor)
	options.PlanProvider = provider
	options.PlanExecutor = planExecutor
	options.PRTSBaseURL = server.URL
	options.HTTPClient = server.Client()
	options.PRTSMaxAttempts = 1
	options.NavigationLog = &fakeNavigationLog{text: "TaskChainCompleted {\"taskchain\":\"Custom\",\"taskid\":7}\n"}
	service := NewWithOptions(options)
	result, err := service.RunCurrentActivitySet(context.Background(), SetExecutionOptions{
		SetID:           "set-1",
		SelectedIndexes: []int{1},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result["executed"] != true {
		t.Fatalf("result = %#v", result)
	}
	if planExecutor.calls != 2 {
		t.Fatalf("calls = %d", planExecutor.calls)
	}
	first := planExecutor.requests[0].Plan
	if first == nil {
		t.Fatal("first plan is nil")
	}
	second := planExecutor.requests[1].Plan
	if second == nil {
		t.Fatal("second plan is nil")
	}
	if copilotIDForItem(first.Entries, 1) != 999 {
		t.Fatalf("first copilot = %d", copilotIDForItem(first.Entries, 1))
	}
	if copilotIDForItem(second.Entries, 1) != 1000 || originalCopilotIDForItem(second.Entries, 1) != 1 {
		t.Fatalf("second entry = %#v", second.Entries)
	}
}

func copilotIDForItem(entries []PlanEntry, itemIndex int) int {
	for _, entry := range entries {
		if entry.ItemIndex == itemIndex {
			return entry.CopilotID
		}
	}
	return 0
}

func originalCopilotIDForItem(entries []PlanEntry, itemIndex int) int {
	for _, entry := range entries {
		if entry.ItemIndex == itemIndex {
			return entry.OriginalCopilotID
		}
	}
	return 0
}
