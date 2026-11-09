package copilot

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"

	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const (
	executionPlanSource  = "copilot-set"
	activityPlanSource   = "activity-copilot"
	executionPlanCommand = "copilot-plan"
	activityTaskPrefix   = "activity_copilot"
	planTaskPrefix       = "copilot_plan"
)

var errExecutionStopped = errors.New("作业集执行已停止")

// Executor is the narrow MAA process surface used by plan and manual
// execution. It matches the scheduler and activity adapter shapes so the app
// layer can reuse one adapter for every copilot entry point.
type Executor interface {
	RunTask(ctx context.Context, taskConfig map[string]any, wait bool) (domainrun.DTO, error)
	RunCommand(ctx context.Context, command string, args []string, taskName, taskType string, wait bool) (domainrun.DTO, error)
	Stop(ctx context.Context) error
}

// LeaseRequest identifies one shared MAA execution lease.
type LeaseRequest struct {
	Source   string
	TaskName string
	Command  string
}

// LeaseRunner wraps plan execution in the shared MAA execution lease. It is
// optional: nil means each Executor call manages the lease itself. Provide a
// runner only with an executor adapter that does not acquire the same lease
// again, otherwise the nested acquire reports MAA_EXECUTION_BUSY.
type LeaseRunner interface {
	Run(ctx context.Context, request LeaseRequest, fn func(ctx context.Context) error) error
}

// ExecutionLifecycle mirrors the AgentRun progress hooks consumed by the
// activity and manual services. Callbacks may be nil.
type ExecutionLifecycle struct {
	RunID      string
	OnStarted  func()
	OnProgress func(progress map[string]any, taskResults []ProgressEntryResult)
}

// PlanExecution is an ExecutePlan request.
type PlanExecution struct {
	SetID           string
	Raid            string
	SelectedIndexes []int
	Options         map[string]any
	Lifecycle       *ExecutionLifecycle
	// Plan optionally supplies an already-built plan. It is used only when its
	// SetID matches the sanitized request SetID, mirroring the Node service.
	Plan *Plan
}

// EntriesExecution is an ExecuteSelectedEntries request.
type EntriesExecution struct {
	PlanID    string
	Name      string
	Entries   []PlanEntry
	Options   map[string]any
	Lifecycle *ExecutionLifecycle
}

// ExecutionEntryResult is one entry's outcome. Field names match the Node
// execution result so API responses can merge it directly.
type ExecutionEntryResult struct {
	Key          string `json:"key,omitempty"`
	ItemIndex    int    `json:"itemIndex"`
	CopilotID    int    `json:"copilotId"`
	StageID      string `json:"stageId,omitempty"`
	DisplayStage string `json:"displayStage"`
	Mode         string `json:"mode,omitempty"`
	Success      bool   `json:"success"`
	Error        string `json:"error,omitempty"`
}

// ExecutionResult carries per-entry outcomes plus the transport projection.
// Data is merged into the run response for API parity.
type ExecutionResult struct {
	Results     []ExecutionEntryResult `json:"results"`
	TaskResults []ProgressEntryResult  `json:"taskResults,omitempty"`
	Data        map[string]any         `json:"-"`
}

type planEntryGroup struct {
	presetFormation bool
	entries         []PlanEntry
}

type dynamicExecution struct {
	planID            string
	name              string
	plan              *Plan
	entries           []PlanEntry
	options           map[string]any
	lifecycle         *ExecutionLifecycle
	tracker           *ProgressTracker
	loopTimes         int
	preTasks          []any
	navigationStage   string
	clientType        string
	address           string
	persistCompletion bool
	taskPrefix        string
	completed         map[string]struct{}
}

// ManualStepExecutor returns the StepExecutor backed by this service's
// Executor. NewManualManager can use it directly; nil keeps manual sessions
// unsupported.
func (s *Service) ManualStepExecutor() StepExecutor {
	if s.executor == nil {
		return nil
	}
	return s.runManualStep
}

func (s *Service) runManualStep(ctx context.Context, request ManualStepRequest) ([]any, error) {
	result, err := s.ExecutePlan(ctx, PlanExecution{
		SetID:           request.SetID,
		Raid:            request.Raid,
		SelectedIndexes: []int{request.ItemIndex},
		Options:         request.Options,
		Plan:            request.Plan,
		// A RunID forces the dynamic path so a partial selection is never
		// delegated to the native command and per-entry status is retained.
		Lifecycle: &ExecutionLifecycle{RunID: request.RunID},
	})
	taskResults := make([]any, 0)
	if result != nil {
		for _, item := range result.TaskResults {
			taskResults = append(taskResults, item)
		}
	}
	return taskResults, err
}

