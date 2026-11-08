package app

import (
	"context"
	"log/slog"
	"os"
	"strings"

	"github.com/mps233/la-pluma/go/internal/app/drops"
	maaapp "github.com/mps233/la-pluma/go/internal/app/maa"
	"github.com/mps233/la-pluma/go/internal/app/scheduler"
	"github.com/mps233/la-pluma/go/internal/app/training"
	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
)

type maaServiceAdapter struct{ service *maaapp.Service }

func (e maaServiceAdapter) RunTask(ctx context.Context, taskConfig map[string]any, wait bool) (domainrun.DTO, error) {
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
			address := os.Getenv("ADB_ADDRESS")
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
	run, _, err := e.service.RunTask(ctx, taskConfig, wait, nil)
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

func newScheduler(cfg config.Config, logger *slog.Logger, executor *maaapp.Service, dropService *drops.Service, trainingService *training.Service, configSource scheduler.ConfigSource, autoUpdater scheduler.AutoUpdater) *scheduler.Service {
	defaults := scheduler.ConnectionDefaults{
		ADBPath:    os.Getenv("ADB_PATH"),
		Address:    os.Getenv("ADB_ADDRESS"),
		ClientType: os.Getenv("MAA_CLIENT_TYPE"),
	}
	service := scheduler.New(maaServiceAdapter{service: executor}, cfg.Paths, scheduler.Options{
		Logger:             logger,
		ConfigSource:       configSource,
		ConnectionDefaults: defaults,
		DropRecorder:       dropsRecorder{service: dropService},
		StageOpenChecker:   trainingStageChecker{service: trainingService},
		AutoUpdater:        autoUpdater,
	})
	service.RestoreFromConfig()
	return service
}
