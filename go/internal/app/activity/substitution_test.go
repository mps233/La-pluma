package activity

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/mps233/la-pluma/go/internal/config"
)

func substitutionTestService(t *testing.T, paths config.Paths, queries []any) *Service {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/copilot/get/1":
			_ = json.NewEncoder(w).Encode(map[string]any{"status_code": 200, "data": map[string]any{
				"id":      1,
				"content": `{"stage_name":"act_ea_ex08","doc":{"title":"测试活动 - EA-EX-8 - 原作业"},"opers":[{"name":"缺失干员"}]}`,
			}})
		case "/copilot/query":
			_ = json.NewEncoder(w).Encode(map[string]any{"status_code": 200, "data": map[string]any{"data": queries}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	options := runOptions(t, paths, &fakeExecutor{}, &fakeLease{}, &fakePlanExecutor{})
	options.PRTSBaseURL = server.URL
	options.HTTPClient = server.Client()
	options.PRTSMaxAttempts = 1
	return NewWithOptions(options)
}

func substitutionPlan() Plan {
	return Plan{SetID: "set-1", Entries: []PlanEntry{{
		Key:          "0:1:normal",
		ItemIndex:    0,
		CopilotID:    1,
		StageID:      "act_ea_ex08",
		DisplayStage: "EA-EX-8",
		Mode:         "normal",
	}}}
}

func TestResolveSetSubstitutionsReplacesIncompatibleCopilot(t *testing.T) {
	paths := testPaths(t)
	writeJSON(t, filepath.Join(paths.MaaDataDir, "resource", "stages.json"), []any{
		map[string]any{"code": "EA-EX-8", "stageId": "act_ea_ex08"},
	})
	candidateContent := `{"stage_name":"act_ea_ex08","doc":{"title":"测试活动 - EA-EX-8 - 兼容作业"},"opers":[{"name":"甲"}]}`
	service := substitutionTestService(t, paths, []any{map[string]any{
		"id": 999, "available": true, "status": "PUBLIC", "not_enough_rating": false,
		"rating_level": 10, "rating_ratio": 1.0, "hot_score": 100, "views": 1000,
		"content": candidateContent,
	}})
	plan := substitutionPlan()
	selection := SelectionContext{OwnedOperators: map[string]struct{}{"甲": {}}}

	modified, substitutions, skipped := service.resolveSetSubstitutions(context.Background(), plan, plan.Entries, selection)
	if len(skipped) != 0 {
		t.Fatalf("skipped = %#v", skipped)
	}
	if len(substitutions) != 1 {
		t.Fatalf("substitutions = %#v", substitutions)
	}
	if substitutions[0].CopilotID != 999 || substitutions[0].OriginalCopilotID != 1 {
		t.Fatalf("substitution = %#v", substitutions[0])
	}
	if len(modified.Entries) != 1 {
		t.Fatalf("entries = %#v", modified.Entries)
	}
	entry := modified.Entries[0]
	if entry.CopilotID != 999 || entry.OriginalCopilotID != 1 || entry.Key != "0:1:normal" {
		t.Fatalf("entry = %#v", entry)
	}
}

func TestResolveSetSubstitutionsSkipsWhenNoCandidate(t *testing.T) {
	paths := testPaths(t)
	writeJSON(t, filepath.Join(paths.MaaDataDir, "resource", "stages.json"), []any{
		map[string]any{"code": "EA-EX-8", "stageId": "act_ea_ex08"},
	})
	service := substitutionTestService(t, paths, []any{})
	plan := substitutionPlan()
	selection := SelectionContext{OwnedOperators: map[string]struct{}{"甲": {}}}

	modified, substitutions, skipped := service.resolveSetSubstitutions(context.Background(), plan, plan.Entries, selection)
	if len(substitutions) != 0 {
		t.Fatalf("substitutions = %#v", substitutions)
	}
	if len(skipped) != 1 || skipped[0].ItemIndex != 0 {
		t.Fatalf("skipped = %#v", skipped)
	}
	if len(modified.Entries) != 0 {
		t.Fatalf("entries = %#v", modified.Entries)
	}
}
