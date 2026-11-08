package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
)

type executionStatus struct {
	isRunning          bool
	scheduleID         *string
	currentStep        int
	totalSteps         int
	currentTask        *string
	currentTaskID      *string
	message            string
	startTime          *int64
	shouldStop         bool
	lastResult         any
	lastResultRevision int64
}

type dailyJob struct {
	time     string
	cancel   chan struct{}
	stopOnce sync.Once
}

func (j *dailyJob) stop() {
	j.stopOnce.Do(func() { close(j.cancel) })
}

// Service owns cron registrations, execution status and the in-memory
// sequential runner. It never persists scheduler state; automation-tasks and
// auto-update config remain owned by config.Storage.
type Service struct {
	executor TaskExecutor
	options  Options
	paths    config.Paths
	logger   *slog.Logger
	now      func() time.Time
	delay    func(context.Context, time.Duration) bool

	baseCtx    context.Context
	baseCancel context.CancelFunc

	mu           sync.Mutex
	schedules    map[string][]*dailyJob
	status       executionStatus
	activeCancel context.CancelFunc
	activeRunID  int64
}

// New builds a scheduler with an executor and the paths used by the default
// file-based config source.
func New(executor TaskExecutor, paths config.Paths, options Options) *Service {
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	effectivePaths := paths
	if options.Paths.DataDir != "" {
		effectivePaths = options.Paths
	}
	options.Paths = effectivePaths
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.Delay == nil {
		options.Delay = waitForDelay
	}
	if options.ConfigSource == nil {
		options.ConfigSource = NewFileConfigSource(effectivePaths)
	}
	baseCtx, baseCancel := context.WithCancel(context.Background())
	return &Service{
		executor:   executor,
		options:    options,
		paths:      effectivePaths,
		logger:     options.Logger,
		now:        options.Now,
		delay:      options.Delay,
		baseCtx:    baseCtx,
		baseCancel: baseCancel,
		schedules:  make(map[string][]*dailyJob),
		status:     executionStatus{currentStep: -1},
	}
}

func waitForDelay(ctx context.Context, duration time.Duration) bool {
	if duration <= 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}

func (s *Service) connectionDefaults() ConnectionDefaults {
	defaults := s.options.ConnectionDefaults
	if defaults.ClientType == "" {
		defaults.ClientType = DefaultClientType
	}
	return defaults
}

func (s *Service) nowMillis() int64 {
	return s.now().UnixMilli()
}

func (s *Service) nowISO() string {
	return isoMillis(s.nowMillis())
}

// RegisterSchedule mirrors setupSchedule with the service's default client
// type. The Node route passes the resolved connection client type; use
// RegisterScheduleForClient for that.
func (s *Service) RegisterSchedule(id string, times []string, taskFlow any) ScheduleResult {
	return s.RegisterScheduleForClient(id, times, taskFlow, s.connectionDefaults().ClientType)
}

// RegisterScheduleForClient registers one cron job per valid HH:MM value in
// the client's game time zone. Existing jobs are replaced only after the time
// list validates, so bad input cannot clear a working schedule.
func (s *Service) RegisterScheduleForClient(id string, times []string, taskFlow any, clientType string) ScheduleResult {
	if !taskFlowIsArray(taskFlow) {
		return ScheduleResult{Success: false, Message: "任务流程格式无效"}
	}
	normalized := NormalizeScheduleTimes(times)
	if len(normalized) == 0 {
		return ScheduleResult{Success: false, Message: "没有设置执行时间"}
	}

	s.stopScheduleJobs(id)

	location := gameLocation(clientType)
	jobs := make([]*dailyJob, 0, len(normalized))
	for index, clock := range normalized {
		hour, minute, ok := ParseClock(clock)
		if !ok {
			continue
		}
		scheduleID := fmt.Sprintf("%s-%d", id, index)
		flow := taskFlow
		job := s.newDailyJob(clock, location, hour, minute, func() {
			s.triggerTaskFlow(flow, scheduleID)
		})
		jobs = append(jobs, job)
	}

	if len(jobs) == 0 {
		return ScheduleResult{Success: false, Message: "没有成功设置任何定时任务"}
	}
	s.mu.Lock()
	s.schedules[id] = jobs
	s.mu.Unlock()
	s.logger.Info("定时任务已设置", "scheduleId", id, "count", len(jobs), "times", strings.Join(normalized, ", "))
	return ScheduleResult{
		Success: true,
		Message: fmt.Sprintf("已设置 %d 个定时任务", len(jobs)),
		Times:   normalized,
	}
}

