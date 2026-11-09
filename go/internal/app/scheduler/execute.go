package scheduler

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// flowExecution accumulates the per-flow counters and result lists.
type flowExecution struct {
	startupFailed bool

	successCount int
	failedCount  int
	skippedCount int

	scheduleID string

	errors    []TaskErrorEntry
	skipped   []TaskSkipEntry
	summaries []TaskSummary
	reports   []FightReportResult
	actions   []TaskActionResult
	warnings  []string

	taskResults []ScheduleTaskResult
	activeIndex int

	lastSuccess int
	lastFailed  int
	lastSkipped int
}

func newFlowExecution() *flowExecution {
	return &flowExecution{
		errors:      make([]TaskErrorEntry, 0),
		skipped:     make([]TaskSkipEntry, 0),
		summaries:   make([]TaskSummary, 0),
		reports:     make([]FightReportResult, 0),
		actions:     make([]TaskActionResult, 0),
		warnings:    make([]string, 0),
		taskResults: make([]ScheduleTaskResult, 0),
		activeIndex: -1,
	}
}

func (e *flowExecution) recordAction(action TaskActionResult) {
	e.actions = append(e.actions, action)
}

func (e *flowExecution) recordError(task string, err error) {
	e.failedCount++
	e.errors = append(e.errors, TaskErrorEntry{Task: task, Error: err.Error()})
}

func (e *flowExecution) recordSkip(task, reason string) {
	e.skipped = append(e.skipped, TaskSkipEntry{Task: task, Reason: reason})
}

// addFightAction mirrors the Node addFightAction: failed/skipped actions feed
// the error/skip lists, while counting is deferred to the stage group.
func (e *flowExecution) addFightAction(action TaskActionResult) {
	e.actions = append(e.actions, action)
	switch action.Status {
	case "failed":
		e.errors = append(e.errors, TaskErrorEntry{Task: action.Task, Error: action.Message})
	case "skipped":
		e.skipped = append(e.skipped, TaskSkipEntry{Task: action.Task, Reason: action.Message})
	}
}

func (e *flowExecution) countFightActions(start int) {
	actions := e.actions[start:]
	failed := false
	succeeded := false
	for _, action := range actions {
		if action.Status == "failed" {
			failed = true
		}
		if action.Status == "success" {
			succeeded = true
		}
	}
	if failed {
		e.failedCount++
	} else if succeeded {
		e.successCount++
	} else {
		e.skippedCount++
	}
}

func (e *flowExecution) addTaskResult(entry ScheduleTaskResult) {
	e.taskResults = append(e.taskResults, entry)
	e.activeIndex = len(e.taskResults) - 1
}

func (e *flowExecution) finalizeActive(forcedState, now string) {
	if e.activeIndex < 0 {
		return
	}
	entry := &e.taskResults[e.activeIndex]
	successDelta := e.successCount - e.lastSuccess
	failedDelta := e.failedCount - e.lastFailed
	state := forcedState
	if state == "" {
		switch {
		case failedDelta > 0:
			state = "failed"
		case successDelta > 0:
			state = "success"
		default:
			state = "skipped"
		}
	}
	entry.State = state
	entry.FinishedAt = now
	e.lastSuccess = e.successCount
	e.lastFailed = e.failedCount
	e.lastSkipped = e.skippedCount
	e.activeIndex = -1
}

func (e *flowExecution) buildSummary(durationMS int64) *ExecutionSummary {
	return &ExecutionSummary{
		SuccessCount: e.successCount,
		FailedCount:  e.failedCount,
		SkippedCount: e.skippedCount,
		DurationMS:   durationMS,
		Summaries:    e.summaries,
		Reports:      e.reports,
		Actions:      e.actions,
		TaskResults:  e.taskResults,
		Errors:       e.errors,
		Warnings:     e.warnings,
	}
}