// ExecutePlan runs a whole copilot set. Entries run sequentially in plan
// order; a failure returns the entries that already succeeded plus a stable
// error instead of silently continuing.
func (s *Service) ExecutePlan(ctx context.Context, request PlanExecution) (*ExecutionResult, error) {
	if s.executor == nil {
		return nil, executionUnavailableError("作业集执行服务未接入")
	}
	planID, err := SanitizePlanID(request.SetID)
	if err != nil {
		return nil, err
	}
	raid := strings.TrimSpace(request.Raid)
	if raid == "" {
		raid = "normal"
	}
	options := request.Options
	if options == nil {
		options = map[string]any{}
	}
	plan := request.Plan
	if plan == nil || plan.SetID != planID {
		plan, err = s.BuildPlan(ctx, planID, raid)
		if err != nil {
			return nil, err
		}
	}

	selectedEntries := selectPlanEntries(plan.Entries, request.SelectedIndexes)
	completed := progressSet(s.LoadProgress()[planID])
	pending := pendingPlanEntries(selectedEntries, completed)
	loopTimes := NormalizeCopilotLoopTimes(options["loopTimes"])
	tracker := trackerForLifecycle(request.Lifecycle, pending)
	preTasks := optionPreTasks(options)
	nativeDelegation := optionBool(options, "nativeDelegation", true)

	emitExecutionProgress(request.Lifecycle, tracker, map[string]any{
		"setId":       planID,
		"name":        plan.Name,
		"phase":       "starting",
		"message":     "准备执行",
		"currentStep": 0,
		"totalSteps":  len(pending),
	})

	copilotOptions := ParseCopilotOptions(options)
	hasPresetFormation := planHasPresetFormation(plan)
	if tracker == nil && len(preTasks) == 0 && nativeDelegation && CanUseNativeCopilotSet(NativeSetOptions{
		Entries:            selectedEntries,
		TotalItems:         planItemCount(plan),
		HasPresetFormation: &hasPresetFormation,
		Raid:               raid,
		LoopTimes:          loopTimes,
		SelectedIndexes:    intSliceToAny(request.SelectedIndexes),
		CompletedKeys:      sortedSetKeys(completed),
		FormationMode:      copilotOptions.FormationMode,
		UserAdditional:     options["userAdditional"],
	}) {
		return s.executeNativePlan(ctx, plan, planID, raid, options, selectedEntries, completed, loopTimes, request.Lifecycle)
	}

	execution := dynamicExecution{
		planID:            planID,
		name:              plan.Name,
		plan:              plan,
		entries:           pending,
		options:           options,
		lifecycle:         request.Lifecycle,
		tracker:           tracker,
		loopTimes:         loopTimes,
		preTasks:          preTasks,
		navigationStage:   optionString(options, "navigationStage"),
		clientType:        executionClientType(options),
		address:           optionString(options, "address"),
		persistCompletion: true,
		taskPrefix:        planTaskPrefix,
		completed:         completed,
	}
	return s.executeWithLease(ctx, LeaseRequest{
		Source:   executionPlanSource,
		TaskName: plan.Name,
		Command:  executionPlanCommand,
	}, execution)
}

// ExecuteSelectedEntries runs an already selected list of copilot ids through
// the same dynamic MAA task used by copilot sets. It records no plan progress.
func (s *Service) ExecuteSelectedEntries(ctx context.Context, request EntriesExecution) (*ExecutionResult, error) {
	if s.executor == nil {
		return nil, executionUnavailableError("作业条目执行服务未接入")
	}
	planID, err := SanitizePlanID(request.PlanID)
	if err != nil {
		return nil, err
	}
	entries := executablePlanEntries(request.Entries)
	if len(entries) == 0 {
		return nil, apperrors.Validation("COPILOT_ENTRIES_EMPTY", "没有可执行的作业条目", map[string]any{"planId": planID})
	}
	options := request.Options
	if options == nil {
		options = map[string]any{}
	}
	name := strings.TrimSpace(request.Name)
	if name == "" {
		name = "活动作业"
	}
	tracker := trackerForLifecycle(request.Lifecycle, entries)
	loopTimes := NormalizeCopilotLoopTimes(options["loopTimes"])
	emitExecutionProgress(request.Lifecycle, tracker, map[string]any{
		"setId":       planID,
		"name":        name,
		"phase":       "starting",
		"message":     "准备执行",
		"currentStep": 0,
		"totalSteps":  len(entries),
	})

	execution := dynamicExecution{
		planID:            planID,
		name:              name,
		plan:              nil,
		entries:           entries,
		options:           options,
		lifecycle:         request.Lifecycle,
		tracker:           tracker,
		loopTimes:         loopTimes,
		preTasks:          optionPreTasks(options),
		navigationStage:   optionString(options, "navigationStage"),
		clientType:        executionClientType(options),
		address:           optionString(options, "address"),
		persistCompletion: false,
		taskPrefix:        activityTaskPrefix,
		completed:         map[string]struct{}{},
	}
	return s.executeWithLease(ctx, LeaseRequest{
		Source:   activityPlanSource,
		TaskName: name,
		Command:  executionPlanCommand,
	}, execution)
}