func (s *Service) newDailyJob(clock string, location *time.Location, hour, minute int, run func()) *dailyJob {
	job := &dailyJob{time: clock, cancel: make(chan struct{})}
	if s.options.DisableCronSchedule {
		return job
	}
	go func() {
		for {
			next := nextDailyOccurrence(s.now(), location, hour, minute)
			wait := next.Sub(s.now())
			if wait < 0 {
				wait = 0
			}
			timer := time.NewTimer(wait)
			select {
			case <-timer.C:
				// Match node-cron: do not await the callback, so a long flow
				// cannot delay the next day's timer. Overlap is rejected by
				// StartDailyFlow's busy check.
				go run()
			case <-job.cancel:
				timer.Stop()
				return
			case <-s.baseCtx.Done():
				timer.Stop()
				return
			}
		}
	}()
	return job
}

func (s *Service) stopScheduleJobs(id string) []*dailyJob {
	s.mu.Lock()
	jobs := s.schedules[id]
	delete(s.schedules, id)
	s.mu.Unlock()
	for _, job := range jobs {
		job.stop()
	}
	return jobs
}

// StopSchedule mirrors stopSchedule.
func (s *Service) StopSchedule(id string) ScheduleResult {
	jobs := s.stopScheduleJobs(id)
	if len(jobs) == 0 {
		return ScheduleResult{Success: false, Message: "没有找到该定时任务"}
	}
	times := make([]string, 0, len(jobs))
	for _, job := range jobs {
		times = append(times, job.time)
	}
	s.logger.Debug("定时任务已停止", "scheduleId", id, "count", len(jobs), "times", strings.Join(times, ", "))
	return ScheduleResult{Success: true, Message: "定时任务已停止"}
}