// StartDailyFlow validates and runs a task flow sequentially. DryRun returns
// the same plan as the Agent API's dry-run response without touching MAA.
func (s *Service) StartDailyFlow(ctx context.Context, request DailyFlowRequest) DailyFlowResult {
	scheduleID := strings.TrimSpace(request.ScheduleID)
	if scheduleID == "" {
		scheduleID = "default"
	}
	defaults := s.connectionDefaults()

	if request.DryRun {
		plan := BuildScheduledTaskFlowPlan(request.TaskFlow, defaults)
		if !plan.Success {
			return DailyFlowResult{Success: false, Message: plan.Message, ScheduleID: scheduleID}
		}
		return DailyFlowResult{
			Success:    true,
			Message:    "Dry run only",
			ScheduleID: scheduleID,
			DryRun:     true,
			TotalSteps: plan.TotalSteps,
			Plan:       plan.Steps,
		}
	}

	validation := ValidateScheduledTaskFlow(request.TaskFlow)
	if !validation.Success {
		return DailyFlowResult{Success: false, Message: validation.Message, ScheduleID: scheduleID}
	}
	tasks, _ := taskFlowSlice(request.TaskFlow)
	enabled := make([]map[string]any, 0, len(tasks))
	for _, task := range tasks {
		if taskEnabled(task) {
			enabled = append(enabled, task)
		}
	}
	totalSteps := len(enabled)

	s.mu.Lock()
	if s.status.isRunning {
		activeScheduleID := ""
		if s.status.scheduleID != nil {
			activeScheduleID = *s.status.scheduleID
		}
		s.mu.Unlock()
		s.logger.Warn("任务流程已在执行，忽略重复触发", "activeScheduleId", activeScheduleID, "requestedScheduleId", scheduleID)
		return DailyFlowResult{Success: false, Message: "已有任务流程正在执行", Busy: true, ScheduleID: scheduleID}
	}
	runCtx, cancel := context.WithCancel(ctx)
	startMillis := s.nowMillis()
	s.status = executionStatus{
		isRunning:   true,
		scheduleID:  &scheduleID,
		currentStep: -1,
		totalSteps:  totalSteps,
		message:     "开始执行任务流程",
		startTime:   &startMillis,
		shouldStop:  false,
	}
	s.activeCancel = cancel
	s.activeRunID++
	runID := s.activeRunID
	s.mu.Unlock()

	defer func() {
		cancel()
		s.mu.Lock()
		if s.activeRunID == runID {
			s.activeCancel = nil
		}
		s.mu.Unlock()
	}()

	s.logger.Info("开始执行任务流程", "scheduleId", scheduleID)
	e := newFlowExecution()
	e.scheduleID = scheduleID
	startupFailed := false
	stopped := false

	for index, task := range enabled {
		if s.stopRequested(runCtx) {
			s.markStopping()
			stopped = true
			break
		}
		e.finalizeActive("", s.nowISO())

		name := taskName(task)
		id := taskID(task)
		commandID := taskCommandID(task)

		if startupFailed && commandID != "closedown" {
			reason := "启动游戏失败，已跳过后续游戏任务"
			e.skippedCount++
			e.recordSkip(name, reason)
			e.recordAction(TaskActionResult{
				Task:    name,
				Action:  commandID,
				Status:  "skipped",
				Message: reason,
			})
			timestamp := s.nowISO()
			e.addTaskResult(ScheduleTaskResult{ID: id, Name: name, State: "running", StartedAt: timestamp})
			e.finalizeActive("skipped", timestamp)
			message := fmt.Sprintf("已跳过: %s（启动游戏失败）", name)
			s.setCurrentTask(index, name, id, message)
			s.emitProgress(index+1, totalSteps, name, id, message, e.taskResults)
			s.logger.Warn("启动游戏失败，跳过后续任务", "scheduleId", scheduleID, "taskName", name)
			continue
		}

		s.logger.Info("执行任务", "scheduleId", scheduleID, "taskIndex", index+1, "totalTasks", totalSteps, "taskName", name)
		runningMessage := fmt.Sprintf("正在执行: %s (%d/%d)", name, index+1, totalSteps)
		s.setCurrentTask(index, name, id, runningMessage)
		e.addTaskResult(ScheduleTaskResult{ID: id, Name: name, State: "running", StartedAt: s.nowISO()})
		s.emitProgress(index+1, totalSteps, name, id, runningMessage, e.taskResults)

		taskStopped := false
		switch commandID {
		case "award":
			taskStopped = s.executeSimpleCommand(runCtx, e, task, defaults, "award")
		case "startup":
			var failed bool
			taskStopped, failed = s.executeStartup(runCtx, e, task, defaults)
			if failed {
				startupFailed = true
				e.startupFailed = true
			}
		case "recruit":
			taskStopped = s.executeSimpleCommand(runCtx, e, task, defaults, "recruit")
		case "infrast":
			taskStopped = s.executeSimpleCommand(runCtx, e, task, defaults, "infrast")
		case "mall":
			taskStopped = s.executeSimpleCommand(runCtx, e, task, defaults, "mall")
		case "fight":
			taskStopped = s.executeFight(runCtx, e, task, defaults)
		default:
			taskStopped = s.executeGeneric(runCtx, e, task, defaults, commandID)
		}
		if taskStopped {
			stopped = true
			s.markStopping()
			break
		}
	}

	wasStopped := stopped || s.stopRequested(runCtx)
	forcedState := ""
	if wasStopped {
		forcedState = "stopped"
	}
	e.finalizeActive(forcedState, s.nowISO())
	duration := s.nowMillis() - startMillis
	if duration < 0 {
		duration = 0
	}

	reportFailureCount := 0
	for _, report := range e.reports {
		if report.Status == "failed" {
			reportFailureCount++
		}
	}
	skipSuffix := ""
	if e.skippedCount > 0 {
		skipSuffix = fmt.Sprintf("，%d 项任务跳过", e.skippedCount)
	}
	completionMessage := "任务流程执行完成"
	switch {
	case wasStopped:
		completionMessage = "任务流程已被用户终止"
	case reportFailureCount > 0:
		completionMessage = fmt.Sprintf("任务流程执行完成，%d 项掉落汇报失败%s", reportFailureCount, skipSuffix)
	case e.failedCount > 0:
		completionMessage = fmt.Sprintf("任务流程执行完成，%d 项任务失败%s", e.failedCount, skipSuffix)
	case e.skippedCount > 0:
		completionMessage = "任务流程执行完成" + skipSuffix
	}

	summary := e.buildSummary(duration)
	currentStep := totalSteps
	s.mu.Lock()
	if wasStopped {
		currentStep = s.status.currentStep
	}
	if currentStep < -1 {
		currentStep = -1
	}
	s.status.isRunning = false
	s.status.scheduleID = nil
	s.status.currentStep = currentStep
	s.status.currentTask = nil
	s.status.currentTaskID = nil
	s.status.message = completionMessage
	s.status.shouldStop = false
	s.status.lastResult = summary
	s.status.lastResultRevision++
	s.mu.Unlock()

	s.emitProgress(currentStep, totalSteps, "", "", completionMessage, e.taskResults)
	s.logger.Info(completionMessage, "scheduleId", scheduleID, "successCount", e.successCount, "failedCount", e.failedCount, "skippedCount", e.skippedCount, "durationSeconds", duration/1000)

	if !wasStopped && s.options.SmartStagesUpdater != nil {
		go func() {
			if err := s.options.SmartStagesUpdater.UpdateSmartTrainingStages(); err != nil {
				s.logger.Error("动态更新智能养成关卡失败", "scheduleId", scheduleID, "error", err.Error())
			}
		}()
	}
	if !wasStopped && s.options.CompletionNotifier != nil {
		summaryCopy := summary
		go func() {
			if err := s.options.CompletionNotifier(context.Background(), scheduleID, summaryCopy); err != nil {
				s.logger.Error("发送任务完成通知失败", "scheduleId", scheduleID, "error", err.Error())
			}
		}()
	}

	return DailyFlowResult{
		Success:    true,
		Stopped:    wasStopped,
		Message:    completionMessage,
		Summary:    summary,
		ScheduleID: scheduleID,
	}
}