func (s *Service) executeWithLease(
	ctx context.Context,
	request LeaseRequest,
	execution dynamicExecution,
) (*ExecutionResult, error) {
	if s.lease == nil {
		return s.executeDynamicEntries(ctx, execution)
	}
	var result *ExecutionResult
	var runErr error
	leaseErr := s.lease.Run(ctx, request, func(leaseCtx context.Context) error {
		result, runErr = s.executeDynamicEntries(leaseCtx, execution)
		return runErr
	})
	if runErr != nil {
		return result, runErr
	}
	if leaseErr != nil {
		if result == nil {
			data := execution.data([]ExecutionEntryResult{}, execution.completed)
			data["success"] = false
			result = &ExecutionResult{Results: []ExecutionEntryResult{}, Data: data}
		}
		return result, leaseErr
	}
	return result, nil
}

func (s *Service) executeNativePlan(
	ctx context.Context,
	plan *Plan,
	planID string,
	raid string,
	options map[string]any,
	entries []PlanEntry,
	completed map[string]struct{},
	loopTimes int,
	lifecycle *ExecutionLifecycle,
) (*ExecutionResult, error) {
	// Native delegation is a single executor call, so the executor owns the
	// lease and the copilot layer does not wrap it again.
	args := BuildNativeCopilotCommand(planID, raid, ParseCopilotOptions(options))
	emitExecutionStarted(lifecycle)
	dto, err := s.executor.RunCommand(ctx, "copilot", args, plan.Name, "copilot", true)
	if err == nil {
		err = runDTOError(dto)
	}
	if err != nil {
		message := executionErrorMessage(err)
		results := make([]ExecutionEntryResult, 0, len(entries))
		for _, entry := range entries {
			results = append(results, failedExecutionResult(entry, message))
		}
		data := planExecutionData(plan, "native", results, entries, completed, loopTimes)
		data["success"] = false
		data["command"] = "maa copilot " + strings.Join(args, " ")
		stopped := isStoppedExecution(err, ctx, dto)
		return &ExecutionResult{Results: results, Data: data}, executionRunError(err, stopped, data)
	}

	results := make([]ExecutionEntryResult, 0, len(entries))
	for _, entry := range entries {
		results = append(results, succeededExecutionResult(entry))
	}
	s.recordCompletedEntries(entries, loopTimes)
	if keys := entryKeys(entries); len(keys) > 0 {
		if err := s.MarkCompleted(planID, keys); err != nil {
			data := planExecutionData(plan, "native", results, entries, completed, loopTimes)
			data["success"] = true
			data["command"] = "maa copilot " + strings.Join(args, " ")
			return &ExecutionResult{Results: results, Data: data}, err
		}
	}
	completed = progressSet(s.LoadProgress()[planID])
	data := planExecutionData(plan, "native", results, entries, completed, loopTimes)
	data["success"] = true
	data["command"] = "maa copilot " + strings.Join(args, " ")
	if output := dtoOutput(dto); output != "" {
		data["output"] = output
	}
	return &ExecutionResult{Results: results, Data: data}, nil
}

