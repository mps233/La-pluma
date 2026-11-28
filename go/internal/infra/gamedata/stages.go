package gamedata

import (
	"regexp"

	"github.com/mps233/la-pluma/go/internal/util/jsval"
)

// StagesFileName is the generated stage catalog consumed by the app.
const StagesFileName = "stages.json"

var stageIDSuffixPattern = regexp.MustCompile(`#[fn]#`)

// StageInfo matches server/scripts/fetch-stage-data.ts.
type StageInfo struct {
	ID              string `json:"id"`
	Code            any    `json:"code"`
	Name            any    `json:"name"`
	Difficulty      any    `json:"difficulty"`
	DangerLevel     any    `json:"dangerLevel"`
	DangerPoint     any    `json:"dangerPoint"`
	APCost          any    `json:"apCost"`
	StageType       any    `json:"stageType"`
	Thumbnail       string `json:"thumbnail"`
	ZoneID          any    `json:"zoneId"`
	ZoneName        string `json:"zoneName,omitempty"`
	IsMainStage     bool   `json:"isMainStage"`
	IsActivityStage bool   `json:"isActivityStage"`
	IsResourceStage bool   `json:"isResourceStage"`
}

// ParseStageData turns stage_table.json into a code-keyed stage catalog. It
// mirrors parseStageData: non-object entries and stages without a usable code
// are skipped, and the thumbnail strips #f#/#n# difficulty suffixes.
func ParseStageData(stageTable any) map[string]StageInfo {
	stages := map[string]StageInfo{}
	table := jsval.Record(stageTable)
	stageData := jsval.Record(table["stages"])

	for stageID, rawStage := range stageData {
		stage := jsval.Record(rawStage)
		if stage == nil {
			continue
		}
		code, present := stage["code"]
		if !present || !jsval.Truthy(code) {
			continue
		}
		if text, ok := code.(string); ok && text == "null" {
			continue
		}

		stageType, _ := jsval.TextOK(stage["stageType"])
		stages[jsval.StringJSON(code)] = StageInfo{
			ID:              stageID,
			Code:            code,
			Name:            stage["name"],
			Difficulty:      stage["difficulty"],
			DangerLevel:     firstTruthy(stage["dangerLevel"], ""),
			DangerPoint:     firstTruthy(stage["dangerPoint"], 0),
			APCost:          firstTruthy(stage["apCost"], 0),
			StageType:       stage["stageType"],
			Thumbnail:       StageThumbnailBaseURL + "/" + stageIDSuffixPattern.ReplaceAllString(stageID, "") + ".png",
			ZoneID:          stage["zoneId"],
			IsMainStage:     stageType == "MAIN",
			IsActivityStage: stageType == "ACTIVITY" || stageType == "CAMPAIGN",
			IsResourceStage: stageType == "DAILY" || stageType == "WEEKLY",
		}
	}
	return stages
}

// FetchStages fetches and parses excel/stage_table.json.