// stopRequested reports a user stop, a canceled parent context, or a closed
// service. It also marks the status as stopping.
func (s *Service) stopRequested(ctx context.Context) bool {
	if ctx.Err() != nil {
		s.markStopping()
		return true
	}
	s.mu.Lock()
	shouldStop := s.status.shouldStop
	s.mu.Unlock()
	if shouldStop {
		s.markStopping()
		return true
	}
	return false
}

func (s *Service) markStopping() {
	s.mu.Lock()
	if s.status.isRunning && s.status.message != "正在终止任务流程" {
		s.status.message = "正在终止任务流程"
	}
	s.mu.Unlock()
}

func (s *Service) setCurrentTask(index int, name, id, message string) {
	s.mu.Lock()
	s.status.currentStep = index
	s.status.currentTask = &name
	s.status.currentTaskID = &id
	s.status.message = message
	s.mu.Unlock()
}

func (s *Service) emitProgress(currentStep, totalSteps int, name, id, message string, results []ScheduleTaskResult) {
	if s.options.OnProgress == nil {
		return
	}
	progress := map[string]any{
		"currentStep": currentStep,
		"totalSteps":  totalSteps,
		"message":     message,
		"updatedAt":   s.nowISO(),
	}
	if name != "" {
		progress["currentTask"] = name
	} else {
		progress["currentTask"] = nil
	}
	if id != "" {
		progress["currentTaskId"] = id
	} else {
		progress["currentTaskId"] = nil
	}
	copied := make([]ScheduleTaskResult, len(results))
	copy(copied, results)
	s.options.OnProgress(progress, copied)
}

