package gamedata

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

func TestSeedFixtureAndIdempotence(t *testing.T) {
	fixture := seedFixture()
	server, requests := fixtureServer(t, fixture)
	outDir := t.TempDir()
	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	client := NewClient(ClientOptions{HTTPClient: server.Client(), BaseURL: server.URL, Timeout: 5 * time.Second, Now: func() time.Time { return now }})

	result, err := Seed(context.Background(), client, outDir)
	if err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 5 {
		t.Fatalf("requests = %d, want 5", requests.Load())
	}
	if result.StageCount != 1 || result.ParadoxOperatorCount != 1 || result.OperatorMaterialsCount != 1 || result.MasteryOperatorCount != 1 || result.MasterySkillCount != 1 {
		t.Fatalf("result = %#v", result)
	}
	if len(result.Paths) != 4 {
		t.Fatalf("paths = %#v", result.Paths)
	}

	first := map[string][]byte{}
	for _, name := range []string{StagesFileName, ParadoxOperatorsFileName, OperatorMaterialsFileName, OperatorMasteryFileName} {
		path := filepath.Join(outDir, name)
		data := readFileBytes(t, path)
		if len(data) == 0 {
			t.Fatalf("%s is empty", name)
		}
		first[name] = data
	}

	if _, err := Seed(context.Background(), client, outDir); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 10 {
		t.Fatalf("requests after second seed = %d, want 10", requests.Load())
	}
	for name, original := range first {
		if current := readFileBytes(t, filepath.Join(outDir, name)); string(current) != string(original) {
			t.Fatalf("%s is not idempotent", name)
		}
	}

	stages := mustRecord(t, decodeFile(t, filepath.Join(outDir, StagesFileName)), "stages")
	stage := mustRecord(t, stages["0-1"], "stage 0-1")
	if stage["thumbnail"] != StageThumbnailBaseURL+"/main_00-01.png" {
		t.Fatalf("stage = %#v", stage)
	}

	paradox := mustArray(t, decodeFile(t, filepath.Join(outDir, ParadoxOperatorsFileName)), "paradox")
	if len(paradox) != 1 || mustRecord(t, paradox[0], "paradox[0]")["stage_id"] != "mem_a" {
		t.Fatalf("paradox = %#v", paradox)
	}

	operatorMaterials := mustRecord(t, decodeFile(t, filepath.Join(outDir, OperatorMaterialsFileName)), "operator materials")
	operatorRecords := mustRecord(t, operatorMaterials["operators"], "operators")
	if len(operatorRecords) != 1 {
		t.Fatalf("operators = %#v", operatorRecords)
	}
	metadata := mustRecord(t, operatorMaterials["metadata"], "metadata")
	if metadata["lastUpdated"] != "2026-11-08" || metadata["version"] != "2.0.0" || metadata["source"] != SourceAttribution {
		t.Fatalf("metadata = %#v", metadata)
	}

	mastery := mustRecord(t, decodeFile(t, filepath.Join(outDir, OperatorMasteryFileName)), "mastery")
	masteryMetadata := mustRecord(t, mastery["metadata"], "mastery metadata")
	if masteryMetadata["totalOperators"] != json.Number("1") || masteryMetadata["totalSkills"] != json.Number("1") {
		t.Fatalf("mastery metadata = %#v", masteryMetadata)
	}
}

func TestSeedRequiresOutputDirectory(t *testing.T) {
	client := NewClient(ClientOptions{HTTPClient: http.DefaultClient})
	_, err := Seed(context.Background(), client, " ")
	applicationError, ok := apperrors.As(err)
	if !ok || applicationError.Code != "GAMEDATA_OUTPUT_REQUIRED" {
		t.Fatalf("error = %#v", err)
	}
}

func TestFetchJSONHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Error(writer, "boom", http.StatusServiceUnavailable)
	}))
	t.Cleanup(server.Close)
	client := NewClient(ClientOptions{HTTPClient: server.Client(), BaseURL: server.URL, Timeout: 5 * time.Second})

	_, err := client.fetchExcelJSON(context.Background(), "item_table.json")
	applicationError, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("error = %#v", err)
	}
	if applicationError.Code != "GAMEDATA_HTTP_ERROR" || !applicationError.Retryable {
		t.Fatalf("error = %#v", applicationError)
	}
	if status, _ := applicationError.Details["status"].(int); status != http.StatusServiceUnavailable {
		t.Fatalf("details = %#v", applicationError.Details)
	}
}

func TestFetchJSONInvalidBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte("{"))
	}))
	t.Cleanup(server.Close)
	client := NewClient(ClientOptions{HTTPClient: server.Client(), BaseURL: server.URL, Timeout: 5 * time.Second})

	_, err := client.fetchExcelJSON(context.Background(), "item_table.json")
	applicationError, ok := apperrors.As(err)
	if !ok || applicationError.Code != "GAMEDATA_INVALID_JSON" {
		t.Fatalf("error = %#v", err)
	}
}

func TestFetchJSONTransportError(t *testing.T) {
	client := NewClient(ClientOptions{
		HTTPClient: errorHTTPClient{err: errors.New("dial failed")},
		BaseURL:    "http://example.invalid",
		Timeout:    5 * time.Second,
	})
	_, err := client.fetchExcelJSON(context.Background(), "item_table.json")
	applicationError, ok := apperrors.As(err)
	if !ok || applicationError.Code != "GAMEDATA_FETCH_FAILED" || !applicationError.Retryable {
		t.Fatalf("error = %#v", err)
	}
}

type errorHTTPClient struct {
	err error
}

func (c errorHTTPClient) Do(*http.Request) (*http.Response, error) {
	return nil, c.err
}

func seedFixture() map[string]any {
	character := map[string]any{
		"name":       "阿米娅",
		"rarity":     "TIER_5",
		"profession": "CASTER",
		"phases": []any{
			map[string]any{},
			map[string]any{"evolveCost": []any{
				map[string]any{"id": "4001", "count": json.Number("30000")},
				map[string]any{"id": "30012", "count": json.Number("3")},
			}},
			map[string]any{"evolveCost": []any{
				map[string]any{"id": "4001", "count": json.Number("180000")},
				map[string]any{"id": "3252", "count": json.Number("5")},
			}},
		},
		"skills": []any{map[string]any{
			"skillId": "sk_a",
			"levelUpCostCond": []any{
				map[string]any{
					"levelUpCost": []any{map[string]any{"id": "3303", "count": json.Number("2")}},
					"unlockCond":  map[string]any{"phase": "PHASE_2", "level": json.Number("1")},
				},
			},
		}},
	}
	return map[string]any{
		"/excel/stage_table.json": map[string]any{
			"stages": map[string]any{
				"main_00-01#f#": map[string]any{
					"code":        "0-1",
					"name":        "坍塌",
					"difficulty":  "FOUR_STAR",
					"dangerLevel": "-",
					"dangerPoint": json.Number("-1"),
					"apCost":      json.Number("6"),
					"stageType":   "MAIN",
					"zoneId":      "main_0",
				},
			},
		},
		"/excel/handbook_info_table.json": map[string]any{
			"handbookStageData": map[string]any{
				"char_ok": map[string]any{"stageId": "mem_a", "name": "甲关卡"},
			},
			"handbookDict": map[string]any{},
		},
		"/excel/character_table.json": map[string]any{"char_ok": character},
		"/excel/item_table.json": map[string]any{
			"items": map[string]any{
				"30012": map[string]any{"name": "固源岩"},
				"3252":  map[string]any{"name": "术师芯片组"},
				"3303":  map[string]any{"name": "技巧概要·卷3"},
			},
		},
		"/excel/skill_table.json": map[string]any{
			"sk_a": map[string]any{
				"levels": []any{map[string]any{"name": "技能A", "iconId": "icon_a"}},
			},
		},
	}
}
