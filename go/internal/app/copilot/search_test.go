package copilot

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
)

func TestStageIDsByCodeMergesMaaAndGameDataCatalogs(t *testing.T) {
	root := t.TempDir()
	maaDataDir := filepath.Join(root, "maa")
	dataDir := filepath.Join(root, "data")
	writeJSONFile(t, filepath.Join(maaDataDir, "resource", "stages.json"), []any{
		map[string]any{"code": "GT-1", "stageId": "a001_01_perm", "apCost": 9},
		map[string]any{"code": "1-7", "stageId": "main_01-07", "apCost": 6},
	})
	writeJSONFile(t, filepath.Join(dataDir, "stages.json"), map[string]any{
		"GT-1":    map[string]any{"id": "a001_01", "code": "GT-1", "name": "急中生智"},
		"TL-EX-8": map[string]any{"id": "act_test_ex08", "code": "TL-EX-8", "name": "致……"},
		"1-7":     map[string]any{"id": "main_01-07#f#", "code": "1-7", "name": "暴君"},
		"CR-8":    map[string]any{"id": "act_test_cr08", "code": "CR-8", "name": "一跃而下"},
		"HD-7":    map[string]any{"id": "act_test_hd07", "code": "HD-7", "name": "旧日余音"},
		"15-1":    map[string]any{"id": "st_15-01", "code": "15-1", "name": "过去与现在的终点"},
	})
	index := NewResourceIndex(config.Paths{DataDir: dataDir, MaaDataDir: maaDataDir})

	// MAA lists GT-1 with its permanent marker; PRTS indexes the base id. The
	// generated catalog repeats the base id, so it must be deduplicated.
	if ids := index.StageIDsByCode("GT-1"); len(ids) != 1 || ids[0] != "a001_01" {
		t.Fatalf("GT-1 ids = %#v", ids)
	}
	// Activity stages are absent from MaaResource stages.json and must come
	// from the generated game-data catalog.
	if ids := index.StageIDsByCode("TL-EX-8"); len(ids) != 1 || ids[0] != "act_test_ex08" {
		t.Fatalf("TL-EX-8 ids = %#v", ids)
	}
	if ids := index.StageIDsByCode("cr-8"); len(ids) != 1 || ids[0] != "act_test_cr08" {
		t.Fatalf("CR-8 ids = %#v", ids)
	}
	// #f# is a local variant marker, not part of the PRTS level id.
	if ids := index.StageIDsByCode("1-7"); len(ids) != 1 || ids[0] != "main_01-07" {
		t.Fatalf("1-7 ids = %#v", ids)
	}

	record, ok, err := index.StageByCode("gt-1")
	if err != nil || !ok || record["stageId"] != "a001_01_perm" {
		t.Fatalf("StageByCode(GT-1) = %#v, %v, %v", record, ok, err)
	}
}

func TestStageIDsByCodeWorksWithoutGameDataCatalog(t *testing.T) {
	maaDataDir := t.TempDir()
	writeJSONFile(t, filepath.Join(maaDataDir, "resource", "stages.json"), []any{
		map[string]any{"code": "CE-6", "stageId": "wk_melee_6"},
	})
	index := NewResourceIndex(config.Paths{DataDir: t.TempDir(), MaaDataDir: maaDataDir})
	if ids := index.StageIDsByCode("CE-6"); len(ids) != 1 || ids[0] != "wk_melee_6" {
		t.Fatalf("CE-6 ids = %#v", ids)
	}
	if ids := index.StageIDsByCode("TL-EX-8"); len(ids) != 0 {
		t.Fatalf("TL-EX-8 ids = %#v", ids)
	}
}

func newLevelCatalogFixture(t *testing.T, records []any) (*PRTSClient, *atomic.Int32) {
	t.Helper()
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/arknights/level" {
			http.NotFound(w, r)
			return
		}
		requests.Add(1)
		writeHTTPJSON(t, w, map[string]any{"status_code": 200, "data": records})
	}))
	t.Cleanup(server.Close)
	client := NewPRTSClient(PRTSClientOptions{
		BaseURL:       server.URL,
		StageStatsURL: "-",
		HTTPClient:    server.Client(),
		MaxAttempts:   1,
		Sleep:         func(context.Context, time.Duration) error { return nil },
	})
	return client, &requests
}