func (s *Service) executeDynamicEntries(ctx context.Context, execution dynamicExecution) (*ExecutionResult, error) {
	emitExecutionStarted(execution.lifecycle)
	configDir := strings.TrimSpace(s.paths.MaaConfigDir)
	if configDir == "" {
		return nil, apperrors.WithStatus(
			"COPILOT_EXECUTION_CONFIG_UNAVAILABLE",
			"MAA 配置目录未接入，无法执行作业集",
			http.StatusServiceUnavailable,
			false,
			map[string]any{"planId": execution.planID},
		)
	}
	planDir := filepath.Join(configDir, "copilot-plans", execution.planID)
	if err := jsonstore.EnsureDir(planDir); err != nil {
		return nil, apperrors.WithStatus(
			"COPILOT_EXECUTION_WORKDIR_FAILED",
			"无法创建作业执行目录",
			http.StatusInternalServerError,
			false,
			map[string]any{"path": planDir, "error": err.Error()},
		)
	}

	ordered := OrderEntriesForNavigation(execution.entries, execution.navigationStage)
	groups := groupPlanEntries(ordered)
	results := make([]ExecutionEntryResult, 0, len(ordered))
	copilotOptions := ParseCopilotOptions(execution.options)
	completed := execution.completed
	if completed == nil {
		completed = map[string]struct{}{}
	}

	for groupIndex, group := range groups {
		if err := ctx.Err(); err != nil {
			stopped := errors.Is(err, context.Canceled)
			data := execution.data(results, completed)
			data["success"] = false
			return &ExecutionResult{
				Results:     append([]ExecutionEntryResult{}, results...),
				TaskResults: execution.tracker.Snapshot(),
				Data:        data,
			}, executionRunError(err, stopped, data)
		}

		list := make([]any, 0)
		progressItems := make([]StageProgressItem, 0)
		var buildErr error
		for _, entry := range group.entries {
			data, err := s.prts.GetCopilot(ctx, jsString(entry.CopilotID))
			if err != nil {
				buildErr = err
				break
			}
			content := ParseCopilotContent(data)
			for _, file := range BuildCopilotRepeatFiles(RepeatSource{
				ItemIndex: entry.ItemIndex,
				CopilotID: entry.CopilotID,
				Mode:      entry.Mode,
			}, execution.loopTimes, planDir) {
				if err := jsonstore.Write(file.Filename, content, true); err != nil {
					buildErr = apperrors.WithStatus(
						"COPILOT_REPEAT_FILE_FAILED",
						"写入作业副本失败",
						http.StatusInternalServerError,
						false,
						map[string]any{"path": file.Filename, "error": err.Error()},
					)
					break
				}
				list = append(list, map[string]any{
					"id":                len(list),
					"filename":          file.Filename,
					"stage_name":        entry.DisplayStage,
					"nav_name_override": entry.DisplayStage,
					"is_raid":           entry.Mode == "raid",
				})
				entryCopy := entry
				progressItems = append(progressItems, StageProgressItem{
					Filename:     file.Filename,
					DisplayStage: entry.DisplayStage,
					Entry:        &entryCopy,
				})
			}
			if buildErr != nil {
				break
			}
		}
		if buildErr != nil {
			stopped := isStoppedExecution(buildErr, ctx, domainrun.DTO{})
			data := execution.data(results, completed)
			data["success"] = false
			emitExecutionProgress(execution.lifecycle, execution.tracker, map[string]any{
				"setId":   execution.planID,
				"name":    execution.name,
				"phase":   progressFailurePhase(stopped),
				"message": executionErrorMessage(buildErr),
			})
			return &ExecutionResult{
				Results:     append([]ExecutionEntryResult{}, results...),
				TaskResults: execution.tracker.Snapshot(),
				Data:        data,
			}, executionRunError(buildErr, stopped, data)
		}
		if len(list) == 0 {
			continue
		}

		taskID := fmt.Sprintf("%s_%s_%d_%d", execution.taskPrefix, execution.planID, s.now().UnixMilli(), groupIndex)
		var preTasks []any
		if groupIndex == 0 {
			preTasks = execution.preTasks
		}
		taskConfig := BuildCopilotDynamicTaskConfig(preTasks, map[string]any{
			"name":   taskID,
			"type":   "Copilot",
			"params": BuildCopilotTaskParams(list, group.presetFormation, copilotOptions),
		})
		if execution.clientType != "" {
			taskConfig["client_type"] = execution.clientType
		}
		if execution.address != "" {
			taskConfig["address"] = execution.address
		}

		if execution.tracker != nil {
			execution.tracker.MarkRunning(group.entries[0])
		}
		baseProgress := map[string]any{
			"setId":        execution.planID,
			"name":         execution.name,
			"phase":        "running",
			"message":      "正在执行作业集",
			"currentStage": group.entries[0].DisplayStage,
			"currentStep":  len(results) + 1,
			"totalSteps":   len(ordered),
		}
		emitExecutionProgress(execution.lifecycle, execution.tracker, baseProgress)

		if stageErr := s.missingStageError(group.entries); stageErr != nil {
			groupResults, _ := settleGroupFailure(execution.tracker, group.entries, progressItems, "", executionErrorMessage(stageErr), false)
			results = append(results, groupResults...)
			data := execution.data(results, completed)
			data["success"] = false
			emitExecutionProgress(execution.lifecycle, execution.tracker, map[string]any{
				"setId":   execution.planID,
				"name":    execution.name,
				"phase":   "failed",
				"message": executionErrorMessage(stageErr),
			})
			return &ExecutionResult{
				Results:     append([]ExecutionEntryResult{}, results...),
				TaskResults: execution.tracker.Snapshot(),
				Data:        data,
			}, executionRunError(stageErr, false, data)
		}

		if group.presetFormation {
			if err := EnsurePresetFormationResource(s.resource.ResourceDir(), configDir); err != nil {
				groupResults, _ := settleGroupFailure(execution.tracker, group.entries, progressItems, "", executionErrorMessage(err), false)
				results = append(results, groupResults...)
				data := execution.data(results, completed)
				data["success"] = false
				emitExecutionProgress(execution.lifecycle, execution.tracker, map[string]any{
					"setId":   execution.planID,
					"name":    execution.name,
					"phase":   "failed",
					"message": executionErrorMessage(err),
				})
				return &ExecutionResult{
					Results:     append([]ExecutionEntryResult{}, results...),
					TaskResults: execution.tracker.Snapshot(),
					Data:        data,
				}, executionRunError(err, false, data)
			}
		}

		stopBattleProgress := s.startBattleProgressSampler(ctx, execution.lifecycle, baseProgress)
		dto, err := s.executor.RunTask(ctx, taskConfig, true)
		stopBattleProgress()
		if err == nil {
			err = runDTOError(dto)
		}
		if err != nil {
			stopped := isStoppedExecution(err, ctx, dto)
			message := executionErrorMessage(err)
			groupResults, successfulKeys := settleGroupFailure(
				execution.tracker,
				group.entries,
				progressItems,
				dtoOutput(dto),
				message,
				stopped,
			)
			results = append(results, groupResults...)
			if execution.persistCompletion && len(successfulKeys) > 0 {
				if markErr := s.MarkCompleted(execution.planID, successfulKeys); markErr != nil {
					data := execution.data(results, completed)
					data["success"] = false
					return &ExecutionResult{
						Results:     append([]ExecutionEntryResult{}, results...),
						TaskResults: execution.tracker.Snapshot(),
						Data:        data,
					}, markErr
				}
				for _, key := range successfulKeys {
					completed[key] = struct{}{}
				}
			}
			data := execution.data(results, completed)
			data["success"] = false
			if output := dtoOutput(dto); output != "" {
				data["output"] = output
			}
			emitExecutionProgress(execution.lifecycle, execution.tracker, map[string]any{
				"setId":   execution.planID,
				"name":    execution.name,
				"phase":   progressFailurePhase(stopped),
				"message": message,
			})
			return &ExecutionResult{
				Results:     append([]ExecutionEntryResult{}, results...),
				TaskResults: execution.tracker.Snapshot(),
				Data:        data,
			}, executionRunError(err, stopped, data)
		}

		for _, entry := range group.entries {
			results = append(results, succeededExecutionResult(entry))
			if execution.persistCompletion {
				completed[progressEntryKey(entry)] = struct{}{}
			}
		}
		s.recordCompletedEntries(group.entries, execution.loopTimes)
		if execution.tracker != nil {
			execution.tracker.MarkGroupSuccess(group.entries)
		}
		if execution.persistCompletion {
			if err := s.MarkCompleted(execution.planID, entryKeys(group.entries)); err != nil {
				data := execution.data(results, completed)
				data["success"] = true
				return &ExecutionResult{
					Results:     append([]ExecutionEntryResult{}, results...),
					TaskResults: execution.tracker.Snapshot(),
					Data:        data,
				}, err
			}
		}
		emitExecutionProgress(execution.lifecycle, execution.tracker, map[string]any{
			"setId":   execution.planID,
			"name":    execution.name,
			"phase":   "running",
			"message": "正在执行作业集",
		})
	}

	data := execution.data(results, completed)
	data["success"] = true
	return &ExecutionResult{
		Results:     results,
		TaskResults: execution.tracker.Snapshot(),
		Data:        data,
	}, nil
}

