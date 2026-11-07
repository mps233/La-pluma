package copilot

import (
	"fmt"
	"math"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

var (
	planIDPattern            = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	activityCodePattern      = regexp.MustCompile(`^[A-Z0-9]{2,8}$`)
	userAdditionalSeparators = regexp.MustCompile(`[,，\n]`)
	userSkillSeparators      = regexp.MustCompile(`[:：]`)
)

// CopilotOptions mirrors the loose options object passed by Agent routes.
type CopilotOptions struct {
	FormationMode      string
	UserAdditional     any
	IgnoreRequirements *bool
	UseSanityPotion    bool
	AddTrust           bool
	FormationIndex     any
	SupportUsage       any
	SupportName        any
	UserResource       bool
	Profile            any
	ProfileID          any
	Address            any
}

// ParseCopilotOptions converts a decoded JSON object to CopilotOptions.
func ParseCopilotOptions(value any) CopilotOptions {
	record := asRecord(value)
	if record == nil {
		return CopilotOptions{}
	}
	options := CopilotOptions{
		FormationMode:  asString(record["formationMode"]),
		UserAdditional: record["userAdditional"],
		FormationIndex: record["formationIndex"],
		SupportUsage:   record["supportUsage"],
		SupportName:    record["supportName"],
		Profile:        record["profile"],
		ProfileID:      record["profileId"],
		Address:        record["address"],
	}
	if raw, exists := record["ignoreRequirements"]; exists {
		if flag, ok := raw.(bool); ok {
			value := flag
			options.IgnoreRequirements = &value
		}
	}
	options.UseSanityPotion = record["useSanityPotion"] == true
	options.AddTrust = record["addTrust"] == true
	options.UserResource = record["userResource"] == true
	return options
}

// UserAdditional is one operator name/skill preference from the UI.
type UserAdditional struct {
	Name  string `json:"name"`
	Skill int    `json:"skill"`
}

// NormalizeUserAdditional mirrors normalizeUserAdditional. Accepts an array of
// {name, skill} records or a "name:skill" separated string.
func NormalizeUserAdditional(value any) []UserAdditional {
	if array, ok := value.([]any); ok {
		result := make([]UserAdditional, 0, len(array))
		for _, raw := range array {
			record := asRecord(raw)
			name := ""
			skill := 0
			if record != nil {
				if record["name"] != nil {
					name = strings.TrimSpace(jsString(record["name"]))
				}
				if parsed, ok := integerValue(record["skill"]); ok && parsed >= 1 && parsed <= 3 {
					skill = parsed
				}
			}
			if name != "" {
				result = append(result, UserAdditional{Name: name, Skill: skill})
			}
		}
		return result
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return nil
	}
	result := make([]UserAdditional, 0)
	for _, entry := range userAdditionalSeparators.Split(text, -1) {
		parts := userSkillSeparators.Split(entry, -1)
		name := ""
		if len(parts) > 0 {
			name = strings.TrimSpace(parts[0])
		}
		if name == "" {
			continue
		}
		skill := 0
		if len(parts) > 1 {
			if parsed, ok := integerValue(strings.TrimSpace(parts[1])); ok && parsed >= 1 && parsed <= 3 {
				skill = parsed
			}
		}
		result = append(result, UserAdditional{Name: name, Skill: skill})
	}
	return result
}

// BuildCopilotTaskParams mirrors buildCopilotTaskParams.
func BuildCopilotTaskParams(list []any, presetFormation bool, options CopilotOptions) map[string]any {
	formation := !presetFormation && options.FormationMode != "off"
	ignoreRequirements := true
	if options.IgnoreRequirements != nil {
		ignoreRequirements = *options.IgnoreRequirements
	}
	params := map[string]any{
		"copilot_list":        list,
		"formation":           formation,
		"ignore_requirements": ignoreRequirements,
		"use_sanity_potion":   options.UseSanityPotion,
		"add_trust":           options.AddTrust,
		"formation_index":     numberOrZero(options.FormationIndex),
		"support_unit_usage":  numberOrZero(options.SupportUsage),
		"support_unit_name":   jsStringTruthyOrEmpty(options.SupportName),
	}
	if formation {
		userAdditional := NormalizeUserAdditional(options.UserAdditional)
		if len(userAdditional) > 0 {
			params["user_additional"] = userAdditional
		}
	}
	return params
}

// NormalizeCopilotLoopTimes clamps loop times to 1..99 like parseInt(...)||1.
func NormalizeCopilotLoopTimes(value any) int {
	text := "1"
	if truthy(value) {
		text = jsString(value)
	}
	number := parseLeadingInteger(text)
	if number == 0 {
		number = 1
	}
	if number < 1 {
		number = 1
	}
	if number > 99 {
		number = 99
	}
	return number
}

func parseLeadingInteger(text string) int {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0
	}
	index := 0
	if text[index] == '+' || text[index] == '-' {
		index++
	}
	start := index
	for index < len(text) && text[index] >= '0' && text[index] <= '9' {
		index++
	}
	if start == index {
		return 0
	}
	value := 0
	for _, digit := range text[start:index] {
		value = value*10 + int(digit-'0')
		if value > 1<<30 {
			return 1 << 30
		}
	}
	if text[0] == '-' {
		return -value
	}
	return value
}

