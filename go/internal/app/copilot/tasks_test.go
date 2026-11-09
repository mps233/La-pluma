package copilot

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

func boolPointer(value bool) *bool { return &value }

func asMap(t *testing.T, value any) map[string]any {
	t.Helper()
	record := asRecord(value)
	if record == nil {
		t.Fatalf("expected record, got %#v", value)
	}
	return record
}

func TestBuildCopilotTaskParamsPreservesAdvancedOptions(t *testing.T) {
	params := BuildCopilotTaskParams(
		[]any{map[string]any{"filename": "/tmp/a.json"}},
		false,
		CopilotOptions{
			FormationMode:      "off",
			IgnoreRequirements: boolPointer(false),
			UseSanityPotion:    true,
			AddTrust:           true,
			FormationIndex:     "3",
			SupportUsage:       "2",
			SupportName:        "逻各斯",
		},
	)
	if params["formation"] != false {
		t.Fatalf("formation = %#v", params["formation"])
	}
	if params["ignore_requirements"] != false {
		t.Fatalf("ignore_requirements = %#v", params["ignore_requirements"])
	}
	if params["use_sanity_potion"] != true || params["add_trust"] != true {
		t.Fatalf("unexpected flags: %#v", params)
	}
	if params["formation_index"] != float64(3) || params["support_unit_usage"] != float64(2) {
		t.Fatalf("unexpected numeric options: %#v", params)
	}
	if params["support_unit_name"] != "逻各斯" {
		t.Fatalf("support_unit_name = %#v", params["support_unit_name"])
	}
	if _, exists := params["user_additional"]; exists {
		t.Fatalf("user_additional must be omitted when formation is off")
	}
}

func TestBuildCopilotTaskParamsNormalizesUserAdditional(t *testing.T) {
	params := BuildCopilotTaskParams(
		[]any{map[string]any{"filename": "/tmp/a.json"}},
		false,
		CopilotOptions{FormationMode: "auto", UserAdditional: "逻各斯:3，维什戴尔:9, , 斑点"},
	)
	additional, ok := params["user_additional"].([]UserAdditional)
	if !ok {
		t.Fatalf("user_additional = %#v", params["user_additional"])
	}
	want := []UserAdditional{{Name: "逻各斯", Skill: 3}, {Name: "维什戴尔", Skill: 0}, {Name: "斑点", Skill: 0}}
	if len(additional) != len(want) {
		t.Fatalf("additional = %#v", additional)
	}
	for index := range want {
		if additional[index] != want[index] {
			t.Fatalf("additional[%d] = %#v, want %#v", index, additional[index], want[index])
		}
	}

	arrayParams := BuildCopilotTaskParams(nil, false, CopilotOptions{
		FormationMode:  "auto",
		UserAdditional: []any{map[string]any{"name": " 黑角 ", "skill": 2}, map[string]any{"name": "", "skill": 1}},
	})
	arrayAdditional := arrayParams["user_additional"].([]UserAdditional)
	if len(arrayAdditional) != 1 || arrayAdditional[0].Name != "黑角" || arrayAdditional[0].Skill != 2 {
		t.Fatalf("array additional = %#v", arrayAdditional)
	}

	presetParams := BuildCopilotTaskParams(nil, true, CopilotOptions{UserAdditional: "逻各斯:3"})
	if presetParams["formation"] != false {
		t.Fatalf("preset formation should disable formation: %#v", presetParams)
	}
	if _, exists := presetParams["user_additional"]; exists {
		t.Fatalf("preset formation must not include user_additional")
	}
}

func TestBuildCopilotRepeatFilesExpandsLoops(t *testing.T) {
	files := BuildCopilotRepeatFiles(RepeatSource{ItemIndex: 2, CopilotID: 99, Mode: "raid"}, 3, "/tmp/plan")
	if len(files) != 3 {
		t.Fatalf("files = %#v", files)
	}
	if files[0].Repeat != 1 || !strings.HasSuffix(files[0].Filename, "2-99-raid-1.json") {
		t.Fatalf("files[0] = %#v", files[0])
	}
	if files[2].Repeat != 3 || !strings.HasSuffix(files[2].Filename, "2-99-raid-3.json") {
		t.Fatalf("files[2] = %#v", files[2])
	}
	if clamped := BuildCopilotRepeatFiles(RepeatSource{ItemIndex: 1, CopilotID: 2, Mode: "normal"}, 500, "/tmp"); len(clamped) != 99 {
		t.Fatalf("loop clamp = %d", len(clamped))
	}
	if fallback := BuildCopilotRepeatFiles(RepeatSource{ItemIndex: 1, CopilotID: 2, Mode: "normal"}, "abc", "/tmp"); len(fallback) != 1 {
		t.Fatalf("invalid loop count = %d", len(fallback))
	}
}

