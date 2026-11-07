package activity

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

func testPaths(t *testing.T) config.Paths {
	t.Helper()
	root := t.TempDir()
	return config.Paths{
		DataDir:      filepath.Join(root, "data"),
		CacheDir:     filepath.Join(root, "cache"),
		MaaDataDir:   filepath.Join(root, "maa"),
		MaaCacheDir:  filepath.Join(root, "maa-cache"),
		MaaConfigDir: filepath.Join(root, "maa-config"),
		MaaStateDir:  filepath.Join(root, "maa-state"),
	}
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	if err := jsonstore.Write(path, value, true); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func testNow() time.Time {
	return time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
}

func stageActivityFixture() map[string]any {
	return map[string]any{
		"Official": map[string]any{
			"sideStoryStage": map[string]any{
				"act-active": map[string]any{
					"Activity": map[string]any{
						"StageName":     "测试活动",
						"UtcStartTime":  "2026/01/01 04:00:00",
						"UtcExpireTime": "2026/12/31 04:00:00",
						"TimeZone":      8,
					},
					"Stages": []any{
						map[string]any{"Value": "EA-6"},
						map[string]any{"Value": "EA-7"},
					},
					"MinimumRequired": 0,
				},
				"act-old": map[string]any{
					"Activity": map[string]any{
						"StageName":     "过期活动",
						"UtcStartTime":  "2025/01/01 04:00:00",
						"UtcExpireTime": "2025/02/01 04:00:00",
						"TimeZone":      8,
					},
					"Stages": []any{map[string]any{"Value": "OL-1"}},
				},
				"act-future": map[string]any{
					"Activity": map[string]any{
						"StageName":    "未来活动",
						"UtcStartTime": "2027/01/01 04:00:00",
						"TimeZone":     8,
					},
					"Stages": []any{map[string]any{"Value": "FU-1"}},
				},
			},
		},
	}
}

func writeStageActivity(t *testing.T, paths config.Paths, value any) {
	t.Helper()
	writeJSON(t, filepath.Join(paths.MaaCacheDir, "StageActivityV2.json"), value)
}

func writeStagesCatalog(t *testing.T, paths config.Paths) {
	t.Helper()
	writeJSON(t, filepath.Join(paths.MaaDataDir, "resource", "stages.json"), []any{
		map[string]any{"code": "EA-6", "stageId": "main_06"},
		map[string]any{"code": "EA-7", "stageId": "main_07"},
		map[string]any{"code": "OL-1", "stageId": "main_01"},
	})
}

func writeReadyStageTasks(t *testing.T, paths config.Paths) {
	t.Helper()
	writeJSON(t, filepath.Join(paths.MaaDataDir, "resource", "tasks", "Stages", "EA.json"), readyStageTasks())
}

func readyStageTasks() map[string]any {
	return map[string]any{
		"EA-OpenOpt": map[string]any{"next": []any{"EA-Open"}},
		"EA-Open":    map[string]any{"next": []any{"EA-6"}},
		"EA-6":       map[string]any{"sub": []any{"EA-OpenOpt"}, "next": []any{"Stop"}},
		"EA-7":       map[string]any{"sub": []any{"EA-6@EA-OpenOpt"}, "next": []any{"Stop"}},
	}
}

func TestParseStageActivityTime(t *testing.T) {
	value, ok := ParseStageActivityTime("2026/01/01 12:00:00", 8)
	if !ok {
		t.Fatal("expected parse")
	}
	want := time.Date(2026, 1, 1, 4, 0, 0, 0, time.UTC).UnixMilli()
	if value != want {
		t.Fatalf("value = %d, want %d", value, want)
	}
	if _, ok := ParseStageActivityTime("2026-01-01", 8); ok {
		t.Fatal("unexpected parse")
	}
	if _, ok := ParseStageActivityTime(nil, 8); ok {
		t.Fatal("unexpected nil parse")
	}
}

func TestSelectCurrentStageActivity(t *testing.T) {
	activity := SelectCurrentStageActivity(stageActivityFixture(), "Official", testNow())
	if activity == nil {
		t.Fatal("expected activity")
	}
	if activity.Code != "EA" {
		t.Fatalf("code = %q", activity.Code)
	}
	if activity.Name != "测试活动" {
		t.Fatalf("name = %q", activity.Name)
	}
	if activity.Source != "stage-activity" {
		t.Fatalf("source = %q", activity.Source)
	}
	if len(activity.Stages) != 2 || activity.Stages[0] != "EA-6" || activity.Stages[1] != "EA-7" {
		t.Fatalf("stages = %#v", activity.Stages)
	}
	if activity.MinimumRequired != nil {
		t.Fatalf("minimumRequired = %#v", activity.MinimumRequired)
	}
	if activity.EndTime == nil {
		t.Fatal("expected endTime")
	}
}

func TestSelectCurrentStageActivityNoData(t *testing.T) {
	if activity := SelectCurrentStageActivity(nil, "Official", testNow()); activity != nil {
		t.Fatalf("unexpected activity: %#v", activity)
	}
	// A missing client section falls back to Official, matching
	// `root[clientKey] || root.Official`.
	fallback := SelectCurrentStageActivity(stageActivityFixture(), "YostarEN", testNow())
	if fallback == nil || fallback.Code != "EA" {
		t.Fatalf("expected Official fallback, got %#v", fallback)
	}
}

func TestIsResourceCollectionOpen(t *testing.T) {
	data := map[string]any{
		"Official": map[string]any{
			"resourceCollection": map[string]any{
				"IsResourceCollection": true,
				"UtcStartTime":         "2026/01/01 04:00:00",
				"UtcExpireTime":        "2026/02/01 04:00:00",
				"TimeZone":             8,
			},
		},
	}
	if !IsResourceCollectionOpen(data, "Official", time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("expected open")
	}
	if IsResourceCollectionOpen(data, "Official", time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("expected closed after expiry")
	}
	data["Official"].(map[string]any)["resourceCollection"].(map[string]any)["IsResourceCollection"] = false
	if IsResourceCollectionOpen(data, "Official", time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("expected closed when flag is false")
	}
}

func TestIsResourceCollectionOpenNowCaches(t *testing.T) {
	paths := testPaths(t)
	current := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	service := NewWithOptions(Options{Paths: paths, Now: func() time.Time { return current }})

	writeStageActivity(t, paths, map[string]any{
		"Official": map[string]any{
			"resourceCollection": map[string]any{
				"IsResourceCollection": true,
				"UtcStartTime":         "2026/01/01 04:00:00",
				"UtcExpireTime":        "2026/02/01 04:00:00",
				"TimeZone":             8,
			},
		},
	})
	if !service.IsResourceCollectionOpenNow(context.Background(), "Official", current) {
		t.Fatal("expected open")
	}
	// Rewrite the file as closed. The 60-second cache must still return true.
	writeStageActivity(t, paths, map[string]any{
		"Official": map[string]any{
			"resourceCollection": map[string]any{
				"IsResourceCollection": true,
				"UtcStartTime":         "2020/01/01 04:00:00",
				"UtcExpireTime":        "2020/02/01 04:00:00",
				"TimeZone":             8,
			},
		},
	})
	if !service.IsResourceCollectionOpenNow(context.Background(), "Official", current.Add(30*time.Second)) {
		t.Fatal("expected cached open")
	}
	if service.IsResourceCollectionOpenNow(context.Background(), "Official", current.Add(61*time.Second)) {
		t.Fatal("expected refreshed closed state")
	}
}

func TestCurrentActivityFromStageActivity(t *testing.T) {
	paths := testPaths(t)
	writeStageActivity(t, paths, stageActivityFixture())
	writeStagesCatalog(t, paths)
	now := testNow()
	service := NewWithOptions(Options{Paths: paths, Now: func() time.Time { return now }})

	info, err := service.CurrentActivity(context.Background(), "Official")
	if err != nil {
		t.Fatal(err)
	}
	if info.Code == nil || *info.Code != "EA" {
		t.Fatalf("code = %#v", info.Code)
	}
	if info.Status != "active" {
		t.Fatalf("status = %q", info.Status)
	}
	if len(info.Stages) != 2 || info.Stages[0] != "EA-6" || info.Stages[1] != "EA-7" {
		t.Fatalf("stages = %#v", info.Stages)
	}
	value, err := jsonstore.Read(filepath.Join(paths.DataDir, "user-configs", "activity-cache.json"), nil)
	if err != nil {
		t.Fatal(err)
	}
	record := asRecord(value)
	if record == nil {
		t.Fatalf("cache = %#v", value)
	}
	entry := asRecord(record["Official"])
	if entry == nil || entry["code"] != "EA" {
		t.Fatalf("cache entry = %#v", entry)
	}

	// A second call is served from memory and stays active.
	info2, err := service.CurrentActivity(context.Background(), "Official")
	if err != nil {
		t.Fatal(err)
	}
	if info2.Status != "active" || info2.Code == nil || *info2.Code != "EA" {
		t.Fatalf("second info = %#v", info2)
	}
}

func TestCurrentActivityUsesPersistedCache(t *testing.T) {
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer server.Close()
	paths := testPaths(t)
	writeJSON(t, filepath.Join(paths.DataDir, "user-configs", "activity-cache.json"), map[string]any{
		"Official": map[string]any{
			"code":      "EA",
			"name":      "缓存活动",
			"source":    "stage-activity",
			"startTime": 1,
			"endTime":   testNow().Add(24 * time.Hour).UnixMilli(),
			"stages":    []any{"EA-6"},
			"timestamp": testNow().UnixMilli(),
			"ttl":       int64(activityCacheTTL),
		},
	})
	service := NewWithOptions(Options{
		Paths:          paths,
		Now:            testNow,
		PenguinBaseURL: server.URL,
		HTTPClient:     server.Client(),
	})
	info, err := service.CurrentActivity(context.Background(), "Official")
	if err != nil {
		t.Fatal(err)
	}
	if info.Code == nil || *info.Code != "EA" || info.Status != "active" {
		t.Fatalf("info = %#v", info)
	}
	if info.DataUpdatedAt == nil {
		t.Fatal("expected dataUpdatedAt")
	}
	if got := atomic.LoadInt32(&requests); got != 0 {
		t.Fatalf("unexpected network requests: %d", got)
	}
}

func TestCurrentActivityUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer server.Close()
	paths := testPaths(t)
	writeStageActivity(t, paths, map[string]any{"Official": map[string]any{}})
	service := NewWithOptions(Options{
		Paths:          paths,
		Now:            testNow,
		PenguinBaseURL: server.URL,
		HTTPClient:     server.Client(),
	})
	info, err := service.CurrentActivity(context.Background(), "Official")
	if err != nil {
		t.Fatal(err)
	}
	if info.Code != nil || info.Status != "none" {
		t.Fatalf("info = %#v", info)
	}
}

