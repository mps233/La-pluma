package copilot

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

func contentItem(id int, title, stageName string) map[string]any {
	content := map[string]any{"doc": map[string]any{"title": title}, "stage_name": stageName}
	encoded, _ := json.Marshal(content)
	return map[string]any{"id": id, "content": string(encoded)}
}

func TestRankActivityCopilotsKeepsExactStageTitles(t *testing.T) {
	items := []any{
		map[string]any{"id": 1, "rating_level": 10, "rating_ratio": 1, "upload_time": "2026-07-10T10:00:00", "content": `{"doc":{"title":"BD-4 高配"}}`},
		map[string]any{"id": 2, "rating_level": 9, "rating_ratio": 1, "upload_time": "2026-07-11T10:00:00", "content": `{"doc":{"title":"BD-4 低配"}}`},
		map[string]any{"id": 3, "rating_level": 10, "rating_ratio": 1, "upload_time": "2026-07-12T10:00:00", "content": `{"doc":{"title":"BD-5 高配"}}`},
		map[string]any{"id": 4, "rating_level": 10, "rating_ratio": 1, "upload_time": "2026-07-12T10:00:00", "content": `{"doc":{"title":"BD-40 高配"}}`},
	}
	candidates := RankActivityCopilots(items, "BD-4", nil)
	if len(candidates) != 2 || candidates[0].ID != 1 || candidates[1].ID != 2 {
		t.Fatalf("candidates = %#v", candidates)
	}
	for _, candidate := range candidates {
		if candidate.Stage != "BD-4" {
			t.Fatalf("candidate stage = %#v", candidate)
		}
	}
	if candidates[0].URI != "prts://1" {
		t.Fatalf("candidate uri = %#v", candidates[0])
	}
}

func TestRankActivityCopilotsAllowsOneMissingOperatorWithSupport(t *testing.T) {
	items := []any{
		contentItem(21, "BD-4 单核", "act_bd_04"),
		contentItem(22, "BD-4 双核", "act_bd_04"),
		contentItem(23, "BD-4 齐全", "act_bd_04"),
	}
	for index, item := range items {
		item.(map[string]any)["rating_level"] = 10
		if index == 0 {
			item.(map[string]any)["content"] = `{"doc":{"title":"BD-4 单核"},"opers":[{"name":"黑角"}]}`
		} else if index == 1 {
			item.(map[string]any)["content"] = `{"doc":{"title":"BD-4 双核"},"opers":[{"name":"黑角"},{"name":"斑点"}]}`
		} else {
			item.(map[string]any)["content"] = `{"doc":{"title":"BD-4 齐全"},"opers":[{"name":"圣聆初雪"}]}`
		}
	}
	owned := map[string]struct{}{"圣聆初雪": {}}
	withoutSupport := RankActivityCopilots(items, "BD-4", &DiscoverySelection{
		OwnedOperators: owned,
		Preferences:    map[string]any{"allowOneMissingOperator": true, "supportUsage": 0},
	})
	if len(withoutSupport) != 1 || withoutSupport[0].ID != 23 {
		t.Fatalf("without support = %#v", withoutSupport)
	}

	withSupport := RankActivityCopilots(items, "BD-4", &DiscoverySelection{
		OwnedOperators: owned,
		Preferences:    map[string]any{"allowOneMissingOperator": true, "supportUsage": 1},
	})
	if len(withSupport) != 2 || withSupport[0].ID != 21 || withSupport[1].ID != 23 {
		t.Fatalf("with support = %#v", withSupport)
	}
	if withSupport[0].MissingOperators[0] != "黑角" || !withSupport[0].RequiresSupport {
		t.Fatalf("missing operator projection = %#v", withSupport[0])
	}
}

func TestScoreCopilotSetMembers(t *testing.T) {
	stageOne := "BD-1"
	stageTwo := "BD-2"
	score := ScoreCopilotSetMembers([]CopilotSetMember{
		{Stage: &stageOne, RatingLevel: 10, RatingRatio: 1},
		{Stage: &stageTwo, RatingLevel: 0, RatingRatio: 0},
		{Stage: nil, RatingLevel: 10, RatingRatio: 1},
	})
	if score.RatingScore != 5 || score.RatingRatio != 0.5 || score.UnratedMainStages != 1 {
		t.Fatalf("score = %#v", score)
	}
}

func TestRankActivityCopilotsMarksPresetFormation(t *testing.T) {
	candidates := RankActivityCopilots([]any{
		map[string]any{
			"id": 12, "rating_level": 10,
			"content": `{"stage_name":"act21mini_s01","doc":{"title":"BD-1"},"opers":[],"groups":[]}`,
		},
	}, "BD-1", nil)
	if len(candidates) != 1 || !candidates[0].PresetFormation {
		t.Fatalf("candidates = %#v", candidates)
	}
}

