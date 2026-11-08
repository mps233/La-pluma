package scheduler

import (
	"context"
	"log/slog"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
)

// DefaultClientType mirrors DEFAULT_CLIENT_TYPE in the Node server.
const DefaultClientType = "Official"

// AutoUpdateScheduleID is the reserved registration id for the daily automatic
// update job, matching schedulerService.setupAutoUpdate.
const AutoUpdateScheduleID = "auto-update"

// TaskExecutor runs one MAA command or one dynamic task config. wait is always
// true for scheduled flows because their result summaries and drops need the
// command output before the next task starts.
type TaskExecutor interface {
	RunTask(ctx context.Context, taskConfig map[string]any, wait bool) (domainrun.DTO, error)
	RunCommand(ctx context.Context, command string, args []string, taskName, taskType string, wait bool) (domainrun.DTO, error)
	Stop(ctx context.Context) error
}

// DropRecorder persists a fight drop payload shaped like recordDrops():
// stage, times, items, sanity, medicine and stone.
type DropRecorder interface {
	RecordDrops(payload any) error
}

// AutoUpdater performs the configured MAA core/CLI update. The scheduler only
// owns the daily timer; execution and its lease stay in the implementing
// service.
type AutoUpdater interface {
	Run(ctx context.Context, config map[string]any) error
}

// ConfigSource decouples the scheduler from internal/app/config.Storage while
// keeping that package as the owner of user config files.
type ConfigSource interface {
	Load(configType string) (map[string]any, error)
}

// ConnectionDefaults carry the runtime connection values used by command
// building. The scheduler never resolves a profile itself.
type ConnectionDefaults struct {
	ADBPath    string `json:"adbPath,omitempty"`
	Address    string `json:"address,omitempty"`
	ClientType string `json:"clientType,omitempty"`
}

// Options configures a Service. Zero values are safe: timers use wall time and
// delays are real.
type Options struct {
	Logger              *slog.Logger
	Paths               config.Paths
	ConfigSource        ConfigSource
	ConnectionDefaults  ConnectionDefaults
	DropRecorder        DropRecorder
	AutoUpdater         AutoUpdater
	StageOpenChecker    StageOpenChecker
	OnProgress          func(progress map[string]any, taskResults []ScheduleTaskResult)
	Now                 func() time.Time
	Delay               func(ctx context.Context, duration time.Duration) bool
	DisableCronSchedule bool
	// WrapDailyFlow optionally runs a cron-triggered flow under an outer
	// tracked run. HTTP callers wrap their own request before calling
	// StartDailyFlow and leave this nil.
	WrapDailyFlow func(ctx context.Context, scheduleID string, run func(context.Context) DailyFlowResult) DailyFlowResult
	// ResolveStage rewrites an activity stage alias such as HD-7 to the
	// current activity code. Nil leaves stages unchanged.
	ResolveStage func(stage, clientType string) string
	// DepotRecognizer parses the MAA log after the closedown pre-task.
	DepotRecognizer DepotRecognizer
	// SmartStagesUpdater refreshes smart training stages after a flow.
	SmartStagesUpdater SmartStagesUpdater
	// CompletionNotifier sends the post-flow completion message.
	CompletionNotifier func(ctx context.Context, scheduleID string, summary *ExecutionSummary) error
	// DeviceProbe validates the emulator before and after a startup task.
	DeviceProbe DeviceProbe
}

// DeviceProbe is the ADB surface used by startup preflight and post-checks.
type DeviceProbe interface {
	TestConnection(ctx context.Context, adbPath, address string) error
	GameForeground(ctx context.Context, adbPath, address, clientType string) (running bool, foreground string, err error)
	CaptureScreen(ctx context.Context, adbPath, address string) error
}

// SmartStagesUpdater regenerates smart training stages from the queue.
type SmartStagesUpdater interface {
	UpdateSmartTrainingStages() error
}

// DepotRecognizer parses and persists the latest depot callback.
type DepotRecognizer interface {
	RecognizeDepot(ctx context.Context) error
}