// runSpec executes a built command. Dynamic task configs use RunTask; command
// specs use RunCommand. Both wait for completion.
func (s *Service) runSpec(ctx context.Context, spec CommandSpec, task map[string]any) (stdout, stderr, runID string, err error) {
	if s.executor == nil {
		return "", "", "", apperrors.New("SCHEDULER_EXECUTOR_MISSING", "任务执行器未配置")
	}
	name := taskName(task)
	taskType := stringField(task, "taskType")
	var result domainrun.DTO
	if spec.TaskConfig != nil {
		if _, exists := spec.TaskConfig["address"]; !exists {
			if address := s.connectionDefaults().Address; address != "" {
				spec.TaskConfig["address"] = address
			}
		}
		result, err = s.executor.RunTask(ctx, spec.TaskConfig, true)
	} else {
		result, err = s.executor.RunCommand(ctx, spec.Command, spec.Args, name, taskType, true)
	}
	if err != nil {
		errorStdout, errorStderr := errorOutput(err)
		return errorStdout, errorStderr, result.RunID, err
	}
	stdout, stderr = resultOutput(result)
	return stdout, stderr, result.RunID, nil
}

func (s *Service) recordDrops(summary *TaskSummary, scheduleID string) {
	if summary == nil || summary.Stage == "" || s.options.DropRecorder == nil {
		return
	}
	times := float64(1)
	if number, ok := numberValue(summary.Times); ok && number > 1 {
		times = number
	}
	items := make([]any, 0, len(summary.DropItems))
	for _, item := range summary.DropItems {
		items = append(items, map[string]any{"name": item.Name, "count": item.Count})
	}
	sanity := math.Max(0, summary.Sanity)
	medicine := float64(0)
	if number, ok := numberValue(summary.Medicine); ok {
		medicine = math.Max(0, number)
	}
	stone := float64(0)
	if number, ok := numberValue(summary.Stone); ok {
		stone = math.Max(0, number)
	}
	payload := map[string]any{
		"stage":    summary.Stage,
		"times":    times,
		"items":    items,
		"sanity":   sanity,
		"medicine": medicine,
		"stone":    stone,
	}
	if err := s.options.DropRecorder.RecordDrops(payload); err != nil {
		s.logger.Error("掉落记录保存失败", "scheduleId", scheduleID, "error", err.Error())
	}
}

func (s *Service) recordSummary(e *flowExecution, taskName, stdout string) *TaskSummary {
	if stdout == "" {
		return nil
	}
	summary := ParseTaskSummary(taskName, stdout)
	if summary != nil {
		e.summaries = append(e.summaries, *summary)
	}
	return summary
}

func isFalse(value any) bool {
	boolean, ok := value.(bool)
	return ok && !boolean
}

var awardItemKeys = []string{"award", "mail", "recruit", "orundum", "mining", "specialaccess", "signinevent"}

func enabledAwardItemCount(params map[string]any) int {
	count := 0
	for _, key := range awardItemKeys {
		if value, ok := params[key].(bool); ok && value {
			count++
		}
	}
	return count
}

func facilityCount(params map[string]any) int {
	switch facilities := params["facility"].(type) {
	case []any:
		return len(facilities)
	case []string:
		return len(facilities)
	default:
		return 0
	}
}

// executeSimpleCommand handles recruit, infrast, mall and award, whose Node
// versions add one structured action and a short delay. Log-callback detail
// parsing is not in the executor interface, so the action reports completion.
func (s *Service) executeSimpleCommand(ctx context.Context, e *flowExecution, task map[string]any, defaults ConnectionDefaults, kind string) bool {
	name := taskName(task)
	params := taskParams(task)
	var skipReason string
	switch kind {
	case "infrast":
		if facilityCount(params) == 0 {
			skipReason = "未选择任何基建设施，已跳过"
		}
	case "mall":
		if isFalse(params["visit_friends"]) && isFalse(params["shopping"]) && isFalse(params["credit_fight"]) {
			skipReason = "未启用好友访问、信用购物或信用作战，已跳过"
		}
	case "award":
		if enabledAwardItemCount(params) == 0 {
			skipReason = "未启用任何领取项目，已跳过"
		}
	}
	if skipReason != "" {
		e.skippedCount++
		e.recordSkip(name, skipReason)
		e.recordAction(TaskActionResult{Task: name, Action: kind, Status: "skipped", Message: skipReason})
		return false
	}

	spec, err := BuildScheduledTaskCommand(task, defaults)
	if err != nil {
		s.logger.Error("任务执行失败", "taskName", name, "error", err.Error())
		e.recordError(name, err)
		e.recordAction(TaskActionResult{Task: name, Action: kind, Status: "failed", Message: simpleFailureMessage(kind, err)})
		return false
	}

	stdout, _, _, runErr := s.runSpec(ctx, spec, task)
	if runErr != nil && isTransientMAAUpdateFailure(runErr) && ctx.Err() == nil {
		s.logger.Warn("MAA 资源更新网络失败，重试任务", "taskName", name, "error", runErr.Error())
		select {
		case <-time.After(transientRetryDelay):
			stdout, _, _, runErr = s.runSpec(ctx, spec, task)
		case <-ctx.Done():
		}
	}
	if runErr != nil {
		if s.stopRequested(ctx) {
			return true
		}
		s.logger.Error("任务执行失败", "taskName", name, "error", runErr.Error())
		e.recordError(name, runErr)
		e.recordAction(TaskActionResult{Task: name, Action: kind, Status: "failed", Message: simpleFailureMessage(kind, runErr)})
		return false
	}

	summary := s.recordSummary(e, name, stdout)
	_ = summary
	message := simpleSuccessMessage(kind, params)
	e.successCount++
	e.recordAction(TaskActionResult{Task: name, Action: kind, Status: "success", Message: message})
	return !s.delay(ctx, 2*time.Second)
}