// ScheduleStatus mirrors getScheduleStatus.
func (s *Service) ScheduleStatus() []ScheduleState {
	s.mu.Lock()
	ids := make([]string, 0, len(s.schedules))
	for id := range s.schedules {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	states := make([]ScheduleState, 0, len(ids))
	for _, id := range ids {
		jobs := s.schedules[id]
		times := make([]string, 0, len(jobs))
		for _, job := range jobs {
			times = append(times, job.time)
		}
		states = append(states, ScheduleState{ScheduleID: id, Times: times, Count: len(jobs)})
	}
	s.mu.Unlock()
	return states
}

func (s *Service) triggerTaskFlow(taskFlow any, scheduleID string) {
	if s.baseCtx.Err() != nil {
		return
	}
	execute := func(ctx context.Context) DailyFlowResult {
		return s.StartDailyFlow(ctx, DailyFlowRequest{ScheduleID: scheduleID, TaskFlow: taskFlow})
	}
	var result DailyFlowResult
	if s.options.WrapDailyFlow != nil {
		result = s.options.WrapDailyFlow(s.baseCtx, scheduleID, execute)
	} else {
		result = execute(s.baseCtx)
	}
	if !result.Success {
		s.logger.Warn("定时任务执行失败", "scheduleId", scheduleID, "message", result.Message)
	}
}

// SetupAutoUpdate mirrors setupAutoUpdate.
func (s *Service) SetupAutoUpdate(config map[string]any, clientType string) SetupAutoUpdateResult {
	if config == nil {
		config = map[string]any{}
	}
	s.stopScheduleJobs(AutoUpdateScheduleID)

	enabled := truthy(config["enabled"])
	clock := stringField(config, "time")
	if !enabled || clock == "" {
		return SetupAutoUpdateResult{Success: false, Message: "自动更新未启用"}
	}
	hour, minute, ok := ParseClock(clock)
	if !ok {
		return SetupAutoUpdateResult{Success: false, Message: "时间格式错误"}
	}

	location := gameLocation(clientType)
	jobConfig := config
	job := s.newDailyJob(clock, location, hour, minute, func() {
		s.triggerAutoUpdate(jobConfig)
	})
	s.mu.Lock()
	s.schedules[AutoUpdateScheduleID] = []*dailyJob{job}
	s.mu.Unlock()
	s.logger.Info("自动更新已设置", "time", clock)
	return SetupAutoUpdateResult{
		Success: true,
		Message: fmt.Sprintf("自动更新已设置，每天 %s 执行", clock),
		Config:  config,
	}
}

func (s *Service) triggerAutoUpdate(config map[string]any) {
	if s.baseCtx.Err() != nil {
		return
	}
	if s.options.AutoUpdater == nil {
		s.logger.Warn("自动更新触发，但未配置 AutoUpdater")
		return
	}
	s.logger.Info("自动更新触发执行")
	if err := s.options.AutoUpdater.Run(s.baseCtx, config); err != nil {
		s.logger.Error("自动更新失败", "error", err.Error())
	}
}

// AutoUpdateStatus mirrors getAutoUpdateStatus.
func (s *Service) AutoUpdateStatus() AutoUpdateStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	jobs := s.schedules[AutoUpdateScheduleID]
	if len(jobs) == 0 {
		return AutoUpdateStatus{Enabled: false, Time: nil}
	}
	clock := jobs[0].time
	return AutoUpdateStatus{Enabled: true, Time: &clock}
}

// RestoreFromConfig restores the automation schedule and auto-update timer
// from the configured source, matching runtimeInitializationService.
func (s *Service) RestoreFromConfig() RestoreSummary {
	summary := RestoreSummary{}
	automationConfig, err := s.options.ConfigSource.Load("automation-tasks")
	if err != nil {
		summary.Schedule.Error = err.Error()
		s.logger.Error("运行时配置加载异常", "configType", "automation-tasks", "error", err.Error())
	} else if automationConfig != nil {
		summary.Schedule = s.restoreAutomation(automationConfig)
	}

	autoUpdateConfig, err := s.options.ConfigSource.Load("auto-update")
	if err != nil {
		summary.AutoUpdate.Error = err.Error()
		s.logger.Error("运行时配置加载异常", "configType", "auto-update", "error", err.Error())
	} else if autoUpdateConfig != nil {
		summary.AutoUpdate = s.restoreAutoUpdate(autoUpdateConfig)
	}
	return summary
}

// RestoreFromMaps is the map-input form used by callers that already own the
// persisted automation and auto-update configs.
func (s *Service) RestoreFromMaps(automationConfig, autoUpdateConfig map[string]any) RestoreSummary {
	summary := RestoreSummary{}
	if automationConfig != nil {
		summary.Schedule = s.restoreAutomation(automationConfig)
	}
	if autoUpdateConfig != nil {
		summary.AutoUpdate = s.restoreAutoUpdate(autoUpdateConfig)
	}
	return summary
}

func (s *Service) restoreAutomation(automationConfig map[string]any) RestoreEntry {
	schedule := mapField(automationConfig, "schedule")
	if !truthy(schedule["enabled"]) {
		return RestoreEntry{}
	}
	times := stringSlice(schedule["times"])
	taskFlow := automationConfig["taskFlow"]
	if !taskFlowIsArray(taskFlow) {
		// runtimeInitializationService passes an empty array when taskFlow is
		// missing, allowing the schedule to restore with no runnable tasks.
		taskFlow = []any{}
	}
	clientType := firstNonEmptyString(automationConfig["clientType"], schedule["clientType"])
	if clientType == "" {
		clientType = s.connectionDefaults().ClientType
	}
	result := s.RegisterScheduleForClient("default", times, taskFlow, clientType)
	entry := RestoreEntry{Restored: result.Success, Message: result.Message}
	if !result.Success {
		s.logger.Warn("默认定时任务恢复失败", "message", result.Message)
	}
	return entry
}

