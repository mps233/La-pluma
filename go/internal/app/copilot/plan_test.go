package copilot

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

func writeJSONFile(t *testing.T, path string, value any) {
	t.Helper()
	if err := jsonstore.Write(path, value, true); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func encodeContent(t *testing.T, value map[string]any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

// PRTS fixture with one set containing two normal copilots and one preset
// formation copilot.
func newPRTSFixture(t *testing.T) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var requests atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/set/get", func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Query().Get("id") != "1" {
			http.NotFound(w, r)
			return
		}
		writeHTTPJSON(t, w, map[string]any{
			"status_code": 200,
			"data": map[string]any{
				"id":          1,
				"name":        "测试集",
				"copilot_ids": []any{10, 10, 11},
			},
		})
	})
	mux.HandleFunc("/copilot/get/", func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		id := filepath.Base(r.URL.Path)
		var content map[string]any
		switch id {
		case "10":
			content = map[string]any{
				"stage_name": "act_test_01",
				"doc":        map[string]any{"title": "T-1 高配"},
				"opers":      []any{map[string]any{"name": "A"}},
				"groups":     []any{},
			}
		case "11":
			content = map[string]any{
				"stage_name": "act_test_s01",
				"doc":        map[string]any{"title": "T-S-1"},
				"opers":      []any{},
				"groups":     []any{},
			}
		default:
			http.NotFound(w, r)
			return
		}
		writeHTTPJSON(t, w, map[string]any{
			"status_code": 200,
			"data":        map[string]any{"id": id, "content": encodeContent(t, content)},
		})
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server, &requests
}

func writeHTTPJSON(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Errorf("encode response: %v", err)
	}
}

func writeMaaResource(t *testing.T) string {
	t.Helper()
	maaDataDir := t.TempDir()
	resourceDir := filepath.Join(maaDataDir, "resource")
	tileDir := filepath.Join(resourceDir, "Arknights-Tile-Pos")
	writeJSONFile(t, filepath.Join(tileDir, "act_test_01-main.json"), map[string]any{"code": "T-1"})
	writeJSONFile(t, filepath.Join(tileDir, "act_test_02-main.json"), map[string]any{"code": "T-2"})
	writeJSONFile(t, filepath.Join(resourceDir, "stages.json"), []any{
		map[string]any{"code": "T-1", "stageId": "act_test_01", "apCost": 9},
		map[string]any{"code": "T-2", "stageId": "act_test_02", "apCost": 12},
	})
	return maaDataDir
}

func newFixtureService(t *testing.T, server *httptest.Server, maaDataDir string, now func() time.Time) *Service {
	t.Helper()
	prts := NewPRTSClient(PRTSClientOptions{
		BaseURL:       server.URL,
		StageStatsURL: "-",
		HTTPClient:    server.Client(),
		Sleep:         func(context.Context, time.Duration) error { return nil },
	})
	return NewWithOptions(ServiceOptions{
		Paths:   config.Paths{DataDir: t.TempDir(), MaaDataDir: maaDataDir},
		PRTS:    prts,
		Now:     now,
		PlanTTL: 30 * time.Minute,
	})
}

