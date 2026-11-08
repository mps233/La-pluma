package activity

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

// PartialResultsError lets a plan executor expose entries completed before a
// failure, matching asErrorWithCode(error).copilotPlan?.results.
type PartialResultsError interface {
	ActivityPartialResults() []CompletionEntry
}

// ShouldRefreshActivityNavigation mirrors shouldRefreshActivityNavigation
// with the fixed six-hour retry interval.
func ShouldRefreshActivityNavigation(preflight NavigationResult, lastAttemptAt, now time.Time) bool {
	return preflight.ReasonCode != nil && *preflight.ReasonCode == "navigation-resource-unavailable" &&
		preflight.Activity.Code != nil && *preflight.Activity.Code != "" &&
		now.Sub(lastAttemptAt) >= defaultResourceRefreshInterval
}

func shouldRefreshWithInterval(preflight NavigationResult, lastAttemptAt, now time.Time, interval time.Duration) bool {
	if interval <= 0 {
		interval = defaultResourceRefreshInterval
	}
	return preflight.ReasonCode != nil && *preflight.ReasonCode == "navigation-resource-unavailable" &&
		preflight.Activity.Code != nil && *preflight.Activity.Code != "" &&
		now.Sub(lastAttemptAt) >= interval
}

// BuildActivityPreparationTasks mirrors buildActivityPreparationTasks.
func BuildActivityPreparationTasks(candidates *Candidates, clientType, navigationStage string) []PreparationTask {
	if candidates == nil {
		return []PreparationTask{}
	}
	entryTask := ""
	if candidates.Preflight.Navigation != nil {
		entryTask = strings.TrimSpace(candidates.Preflight.Navigation.EntryTask)
	}
	if candidates.NavigationMode == "current-map-fallback" || entryTask == "" {
		return []PreparationTask{}
	}

	activityStages := activityStageSet(candidates.Preflight.Activity.Stages)
	requestedStage := strings.ToUpper(strings.TrimSpace(navigationStage))
	stageTask := ""
	if requestedStage != "" {
		if _, ok := activityStages[requestedStage]; ok {
			stageTask = requestedStage
		}
	}
	navigationTask := entryTask
	if stageTask != "" {
		navigationTask = stageTask
	}
	lastTaskName := "打开活动页"
	if stageTask != "" {
		lastTaskName = "选择活动关卡 " + stageTask
	}
	return []PreparationTask{
		{Name: "关闭游戏", Type: "CloseDown", Params: map[string]any{"client_type": clientType}},
		{Name: "启动游戏", Type: "StartUp", Params: map[string]any{"client_type": clientType, "start_game_enabled": true}},
		{Name: "进入终端", Type: "Custom", Params: map[string]any{"task_names": []string{"Terminal-Entry"}}},
		{Name: "等待终端加载", Type: "Custom", Params: map[string]any{"task_names": []string{"SleepThenStop"}}},
		{Name: "等待终端加载 2", Type: "Custom", Params: map[string]any{"task_names": []string{"SleepThenStop"}}},
		{Name: lastTaskName, Type: "Custom", Params: map[string]any{"task_names": []string{navigationTask}}},
	}
}

func activityStageSet(stages []string) map[string]struct{} {
	result := make(map[string]struct{}, len(stages))
	for _, stage := range stages {
		value := strings.ToUpper(jsStringOrEmpty(stage))
		if value == "" {
			continue
		}
		result[value] = struct{}{}
	}
	return result
}

// SelectActivitySetEntries mirrors selectActivitySetEntries.
func SelectActivitySetEntries(entries []PlanEntry, activityStages any, selectedIndexes []int) []PlanEntry {
	stages := map[string]struct{}{}
	for _, stage := range strictStringSlice(activityStages) {
		value := strings.ToUpper(jsStringOrEmpty(stage))
		if value == "" {
			continue
		}
		stages[value] = struct{}{}
	}
	requested := map[int]struct{}{}
	for _, index := range selectedIndexes {
		requested[index] = struct{}{}
	}
	result := make([]PlanEntry, 0)
	for _, entry := range entries {
		if _, ok := stages[strings.ToUpper(jsStringOrEmpty(entry.DisplayStage))]; !ok {
			continue
		}
		if len(requested) > 0 {
			if _, ok := requested[entry.ItemIndex]; !ok {
				continue
			}
		}
		result = append(result, entry)
	}
	return result
}

