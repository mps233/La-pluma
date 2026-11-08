package app

import (
	"context"
	"encoding/base64"
	"time"

	maaapp "github.com/mps233/la-pluma/go/internal/app/maa"
	"github.com/mps233/la-pluma/go/internal/app/notifications"
	"github.com/mps233/la-pluma/go/internal/app/scheduler"
)

// telegramCommandHandler adapts the app services to the Telegram bot's narrow
// command surface. Bot commands are ordinary Agent runs; flow commands are
// wrapped by trackedFlowWrapper so cron, HTTP and Telegram share one lifecycle.
type telegramCommandHandler struct{ app *App }

func (h telegramCommandHandler) TaskStatus(_ context.Context) notifications.TaskStatus {
	task := h.app.TaskStatus()
	schedule := h.app.Scheduler.ExecutionStatus()
	status := notifications.TaskStatus{
		IsRunning: task.IsRunning || schedule.IsRunning,
		TaskName:  task.TaskName,
	}
	if schedule.IsRunning && schedule.CurrentTask != nil && *schedule.CurrentTask != "" {
		status.TaskName = *schedule.CurrentTask
	}
	if schedule.StartTime != nil {
		status.StartTime = schedule.StartTime
	} else if current, ok := h.app.CurrentRun(); ok && current.StartedAt != nil {
		if parsed, err := time.Parse(time.RFC3339, *current.StartedAt); err == nil {
			value := parsed.UnixMilli()
			status.StartTime = &value
		}
	}
	return status
}

func (h telegramCommandHandler) StopTask(ctx context.Context) notifications.StopResult {
	outcome := h.app.MAAService.StopCurrent(ctx)
	scheduleStopped := h.app.Scheduler.Stop(ctx)
	result := notifications.StopResult{Success: outcome.Success || scheduleStopped, Message: outcome.Message}
	if scheduleStopped && !outcome.Success {
		result.Message = "已终止任务流程"
	}
	return result
}

func (h telegramCommandHandler) ExecuteTask(ctx context.Context, request notifications.TaskRequest) error {
	_, _, err := h.app.MAAService.Run(ctx, maaapp.RunRequest{
		OperationID: "run_task",
		Command:     request.Command,
		Args:        request.Args,
		TaskName:    request.TaskName,
		TaskType:    request.TaskType,
		Wait:        false,
		Input:       map[string]any{"command": request.Command, "args": request.Args, "source": "telegram"},
		Metadata:    map[string]any{"taskName": request.TaskName, "taskType": request.TaskType},
	})
	return err
}

func (h telegramCommandHandler) CaptureScreenshot(ctx context.Context) (string, error) {
	image, err := h.app.WebRTC.Screenshot(ctx)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(image), nil
}

func (h telegramCommandHandler) ScheduleStatus(_ context.Context) notifications.ScheduleStatus {
	status := h.app.Scheduler.ExecutionStatus()
	out := notifications.ScheduleStatus{
		IsRunning:   status.IsRunning,
		CurrentStep: status.CurrentStep,
		TotalSteps:  status.TotalSteps,
		StartTime:   status.StartTime,
	}
	if status.ScheduleID != nil {
		out.ScheduleID = *status.ScheduleID
	}
	if status.CurrentTask != nil {
		out.CurrentTask = *status.CurrentTask
	}
	return out
}

func (h telegramCommandHandler) RunFlow(_ context.Context, flowType string, tasks []map[string]any) error {
	scheduleID := "bot-" + flowType
	flow := make([]any, len(tasks))
	for index, task := range tasks {
		flow[index] = task
	}
	wrapper := trackedFlowWrapper{runs: h.app.Runs}
	go func() {
		result := wrapper.WrapDailyFlow(context.Background(), scheduleID, func(ctx context.Context) scheduler.DailyFlowResult {
			return h.app.Scheduler.StartDailyFlow(ctx, scheduler.DailyFlowRequest{ScheduleID: scheduleID, TaskFlow: flow})
		})
		if !result.Success {
			h.app.logger.Warn("Telegram 流程执行失败", "flowType", flowType, "message", result.Message)
		}
	}()
	return nil
}
