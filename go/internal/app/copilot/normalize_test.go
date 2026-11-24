package copilot

import (
	"encoding/json"
	"testing"
)

// A module implies E2 in MaaCore while the author declared E1; the whole
// copilot list is rejected unless the declared elite is raised first.
func TestNormalizeCopilotContentForMAARaisesContradictoryElite(t *testing.T) {
	content := ParseCopilotContent(map[string]any{
		"content": `{
			"stage_name": "main_17-12",
			"opers": [
				{"name": "桃金娘", "skill": 1, "requirements": {"elite": 0, "level": 1}}
			],
			"groups": [
				{"name": "地刺", "opers": [
					{"name": "狮蝎", "skill": 1, "requirements": {"elite": 1, "level": 70, "module": 1, "skill_level": 7}},
					{"name": "伊桑", "skill": 2, "requirements": {"elite": 1, "level": 60}}
				]}
			]
		}`,
	})
	NormalizeCopilotContentForMAA(content)

	groups := ContentGroups(content)
	if len(groups) != 1 {
		t.Fatalf("groups = %d", len(groups))
	}
	opers := asArray(asRecord(groups[0])["opers"])
	if elite, _ := integerValue(asRecord(opers[0])["requirements"].(map[string]any)["elite"]); elite != 2 {
		t.Fatalf("狮蝎 elite = %v, want 2", elite)
	}
	// Already consistent entries stay untouched.
	if elite, _ := integerValue(asRecord(opers[1])["requirements"].(map[string]any)["elite"]); elite != 1 {
		t.Fatalf("伊桑 elite = %v, want 1", elite)
	}
	top := asRecord(ContentOpers(content)[0])
	if elite, _ := integerValue(asRecord(top["requirements"])["elite"]); elite != 0 {
		t.Fatalf("桃金娘 elite = %v, want 0", elite)
	}
}

// The repaired content must survive MaaCore's own rule, which is what the
// validator below re-implements.
func TestNormalizeCopilotContentForMAASatisfiesMaaCoreRule(t *testing.T) {
	raw := `{
		"groups": [
			{"name": "三阶段沙包", "opers": [
				{"name": "若叶睦", "skill": 1, "requirements": {"elite": 0, "level": 1, "skill_level": 7}}
			]}
		]
	}`
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		t.Fatal(err)
	}
	content := Content(parsed)
	NormalizeCopilotContentForMAA(content)

	oper := asRecord(asArray(asRecord(ContentGroups(content)[0])["opers"])[0])
	requirements := asRecord(oper["requirements"])
	declared, _ := integerValue(requirements["elite"])
	if required := derivedEliteRequirement(oper, requirements); required > declared {
		t.Fatalf("content still rejected: requires %d, declares %d", required, declared)
	}
}

func TestNormalizeCopilotContentForMAASkipsMissingRequirements(t *testing.T) {
	content := Content{"opers": []any{map[string]any{"name": "桃金娘"}}}
	NormalizeCopilotContentForMAA(content)
	if _, exists := asRecord(ContentOpers(content)[0])["requirements"]; exists {
		t.Fatal("missing requirements must not be invented")
	}
}
