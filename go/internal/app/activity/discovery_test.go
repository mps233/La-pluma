package activity

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func prtsEnvelope(items []any) map[string]any {
	return map[string]any{
		"status_code": 200,
		"data":        map[string]any{"data": items},
	}
}

func copilotItem(id int, title, stageName string, ratingLevel, ratingRatio float64) map[string]any {
	content, _ := json.Marshal(map[string]any{
		"doc":        map[string]any{"title": title},
		"stage_name": stageName,
		"opers":      []any{},
		"groups":     []any{},
	})
	return map[string]any{
		"id":                id,
		"content":           string(content),
		"rating_level":      ratingLevel,
		"rating_ratio":      ratingRatio,
		"status":            "PUBLIC",
		"available":         true,
		"not_enough_rating": false,
		"upload_time":       "2026-01-01T00:00:00Z",
		"hot_score":         10,
		"views":             100,
	}
}

func readyPreflight() NavigationResult {
	return NavigationResult{
		State:      "ready",
		CanPrepare: true,
		Activity: NavigationActivity{
			Code:   stringPtr("EA"),
			Name:   stringPtr("测试活动"),
			Stages: []string{"EA-6", "EA-7"},
		},
		Navigation: &NavigationInfo{EntryTask: "EA-OpenOpt"},
		Reason:     "ready",
	}
}

func TestRankActivityCopilots(t *testing.T) {
	items := []any{
		copilotItem(1, "EA-6 甲", "EA-6", 4, 0.8),
		copilotItem(2, "EA-6 乙", "EA-6", 5, 0.9),
		func() map[string]any {
			item := copilotItem(3, "EA-6 丙", "EA-6", 5, 0.9)
			item["upload_time"] = "2026-03-01T00:00:00Z"
			content := map[string]any{
				"doc":        map[string]any{"title": "EA-6 丙"},
				"stage_name": "EA-6",
				"opers":      []any{map[string]any{"name": "X"}},
			}
			encoded, _ := json.Marshal(content)
			item["content"] = string(encoded)
			return item
		}(),
		map[string]any{
			"id":      0,
			"content": `{"doc":{"title":"EA-6 无效"}}`,
		},
		func() map[string]any {
			item := copilotItem(5, "EA-7 其他", "EA-7", 9, 1)
			return item
		}(),
	}

	candidates := RankActivityCopilots(items, "EA-6", &SelectionContext{
		OwnedOperators: map[string]struct{}{"A": {}},
		Preferences: CombatCopilotPreferences{
			Raid:                    "normal",
			AllowOneMissingOperator: false,
		},
	})
	if len(candidates) != 2 {
		t.Fatalf("candidates = %#v", candidates)
	}
	if candidates[0].ID != 2 || candidates[1].ID != 1 {
		t.Fatalf("order = %d,%d", candidates[0].ID, candidates[1].ID)
	}
	if candidates[0].URI != "prts://2" {
		t.Fatalf("uri = %q", candidates[0].URI)
	}

	all := RankActivityCopilots(items, "EA-6", nil)
	if len(all) != 3 {
		t.Fatalf("all = %#v", all)
	}
	if all[0].ID != 3 || all[1].ID != 2 || all[2].ID != 1 {
		t.Fatalf("all order = %#v", all)
	}
}

func TestFindActivityCopilotCandidates(t *testing.T) {
	var queryCount int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/copilot/query":
			current := atomic.AddInt32(&queryCount, 1)
			keyword := r.URL.Query().Get("level_keyword")
			stage := "EA-6"
			if keyword == "main_07" {
				stage = "EA-7"
			}
			_ = json.NewEncoder(w).Encode(prtsEnvelope([]any{
				copilotItem(100+int(current), stage+" 作业", stage, 4, 0.8),
			}))
		case "/set/query":
			_ = json.NewEncoder(w).Encode(prtsEnvelope([]any{}))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	paths := testPaths(t)
	writeStagesCatalog(t, paths)
	service := NewWithOptions(Options{
		Paths:           paths,
		Now:             testNow,
		PRTSBaseURL:     server.URL,
		HTTPClient:      server.Client(),
		PRTSTimeout:     time.Second,
		PRTSMaxAttempts: 1,
	})
	preflight := readyPreflight()
	candidates, err := service.FindActivityCopilotCandidates(context.Background(), "Official", DiscoveryOptions{
		Preflight: &preflight,
	})
	if err != nil {
		t.Fatal(err)
	}
	if candidates.State != "candidates-ready" {
		t.Fatalf("candidates = %#v", candidates)
	}
	if candidates.NavigationMode != "home-navigation" {
		t.Fatalf("navigationMode = %q", candidates.NavigationMode)
	}
	if len(candidates.Stages) != 2 {
		t.Fatalf("stages = %#v", candidates.Stages)
	}
	for _, stage := range candidates.Stages {
		if len(stage.Candidates) != 1 {
			t.Fatalf("stage = %#v", stage)
		}
		if stage.StageID == nil {
			t.Fatalf("stageId = %#v", stage)
		}
		if stage.Query == nil || !strings.Contains(*stage.Query, "level_keyword=") {
			t.Fatalf("query = %#v", stage.Query)
		}
	}
	if candidates.MatchingSet != nil {
		t.Fatalf("matchingSet = %#v", candidates.MatchingSet)
	}
	if atomic.LoadInt32(&queryCount) != 2 {
		t.Fatalf("queryCount = %d", atomic.LoadInt32(&queryCount))
	}
}