// SanitizePlanID rejects ids that could escape the copilot plan directory.
func SanitizePlanID(value any) (string, error) {
	id := strings.TrimSpace(jsStringTruthyOrEmpty(value))
	if !planIDPattern.MatchString(id) {
		return "", apperrors.WithStatus("COPILOT_PLAN_ID_INVALID", "作业集 ID 不合法", http.StatusBadRequest, false, map[string]any{"value": jsStringTruthyOrEmpty(value)})
	}
	return id, nil
}

// RepeatSource identifies one repeated plan file.
type RepeatSource struct {
	ItemIndex any
	CopilotID any
	Mode      any
}

// RepeatFile is one generated copy of a copilot JSON.
type RepeatFile struct {
	Repeat   int    `json:"repeat"`
	Filename string `json:"filename"`
}

// BuildCopilotRepeatFiles expands loopTimes copies of the entry file.
func BuildCopilotRepeatFiles(entry RepeatSource, loopTimes any, planDir string) []RepeatFile {
	count := NormalizeCopilotLoopTimes(loopTimes)
	files := make([]RepeatFile, 0, count)
	for index := 0; index < count; index++ {
		files = append(files, RepeatFile{
			Repeat: index + 1,
			Filename: filepath.Join(planDir, fmt.Sprintf("%s-%s-%s-%d.json",
				jsString(entry.ItemIndex),
				jsString(entry.CopilotID),
				jsString(entry.Mode),
				index+1,
			)),
		})
	}
	return files
}

// BuildCopilotDynamicTaskConfig puts preparation tasks before Copilot in one
// dynamic MAA task file.
func BuildCopilotDynamicTaskConfig(preTasks []any, task map[string]any) map[string]any {
	tasks := make([]any, 0, len(preTasks)+1)
	for _, raw := range preTasks {
		if asRecord(raw) != nil {
			tasks = append(tasks, raw)
		}
	}
	tasks = append(tasks, task)
	return map[string]any{"tasks": tasks}
}

// OrderEntriesForNavigation places entries for the navigated stage first. The
// partition is stable, matching the two-filter implementation in Node.
func OrderEntriesForNavigation(entries []PlanEntry, navigationStage any) []PlanEntry {
	stage := strings.ToUpper(strings.TrimSpace(jsStringTruthyOrEmpty(navigationStage)))
	if stage == "" {
		return entries
	}
	ordered := make([]PlanEntry, 0, len(entries))
	for _, entry := range entries {
		if strings.ToUpper(strings.TrimSpace(entry.DisplayStage)) == stage {
			ordered = append(ordered, entry)
		}
	}
	for _, entry := range entries {
		if strings.ToUpper(strings.TrimSpace(entry.DisplayStage)) != stage {
			ordered = append(ordered, entry)
		}
	}
	return ordered
}

// MergePresetFormationTasks always installs the LaPluma confirmation OCR and
// keeps existing installed/user BattleStart settings.
func MergePresetFormationTasks(installedTasks, userTasks map[string]any) map[string]any {
	merged := copyRecord(userTasks)
	installedBattleStart := asRecord(installedTasks["BattleStart"])
	userBattleStart := asRecord(userTasks["BattleStart"])
	battleStart := copyRecord(installedBattleStart)
	for key, value := range userBattleStart {
		battleStart[key] = value
	}
	battleStart["next"] = []string{"BattleOfficiallyBegin", "LaPlumaPresetBattleConfirm", "SkipThePreBattlePlot", "Stop"}
	merged["LaPlumaPresetBattleConfirm"] = map[string]any{
		"algorithm": "OcrDetect",
		"text":      []string{"开始战斗", "是否开始战斗"},
		"roi":       []int{700, 430, 560, 280},
		"action":    "ClickSelf",
		"postDelay": 2000,
		"next":      []string{"BattleOfficiallyBegin", "SkipThePreBattlePlot", "Stop"},
	}
	merged["BattleStart"] = battleStart
	return merged
}