// BuildActivityExecutionOptions mirrors buildActivityExecutionOptions.
func BuildActivityExecutionOptions(preferences any, clientType, navigationMode string) map[string]any {
	result := copyRecord(asRecord(preferences))
	result["clientType"] = clientType
	result["useSanityPotion"] = true
	result["nativeDelegation"] = false
	if navigationMode == "current-map-fallback" {
		result["userResource"] = true
	}
	return result
}

// BuildActivityCopilotRunPlan mirrors buildActivityCopilotRunPlan.
func BuildActivityCopilotRunPlan(candidates *Candidates, preferences map[string]any) *RunPlan {
	if preferences == nil {
		preferences = map[string]any{}
	}
	if candidates == nil || candidates.State != "candidates-ready" {
		reason := "活动作业候选尚未就绪。"
		if candidates != nil && candidates.Reason != "" {
			reason = candidates.Reason
		}
		return &RunPlan{State: "blocked", Reason: reason, Entries: []RunPlanEntry{}}
	}

	missingStages := make([]string, 0)
	for _, stage := range candidates.Stages {
		if len(stage.Candidates) == 0 {
			missingStages = append(missingStages, stage.Stage)
		}
	}
	if len(missingStages) > 0 {
		return &RunPlan{
			State:   "blocked",
			Reason:  "以下活动关卡没有可靠作业，未执行不完整流程：" + strings.Join(missingStages, "、"),
			Entries: []RunPlanEntry{},
		}
	}

	raid := asString(preferences["raid"])
	if raid == "" {
		raid = "normal"
	}
	requestedModes := []string{raid}
	if raid == "both" {
		requestedModes = []string{"normal", "raid"}
	}
	entries := make([]RunPlanEntry, 0)
	unsupportedRaidStages := make([]string, 0)
	for _, stage := range candidates.Stages {
		if len(stage.Candidates) == 0 {
			continue
		}
		candidate := stage.Candidates[0]
		for _, mode := range requestedModes {
			if mode == "raid" && candidate.PresetFormation {
				if raid == "raid" {
					unsupportedRaidStages = append(unsupportedRaidStages, stage.Stage)
				}
				continue
			}
			missingOperators := candidate.MissingOperators
			if missingOperators == nil {
				missingOperators = []string{}
			}
			entries = append(entries, RunPlanEntry{
				CopilotID:        candidate.ID,
				URI:              candidate.URI,
				DisplayStage:     stage.Stage,
				Mode:             mode,
				PresetFormation:  candidate.PresetFormation,
				Title:            candidate.Title,
				RatingLevel:      candidate.RatingLevel,
				RatingRatio:      candidate.RatingRatio,
				MissingOperators: missingOperators,
				RequiresSupport:  candidate.RequiresSupport,
			})
		}
	}

	if len(unsupportedRaidStages) > 0 || len(entries) == 0 {
		reason := "没有与当前作业偏好兼容的活动作业。"
		if len(unsupportedRaidStages) > 0 {
			reason = "以下关卡只有预设编队作业，不能执行突袭：" + strings.Join(unsupportedRaidStages, "、")
		}
		return &RunPlan{State: "blocked", Reason: reason, Entries: []RunPlanEntry{}}
	}

	activity := candidates.Preflight.Activity
	return &RunPlan{
		State:    "ready",
		Reason:   "已为每个当前活动关卡选择一份可靠作业，将按关卡顺序执行。",
		Activity: &activity,
		Entries:  entries,
	}
}

// HasCompletedActivityNavigation reports whether maa's log contains the
// terminal TaskChainCompleted for the expected Custom task id.
func HasCompletedActivityNavigation(logText string, expectedTaskID int) bool {
	for _, line := range strings.Split(logText, "\n") {
		marker := "TaskChainCompleted "
		index := strings.Index(line, marker)
		if index < 0 {
			continue
		}
		value, err := parseJSONValue([]byte(line[index+len(marker):]))
		if err != nil {
			continue
		}
		payload := asRecord(value)
		if payload == nil {
			continue
		}
		if asString(payload["taskchain"]) != "Custom" {
			continue
		}
		if jsNumber(payload["taskid"]) == float64(expectedTaskID) {
			return true
		}
	}
	return false
}

// LoadActivityProgress reads activity-copilot-progress.json, degrading to an
// empty map on read or parse errors.
func (s *Service) LoadActivityProgress() ActivityProgress {
	value, err := jsonstore.Read(s.ProgressPath(), map[string]any{})
	if err != nil {
		return ActivityProgress{}
	}
	return normalizeActivityProgress(value)
}

