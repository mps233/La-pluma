package gamedata

import (
	"context"
	"strings"
	"time"
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
	characters := asRecord(characterData)
	skillRecords := asRecord(skillTable)
	itemRecords := asRecord(asRecord(itemTable)["items"])
	itemName := func(id string) string {
		item := asRecord(itemRecords[id])
		if item == nil {
			return id
		}
		if name, ok := stringValue(item["name"]); ok && name != "" {
			return name
		}
		return id
	}

	operators := map[string]OperatorMastery{}
	for charID, rawCharacter := range characters {
		character := asRecord(rawCharacter)
		if character == nil {
			continue
		}
		if notObtainable, ok := character["isNotObtainable"].(bool); ok && notObtainable {
			continue
		}
		phases, ok := asArrayOK(character["phases"])
		if !ok || len(phases) == 0 {
			continue
		}
		rarity := masteryRarity(character["rarity"])
		if rarity < 4 {
			continue
		}
		rawSkills, ok := asArrayOK(character["skills"])
		if !ok || len(rawSkills) == 0 {
			continue
		}

		skills := make([]OperatorSkill, 0, len(rawSkills))
		for index, rawSkill := range rawSkills {
			skill := asRecord(rawSkill)
			if skill == nil {
				continue
			}
			skillID, ok := stringValue(skill["skillId"])
			if !ok || skillID == "" {
				continue
			}

			skillRecord := asRecord(skillRecords[skillID])
			levels := asArray(skillRecord["levels"])
			var firstLevel map[string]any
			if len(levels) > 0 {
				firstLevel = asRecord(levels[0])
			}
			skillName := skillID
			if name, ok := stringValue(firstLevel["name"]); ok && name != "" {
				skillName = name
			}

			var iconID *string
			if icon, ok := stringValue(firstLevel["iconId"]); ok && icon != "" {
				iconID = &icon
			} else if icon, ok := stringValue(skillRecord["iconId"]); ok {
				iconID = &icon
			}

			mastery := make([]MasteryLevel, 0)
			conditions := asArray(skill["levelUpCostCond"])
			for masteryIndex, rawCondition := range conditions {
				condition := asRecord(rawCondition)
				if condition == nil {
					continue
				}

				materials := make([]MasteryMaterial, 0)
				for _, rawCost := range asArray(condition["levelUpCost"]) {
					cost := asRecord(rawCost)
					if cost == nil || cost["id"] == nil {
						continue
					}
					count, ok := jsNumber(cost["count"])
					if !ok || count <= 0 {
						continue
					}
					id := jsString(cost["id"])
					materials = append(materials, MasteryMaterial{
						ID:    id,
						Name:  itemName(id),
						Count: count,
					})
				}

				var unlock *MasteryUnlock
				if unlockRecord := asRecord(condition["unlockCond"]); unlockRecord != nil {
					unlock = &MasteryUnlock{}
					if phase, ok := stringValue(unlockRecord["phase"]); ok {
						unlock.Phase = &phase
					}
					if level, ok := numericValue(unlockRecord["level"]); ok {
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
		if value, ok := stringValue(character["profession"]); ok {
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
func (c *Client) FetchMastery(ctx context.Context, now time.Time) (MasteryFile, error) {
	tables, err := c.fetchTables(ctx, "character_table.json", "skill_table.json", "item_table.json")
	if err != nil {
		return MasteryFile{}, err
	}
	return BuildMasteryFile(
		tables["character_table.json"],
		tables["skill_table.json"],
		tables["item_table.json"],
		now,
	), nil
}

func masteryRarity(value any) int {
	if number, ok := numericValue(value); ok {
		return int(number) + 1
	}
	if text, ok := stringValue(value); ok && strings.HasPrefix(text, "TIER_") {
		return parseIntJS(strings.TrimPrefix(text, "TIER_"))
	}
	return 0
}

func operatorName(value any, fallback string) string {
	if name, ok := stringValue(value); ok && name != "" {
		return name
	}
	return fallback
}
