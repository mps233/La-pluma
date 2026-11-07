package mastery

import (
	"context"
	"log/slog"
	"math"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const (
	defaultTickInterval = 60 * time.Second
	transientRetryDelay = 60 * time.Second
)

// ExternalExecutionProbe reports whether another MAA consumer (scheduler,
// direct task, agent run or execution lease) is busy. Returning true defers
// the mastery tick without touching the device.
type ExternalExecutionProbe interface {
	ExternalExecutionActive(ctx context.Context) bool
}

// Notifier sends the two mastery campaign notifications.
type Notifier interface {
	Notify(ctx context.Context, title, content, level string) error
}

// SchedulerOptions configures the mastery scheduler.
type SchedulerOptions struct {
	Logger            *slog.Logger
	Now               func() time.Time
	TickInterval      time.Duration
	ExternalExecution ExternalExecutionProbe
	Notifier          Notifier
}

// SchedulerService runs the mastery queue tick loop. All side effects go
// through the injected Executor.
type SchedulerService struct {
	queue        *QueueService
	runs         *RunService
	logger       *slog.Logger
	now          func() time.Time
	tickInterval time.Duration
	probe        ExternalExecutionProbe
	notifier     Notifier

	mu            sync.Mutex
	cancel        context.CancelFunc
	running       bool
	tickInFlight  bool
	lastTickAt    *string
	lastTickError *string
}

// NewSchedulerService returns a scheduler over an existing queue and runner.
func NewSchedulerService(queue *QueueService, runs *RunService, options SchedulerOptions) *SchedulerService {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	now := options.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	interval := options.TickInterval
	if interval <= 0 {
		interval = tickIntervalFromEnvironment()
	}
	return &SchedulerService{
		queue:        queue,
		runs:         runs,
		logger:       logger,
		now:          now,
		tickInterval: interval,
		probe:        options.ExternalExecution,
		notifier:     options.Notifier,
	}
}

func tickIntervalFromEnvironment() time.Duration {
	value, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv("LA_PLUMA_MASTERY_TICK_MS")), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 1000 {
		return defaultTickInterval
	}
	return time.Duration(int64(value)) * time.Millisecond
}

// Start launches the tick loop and runs one immediate tick. Calling Start
// while it is already running is a no-op.
func (s *SchedulerService) Start(ctx context.Context) {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	runCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.running = true
	interval := s.tickInterval
	s.mu.Unlock()

	s.logger.Info("专精调度器已启动", "tickMs", interval.Milliseconds())
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		s.Tick(runCtx)
		for {
			select {
			case <-runCtx.Done():
				return
			case <-ticker.C:
				s.Tick(runCtx)
			}
		}
	}()
}

// Stop cancels the tick loop. A tick already in flight finishes normally,
// matching the Node interval cleanup.
func (s *SchedulerService) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	s.running = false
}

// Status returns scheduler telemetry for /status.
func (s *SchedulerService) Status() SchedulerStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return SchedulerStatus{
		Running:       s.running,
		TickMS:        s.tickInterval.Milliseconds(),
		LastTickAt:    s.lastTickAt,
		LastTickError: s.lastTickError,
		TickInFlight:  s.tickInFlight,
	}
}

// ResetForTests clears telemetry and stops the loop.
func (s *SchedulerService) ResetForTests() {
	s.Stop()
	s.mu.Lock()
	s.tickInFlight = false
	s.lastTickAt = nil
	s.lastTickError = nil
	s.mu.Unlock()
}

func (s *SchedulerService) beginTick() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tickInFlight {
		return false
	}
	s.tickInFlight = true
	now := formatISO(s.now())
	s.lastTickAt = &now
	return true
}

func (s *SchedulerService) endTick() {
	s.mu.Lock()
	s.tickInFlight = false
	s.mu.Unlock()
}

func (s *SchedulerService) recordTickError(message string) {
	s.mu.Lock()
	s.lastTickError = &message
	s.mu.Unlock()
}

// Tick runs one scheduler pass. It never panics and never starts a second
// concurrent pass.
func (s *SchedulerService) Tick(ctx context.Context) {
	if !s.beginTick() {
		return
	}
	defer s.endTick()
	if err := s.tick(ctx); err != nil {
		s.handleTickError(ctx, err)
	}
}

