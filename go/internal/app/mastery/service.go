// Package mastery ports the Node operator-mastery data, queue, run and
// scheduler services. It preserves the Agent API JSON field names and the
// queue persistence path under config.Paths.DataDir. MAA execution, version
// probes, log checkpoints, game-state probes, external-execution probes and
// notifications are injected; this package never starts MAA by itself.
package mastery

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// ServiceOptions wires the mastery data, queue, run and scheduler services.
// Executor, Versions, Logs, GameState, ExternalExecution and Notifier are all
// injected so tests never start MAA or touch a device.
type ServiceOptions struct {
	Paths    config.Paths
	Logger   *slog.Logger
	Now      func() time.Time
	Material *MaterialDatabase

	Executor          Executor
	Versions          VersionProvider
	Logs              LogReader
	GameState         GameStateProbe
	ExternalExecution ExternalExecutionProbe
	Notifier          Notifier

	TickInterval time.Duration
	StepTimeout  time.Duration
}

// Service is the mastery service layer corresponding to the Node Agent
// routes. It contains no HTTP handlers.
type Service struct {
	Data      *DataService
	Queue     *QueueService
	Run       *RunService
	Scheduler *SchedulerService
}

// NewService constructs the full mastery service graph.
func NewService(options ServiceOptions) *Service {
	data := NewDataService(DataOptions{
		Paths:    options.Paths,
		Logger:   options.Logger,
		Now:      options.Now,
		Material: options.Material,
	})
	queue := NewQueueService(QueueOptions{
		Paths:  options.Paths,
		Logger: options.Logger,
		Now:    options.Now,
	})
	runs := NewRunService(RunOptions{
		Executor:    options.Executor,
		Versions:    options.Versions,
		Logs:        options.Logs,
		GameState:   options.GameState,
		Logger:      options.Logger,
		Now:         options.Now,
		StepTimeout: options.StepTimeout,
	})
	scheduler := NewSchedulerService(queue, runs, SchedulerOptions{
		Logger:            options.Logger,
		Now:               options.Now,
		TickInterval:      options.TickInterval,
		ExternalExecution: options.ExternalExecution,
		Notifier:          options.Notifier,
	})
	return &Service{Data: data, Queue: queue, Run: runs, Scheduler: scheduler}
}

// Preflight combines generated-data and MAA-version checks.
func (s *Service) Preflight(ctx context.Context, clientType string) (PreflightResponse, error) {
	dataPreflight, err := s.Data.Preflight(clientType)
	if err != nil {
		return PreflightResponse{}, err
	}
	runtime := s.Run.CheckRuntimeSupport(ctx)
	dataPreflight.Supported = dataPreflight.Supported && runtime.Supported
	return PreflightResponse{MasteryDataPreflight: dataPreflight, Runtime: runtime}, nil
}

// Catalog lists mastery candidates.
func (s *Service) Catalog(options CatalogOptions) (MasteryCandidateList, error) {
	return s.Data.GetCandidates(options)
}

// OperatorDetail returns one operator with material gaps.
func (s *Service) OperatorDetail(operatorID string, options OperatorDetailOptions) (MasteryOperatorDetail, error) {
	return s.Data.GetOperatorDetail(operatorID, options)
}

// Status returns the queue plus scheduler telemetry.
func (s *Service) Status() (MasteryStatusResponse, error) {
	status, err := s.Queue.Status()
	if err != nil {
		return MasteryStatusResponse{}, err
	}
	return MasteryStatusResponse{MasteryQueueStatus: status, Scheduler: s.Scheduler.Status()}, nil
}

// AddItems appends mastery targets.
func (s *Service) AddItems(inputs []AddItemInput, context CampaignContext) (AddItemsResult, error) {
	return s.Queue.AddItems(inputs, s.Data, context)
}

// UpdateItem patches a target.
func (s *Service) UpdateItem(id string, patch ItemPatch) (MasteryQueueItem, error) {
	return s.Queue.UpdateItem(id, patch)
}

// RemoveItem deletes a target.
func (s *Service) RemoveItem(id string) error {
	return s.Queue.RemoveItem(id)
}

// Reorder rewrites queue order.
func (s *Service) Reorder(order []string) ([]MasteryQueueItem, error) {
	return s.Queue.Reorder(order)
}

// UpdateSettings merges settings overrides.
func (s *Service) UpdateSettings(patch map[string]any) (QueueSettings, error) {
	return s.Queue.UpdateSettings(patch)
}

// StartCampaign performs the route's preflight gate and arms the queue. It
// returns immediately; the first scheduler tick runs in the background like
// the Node route's void runMasterySchedulerTick().
func (s *Service) StartCampaign(ctx context.Context, campaignContext CampaignContext) (MasteryQueueStatus, error) {
	dataPreflight, err := s.Data.Preflight(derefString(campaignContext.ClientType))
	if err != nil {
		return MasteryQueueStatus{}, err
	}
	runtime := s.Run.CheckRuntimeSupport(ctx)
	if !dataPreflight.Supported || !runtime.Supported {
		message := "专精运行前检查未通过"
		if runtime.Reason != nil && *runtime.Reason != "" {
			message = *runtime.Reason
		} else if dataPreflight.MasteryData.Error != nil && *dataPreflight.MasteryData.Error != "" {
			message = *dataPreflight.MasteryData.Error
		}
		return MasteryQueueStatus{}, apperrors.WithStatus(
			"AGENT_MASTERY_UNSUPPORTED_VERSION",
			message,
			http.StatusConflict,
			true,
			map[string]any{"dataPreflight": dataPreflight, "runtime": runtime},
		)
	}
	status, err := s.Queue.StartCampaign(campaignContext)
	if err != nil {
		return MasteryQueueStatus{}, err
	}
	go s.Scheduler.Tick(context.Background())
	return status, nil
}

// PauseCampaign stops starting new steps.
func (s *Service) PauseCampaign(reason *string) (MasteryQueueStatus, error) {
	return s.Queue.PauseCampaign(reason)
}

// ResumeCampaign resumes and immediately ticks in the background.
func (s *Service) ResumeCampaign() (MasteryQueueStatus, error) {
	status, err := s.Queue.ResumeCampaign()
	if err != nil {
		return MasteryQueueStatus{}, err
	}
	go s.Scheduler.Tick(context.Background())
	return status, nil
}

// StopCampaign stops the current MAA task on a best-effort basis and then
// resets the queue to idle. In-game training is never canceled by this call.
func (s *Service) StopCampaign(ctx context.Context) (MasteryQueueStatus, error) {
	if err := s.Run.Stop(ctx); err != nil {
		s.logger().Warn("停止专精 MAA 任务失败", "error", err)
	}
	return s.Queue.StopCampaign()
}

// RetryItem returns a blocked target to the queue.
func (s *Service) RetryItem(id string) (MasteryQueueItem, error) {
	return s.Queue.RetryItem(id)
}

// RecoverOnStartup marks active campaign/item state as interrupted.
func (s *Service) RecoverOnStartup() error {
	return s.Queue.RecoverOnStartup()
}

// StartScheduler launches the periodic tick loop.
func (s *Service) StartScheduler(ctx context.Context) {
	s.Scheduler.Start(ctx)
}

// StopScheduler stops the periodic tick loop.
func (s *Service) StopScheduler() {
	s.Scheduler.Stop()
}

// SchedulerStatus exposes the tick telemetry.
func (s *Service) SchedulerStatus() SchedulerStatus {
	return s.Scheduler.Status()
}

func (s *Service) logger() *slog.Logger {
	if s.Run != nil && s.Run.logger != nil {
		return s.Run.logger
	}
	return slog.Default()
}
