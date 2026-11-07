package mastery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const (
	defaultStepTimeout = 300 * time.Second
	defaultLogMaxBytes = 2 * 1024 * 1024
	callbackMarker     = "Assistant::append_callback | "
)

var versionPattern = regexp.MustCompile(`^\d+(?:\.\d+)+`)

// Executor is the injected MAA task execution surface. Tests use fakes; the
// production adapter wraps app/maa.Service.
type Executor interface {
	RunTask(ctx context.Context, taskConfig map[string]any, wait bool) (domainrun.DTO, error)
	Stop(ctx context.Context) error
}

// VersionProvider returns the installed maa-cli and MaaCore versions.
type VersionProvider interface {
	MAAVersion(ctx context.Context) (cli string, core string, err error)
}

// LogCheckpoint identifies a byte offset in the MAA asst.log file.
type LogCheckpoint struct {
	Path string
	Size int64
}

// LogReader reads MAA callback deltas after a checkpoint.
type LogReader interface {
	CreateCheckpoint(ctx context.Context) (*LogCheckpoint, error)
	ReadSince(ctx context.Context, checkpoint *LogCheckpoint, maxBytes int64) (string, error)
}

// GameStateProbe reports whether the game is already in the foreground. It is
// used only to decide whether OperProgress should close the game first.
type GameStateProbe interface {
	GameRunning(ctx context.Context, clientType, profileID string) (bool, error)
}

// RunOptions configures the mastery run service.
type RunOptions struct {
	Executor    Executor
	Versions    VersionProvider
	Logs        LogReader
	GameState   GameStateProbe
	Logger      *slog.Logger
	Now         func() time.Time
	StepTimeout time.Duration
}

// RunService builds and executes one OperProgress step at a time. Run
// persistence and idempotency belong to the injected Executor.
type RunService struct {
	executor    Executor
	versions    VersionProvider
	logs        LogReader
	gameState   GameStateProbe
	logger      *slog.Logger
	now         func() time.Time
	stepTimeout time.Duration
}

// NewRunService returns a run service. A nil executor fails closed at execute
// time instead of attempting a real MAA call.
func NewRunService(options RunOptions) *RunService {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	now := options.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	stepTimeout := options.StepTimeout
	if stepTimeout <= 0 {
		stepTimeout = defaultStepTimeout
	}
	return &RunService{
		executor:    options.Executor,
		versions:    options.Versions,
		logs:        options.Logs,
		gameState:   options.GameState,
		logger:      logger,
		now:         now,
		stepTimeout: stepTimeout,
	}
}

// ParseVersion extracts the leading dotted numeric version.
func ParseVersion(value string) []int {
	text := strings.TrimPrefix(strings.TrimSpace(value), "v")
	text = strings.TrimPrefix(text, "V")
	match := versionPattern.FindString(text)
	if match == "" {
		return nil
	}
	parts := strings.Split(match, ".")
	result := make([]int, 0, len(parts))
	for _, part := range parts {
		parsed64, convErr := strconv.ParseInt(part, 10, 32)
		if convErr != nil {
			return nil
		}
		result = append(result, int(parsed64))
	}
	return result
}

// CompareVersions compares numeric version components; a nil actual version
// sorts before any minimum.
func CompareVersions(actual []int, minimum []int) int {
	if actual == nil {
		return -1
	}
	length := len(actual)
	if len(minimum) > length {
		length = len(minimum)
	}
	for index := 0; index < length; index++ {
		left, right := 0, 0
		if index < len(actual) {
			left = actual[index]
		}
		if index < len(minimum) {
			right = minimum[index]
		}
		if left != right {
			return left - right
		}
	}
	return 0
}

