package activity

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

func TestAssessActivityNavigationReady(t *testing.T) {
	activity := map[string]any{
		"code":   "ea",
		"name":   "测试活动",
		"source": "stage-activity",
		"stages": []any{"EA-6", "EA-7"},
	}
	result := AssessActivityNavigation(activity, readyStageTasks())
	if result.State != "ready" || !result.CanPrepare || result.CanRun {
		t.Fatalf("result = %#v", result)
	}
	if result.ReasonCode != nil {
		t.Fatalf("reasonCode = %#v", result.ReasonCode)
	}
	if result.Activity.Code == nil || *result.Activity.Code != "EA" {
		t.Fatalf("activity = %#v", result.Activity)
	}
	if result.Activity.Name == nil || *result.Activity.Name != "测试活动" {
		t.Fatalf("name = %#v", result.Activity.Name)
	}
	if result.Navigation == nil || result.Navigation.StageCount != 2 {
		t.Fatalf("navigation = %#v", result.Navigation)
	}
	if result.Navigation.EntryTask != "EA-OpenOpt" || result.Navigation.StageFile != "tasks/Stages/EA.json" {
		t.Fatalf("navigation = %#v", result.Navigation)
	}
}

func TestAssessActivityNavigationOpenOcrVariant(t *testing.T) {
	tasks := map[string]any{
		"EA-OpenOpt": map[string]any{"next": []any{"EA-OpenOcr"}},
		"EA-OpenOcr": map[string]any{"next": []any{"EA-6"}},
		"EA-6":       map[string]any{"sub": []any{"EA-OpenOpt"}, "next": []any{"Stop"}},
	}
	result := AssessActivityNavigation(map[string]any{"code": "EA", "stages": []any{"EA-6"}}, tasks)
	if result.State != "ready" {
		t.Fatalf("result = %#v", result)
	}
}

func TestAssessActivityNavigationImplicitSubReference(t *testing.T) {
	tasks := readyStageTasks()
	result := AssessActivityNavigation(map[string]any{"code": "EA"}, tasks)
	if result.State != "ready" {
		t.Fatalf("result = %#v", result)
	}
}

func TestAssessActivityNavigationBlocked(t *testing.T) {
	cases := []struct {
		name       string
		activity   any
		tasks      any
		reasonCode string
	}{
		{
			name:       "no activity",
			activity:   nil,
			tasks:      nil,
			reasonCode: "activity-unavailable",
		},
		{
			name:       "invalid code",
			activity:   map[string]any{"code": "EA_6"},
			tasks:      readyStageTasks(),
			reasonCode: "activity-code-invalid",
		},
		{
			name:       "no tasks",
			activity:   map[string]any{"code": "EA"},
			tasks:      nil,
			reasonCode: "navigation-resource-unavailable",
		},
		{
			name:       "missing open sequence",
			activity:   map[string]any{"code": "EA"},
			tasks:      map[string]any{"EA-6": map[string]any{"sub": []any{"EA-OpenOpt"}, "next": []any{"Stop"}}},
			reasonCode: "navigation-incomplete",
		},
		{
			name:     "missing stage entry",
			activity: map[string]any{"code": "EA"},
			tasks: map[string]any{
				"EA-OpenOpt": map[string]any{"next": []any{"EA-Open"}},
				"EA-Open":    map[string]any{"next": []any{"EA-6"}},
			},
			reasonCode: "navigation-incomplete",
		},
		{
			name:       "array tasks",
			activity:   map[string]any{"code": "EA"},
			tasks:      []any{},
			reasonCode: "navigation-resource-unavailable",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			result := AssessActivityNavigation(testCase.activity, testCase.tasks)
			if result.State != "blocked" || result.CanPrepare || result.CanRun {
				t.Fatalf("result = %#v", result)
			}
			if result.ReasonCode == nil || *result.ReasonCode != testCase.reasonCode {
				t.Fatalf("reasonCode = %#v, want %q", result.ReasonCode, testCase.reasonCode)
			}
			if result.Navigation != nil {
				t.Fatalf("navigation = %#v", result.Navigation)
			}
		})
	}
}

func TestGetActivityRunPreflight(t *testing.T) {
	paths := testPaths(t)
	writeStageActivity(t, paths, stageActivityFixture())
	writeStagesCatalog(t, paths)
	writeReadyStageTasks(t, paths)
	service := NewWithOptions(Options{Paths: paths, Now: testNow})

	result, err := service.GetActivityRunPreflight(context.Background(), "Official")
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "ready" {
		t.Fatalf("result = %#v", result)
	}
	if result.Activity.Code == nil || *result.Activity.Code != "EA" {
		t.Fatalf("activity = %#v", result.Activity)
	}
}

