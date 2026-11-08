package app

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/app/activity"
	"github.com/mps233/la-pluma/go/internal/app/agentrun"
	configapp "github.com/mps233/la-pluma/go/internal/app/config"
	"github.com/mps233/la-pluma/go/internal/app/copilot"
	"github.com/mps233/la-pluma/go/internal/app/customtools"
	"github.com/mps233/la-pluma/go/internal/app/drops"
	"github.com/mps233/la-pluma/go/internal/app/execution"
	"github.com/mps233/la-pluma/go/internal/app/logs"
	maaapp "github.com/mps233/la-pluma/go/internal/app/maa"
	"github.com/mps233/la-pluma/go/internal/app/mastery"
	"github.com/mps233/la-pluma/go/internal/app/notifications"
	"github.com/mps233/la-pluma/go/internal/app/quotes"
	"github.com/mps233/la-pluma/go/internal/app/recognition"
	"github.com/mps233/la-pluma/go/internal/app/scheduler"
	"github.com/mps233/la-pluma/go/internal/app/training"
	"github.com/mps233/la-pluma/go/internal/app/updates"
	webrtcapp "github.com/mps233/la-pluma/go/internal/app/webrtc"
	"github.com/mps233/la-pluma/go/internal/config"
	"github.com/mps233/la-pluma/go/internal/infra/assets"
	"github.com/mps233/la-pluma/go/internal/infra/maa"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/instancelock"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

// App is the composition root shared by cmd/server and cmd/desktop. It owns
// the durable run store, the single MAA execution lease and the MAA CLI
// runner. HTTP handlers call these services; desktop bindings do too.
type App struct {
	cfg    config.Config
	logger *slog.Logger

	Runs          *agentrun.Service
	Execution     *execution.Manager
	ConfigStore   *configapp.Storage
	Profiles      *configapp.Profiles
	MAA           *maa.Runner
	MAAService    *maaapp.Service
	Logs          *logs.Service
	Drops         *drops.Service
	Scheduler     *scheduler.Service
	Training      *training.Service
	Activity      *activity.Service
	Copilot       *copilot.Service
	Notifications *notifications.Service
	Quotes        *quotes.Service
	CustomTools   *customtools.Service
	Recognition   *recognition.Service
	Updates       *updates.Service
	Mastery       *mastery.Service
	Assets        *assets.Handler
	WebRTC        *webrtcapp.Service
	Bot           *notifications.Bot

	instanceLock *instancelock.Lock

	startedAt time.Time
	closeOnce sync.Once
}