func TestResolveStageIDsUsesPublicLevelCatalog(t *testing.T) {
	client, requests := newLevelCatalogFixture(t, []any{
		map[string]any{"cat_three": "TL-EX-8", "stage_id": "act_test_ex08", "name": "致……"},
		map[string]any{"cat_three": "10-14（简单）", "stage_id": "easy_10-12", "name": "瞄准"},
		map[string]any{"cat_three": "10-14（标准）", "stage_id": "main_10-12", "name": "瞄准"},
		map[string]any{"cat_three": "10-14（磨难）", "stage_id": "tough_10-12", "name": "瞄准"},
		map[string]any{"cat_three": "1-7", "stage_id": "main_01-07#f#", "name": "暴君"},
		map[string]any{"cat_three": "1-7", "stage_id": "main_01-07", "name": "暴君"},
		map[string]any{"cat_three": "X-1", "stage_id": "x_1", "name": "同名"},
		map[string]any{"cat_three": "X-2", "stage_id": "x_2", "name": "同名"},
	})

	ctx := context.Background()
	if ids := client.ResolveStageIDs(ctx, "tl-ex-8"); len(ids) != 1 || ids[0] != "act_test_ex08" {
		t.Fatalf("TL-EX-8 ids = %#v", ids)
	}
	// The standard difficulty is preferred, followed by the easier and the
	// tougher variant. Duplicates from #f# entries are collapsed.
	ids := client.ResolveStageIDs(ctx, "10-14")
	want := []string{"main_10-12", "easy_10-12", "tough_10-12"}
	if len(ids) != len(want) {
		t.Fatalf("10-14 ids = %#v", ids)
	}
	for index, id := range want {
		if ids[index] != id {
			t.Fatalf("10-14 ids = %#v", ids)
		}
	}
	if ids := client.ResolveStageIDs(ctx, "10-14（磨难）"); len(ids) != 1 || ids[0] != "tough_10-12" {
		t.Fatalf("10-14（磨难） ids = %#v", ids)
	}
	if ids := client.ResolveStageIDs(ctx, "1-7"); len(ids) != 1 || ids[0] != "main_01-07" {
		t.Fatalf("1-7 ids = %#v", ids)
	}
	// An exact, unambiguous stage name resolves; ambiguous names do not guess.
	if ids := client.ResolveStageIDs(ctx, "暴君"); len(ids) != 1 || ids[0] != "main_01-07" {
		t.Fatalf("暴君 ids = %#v", ids)
	}
	if ids := client.ResolveStageIDs(ctx, "同名"); len(ids) != 0 {
		t.Fatalf("同名 ids = %#v", ids)
	}
	if ids := client.ResolveStageIDs(ctx, "不存在"); len(ids) != 0 {
		t.Fatalf("不存在 ids = %#v", ids)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("level catalog requests = %d, want 1", got)
	}
}

func TestResolveStageIDsCachesLevelCatalogFailure(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		http.Error(w, "boom", http.StatusBadGateway)
	}))
	t.Cleanup(server.Close)
	client := NewPRTSClient(PRTSClientOptions{
		BaseURL:       server.URL,
		StageStatsURL: "-",
		HTTPClient:    server.Client(),
		MaxAttempts:   1,
		Sleep:         func(context.Context, time.Duration) error { return nil },
	})
	if ids := client.ResolveStageIDs(context.Background(), "TL-EX-8"); len(ids) != 0 {
		t.Fatalf("ids = %#v", ids)
	}
	if ids := client.ResolveStageIDs(context.Background(), "TL-EX-8"); len(ids) != 0 {
		t.Fatalf("ids = %#v", ids)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("level catalog requests = %d, want 1", got)
	}
}
