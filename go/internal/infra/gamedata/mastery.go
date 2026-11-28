package gamedata

import (
	"strings"
	"time"

	"github.com/mps233/la-pluma/go/internal/util/jsval"
)

// OperatorMasteryFileName is the generated skill mastery material table.
const OperatorMasteryFileName = "operator-mastery.json"

// MasteryMaterial is one item count in a mastery level.
type MasteryMaterial struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Count float64 `json:"count"`
}

// MasteryUnlock is the phase/level gate attached to a mastery level.
type MasteryUnlock struct {
	Phase *string `json:"phase,omitempty"`
	Level any     `json:"level,omitempty"`
}

// MasteryLevel is one M1-M3 entry. Materials may be empty when the source
// table defines an empty cost list.
type MasteryLevel struct {
	Level     int               `json:"level"`
	Materials []MasteryMaterial `json:"materials"`
	Unlock    *MasteryUnlock    `json:"unlock,omitempty"`
}

// OperatorSkill is one skill slot from operator-mastery.json.
type OperatorSkill struct {
	Index   int            `json:"index"`
	SkillID string         `json:"skillId"`
	Name    string         `json:"name"`
	IconID  *string        `json:"iconId"`
	Mastery []MasteryLevel `json:"mastery"`
}

// OperatorMastery is one operator record from operator-mastery.json.
type OperatorMastery struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Rarity       int             `json:"rarity"`
	Profession   string          `json:"profession"`
	ProfessionID string          `json:"professionId"`
	Skills       []OperatorSkill `json:"skills"`
}

// MasteryMetadata is the generated file metadata.
type MasteryMetadata struct {
	Version        string   `json:"version"`
	LastUpdated    string   `json:"lastUpdated"`
	TotalOperators int      `json:"totalOperators"`
	TotalSkills    int      `json:"totalSkills"`
	Source         string   `json:"source"`
	SourceTables   []string `json:"sourceTables"`
	Notes          string   `json:"notes"`
}

// MasteryFile is the root of operator-mastery.json.
type MasteryFile struct {
	Operators map[string]OperatorMastery `json:"operators"`
	Metadata  MasteryMetadata            `json:"metadata"`
}