func TestParseMAAActivityOutput(t *testing.T) {
	name, code := parseMAAActivityOutput("当前活动：「测试活动」 (EA-6)\n")
	if code != "EA" {
		t.Fatalf("code = %q", code)
	}
	if name == nil || *name != "测试活动" {
		t.Fatalf("name = %#v", name)
	}
	_, code = parseMAAActivityOutput("SideStory: 测试 EA-12 开放中")
	if code != "EA" {
		t.Fatalf("fallback code = %q", code)
	}
}

func TestSelectCurrentPenguinActivity(t *testing.T) {
	zones := []any{
		map[string]any{
			"zoneId":   "actA",
			"type":     "ACTIVITY",
			"zoneName": "活动 A",
			"existence": map[string]any{
				"CN": map[string]any{"exist": true, "openTime": 1000, "closeTime": 2000},
			},
		},
	}
	stages := []any{
		map[string]any{"zoneId": "actA", "code": "EA-2", "existence": map[string]any{"CN": map[string]any{"exist": true, "openTime": 1000}}},
		map[string]any{"zoneId": "actA", "code": "EA-10", "existence": map[string]any{"CN": map[string]any{"exist": true, "openTime": 1000}}},
		map[string]any{"zoneId": "actA", "code": "EA-1", "existence": map[string]any{"CN": map[string]any{"exist": true, "openTime": 1000}}},
		map[string]any{"zoneId": "actA", "code": "EA-3", "existence": map[string]any{"CN": map[string]any{"exist": true, "openTime": 1000, "closeTime": 1200}}},
	}
	activity := SelectCurrentPenguinActivity(zones, stages, "CN", 1500)
	if activity == nil {
		t.Fatal("expected activity")
	}
	if activity.Code != "EA" || activity.Name != "活动 A" {
		t.Fatalf("activity = %#v", activity)
	}
	want := []string{"EA-1", "EA-2", "EA-10"}
	if len(activity.Stages) != len(want) {
		t.Fatalf("stages = %#v", activity.Stages)
	}
	for index := range want {
		if activity.Stages[index] != want[index] {
			t.Fatalf("stages = %#v, want %#v", activity.Stages, want)
		}
	}
	if activity.EndTime == nil || *activity.EndTime != 2000 {
		t.Fatalf("endTime = %#v", activity.EndTime)
	}
}

