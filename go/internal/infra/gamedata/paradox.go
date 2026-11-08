package gamedata

import (
	"context"
	"sort"
	"unicode"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// ParadoxOperatorsFileName is the generated paradox simulation index.
const ParadoxOperatorsFileName = "paradox-operators.json"

// ParadoxOperator matches server/scripts/fetch-paradox-operators.ts.
type ParadoxOperator struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	StageID   any    `json:"stage_id"`
	StageName any    `json:"stage_name"`
}

// ParseParadoxOperators joins handbook_info_table.json and character_table.json
// into the paradox operator list. Entries without a stage id are dropped and
// the result is sorted by display name with Chinese collation, approximating
// name.localeCompare(name, 'zh-Hans-CN').
//
// Go maps have no insertion order, so equal names use the character id as a
// deterministic tie-breaker. Node keeps document order for exact ties.
func ParseParadoxOperators(handbook any, characters any) []ParadoxOperator {
	handbookRecord := asRecord(handbook)
	stageData := asRecord(handbookRecord["handbookStageData"])
	handbookDict := asRecord(handbookRecord["handbookDict"])
	characterRecords := asRecord(characters)

	operators := make([]ParadoxOperator, 0, len(stageData))
	for charID, rawStage := range stageData {
		stage := asRecord(rawStage)
		if stage == nil {
			stage = map[string]any{}
		}

		character := asRecord(characterRecords[charID])
		characterName := character["name"]
		dictEntry := asRecord(handbookDict[charID])
		dictName := dictEntry["infoName"]

		stageID := firstTruthy(stage["stageId"], stage["code"])
		if !truthy(stageID) {
			continue
		}

		operators = append(operators, ParadoxOperator{
			ID:        charID,
			Name:      jsString(firstTruthy(characterName, dictName, charID)),
			StageID:   stageID,
			StageName: firstTruthy(stage["name"], ""),
		})
	}

	collator := collate.New(language.Make("zh-Hans-CN"))
	sort.SliceStable(operators, func(i, j int) bool {
		if comparison := compareDisplayNames(collator, operators[i].Name, operators[j].Name); comparison != 0 {
			return comparison < 0
		}
		return operators[i].ID < operators[j].ID
	})
	return operators
}

// compareDisplayNames approximates name.localeCompare(name, 'zh-Hans-CN').
// x/text's zh collation sorts Latin before Han, while ICU (Node) sorts Han
// before Latin and digits before both. The first-rune group rank reproduces
// that script order; the collator handles pinyin within each group.
func compareDisplayNames(collator *collate.Collator, left, right string) int {
	if leftRank, rightRank := collationRank(left), collationRank(right); leftRank != rightRank {
		return leftRank - rightRank
	}
	return collator.CompareString(left, right)
}

func collationRank(text string) int {
	for _, character := range text {
		switch {
		case unicode.Is(unicode.Han, character):
			return 2
		case unicode.IsDigit(character):
			return 1
		case unicode.IsLetter(character):
			if unicode.Is(unicode.Latin, character) {
				return 3
			}
			return 4
		default:
			return 0
		}
	}
	return 0
}

// FetchParadoxOperators fetches the handbook and character tables and builds
// paradox-operators.json.
func (c *Client) FetchParadoxOperators(ctx context.Context) ([]ParadoxOperator, error) {
	handbook, err := c.fetchExcelJSON(ctx, "handbook_info_table.json")
	if err != nil {
		return nil, err
	}
	characters, err := c.fetchExcelJSON(ctx, "character_table.json")
	if err != nil {
		return nil, err
	}
	return ParseParadoxOperators(handbook, characters), nil
}