func TestBuildPlanUsesTileCodesAndAPCosts(t *testing.T) {
	server, requests := newPRTSFixture(t)
	maaDataDir := writeMaaResource(t)
	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	service := newFixtureService(t, server, maaDataDir, func() time.Time { return now })

	plan, err := service.BuildPlan(context.Background(), "1", "both")
	if err != nil {
		t.Fatal(err)
	}
	wantKeys := []string{
		"0:10:normal", "0:10:raid",
		"1:10:normal", "1:10:raid",
		"2:11:normal",
	}
	if len(plan.Entries) != len(wantKeys) {
		t.Fatalf("entries = %#v", plan.Entries)
	}
	for index, key := range wantKeys {
		if plan.Entries[index].Key != key {
			t.Fatalf("entry[%d] = %q, want %q", index, plan.Entries[index].Key, key)
		}
	}
	if plan.Name != "测试集" || plan.SetID != "1" {
		t.Fatalf("plan metadata = %#v", plan)
	}
	if len(plan.Items) != 3 {
		t.Fatalf("items = %#v", plan.Items)
	}
	first := plan.Items[0]
	if first.Stage != "T-1" || first.StageID != "act_test_01" || first.APCost == nil || *first.APCost != 9 {
		t.Fatalf("first item = %#v", first)
	}
	if !first.SupportsRaid || first.PresetFormation {
		t.Fatalf("first item flags = %#v", first)
	}
	preset := plan.Items[2]
	if !preset.PresetFormation || preset.SupportsRaid || preset.Stage != "T-S-1" || preset.APCost != nil {
		t.Fatalf("preset item = %#v", preset)
	}
	for _, entry := range plan.Entries {
		if entry.Completed == nil || *entry.Completed {
			t.Fatalf("entry completion = %#v", entry)
		}
	}
	if got := requests.Load(); got != 4 {
		t.Fatalf("requests = %d, want 4", got)
	}

	// Cache hit: no additional PRTS requests.
	if _, err := service.BuildPlan(context.Background(), "1", "both"); err != nil {
		t.Fatal(err)
	}
	if got := requests.Load(); got != 4 {
		t.Fatalf("cache hit requests = %d, want 4", got)
	}

	// TTL expiry rebuilds all four requests.
	now = now.Add(31 * time.Minute)
	if _, err := service.BuildPlan(context.Background(), "1", "both"); err != nil {
		t.Fatal(err)
	}
	if got := requests.Load(); got != 8 {
		t.Fatalf("cache miss requests = %d, want 8", got)
	}
}

func TestBuildPlanRefreshesCompletionFromProgress(t *testing.T) {
	server, _ := newPRTSFixture(t)
	maaDataDir := writeMaaResource(t)
	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	service := newFixtureService(t, server, maaDataDir, func() time.Time { return now })

	if err := service.MarkCompleted("1", []string{"0:10:normal"}); err != nil {
		t.Fatal(err)
	}
	plan, err := service.BuildPlan(context.Background(), "1", "both")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Entries[0].Completed == nil || !*plan.Entries[0].Completed {
		t.Fatalf("entry 0 not completed: %#v", plan.Entries[0])
	}
	if plan.Entries[1].Completed == nil || *plan.Entries[1].Completed {
		t.Fatalf("entry 1 completed: %#v", plan.Entries[1])
	}

	if err := service.ResetProgress("1"); err != nil {
		t.Fatal(err)
	}
	plan, err = service.BuildPlan(context.Background(), "1", "both")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range plan.Entries {
		if entry.Completed == nil || *entry.Completed {
			t.Fatalf("reset entry completed: %#v", entry)
		}
	}
}

func TestPlanJSONFieldNamesAndNullAPCost(t *testing.T) {
	server, _ := newPRTSFixture(t)
	maaDataDir := writeMaaResource(t)
	service := newFixtureService(t, server, maaDataDir, time.Now)
	plan, err := service.BuildPlan(context.Background(), "1", "both")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["setId"] != "1" || decoded["name"] != "测试集" {
		t.Fatalf("decoded plan = %#v", decoded)
	}
	entries := decoded["entries"].([]any)
	first := entries[0].(map[string]any)
	if first["copilotId"] != float64(10) || first["itemIndex"] != float64(0) {
		t.Fatalf("entry fields = %#v", first)
	}
	if _, exists := first["completed"]; !exists {
		t.Fatalf("completed missing: %#v", first)
	}
	presetEntry := entries[len(entries)-1].(map[string]any)
	if presetEntry["apCost"] != nil {
		t.Fatalf("preset apCost = %#v", presetEntry["apCost"])
	}
}