func normalizeActivityProgress(value any) ActivityProgress {
	record := asRecord(value)
	if record == nil {
		return ActivityProgress{}
	}
	progress := make(ActivityProgress, len(record))
	for code, raw := range record {
		entry := asRecord(raw)
		if entry == nil {
			continue
		}
		stages := make([]string, 0)
		for _, stage := range strictStringSlice(entry["stages"]) {
			stages = append(stages, stage)
		}
		updatedAt := asString(entry["updatedAt"])
		progress[code] = ActivityProgressEntry{Stages: stages, UpdatedAt: updatedAt}
	}
	return progress
}

// SaveActivityProgress writes activity-copilot-progress.json as pretty JSON.
func (s *Service) SaveActivityProgress(progress ActivityProgress) error {
	if progress == nil {
		progress = ActivityProgress{}
	}
	if err := jsonstore.Write(s.ProgressPath(), progress, true); err != nil {
		return apperrors.WithStatus(
			"ACTIVITY_PROGRESS_WRITE_FAILED",
			"保存活动作业进度失败",
			http.StatusInternalServerError,
			false,
			map[string]any{"path": s.ProgressPath(), "error": err.Error()},
		)
	}
	return nil
}

// SummarizeActivityCompletion mirrors summarizeActivityCompletion.
func SummarizeActivityCompletion(activity any, progress ActivityProgress) ProgressSummary {
	record := activityRecordForProgress(activity)
	stages := make([]string, 0)
	seen := map[string]struct{}{}
	for _, raw := range strictStringSlice(record["stages"]) {
		stage := strings.ToUpper(jsStringOrEmpty(raw))
		if stage == "" {
			continue
		}
		if _, exists := seen[stage]; exists {
			continue
		}
		seen[stage] = struct{}{}
		stages = append(stages, stage)
	}
	source := "local-activity-progress"
	if !truthy(record["code"]) || len(stages) == 0 {
		return ProgressSummary{
			Known:           false,
			Complete:        false,
			CompletedStages: []string{},
			TotalStages:     len(stages),
			Source:          source,
		}
	}
	code := strings.ToUpper(jsString(record["code"]))
	completed := map[string]struct{}{}
	if entry, ok := progress[code]; ok {
		for _, stage := range entry.Stages {
			completed[stage] = struct{}{}
		}
	}
	completedStages := make([]string, 0)
	complete := true
	for _, stage := range stages {
		if _, ok := completed[stage]; ok {
			completedStages = append(completedStages, stage)
		} else {
			complete = false
		}
	}
	return ProgressSummary{
		Known:           true,
		Complete:        complete,
		CompletedStages: completedStages,
		TotalStages:     len(stages),
		Source:          source,
	}
}

// GetActivityCompletion reads local progress and summarizes the activity.
func (s *Service) GetActivityCompletion(_ context.Context, activity any) ProgressSummary {
	return SummarizeActivityCompletion(activity, s.LoadActivityProgress())
}

