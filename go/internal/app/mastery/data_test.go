package mastery

import (
	"context"
	"strings"
	"testing"

	"github.com/mps233/la-pluma/go/internal/config"
)

func TestNormalizeMasteryData(t *testing.T) {
	raw := decodeFixtureJSON(t, masteryFixture)
	normalized := NormalizeMasteryData(raw)
	if normalized == nil {
		t.Fatal("expected normalized data")
	}
	operator, ok := normalized.Operators["char_test"]
	if !ok {
		t.Fatal("missing char_test")
	}
	if operator.Name != "测试干员" || operator.ProfessionID != "CASTER" || operator.Rarity != 6 {
		t.Fatalf("unexpected operator: %+v", operator)
	}
	if len(operator.Skills) != 2 {
		t.Fatalf("expected two skills, got %d", len(operator.Skills))
	}
	if operator.Skills[0].Index != 1 || operator.Skills[0].Name != "测试技能一" {
		t.Fatalf("skill order not preserved: %+v", operator.Skills[0])
	}
	if operator.Skills[0].IconID != nil {
		t.Fatalf("expected null iconId, got %v", *operator.Skills[0].IconID)
	}
	level := operator.Skills[0].Mastery[0]
	if level.Level != 1 || len(level.Materials) != 1 || level.Materials[0].Name != "技巧概要·卷3" {
		t.Fatalf("unexpected mastery level: %+v", level)
	}
	if level.Unlock == nil || level.Unlock.Phase == nil || *level.Unlock.Phase != "PHASE_2" {
		t.Fatalf("missing unlock phase: %+v", level.Unlock)
	}
	if level.Unlock.Level == nil || *level.Unlock.Level != 1 {
		t.Fatalf("missing unlock level: %+v", level.Unlock)
	}
	if metadataString(normalized.Metadata, "lastUpdated") == nil {
		t.Fatal("expected lastUpdated metadata")
	}

	if NormalizeMasteryData(nil) != nil {
		t.Fatal("nil root must be rejected")
	}
	if NormalizeMasteryData(decodeFixtureJSON(t, `{"operators":[]}`)) != nil {
		t.Fatal("array operators must be rejected")
	}
	empty := NormalizeMasteryData(decodeFixtureJSON(t, `{"operators":{}}`))
	if empty == nil || len(empty.Operators) != 0 {
		t.Fatal("empty operators object should normalize to an empty catalog")
	}
	if metadataString(empty.Metadata, "lastUpdated") != nil {
		t.Fatal("empty metadata must not invent lastUpdated")
	}
}

func TestRoleAndBattleName(t *testing.T) {
	if got := RoleFromProfession("CASTER"); got == nil || *got != "Caster" {
		t.Fatalf("CASTER role: %v", got)
	}
	if got := RoleFromProfession("SUPPORT"); got == nil || *got != "Support" {
		t.Fatalf("SUPPORT role: %v", got)
	}
	if RoleFromProfession("UNKNOWN") != nil {
		t.Fatal("unknown profession must not map")
	}

	name := "阿"
	nameEN := "Aak"
	nameJP := "アーク"
	nameKR := "아크"
	nameTW := "阿"
	record := &BattleRecord{Name: &name, NameEN: &nameEN, NameJP: &nameJP, NameKR: &nameKR, NameTW: &nameTW}
	for client, expected := range map[string]string{
		"Official": "阿",
		"Bilibili": "阿",
		"txwy":     "阿",
		"YostarEN": "Aak",
		"YostarJP": "アーク",
		"YostarKR": "아크",
	} {
		got, err := BattleName(record, client)
		if err != nil {
			t.Fatalf("battle name %s: %v", client, err)
		}
		if got == nil || *got != expected {
			t.Fatalf("battle name %s = %v, want %s", client, got, expected)
		}
	}
	empty := ""
	if got, err := BattleName(&BattleRecord{Name: &empty}, "Official"); err != nil || got != nil {
		t.Fatalf("empty battle name should be null: %v %v", got, err)
	}
	if got, err := BattleName(nil, "Official"); err != nil || got != nil {
		t.Fatalf("nil record: %v %v", got, err)
	}
	if _, err := BattleName(record, "NotAClient"); err == nil {
		t.Fatal("invalid client must error")
	}
}

