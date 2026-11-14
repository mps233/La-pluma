package app

import (
	"context"
	"log/slog"
	"strconv"

	runapp "github.com/mps233/la-pluma/go/internal/app/agentrun"
	"github.com/mps233/la-pluma/go/internal/app/scheduler"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// scheduleResumeOperations are the Run operations that run a saved task flow.
// A restart can continue these because the flow is a list of independent MAA
// commands; each one either completed (and is in TaskResults) or did not start.
var scheduleResumeOperations = map[string]struct{}{
	"execute_schedule": {},
	"run_daily_flow":   {},
}

// ResumeInterruptedFlows continues the latest scheduled flow that a restart cut
// off at a task boundary. It starts the continuation as a new Run linked to the
// interrupted one, so the island, status polling and history all keep working.
//
// A task that was in flight is re-run from its start: its partial MAA work
// cannot be adopted, and skipping it would silently drop the task. Completed
// tasks are seeded into the new Run and are never executed again.
func (a *App) ResumeInterruptedFlows(ctx context.Context, logger *slog.Logger) int {
	if a == nil || a.Runs == nil || a.Scheduler == nil {
		return 0
	}
	if logger == nil {
		logger = a.logger
	}
	if ctx != nil && ctx.Err() != nil {
		return 0
	}
	candidates := a.Runs.ResumeCandidates()
	if len(candidates) == 0 {
		return 0
	}

	// The newest interrupted operation is the task the user was actually
	// running. If it is not a flow we can safely continue, do not reach back
	// and resume an older, unrelated flow.
	chosen := &candidates[len(candidates)-1]
	if _, ok := scheduleResumeOperations[chosen.OperationID]; !ok {
		logger.Info("interrupted operation is not resumable", "runId", chosen.RunID, "operationId", chosen.OperationID)
		return 0
	}

	plan, ok := resumePlanFor(*chosen)
	if !ok {
		_ = a.Runs.MarkResumeSkipped(chosen.RunID, plan.reason)
		return 0
	}
	for index := range candidates {
		candidate := &candidates[index]
		if candidate.RunID == chosen.RunID {
			continue
		}
		if _, ok := scheduleResumeOperations[candidate.OperationID]; ok {
			_ = a.Runs.MarkResumeSkipped(candidate.RunID, "superseded")
		}
	}

	newRun, err := a.startResumedFlow(*chosen, plan)
	if err != nil {
		logger.Error("resume interrupted flow failed", "runId", chosen.RunID, "error", err.Error())
		return 0
	}
	if err := a.Runs.MarkResumed(chosen.RunID, newRun.RunID); err != nil {
		_, _ = a.Runs.Fail(newRun.RunID, err)
		logger.Error("mark interrupted flow resumed failed", "runId", chosen.RunID, "error", err.Error())
		return 0
	}
	logger.Info("resuming interrupted schedule flow",
		"runId", chosen.RunID,
		"newRunId", newRun.RunID,
		"scheduleId", plan.scheduleID,
		"fromStep", plan.nextStep+1,
		"totalSteps", plan.totalSteps,
	)
	return 1
}

type scheduleResumePlan struct {
	scheduleID string
	taskFlow   any
	nextStep   int
	totalSteps int
	reason     string
}

func resumePlanFor(candidate runapp.ResumeCandidate) (scheduleResumePlan, bool) {
	input, ok := candidate.Input.(map[string]any)
	if !ok {
		return scheduleResumePlan{reason: "input_unavailable"}, false
	}
	taskFlow, ok := input["taskFlow"]
	if !ok || taskFlow == nil {
		return scheduleResumePlan{reason: "task_flow_missing"}, false
	}
	if validation := scheduler.ValidateScheduledTaskFlow(taskFlow); !validation.Success {
		return scheduleResumePlan{reason: "task_flow_invalid"}, false
	}
	scheduleID, _ := input["scheduleId"].(string)
	if scheduleID == "" {
		scheduleID = "default"
	}
	totalSteps := scheduler.EnabledTaskCount(taskFlow)
	if totalSteps == 0 {
		return scheduleResumePlan{reason: "task_flow_empty"}, false
	}
	nextStep, resumable := nextResumeStep(candidate, totalSteps)
	if !resumable {
		return scheduleResumePlan{reason: "flow_already_finished"}, false
	}
	return scheduleResumePlan{
		scheduleID: scheduleID,
		taskFlow:   taskFlow,
		nextStep:   nextStep,
		totalSteps: totalSteps,
	}, true
}

// nextResumeStep uses the completed task count and the scheduler's persisted
// currentStep. currentStep is one-based in the Run progress; using the larger
// value skips every task that already reported a terminal result.
func nextResumeStep(candidate runapp.ResumeCandidate, totalSteps int) (int, bool) {
	completed := terminalResultCount(candidate.TaskResults)
	next := completed
	if progress, ok := candidate.Progress.(map[string]any); ok {
		if step, ok := numberValue(progress["currentStep"]); ok && step > 0 {
			inProgress := int(step) - 1
			if inProgress > next {
				next = inProgress
			}
		}
	}
	if startupFailed(candidate.TaskResults) {
		next = 0
	}
	if next < 0 {
		next = 0
	}
	if next >= totalSteps {
		return 0, false
	}
	return next, true
}

func terminalResultCount(results []any) int {
	count := 0
	for _, result := range results {
		entry, ok := result.(map[string]any)
		if !ok {
			continue
		}
		state := resultState(entry)
		if state == "" || state == "running" || state == "pending" || state == "accepted" {
			continue
		}
		count++
	}
	return count
}

func terminalResults(results []any) []any {
	out := make([]any, 0, len(results))
	for _, result := range results {
		entry, ok := result.(map[string]any)
		if !ok {
			out = append(out, result)
			continue
		}
		state := resultState(entry)
		if state == "running" || state == "pending" || state == "accepted" {
			continue
		}
		out = append(out, result)
	}
	return out
}

func startupFailed(results []any) bool {
	for _, result := range results {
		entry, ok := result.(map[string]any)
		if !ok {
			continue
		}
		name, _ := entry["taskName"].(string)
		if name != "启动游戏" {
			continue
		}
		if resultState(entry) == "failed" {
			return true
		}
	}
	return false
}

func resultState(entry map[string]any) string {
	if state, ok := entry["state"].(string); ok {
		return state
	}
	if state, ok := entry["status"].(string); ok {
		return state
	}
	return ""
}

func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	default:
		return 0, false
	}
}