// CheckRuntimeSupport compares installed versions against the OperProgress
// minimums.
func (s *RunService) CheckRuntimeSupport(ctx context.Context) RuntimeSupport {
	minimumCLI := ParseVersion(minimumCLIVersion)
	minimumCore := ParseVersion(minimumCoreVersion)
	if s.versions == nil {
		reason := "无法读取 MAA 版本：未配置 MAA 版本读取器"
		return RuntimeSupport{
			Supported:   false,
			MinimumCLI:  minimumCLIVersion,
			MinimumCore: minimumCoreVersion,
			Reason:      &reason,
		}
	}
	cli, core, err := s.versions.MAAVersion(ctx)
	if err != nil {
		reason := "无法读取 MAA 版本：" + errorMessage(err)
		return RuntimeSupport{
			Supported:   false,
			MinimumCLI:  minimumCLIVersion,
			MinimumCore: minimumCoreVersion,
			Reason:      &reason,
		}
	}
	cliOK := CompareVersions(ParseVersion(cli), minimumCLI) >= 0
	coreOK := CompareVersions(ParseVersion(core), minimumCore) >= 0
	var reason *string
	if !cliOK || !coreOK {
		cliValue := cli
		if cliValue == "" {
			cliValue = "未知"
		}
		coreValue := core
		if coreValue == "" {
			coreValue = "未知"
		}
		message := fmt.Sprintf(
			"需要 maa-cli %s+ / MaaCore %s+，当前为 %s / %s",
			minimumCLIVersion,
			minimumCoreVersion,
			cliValue,
			coreValue,
		)
		reason = &message
	}
	return RuntimeSupport{
		Supported:   cliOK && coreOK,
		CLI:         cli,
		Core:        core,
		MinimumCLI:  minimumCLIVersion,
		MinimumCore: minimumCoreVersion,
		Reason:      reason,
	}
}

// TaskBuildOptions controls the optional game lifecycle tasks.
type TaskBuildOptions struct {
	StartGameEnabled bool
	CloseDown        bool
}

// BuildOperProgressTaskConfig mirrors buildOperProgressTaskConfig. It targets
// exactly one skill slot and never emits elite/skill-level actions.
func BuildOperProgressTaskConfig(item MasteryQueueItem, stepTarget int, clientType string, options TaskBuildOptions) (map[string]any, error) {
	normalizedClient, err := normalizeClientType(clientType)
	if err != nil {
		return nil, err
	}
	skillMastery := []int{0, 0, 0}
	if item.SkillIndex >= 1 && item.SkillIndex <= 3 {
		skillMastery[item.SkillIndex-1] = stepTarget
	}

	tasks := make([]any, 0, 3)
	if options.CloseDown {
		tasks = append(tasks, map[string]any{
			"name": "关闭游戏",
			"type": "CloseDown",
			"params": map[string]any{
				"client_type": normalizedClient,
			},
		})
	}
	tasks = append(tasks, map[string]any{
		"name": "启动游戏",
		"type": "StartUp",
		"params": map[string]any{
			"client_type":        normalizedClient,
			"start_game_enabled": options.StartGameEnabled,
		},
	})
	plan := map[string]any{
		"name":          item.OperatorName,
		"skill_mastery": skillMastery,
	}
	if item.Role != nil && *item.Role != "" {
		plan["role"] = *item.Role
	}
	tasks = append(tasks, map[string]any{
		"name": fmt.Sprintf("专精 %s %s M%d", item.OperatorName, item.SkillName, stepTarget),
		"type": "OperProgress",
		"params": map[string]any{
			"plans": []any{plan},
		},
	})
	return map[string]any{
		"client_type": normalizedClient,
		"tasks":       tasks,
	}, nil
}

type callbackPayload struct {
	What    string
	Details map[string]any
}

func parseCallbackPayloads(logOutput string) []callbackPayload {
	events := make([]callbackPayload, 0)
	for _, line := range strings.Split(logOutput, "\n") {
		markerIndex := strings.Index(line, callbackMarker)
		if markerIndex == -1 {
			continue
		}
		callback := line[markerIndex+len(callbackMarker):]
		jsonIndex := strings.Index(callback, "{")
		if jsonIndex == -1 {
			continue
		}
		decoder := json.NewDecoder(strings.NewReader(callback[jsonIndex:]))
		decoder.UseNumber()
		var parsed any
		if err := decoder.Decode(&parsed); err != nil {
			continue
		}
		record, ok := asRecord(parsed)
		if !ok {
			continue
		}
		payload := callbackPayload{}
		payload.What, _ = record["what"].(string)
		payload.Details, _ = asRecord(record["details"])
		events = append(events, payload)
	}
	return events
}