func TestBuildNativeCopilotCommand(t *testing.T) {
	base := BuildNativeCopilotCommand(48990, "normal", CopilotOptions{})
	if strings.Join(base, "|") != "prts://s48990|--batch" {
		t.Fatalf("base = %#v", base)
	}
	both := BuildNativeCopilotCommand(48990, "both", CopilotOptions{
		Profile:      "daily",
		Address:      "127.0.0.1:16384",
		UserResource: true,
	})
	wantBoth := []string{"prts://s48990", "--batch", "--raid", "both", "--user-resource", "-p", "daily", "-a", "127.0.0.1:16384"}
	if strings.Join(both, "|") != strings.Join(wantBoth, "|") {
		t.Fatalf("both = %#v, want %#v", both, wantBoth)
	}
	advanced := BuildNativeCopilotCommand(48990, "normal", CopilotOptions{
		FormationMode:      "on",
		FormationIndex:     3,
		AddTrust:           true,
		IgnoreRequirements: boolPointer(true),
		UseSanityPotion:    true,
		SupportUsage:       2,
		SupportName:        "史都华德",
	})
	wantAdvanced := []string{
		"prts://s48990", "--batch", "--formation", "--formation-index", "3",
		"--add-trust", "--ignore-requirements", "--use-sanity-potion",
		"--support-unit-usage", "2", "--support-unit-name", "史都华德",
	}
	if strings.Join(advanced, "|") != strings.Join(wantAdvanced, "|") {
		t.Fatalf("advanced = %#v, want %#v", advanced, wantAdvanced)
	}
}

func nativeEntries() []PlanEntry {
	return []PlanEntry{
		{Key: "0:1:normal", ItemIndex: 0, CopilotID: 1, Mode: "normal"},
		{Key: "1:2:normal", ItemIndex: 1, CopilotID: 2, Mode: "normal"},
	}
}

func TestCanUseNativeCopilotSetMatrix(t *testing.T) {
	entries := nativeEntries()
	checks := []struct {
		name    string
		options NativeSetOptions
		want    bool
	}{
		{"full set", NativeSetOptions{Entries: entries}, true},
		{"raid both", NativeSetOptions{Entries: entries, Raid: "both"}, true},
		{"single auto", NativeSetOptions{Entries: entries[:1]}, false},
		{"single formation off", NativeSetOptions{Entries: entries[:1], FormationMode: "off"}, true},
		{"full formation off", NativeSetOptions{Entries: entries, FormationMode: "off"}, false},
		{"full formation on", NativeSetOptions{Entries: entries, FormationMode: "on"}, true},
		{"user additional", NativeSetOptions{Entries: entries, UserAdditional: []any{map[string]any{"name": "史都华德"}}}, false},
		{"single raid", NativeSetOptions{Entries: entries[:1], Raid: "raid"}, false},
		{"preset entry", NativeSetOptions{Entries: []PlanEntry{{Key: "0:1:normal", PresetFormation: true}}}, false},
		{"partial selection", NativeSetOptions{Entries: entries, SelectedIndexes: []any{0}}, false},
		{"full selection", NativeSetOptions{Entries: entries, TotalItems: 2, SelectedIndexes: []any{0, 1}}, true},
		{"duplicate selection", NativeSetOptions{Entries: entries, TotalItems: 2, SelectedIndexes: []any{0, 0}}, false},
		{"out of range selection", NativeSetOptions{Entries: entries, TotalItems: 2, SelectedIndexes: []any{0, 2}}, false},
		{"loop times", NativeSetOptions{Entries: entries, LoopTimes: 2}, false},
		{"completed keys", NativeSetOptions{Entries: entries, CompletedKeys: []string{"0:1:normal"}}, false},
		{"empty entries", NativeSetOptions{}, false},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			if got := CanUseNativeCopilotSet(check.options); got != check.want {
				t.Fatalf("got %v, want %v", got, check.want)
			}
		})
	}
}

func TestCanUseNativeCopilotSetSingleItemRaidBoth(t *testing.T) {
	entries := []PlanEntry{
		{Key: "0:1:normal", ItemIndex: 0, CopilotID: 1, Mode: "normal"},
		{Key: "0:1:raid", ItemIndex: 0, CopilotID: 1, Mode: "raid"},
	}
	if CanUseNativeCopilotSet(NativeSetOptions{Entries: entries, TotalItems: 1, SelectedIndexes: []any{0}, Raid: "both", FormationMode: "auto"}) {
		t.Fatal("auto formation with one item must not delegate")
	}
	if !CanUseNativeCopilotSet(NativeSetOptions{Entries: entries, TotalItems: 1, SelectedIndexes: []any{0}, Raid: "both", FormationMode: "off"}) {
		t.Fatal("off formation should delegate")
	}
	if !CanUseNativeCopilotSet(NativeSetOptions{Entries: entries, TotalItems: 1, SelectedIndexes: []any{0}, Raid: "both", FormationMode: "on"}) {
		t.Fatal("on formation should delegate")
	}
}

