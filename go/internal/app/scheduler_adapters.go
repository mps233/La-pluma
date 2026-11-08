package app

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/mps233/la-pluma/go/internal/app/activity"
	runapp "github.com/mps233/la-pluma/go/internal/app/agentrun"
	configapp "github.com/mps233/la-pluma/go/internal/app/config"
	"github.com/mps233/la-pluma/go/internal/app/drops"
	maaapp "github.com/mps233/la-pluma/go/internal/app/maa"
	"github.com/mps233/la-pluma/go/internal/app/notifications"
	"github.com/mps233/la-pluma/go/internal/app/recognition"
	"github.com/mps233/la-pluma/go/internal/app/scheduler"
	"github.com/mps233/la-pluma/go/internal/app/training"
	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	"github.com/mps233/la-pluma/go/internal/infra/adb"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

var hdStagePattern = regexp.MustCompile(`(?i)^hd-(\d+)$`)
var foregroundPackagePattern = regexp.MustCompile(`\s([A-Za-z0-9_.]+)/[A-Za-z0-9_.$]+`)

var gamePackages = map[string]string{
	"Official": "com.hypergryph.arknights",
	"Bilibili": "com.hypergryph.arknights.bilibili",
}

type adbDeviceProbe struct{}

func (adbDeviceProbe) TestConnection(ctx context.Context, adbPath, address string) error {
	client := adb.New(adbPath)
	devices, err := client.Devices(ctx)
	if err != nil {
		return err
	}
	connected := func(items []adb.Device) bool {
		for _, device := range items {
			if device.Serial == address && device.State == "device" {
				return true
			}
		}
		return false
	}
	if connected(devices) {
		return nil
	}
	if strings.Contains(address, ":") {
		_, _ = client.Connect(ctx, address)
		devices, err = client.Devices(ctx)
		if err != nil {
			return err
		}
		if connected(devices) {
			return nil
		}
	}
	return fmt.Errorf("模拟器未连接：%s", address)
}

func (adbDeviceProbe) GameForeground(ctx context.Context, adbPath, address, clientType string) (bool, string, error) {
	output, err := adb.New(adbPath).Shell(ctx, address, "dumpsys", "window")
	if err != nil {
		return false, "", err
	}
	foreground := ""
	for _, line := range strings.Split(output, "\n") {
		if !strings.Contains(line, "mCurrentFocus") && !strings.Contains(line, "mFocusedApp") {
			continue
		}
		match := foregroundPackagePattern.FindStringSubmatch(line)
		if len(match) == 2 {
			foreground = match[1]
			break
		}
	}
	expected := gamePackages[clientType]
	if expected == "" {
		expected = gamePackages["Official"]
	}
	return foreground == expected, foreground, nil
}

func (adbDeviceProbe) CaptureScreen(ctx context.Context, adbPath, address string) error {
	_, err := adb.New(adbPath).Screenshot(ctx, address)
	return err
}

func replaceActivityCode(service *activity.Service, stage, clientType string) string {
	match := hdStagePattern.FindStringSubmatch(strings.TrimSpace(stage))
	if len(match) != 2 || service == nil {
		return stage
	}
	info, err := service.GetStageActivityInfo(context.Background(), clientType, time.Now())
	if err != nil || info == nil || strings.TrimSpace(info.Code) == "" {
		return stage
	}
	return strings.TrimSpace(info.Code) + "-" + match[1]
}

type taskCompletionNotifier struct{ service *notifications.Service }