// CurrentMapTask is one OCR-only stage task for the current map fallback.
type CurrentMapTask struct {
	Text []string `json:"text"`
}

// BuildCurrentMapStageTasks maps normalized stage codes to OCR tasks.
func BuildCurrentMapStageTasks(stages []any) map[string]CurrentMapTask {
	tasks := map[string]CurrentMapTask{}
	for _, stage := range normalizedStageList(stages) {
		tasks[stage] = CurrentMapTask{Text: []string{stage}}
	}
	return tasks
}

// CurrentMapResource is the written Stages resource file.
type CurrentMapResource struct {
	StageFile string   `json:"stageFile"`
	Stages    []string `json:"stages"`
}

// EnsureCurrentMapActivityResource writes a MAA Stages resource that lets the
// activity runner recognize stages without home navigation.
func EnsureCurrentMapActivityResource(configDir string, activityCode any, stages []any) (*CurrentMapResource, error) {
	code := strings.ToUpper(strings.TrimSpace(jsStringTruthyOrEmpty(activityCode)))
	if !activityCodePattern.MatchString(code) {
		return nil, apperrors.WithStatus("COPILOT_ACTIVITY_CODE_INVALID", "活动代号格式不合法", http.StatusBadRequest, false, map[string]any{"code": code})
	}
	normalized := normalizedStageList(stages)
	if len(normalized) == 0 {
		return nil, apperrors.WithStatus("COPILOT_ACTIVITY_STAGES_EMPTY", "没有可写入的活动关卡", http.StatusBadRequest, false, map[string]any{"code": code})
	}
	tasks := map[string]CurrentMapTask{}
	for _, stage := range normalized {
		tasks[stage] = CurrentMapTask{Text: []string{stage}}
	}
	stageFile := filepath.Join(configDir, "resource", "tasks", "Stages", code+".json")
	if err := jsonstore.Write(stageFile, tasks, true); err != nil {
		return nil, apperrors.WithStatus(
			"COPILOT_ACTIVITY_STAGE_RESOURCE_FAILED",
			"写入活动关卡资源失败",
			http.StatusInternalServerError,
			false,
			map[string]any{"path": stageFile, "error": err.Error()},
		)
	}
	return &CurrentMapResource{StageFile: stageFile, Stages: normalized}, nil
}

// EnsurePresetFormationResource merges the installed MAA tasks.json with the
// user config. The Node version asks the MAA CLI for its resource directory;
// callers pass that directory explicitly so this package stays MAA-free.
func EnsurePresetFormationResource(installedResourceDir, configDir string) error {
	installedTasksPath := filepath.Join(installedResourceDir, "tasks", "tasks.json")
	if !jsonstore.Exists(installedTasksPath) {
		return apperrors.WithStatus("COPILOT_PRESET_RESOURCE_FAILED", "读取 MAA 任务资源失败", http.StatusInternalServerError, false, map[string]any{"path": installedTasksPath})
	}
	installedValue, err := jsonstore.Read(installedTasksPath, map[string]any{})
	if err != nil {
		return apperrors.WithStatus("COPILOT_PRESET_RESOURCE_FAILED", "读取 MAA 任务资源失败", http.StatusInternalServerError, false, map[string]any{"path": installedTasksPath, "error": err.Error()})
	}
	installedTasks := asRecord(installedValue)
	if installedTasks == nil {
		installedTasks = map[string]any{}
	}

	userTasksPath := filepath.Join(configDir, "resource", "tasks", "tasks.json")
	userValue, err := jsonstore.Read(userTasksPath, map[string]any{})
	userTasks := map[string]any{}
	if err == nil {
		if record := asRecord(userValue); record != nil {
			userTasks = record
		}
	}

	if err := jsonstore.Write(userTasksPath, MergePresetFormationTasks(installedTasks, userTasks), true); err != nil {
		return apperrors.WithStatus("COPILOT_PRESET_RESOURCE_FAILED", "写入预设编队任务失败", http.StatusInternalServerError, false, map[string]any{"path": userTasksPath, "error": err.Error()})
	}
	return nil
}

