package gamedata

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseOperatorMaterials(t *testing.T) {
	characters := map[string]any{
		"char_ok": map[string]any{
			"name":       "阿米娅",
			"rarity":     "TIER_5",
			"profession": "CASTER",
			"phases": []any{
				map[string]any{},
				map[string]any{"evolveCost": []any{
					map[string]any{"id": "4001", "count": json.Number("30000")},
					map[string]any{"id": "30012", "count": json.Number("3")},
					map[string]any{"id": "3251", "count": json.Number("3")},
					map[string]any{"id": "9999", "count": json.Number("1")},
				}},
				map[string]any{"evolveCost": []any{
					map[string]any{"id": "4001", "count": json.Number("180000")},
					map[string]any{"id": "30013", "count": json.Number("5")},
					map[string]any{"id": "3252", "count": json.Number("5")},
				}},
			},
		},
		"char_numeric": map[string]any{
			"name":       "数值稀有度",
			"rarity":     json.Number("3"),
			"profession": "UNKNOWN_PROF",
			"phases": []any{
				map[string]any{},
				map[string]any{"evolveCost": []any{}},
			},
		},
		"char_low": map[string]any{
			"rarity": json.Number("2"),
			"phases": []any{map[string]any{}},
		},
		"char_not_obtainable": map[string]any{
			"rarity":          "TIER_6",
			"isNotObtainable": true,
			"phases":          []any{map[string]any{}},
		},
		"char_no_phases": map[string]any{"rarity": "TIER_6"},
		"enemy":          map[string]any{"rarity": 0, "phases": []any{}},
	}
	itemTable := map[string]any{
		"items": map[string]any{
			"30012": map[string]any{"name": "固源岩"},
			"30013": map[string]any{"name": "固源岩组"},
			"3251":  map[string]any{"name": "术师芯片"},
			"3252":  map[string]any{"name": "术师芯片组"},
		},
	}

	operators := ParseOperatorMaterials(characters, itemTable)
	if len(operators) != 2 {
		t.Fatalf("operators = %#v", operators)
	}

	ok := operators["char_ok"]
	if ok.Name != "阿米娅" || ok.Rarity != 5 || ok.Profession != "术师" {
		t.Fatalf("char_ok = %#v", ok)
	}
	if ok.Elite1 == nil || ok.Elite2 == nil {
		t.Fatalf("char_ok elite costs = %#v", ok)
	}
	if number, _ := jsNumber(ok.Elite1.LMD); number != 30000 {
		t.Fatalf("elite1 lmd = %#v", ok.Elite1.LMD)
	}
	if got := materialIDs(ok.Elite1.Materials); len(got) != 3 || got[0] != "30012" || got[1] != "3251" || got[2] != "9999" {
		t.Fatalf("elite1 materials = %v", got)
	}
	if ok.Elite1.Materials[2].Name != "9999" {
		t.Fatalf("missing item name fallback = %q", ok.Elite1.Materials[2].Name)
	}
	if got := materialIDs(ok.Elite2.Materials); len(got) != 1 || got[0] != "30013" {
		t.Fatalf("elite2 materials = %v", got)
	}
	if got := materialIDs(ok.Elite2.Chips); len(got) != 1 || got[0] != "3252" {
		t.Fatalf("elite2 chips = %v", got)
	}

	numeric := operators["char_numeric"]
	if numeric.Rarity != 4 || numeric.Profession != "UNKNOWN_PROF" {
		t.Fatalf("char_numeric = %#v", numeric)
	}
	if numeric.Elite1 == nil || numeric.Elite2 != nil {
		t.Fatalf("char_numeric elites = %#v", numeric)
	}
	if numeric.Elite1.Materials == nil || len(numeric.Elite1.Materials) != 0 {
		t.Fatalf("empty materials must be a JSON array: %#v", numeric.Elite1.Materials)
	}
	if number, _ := jsNumber(numeric.Elite1.LMD); number != 0 {
		t.Fatalf("lmd fallback = %#v", numeric.Elite1.LMD)
	}
}

func TestBuildOperatorMaterialsFileMetadata(t *testing.T) {
	characters := map[string]any{
		"char_ok": map[string]any{
			"name":       "阿",
			"rarity":     "TIER_6",
			"profession": "SPECIAL",
			"phases":     []any{map[string]any{}, map[string]any{"evolveCost": []any{}}},
		},
	}
	now := time.Date(2026, 11, 8, 23, 30, 0, 0, time.UTC)
	file := BuildOperatorMaterialsFile(characters, nil, now)
	if file.Metadata.Version != "2.0.0" || file.Metadata.LastUpdated != "2026-11-08" {
		t.Fatalf("metadata = %#v", file.Metadata)
	}
	if file.Metadata.TotalOperators != 1 || file.Metadata.Source != SourceAttribution {
		t.Fatalf("metadata = %#v", file.Metadata)
	}
	if file.Operators["char_ok"].Profession != "特种" {
		t.Fatalf("operator = %#v", file.Operators["char_ok"])
	}
	if file.Metadata.Notes != "自动从游戏数据生成，包含所有 4 星及以上可招募干员的精英化材料" {
		t.Fatalf("notes = %q", file.Metadata.Notes)
	}
}

func materialIDs(materials []OperatorMaterial) []string {
	ids := make([]string, 0, len(materials))
	for _, material := range materials {
		ids = append(ids, material.ID)
	}
	return ids
}