// ExtractResultDetail parses OperProgressDetail callbacks from MAA logs and
// selects the last event for the target operator.
func ExtractResultDetail(logOutput string, item MasteryQueueItem) ResultDetail {
	events := make([]callbackPayload, 0)
	for _, event := range parseCallbackPayloads(logOutput) {
		if event.What == "OperProgressDetail" {
			events = append(events, event)
		}
	}
	matching := make([]callbackPayload, 0, len(events))
	for _, event := range events {
		name, _ := event.Details["name"].(string)
		if name == "" || name == item.OperatorName {
			matching = append(matching, event)
		}
	}
	var event *callbackPayload
	if len(matching) > 0 {
		event = &matching[len(matching)-1]
	} else if len(events) > 0 {
		event = &events[len(events)-1]
	}
	if event == nil {
		return ResultDetail{ResultDetail: "Unknown", LogCheckpointPresent: false}
	}
	details := event.Details
	resultDetail, ok := details["result_detail"].(string)
	if !ok {
		resultDetail = "Unknown"
	}
	var result *string
	if value, ok := details["result"].(string); ok {
		result = &value
	}
	return ResultDetail{
		ResultDetail:         resultDetail,
		Result:               result,
		SkillMastery:         flexNumbers(details["skill_mastery"]),
		LogCheckpointPresent: true,
	}
}

// StepOptions controls one execution attempt.
type StepOptions struct {
	StartGameEnabled bool
	ProfileID        string
}

// ExecuteStep runs at most one mastery level for the item. The step target is
// min(targetLevel, confirmedLevel+1).
func (s *RunService) ExecuteStep(ctx context.Context, item MasteryQueueItem, clientType string, options StepOptions) (StepOutcome, error) {
	if item.ConfirmedLevel >= item.TargetLevel {
		return StepOutcome{}, apperrors.WithStatus(
			"AGENT_MASTERY_ALREADY_COMPLETED",
			"该专精目标已经完成",
			http.StatusConflict,
			false,
			map[string]any{"itemId": item.ID},
		)
	}
	stepTarget := minInt(item.TargetLevel, item.ConfirmedLevel+1)
	return s.runOneStep(ctx, item, stepTarget, clientType, options)
}