func TestCanRunWithOperatorsSupportName(t *testing.T) {
	missing := &MissingOperatorInfo{Names: []string{"黑角"}, Count: 1}
	if !CanRunWithOperators(missing, map[string]any{"supportUsage": 2, "supportName": "黑角"}) {
		t.Fatal("matching support operator should allow the run")
	}
	if CanRunWithOperators(missing, map[string]any{"supportUsage": 2, "supportName": "斑点"}) {
		t.Fatal("different support operator must not fill the slot")
	}
	if CanRunWithOperators(missing, map[string]any{"allowOneMissingOperator": false, "supportUsage": 1}) {
		t.Fatal("disabled missing-operator preference must reject")
	}
	if CanRunWithOperators(&MissingOperatorInfo{Names: []string{"A", "B"}, Count: 2}, map[string]any{"supportUsage": 1}) {
		t.Fatal("two missing operators must reject")
	}
}

func TestCoversActivityStages(t *testing.T) {
	mainStages := []string{"BD-1", "BD-2", "BD-3"}
	covered := []any{
		map[string]any{"doc": map[string]any{"title": "BD-1"}},
		map[string]any{"doc": map[string]any{"title": "BD-2"}},
		map[string]any{"doc": map[string]any{"title": "BD-3"}},
		map[string]any{"doc": map[string]any{"title": "BD-S-1"}},
	}
	if !CoversActivityStages(covered, "BD", mainStages) {
		t.Fatal("optional same-event stage should be accepted")
	}
	chinese := []any{
		map[string]any{"doc": map[string]any{"title": "时间啊，向前！ - TL-1 - 庸俗的实践"}},
		map[string]any{"doc": map[string]any{"title": "时间啊，向前！ - TL-2 - 孑遗的道路"}},
		map[string]any{"doc": map[string]any{"title": "时间啊，向前！ - TL-3 - 苦难的历程"}},
		map[string]any{"doc": map[string]any{"title": "【时间啊，向前！】TL-S-1 - 突袭"}},
	}
	if !CoversActivityStages(chinese, "TL", []string{"TL-1", "TL-2", "TL-3"}) {
		t.Fatal("Chinese activity titles should cover main stages")
	}
	unrelated := append(append([]any{}, covered[:3]...), map[string]any{"doc": map[string]any{"title": "CV-1"}})
	if CoversActivityStages(unrelated, "BD", mainStages) {
		t.Fatal("unrelated event stage must reject the set")
	}
	if CoversActivityStages(nil, "BD", mainStages) {
		t.Fatal("empty contents must not cover")
	}
}

func TestCanUseCurrentMapFallback(t *testing.T) {
	if !CanUseCurrentMapFallback(map[string]any{
		"state":      "blocked",
		"reasonCode": "navigation-resource-unavailable",
		"activity":   map[string]any{"code": "BD", "stages": []any{"BD-1"}},
	}) {
		t.Fatal("expected current-map fallback")
	}
	if CanUseCurrentMapFallback(map[string]any{
		"state":      "blocked",
		"reasonCode": "activity-unavailable",
		"activity":   map[string]any{"code": "BD", "stages": []any{"BD-1"}},
	}) {
		t.Fatal("unexpected fallback for unrelated reason")
	}
}