// StageOpenChecker optionally supplies the daily stage-open decision that the
// Node scheduler gets from notificationService.isStageOpenToday.
type StageOpenChecker interface {
	IsStageOpen(stage string, clientType string) (isOpen bool, reason string)
}

// ScheduleResult is the setupSchedule/stopSchedule response.
type ScheduleResult struct {
	Success bool     `json:"success"`
	Message string   `json:"message,omitempty"`
	Times   []string `json:"times,omitempty"`
}

// ScheduleState is one entry of getScheduleStatus.
type ScheduleState struct {
	ScheduleID string   `json:"scheduleId"`
	Times      []string `json:"times"`
	Count      int      `json:"count"`
}

// AutoUpdateStatus mirrors getAutoUpdateStatus.
type AutoUpdateStatus struct {
	Enabled bool    `json:"enabled"`
	Time    *string `json:"time"`
}

// SetupAutoUpdateResult is the configure-auto-update response.
type SetupAutoUpdateResult struct {
	Success bool           `json:"success"`
	Message string         `json:"message,omitempty"`
	Config  map[string]any `json:"config,omitempty"`
}

// ValidationResult mirrors ScheduleValidationResult.
type ValidationResult struct {
	Success bool           `json:"success"`
	Message string         `json:"message,omitempty"`
	Details map[string]any `json:"details,omitempty"`
}

// PlanPreAction is an optional step that must run before a planned command.
type PlanPreAction struct {
	Action string `json:"action"`
}

// PlanStep mirrors SchedulePlanStep.
type PlanStep struct {
	Index       int             `json:"index"`
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Command     string          `json:"command"`
	Args        []string        `json:"args"`
	DynamicTask bool            `json:"dynamicTask"`
	TaskConfig  map[string]any  `json:"taskConfig,omitempty"`
	PreActions  []PlanPreAction `json:"preActions,omitempty"`
}

// PlanResult mirrors SchedulePlanResult.
type PlanResult struct {
	Success    bool           `json:"success"`
	Message    string         `json:"message,omitempty"`
	TotalSteps int            `json:"totalSteps,omitempty"`
	Steps      []PlanStep     `json:"steps,omitempty"`
	Details    map[string]any `json:"details,omitempty"`
}

// CommandSpec is the internal representation of buildScheduledTaskCommand.
type CommandSpec struct {
	Command    string
	Args       []string
	TaskConfig map[string]any
}

// FightDropItem is a structured drop entry.
type FightDropItem struct {
	Name  string  `json:"name"`
	Count float64 `json:"count"`
}

// RecruitSummary is one parsed recruit line.
type RecruitSummary struct {
	Stars any `json:"stars"`
	Tags  any `json:"tags"`
	State any `json:"state,omitempty"`
}

// TaskSummary mirrors parseTaskSummary's output.
type TaskSummary struct {
	Task         string           `json:"task,omitempty"`
	Stage        string           `json:"stage,omitempty"`
	Times        string           `json:"times,omitempty"`
	Drops        string           `json:"drops,omitempty"`
	DropItems    []FightDropItem  `json:"dropItems,omitempty"`
	Medicine     string           `json:"medicine,omitempty"`
	Stone        string           `json:"stone,omitempty"`
	Duration     string           `json:"duration,omitempty"`
	Recruits     []RecruitSummary `json:"recruits,omitempty"`
	RecruitCount *int             `json:"recruitCount,omitempty"`
	RefreshCount *int             `json:"refreshCount,omitempty"`
	Infrast      string           `json:"infrast,omitempty"`
	Sanity       float64          `json:"sanity,omitempty"`
}

// FightReportResult is one penguin/yituliu report outcome.
type FightReportResult struct {
	Provider string `json:"provider"`
	Stage    string `json:"stage"`
	Status   string `json:"status"`
	Message  string `json:"message"`
}