func TestStageCodeMapSupportsObjectStagesJSON(t *testing.T) {
	maaDataDir := t.TempDir()
	resourceDir := filepath.Join(maaDataDir, "resource")
	writeJSONFile(t, filepath.Join(resourceDir, "stages.json"), map[string]any{
		"one": map[string]any{"stageId": "act_obj", "code": "OB-1", "apCost": 7},
	})
	index := NewResourceIndex(config.Paths{MaaDataDir: maaDataDir})
	codes := index.StageCodeMap(context.Background(), []string{"act_obj"}, nil)
	info, ok := codes["act_obj"]
	if !ok || info.Code != "OB-1" || info.APCost != 7 {
		t.Fatalf("codes = %#v", codes)
	}
	record, ok, err := index.StageByCode("ob-1")
	if err != nil || !ok || record["stageId"] != "act_obj" {
		t.Fatalf("StageByCode = %#v, %v, %v", record, ok, err)
	}
}

func TestResourceStageCodeStatsFallback(t *testing.T) {
	maaDataDir := t.TempDir()
	resourceDir := filepath.Join(maaDataDir, "resource")
	// Metadata gives the code, stages.json has no AP cost.
	tileDir := filepath.Join(resourceDir, "Arknights-Tile-Pos")
	writeJSONFile(t, filepath.Join(tileDir, "act_stat-1.json"), map[string]any{"code": "ST-1"})
	writeJSONFile(t, filepath.Join(resourceDir, "stages.json"), []any{})
	index := NewResourceIndex(config.Paths{MaaDataDir: maaDataDir})
	stats := func(context.Context) ([]any, error) {
		return []any{map[string]any{"stageId": "act_stat", "code": "ST-1", "apCost": 15}}, nil
	}
	codes := index.StageCodeMap(context.Background(), []string{"act_stat"}, stats)
	info, ok := codes["act_stat"]
	if !ok || info.Code != "ST-1" || info.APCost != 15 {
		t.Fatalf("codes = %#v", codes)
	}
}

func TestBuildPlanUncachedDoesNotUseCache(t *testing.T) {
	server, requests := newPRTSFixture(t)
	maaDataDir := writeMaaResource(t)
	service := newFixtureService(t, server, maaDataDir, time.Now)
	if _, err := service.BuildPlan(context.Background(), "1", "normal"); err != nil {
		t.Fatal(err)
	}
	before := requests.Load()
	if _, err := service.BuildPlanUncached(context.Background(), "1", "normal"); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != before+4 {
		t.Fatalf("uncached requests = %d, want %d", requests.Load(), before+4)
	}
}

func TestHasStageTileDetectsStaleResource(t *testing.T) {
	maaDataDir := t.TempDir()
	tileDir := filepath.Join(maaDataDir, "resource", "Arknights-Tile-Pos")
	writeJSONFile(t, filepath.Join(tileDir, "act_ex01-activities-act_ex01.json"), map[string]any{"code": "EX-1"})
	hotTileDir := filepath.Join(maaDataDir, "MaaResource", "resource", "Arknights-Tile-Pos")
	writeJSONFile(t, filepath.Join(hotTileDir, "act_ex03-activities-act_ex03.json"), map[string]any{"code": "EX-3"})
	index := NewResourceIndex(config.Paths{MaaDataDir: maaDataDir})
	if !index.HasStageTile("act_ex01") {
		t.Fatal("base resource tile metadata must be found")
	}
	if !index.HasStageTile("act_ex03") {
		t.Fatal("hot-update resource tile metadata must be found")
	}
	if index.HasStageTile("act_ex02") {
		t.Fatal("missing tile metadata must be reported")
	}
	missing := NewResourceIndex(config.Paths{MaaDataDir: t.TempDir()})
	if !missing.HasStageTile("act_ex01") {
		t.Fatal("a missing tile directory must not block execution")
	}
}