func (s *Service) restoreAutoUpdate(autoUpdateConfig map[string]any) RestoreEntry {
	if !truthy(autoUpdateConfig["enabled"]) {
		return RestoreEntry{}
	}
	clientType := firstNonEmptyString(autoUpdateConfig["clientType"])
	result := s.SetupAutoUpdate(autoUpdateConfig, clientType)
	entry := RestoreEntry{Restored: result.Success, Message: result.Message}
	if !result.Success {
		s.logger.Warn("自动更新任务恢复失败", "message", result.Message)
	}
	return entry
}

func stringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		values := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok {
				values = append(values, text)
			}
		}
		return values
	default:
		return nil
	}
}

// ExecutionStatus mirrors getScheduleExecutionStatus(false).
func (s *Service) ExecutionStatus() ExecutionStatus {
	return s.executionStatus(false)
}

// ExecutionStatusWithResult mirrors getScheduleExecutionStatus(true).
func (s *Service) ExecutionStatusWithResult() ExecutionStatus {
	return s.executionStatus(true)
}

func (s *Service) executionStatus(includeResult bool) ExecutionStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	status := ExecutionStatus{
		IsRunning:          s.status.isRunning,
		CurrentStep:        s.status.currentStep,
		TotalSteps:         s.status.totalSteps,
		Message:            s.status.message,
		ShouldStop:         s.status.shouldStop,
		HasLastResult:      s.status.lastResult != nil,
		LastResultRevision: s.status.lastResultRevision,
	}
	if s.status.scheduleID != nil {
		value := *s.status.scheduleID
		status.ScheduleID = &value
	}
	if s.status.currentTask != nil {
		value := *s.status.currentTask
		status.CurrentTask = &value
	}
	if s.status.currentTaskID != nil {
		value := *s.status.currentTaskID
		status.CurrentTaskID = &value
	}
	if s.status.startTime != nil {
		value := *s.status.startTime
		status.StartTime = &value
	}
	if includeResult {
		status.LastResult = s.status.lastResult
	}
	return status
}

// Stop cancels the active flow, interrupts its delay and asks the executor to
// stop the current MAA command. It returns false when nothing is running.
func (s *Service) Stop(ctx context.Context) bool {
	s.mu.Lock()
	if !s.status.isRunning {
		s.mu.Unlock()
		return false
	}
	s.status.shouldStop = true
	s.status.message = "正在终止任务流程"
	cancel := s.activeCancel
	s.mu.Unlock()

	s.logger.Warn("设置停止标志，正在终止任务流程")
	if cancel != nil {
		cancel()
	}
	if s.executor != nil {
		if err := s.executor.Stop(ctx); err != nil {
			s.logger.Error("停止 MAA 任务失败", "error", err.Error())
		}
	}
	return true
}

// Close stops every cron timer and the active flow. It is safe to call twice.
func (s *Service) Close() {
	s.mu.Lock()
	allJobs := make([]*dailyJob, 0, len(s.schedules))
	for _, jobs := range s.schedules {
		allJobs = append(allJobs, jobs...)
	}
	s.schedules = make(map[string][]*dailyJob)
	running := s.status.isRunning
	if running {
		s.status.shouldStop = true
		s.status.message = "正在终止任务流程"
	}
	activeCancel := s.activeCancel
	s.mu.Unlock()

	for _, job := range allJobs {
		job.stop()
	}
	if s.baseCancel != nil {
		s.baseCancel()
	}
	if running {
		if activeCancel != nil {
			activeCancel()
		}
		if s.executor != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = s.executor.Stop(ctx)
			cancel()
		}
	}
}