func New(cfg config.Config, logger *slog.Logger) (*App, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if err := jsonstore.EnsureDir(cfg.Paths.DataDir); err != nil {
		return nil, apperrors.WithStatus("LA_PLUMA_DATA_DIR_FAILED", "无法创建数据目录", 500, false, map[string]any{"path": cfg.Paths.DataDir, "error": err.Error()})
	}
	// The Agent run store is a single-process JSON store. Refuse a second
	// instance on the same data directory instead of racing on its writes.
	instanceLock, err := instancelock.AcquireAs(filepath.Join(cfg.Paths.DataDir, instancelock.FileName), instanceRole())
	if err != nil {
		return nil, err
	}

	runs := agentrun.New(filepath.Join(cfg.Paths.DataDir, "agent-runs.json"), logger)
	if _, err := runs.Initialize(); err != nil {
		// Keep the service closed; Begin fails closed. Surface the error so the
		// caller can decide whether to abort startup.
		logger.Error("agent run store unavailable", "error", err)
	}

	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "la-pluma"
	}
	executionManager := execution.NewManager(filepath.Join(cfg.Paths.DataDir, "maa-execution.lock"), host, logger)
	maaPath := os.Getenv("MAA_CLI_PATH")
	if maaPath == "" {
		maaPath = "maa"
	}
	runner := maa.New(maaPath, logger)
	maaActions := maaapp.NewService(cfg, logger, runner, executionManager, runs)
	logService := logs.New(5000)
	configStore := configapp.NewStorage(cfg.Paths)
	dropService := drops.NewWithOptions(cfg.Paths, drops.Options{
		Materials: func() (map[string]drops.MaterialInfo, error) {
			return drops.LoadMaterials(filepath.Join(cfg.Paths.MaaDataDir, "resource"))
		},
	})
	trainingService := training.NewWithOptions(training.Options{
		Paths:   cfg.Paths,
		Logger:  logger,
		Fetcher: trainingMaterialFetcher{paths: cfg.Paths},
	})
	copilotService := copilot.NewWithOptions(copilot.ServiceOptions{
		Paths:        cfg.Paths,
		Logger:       logger,
		Executor:     maaServiceAdapter{service: maaActions},
		DropRecorder: dropsRecorder{service: dropService},
	})
	activityService := activity.NewWithOptions(activity.Options{
		Paths:              cfg.Paths,
		Logger:             logger,
		ConfigLoader:       configStore,
		Executor:           maaServiceAdapter{service: maaActions},
		PlanProvider:       activityPlanProvider{service: copilotService},
		PlanExecutor:       activityPlanExecutor{service: copilotService},
		CurrentMapPreparer: activityCurrentMapPreparer{},
		LeaseRunner:        activityLeaseRunner{},
		NavigationLog:      newActivityNavigationLog(cfg.Paths),
	})
	quotesService := quotes.New(cfg.Paths, logger)
	customToolsService := customtools.New(cfg.Paths, maaServiceAdapter{service: maaActions})
	recognitionService := recognition.New(recognition.Options{Paths: cfg.Paths, Logger: logger})
	assetsHandler := assets.New(cfg.Paths, assets.Config{Logger: logger})
	notificationService := notifications.New(notifications.Options{Paths: cfg.Paths, Logger: logger})
	if loaded, err := notificationService.Load(); err == nil {
		notificationService.SetConfig(loaded)
	} else {
		logger.Debug("notification config not loaded", "error", err)
	}
	updatesService := updates.NewWithOptions(updates.Options{
		Paths:  cfg.Paths,
		Logger: logger,
		Runner: maaServiceAdapter{service: maaActions},
	})
	schedulerService := newScheduler(cfg, logger, runs, maaActions, dropService, trainingService, activityService, recognitionService, notificationService, configStore, updatesAutoUpdater{service: updatesService})
	masteryService := newMasteryService(cfg, logger, maaServiceAdapter{service: maaActions}, executionManager, notificationService)
	profiles := configapp.NewProfiles(cfg.Paths.MaaConfigDir)
	maaActions.SetLineHandler(func(stream, line string) {
		runID, operationID := "", ""
		if current, ok := runs.Current(); ok {
			runID = current.RunID
			operationID = current.OperationID
		}
		logService.AppendLineWithRun(stream, line, runID, operationID)
	})

	application := &App{
		cfg:           cfg,
		logger:        logger,
		Runs:          runs,
		Execution:     executionManager,
		ConfigStore:   configStore,
		Profiles:      profiles,
		MAA:           runner,
		MAAService:    maaActions,
		Logs:          logService,
		Drops:         dropService,
		Scheduler:     schedulerService,
		Training:      trainingService,
		Activity:      activityService,
		Copilot:       copilotService,
		Notifications: notificationService,
		Quotes:        quotesService,
		CustomTools:   customToolsService,
		Recognition:   recognitionService,
		Updates:       updatesService,
		Mastery:       masteryService,
		Assets:        assetsHandler,
		WebRTC:        webrtcapp.New(cfg, logger),
		instanceLock:  instanceLock,
		startedAt:     time.Now(),
	}
	application.Bot = notifications.NewBot(notifications.BotOptions{
		Paths:   cfg.Paths,
		Logger:  logger,
		Handler: telegramCommandHandler{app: application},
	})
	if err := application.ConfigureTelegramBot(context.Background(), notificationService.GetConfig()); err != nil {
		logger.Warn("Telegram Bot 启动失败", "error", err)
	}
	return application, nil
}

// ConfigureTelegramBot applies the notification config and starts or stops the
// inbound bot. The bot is optional; incomplete/disabled config never polls.
func (a *App) ConfigureTelegramBot(ctx context.Context, config notifications.Config) error {
	if a.Bot == nil {
		return nil
	}
	botConfig := notifications.BotConfigFromChannel(config.Channels["telegram"])
	if !config.Enabled {
		botConfig.Enabled = false
	}
	if a.Profiles != nil {
		if profile, err := a.Profiles.Load(configapp.DefaultProfileName); err == nil {
			if resolved, err := configapp.ResolveConnection(profile, nil); err == nil {
				botConfig.ADBPath = resolved.ADBPath
				botConfig.ADBAddress = resolved.Address
			}
		}
	}
	_ = a.Bot.Stop(ctx)
	// Polling must outlive the HTTP request that saved the config.
	return a.Bot.Init(context.Background(), botConfig)
}

func (a *App) Config() config.Config { return a.cfg }

func (a *App) Close(ctx context.Context) error {
	var result error
	a.closeOnce.Do(func() {
		if a.Bot != nil {
			if err := a.Bot.Stop(ctx); err != nil && result == nil {
				result = err
			}
		}
		a.Execution.CloseAdmission("server_shutdown")
		if a.Scheduler != nil {
			a.Scheduler.Close()
		}
		if a.Mastery != nil {
			a.Mastery.StopScheduler()
		}
		if err := a.MAAService.Stop(ctx); err != nil {
			result = err
		}
		if err := a.WebRTC.Stop(ctx); err != nil && result == nil {
			result = err
		}
		if err := a.Runs.Flush(); err != nil && result == nil {
			result = err
		}
		// Release last: the data directory must not become writable by a new
		// instance before this one finished flushing.
		if err := a.instanceLock.Release(); err != nil && result == nil {
			result = err
		}
	})
	return result
}

func instanceRole() string {
	if executable, err := os.Executable(); err == nil && executable != "" {
		return filepath.Base(executable)
	}
	return "la-pluma"
}

func (a *App) StartedAt() time.Time { return a.startedAt }

// MAAServiceService exposes the MAA action service to transport layers.
func (a *App) MAAServiceService() *maaapp.Service { return a.MAAService }
