package gamedata

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseOperatorMastery(t *testing.T) {
	characters := map[string]any{
		"char_ok": map[string]any{
			"name":       "阿米娅",
			"rarity":     "TIER_5",
			"profession": "CASTER",
			"phases":     []any{map[string]any{}},
			"skills": []any{
				map[string]any{
					"skillId": "sk_a",
					"levelUpCostCond": []any{
						map[string]any{
							"levelUpCost": []any{
								map[string]any{"id": "3303", "count": json.Number("2")},
								map[string]any{"id": "", "count": json.Number("1")},
								map[string]any{"count": json.Number("1")},
								map[string]any{"id": "30012", "count": json.Number("0")},
								map[string]any{"id": "30013", "count": "3"},
							},
							"unlockCond": map[string]any{"phase": "PHASE_2", "level": json.Number("1")},
						},
						map[string]any{
							"levelUpCost": []any{},
							"unlockCond":  map[string]any{},
						},
						map[string]any{},
					},
				},
				map[string]any{"skillId": ""},
				map[string]any{
					"skillId":         "sk_b",
					"levelUpCostCond": []any{map[string]any{"levelUpCost": []any{}}},
				},
			},
		},
		"char_low_rarity": map[string]any{
			"rarity": json.Number("2"),
			"phases": []any{map[string]any{}},
			"skills": []any{map[string]any{"skillId": "sk_a", "levelUpCostCond": []any{map[string]any{}}}},
		},
		"char_not_obtainable": map[string]any{
			"rarity":          "TIER_6",
			"isNotObtainable": true,
			"phases":          []any{map[string]any{}},
			"skills":          []any{map[string]any{"skillId": "sk_a", "levelUpCostCond": []any{map[string]any{}}}},
		},
		"char_obtainable_false": map[string]any{
			"rarity":          "TIER_6",
			"isNotObtainable": false,
			"profession":      "PIONEER",
			"phases":          []any{map[string]any{}},
			"skills":          []any{map[string]any{"skillId": "sk_missing", "levelUpCostCond": []any{map[string]any{}}}},
		},
		"char_no_mastery": map[string]any{
			"rarity": "TIER_6",
			"phases": []any{map[string]any{}},
			"skills": []any{map[string]any{"skillId": "sk_a"}},
		},
		"char_no_skills": map[string]any{
			"rarity": "TIER_6",
			"phases": []any{map[string]any{}},
		},
	}
	skillTable := map[string]any{
		"sk_a": map[string]any{
			"levels": []any{map[string]any{"name": "技能A", "iconId": "icon_a"}},
			"iconId": "fallback_a",
		},
		"sk_b": map[string]any{"levels": []any{}, "iconId": ""},
	}
	itemTable := map[string]any{
		"items": map[string]any{
			"3303":  map[string]any{"name": "技巧概要·卷3"},
			"30013": map[string]any{"name": "改量装置"},
		},
	}

	operators := ParseOperatorMastery(characters, skillTable, itemTable)
	if len(operators) != 2 {
		t.Fatalf("operators = %#v", operators)
	}

	operator := operators["char_ok"]
	if operator.Name != "阿米娅" || operator.Rarity != 5 {
		t.Fatalf("operator = %#v", operator)
	}
	if operator.Profession != "术师" || operator.ProfessionID != "CASTER" {
		t.Fatalf("profession = %#v", operator)
	}
	if len(operator.Skills) != 2 {
		t.Fatalf("skills = %#v", operator.Skills)
	}

	first := operator.Skills[0]
	if first.Index != 1 || first.SkillID != "sk_a" || first.Name != "技能A" {
		t.Fatalf("skill a = %#v", first)
	}
	if first.IconID == nil || *first.IconID != "icon_a" {
		t.Fatalf("icon = %#v", first.IconID)
	}
	if len(first.Mastery) != 3 {
		t.Fatalf("mastery = %#v", first.Mastery)
	}
	levelOne := first.Mastery[0]
	if levelOne.Level != 1 {
		t.Fatalf("level = %d", levelOne.Level)
	}
	if len(levelOne.Materials) != 3 {
		t.Fatalf("materials = %#v", levelOne.Materials)
	}
	if levelOne.Materials[0].ID != "3303" || levelOne.Materials[0].Name != "技巧概要·卷3" || levelOne.Materials[0].Count != 2 {
		t.Fatalf("material 0 = %#v", levelOne.Materials[0])
	}
	if levelOne.Materials[1].ID != "" || levelOne.Materials[1].Name != "" || levelOne.Materials[1].Count != 1 {
		t.Fatalf("material 1 = %#v", levelOne.Materials[1])
	}
	if levelOne.Materials[2].ID != "30013" || levelOne.Materials[2].Name != "改量装置" || levelOne.Materials[2].Count != 3 {
		t.Fatalf("material 2 = %#v", levelOne.Materials[2])
	}
	if levelOne.Unlock == nil || levelOne.Unlock.Phase == nil || *levelOne.Unlock.Phase != "PHASE_2" {
		t.Fatalf("unlock = %#v", levelOne.Unlock)
	}
	if level, _ := jsNumber(levelOne.Unlock.Level); level != 1 {
		t.Fatalf("unlock level = %#v", levelOne.Unlock.Level)
	}

	levelTwo := first.Mastery[1]
	if levelTwo.Materials == nil || len(levelTwo.Materials) != 0 {
		t.Fatalf("empty cost list = %#v", levelTwo.Materials)
	}
	if levelTwo.Unlock == nil || levelTwo.Unlock.Phase != nil || levelTwo.Unlock.Level != nil {
		t.Fatalf("empty unlockCond = %#v", levelTwo.Unlock)
	}
	if first.Mastery[2].Unlock != nil {
		t.Fatalf("missing unlockCond must omit unlock: %#v", first.Mastery[2].Unlock)
	}

	second := operator.Skills[1]
	if second.Index != 3 || second.SkillID != "sk_b" || second.Name != "sk_b" {
		t.Fatalf("skill b = %#v", second)
	}
	if second.IconID == nil || *second.IconID != "" {
		t.Fatalf("fallback icon = %#v", second.IconID)
	}

	fallback := operators["char_obtainable_false"]
	if fallback.Name != "char_obtainable_false" || fallback.Profession != "先锋" || fallback.ProfessionID != "PIONEER" {
		t.Fatalf("fallback operator = %#v", fallback)
	}
}

