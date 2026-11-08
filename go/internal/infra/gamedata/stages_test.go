package gamedata

import (
	"encoding/json"
	"testing"
)

func TestParseStageData(t *testing.T) {
	table := map[string]any{
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
			"act_01#n#": map[string]any{
				"code":      "ACT-1",
				"name":      "活动",
				"stageType": "ACTIVITY",
			},
			"daily_ce_5": map[string]any{
				"code":      "CE-5",
				"name":      "钱本",
				"stageType": "DAILY",
				"apCost":    json.Number("30"),
			},
			"campaign": map[string]any{
				"code":      "CA-1",
				"stageType": "CAMPAIGN",
			},
			"weekly": map[string]any{
				"code":      "AP-5",
				"stageType": "WEEKLY",
			},
			"null_code":    map[string]any{"code": "null", "name": "skip"},
			"missing_code": map[string]any{"name": "skip"},
			"zero_code":    map[string]any{"code": json.Number("0"), "name": "skip"},
			"not_record":   "skip",
		},
	}

	stages := ParseStageData(table)
	if len(stages) != 5 {
		t.Fatalf("stages = %d, want 5", len(stages))
	}

	main := stages["0-1"]
	if main.ID != "main_00-01#f#" {
		t.Fatalf("id = %q", main.ID)
	}
	if main.Thumbnail != StageThumbnailBaseURL+"/main_00-01.png" {
		t.Fatalf("thumbnail = %q", main.Thumbnail)
	}
	if main.DangerLevel != "-" {
		t.Fatalf("dangerLevel = %#v", main.DangerLevel)
	}
	if number, _ := numericValue(main.APCost); number != 6 {
		t.Fatalf("apCost = %#v", main.APCost)
	}
	if !main.IsMainStage || main.IsActivityStage || main.IsResourceStage {
		t.Fatalf("main flags = %#v", main)
	}

	activity := stages["ACT-1"]
	if !activity.IsActivityStage || activity.IsMainStage || activity.IsResourceStage {
		t.Fatalf("activity flags = %#v", activity)
	}
	if activity.DangerLevel != "" {
		t.Fatalf("activity dangerLevel = %#v", activity.DangerLevel)
	}
	if activity.DangerPoint != 0 || activity.APCost != 0 {
		t.Fatalf("activity defaults = %#v / %#v", activity.DangerPoint, activity.APCost)
	}
	if activity.Thumbnail != StageThumbnailBaseURL+"/act_01.png" {
		t.Fatalf("activity thumbnail = %q", activity.Thumbnail)
	}

	if !stages["CA-1"].IsActivityStage || !stages["CE-5"].IsResourceStage || !stages["AP-5"].IsResourceStage {
		t.Fatalf("stage type flags not mapped")
	}
	if _, ok := stages["null"]; ok {
		t.Fatal("literal null code must be skipped")
	}
	if _, ok := stages["0"]; ok {
		t.Fatal("zero code must be skipped")
	}
}

func TestParseStageDataInvalidTable(t *testing.T) {
	if stages := ParseStageData(nil); len(stages) != 0 {
		t.Fatalf("nil table = %#v", stages)
	}
	if stages := ParseStageData(map[string]any{"stages": []any{}}); len(stages) != 0 {
		t.Fatalf("array stages = %#v", stages)
	}
}