func (execution dynamicExecution) data(results []ExecutionEntryResult, completed map[string]struct{}) map[string]any {
	if execution.plan != nil {
		return planExecutionData(execution.plan, "dynamic", results, execution.entries, completed, execution.loopTimes)
	}
	return selectedExecutionData(execution.planID, execution.name, "dynamic", results, execution.loopTimes)
}

func planExecutionData(
	plan *Plan,
	source string,
	results []ExecutionEntryResult,
	selectedEntries []PlanEntry,
	completed map[string]struct{},
	loopTimes int,
) map[string]any {
	return map[string]any{
		"setId":     plan.SetID,
		"name":      plan.Name,
		"plan":      plan,
		"results":   results,
		"completed": sortedSetKeys(completed),
		"pending":   pendingPlanEntries(selectedEntries, completed),
		"loopTimes": loopTimes,
		"source":    source,
	}
}

func selectedExecutionData(planID, name, source string, results []ExecutionEntryResult, loopTimes int) map[string]any {
	return map[string]any{
		"setId":     planID,
		"name":      name,
		"results":   results,
		"loopTimes": loopTimes,
		"source":    source,
	}
}

func groupPlanEntries(entries []PlanEntry) []planEntryGroup {
	groups := make([]planEntryGroup, 0)
	for _, entry := range entries {
		last := len(groups) - 1
		if last >= 0 && groups[last].presetFormation == entry.PresetFormation {
			groups[last].entries = append(groups[last].entries, entry)
			continue
		}
		groups = append(groups, planEntryGroup{
			presetFormation: entry.PresetFormation,
			entries:         []PlanEntry{entry},
		})
	}
	return groups
}