func newDiscoveryFixture(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	maaDataDir := t.TempDir()
	writeJSONFile(t, filepath.Join(maaDataDir, "resource", "stages.json"), []any{
		map[string]any{"code": "BD-4", "stageId": "act_bd_04", "apCost": 9},
		map[string]any{"code": "BD-5", "stageId": "act_bd_05", "apCost": 9},
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/copilot/query", func(w http.ResponseWriter, r *http.Request) {
		keyword := r.URL.Query().Get("level_keyword")
		items := []any{}
		switch keyword {
		case "act_bd_04", "BD-4":
			items = append(items,
				map[string]any{
					"id": 1, "status": "PUBLIC", "available": true,
					"rating_level": 10, "rating_ratio": 1, "upload_time": "2026-07-10T10:00:00",
					"content": `{"stage_name":"act_bd_04","doc":{"title":"BD-4 高配"},"opers":[{"name":"A"}]}`,
				},
				map[string]any{
					"id": 3, "status": "PUBLIC", "available": true,
					"rating_level": 10, "content": `{"doc":{"title":"BD-40 高配"}}`,
				},
			)
		case "act_bd_05", "BD-5":
			items = append(items, map[string]any{
				"id": 2, "status": "PUBLIC", "available": true,
				"rating_level": 9, "rating_ratio": 1,
				"content": `{"stage_name":"act_bd_05","doc":{"title":"BD-5 高配"}}`,
			})
		}
		writeHTTPJSON(t, w, map[string]any{"status_code": 200, "data": map[string]any{"data": items}})
	})
	mux.HandleFunc("/set/query", func(w http.ResponseWriter, r *http.Request) {
		writeHTTPJSON(t, w, map[string]any{
			"status_code": 200,
			"data": map[string]any{"data": []any{
				map[string]any{
					"id": "set-1", "name": "BD 全套", "status": "PUBLIC",
					"copilot_ids": []any{1, 2}, "update_time": "2026-07-12T10:00:00",
					"creator": "tester",
				},
			}},
		})
	})
	mux.HandleFunc("/copilot/get/1", func(w http.ResponseWriter, r *http.Request) {
		writeHTTPJSON(t, w, map[string]any{
			"status_code": 200,
			"data": map[string]any{
				"id": 1,
				"content": encodeContent(t, map[string]any{
					"stage_name": "act_bd_04", "doc": map[string]any{"title": "BD-4 高配"},
					"opers": []any{map[string]any{"name": "A"}},
				}),
				"rating_level": 10, "rating_ratio": 1,
			},
		})
	})
	mux.HandleFunc("/copilot/get/2", func(w http.ResponseWriter, r *http.Request) {
		writeHTTPJSON(t, w, map[string]any{
			"status_code": 200,
			"data": map[string]any{
				"id": 2,
				"content": encodeContent(t, map[string]any{
					"stage_name": "act_bd_05", "doc": map[string]any{"title": "BD-5 高配"},
				}),
				"rating_level": 9, "rating_ratio": 1,
			},
		})
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server, maaDataDir
}

func TestFindActivityCopilotCandidates(t *testing.T) {
	server, maaDataDir := newDiscoveryFixture(t)
	service := newFixtureService(t, server, maaDataDir, nil)
	preflight := map[string]any{
		"state":    "ready",
		"activity": map[string]any{"code": "BD", "name": "BD 活动", "stages": []any{"BD-5", "BD-4"}},
	}
	result, err := service.FindActivityCopilotCandidates(context.Background(), "Official", DiscoveryOptions{Preflight: preflight})
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "candidates-ready" {
		t.Fatalf("state = %q, reason = %q", result.State, result.Reason)
	}
	if len(result.Stages) != 2 {
		t.Fatalf("stages = %#v", result.Stages)
	}
	if result.Stages[0].Stage != "BD-4" || result.Stages[1].Stage != "BD-5" {
		t.Fatalf("stage order = %#v", result.Stages)
	}
	if result.Stages[0].StageID == nil || *result.Stages[0].StageID != "act_bd_04" {
		t.Fatalf("stage id = %#v", result.Stages[0].StageID)
	}
	if result.Stages[0].Query == nil || !strings.Contains(*result.Stages[0].Query, "level_keyword=act_bd_04") {
		t.Fatalf("query = %#v", result.Stages[0].Query)
	}
	if len(result.Stages[0].Candidates) != 1 || result.Stages[0].Candidates[0].ID != 1 {
		t.Fatalf("candidates = %#v", result.Stages[0].Candidates)
	}
	if result.MatchingSet == nil || result.MatchingSet.ID != "set-1" || len(result.MatchingSet.Members) != 2 {
		t.Fatalf("matching set = %#v", result.MatchingSet)
	}
	if result.MatchingSet.RatingScore != 9.5 || result.NavigationMode != "home-navigation" {
		t.Fatalf("matching set score/mode = %#v / %q", result.MatchingSet, result.NavigationMode)
	}
}

func TestFindActivityCopilotCandidatesBlockedPreflight(t *testing.T) {
	server, maaDataDir := newDiscoveryFixture(t)
	service := newFixtureService(t, server, maaDataDir, nil)
	result, err := service.FindActivityCopilotCandidates(context.Background(), "", DiscoveryOptions{
		Preflight: map[string]any{
			"state":    "blocked",
			"reason":   "活动未开放",
			"activity": map[string]any{"code": "BD", "stages": []any{"BD-1"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "blocked" || result.Reason != "活动未开放" {
		t.Fatalf("result = %#v", result)
	}
	if len(result.Stages) != 0 {
		t.Fatalf("stages = %#v", result.Stages)
	}
}

func TestFindActivityCopilotCandidatesWithoutPreflight(t *testing.T) {
	server, maaDataDir := newDiscoveryFixture(t)
	service := newFixtureService(t, server, maaDataDir, nil)
	_, err := service.FindActivityCopilotCandidates(context.Background(), "", DiscoveryOptions{})
	appError, ok := apperrors.As(err)
	if !ok || appError.Code != "COPILOT_PREFLIGHT_UNAVAILABLE" {
		t.Fatalf("error = %#v", err)
	}
}
