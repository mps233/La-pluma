package app

import (
	"context"
	"log/slog"
	"os"

	"github.com/mps233/la-pluma/go/internal/app/drops"
	maaapp "github.com/mps233/la-pluma/go/internal/app/maa"
	"github.com/mps233/la-pluma/go/internal/app/scheduler"
	"github.com/mps233/la-pluma/go/internal/app/training"
	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
)

type maaExecutor struct{ service *maaapp.Service }

func (e maaExecutor) RunTask(ctx context.Context, taskConfig map[string]any, wait bool) (domainrun.DTO, error) {
	run, _, err := e.service.RunTask(ctx, taskConfig, wait, nil)
	return run, err
}

func (e maaExecutor) RunCommand(ctx context.Context, command string, args []string, taskName, taskType string, wait bool) (domainrun.DTO, error) {
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

func (e maaExecutor) Stop(ctx context.Context) error { return e.service.Stop(ctx) }

type dropsRecorder struct{ service *drops.Service }

func (r dropsRecorder) RecordDrops(payload any) error {
	_, err := r.service.RecordDrops(payload)
	return err
}

type trainingStageChecker struct{ service *training.Service }

func (c trainingStageChecker) IsStageOpen(stage, clientType string) (bool, string) {
	return c.service.IsStageOpen(stage, clientType)
}

func newScheduler(cfg config.Config, logger *slog.Logger, executor *maaapp.Service, dropService *drops.Service, trainingService *training.Service, configSource scheduler.ConfigSource) *scheduler.Service {
	defaults := scheduler.ConnectionDefaults{
		ADBPath:    os.Getenv("ADB_PATH"),
		Address:    os.Getenv("ADB_ADDRESS"),
		ClientType: os.Getenv("MAA_CLIENT_TYPE"),
	}
	service := scheduler.New(maaExecutor{service: executor}, cfg.Paths, scheduler.Options{
		Logger:             logger,
		ConfigSource:       configSource,
		ConnectionDefaults: defaults,
		DropRecorder:       dropsRecorder{service: dropService},
		StageOpenChecker:   trainingStageChecker{service: trainingService},
	})
	service.RestoreFromConfig()
	return service
}
