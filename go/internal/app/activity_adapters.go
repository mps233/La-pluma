package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/mps233/la-pluma/go/internal/app/activity"
	"github.com/mps233/la-pluma/go/internal/app/copilot"
	"github.com/mps233/la-pluma/go/internal/config"
)

type activityPlanProvider struct{ service *copilot.Service }

func (p activityPlanProvider) BuildPlan(ctx context.Context, setId, raid string) (activity.Plan, error) {
	if p.service == nil {
		return activity.Plan{}, errDependency("ACTIVITY_PLAN_PROVIDER_UNAVAILABLE", "作业计划服务未接入")
	}
	plan, err := p.service.BuildPlan(ctx, setId, raid)
	if err != nil {
		return activity.Plan{}, err
	}
	var converted activity.Plan
	if err := convertJSON(plan, &converted); err != nil {
		return activity.Plan{}, err
	}
	return converted, nil
}

type activityPlanExecutor struct{ service *copilot.Service }

func (e activityPlanExecutor) ExecutePlan(ctx context.Context, request activity.PlanExecution) (*activity.ExecutionResult, error) {
	if e.service == nil {
		return nil, errDependency("ACTIVITY_PLAN_EXECUTOR_UNAVAILABLE", "作业执行服务未接入")
	}
	converted := copilot.PlanExecution{
		SetID:           request.SetID,
		Raid:            request.Raid,
		SelectedIndexes: request.SelectedIndexes,
		Options:         request.Options,
	}
	if request.Lifecycle != nil {
		converted.Lifecycle = &copilot.ExecutionLifecycle{
			RunID:     request.Lifecycle.RunID,
			OnStarted: request.Lifecycle.OnStarted,
			OnProgress: func(progress map[string]any, taskResults []copilot.ProgressEntryResult) {
				var values []any
				_ = convertJSON(taskResults, &values)
				request.Lifecycle.OnProgress(progress, values)
			},
		}
	}
	result, err := e.service.ExecutePlan(ctx, converted)
	if result == nil {
		return nil, err
	}
	var output activity.ExecutionResult
	if err := convertJSON(map[string]any{"results": result.Results, "data": result.Data}, &output); err != nil {
		return nil, err
	}
	if output.Data == nil {
		output.Data = result.Data
	}
	return &output, err
}

func (e activityPlanExecutor) ExecuteSelectedEntries(ctx context.Context, request activity.EntriesExecution) (*activity.ExecutionResult, error) {
	if e.service == nil {
		return nil, errDependency("ACTIVITY_PLAN_EXECUTOR_UNAVAILABLE", "作业执行服务未接入")
	}
	var entries []copilot.PlanEntry
	if err := convertJSON(request.Entries, &entries); err != nil {
		return nil, err
	}
	converted := copilot.EntriesExecution{
		PlanID:  request.PlanID,
		Name:    request.Name,
		Entries: entries,
		Options: request.Options,
	}
	if request.Lifecycle != nil {
		converted.Lifecycle = &copilot.ExecutionLifecycle{
			RunID:     request.Lifecycle.RunID,
			OnStarted: request.Lifecycle.OnStarted,
			OnProgress: func(progress map[string]any, taskResults []copilot.ProgressEntryResult) {
				var values []any
				_ = convertJSON(taskResults, &values)
				request.Lifecycle.OnProgress(progress, values)
			},
		}
	}
	result, err := e.service.ExecuteSelectedEntries(ctx, converted)
	if result == nil {
		return nil, err
	}
	var output activity.ExecutionResult
	if err := convertJSON(map[string]any{"results": result.Results, "data": result.Data}, &output); err != nil {
		return nil, err
	}
	if output.Data == nil {
		output.Data = result.Data
	}
	return &output, err
}

type activityCurrentMapPreparer struct{}

func (activityCurrentMapPreparer) EnsureCurrentMapActivityResource(ctx context.Context, configDir, activityCode string, stages []string) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	values := make([]any, 0, len(stages))
	for _, stage := range stages {
		values = append(values, stage)
	}
	return copilot.EnsureCurrentMapActivityResource(configDir, activityCode, values)
}

// activityLeaseRunner keeps the activity run API's lease contract without
// double-locking: each underlying MAA task already takes the shared lease in
// the MAA adapter. Cross-task interleaving remains possible, but no task can
// overlap another device operation.
type activityLeaseRunner struct{}

func (activityLeaseRunner) Run(ctx context.Context, _ activity.LeaseRequest, fn func(context.Context) error) error {
	return fn(ctx)
}

type activityNavigationLog struct{ path string }

func (l activityNavigationLog) Checkpoint(ctx context.Context) string {
	info, err := os.Stat(l.path)
	if err != nil {
		return ""
	}
	return filepath.Clean(l.path) + "|" + formatInt64(info.Size())
}

func (l activityNavigationLog) ReadSince(ctx context.Context, checkpoint string) string {
	if checkpoint == "" {
		return ""
	}
	offset, ok := parseCheckpointOffset(checkpoint)
	if !ok {
		return ""
	}
	file, err := os.Open(l.path)
	if err != nil {
		return ""
	}
	defer file.Close()
	if _, err := file.Seek(offset, 0); err != nil {
		return ""
	}
	buffer := make([]byte, 4*1024*1024)
	n, _ := file.Read(buffer)
	return string(buffer[:n])
}

func newActivityNavigationLog(paths config.Paths) activityNavigationLog {
	return activityNavigationLog{path: filepath.Join(paths.MaaStateDir, "debug", "asst.log")}
}

func convertJSON(source, target any) error {
	data, err := json.Marshal(source)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func errDependency(code, message string) error {
	return &dependencyErrorType{code: code, message: message}
}

type dependencyErrorType struct{ code, message string }

func (e *dependencyErrorType) Error() string { return e.message }

func formatInt64(value int64) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	digits := make([]byte, 0, 20)
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	if negative {
		return "-" + string(digits)
	}
	return string(digits)
}

func parseCheckpointOffset(checkpoint string) (int64, bool) {
	index := len(checkpoint) - 1
	for index >= 0 && checkpoint[index] != '|' {
		index--
	}
	if index < 0 || index+1 >= len(checkpoint) {
		return 0, false
	}
	var value int64
	for _, char := range checkpoint[index+1:] {
		if char < '0' || char > '9' {
			return 0, false
		}
		value = value*10 + int64(char-'0')
	}
	return value, true
}