// settleGroupFailure projects a failed or stopped group after the task
// returned. Entries proven complete by the loaded-file log keep success; the
// remaining entries follow the tracker's running/started state.
func settleGroupFailure(
	tracker *ProgressTracker,
	entries []PlanEntry,
	items []StageProgressItem,
	output string,
	message string,
	stopped bool,
) ([]ExecutionEntryResult, []string) {
	currentIndex := -1
	if output != "" {
		if progress := FindCopilotStageProgress(items, output); progress != nil {
			currentIndex = progress.Index
		}
	}
	results := make([]ExecutionEntryResult, 0, len(entries))
	successfulKeys := make([]string, 0)
	for _, entry := range entries {
		key := progressEntryKey(entry)
		indexes := make([]int, 0)
		for index, item := range items {
			if item.Entry == nil || progressEntryKey(*item.Entry) != key {
				continue
			}
			indexes = append(indexes, index)
		}
		success := currentIndex > 0 && len(indexes) > 0
		for _, index := range indexes {
			if index >= currentIndex {
				success = false
				break
			}
		}
		started := false
		if currentIndex >= 0 {
			for _, index := range indexes {
				if index <= currentIndex {
					started = true
					break
				}
			}
		}
		if tracker.statusOf(key) == ProgressRunning {
			started = true
		}

		status := ProgressPending
		if success {
			status = ProgressSuccess
			successfulKeys = append(successfulKeys, key)
			results = append(results, succeededExecutionResult(entry))
		} else {
			switch {
			case started && stopped:
				status = ProgressStopped
			case started:
				status = ProgressFailed
			}
			results = append(results, failedExecutionResult(entry, message))
		}
		errorMessage := ""
		if status == ProgressFailed {
			errorMessage = message
		}
		tracker.MarkSettled(entry, status, errorMessage)
	}
	if stopped {
		tracker.SettleRunning(ProgressStopped, message)
	}
	return results, successfulKeys
}

func (s *Service) recordCompletedEntries(entries []PlanEntry, loopTimes int) {
	if s.dropRecorder == nil || len(entries) == 0 {
		return
	}
	if loopTimes < 1 {
		loopTimes = 1
	}
	for _, entry := range entries {
		sanity := float64(0)
		if entry.APCost != nil {
			sanity = *entry.APCost * float64(loopTimes)
		}
		payload := map[string]any{
			"stage":    entry.DisplayStage,
			"times":    loopTimes,
			"sanity":   sanity,
			"medicine": 0,
			"stone":    0,
			"items":    []any{},
			"source":   "copilot",
			"mode":     entry.Mode,
		}
		if err := s.dropRecorder.RecordDrops(payload); err != nil {
			s.logger.Warn("record copilot drops", "stage", entry.DisplayStage, "error", err)
		}
	}
}

func succeededExecutionResult(entry PlanEntry) ExecutionEntryResult {
	return ExecutionEntryResult{
		Key:          entry.Key,
		ItemIndex:    entry.ItemIndex,
		CopilotID:    entry.CopilotID,
		StageID:      entry.StageID,
		DisplayStage: entry.DisplayStage,
		Mode:         entry.Mode,
		Success:      true,
	}
}

func failedExecutionResult(entry PlanEntry, message string) ExecutionEntryResult {
	return ExecutionEntryResult{
		Key:          entry.Key,
		ItemIndex:    entry.ItemIndex,
		CopilotID:    entry.CopilotID,
		StageID:      entry.StageID,
		DisplayStage: entry.DisplayStage,
		Mode:         entry.Mode,
		Success:      false,
		Error:        message,
	}
}