func simpleFailureMessage(kind string, err error) string {
	switch kind {
	case "award":
		return "领取奖励失败：" + err.Error()
	case "recruit":
		return "自动公招失败：" + err.Error()
	case "infrast":
		return "基建任务失败：" + err.Error()
	case "mall":
		return "信用收支失败：" + err.Error()
	default:
		return err.Error()
	}
}

func simpleSuccessMessage(kind string, params map[string]any) string {
	switch kind {
	case "award":
		return "领取奖励流程已完成"
	case "recruit":
		return "自动公招流程已完成"
	case "infrast":
		return fmt.Sprintf("基建流程已完成，按配置处理 %d 类设施", facilityCount(params))
	case "mall":
		return "信用收支流程已完成"
	default:
		return "任务已完成"
	}
}

// executeStartup mirrors the StartUp retry policy: launch mode retries twice,
// connect-only mode never retries.
func (s *Service) executeStartup(ctx context.Context, e *flowExecution, task map[string]any, defaults ConnectionDefaults) (stop bool, failed bool) {
	name := taskName(task)
	params := taskParams(task)
	launchGame := !isFalse(params["startGameEnabled"])
	maxRetries := 0
	if launchGame {
		maxRetries = 2
	}
	spec, err := BuildScheduledTaskCommand(task, defaults)
	if err != nil {
		e.recordError(name, err)
		e.recordAction(TaskActionResult{Task: name, Action: "startup", Status: "failed", Message: err.Error()})
		return false, true
	}
	clientType := firstNonEmptyString(params["clientType"], defaults.ClientType)
	if clientType == "" {
		clientType = DefaultClientType
	}
	if s.options.DeviceProbe != nil {
		if probeErr := s.options.DeviceProbe.TestConnection(ctx, defaults.ADBPath, defaults.Address); probeErr != nil {
			message := "模拟器连接失败：" + probeErr.Error()
			e.recordError(name, probeErr)
			e.recordAction(TaskActionResult{Task: name, Action: "startup", Status: "failed", Message: message})
			return false, true
		}
	}

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if s.stopRequested(ctx) {
			return true, false
		}
		if attempt > 0 {
			s.logger.Info("启动游戏重试", "taskName", name, "retryCount", attempt, "maxRetries", maxRetries)
			if !s.delay(ctx, 3*time.Second) {
				return true, false
			}
		}
		if !launchGame && s.options.DeviceProbe != nil {
			running, foreground, probeErr := s.options.DeviceProbe.GameForeground(ctx, defaults.ADBPath, defaults.Address, clientType)
			if probeErr != nil || !running {
				lastErr = fmt.Errorf("启动游戏客户端未勾选，且游戏未在前台运行（当前应用：%s）", firstNonEmptyString(foreground, "未知"))
				continue
			}
		}
		_, _, _, runErr := s.runSpec(ctx, spec, task)
		if runErr == nil {
			if s.options.DeviceProbe != nil {
				running, foreground, probeErr := s.options.DeviceProbe.GameForeground(ctx, defaults.ADBPath, defaults.Address, clientType)
				if probeErr != nil || !running {
					lastErr = fmt.Errorf("游戏未在前台，当前应用：%s", firstNonEmptyString(foreground, "未知"))
					continue
				}
				if probeErr := s.options.DeviceProbe.CaptureScreen(ctx, defaults.ADBPath, defaults.Address); probeErr != nil {
					lastErr = fmt.Errorf("游戏截图校验失败：%w", probeErr)
					continue
				}
			}
			accountName := stringField(params, "accountName")
			message := ""
			switch {
			case launchGame && accountName != "":
				message = fmt.Sprintf("游戏已启动，账号 %s 已匹配", accountName)
			case launchGame:
				message = "游戏已启动并进入前台"
			case accountName != "":
				message = fmt.Sprintf("游戏已在前台，账号 %s 已匹配", accountName)
			default:
				message = "仅建立 MAA 连接，游戏已在前台运行"
			}
			e.successCount++
			e.recordAction(TaskActionResult{Task: name, Action: "startup", Status: "success", Message: message})
			return false, false
		}
		if s.stopRequested(ctx) {
			s.logger.Warn("启动游戏已终止，不再重试", "taskName", name)
			return true, false
		}
		lastErr = runErr
	}

	if lastErr == nil {
		lastErr = apperrors.New("SCHEDULER_STARTUP_FAILED", "启动游戏失败")
	}
	s.logger.Error("任务执行失败", "taskName", name, "error", lastErr.Error())
	e.recordError(name, lastErr)
	e.recordAction(TaskActionResult{Task: name, Action: "startup", Status: "failed", Message: lastErr.Error()})
	return false, true
}