func TestMaterialNodesForLevel(t *testing.T) {
	level := MasteryLevel{
		Level:     1,
		Materials: []MasteryMaterial{{ID: "3303", Name: "技巧概要·卷3", Count: 2}},
	}
	database := &MaterialDatabase{Items: map[string]MaterialItem{
		"3303": {Name: "技巧概要·卷3", IconID: "MTL_SKILL3"},
	}}
	nodes := MaterialNodesForLevel(level, map[string]float64{"3303": 1}, database)
	if len(nodes) != 1 {
		t.Fatalf("expected one node, got %d", len(nodes))
	}
	node := nodes[0]
	if node.ID != "3303" || node.Name != "技巧概要·卷3" || node.IconID != "MTL_SKILL3" {
		t.Fatalf("unexpected node identity: %+v", node)
	}
	if node.Have != 1 || node.Needed != 2 || node.StillNeeded != 1 || node.Count != 2 {
		t.Fatalf("unexpected node counts: %+v", node)
	}

	fallback := MaterialNodesForLevel(level, map[string]float64{}, nil)
	if fallback[0].Name != "技巧概要·卷3" || fallback[0].IconID != "3303" || fallback[0].StillNeeded != 2 {
		t.Fatalf("fallbacks not applied: %+v", fallback[0])
	}
}

func TestCatalogAndOperatorDetail(t *testing.T) {
	fixture := newTestFixture(t, nil)

	all, err := fixture.service.Catalog(CatalogOptions{Status: CandidateStatusAll, Limit: 500})
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	if all.Total != 2 || len(all.Operators) != 2 {
		t.Fatalf("expected two candidates, got %d/%d", all.Total, len(all.Operators))
	}
	if all.Operators[0].ID != "char_test" || !all.Operators[0].Eligible {
		t.Fatalf("eligible candidate should sort first: %+v", all.Operators[0])
	}
	if all.Operators[0].Name != "测试干员" || all.Operators[0].CurrentElite != 2 {
		t.Fatalf("unexpected candidate: %+v", all.Operators[0])
	}
	if all.Operators[1].DisabledReason == nil || *all.Operators[1].DisabledReason != "not_elite2" {
		t.Fatalf("char_other should be not_elite2: %+v", all.Operators[1])
	}
	if all.DataFreshness.Operbox.Timestamp == nil || all.DataFreshness.Operbox.AgeDays == nil || *all.DataFreshness.Operbox.AgeDays != 7 {
		t.Fatalf("unexpected operbox freshness: %+v", all.DataFreshness.Operbox)
	}
	if all.DataFreshness.Mastery.LastUpdated == nil || *all.DataFreshness.Mastery.LastUpdated != "2026-11-07" {
		t.Fatalf("unexpected mastery freshness: %+v", all.DataFreshness.Mastery)
	}

	eligible, err := fixture.service.Catalog(CatalogOptions{Status: CandidateStatusEligible})
	if err != nil || eligible.Total != 1 || eligible.Operators[0].ID != "char_test" {
		t.Fatalf("eligible filter: %+v %v", eligible, err)
	}
	searched, err := fixture.service.Catalog(CatalogOptions{Search: "测试"})
	if err != nil || searched.Total != 1 {
		t.Fatalf("search filter: %+v %v", searched, err)
	}
	rarity := 6
	byRarity, err := fixture.service.Catalog(CatalogOptions{Rarity: &rarity})
	if err != nil || byRarity.Total != 1 || byRarity.Operators[0].ID != "char_test" {
		t.Fatalf("rarity filter: %+v %v", byRarity, err)
	}

	detail, err := fixture.service.OperatorDetail("char_test", OperatorDetailOptions{DeclaredLevel: 0})
	if err != nil {
		t.Fatalf("operator detail: %v", err)
	}
	if detail.Name != "测试干员" || detail.NameForMaa != "测试干员" {
		t.Fatalf("unexpected names: %+v", detail)
	}
	if detail.Role == nil || *detail.Role != "Caster" {
		t.Fatalf("unexpected role: %v", detail.Role)
	}
	if detail.CurrentElite != 2 || detail.CurrentLevel != 60 || !detail.Owned || !detail.OwnedStateKnown {
		t.Fatalf("unexpected owned state: %+v", detail)
	}
	if len(detail.Skills) != 2 {
		t.Fatalf("expected two skills, got %d", len(detail.Skills))
	}
	skill := detail.Skills[0]
	if len(skill.Levels) != 3 || len(skill.Mastery) != 3 {
		t.Fatalf("unexpected level views: %+v", skill)
	}
	if skill.NextLevel == nil || skill.NextLevel.Level != 1 {
		t.Fatalf("expected next level M1: %+v", skill.NextLevel)
	}
	if len(skill.NextMaterialNodes) != 1 {
		t.Fatalf("expected one next material node, got %d", len(skill.NextMaterialNodes))
	}
	node := skill.NextMaterialNodes[0]
	if node.IconID != "MTL_SKILL3" || node.Have != 1 || node.Needed != 2 || node.StillNeeded != 1 {
		t.Fatalf("unexpected material gap: %+v", node)
	}
	if detail.DataFreshness.Depot.AgeDays == nil || *detail.DataFreshness.Depot.AgeDays != 6 {
		t.Fatalf("unexpected depot freshness: %+v", detail.DataFreshness.Depot)
	}

	localized, err := fixture.service.OperatorDetail("char_test", OperatorDetailOptions{ClientType: "YostarEN"})
	if err != nil || localized.Name != "Test Op" {
		t.Fatalf("localized name: %+v %v", localized.Name, err)
	}

	_, err = fixture.service.OperatorDetail("char_missing", OperatorDetailOptions{})
	if appErr, ok := asAppError(err); !ok || appErr.Code != "AGENT_MASTERY_OPERATOR_NOT_FOUND" || appErr.StatusCode != 404 {
		t.Fatalf("missing operator error: %v", err)
	}

	other, err := fixture.service.OperatorDetail("char_other", OperatorDetailOptions{DeclaredLevel: 1})
	if err != nil {
		t.Fatalf("char_other detail: %v", err)
	}
	if other.Skills[0].NextLevel != nil || len(other.Skills[0].NextMaterialNodes) != 0 {
		t.Fatalf("char_other has no M2 data: %+v", other.Skills[0])
	}
}