func (a *App) startResumedFlow(candidate runapp.ResumeCandidate, plan scheduleResumePlan) (domainrun.DTO, error) {
	input := map[string]any{
		"scheduleId":  plan.scheduleID,
		"taskFlow":    plan.taskFlow,
		"resumeFrom":  plan.nextStep,
		"resumedFrom": candidate.RunID,
	}
	metadata := map[string]any{
		"taskName":    "定时任务 " + plan.scheduleID,
		"taskType":    "schedule",
		"resumedFrom": candidate.RunID,
	}
	trigger := map[string]any{"type": "resume", "fromRunId": candidate.RunID}
	progress := map[string]any{
		"currentStep": plan.nextStep + 1,
		"totalSteps":  plan.totalSteps,
		"message":     "继续执行上次任务流程",
		"resumedFrom": candidate.RunID,
	}
	run, _, err := a.Runs.Begin(runapp.BeginInput{
		OperationID: candidate.OperationID,
		Input:       input,
		Metadata:    metadata,
		Trigger:     trigger,
		Progress:    progress,
		TaskResults: terminalResults(candidate.TaskResults),
	})
	if err != nil {
		return domainrun.DTO{}, err
	}
	if _, err := a.Runs.StartForExecution(run.RunID); err != nil {
		_, _ = a.Runs.Fail(run.RunID, err)
		return domainrun.DTO{}, err
	}

	go func() {
		flowCtx := runapp.WithParentRun(context.Background(), run.RunID)
		result := a.Scheduler.StartDailyFlow(flowCtx, scheduler.DailyFlowRequest{
			ScheduleID: plan.scheduleID,
			TaskFlow:   plan.taskFlow,
			ResumeFrom: plan.nextStep,
		})
		current, ok := a.Runs.Get(run.RunID)
		if ok && current.State.Terminal() {
			return
		}
		if result.Summary != nil {
			result.Summary.Warnings = append(result.Summary.Warnings,
				"该流程在服务重启后从第 "+strconv.Itoa(plan.nextStep+1)+" 项继续执行")
		}
		switch {
		case result.Stopped:
			_, _ = a.Runs.Stop(run.RunID, result)
		case !result.Success:
			_, _ = a.Runs.Fail(run.RunID, apperrors.WithStatus("AGENT_RESUME_FAILED", result.Message, 500, true, map[string]any{
				"scheduleId": plan.scheduleID,
				"fromStep":   plan.nextStep + 1,
			}))
		default:
			_, _ = a.Runs.Complete(run.RunID, result)
		}
	}()

	return run, nil
}