func (s *RunService) runOneStep(ctx context.Context, item MasteryQueueItem, stepTarget int, clientType string, options StepOptions) (StepOutcome, error) {
	support := s.CheckRuntimeSupport(ctx)
	if !support.Supported {
		message := "当前 MAA 版本不支持专精任务"
		if support.Reason != nil && *support.Reason != "" {
			message = *support.Reason
		}
		return StepOutcome{}, apperrors.WithStatus(
			"AGENT_MASTERY_UNSUPPORTED_VERSION",
			message,
			http.StatusConflict,
			true,
			map[string]any{
				"cli":         support.CLI,
				"core":        support.Core,
				"minimumCli":  support.MinimumCLI,
				"minimumCore": support.MinimumCore,
			},
		)
	}

	closeDown := false
	if options.StartGameEnabled && s.gameState != nil {
		profileID := options.ProfileID
		if profileID == "" {
			profileID = "default"
		}
		running, err := s.gameState.GameRunning(ctx, clientType, profileID)
		if err != nil {
			s.logger.Warn("读取游戏前台状态失败，跳过关闭游戏步骤", "error", err)
		} else {
			closeDown = running
		}
	}
	taskConfig, err := BuildOperProgressTaskConfig(item, stepTarget, clientType, TaskBuildOptions{
		StartGameEnabled: options.StartGameEnabled,
		CloseDown:        closeDown,
	})
	if err != nil {
		return StepOutcome{}, err
	}
	if s.executor == nil {
		return StepOutcome{}, apperrors.WithStatus(
			"AGENT_MASTERY_EXECUTION_UNAVAILABLE",
			"专精执行器未配置",
			http.StatusServiceUnavailable,
			true,
			map[string]any{"itemId": item.ID},
		)
	}

	var checkpoint *LogCheckpoint
	if s.logs != nil {
		if created, checkpointErr := s.logs.CreateCheckpoint(ctx); checkpointErr == nil {
			checkpoint = created
		}
	}

	stepCtx := ctx
	var cancel context.CancelFunc
	if s.stepTimeout > 0 {
		stepCtx, cancel = context.WithTimeout(ctx, s.stepTimeout)
		defer cancel()
	}
	dto, runErr := s.executor.RunTask(stepCtx, taskConfig, true)
	timedOut := errors.Is(stepCtx.Err(), context.DeadlineExceeded)

	logText := ""
	if s.logs != nil && checkpoint != nil {
		readCtx, readCancel := context.WithTimeout(context.Background(), 5*time.Second)
		logText, _ = s.logs.ReadSince(readCtx, checkpoint, defaultLogMaxBytes)
		readCancel()
	}
	if logText == "" {
		logText = dtoText(dto)
	}
	parsed := ExtractResultDetail(logText, item)
	runID := dto.RunID
	outcome := StepOutcome{
		ResultDetail:         parsed.ResultDetail,
		Result:               parsed.Result,
		SkillMastery:         parsed.SkillMastery,
		LogCheckpointPresent: parsed.LogCheckpointPresent,
	}
	if runID != "" {
		value := runID
		outcome.RunID = &value
	}

	if timedOut {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = s.executor.Stop(stopCtx)
		stopCancel()
		if parsed.LogCheckpointPresent {
			message := "专精步骤超时，已停止 MAA 任务"
			outcome.Message = &message
			return outcome, nil
		}
		return StepOutcome{}, apperrors.WithStatus(
			"AGENT_MASTERY_STEP_TIMEOUT",
			"专精步骤超时，已停止 MAA 任务",
			http.StatusConflict,
			true,
			map[string]any{"itemId": item.ID, "stepTarget": stepTarget, "timeoutMs": s.stepTimeout.Milliseconds()},
		)
	}

	if runErr != nil {
		message := errorMessage(runErr)
		if parsed.LogCheckpointPresent {
			outcome.Message = &message
			return outcome, nil
		}
		if appErr, ok := apperrors.As(runErr); ok && appErr.Code == "MAA_EXECUTION_BUSY" {
			return StepOutcome{}, apperrors.WithStatus(
				"AGENT_MASTERY_EXECUTION_BUSY",
				"MAA 正在被其他任务使用，稍后重试",
				http.StatusConflict,
				true,
				map[string]any{"itemId": item.ID},
			)
		}
		if isStopped(runErr) || errors.Is(ctx.Err(), context.Canceled) {
			return StepOutcome{}, apperrors.WithStatus(
				"AGENT_MASTERY_STOPPED",
				"专精步骤已停止，结果需要复核",
				http.StatusConflict,
				true,
				map[string]any{"itemId": item.ID, "runId": runID},
			)
		}
		return StepOutcome{}, runErr
	}
	return outcome, nil
}

type stoppedError interface {
	Stopped() bool
}

func isStopped(err error) bool {
	var stopped stoppedError
	return errors.As(err, &stopped) && stopped.Stopped()
}

func errorMessage(err error) string {
	if err == nil {
		return ""
	}
	if appErr, ok := apperrors.As(err); ok {
		return appErr.Message
	}
	return err.Error()
}

func dtoText(dto domainrun.DTO) string {
	builder := &strings.Builder{}
	collectText(builder, dto.Result)
	collectText(builder, dto.TaskResults)
	return builder.String()
}

func collectText(builder *strings.Builder, value any) {
	switch typed := value.(type) {
	case string:
		builder.WriteString(typed)
		builder.WriteByte('\n')
	case []any:
		for _, item := range typed {
			collectText(builder, item)
		}
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			collectText(builder, typed[key])
		}
	}
}

// Stop asks the executor to stop the current MAA task.
func (s *RunService) Stop(ctx context.Context) error {
	if s.executor == nil {
		return nil
	}
	return s.executor.Stop(ctx)
}

// MinimumVersions exposes the OperProgress minimums.
func MinimumVersions() (cli string, core string) {
	return minimumCLIVersion, minimumCoreVersion
}