func TestCanUseNativeCopilotSetPresetBlockedEvenWhenRaidFiltered(t *testing.T) {
	entries := []PlanEntry{
		{Key: "0:1:raid", ItemIndex: 0, CopilotID: 1, Mode: "raid"},
		{Key: "1:2:raid", ItemIndex: 1, CopilotID: 2, Mode: "raid"},
	}
	if CanUseNativeCopilotSet(NativeSetOptions{
		Entries: entries, TotalItems: 3, SelectedIndexes: []any{0, 1, 2},
		HasPresetFormation: boolPointer(true), Raid: "raid",
	}) {
		t.Fatal("preset formation must block native delegation")
	}
}

func TestOrderEntriesForNavigation(t *testing.T) {
	entries := []PlanEntry{
		{DisplayStage: "TL-1"},
		{DisplayStage: "TL-4"},
		{DisplayStage: "tl-4", Mode: "raid"},
		{DisplayStage: "TL-9"},
	}
	ordered := OrderEntriesForNavigation(entries, "TL-4")
	stages := make([]string, 0, len(ordered))
	for _, entry := range ordered {
		stages = append(stages, entry.DisplayStage+":"+entry.Mode)
	}
	want := "TL-4:,tl-4:raid,TL-1:,TL-9:"
	if strings.Join(stages, ",")+"" != want {
		t.Fatalf("ordered = %#v", stages)
	}
	if unchanged := OrderEntriesForNavigation(entries, ""); len(unchanged) != 4 || unchanged[0].DisplayStage != "TL-1" {
		t.Fatalf("empty navigation stage should keep order: %#v", unchanged)
	}
}

func TestSanitizePlanID(t *testing.T) {
	valid := []string{"48990", "set-1_A"}
	for _, value := range valid {
		got, err := SanitizePlanID(value)
		if err != nil || got != value {
			t.Fatalf("SanitizePlanID(%q) = %q, %v", value, got, err)
		}
	}
	for _, value := range []string{"../outside", "", "has space", "-leading"} {
		_, err := SanitizePlanID(value)
		if err == nil || !strings.Contains(err.Error(), "不合法") {
			t.Fatalf("SanitizePlanID(%q) error = %v", value, err)
		}
	}
}