// ParseOperatorMastery builds skill and M1-M3 mastery requirements for
// recruitable 4-star-and-above operators, mirroring parseOperatorMastery.
func ParseOperatorMastery(characterData any, skillTable any, itemTable any) map[string]OperatorMastery {
	characters := jsval.Record(characterData)
	skillRecords := jsval.Record(skillTable)
	itemRecords := jsval.Record(jsval.Record(itemTable)["items"])
	itemName := func(id string) string {
		item := jsval.Record(itemRecords[id])
		if item == nil {
			return id
		}
		if name, ok := jsval.TextOK(item["name"]); ok && name != "" {
			return name
		}
		return id
	}

	operators := map[string]OperatorMastery{}
	for charID, rawCharacter := range characters {
		character := jsval.Record(rawCharacter)
		if character == nil {
			continue
		}
		if notObtainable, ok := character["isNotObtainable"].(bool); ok && notObtainable {
			continue
		}
		phases := jsval.Array(character["phases"])
		if len(phases) == 0 {
			continue
		}
		rarity := masteryRarity(character["rarity"])
		if rarity < 4 {
			continue
		}
		rawSkills := jsval.Array(character["skills"])
		if len(rawSkills) == 0 {
			continue
		}

		skills := make([]OperatorSkill, 0, len(rawSkills))
		for index, rawSkill := range rawSkills {
			skill := jsval.Record(rawSkill)
			if skill == nil {
				continue
			}
			skillID, ok := jsval.TextOK(skill["skillId"])
			if !ok || skillID == "" {
				continue
			}

			skillRecord := jsval.Record(skillRecords[skillID])
			levels := jsval.Array(skillRecord["levels"])
			var firstLevel map[string]any
			if len(levels) > 0 {
				firstLevel = jsval.Record(levels[0])
			}
			skillName := skillID
			if name, ok := jsval.TextOK(firstLevel["name"]); ok && name != "" {
				skillName = name
			}

			var iconID *string
			if icon, ok := jsval.TextOK(firstLevel["iconId"]); ok && icon != "" {
				iconID = &icon
			} else if icon, ok := jsval.TextOK(skillRecord["iconId"]); ok {
				iconID = &icon
			}

			mastery := make([]MasteryLevel, 0)
			conditions := jsval.Array(skill["levelUpCostCond"])
			for masteryIndex, rawCondition := range conditions {
				condition := jsval.Record(rawCondition)
				if condition == nil {
					continue
				}

				materials := make([]MasteryMaterial, 0)
				for _, rawCost := range jsval.Array(condition["levelUpCost"]) {
					cost := jsval.Record(rawCost)
					if cost == nil || cost["id"] == nil {
						continue
					}
					count, ok := jsval.FiniteNumberOrNull(cost["count"])
					if !ok || count <= 0 {
						continue
					}
					id := jsval.StringJSON(cost["id"])
					materials = append(materials, MasteryMaterial{
						ID:    id,
						Name:  itemName(id),
						Count: count,
					})
				}

				var unlock *MasteryUnlock
				if unlockRecord := jsval.Record(condition["unlockCond"]); unlockRecord != nil {
					unlock = &MasteryUnlock{}
					if phase, ok := jsval.TextOK(unlockRecord["phase"]); ok {
						unlock.Phase = &phase
					}
					if level, ok := jsval.Numeric(unlockRecord["level"]); ok {
						unlock.Level = level
					}
				}

				mastery = append(mastery, MasteryLevel{
					Level:     masteryIndex + 1,
					Materials: materials,
					Unlock:    unlock,
				})
			}
			if len(mastery) == 0 {
				continue
			}

			skills = append(skills, OperatorSkill{
				Index:   index + 1,
				SkillID: skillID,
				Name:    skillName,
				IconID:  iconID,
				Mastery: mastery,
			})
		}
		if len(skills) == 0 {
			continue
		}

		professionID := "UNKNOWN"
		if value, ok := jsval.TextOK(character["profession"]); ok {
			professionID = value
		}
		profession := professionID
		if mapped, exists := professionMap[professionID]; exists {
			profession = mapped
		}
		operators[charID] = OperatorMastery{
			ID:           charID,
			Name:         operatorName(character["name"], charID),
			Rarity:       rarity,
			Profession:   profession,
			ProfessionID: professionID,
			Skills:       skills,
		}
	}
	return operators
}

// BuildMasteryFile adds the metadata block used by the generated file. now is
// normalized to its UTC date.
func BuildMasteryFile(characterData any, skillTable any, itemTable any, now time.Time) MasteryFile {
	operators := ParseOperatorMastery(characterData, skillTable, itemTable)
	totalSkills := 0
	for _, operator := range operators {
		totalSkills += len(operator.Skills)
	}
	return MasteryFile{
		Operators: operators,
		Metadata: MasteryMetadata{
			Version:        "1.0.0",
			LastUpdated:    dateOnly(now),
			TotalOperators: len(operators),
			TotalSkills:    totalSkills,
			Source:         SourceAttribution,
			SourceTables:   []string{"character_table.json", "skill_table.json", "item_table.json"},
			Notes:          "包含 4 星及以上可招募干员的技能与 M1-M3 专精材料；运行时权威状态以 MaaCore OperProgress 回调为准",
		},
	}
}

// FetchMastery fetches the three source tables and builds
// operator-mastery.json.

func masteryRarity(value any) int {
	if number, ok := jsval.Numeric(value); ok {
		return int(number) + 1
	}
	if text, ok := jsval.TextOK(value); ok && strings.HasPrefix(text, "TIER_") {
		return parseIntJS(strings.TrimPrefix(text, "TIER_"))
	}
	return 0
}

func operatorName(value any, fallback string) string {
	if name, ok := jsval.TextOK(value); ok && name != "" {
		return name
	}
	return fallback
}