func TestFallbackServiceFetchesAndCaches(t *testing.T) {
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		if r.URL.Query().Get("server") != "CN" {
			t.Errorf("server = %q", r.URL.Query().Get("server"))
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/zones":
			_ = json.NewEncoder(w).Encode([]any{
				map[string]any{
					"zoneId": "actA", "type": "ACTIVITY", "zoneName": "活动 A",
					"existence": map[string]any{"CN": map[string]any{"exist": true, "openTime": 1000, "closeTime": 2000}},
				},
			})
		case "/stages":
			_ = json.NewEncoder(w).Encode([]any{
				map[string]any{"zoneId": "actA", "code": "EA-1", "existence": map[string]any{"CN": map[string]any{"exist": true, "openTime": 1000}}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	now := time.UnixMilli(1500)
	service := NewFallbackService(FallbackOptions{
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
		Now:        func() time.Time { return now },
	})
	activity, err := service.GetFallbackActivity(context.Background(), "Official")
	if err != nil {
		t.Fatal(err)
	}
	if activity == nil || activity.Code != "EA" {
		t.Fatalf("activity = %#v", activity)
	}
	// Bilibili shares the CN server and the cached value, so no new requests.
	cached, err := service.GetFallbackActivity(context.Background(), "Bilibili")
	if err != nil {
		t.Fatal(err)
	}
	if cached == nil || cached.Code != "EA" {
		t.Fatalf("cached = %#v", cached)
	}
	if got := atomic.LoadInt32(&requests); got != 2 {
		t.Fatalf("requests = %d, want 2", got)
	}
	if unsupported, err := service.GetFallbackActivity(context.Background(), "txwy"); err != nil || unsupported != nil {
		t.Fatalf("unsupported = %#v, %v", unsupported, err)
	}
}