func TestGetActivityRunPreflightMissingResource(t *testing.T) {
	paths := testPaths(t)
	writeStageActivity(t, paths, stageActivityFixture())
	service := NewWithOptions(Options{Paths: paths, Now: testNow})

	result, err := service.GetActivityRunPreflight(context.Background(), "Official")
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "blocked" || result.ReasonCode == nil || *result.ReasonCode != "navigation-resource-unavailable" {
		t.Fatalf("result = %#v", result)
	}
}

func TestHasCompletedActivityNavigation(t *testing.T) {
	logText := "prefix\n2026-06-01 TaskChainCompleted {\"taskchain\":\"Custom\",\"taskid\":6}\n"
	if !HasCompletedActivityNavigation(logText, 6) {
		t.Fatal("expected completed")
	}
	if HasCompletedActivityNavigation(logText, 5) {
		t.Fatal("unexpected completed for different task id")
	}
	if HasCompletedActivityNavigation("prefix\nTaskChainCompleted {\"taskchain\":\"Copilot\",\"taskid\":6}\n", 6) {
		t.Fatal("unexpected completion for another taskchain")
	}
	if HasCompletedActivityNavigation("TaskChainCompleted not-json", 6) {
		t.Fatal("unexpected completion for malformed payload")
	}
}

func TestGetCombatCopilotPreferences(t *testing.T) {
	preferences := GetCombatCopilotPreferences(map[string]any{
		"advancedParams": map[string]any{
			"copilot": map[string]any{
				"raid":                    "both",
				"loopTimes":               "3",
				"ignoreRequirements":      false,
				"useSanityPotion":         true,
				"addTrust":                true,
				"allowOneMissingOperator": false,
				"supportUsage":            "2",
				"supportName":             "A",
			},
		},
		"autoFormation": map[string]any{"copilot": "preset"},
	})
	if preferences.Raid != "both" || preferences.LoopTimes != "3" {
		t.Fatalf("preferences = %#v", preferences)
	}
	if preferences.IgnoreRequirements || !preferences.UseSanityPotion || !preferences.AddTrust {
		t.Fatalf("preferences = %#v", preferences)
	}
	if preferences.AllowOneMissingOperator || preferences.FormationMode != "preset" {
		t.Fatalf("preferences = %#v", preferences)
	}
	defaults := GetCombatCopilotPreferences(nil)
	if defaults.Raid != "normal" || defaults.LoopTimes != 1 || !defaults.IgnoreRequirements || !defaults.AllowOneMissingOperator {
		t.Fatalf("defaults = %#v", defaults)
	}
	if NormalizeRaid(1) != "normal" || NormalizeRaid("1") != "raid" {
		t.Fatal("raid normalization mismatch")
	}
}

func TestLoadActivitySelectionContext(t *testing.T) {
	paths := testPaths(t)
	writeJSON(t, filepath.Join(paths.DataDir, "user-configs", "combat-tasks.json"), map[string]any{
		"advancedParams": map[string]any{
			"copilot": map[string]any{"raid": "raid", "supportUsage": 2},
		},
	})
	writeJSON(t, filepath.Join(paths.DataDir, "operbox.json"), map[string]any{
		"allOpers": []any{
			map[string]any{"name": "A", "own": true},
			map[string]any{"name": "B", "own": false},
			map[string]any{"name": "C"},
		},
	})
	service := NewWithOptions(Options{Paths: paths, Now: testNow})
	contextData := service.LoadActivitySelectionContext(context.Background())
	if contextData.Preferences.Raid != "raid" {
		t.Fatalf("preferences = %#v", contextData.Preferences)
	}
	if contextData.OwnedOperators == nil {
		t.Fatal("expected owned operators")
	}
	if _, ok := contextData.OwnedOperators["A"]; !ok {
		t.Fatal("expected A")
	}
	if _, ok := contextData.OwnedOperators["B"]; ok {
		t.Fatal("B is not owned")
	}
	if _, ok := contextData.OwnedOperators["C"]; !ok {
		t.Fatal("expected C")
	}
}

func TestLoadActivitySelectionContextWithoutOperBox(t *testing.T) {
	paths := testPaths(t)
	service := NewWithOptions(Options{Paths: paths, Now: testNow})
	contextData := service.LoadActivitySelectionContext(context.Background())
	if contextData.OwnedOperators != nil {
		t.Fatalf("owned = %#v", contextData.OwnedOperators)
	}
	if contextData.Preferences.Raid != "normal" {
		t.Fatalf("preferences = %#v", contextData.Preferences)
	}
}