func TestPreflight(t *testing.T) {
	fixture := newTestFixture(t, nil)
	preflight, err := fixture.service.Preflight(context.Background(), "")
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	if !preflight.Supported || !preflight.Runtime.Supported {
		t.Fatalf("expected supported preflight: %+v", preflight)
	}
	if !preflight.MasteryData.Available || preflight.MasteryData.OperatorCount != 2 || preflight.MasteryData.Error != nil {
		t.Fatalf("unexpected mastery data preflight: %+v", preflight.MasteryData)
	}
	if preflight.ClientType != "Official" {
		t.Fatalf("client type: %s", preflight.ClientType)
	}
	if preflight.MinimumMaaCliVersion != "0.7.8" || preflight.MinimumMaaCoreVersion != "6.21.4" {
		t.Fatalf("minimum versions: %+v", preflight)
	}

	fixture.versions.cli = "0.7.7"
	unsupported, err := fixture.service.Preflight(context.Background(), "Official")
	if err != nil {
		t.Fatalf("unsupported preflight: %v", err)
	}
	if unsupported.Supported || unsupported.Runtime.Reason == nil || !strings.Contains(*unsupported.Runtime.Reason, "0.7.7") {
		t.Fatalf("expected version reason: %+v", unsupported)
	}

	empty := NewDataService(DataOptions{Paths: config.Paths{DataDir: t.TempDir(), MaaDataDir: t.TempDir()}})
	missing, err := empty.Preflight("Official")
	if err != nil {
		t.Fatalf("missing data preflight: %v", err)
	}
	if missing.Supported || missing.MasteryData.Available || missing.MasteryData.Error == nil {
		t.Fatalf("expected missing data error: %+v", missing)
	}
}
