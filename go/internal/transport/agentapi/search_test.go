package agentapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/app/copilot"
	"github.com/mps233/la-pluma/go/internal/config"
)

func copilotContent(t *testing.T, stageName, title string) string {
	t.Helper()
	encoded, err := json.Marshal(map[string]any{
		"stage_name": stageName,
		"doc":        map[string]any{"title": title},
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func writeSearchJSON(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Errorf("encode response: %v", err)
	}
}

// newSearchPRTSFixture mimics the public copilot search: an unknown level
// keyword returns the unfiltered global list, while a valid internal level id
// returns operations whose content.stage_name matches it.
func newSearchPRTSFixture(t *testing.T) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var queries atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/arknights/level", func(w http.ResponseWriter, r *http.Request) {
		writeSearchJSON(t, w, map[string]any{
			"status_code": 200,
			"data": []any{
				map[string]any{"cat_three": "TL-EX-8", "stage_id": "act_test_ex08", "name": "致……"},
				map[string]any{"cat_three": "GT-1", "stage_id": "a001_01", "name": "急中生智"},
			},
		})
	})
	mux.HandleFunc("/copilot/query", func(w http.ResponseWriter, r *http.Request) {
		queries.Add(1)
		if r.URL.Query().Get("page") != "1" {
			writeSearchJSON(t, w, map[string]any{
				"status_code": 200,
				"data":        map[string]any{"data": []any{}},
			})
			return
		}
		keyword := r.URL.Query().Get("level_keyword")
		globalItem := map[string]any{
			"id":      999,
			"views":   10,
			"content": copilotContent(t, "act_other_01", "别处的作业"),
		}
		items := []any{globalItem}
		switch keyword {
		case "act_test_ex08":
			items = []any{
				map[string]any{"id": 101, "views": 100, "hot_score": 9.5, "content": copilotContent(t, "act_test_ex08", "时间啊，向前！ - TL-EX-8 - 致……")},
				map[string]any{"id": 102, "views": 90, "hot_score": 8.5, "content": copilotContent(t, "act_test_ex08", "TL-EX-8 五人摆完挂机")},
				map[string]any{"id": 103, "views": 80, "content": copilotContent(t, "act_other_01", "不应命中")},
			}
		case "a001_01":
			items = []any{
				map[string]any{"id": 201, "views": 70, "content": copilotContent(t, "a001_01", "GT-1 急中生智")},
			}
		}
		writeSearchJSON(t, w, map[string]any{
			"status_code": 200,
			"data":        map[string]any{"data": items},
		})
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server, &queries
}

func newSearchPRTSClient(t *testing.T, server *httptest.Server) *copilot.PRTSClient {
	t.Helper()
	return copilot.NewPRTSClient(copilot.PRTSClientOptions{
		BaseURL:       server.URL,
		StageStatsURL: "-",
		HTTPClient:    server.Client(),
		MaxAttempts:   1,
		Sleep:         func(context.Context, time.Duration) error { return nil },
	})
}

func TestSearchCopilotsByKeywordsFallsBackToLiveLevelTable(t *testing.T) {
	server, queries := newSearchPRTSFixture(t)
	prts := newSearchPRTSClient(t, server)

	// MAA maps GT-1 to its permanent id, which PRTS does not index. The query
	// then returns the global list, no result matches, and the live level
	// table supplies the base id that does match.
	results, keywords, err := searchCopilotsByKeywords(context.Background(), prts, "GT-1", []string{"a001_01_perm"}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0]["stageName"] != "a001_01" {
		t.Fatalf("results = %#v", results)
	}
	wantKeywords := []string{"a001_01_perm", "a001_01"}
	if len(keywords) != len(wantKeywords) || keywords[0] != wantKeywords[0] || keywords[1] != wantKeywords[1] {
		t.Fatalf("keywords = %#v", keywords)
	}
	// The unmatched keyword must stop after its first page; paging the global
	// list five times would only delay the fallback.
	if got := queries.Load(); got != 2 {
		t.Fatalf("copilot queries = %d, want 2", got)
	}
}

func TestSearchCopilotsByKeywordsFiltersUnmatchedGlobalList(t *testing.T) {
	server, _ := newSearchPRTSFixture(t)
	prts := newSearchPRTSClient(t, server)

	results, _, err := searchCopilotsByKeywords(context.Background(), prts, "NOPE-9", nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 0 {
		t.Fatalf("results = %#v", results)
	}
}

func TestSearchCopilotRouteUsesGameDataCatalog(t *testing.T) {
	application, handler := newTestHandler(t)
	dataDir := t.TempDir()
	writeTestFile(t, filepath.Join(dataDir, "stages.json"), `{"TL-EX-8":{"id":"act_test_ex08","code":"TL-EX-8"}}`)
	server, _ := newSearchPRTSFixture(t)
	application.Copilot = copilot.NewWithOptions(copilot.ServiceOptions{
		Paths: config.Paths{DataDir: dataDir, MaaDataDir: t.TempDir()},
		PRTS:  newSearchPRTSClient(t, server),
	})

	rec := doRequest(t, handler, http.MethodGet, "/copilot/search?stage=TL-EX-8")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	data := envelopeData(t, rec)
	copilots, _ := data["copilots"].([]any)
	if len(copilots) != 2 {
		t.Fatalf("copilots = %#v", copilots)
	}
	recommended, _ := data["recommended"].(map[string]any)
	if recommended == nil || recommended["id"] != float64(101) {
		t.Fatalf("recommended = %#v", recommended)
	}
}

func TestSearchCopilotRouteReturnsNotFoundForUnknownStage(t *testing.T) {
	application, handler := newTestHandler(t)
	server, _ := newSearchPRTSFixture(t)
	application.Copilot = copilot.NewWithOptions(copilot.ServiceOptions{
		Paths: config.Paths{DataDir: t.TempDir(), MaaDataDir: t.TempDir()},
		PRTS:  newSearchPRTSClient(t, server),
	})

	rec := doRequest(t, handler, http.MethodGet, "/copilot/search?stage=NOPE-9")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if code := envelopeErrorCode(t, rec); code != "AGENT_COPILOT_NOT_FOUND" {
		t.Fatalf("code = %q", code)
	}
}