func TestFindMatchingCopilotSet(t *testing.T) {
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
					"id":          "set-1",
					"name":        "完整套装",
					"status":      "PUBLIC",
					"creator":     "tester",
					"update_time": "2026-02-01T00:00:00Z",
					"copilot_ids": []any{11, 12},
				},
			}))
		case r.URL.Path == "/copilot/get/11":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"id": 11, "content": string(stage6Content), "rating_level": 5, "rating_ratio": 0.9,
			}})
		case r.URL.Path == "/copilot/get/12":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"id": 12, "content": string(stage7Content), "rating_level": 4, "rating_ratio": 0.8,
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	paths := testPaths(t)
	writeStagesCatalog(t, paths)
	service := NewWithOptions(Options{
		Paths:           paths,
		Now:             testNow,
		PRTSBaseURL:     server.URL,
		HTTPClient:      server.Client(),
		PRTSTimeout:     time.Second,
		PRTSMaxAttempts: 1,
	})
	preflight := readyPreflight()
	candidates, err := service.FindActivityCopilotCandidates(context.Background(), "Official", DiscoveryOptions{
		Preflight: &preflight,
	})
	if err != nil {
		t.Fatal(err)
	}
	if candidates.MatchingSet == nil {
		t.Fatalf("candidates = %#v", candidates)
	}
	match := candidates.MatchingSet
	if match.ID != "set-1" || match.Name != "完整套装" {
		t.Fatalf("match = %#v", match)
	}
	if len(match.Members) != 2 || len(match.Stages) != 2 {
		t.Fatalf("match = %#v", match)
	}
	if match.RatingScore != 4.5 {
		t.Fatalf("ratingScore = %v", match.RatingScore)
	}
	if len(candidates.MatchingSets) != 1 {
		t.Fatalf("matchingSets = %#v", candidates.MatchingSets)
	}
}

func TestCanUseCurrentMapFallback(t *testing.T) {
	preflight := NavigationResult{
		State:      "blocked",
		ReasonCode: stringPtr("navigation-resource-unavailable"),
		Activity: NavigationActivity{
			Code:   stringPtr("EA"),
			Stages: []string{"EA-6"},
		},
	}
	if !CanUseCurrentMapFallback(preflight) {
		t.Fatal("expected fallback")
	}
	preflight.State = "ready"
	if CanUseCurrentMapFallback(preflight) {
		t.Fatal("ready preflight must not fall back")
	}
	preflight.State = "blocked"
	preflight.Activity.Stages = nil
	if CanUseCurrentMapFallback(preflight) {
		t.Fatal("missing stages must not fall back")
	}
}

func TestBuildActivityPreparationTasks(t *testing.T) {
	candidates := &Candidates{
		NavigationMode: "home-navigation",
		Preflight:      readyPreflight(),
	}
	tasks := BuildActivityPreparationTasks(candidates, "Official", "EA-6")
	if len(tasks) != 6 {
		t.Fatalf("tasks = %#v", tasks)
	}
	if tasks[0].Type != "CloseDown" || tasks[5].Name != "选择活动关卡 EA-6" {
		t.Fatalf("tasks = %#v", tasks)
	}
	taskNames := tasks[5].Params["task_names"].([]string)
	if len(taskNames) != 1 || taskNames[0] != "EA-6" {
		t.Fatalf("task_names = %#v", taskNames)
	}
	candidates.NavigationMode = "current-map-fallback"
	if tasks := BuildActivityPreparationTasks(candidates, "Official", "EA-6"); len(tasks) != 0 {
		t.Fatalf("fallback tasks = %#v", tasks)
	}
}

func TestSelectActivitySetEntries(t *testing.T) {
	entries := []PlanEntry{
		{ItemIndex: 0, DisplayStage: "EA-6"},
		{ItemIndex: 1, DisplayStage: "EA-7"},
		{ItemIndex: 2, DisplayStage: "OL-1"},
	}
	selected := SelectActivitySetEntries(entries, []string{"ea-6", "EA-7"}, nil)
	if len(selected) != 2 {
		t.Fatalf("selected = %#v", selected)
	}
	subset := SelectActivitySetEntries(entries, []string{"EA-6", "EA-7"}, []int{1})
	if len(subset) != 1 || subset[0].ItemIndex != 1 {
		t.Fatalf("subset = %#v", subset)
	}
}

func TestBuildActivityCopilotRunPlan(t *testing.T) {
	candidates := &Candidates{
		State:     "candidates-ready",
		Preflight: readyPreflight(),
		Stages: []StageCandidateResult{
			{
				Stage: "EA-6",
				Candidates: []CopilotCandidate{{
					ID: 1, URI: "prts://1", Stage: "EA-6", Title: "EA-6 作业",
					PresetFormation: true, RatingLevel: 5,
				}},
			},
		},
	}
	plan := BuildActivityCopilotRunPlan(candidates, map[string]any{"raid": "raid"})
	if plan.State != "blocked" || !strings.Contains(plan.Reason, "突袭") {
		t.Fatalf("plan = %#v", plan)
	}
	plan = BuildActivityCopilotRunPlan(candidates, map[string]any{"raid": "both"})
	if plan.State != "ready" {
		t.Fatalf("plan = %#v", plan)
	}
	if len(plan.Entries) != 1 || plan.Entries[0].Mode != "normal" {
		t.Fatalf("entries = %#v", plan.Entries)
	}
	if plan.Activity == nil || plan.Activity.Code == nil || *plan.Activity.Code != "EA" {
		t.Fatalf("activity = %#v", plan.Activity)
	}

	candidates.Stages[0].Candidates = nil
	blocked := BuildActivityCopilotRunPlan(candidates, map[string]any{"raid": "normal"})
	if blocked.State != "blocked" || !strings.Contains(blocked.Reason, "没有可靠作业") {
		t.Fatalf("blocked = %#v", blocked)
	}
}