func (s *SchedulerService) tick(ctx context.Context) error {
	status, err := s.queue.Status()
	if err != nil {
		return err
	}
	if status.Campaign.Status != CampaignRunning {
		return nil
	}
	if s.probe != nil && s.probe.ExternalExecutionActive(ctx) {
		return nil
	}

	var item *MasteryQueueItem
	if status.ActiveItem != nil && actionPhases[status.ActiveItem.Phase] {
		item = status.ActiveItem
	} else {
		item = status.NextActionableItem
	}
	if item == nil {
		_, err := s.queue.AdvanceCampaign()
		return err
	}
	if executingPhases[item.Phase] {
		// A previous tick owns this step. The executor owns the run lifecycle.
		return nil
	}
	if item.Phase == PhaseBlocked || item.Phase == PhaseFailed {
		message := blockedMessage(item)
		if status.Campaign.Settings.OnItemBlocked == "pause" {
			if err := s.queue.MarkCampaignBlocked(message); err != nil {
				return err
			}
			s.handleBlocked(ctx, *item, status.Campaign.Settings, message)
			return nil
		}
		_, err := s.queue.AdvanceCampaign()
		return err
	}
	if !nextProbeReached(item, s.now()) {
		return nil
	}

	settings, err := s.queue.Settings()
	if err != nil {
		return err
	}
	clientType := defaultClientType
	if status.Campaign.ClientType != nil && *status.Campaign.ClientType != "" {
		clientType = *status.Campaign.ClientType
	}
	profileID := "default"
	if status.Campaign.ClientProfileID != nil && *status.Campaign.ClientProfileID != "" {
		profileID = *status.Campaign.ClientProfileID
	}
	outcome, err := s.runs.ExecuteStep(ctx, *item, clientType, StepOptions{
		StartGameEnabled: settings.AutoStartGame,
		ProfileID:        profileID,
	})
	if err != nil {
		return err
	}
	updated, err := s.queue.ApplyStepOutcome(item.ID, outcome, settings)
	if err != nil {
		return err
	}
	if updated.Phase == PhaseCompleted {
		s.handleItemCompleted(ctx, updated, settings)
	}
	if updated.Phase == PhaseBlocked || updated.Phase == PhaseFailed {
		message := blockedMessage(&updated)
		s.handleBlocked(ctx, updated, settings, message)
		if settings.OnItemBlocked == "pause" {
			return s.queue.MarkCampaignBlocked(message)
		}
	}

	advanced, err := s.queue.AdvanceCampaign()
	if err != nil {
		return err
	}
	switch advanced.Campaign.Status {
	case CampaignCompleted:
		s.notify(ctx, "专精队列完成", "所有专精目标已处理完成", "success")
	case CampaignBlocked:
		reason := "所有剩余目标都需要人工处理"
		if advanced.Campaign.PausedReason != nil && *advanced.Campaign.PausedReason != "" {
			reason = *advanced.Campaign.PausedReason
		}
		s.notify(ctx, "专精队列已暂停", reason, "warning")
	}
	return nil
}

func (s *SchedulerService) handleTickError(ctx context.Context, err error) {
	message := errorMessage(err)
	s.recordTickError(message)
	s.logger.Warn("专精调度 tick 失败", "error", message)

	status, statusErr := s.queue.Status()
	if statusErr != nil {
		return
	}
	active := status.ActiveItem
	if active == nil {
		active = status.NextActionableItem
	}
	if active == nil {
		return
	}
	code := ""
	if appErr, ok := apperrors.As(err); ok {
		code = appErr.Code
	}
	resetCode := code
	if resetCode == "" {
		resetCode = "AGENT_MASTERY_TRANSIENT_ERROR"
	}
	retryAt := formatISO(s.now().Add(transientRetryDelay))
	reset, resetErr := s.queue.ResetItemAfterTransientError(active.ID, TransientReset{
		Code:    resetCode,
		Message: message,
		RetryAt: retryAt,
	})
	if resetErr != nil {
		s.logger.Warn("重置专精目标失败", "error", resetErr)
	}
	if code == "AGENT_MASTERY_UNSUPPORTED_VERSION" ||
		code == "AGENT_MASTERY_DATA_MISSING" ||
		code == "AGENT_MASTERY_DATA_UNAVAILABLE" {
		if markErr := s.queue.MarkCampaignBlocked(message); markErr != nil {
			s.logger.Warn("暂停专精队列失败", "error", markErr)
		}
		s.notify(ctx, "专精队列已暂停", message, "warning")
		return
	}
	if resetErr == nil && reset.ConsecutiveFailures >= 5 {
		reason := "专精步骤连续失败，已暂停自动执行"
		if markErr := s.queue.MarkCampaignBlocked(reason); markErr != nil {
			s.logger.Warn("暂停专精队列失败", "error", markErr)
		}
		s.notify(ctx, "专精队列已暂停", reason, "warning")
	}
}

func nextProbeReached(item *MasteryQueueItem, now time.Time) bool {
	if item.NextProbeAt == nil || *item.NextProbeAt == "" {
		return true
	}
	next, ok := parseTimestamp(*item.NextProbeAt)
	if !ok {
		return true
	}
	return !now.Before(next)
}

func blockedMessage(item *MasteryQueueItem) string {
	if item.Blocked != nil && item.Blocked.Message != "" {
		return item.Blocked.Message
	}
	return "专精目标受阻"
}

func (s *SchedulerService) handleItemCompleted(ctx context.Context, item MasteryQueueItem, settings QueueSettings) {
	if !settings.NotifyOnComplete {
		return
	}
	content := item.OperatorName + " · " + item.SkillName + " 已确认达到 M" + strconv.Itoa(item.TargetLevel)
	s.notify(ctx, "专精目标完成", content, "success")
}

func (s *SchedulerService) handleBlocked(ctx context.Context, item MasteryQueueItem, settings QueueSettings, reason string) {
	if !settings.NotifyOnBlocked {
		return
	}
	s.notify(ctx, "专精目标受阻", itemSummary(item, reason), "warning")
}

func itemSummary(item MasteryQueueItem, reason string) string {
	return item.OperatorName + " · " + item.SkillName + "：" + reason
}

func (s *SchedulerService) notify(ctx context.Context, title, content, level string) {
	if s.notifier == nil {
		return
	}
	if err := s.notifier.Notify(ctx, title, content, level); err != nil {
		s.logger.Warn("专精通知发送失败", "error", err)
	}
}