func (s *Service) executeGeneric(ctx context.Context, e *flowExecution, task map[string]any, defaults ConnectionDefaults, commandID string) bool {
	name := taskName(task)
	if commandID == "closedown" && !e.startupFailed && boolField(taskParams(task), "recognizeDepotBeforeClose") {
		s.recognizeDepotBeforeClose(ctx, defaults)
	}
	spec, err := BuildScheduledTaskCommand(task, defaults)
	if err != nil {
		e.recordError(name, err)
		if commandID == "closedown" {
			e.recordAction(TaskActionResult{Task: name, Action: "closedown", Status: "failed", Message: "关闭游戏失败：" + err.Error()})
		}
		return false
	}

	stdout, stderr, _, runErr := s.runSpec(ctx, spec, task)
	if s.stopRequested(ctx) {
		return true
	}
	if runErr != nil {
		if commandID == "closedown" {
			e.recordAction(TaskActionResult{Task: name, Action: "closedown", Status: "failed", Message: "关闭游戏失败：" + runErr.Error()})
		}
		e.recordError(name, runErr)
		return false
	}

	if commandID == "closedown" {
		e.recordAction(TaskActionResult{Task: name, Action: "closedown", Status: "success", Message: "游戏客户端已关闭"})
	}
	if commandID != "fight" {
		e.successCount++
	}
	if commandID == "fight" {
		e.reports = append(e.reports, GetFightReportResults(task, "", stdout, stderr)...)
	}
	summary := s.recordSummary(e, name, stdout)
	if commandID == "fight" {
		s.recordDrops(summary, e.scheduleID)
	}
	delay := 2 * time.Second
	if commandID == "startup" {
		delay = 15 * time.Second
	} else if commandID == "closedown" {
		delay = 3 * time.Second
	}
	return !s.delay(ctx, delay)
}

func (s *Service) recognizeDepotBeforeClose(ctx context.Context, defaults ConnectionDefaults) {
	if s.options.DepotRecognizer == nil {
		s.logger.Warn("仓库识别服务未接入，跳过关闭前识别")
		return
	}
	taskConfig := map[string]any{
		"name":   "仓库识别",
		"type":   "Depot",
		"params": map[string]any{"enable": true},
	}
	if defaults.ClientType != "" {
		taskConfig["client_type"] = defaults.ClientType
	}
	if _, err := s.executor.RunTask(ctx, taskConfig, true); err != nil {
		s.logger.Warn("关闭前仓库识别失败", "error", err.Error())
		return
	}
	if err := s.options.DepotRecognizer.RecognizeDepot(ctx); err != nil {
		s.logger.Warn("关闭前仓库解析失败", "error", err.Error())
	}
}

func parseStageEntries(stageInput string) []NormalizedFightStage {
	entries := make([]NormalizedFightStage, 0, 4)
	for _, entry := range strings.Split(stageInput, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		parts := strings.SplitN(entry, ":", 2)
		stage := strings.TrimSpace(parts[0])
		times := ""
		var timesRaw any
		if len(parts) == 2 {
			times = strings.TrimSpace(parts[1])
			timesRaw = times
		}
		if stage != "" {
			entries = append(entries, NormalizedFightStage{Stage: stage, Times: times, TimesRaw: timesRaw})
		}
	}
	return entries
}

func configuredFightStage(task map[string]any) string {
	params := taskParams(task)
	if stages, ok := params["stages"].([]any); ok && len(stages) > 0 {
		if first, ok := stages[0].(map[string]any); ok {
			if stage, ok := first["stage"].(string); ok && stage != "" {
				return stage
			}
		}
	}
	return stringField(params, "stage")
}

