package gamedata

import (
	"testing"
)

func TestParseParadoxOperators(t *testing.T) {
	handbook := map[string]any{
		"handbookStageData": map[string]any{
			"char_a": map[string]any{"stageId": "mem_a", "name": "甲关卡"},
			"char_b": map[string]any{"code": "mem_b"},
			"char_c": map[string]any{},
			"char_d": map[string]any{"stageId": "mem_d", "name": "丁关卡"},
			"char_e": "not-a-record",
		},
		"handbookDict": map[string]any{
			"char_a": map[string]any{"infoName": "字典甲"},
			"char_b": map[string]any{"infoName": "字典乙"},
		},
	}
	characters := map[string]any{
		"char_a": map[string]any{"name": "陈"},
		"char_b": map[string]any{"name": "阿"},
		"char_c": map[string]any{"name": "丙"},
		"char_d": map[string]any{"name": ""},
	}

	operators := ParseParadoxOperators(handbook, characters)
	if len(operators) != 3 {
		t.Fatalf("operators = %#v", operators)
	}

	byID := map[string]ParadoxOperator{}
	for _, operator := range operators {
		byID[operator.ID] = operator
	}
	if got := byID["char_a"]; got.Name != "陈" || got.StageID != "mem_a" || got.StageName != "甲关卡" {
		t.Fatalf("char_a = %#v", got)
	}
	if got := byID["char_b"]; got.Name != "阿" || got.StageID != "mem_b" || got.StageName != "" {
		t.Fatalf("char_b = %#v", got)
	}
	if got := byID["char_d"]; got.Name != "char_d" || got.StageID != "mem_d" {
		t.Fatalf("char_d = %#v", got)
	}

	// zh-Hans-CN collation orders Han (阿 before 陈) before Latin (char_d).
	if operators[0].ID != "char_b" || operators[1].ID != "char_a" || operators[2].ID != "char_d" {
		t.Fatalf("collation order = %v, %v, %v", operators[0].Name, operators[1].Name, operators[2].Name)
	}
}

func TestParseParadoxOperatorsEmpty(t *testing.T) {
	operators := ParseParadoxOperators(nil, nil)
	if operators == nil {
		t.Fatal("expected an empty slice, not nil")
	}
	if len(operators) != 0 {
		t.Fatalf("operators = %#v", operators)
	}
}