func TestFindMissingOperators(t *testing.T) {
	content := map[string]any{
		"opers": []any{
			map[string]any{"name": "A"},
			map[string]any{"name": "B"},
			map[string]any{"name": "B"},
		},
		"groups": []any{
			map[string]any{"opers": []any{map[string]any{"name": "C"}, map[string]any{"name": "D"}}},
			map[string]any{"opers": []any{map[string]any{"name": "A"}, map[string]any{"name": "E"}}},
			map[string]any{"opers": []any{}},
		},
	}
	missing := FindMissingOperators(content, map[string]struct{}{"A": {}})
	if len(missing.Names) != 1 || missing.Names[0] != "B" {
		t.Fatalf("names = %#v", missing.Names)
	}
	if missing.MissingGroups != 1 || missing.Count != 2 {
		t.Fatalf("missing = %#v", missing)
	}
	unknown := FindMissingOperators(content, nil)
	if !unknown.Unknown || unknown.Count != 0 {
		t.Fatalf("unknown = %#v", unknown)
	}
}

func TestCanRunWithOperators(t *testing.T) {
	missing := &MissingOperatorInfo{Names: []string{"A"}, Count: 1}
	if !CanRunWithOperators(nil, nil) {
		t.Fatal("nil missing should allow")
	}
	if CanRunWithOperators(&MissingOperatorInfo{Count: 2}, nil) {
		t.Fatal("two missing should block")
	}
	if !CanRunWithOperators(missing, map[string]any{"allowOneMissingOperator": true, "supportUsage": 1}) {
		t.Fatal("support usage 1 should allow")
	}
	if CanRunWithOperators(missing, map[string]any{"allowOneMissingOperator": false, "supportUsage": 1}) {
		t.Fatal("allowOneMissingOperator=false should block")
	}
	if !CanRunWithOperators(missing, map[string]any{"supportUsage": 2, "supportName": "A"}) {
		t.Fatal("matching support should allow")
	}
	if CanRunWithOperators(missing, map[string]any{"supportUsage": 2, "supportName": "B"}) {
		t.Fatal("non-matching support should block")
	}
}

func TestSummarizeActivityCompletion(t *testing.T) {
	activity := NavigationActivity{
		Code:   stringPtr("ea"),
		Stages: []string{"EA-6", "ea-7"},
	}
	progress := ActivityProgress{
		"EA": {Stages: []string{"EA-6"}},
	}
	summary := SummarizeActivityCompletion(activity, progress)
	if !summary.Known || summary.Complete || summary.TotalStages != 2 {
		t.Fatalf("summary = %#v", summary)
	}
	if len(summary.CompletedStages) != 1 || summary.CompletedStages[0] != "EA-6" {
		t.Fatalf("summary = %#v", summary)
	}
	progress["EA"] = ActivityProgressEntry{Stages: []string{"EA-6", "EA-7"}}
	if !SummarizeActivityCompletion(activity, progress).Complete {
		t.Fatal("expected complete")
	}
	unknown := SummarizeActivityCompletion(map[string]any{}, nil)
	if unknown.Known || unknown.TotalStages != 0 {
		t.Fatalf("unknown = %#v", unknown)
	}
}

func TestRecordActivityCompletionPersists(t *testing.T) {
	paths := testPaths(t)
	service := NewWithOptions(Options{Paths: paths, Now: testNow})
	activity := NavigationActivity{Code: stringPtr("EA"), Stages: []string{"EA-6", "EA-7"}}
	success := true
	failure := false
	err := service.recordActivityCompletion(activity, []CompletionEntry{
		{DisplayStage: "EA-7", Success: &success},
		{DisplayStage: "EA-6", Success: &failure},
		{DisplayStage: "", Success: &success},
	})
	if err != nil {
		t.Fatal(err)
	}
	progress := service.LoadActivityProgress()
	entry := progress["EA"]
	if len(entry.Stages) != 1 || entry.Stages[0] != "EA-7" {
		t.Fatalf("progress = %#v", entry)
	}
	if entry.UpdatedAt == "" {
		t.Fatal("expected updatedAt")
	}
	value, err := jsonstore.Read(service.ProgressPath(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if asRecord(value) == nil {
		t.Fatalf("progress file = %#v", value)
	}
}