func filterSeries(args []string) []string {
	filtered := make([]string, 0, len(args))
	for index := 0; index < len(args); index++ {
		arg := args[index]
		if strings.HasPrefix(arg, "--series=") {
			continue
		}
		if arg == "--series" {
			index++
			continue
		}
		filtered = append(filtered, arg)
	}
	return filtered
}

func containsArg(args []string, expected string) bool {
	for _, arg := range args {
		if arg == expected {
			return true
		}
	}
	return false
}

func (s *Service) stageOpen(stage string) (bool, string) {
	if s.options.StageOpenChecker == nil {
		return true, ""
	}
	return s.options.StageOpenChecker.IsStageOpen(stage, s.connectionDefaults().ClientType)
}

func (s *Service) executeFight(ctx context.Context, e *flowExecution, task map[string]any, defaults ConnectionDefaults) bool {
	task = s.resolveFightStages(task, defaults)
	spec, err := BuildScheduledTaskCommand(task, defaults)
	if err != nil {
		s.fightBuildFailure(e, task, err)
		return false
	}
	if spec.TaskConfig != nil {
		return s.executeDynamicFight(ctx, e, task, spec)
	}
	if len(spec.Args) == 0 {
		return s.executeFightOnce(ctx, e, task, spec, "", "")
	}
	entries := parseStageEntries(spec.Args[0])
	if len(entries) == 0 {
		return s.executeFightOnce(ctx, e, task, spec, "", "")
	}
	if len(entries) == 1 {
		return s.executeSingleStage(ctx, e, task, spec, entries[0])
	}
	return s.executeMultiStage(ctx, e, task, spec, entries)
}

func (s *Service) resolveFightStages(task map[string]any, defaults ConnectionDefaults) map[string]any {
	if s.options.ResolveStage == nil {
		return task
	}
	params := taskParams(task)
	clientType := firstNonEmptyString(params["clientType"], params["client_type"], defaults.ClientType)
	nextParams := copyMap(params)
	if stage, ok := nextParams["stage"].(string); ok {
		nextParams["stage"] = s.options.ResolveStage(stage, clientType)
	}
	if stages, ok := nextParams["stages"].([]any); ok {
		resolved := make([]any, 0, len(stages))
		for _, raw := range stages {
			switch typed := raw.(type) {
			case string:
				resolved = append(resolved, s.options.ResolveStage(typed, clientType))
			case map[string]any:
				item := copyMap(typed)
				if stage, ok := item["stage"].(string); ok {
					item["stage"] = s.options.ResolveStage(stage, clientType)
				}
				resolved = append(resolved, item)
			default:
				resolved = append(resolved, raw)
			}
		}
		nextParams["stages"] = resolved
	}
	clone := copyMap(task)
	clone["params"] = nextParams
	return clone
}

func (s *Service) fightBuildFailure(e *flowExecution, task map[string]any, err error) {
	name := taskName(task)
	e.recordError(name, err)
	e.recordAction(buildFightAction(name, configuredFightStage(task), nil, "", err, ""))
}

func (s *Service) executeDynamicFight(ctx context.Context, e *flowExecution, task map[string]any, spec CommandSpec) bool {
	name := taskName(task)
	requestedStage := configuredFightStage(task)
	start := len(e.actions)
	stdout, stderr, _, runErr := s.runSpec(ctx, spec, task)
	if s.stopRequested(ctx) {
		return true
	}
	if runErr != nil {
		e.addFightAction(buildFightAction(name, requestedStage, nil, stdout+stderr, runErr, ""))
		e.countFightActions(start)
		return false
	}
	e.reports = append(e.reports, GetFightReportResults(task, requestedStage, stdout, stderr)...)
	summary := s.recordSummary(e, name, stdout)
	s.recordDrops(summary, e.scheduleID)
	e.addFightAction(buildFightAction(name, requestedStage, summary, stdout+stderr, nil, ""))
	e.countFightActions(start)
	return !s.delay(ctx, 2*time.Second)
}

func (s *Service) executeFightOnce(ctx context.Context, e *flowExecution, task map[string]any, spec CommandSpec, displayName, stage string) bool {
	name := taskName(task)
	if displayName == "" {
		displayName = name
	}
	start := len(e.actions)
	stdout, stderr, _, runErr := s.runSpec(ctx, spec, task)
	if s.stopRequested(ctx) {
		return true
	}
	if runErr != nil {
		e.addFightAction(buildFightAction(displayName, stage, nil, stdout+stderr, runErr, ""))
		e.countFightActions(start)
		return false
	}
	e.reports = append(e.reports, GetFightReportResults(task, stage, stdout, stderr)...)
	summary := s.recordSummary(e, displayName, stdout)
	s.recordDrops(summary, e.scheduleID)
	action := buildFightAction(displayName, stage, summary, stdout+stderr, nil, "")
	e.addFightAction(action)
	e.countFightActions(start)
	return !s.delay(ctx, 2*time.Second)
}