func (n taskCompletionNotifier) Notify(ctx context.Context, scheduleID string, summary *scheduler.ExecutionSummary) error {
	if n.service == nil || summary == nil {
		return nil
	}
	if config := n.service.GetConfig(); !config.Enabled {
		return nil
	}
	info := notifications.TaskInfo{
		TaskName:     "定时任务 " + scheduleID,
		TotalTasks:   summary.SuccessCount + summary.FailedCount + summary.SkippedCount,
		SuccessTasks: summary.SuccessCount,
		FailedTasks:  summary.FailedCount,
		SkippedTasks: summary.SkippedCount,
		Duration:     float64(summary.DurationMS),
	}
	for _, item := range summary.Errors {
		info.Errors = append(info.Errors, map[string]any{"task": item.Task, "error": item.Error})
	}
	for _, item := range summary.Summaries {
		entry := notifications.TaskSummary{
			Task: item.Task, Stage: item.Stage, Times: item.Times, Duration: item.Duration,
			Medicine: item.Medicine, Stone: item.Stone, Drops: item.Drops, Infrast: item.Infrast,
		}
		for _, recruit := range item.Recruits {
			tags := ""
			if value, ok := recruit.Tags.(string); ok {
				tags = value
			} else if recruit.Tags != nil {
				tags = fmt.Sprint(recruit.Tags)
			}
			entry.Recruits = append(entry.Recruits, notifications.TaskRecruit{Tags: tags, Stars: recruit.Stars})
		}
		info.Summaries = append(info.Summaries, entry)
	}
	for _, item := range summary.Actions {
		info.Actions = append(info.Actions, notifications.TaskAction{Task: item.Task, Status: item.Status, Message: item.Message})
	}
	for _, item := range summary.Reports {
		info.Reports = append(info.Reports, notifications.TaskReport{Status: item.Status, Provider: item.Provider, Message: item.Message})
	}
	for _, warning := range summary.Warnings {
		info.Warnings = append(info.Warnings, warning)
	}
	result := n.service.SendTaskCompletion(ctx, info)
	if !result.Success {
		message := result.Message
		if message == "" {
			message = "任务完成通知发送失败"
		}
		return apperrors.New("NOTIFICATION_SEND_FAILED", message)
	}
	return nil
}

type trainingSmartStagesUpdater struct{ service *training.Service }

func (u trainingSmartStagesUpdater) UpdateSmartTrainingStages() error {
	if u.service == nil {
		return apperrors.New("TRAINING_UNAVAILABLE", "养成服务未接入")
	}
	return u.service.UpdateSmartTrainingStages()
}

type depotRecognizerAdapter struct{ service *recognition.Service }

func (a depotRecognizerAdapter) RecognizeDepot(ctx context.Context) error {
	if a.service == nil {
		return apperrors.New("RECOGNITION_UNAVAILABLE", "仓库识别服务未接入")
	}
	_, err := a.service.RecognizeDepot(ctx)
	return err
}

type trackedFlowWrapper struct{ runs *runapp.Service }

// WrapDailyFlow gives cron-triggered flows the same outer run lifecycle as an
// HTTP invocation. MAA commands attach to this run through the context parent.
func (w trackedFlowWrapper) WrapDailyFlow(ctx context.Context, scheduleID string, run func(context.Context) scheduler.DailyFlowResult) scheduler.DailyFlowResult {
	outer, _, err := w.runs.Begin(runapp.BeginInput{
		OperationID: "run_daily_flow",
		Input:       map[string]any{"scheduleId": scheduleID},
		Metadata:    map[string]any{"taskName": "今日流程 " + scheduleID, "taskType": "schedule"},
		Trigger:     map[string]any{"type": "schedule", "scheduleId": scheduleID, "source": "cron"},
	})
	if err != nil {
		return scheduler.DailyFlowResult{Success: false, Message: err.Error(), ScheduleID: scheduleID}
	}
	if _, err := w.runs.StartForExecution(outer.RunID); err != nil {
		_, _ = w.runs.Fail(outer.RunID, err)
		return scheduler.DailyFlowResult{Success: false, Message: err.Error(), ScheduleID: scheduleID}
	}
	result := run(runapp.WithParentRun(ctx, outer.RunID))
	result.RunID = outer.RunID
	switch {
	case result.Stopped:
		_, _ = w.runs.Stop(outer.RunID, result)
	case !result.Success:
		code := "AGENT_DAILY_FLOW_REJECTED"
		status := 400
		if result.Busy {
			code = "AGENT_SCHEDULE_ALREADY_RUNNING"
			status = 409
		}
		_, _ = w.runs.Fail(outer.RunID, apperrors.WithStatus(code, result.Message, status, result.Busy, map[string]any{"scheduleId": result.ScheduleID}))
	default:
		_, _ = w.runs.Complete(outer.RunID, result)
	}
	return result
}

type maaServiceAdapter struct{ service *maaapp.Service }