// TaskActionResult is the union of the per-command action results. Fight
// fields are omitted for other actions.
type TaskActionResult struct {
	Task           string  `json:"task,omitempty"`
	Action         string  `json:"action"`
	Status         string  `json:"status"`
	Message        string  `json:"message"`
	Stage          string  `json:"stage,omitempty"`
	Times          float64 `json:"times,omitempty"`
	DropCount      int     `json:"dropCount,omitempty"`
	Drops          string  `json:"drops,omitempty"`
	Medicine       float64 `json:"medicine,omitempty"`
	Stone          float64 `json:"stone,omitempty"`
	Sanity         float64 `json:"sanity,omitempty"`
	Duration       string  `json:"duration,omitempty"`
	SanityDepleted bool    `json:"sanityDepleted,omitempty"`
}

// TaskErrorEntry and TaskSkipEntry mirror the Node execution entries.
type TaskErrorEntry struct {
	Task  string `json:"task,omitempty"`
	Error string `json:"error"`
}

type TaskSkipEntry struct {
	Task   string `json:"task,omitempty"`
	Reason string `json:"reason"`
}

// ScheduleTaskResult is one task-result lifecycle entry.
type ScheduleTaskResult struct {
	ID         string `json:"id"`
	Name       string `json:"name,omitempty"`
	State      string `json:"state"`
	StartedAt  string `json:"startedAt"`
	FinishedAt string `json:"finishedAt,omitempty"`
}

// ExecutionSummary is the summary returned by a completed flow.
type ExecutionSummary struct {
	SuccessCount int                  `json:"successCount"`
	FailedCount  int                  `json:"failedCount"`
	SkippedCount int                  `json:"skippedCount"`
	DurationMS   int64                `json:"durationMs"`
	Summaries    []TaskSummary        `json:"summaries"`
	Reports      []FightReportResult  `json:"reports"`
	Actions      []TaskActionResult   `json:"actions"`
	TaskResults  []ScheduleTaskResult `json:"taskResults"`
	Errors       []TaskErrorEntry     `json:"errors"`
	Warnings     []string             `json:"warnings"`
}

// ExecutionStatus mirrors getScheduleExecutionStatus without the last result.
type ExecutionStatus struct {
	IsRunning          bool    `json:"isRunning"`
	ScheduleID         *string `json:"scheduleId"`
	CurrentStep        int     `json:"currentStep"`
	TotalSteps         int     `json:"totalSteps"`
	CurrentTask        *string `json:"currentTask"`
	CurrentTaskID      *string `json:"currentTaskId,omitempty"`
	Message            string  `json:"message"`
	StartTime          *int64  `json:"startTime"`
	ShouldStop         bool    `json:"shouldStop"`
	HasLastResult      bool    `json:"hasLastResult"`
	LastResultRevision int64   `json:"lastResultRevision"`
	LastResult         any     `json:"lastResult,omitempty"`
}

// DailyFlowRequest is the typed input to StartDailyFlow.
type DailyFlowRequest struct {
	ScheduleID string
	TaskFlow   any
	DryRun     bool
}

// DailyFlowResult mirrors ScheduleExecutionResult plus plan fields.
type DailyFlowResult struct {
	Success    bool              `json:"success"`
	Message    string            `json:"message,omitempty"`
	Stopped    bool              `json:"stopped,omitempty"`
	Busy       bool              `json:"busy,omitempty"`
	Owner      any               `json:"owner,omitempty"`
	Summary    *ExecutionSummary `json:"summary,omitempty"`
	RunID      string            `json:"runId,omitempty"`
	ScheduleID string            `json:"scheduleId,omitempty"`
	DryRun     bool              `json:"dryRun,omitempty"`
	TotalSteps int               `json:"totalSteps,omitempty"`
	Plan       []PlanStep        `json:"plan,omitempty"`
}

// RestoreEntry is one runtime-initialization restoration outcome.
type RestoreEntry struct {
	Restored bool   `json:"restored"`
	Message  string `json:"message,omitempty"`
	Error    string `json:"error,omitempty"`
}

// RestoreSummary mirrors the schedule/autoUpdate slice of runtime init.
type RestoreSummary struct {
	Schedule   RestoreEntry `json:"schedule"`
	AutoUpdate RestoreEntry `json:"autoUpdate"`
}