func (s *Service) executeSingleStage(ctx context.Context, e *flowExecution, task map[string]any, spec CommandSpec, entry NormalizedFightStage) bool {
	name := taskName(task)
	displayName := fmt.Sprintf("%s (%s)", name, entry.Stage)
	if isOpen, reason := s.stageOpen(entry.Stage); !isOpen {
		if reason == "" {
			reason = "关卡今日未开放"
		}
		s.logger.Info("关卡今日未开放，跳过", "stage", entry.Stage, "reason", reason)
		start := len(e.actions)
		e.addFightAction(buildFightAction(displayName, entry.Stage, nil, "", nil, reason))
		e.countFightActions(start)
		return !s.delay(ctx, 2*time.Second)
	}

	args := append([]string(nil), spec.Args...)
	args[0] = entry.Stage
	if entry.Times != "" {
		if !containsArg(args, "--times") {
			args = append(args[:1], append([]string{"--times", entry.Times}, args[1:]...)...)
		}
		args = filterSeries(args)
	}
	stageSpec := spec
	stageSpec.Args = args
	return s.executeFightOnce(ctx, e, task, stageSpec, displayName, entry.Stage)
}

func (s *Service) executeMultiStage(ctx context.Context, e *flowExecution, task map[string]any, spec CommandSpec, entries []NormalizedFightStage) bool {
	name := taskName(task)
	start := len(e.actions)
	sanityDepleted := false
	stopped := false

	for index, entry := range entries {
		if s.stopRequested(ctx) {
			stopped = true
			break
		}
		displayName := fmt.Sprintf("%s (%s)", name, entry.Stage)
		if sanityDepleted {
			s.logger.Info("理智已耗尽，跳过关卡", "stage", entry.Stage)
			e.addFightAction(buildFightAction(displayName, entry.Stage, nil, "", nil, "理智已耗尽"))
			continue
		}
		if isOpen, reason := s.stageOpen(entry.Stage); !isOpen {
			if reason == "" {
				reason = "关卡今日未开放"
			}
			s.logger.Info("关卡今日未开放，跳过", "stage", entry.Stage, "reason", reason)
			e.addFightAction(buildFightAction(displayName, entry.Stage, nil, "", nil, reason))
			continue
		}

		args := []string{entry.Stage}
		if entry.Times != "" {
			args = append(args, "--times", entry.Times)
		}
		if entry.Times != "" {
			args = append(args, filterSeries(spec.Args[1:])...)
		} else {
			args = append(args, spec.Args[1:]...)
		}
		stageSpec := spec
		stageSpec.Args = args

		stdout, stderr, _, runErr := s.runSpec(ctx, stageSpec, task)
		if runErr != nil {
			if s.stopRequested(ctx) {
				stopped = true
				break
			}
			action := buildFightAction(displayName, entry.Stage, nil, stdout+stderr, runErr, "")
			if action.SanityDepleted {
				sanityDepleted = true
			}
			e.addFightAction(action)
		} else {
			if s.stopRequested(ctx) {
				stopped = true
				break
			}
			e.reports = append(e.reports, GetFightReportResults(task, entry.Stage, stdout, stderr)...)
			summary := s.recordSummary(e, displayName, stdout)
			s.recordDrops(summary, e.scheduleID)
			combined := stdout + stderr
			if IsFightSanityDepleted(combined, entry.Stage) {
				sanityDepleted = true
			}
			e.addFightAction(buildFightAction(displayName, entry.Stage, summary, combined, nil, ""))
		}

		if index < len(entries)-1 {
			if !s.delay(ctx, 2*time.Second) {
				stopped = true
				break
			}
		}
	}

	e.countFightActions(start)
	if stopped {
		return true
	}
	return !s.delay(ctx, 2*time.Second)
}

var transientRetryDelay = 2 * time.Second

// isTransientMAAUpdateFailure detects maa-cli's automatic resource update
// failing on the network before MaaCore starts. The next attempt usually
// succeeds, and no game action has happened yet.
func isTransientMAAUpdateFailure(err error) bool {
	_, stderr := errorOutput(err)
	text := strings.ToLower(stderr)
	return strings.Contains(text, "network error") || strings.Contains(text, "unexpected end of file")
}