func (s *Service) recordActivityCompletion(activity any, entries []CompletionEntry) error {
	progress := s.LoadActivityProgress()
	record := activityRecordForProgress(activity)
	code := strings.ToUpper(jsString(record["code"]))
	existing := map[string]struct{}{}
	if entry, ok := progress[code]; ok {
		for _, stage := range entry.Stages {
			existing[stage] = struct{}{}
		}
	}
	for _, entry := range entries {
		if entry.Success != nil && !*entry.Success {
			continue
		}
		if entry.DisplayStage == "" {
			continue
		}
		existing[entry.DisplayStage] = struct{}{}
	}
	stages := make([]string, 0, len(existing))
	for stage := range existing {
		stages = append(stages, stage)
	}
	sort.Strings(stages)
	progress[code] = ActivityProgressEntry{
		Stages:    stages,
		UpdatedAt: s.now().UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	return s.SaveActivityProgress(progress)
}

func activityRecordForProgress(activity any) map[string]any {
	switch typed := activity.(type) {
	case nil:
		return map[string]any{}
	case map[string]any:
		return typed
	case NavigationActivity:
		return navigationActivityRecord(&typed)
	case *NavigationActivity:
		return navigationActivityRecord(typed)
	case Info:
		return navigationActivityRecord(infoNavigationActivity(&typed))
	case *Info:
		return navigationActivityRecord(infoNavigationActivity(typed))
	default:
		return map[string]any{}
	}
}

func navigationActivityRecord(activity *NavigationActivity) map[string]any {
	record := map[string]any{"stages": []string{}}
	if activity == nil {
		return record
	}
	if activity.Code != nil {
		record["code"] = *activity.Code
	}
	if activity.Name != nil {
		record["name"] = *activity.Name
	}
	if activity.Source != nil {
		record["source"] = *activity.Source
	}
	if activity.Stages != nil {
		record["stages"] = activity.Stages
	}
	return record
}

func infoNavigationActivity(info *Info) *NavigationActivity {
	if info == nil {
		return nil
	}
	return &NavigationActivity{
		Code:   info.Code,
		Name:   info.Name,
		Source: info.Source,
		Stages: info.Stages,
	}
}

func runPlanMap(plan *RunPlan) map[string]any {
	result := map[string]any{"state": plan.State, "entries": plan.Entries}
	if plan.Reason != "" {
		result["reason"] = plan.Reason
	}
	if plan.Activity != nil {
		result["activity"] = plan.Activity
	}
	if plan.NavigationMode != "" {
		result["navigationMode"] = plan.NavigationMode
	}
	if plan.RequiresUserOnActivityMap {
		result["requiresUserOnActivityMap"] = true
	}
	if plan.CurrentMapResource != nil {
		result["currentMapResource"] = plan.CurrentMapResource
	}
	return result
}

func executionMap(result *ExecutionResult) map[string]any {
	output := map[string]any{}
	if result == nil {
		output["results"] = []CompletionEntry{}
		return output
	}
	for key, value := range result.Data {
		output[key] = value
	}
	output["results"] = result.Results
	return output
}

func completedEntries(results []CompletionEntry) []CompletionEntry {
	output := make([]CompletionEntry, 0)
	for _, entry := range results {
		if entry.Success != nil && !*entry.Success {
			continue
		}
		if entry.DisplayStage == "" {
			continue
		}
		output = append(output, entry)
	}
	return output
}

func partialResultsFromError(err error) []CompletionEntry {
	if err == nil {
		return nil
	}
	if provider, ok := err.(PartialResultsError); ok {
		return provider.ActivityPartialResults()
	}
	return nil
}

func runPlanEntriesToPlanEntries(entries []RunPlanEntry) []PlanEntry {
	result := make([]PlanEntry, 0, len(entries))
	for index, entry := range entries {
		result = append(result, PlanEntry{
			Key:             fmt.Sprintf("activity:%d:%d:%s", index, entry.CopilotID, entry.Mode),
			ItemIndex:       index,
			CopilotID:       entry.CopilotID,
			DisplayStage:    entry.DisplayStage,
			Mode:            entry.Mode,
			PresetFormation: entry.PresetFormation,
		})
	}
	return result
}

func navigationCode(activity NavigationActivity) string {
	if activity.Code == nil {
		return ""
	}
	return *activity.Code
}

func activityDisplayName(activity NavigationActivity) string {
	if activity.Name != nil && *activity.Name != "" {
		return *activity.Name
	}
	return navigationCode(activity)
}

func dependencyError(code, message string) error {
	return apperrors.WithStatus(code, message, http.StatusServiceUnavailable, false, map[string]any{})
}

func navigationNotReadyError(reason string) error {
	if reason == "" {
		reason = "活动导航资源未就绪"
	}
	return apperrors.WithStatus("ACTIVITY_NAVIGATION_NOT_READY", reason, http.StatusConflict, false, map[string]any{})
}

func navigationFailedError(message string, cause error) error {
	details := map[string]any{}
	if cause != nil {
		details["error"] = cause.Error()
	}
	return apperrors.WithStatus("ACTIVITY_NAVIGATION_FAILED", message, http.StatusUnprocessableEntity, true, details)
}

func (s *Service) executeWithPreparation(
	ctx context.Context,
	preflight NavigationResult,
	clientType string,
	navigationStage string,
	execute func(context.Context) (*ExecutionResult, error),
) (*ExecutionResult, error) {
	if s.lease == nil {
		return nil, dependencyError("ACTIVITY_EXECUTION_LEASE_UNAVAILABLE", "MAA 执行租约未接入，未启动活动作业。")
	}
	var result *ExecutionResult
	err := s.lease.Run(ctx, LeaseRequest{
		Source:   "activity-copilot",
		TaskName: "当前活动作业",
		Command:  "activity-copilot",
	}, func(leaseCtx context.Context) error {
		if _, err := s.runActivityPreparation(leaseCtx, &Candidates{Preflight: preflight}, clientType, navigationStage); err != nil {
			return err
		}
		executed, err := execute(leaseCtx)
		result = executed
		return err
	})
	return result, err
}

func (s *Service) runActivityPreparation(
	ctx context.Context,
	candidates *Candidates,
	clientType string,
	navigationStage string,
) (bool, error) {
	activityCode := ""
	if candidates != nil {
		activityCode = navigationCode(candidates.Preflight.Activity)
	}
	preparationStage := s.resolvePreparationStage(navigationStage, activityCode)
	tasks := BuildActivityPreparationTasks(candidates, clientType, preparationStage)
	if len(tasks) == 0 {
		return false, nil
	}
	if s.executor == nil {
		return false, dependencyError("ACTIVITY_EXECUTOR_UNAVAILABLE", "MAA 执行器未接入，未启动活动作业。")
	}

	checkpoint := ""
	if s.navigationLog != nil {
		checkpoint = s.navigationLog.Checkpoint(ctx)
	}
	taskConfig := map[string]any{"tasks": tasks}
	if _, err := s.executor.RunTask(ctx, taskConfig, true); err != nil {
		return false, navigationFailedError(
			"活动导航未完成，已停止活动作业："+errorMessage(err),
			err,
		)
	}

	logText := ""
	if s.navigationLog != nil {
		logText = s.navigationLog.ReadSince(ctx, checkpoint)
	}
	if !HasCompletedActivityNavigation(logText, len(tasks)) {
		return false, navigationFailedError(
			"活动导航未完成，已停止活动作业；请检查游戏是否已进入活动关卡。",
			nil,
		)
	}
	return true, nil
}

func (s *Service) resolvePreparationStage(requestedStage, activityCode string) string {
	code := strings.ToUpper(strings.TrimSpace(activityCode))
	if code == "" {
		return ""
	}
	requested := strings.ToUpper(strings.TrimSpace(requestedStage))
	installed := map[string]any{}
	value, err := readJSONFile(filepath.Join(s.paths.MaaDataDir, "resource", "tasks", "Stages", code+".json"))
	if err == nil {
		if record := asRecord(value); record != nil {
			installed = record
		}
	}
	stagePattern := regexp.MustCompile(`(?i)^` + regexp.QuoteMeta(code) + `-\d+$`)
	available := make([]string, 0)
	for key := range installed {
		upper := strings.ToUpper(key)
		if stagePattern.MatchString(upper) {
			available = append(available, upper)
		}
	}
	if len(available) == 0 {
		return ""
	}
	sort.Strings(available)
	for _, stage := range available {
		if stage == requested {
			return requested
		}
	}
	sort.SliceStable(available, func(i, j int) bool {
		left, right := activityStageNumber(available[i]), activityStageNumber(available[j])
		leftNumber, rightNumber := 0, 0
		if left != nil {
			leftNumber = *left
		}
		if right != nil {
			rightNumber = *right
		}
		if leftNumber != rightNumber {
			return leftNumber < rightNumber
		}
		return available[i] < available[j]
	})
	requestedNumber := activityStageNumber(requested)
	if requestedNumber == nil {
		return available[0]
	}
	sort.SliceStable(available, func(i, j int) bool {
		left, right := activityStageNumber(available[i]), activityStageNumber(available[j])
		leftDistance, rightDistance := 0, 0
		if left != nil {
			leftDistance = absInt(*left - *requestedNumber)
		} else {
			leftDistance = absInt(*requestedNumber)
		}
		if right != nil {
			rightDistance = absInt(*right - *requestedNumber)
		} else {
			rightDistance = absInt(*requestedNumber)
		}
		if leftDistance != rightDistance {
			return leftDistance < rightDistance
		}
		return available[i] < available[j]
	})
	return available[0]
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

// RunCurrentActivitySet executes one explicitly selected activity copilot set
// after the same homepage navigation preparation used by the automatic runner.
func (s *Service) RunCurrentActivitySet(ctx context.Context, input SetExecutionOptions, lifecycle *Lifecycle) (map[string]any, error) {
	setID := strings.TrimSpace(input.SetID)
	if setID == "" {
		return nil, apperrors.Validation("ACTIVITY_SET_ID_REQUIRED", "缺少活动作业集 ID", nil)
	}
	clientType := input.ClientType
	if clientType == "" {
		clientType = DefaultClientType
	}
	raid := input.Raid
	if raid == "" {
		raid = "normal"
	}

	preflight, err := s.Check(ctx, clientType)
	if err != nil {
		return nil, err
	}
	if preflight.State != "ready" && preflight.ReasonCode != nil && *preflight.ReasonCode == "navigation-resource-unavailable" {
		if s.resourceUpdater != nil {
			if _, updateErr := s.resourceUpdater.Update(ctx); updateErr == nil {
				if updated, checkErr := s.Check(ctx, clientType); checkErr == nil {
					preflight = updated
				}
			}
		}
	}
	if preflight.State != "ready" {
		return nil, navigationNotReadyError(preflight.Reason)
	}

	activity := preflight.Activity
	activityStages := activityStageSet(activity.Stages)
	if len(activityStages) == 0 {
		return nil, apperrors.Validation("ACTIVITY_NO_STAGES", "当前活动没有可执行关卡", nil)
	}
	if s.planProvider == nil {
		return nil, dependencyError("ACTIVITY_PLAN_PROVIDER_UNAVAILABLE", "作业集计划服务未接入。")
	}
	if s.planExecutor == nil {
		return nil, dependencyError("ACTIVITY_PLAN_EXECUTOR_UNAVAILABLE", "作业集执行服务未接入。")
	}
	setPlan, err := s.planProvider.BuildPlan(ctx, setID, raid)
	if err != nil {
		return nil, err
	}
	selectedEntries := SelectActivitySetEntries(setPlan.Entries, activity.Stages, input.SelectedIndexes)
	if len(selectedEntries) == 0 {
		return nil, apperrors.Validation("ACTIVITY_SET_STAGE_MISMATCH", "作业集不包含当前活动关卡", nil)
	}
	selectedIndexes := uniqueItemIndexes(selectedEntries)
	navigationStage := ""
	if len(selectedEntries) > 0 {
		navigationStage = selectedEntries[0].DisplayStage
	}
	options := BuildActivityExecutionOptions(input.Options, clientType, "home-navigation")
	executionOptions := copyRecord(options)
	if navigationStage != "" {
		executionOptions["navigationStage"] = navigationStage
	}

	result, err := s.executeWithPreparation(ctx, preflight, clientType, navigationStage, func(execCtx context.Context) (*ExecutionResult, error) {
		return s.planExecutor.ExecutePlan(execCtx, PlanExecution{
			SetID:           setID,
			Raid:            raid,
			SelectedIndexes: selectedIndexes,
			Options:         executionOptions,
			Lifecycle:       lifecycle,
		})
	})
	if err != nil {
		entries := []CompletionEntry{}
		if result != nil {
			entries = append(entries, result.Results...)
		}
		entries = append(entries, partialResultsFromError(err)...)
		_ = s.recordActivityCompletion(activity, completedEntries(entries))
		return nil, err
	}
	if result == nil {
		return nil, dependencyError("ACTIVITY_PLAN_RESULT_MISSING", "作业集执行未返回结果。")
	}
	if err := s.recordActivityCompletion(activity, completedEntries(result.Results)); err != nil {
		return nil, err
	}

	response := executionMap(result)
	response["executed"] = true
	response["source"] = "matching-set"
	response["activity"] = activity
	planMap := map[string]any{}
	if existing, ok := response["plan"].(map[string]any); ok {
		planMap = copyRecord(existing)
	}
	planMap["activity"] = activity
	response["plan"] = planMap
	return response, nil
}

func uniqueItemIndexes(entries []PlanEntry) []int {
	seen := map[int]struct{}{}
	result := make([]int, 0, len(entries))
	for _, entry := range entries {
		if _, exists := seen[entry.ItemIndex]; exists {
			continue
		}
		seen[entry.ItemIndex] = struct{}{}
		result = append(result, entry.ItemIndex)
	}
	return result
}

// RunCurrentActivityCopilots mirrors runCurrentActivityCopilots. The matching
// set wins when available; otherwise each stage's best copilot is composed.
func (s *Service) RunCurrentActivityCopilots(ctx context.Context, clientType string, lifecycle *Lifecycle) (map[string]any, error) {
	return s.RunCurrentActivityCopilotsWithConnection(ctx, clientType, "", lifecycle)
}

// RunCurrentActivityCopilotsWithConnection adds an explicit device address to
// the execution options. An empty address keeps the service defaults.
func (s *Service) RunCurrentActivityCopilotsWithConnection(ctx context.Context, clientType, address string, lifecycle *Lifecycle) (map[string]any, error) {
	if clientType == "" {
		clientType = DefaultClientType
	}
	selection := s.LoadActivitySelectionContext(ctx)
	candidates, err := s.FindActivityCopilotCandidates(ctx, clientType, DiscoveryOptions{
		AllowCurrentMap: true,
		Selection:       &selection,
	})
	if err != nil {
		return nil, err
	}

	activityCode := ""
	if candidates.Preflight.Activity.Code != nil {
		activityCode = strings.ToUpper(*candidates.Preflight.Activity.Code)
	}
	refreshKey := clientType + ":" + activityCode
	s.refreshMu.Lock()
	lastAttemptAt := s.resourceRefreshAttempts[refreshKey]
	s.refreshMu.Unlock()

	var resourceRefresh map[string]any
	if shouldRefreshWithInterval(candidates.Preflight, lastAttemptAt, s.now(), s.refreshInterval) {
		s.refreshMu.Lock()
		s.resourceRefreshAttempts[refreshKey] = s.now()
		s.refreshMu.Unlock()
		resourceRefresh = map[string]any{"attempted": true}
		if s.resourceUpdater == nil {
			resourceRefresh["error"] = "资源更新服务未接入"
		} else if updateResult, updateErr := s.resourceUpdater.Update(ctx); updateErr != nil {
			resourceRefresh["error"] = updateErr.Error()
		} else {
			for key, value := range updateResult {
				resourceRefresh[key] = value
			}
			refreshed, refreshErr := s.FindActivityCopilotCandidates(ctx, clientType, DiscoveryOptions{
				AllowCurrentMap: true,
				Selection:       &selection,
			})
			if refreshErr != nil {
				resourceRefresh = map[string]any{"attempted": true, "error": refreshErr.Error()}
			} else {
				candidates = refreshed
			}
		}
	}

	preferences := selection.Preferences
	preferencesMap := preferences.Map()
	if value := strings.TrimSpace(address); value != "" {
		preferencesMap["address"] = value
	}
	plan := BuildActivityCopilotRunPlan(candidates, preferencesMap)
	activity := candidates.Preflight.Activity
	if plan.Activity != nil {
		activity = *plan.Activity
	}
	stageRatingScore := 0.0
	if plan.State == "ready" {
		stageRatingScore = averageRunPlanRating(plan.Entries)
	}
	matchingSet := candidates.MatchingSet
	setRatingScore := 0.0
	if matchingSet != nil {
		setRatingScore = matchingSet.RatingScore
	}
	useMatchingSet := matchingSet != nil
	mode := "per-stage"
	if useMatchingSet {
		mode = "matching-set"
	}
	selectionSummary := map[string]any{
		"mode":             mode,
		"setRatingScore":   setRatingScore,
		"stageRatingScore": stageRatingScore,
	}

	if !useMatchingSet && plan.State != "ready" {
		return map[string]any{
			"executed":        false,
			"candidates":      candidates,
			"preferences":     preferences,
			"plan":            plan,
			"resourceRefresh": resourceRefresh,
			"selection":       selectionSummary,
		}, nil
	}

	if candidates.NavigationMode == "current-map-fallback" {
		plan.NavigationMode = "current-map-fallback"
		plan.RequiresUserOnActivityMap = true
		stageList := make([]string, 0)
		if len(plan.Entries) > 0 {
			for _, entry := range plan.Entries {
				stageList = append(stageList, entry.DisplayStage)
			}
		} else if matchingSet != nil {
			for _, member := range matchingSet.Members {
				if member.Stage != nil {
					stageList = append(stageList, *member.Stage)
				}
			}
		}
		if s.currentMapPreparer == nil {
			return nil, dependencyError("ACTIVITY_CURRENT_MAP_PREPARER_UNAVAILABLE", "当前地图备用资源服务未接入。")
		}
		configDir := strings.TrimSpace(s.paths.MaaConfigDir)
		resource, err := s.currentMapPreparer.EnsureCurrentMapActivityResource(ctx, configDir, navigationCode(activity), stageList)
		if err != nil {
			return nil, err
		}
		plan.CurrentMapResource = resource
	}

	baseOptions := BuildActivityExecutionOptions(preferencesMap, clientType, candidates.NavigationMode)
	buildExecutionOptions := func(navigationStage string) map[string]any {
		options := copyRecord(baseOptions)
		if navigationStage != "" {
			options["navigationStage"] = navigationStage
		}
		return options
	}

	if useMatchingSet {
		set := *matchingSet
		if s.planProvider == nil {
			return nil, dependencyError("ACTIVITY_PLAN_PROVIDER_UNAVAILABLE", "作业集计划服务未接入。")
		}
		if s.planExecutor == nil {
			return nil, dependencyError("ACTIVITY_PLAN_EXECUTOR_UNAVAILABLE", "作业集执行服务未接入。")
		}
		setPlan, err := s.planProvider.BuildPlan(ctx, set.ID, preferences.Raid)
		if err != nil {
			return nil, err
		}
		activityStages := activityStageSet(activity.Stages)
		selectedIndexes := make([]int, 0)
		selectedSet := map[int]struct{}{}
		for _, entry := range setPlan.Entries {
			if _, ok := activityStages[strings.ToUpper(jsStringOrEmpty(entry.DisplayStage))]; !ok {
				continue
			}
			if _, exists := selectedSet[entry.ItemIndex]; exists {
				continue
			}
			selectedSet[entry.ItemIndex] = struct{}{}
			selectedIndexes = append(selectedIndexes, entry.ItemIndex)
		}
		if len(selectedIndexes) == 0 {
			return nil, apperrors.Validation("ACTIVITY_SET_STAGE_MISMATCH", "匹配作业集不包含当前活动关卡", nil)
		}
		navigationStage := ""
		for _, entry := range setPlan.Entries {
			if _, selected := selectedSet[entry.ItemIndex]; !selected {
				continue
			}
			if _, ok := activityStages[strings.ToUpper(jsStringOrEmpty(entry.DisplayStage))]; ok {
				navigationStage = entry.DisplayStage
				break
			}
		}

		completionEntries := make([]CompletionEntry, 0)
		if plan.State == "ready" {
			for _, entry := range plan.Entries {
				completionEntries = append(completionEntries, CompletionEntry{DisplayStage: entry.DisplayStage})
			}
		} else {
			for _, member := range set.Members {
				if member.Stage == nil {
					continue
				}
				if _, ok := activityStages[strings.ToUpper(jsStringOrEmpty(*member.Stage))]; !ok {
					continue
				}
				success := true
				completionEntries = append(completionEntries, CompletionEntry{DisplayStage: *member.Stage, Success: &success})
			}
		}

		result, err := s.executeWithPreparation(ctx, candidates.Preflight, clientType, navigationStage, func(execCtx context.Context) (*ExecutionResult, error) {
			return s.planExecutor.ExecutePlan(execCtx, PlanExecution{
				SetID:           set.ID,
				Raid:            preferences.Raid,
				SelectedIndexes: selectedIndexes,
				Options:         buildExecutionOptions(navigationStage),
				Lifecycle:       lifecycle,
			})
		})
		if err != nil {
			entries := []CompletionEntry{}
			if result != nil {
				entries = append(entries, result.Results...)
			}
			entries = append(entries, partialResultsFromError(err)...)
			_ = s.recordActivityCompletion(activity, entries)
			return nil, err
		}
		if result == nil {
			return nil, dependencyError("ACTIVITY_PLAN_RESULT_MISSING", "作业集执行未返回结果。")
		}
		if err := s.recordActivityCompletion(activity, completionEntries); err != nil {
			return nil, err
		}

		planMap := runPlanMap(plan)
		planMap["activity"] = activity
		planMap["set"] = set
		planMap["selection"] = selectionSummary
		return map[string]any{
			"executed":        true,
			"source":          "matching-set",
			"candidates":      candidates,
			"preferences":     preferences,
			"plan":            planMap,
			"execution":       executionMap(result),
			"resourceRefresh": resourceRefresh,
		}, nil
	}

	if s.planExecutor == nil {
		return nil, dependencyError("ACTIVITY_PLAN_EXECUTOR_UNAVAILABLE", "作业集执行服务未接入。")
	}
	planID := fmt.Sprintf("activity-%s-%d", navigationCode(activity), s.now().UnixMilli())
	navigationStage := ""
	if len(plan.Entries) > 0 {
		navigationStage = plan.Entries[0].DisplayStage
	}
	result, err := s.executeWithPreparation(ctx, candidates.Preflight, clientType, navigationStage, func(execCtx context.Context) (*ExecutionResult, error) {
		return s.planExecutor.ExecuteSelectedEntries(execCtx, EntriesExecution{
			PlanID:    planID,
			Name:      activityDisplayName(activity) + " 活动作业",
			Entries:   runPlanEntriesToPlanEntries(plan.Entries),
			Options:   buildExecutionOptions(navigationStage),
			Lifecycle: lifecycle,
		})
	})
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, dependencyError("ACTIVITY_PLAN_RESULT_MISSING", "活动作业执行未返回结果。")
	}
	if err := s.recordActivityCompletion(activity, completedEntries(result.Results)); err != nil {
		return nil, err
	}

	planMap := runPlanMap(plan)
	planMap["planId"] = planID
	planMap["selection"] = selectionSummary
	return map[string]any{
		"executed":        true,
		"source":          "composed-candidates",
		"candidates":      candidates,
		"preferences":     preferences,
		"plan":            planMap,
		"execution":       executionMap(result),
		"resourceRefresh": resourceRefresh,
	}, nil
}