func runDTOError(dto domainrun.DTO) error {
	switch dto.State {
	case domainrun.StatusStopped, domainrun.StatusStopping:
		return errExecutionStopped
	case domainrun.StatusFailed, domainrun.StatusInterrupted:
		if dto.Error != nil && strings.TrimSpace(dto.Error.Message) != "" {
			return errors.New(dto.Error.Message)
		}
		return fmt.Errorf("MAA 作业结束状态为 %s", dto.State)
	}
	return nil
}

func isStoppedExecution(err error, ctx context.Context, dto domainrun.DTO) bool {
	if errors.Is(err, errExecutionStopped) || errors.Is(err, context.Canceled) {
		return true
	}
	if dto.State == domainrun.StatusStopped || dto.State == domainrun.StatusStopping {
		return true
	}
	return ctx != nil && errors.Is(ctx.Err(), context.Canceled)
}

func executionRunError(cause error, stopped bool, details map[string]any) error {
	if details == nil {
		details = map[string]any{}
	}
	if stopped {
		details["stopped"] = true
		if cause != nil {
			details["error"] = cause.Error()
		}
		return apperrors.WithStatus("COPILOT_PLAN_STOPPED", "作业集执行已停止", http.StatusConflict, false, details)
	}
	if cause != nil {
		details["error"] = cause.Error()
	}
	if appErr, ok := apperrors.As(cause); ok && appErr.Code != "" {
		merged := copyRecord(appErr.Details)
		for key, value := range details {
			merged[key] = value
		}
		return apperrors.WithStatus(appErr.Code, appErr.Message, appErr.StatusCode, appErr.Retryable, merged)
	}
	return apperrors.WithStatus("COPILOT_PLAN_FAILED", "作业集执行失败", http.StatusUnprocessableEntity, true, details)
}

func executionUnavailableError(message string) *apperrors.Error {
	return apperrors.WithStatus("COPILOT_EXECUTOR_UNAVAILABLE", message, http.StatusServiceUnavailable, false, map[string]any{})
}

func executionErrorMessage(err error) string {
	if err == nil {
		return "作业集执行失败"
	}
	if appErr, ok := apperrors.As(err); ok && appErr.Message != "" {
		return appErr.Message
	}
	if message := strings.TrimSpace(err.Error()); message != "" {
		return message
	}
	return "作业集执行失败"
}

func dtoOutput(dto domainrun.DTO) string {
	record := asRecord(dto.Result)
	if record == nil {
		return ""
	}
	if stdout := asString(record["stdout"]); strings.TrimSpace(stdout) != "" {
		return stdout
	}
	return asString(record["stderr"])
}

func emitExecutionStarted(lifecycle *ExecutionLifecycle) {
	if lifecycle != nil && lifecycle.OnStarted != nil {
		lifecycle.OnStarted()
	}
}

// missingStageError rejects a copilot group whose stages are absent from the
// installed MAA resource. MaaCore otherwise fails later with "invalid params"
// and an opaque exit code, which gives the user no actionable next step.
func (s *Service) missingStageError(entries []PlanEntry) *apperrors.Error {
	if s == nil || s.resource == nil {
		return nil
	}
	missing := make([]string, 0)
	for _, entry := range entries {
		stageID := strings.TrimSpace(entry.StageID)
		if stageID == "" || s.resource.HasStageTile(stageID) {
			continue
		}
		label := strings.TrimSpace(entry.DisplayStage)
		if label == "" {
			label = stageID
		} else {
			label += "（" + stageID + "）"
		}
		missing = append(missing, label)
	}
	if len(missing) == 0 {
		return nil
	}
	return apperrors.WithStatus(
		"MAA_COPILOT_STAGE_UNAVAILABLE",
		"当前 MAA 资源不包含作业关卡 "+strings.Join(missing, "、")+"，请先热更新 MAA 资源后重试",
		http.StatusConflict,
		false,
		map[string]any{
			"stages": missing,
			"action": "maa hot-update",
		},
	)
}