func TestMergePresetFormationTasksKeepsUserBattleStart(t *testing.T) {
	merged := MergePresetFormationTasks(
		map[string]any{"BattleStart": map[string]any{"roi": []any{1, 2, 3, 4}, "postDelay": 1000}},
		map[string]any{
			"BattleStart":  map[string]any{"postDelay": 4321, "custom": true},
			"ExistingTask": map[string]any{"action": "DoNothing"},
		},
	)
	battleStart := asMap(t, merged["BattleStart"])
	if battleStart["postDelay"] != 4321 || battleStart["custom"] != true {
		t.Fatalf("battleStart = %#v", battleStart)
	}
	next, ok := battleStart["next"].([]string)
	if !ok || !containsString(next, "LaPlumaPresetBattleConfirm") {
		t.Fatalf("battleStart.next = %#v", battleStart["next"])
	}
	confirm := asMap(t, merged["LaPlumaPresetBattleConfirm"])
	if confirm["algorithm"] != "OcrDetect" || confirm["action"] != "ClickSelf" {
		t.Fatalf("confirm = %#v", confirm)
	}
	if _, exists := merged["ExistingTask"]; !exists {
		t.Fatal("unrelated user tasks must be preserved")
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestBuildCurrentMapStageTasks(t *testing.T) {
	tasks := BuildCurrentMapStageTasks([]any{"bd-1", "BD-2", "BD-1", " "})
	if len(tasks) != 2 {
		t.Fatalf("tasks = %#v", tasks)
	}
	if task, ok := tasks["BD-1"]; !ok || len(task.Text) != 1 || task.Text[0] != "BD-1" {
		t.Fatalf("BD-1 task = %#v", task)
	}
	if _, ok := tasks["BD-2"]; !ok {
		t.Fatalf("BD-2 missing: %#v", tasks)
	}
}

func TestEnsureCurrentMapActivityResource(t *testing.T) {
	configDir := t.TempDir()
	resource, err := EnsureCurrentMapActivityResource(configDir, "bd", []any{"bd-1", "BD-2"})
	if err != nil {
		t.Fatal(err)
	}
	wantPath := filepath.Join(configDir, "resource", "tasks", "Stages", "BD.json")
	if resource.StageFile != wantPath {
		t.Fatalf("stage file = %q", resource.StageFile)
	}
	if len(resource.Stages) != 2 {
		t.Fatalf("stages = %#v", resource.Stages)
	}
	value, err := jsonstore.Read(wantPath, nil)
	if err != nil {
		t.Fatal(err)
	}
	record := asMap(t, value)
	if _, ok := record["BD-1"]; !ok {
		t.Fatalf("written tasks = %#v", record)
	}
	if _, err := EnsureCurrentMapActivityResource(configDir, "b!", []any{"BD-1"}); err == nil {
		t.Fatal("invalid activity code must fail")
	}
	if _, err := EnsureCurrentMapActivityResource(configDir, "BD", nil); err == nil {
		t.Fatal("empty stages must fail")
	}
}

func TestEnsurePresetFormationResource(t *testing.T) {
	root := t.TempDir()
	installedDir := filepath.Join(root, "installed")
	configDir := filepath.Join(root, "config")
	if err := os.MkdirAll(filepath.Join(installedDir, "tasks"), 0o755); err != nil {
		t.Fatal(err)
	}
	installed := map[string]any{"BattleStart": map[string]any{"roi": []any{1, 2, 3, 4}}, "InstalledOnly": map[string]any{"action": "DoNothing"}}
	if err := jsonstore.Write(filepath.Join(installedDir, "tasks", "tasks.json"), installed, true); err != nil {
		t.Fatal(err)
	}
	userPath := filepath.Join(configDir, "resource", "tasks", "tasks.json")
	if err := jsonstore.Write(userPath, map[string]any{"BattleStart": map[string]any{"postDelay": 999}}, true); err != nil {
		t.Fatal(err)
	}
	if err := EnsurePresetFormationResource(installedDir, configDir); err != nil {
		t.Fatal(err)
	}
	value, err := jsonstore.Read(userPath, nil)
	if err != nil {
		t.Fatal(err)
	}
	merged := asMap(t, value)
	battleStart := asMap(t, merged["BattleStart"])
	if numberOrZero(battleStart["postDelay"]) != 999 {
		t.Fatalf("user postDelay lost: %#v", battleStart["postDelay"])
	}
	// mergePresetFormationTasks only merges BattleStart from the installed
	// resource; other top-level installed tasks are supplied by MAA itself.
	if err := EnsurePresetFormationResource(filepath.Join(root, "missing"), configDir); err == nil {
		t.Fatal("missing installed resource must fail")
	}
}

func TestBuildCopilotDynamicTaskConfig(t *testing.T) {
	config := BuildCopilotDynamicTaskConfig(
		[]any{
			map[string]any{"name": "启动游戏", "type": "StartUp"},
			map[string]any{"name": "进入终端", "type": "Custom"},
			"not-a-task",
			nil,
		},
		map[string]any{"name": "活动作业", "type": "Copilot"},
	)
	tasks := asArray(config["tasks"])
	if len(tasks) != 3 {
		t.Fatalf("tasks = %#v", tasks)
	}
	last := asMap(t, tasks[2])
	if last["name"] != "活动作业" || last["type"] != "Copilot" {
		t.Fatalf("last task = %#v", last)
	}
	empty := BuildCopilotDynamicTaskConfig(nil, map[string]any{"name": "only"})
	if len(asArray(empty["tasks"])) != 1 {
		t.Fatalf("empty pre tasks = %#v", empty)
	}
}

func TestParseCopilotOptions(t *testing.T) {
	options := ParseCopilotOptions(map[string]any{
		"formationMode":      "on",
		"ignoreRequirements": false,
		"useSanityPotion":    true,
		"supportName":        "逻各斯",
		"profileId":          "p1",
	})
	if options.FormationMode != "on" || options.IgnoreRequirements == nil || *options.IgnoreRequirements {
		t.Fatalf("options = %#v", options)
	}
	if !options.UseSanityPotion || options.ProfileID != "p1" || options.SupportName != "逻各斯" {
		t.Fatalf("options = %#v", options)
	}
}

func TestAppErrorCode(t *testing.T) {
	_, err := SanitizePlanID("../x")
	appError, ok := apperrors.As(err)
	if !ok || appError.Code != "COPILOT_PLAN_ID_INVALID" || appError.StatusCode != 400 {
		t.Fatalf("unexpected error: %#v", err)
	}
}

func TestBuildCopilotStartUpTask(t *testing.T) {
	task := BuildCopilotStartUpTask("Bilibili")
	if task["type"] != "StartUp" || task["client_type"] != "Bilibili" {
		t.Fatalf("startup task = %#v", task)
	}
	params := asRecord(task["params"])
	if params == nil || params["start_game_enabled"] != true {
		t.Fatalf("startup params = %#v", task["params"])
	}
	withoutClient := BuildCopilotStartUpTask("")
	if _, exists := withoutClient["client_type"]; exists {
		t.Fatalf("empty client type must be omitted: %#v", withoutClient)
	}
}