func (e maaServiceAdapter) RunTask(ctx context.Context, taskConfig map[string]any, wait bool) (domainrun.DTO, error) {
	address, _ := taskConfig["address"].(string)
	// A standalone StartUp task must use maa's dedicated startup command: the
	// dynamic StartUp task assumes the game is already running, while the
	// command can launch a closed client.
	if taskType, _ := taskConfig["type"].(string); taskType == "StartUp" {
		params, _ := taskConfig["params"].(map[string]any)
		startGame := true
		if value, ok := params["start_game_enabled"].(bool); ok {
			startGame = value
		}
		if startGame {
			clientType, _ := taskConfig["client_type"].(string)
			if clientType == "" {
				clientType = "Official"
			}
			if strings.TrimSpace(address) == "" {
				address = os.Getenv("ADB_ADDRESS")
			}
			if strings.TrimSpace(address) == "" {
				address = "127.0.0.1:16384"
			}
			run, _, err := e.service.Run(ctx, maaapp.RunRequest{
				OperationID: "run_task",
				Command:     "startup",
				Args:        []string{clientType, "--addr", address},
				TaskName:    "启动游戏",
				TaskType:    "StartUp",
				Wait:        wait,
				Input:       taskConfig,
				Metadata:    map[string]any{"taskName": "启动游戏", "taskType": "StartUp"},
			})
			return run, err
		}
	}
	run, _, err := e.service.RunTaskWithOptions(ctx, taskConfig, wait, nil, maaapp.RunTaskOptions{Address: address})
	return run, err
}

func (e maaServiceAdapter) RunCommand(ctx context.Context, command string, args []string, taskName, taskType string, wait bool) (domainrun.DTO, error) {
	run, _, err := e.service.Run(ctx, maaapp.RunRequest{
		OperationID: "run_task",
		Command:     command,
		Args:        args,
		TaskName:    taskName,
		TaskType:    taskType,
		Wait:        wait,
		Input:       map[string]any{"command": command, "args": args},
		Metadata:    map[string]any{"taskName": taskName, "taskType": taskType},
	})
	return run, err
}

// RunCommandUntracked implements the updates metadata query path. It avoids a
// new Agent run for commands such as `maa version`.
func (e maaServiceAdapter) RunCommandUntracked(ctx context.Context, command string, args []string) (domainrun.DTO, error) {
	result, err := e.service.QueryCommand(ctx, command, args)
	if err != nil {
		return domainrun.DTO{}, err
	}
	return domainrun.DTO{Result: map[string]any{
		"stdout":   result.Stdout,
		"stderr":   result.Stderr,
		"exitCode": result.ExitCode,
	}}, nil
}

func (e maaServiceAdapter) Stop(ctx context.Context) error { return e.service.Stop(ctx) }

type dropsRecorder struct{ service *drops.Service }

func (r dropsRecorder) RecordDrops(payload any) error {
	_, err := r.service.RecordDrops(payload)
	return err
}

type trainingStageChecker struct{ service *training.Service }

func (c trainingStageChecker) IsStageOpen(stage, clientType string) (bool, string) {
	return c.service.IsStageOpen(stage, clientType)
}

func newScheduler(cfg config.Config, logger *slog.Logger, runs *runapp.Service, executor *maaapp.Service, dropService *drops.Service, trainingService *training.Service, activityService *activity.Service, recognitionService *recognition.Service, notificationService *notifications.Service, configSource scheduler.ConfigSource, autoUpdater scheduler.AutoUpdater) *scheduler.Service {
	profiles := configapp.NewProfiles(cfg.Paths.MaaConfigDir)
	profile, _ := profiles.Load(configapp.DefaultProfileName)
	resolved, _ := configapp.ResolveConnection(profile, nil)
	defaults := scheduler.ConnectionDefaults{
		ADBPath:    resolved.ADBPath,
		Address:    resolved.Address,
		ClientType: resolved.ClientType,
	}
	service := scheduler.New(maaServiceAdapter{service: executor}, cfg.Paths, scheduler.Options{
		Logger:             logger,
		ConfigSource:       configSource,
		ConnectionDefaults: defaults,
		DropRecorder:       dropsRecorder{service: dropService},
		StageOpenChecker:   trainingStageChecker{service: trainingService},
		AutoUpdater:        autoUpdater,
		WrapDailyFlow:      trackedFlowWrapper{runs: runs}.WrapDailyFlow,
		ResolveStage: func(stage, clientType string) string {
			return replaceActivityCode(activityService, stage, clientType)
		},
		DepotRecognizer:    depotRecognizerAdapter{service: recognitionService},
		SmartStagesUpdater: trainingSmartStagesUpdater{service: trainingService},
	})
	service.RestoreFromConfig()
	return service
}