// startBattleProgressSampler emits the battle counter MaaCore writes to its
// trace log while the dynamic MAA task runs. It returns a stop function that
// waits for the sampler goroutine, so the next stage cannot reuse its counter.
func (s *Service) startBattleProgressSampler(ctx context.Context, lifecycle *ExecutionLifecycle, base map[string]any) func() {
	noop := func() {}
	if s == nil || s.battleSampler == nil || lifecycle == nil || lifecycle.OnProgress == nil || !BattleProgressEnabled() {
		return noop
	}
	interval := s.battleInterval
	if interval <= 0 {
		interval = BattleProgressInterval()
	}
	checkpoint := s.battleSampler.Checkpoint(ctx)
	sampleCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		lastKills, lastTotal := -1, -1
		sample := func() {
			if sampleCtx.Err() != nil {
				return
			}
			battle, err := s.battleSampler.SampleBattleProgress(sampleCtx, checkpoint, nil)
			if err != nil || battle == nil {
				return
			}
			// A new stage can reuse the previous stage's enemy total, so the
			// pair is compared as a whole; a reset to 0 / total is a real
			// update, not a stale frame.
			if battle.Kills == lastKills && battle.Total == lastTotal {
				return
			}
			lastKills, lastTotal = battle.Kills, battle.Total
			progress := make(map[string]any, len(base)+1)
			for key, value := range base {
				progress[key] = value
			}
			progress["battle"] = map[string]any{"kills": battle.Kills, "total": battle.Total}
			lifecycle.OnProgress(progress, nil)
		}
		sample()
		for {
			select {
			case <-sampleCtx.Done():
				return
			case <-ticker.C:
				sample()
			}
		}
	}()
	return func() {
		cancel()
		<-done
	}
}

func emitExecutionProgress(lifecycle *ExecutionLifecycle, tracker *ProgressTracker, progress map[string]any) {
	if lifecycle == nil || lifecycle.OnProgress == nil {
		return
	}
	lifecycle.OnProgress(progress, tracker.Snapshot())
}

func progressFailurePhase(stopped bool) string {
	if stopped {
		return "stopping"
	}
	return "failed"
}

func trackerForLifecycle(lifecycle *ExecutionLifecycle, entries []PlanEntry) *ProgressTracker {
	if lifecycle == nil || lifecycle.RunID == "" {
		return nil
	}
	return NewProgressTracker(entries)
}

func selectPlanEntries(entries []PlanEntry, indexes []int) []PlanEntry {
	selected := make([]PlanEntry, 0, len(entries))
	if len(indexes) == 0 {
		return append(selected, entries...)
	}
	wanted := make(map[int]struct{}, len(indexes))
	for _, index := range indexes {
		wanted[index] = struct{}{}
	}
	for _, entry := range entries {
		if _, ok := wanted[entry.ItemIndex]; ok {
			selected = append(selected, entry)
		}
	}
	return selected
}

func executablePlanEntries(entries []PlanEntry) []PlanEntry {
	result := make([]PlanEntry, 0, len(entries))
	for _, entry := range entries {
		if strings.TrimSpace(entry.DisplayStage) == "" {
			continue
		}
		result = append(result, entry)
	}
	return result
}

func pendingPlanEntries(entries []PlanEntry, completed map[string]struct{}) []PlanEntry {
	result := make([]PlanEntry, 0, len(entries))
	for _, entry := range entries {
		if _, done := completed[progressEntryKey(entry)]; done {
			continue
		}
		result = append(result, entry)
	}
	return result
}

func entryKeys(entries []PlanEntry) []string {
	keys := make([]string, 0, len(entries))
	for _, entry := range entries {
		keys = append(keys, progressEntryKey(entry))
	}
	return keys
}

func progressSet(keys []string) map[string]struct{} {
	set := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		set[key] = struct{}{}
	}
	return set
}

func sortedSetKeys(set map[string]struct{}) []string {
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func intSliceToAny(values []int) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func planItemCount(plan *Plan) int {
	if len(plan.Items) > 0 {
		return len(plan.Items)
	}
	return len(plan.Entries)
}

func planHasPresetFormation(plan *Plan) bool {
	for _, item := range plan.Items {
		if item.PresetFormation {
			return true
		}
	}
	for _, entry := range plan.Entries {
		if entry.PresetFormation {
			return true
		}
	}
	return false
}

func optionPreTasks(options map[string]any) []any {
	if options == nil {
		return nil
	}
	return asArray(options["preTasks"])
}

func optionString(options map[string]any, key string) string {
	if options == nil {
		return ""
	}
	return jsStringTruthyOrEmpty(options[key])
}

func optionBool(options map[string]any, key string, fallback bool) bool {
	if options == nil {
		return fallback
	}
	value, exists := options[key]
	if !exists {
		return fallback
	}
	if parsed, ok := value.(bool); ok {
		return parsed
	}
	return fallback
}

func executionClientType(options map[string]any) string {
	if value := optionString(options, "clientType"); value != "" {
		return value
	}
	return optionString(options, "client_type")
}