// NativeSetOptions configures canUseNativeCopilotSet.
type NativeSetOptions struct {
	Entries            []PlanEntry
	TotalItems         int
	HasPresetFormation *bool
	Raid               string
	LoopTimes          int
	SelectedIndexes    []any
	CompletedKeys      []string
	FormationMode      string
	UserAdditional     any
}

// CanUseNativeCopilotSet reports whether `maa copilot prts://s<id>` can run
// the whole set without per-stage custom behavior.
func CanUseNativeCopilotSet(options NativeSetOptions) bool {
	entries := options.Entries
	if len(entries) == 0 {
		return false
	}
	totalItems := options.TotalItems
	if totalItems == 0 {
		totalItems = len(entries)
	}
	if len(options.SelectedIndexes) > 0 {
		seen := map[int]struct{}{}
		for _, raw := range options.SelectedIndexes {
			index, ok := integerValue(raw)
			if !ok || index < 0 || index >= totalItems {
				return false
			}
			seen[index] = struct{}{}
		}
		if len(seen) != totalItems {
			return false
		}
	}
	loopTimes := options.LoopTimes
	if loopTimes == 0 {
		loopTimes = 1
	}
	if loopTimes != 1 {
		return false
	}
	if len(options.CompletedKeys) > 0 {
		return false
	}
	hasPresetFormation := false
	if options.HasPresetFormation != nil {
		hasPresetFormation = *options.HasPresetFormation
	}
	if !hasPresetFormation {
		for _, entry := range entries {
			if entry.PresetFormation {
				hasPresetFormation = true
				break
			}
		}
	}
	if hasPresetFormation {
		return false
	}
	if userAdditionalTruthy(options.UserAdditional) {
		return false
	}
	formationMode := options.FormationMode
	if formationMode == "" {
		formationMode = "auto"
	}
	if formationMode == "auto" && totalItems < 2 {
		return false
	}
	if formationMode == "off" && totalItems >= 2 {
		return false
	}
	raid := options.Raid
	if raid == "" {
		raid = "normal"
	}
	if raid == "raid" && totalItems < 2 {
		return false
	}
	return raid == "normal" || raid == "raid" || raid == "both"
}

func userAdditionalTruthy(value any) bool {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed) != ""
	case []any:
		return len(typed) > 0
	case map[string]any:
		return len(typed) > 0
	default:
		return false
	}
}

// BuildNativeCopilotCommand builds the `maa copilot` arguments in the same
// order as the Node service.
func BuildNativeCopilotCommand(setId any, raid string, options CopilotOptions) []string {
	if raid == "" {
		raid = "normal"
	}
	args := []string{"prts://s" + jsString(setId), "--batch"}
	if raid == "raid" || raid == "both" {
		args = append(args, "--raid", raid)
	}
	if options.FormationMode == "on" {
		args = append(args, "--formation")
	}
	formationIndex := numberOrZero(options.FormationIndex)
	if !math.IsNaN(formationIndex) && !math.IsInf(formationIndex, 0) && formationIndex > 0 {
		args = append(args, "--formation-index", jsString(formationIndex))
	}
	if options.AddTrust {
		args = append(args, "--add-trust")
	}
	if options.IgnoreRequirements != nil && *options.IgnoreRequirements {
		args = append(args, "--ignore-requirements")
	}
	if options.UseSanityPotion {
		args = append(args, "--use-sanity-potion")
	}
	supportUsage := numberOrZero(options.SupportUsage)
	if !math.IsNaN(supportUsage) && !math.IsInf(supportUsage, 0) && supportUsage > 0 {
		args = append(args, "--support-unit-usage", jsString(supportUsage))
	}
	if supportName, ok := options.SupportName.(string); ok && strings.TrimSpace(supportName) != "" {
		args = append(args, "--support-unit-name", strings.TrimSpace(supportName))
	}
	if options.UserResource {
		args = append(args, "--user-resource")
	}
	profile := options.Profile
	if !truthy(profile) {
		profile = options.ProfileID
	}
	if truthy(profile) {
		args = append(args, "-p", jsString(profile))
	}
	if truthy(options.Address) {
		args = append(args, "-a", jsString(options.Address))
	}
	return args
}

func normalizedStageList(stages []any) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(stages))
	for _, raw := range stages {
		stage := strings.ToUpper(strings.TrimSpace(jsStringTruthyOrEmpty(raw)))
		if stage == "" {
			continue
		}
		if _, exists := seen[stage]; exists {
			continue
		}
		seen[stage] = struct{}{}
		result = append(result, stage)
	}
	return result
}