func TestBuildMasteryFileMetadata(t *testing.T) {
	characters := map[string]any{
		"char_ok": map[string]any{
			"name":       "阿",
			"rarity":     "TIER_6",
			"profession": "SPECIAL",
			"phases":     []any{map[string]any{}},
			"skills": []any{map[string]any{
				"skillId":         "sk_a",
				"levelUpCostCond": []any{map[string]any{}, map[string]any{}},
			}},
		},
	}
	now := time.Date(2026, 11, 8, 0, 1, 0, 0, time.UTC)
	file := BuildMasteryFile(characters, map[string]any{}, nil, now)
	if file.Metadata.Version != "1.0.0" || file.Metadata.LastUpdated != "2026-11-08" {
		t.Fatalf("metadata = %#v", file.Metadata)
	}
	if file.Metadata.TotalOperators != 1 || file.Metadata.TotalSkills != 1 {
		t.Fatalf("counts = %#v", file.Metadata)
	}
	if len(file.Metadata.SourceTables) != 3 || file.Metadata.SourceTables[0] != "character_table.json" {
		t.Fatalf("sourceTables = %#v", file.Metadata.SourceTables)
	}
	if file.Operators["char_ok"].Skills[0].IconID != nil {
		t.Fatalf("missing icon must stay null: %#v", file.Operators["char_ok"].Skills[0].IconID)
	}
}
