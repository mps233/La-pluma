package updates

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	configapp "github.com/mps233/la-pluma/go/internal/app/config"
	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const (
	coreUpdateTaskName  = "更新 MaaCore 与资源"
	coreUpdateTaskType  = "core-update"
	resourceTaskName    = "同步 MAA 资源"
	resourceTaskType    = "resource-update"
	cliUpdateTaskName   = "更新 MAA CLI"
	cliUpdateTaskType   = "cli-update"
	autoUpdateTaskName  = "自动更新 MAA"
	autoUpdateLeaseName = "auto-update"
)

// Success messages returned by the Node actions. They are top-level response
// messages, not data fields.
const (
	HotUpdateSuccessMessage  = "资源文件更新成功"
	coreUpdateDefaultMessage = "MaaCore 和资源已更新"
)

// CommandRunner is the injected MAA CLI surface. The production adapter is
// expected to wrap internal/app/maa.Service.Run, which owns the shared MAA
// execution lease and Agent run tracking. Tests use fakes and never start a
// real process.
type CommandRunner interface {
	RunCommand(ctx context.Context, command string, args []string, taskName, taskType string, wait bool) (domainrun.DTO, error)
}

// UntrackedRunner is an optional query-only command surface. Services that
// implement it avoid creating an Agent run for metadata commands.
type UntrackedRunner interface {
	RunCommandUntracked(ctx context.Context, command string, args []string) (domainrun.DTO, error)
}

// SystemRunner runs non-MAA maintenance commands such as `brew upgrade`. It is
// separate from CommandRunner because those commands are not maa-cli
// subcommands. Tests inject a fake; the default uses os/exec.
type SystemRunner interface {
	Run(ctx context.Context, name string, args ...string) (stdout string, stderr string, err error)
}

// OSRunner is the default SystemRunner.
type OSRunner struct{}

// Run implements SystemRunner.
func (OSRunner) Run(ctx context.Context, name string, args ...string) (string, string, error) {
	command := exec.CommandContext(ctx, name, args...)
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	return stdout.String(), stderr.String(), err
}

// Options configures a Service. Zero values are safe except Runner: metadata
// and update calls fail closed with MAA_CLI_NOT_FOUND when it is nil.
type Options struct {
	Paths        config.Paths
	Logger       *slog.Logger
	Runner       CommandRunner
	SystemRunner SystemRunner
	// MaaCLIPath is used to build the `maa self update` plan string. An empty
	// value resolves from MAA_CLI_PATH, DOCKER_ENV, or "maa", matching
	// DEFAULT_MAA_CLI_PATH.
	MaaCLIPath string
	// Platform returns the Node-style platform name (darwin, linux, win32).
	// An empty function uses runtime.GOOS with windows mapped to win32.
	Platform func() string
	// IsDocker mirrors the Node `NODE_ENV=production` + /.dockerenv check.
	IsDocker func() bool
	// Now supplies the clock used for resource age calculations.
	Now func() time.Time
	// OnResourcesUpdated is called after a successful hot-update command so a
	// caller can invalidate its resource cache, matching
	// clearMaaResourceCache() in the Node service.
	OnResourcesUpdated func()
}

// Service ports resourceUpdateService.ts and the update actions from the
// Agent API. It never starts MAA itself; the injected CommandRunner does.
type Service struct {
	paths      config.Paths
	logger     *slog.Logger
	runner     CommandRunner
	system     SystemRunner
	maaCLIPath string
	platform   func() string
	isDocker   func() bool
	now        func() time.Time
	onUpdated  func()

	updateMu     sync.Mutex
	activeUpdate *resourceUpdateCall
}

type resourceUpdateCall struct {
	done   chan struct{}
	result ResourceUpdateResult
	err    error
}

// New returns a Service with default clock, platform and system runner.
func New(paths config.Paths, logger *slog.Logger, runner CommandRunner) *Service {
	return NewWithOptions(Options{Paths: paths, Logger: logger, Runner: runner})
}

// NewWithOptions returns a fully configurable Service.
func NewWithOptions(options Options) *Service {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	system := options.SystemRunner
	if system == nil {
		system = OSRunner{}
	}
	maaCLIPath := options.MaaCLIPath
	if maaCLIPath == "" {
		maaCLIPath = defaultMaaCLIPath()
	}
	platform := options.Platform
	if platform == nil {
		platform = defaultPlatform
	}
	isDocker := options.IsDocker
	if isDocker == nil {
		isDocker = defaultIsDocker
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &Service{
		paths:      options.Paths,
		logger:     logger,
		runner:     options.Runner,
		system:     system,
		maaCLIPath: maaCLIPath,
		platform:   platform,
		isDocker:   isDocker,
		now:        now,
		onUpdated:  options.OnResourcesUpdated,
	}
}

// Platform exposes the effective Node-style platform for response messages.
func (s *Service) Platform() string { return s.platform() }

// IsDocker reports whether the service treats the runtime as a Docker image.
func (s *Service) IsDocker() bool { return s.isDocker() }

// MaaCLIPath returns the CLI command used in update plans.
func (s *Service) MaaCLIPath() string { return s.maaCLIPath }

// MaaVersionInfo mirrors getMaaVersion(true) in maaService.ts.
type MaaVersionInfo struct {
	Raw  string `json:"raw"`
	CLI  string `json:"cli"`
	Core string `json:"core"`
}

// GetVersion runs `maa version` and parses the version banner.
func (s *Service) GetVersion(ctx context.Context) (MaaVersionInfo, error) {
	if runner, ok := s.runner.(UntrackedRunner); ok {
		run, err := runner.RunCommandUntracked(ctx, "version", []string{})
		if err != nil {
			return MaaVersionInfo{}, err
		}
		return parseVersionOutput(commandStdout(run)), nil
	}
	run, err := s.runMAA(ctx, "version", []string{}, "", "")
	if err != nil {
		return MaaVersionInfo{}, err
	}
	return parseVersionOutput(commandStdout(run)), nil
}

// CoreUpdateStep is one command in an update-core plan.
type CoreUpdateStep struct {
	Action        string   `json:"action"`
	TargetChannel string   `json:"targetChannel"`
	Command       string   `json:"command"`
	Args          []string `json:"args"`
}

// UpdateCorePlan is the dry-run plan for update-core. The Node route names the
// plan action "update-core-and-resources" even though resources are refreshed
// by the core command itself.
type UpdateCorePlan struct {
	Action            string           `json:"action"`
	Steps             []CoreUpdateStep `json:"steps"`
	ResourcesIncluded bool             `json:"resourcesIncluded"`
}

// RuntimeInfo is the getMaaVersion payload merged with the refreshed
// resource, matching `{ ...runtime, resource }` in the Node route.
type RuntimeInfo struct {
	Raw      string `json:"raw"`
	CLI      string `json:"cli"`
	Core     string `json:"core"`
	Resource any    `json:"resource"`
}

// UpdateCoreResult is the successful update-core payload.
type UpdateCoreResult struct {
	Plan             UpdateCorePlan `json:"plan"`
	Channel          *string        `json:"channel"`
	ChannelPersisted bool           `json:"channelPersisted"`
	Steps            map[string]any `json:"steps"`
	Runtime          RuntimeInfo    `json:"runtime"`
	Message          string         `json:"-"`
}

// PlanUpdateCore builds the dry-run plan for a version ("beta", "stable", or
// anything else for the current channel).
func PlanUpdateCore(version string) UpdateCorePlan {
	return UpdateCorePlan{
		Action:            "update-core-and-resources",
		Steps:             []CoreUpdateStep{coreUpdateStep(version)},
		ResourcesIncluded: true,
	}
}

func coreUpdateStep(version string) CoreUpdateStep {
	switch version {
	case "beta":
		return CoreUpdateStep{
			Action:        "update-core",
			TargetChannel: "beta",
			Command:       "install",
			Args:          []string{"beta", "--force"},
		}
	case "stable":
		return CoreUpdateStep{
			Action:        "update-core",
			TargetChannel: "stable",
			Command:       "install",
			Args:          []string{"stable", "--force"},
		}
	default:
		return CoreUpdateStep{
			Action:        "update-core",
			TargetChannel: "current",
			Command:       "update",
			Args:          []string{},
		}
	}
}

// UpdateCore runs maa install/update, persists the selected channel, then
// reads the refreshed resource and runtime versions.
func (s *Service) UpdateCore(ctx context.Context, version string) (UpdateCoreResult, error) {
	plan := PlanUpdateCore(version)
	step := plan.Steps[0]

	run, err := s.runMAA(ctx, step.Command, step.Args, coreUpdateTaskName, coreUpdateTaskType)
	if err != nil {
		details := map[string]any{"failedStep": "core", "coreUpdated": false}
		if version != "" {
			details["version"] = version
		}
		s.logger.Error("更新 MaaCore 失败", "error", errorMessage(err), "version", version)
		return UpdateCoreResult{}, apperrors.WithStatus(
			"AGENT_MAA_UPDATE_CORE_FAILED",
			"MaaCore 更新失败: "+errorMessage(err),
			500,
			true,
			details,
		)
	}
	coreOutput := commandOutput(run)

	channel, channelPersisted := s.persistChannel(version)

	resource, err := s.GetResourceInfo(ctx)
	if err != nil {
		return UpdateCoreResult{}, s.resourceSyncError(ctx, version, err)
	}
	versionInfo, err := s.GetVersion(ctx)
	if err != nil {
		return UpdateCoreResult{}, s.resourceSyncError(ctx, version, err)
	}

	message := coreUpdateDefaultMessage
	if version != "" {
		message = fmt.Sprintf("已切换到 %s 渠道并同步最新资源", version)
	}
	return UpdateCoreResult{
		Plan:             plan,
		Channel:          channel,
		ChannelPersisted: channelPersisted,
		Steps: map[string]any{
			"core": map[string]any{"success": true, "output": coreOutput},
			"resources": map[string]any{
				"success":  true,
				"resource": resource,
			},
		},
		Runtime: RuntimeInfo{
			Raw:      versionInfo.Raw,
			CLI:      versionInfo.CLI,
			Core:     versionInfo.Core,
			Resource: resource,
		},
		Message: message,
	}, nil
}

// persistChannel mirrors the get/set channel block in the update-core route.
// Channel persistence failures are warnings and never fail the update.
func (s *Service) persistChannel(version string) (*string, bool) {
	cliConfig := configapp.NewCLIConfig(s.paths.MaaConfigDir)
	var (
		channel string
		err     error
	)
	if version == "beta" || version == "stable" {
		channel, err = cliConfig.SetCoreChannel(version)
	} else {
		channel, err = cliConfig.GetCoreChannel()
	}
	if err != nil {
		s.logger.Warn("持久化 MaaCore 更新渠道失败", "error", errorMessage(err), "version", version)
		return nil, false
	}
	return &channel, true
}

// resourceSyncError mirrors the catch block after a successful core update.
// It still tries to report the runtime and resource state when available.
func (s *Service) resourceSyncError(ctx context.Context, version string, cause error) error {
	details := map[string]any{"failedStep": "resources", "coreUpdated": true}
	if version != "" {
		details["version"] = version
	}

	versionInfo, versionErr := s.GetVersion(ctx)
	resource, resourceErr := s.GetResourceInfo(ctx)
	var runtime any
	if versionErr == nil {
		var resourceValue any
		if resourceErr == nil {
			resourceValue = resource
		}
		runtime = RuntimeInfo{
			Raw:      versionInfo.Raw,
			CLI:      versionInfo.CLI,
			Core:     versionInfo.Core,
			Resource: resourceValue,
		}
	}
	details["runtime"] = runtime

	s.logger.Error("MaaCore 已更新，但资源同步失败", "error", errorMessage(cause), "version", version)
	return apperrors.WithStatus(
		"AGENT_MAA_UPDATE_RESOURCE_FAILED",
		"MaaCore 已更新，但资源同步失败: "+errorMessage(cause),
		500,
		true,
		details,
	)
}

// HotUpdateResources runs maa hot-update and returns the refreshed resource
// info. Concurrent callers share one in-flight update, matching
// activeResourceUpdate in the Node service.
func (s *Service) HotUpdateResources(ctx context.Context) (ResourceUpdateResult, error) {
	s.updateMu.Lock()
	if active := s.activeUpdate; active != nil {
		s.updateMu.Unlock()
		select {
		case <-active.done:
			return active.result, active.err
		case <-ctx.Done():
			return ResourceUpdateResult{}, ctx.Err()
		}
	}
	call := &resourceUpdateCall{done: make(chan struct{})}
	s.activeUpdate = call
	s.updateMu.Unlock()

	call.result, call.err = s.executeHotUpdate(ctx)

	s.updateMu.Lock()
	if s.activeUpdate == call {
		s.activeUpdate = nil
	}
	s.updateMu.Unlock()
	close(call.done)
	return call.result, call.err
}

func (s *Service) executeHotUpdate(ctx context.Context) (ResourceUpdateResult, error) {
	plan := PlanHotUpdateResources()
	run, err := s.runMAA(ctx, "hot-update", []string{}, resourceTaskName, resourceTaskType)
	if err != nil {
		return ResourceUpdateResult{Plan: plan}, resourceUpdateError(err)
	}
	output := commandOutput(run)

	if s.onUpdated != nil {
		s.onUpdated()
	}
	resource, err := s.GetResourceInfo(ctx)
	if err != nil {
		return ResourceUpdateResult{Output: output, Plan: plan}, resourceUpdateError(err)
	}
	return ResourceUpdateResult{
		Output:   output,
		Resource: resource,
		Plan:     plan,
		Message:  HotUpdateSuccessMessage,
	}, nil
}

func resourceUpdateError(cause error) error {
	return apperrors.WithStatus(
		"AGENT_MAA_RESOURCE_UPDATE_FAILED",
		"资源同步失败: "+errorMessage(cause),
		500,
		true,
		map[string]any{"failedStep": "resources"},
	)
}

// UpdateCLIPlan is the update-cli dry-run plan.
type UpdateCLIPlan struct {
	Action              string  `json:"action"`
	Command             *string `json:"command"`
	Platform            string  `json:"platform"`
	SelfUpdateAvailable bool    `json:"selfUpdateAvailable"`
}

// UpdateCLIResult is the successful update-cli payload.
type UpdateCLIResult struct {
	Output  string        `json:"output"`
	Plan    UpdateCLIPlan `json:"plan"`
	Message string        `json:"-"`
}

// PlanUpdateCLI probes `maa self --help`, selects brew on non-Docker macOS,
// and returns AGENT_MAA_CLI_UPDATE_UNSUPPORTED when no upgrade path exists.
func (s *Service) PlanUpdateCLI(ctx context.Context) (UpdateCLIPlan, error) {
	plan, _, err := s.planUpdateCLI(ctx)
	return plan, err
}

func (s *Service) planUpdateCLI(ctx context.Context) (UpdateCLIPlan, bool, error) {
	platform := s.platform()
	docker := s.isDocker()
	selfUpdateAvailable := s.canUseSelfUpdate(ctx)

	var command string
	switch {
	case platform == "darwin" && !docker:
		command = "brew upgrade maa-cli"
	case selfUpdateAvailable:
		command = s.maaCLIPath + " self update"
	}

	plan := UpdateCLIPlan{
		Action:              "update-cli",
		Platform:            platform,
		SelfUpdateAvailable: selfUpdateAvailable,
	}
	if command == "" {
		return plan, docker, apperrors.WithStatus(
			"AGENT_MAA_CLI_UPDATE_UNSUPPORTED",
			"当前 maa-cli 构建没有 self 子命令，无法自动更新；请使用安装方式对应的包管理器升级",
			409,
			false,
			map[string]any{
				"platform":            platform,
				"cliPath":             s.maaCLIPath,
				"selfUpdateAvailable": selfUpdateAvailable,
			},
		)
	}
	plan.Command = &command
	return plan, docker, nil
}

// UpdateCLI executes the planned CLI upgrade. macOS outside Docker upgrades
// through Homebrew; every other supported case runs `maa self update`.
func (s *Service) UpdateCLI(ctx context.Context) (UpdateCLIResult, error) {
	plan, docker, err := s.planUpdateCLI(ctx)
	if err != nil {
		return UpdateCLIResult{Plan: plan}, err
	}

	var output string
	if plan.Command != nil && *plan.Command == "brew upgrade maa-cli" {
		stdout, stderr, runErr := s.system.Run(ctx, "brew", "upgrade", "maa-cli")
		if runErr != nil {
			return UpdateCLIResult{Plan: plan}, cliUpdateError(runErr, plan)
		}
		output = firstNonEmpty(strings.TrimSpace(stdout), strings.TrimSpace(stderr))
	} else {
		run, runErr := s.runMAA(ctx, "self", []string{"update"}, cliUpdateTaskName, cliUpdateTaskType)
		if runErr != nil {
			return UpdateCLIResult{Plan: plan}, cliUpdateError(runErr, plan)
		}
		output = commandOutput(run)
	}

	message := "MAA CLI 更新完成"
	if docker {
		message += "（Docker 环境）"
	}
	return UpdateCLIResult{Output: output, Plan: plan, Message: message}, nil
}

func cliUpdateError(cause error, plan UpdateCLIPlan) error {
	details := map[string]any{"platform": plan.Platform}
	if plan.Command != nil {
		details["command"] = *plan.Command
	}
	return apperrors.WithStatus(
		"AGENT_MAA_CLI_UPDATE_FAILED",
		"MAA CLI 更新失败: "+errorMessage(cause),
		500,
		true,
		details,
	)
}

// canUseSelfUpdate mirrors canUseMaaSelfUpdate: a failed probe means the build
// lacks the cli_installer feature.
func (s *Service) canUseSelfUpdate(ctx context.Context) bool {
	if s.runner == nil {
		return false
	}
	_, err := s.runMAA(ctx, "self", []string{"--help"}, "", "")
	return err == nil
}

// AutoUpdateConfig is the plain-map auto-update payload. The scheduler owns
// timer registration; this parser is shared by the update runner.
type AutoUpdateConfig struct {
	Enabled    bool
	Time       string
	UpdateCore bool
	UpdateCLI  bool
}

// ParseAutoUpdateConfig mirrors the field coercion in setupAutoUpdate.
func ParseAutoUpdateConfig(config map[string]any) AutoUpdateConfig {
	if config == nil {
		config = map[string]any{}
	}
	return AutoUpdateConfig{
		Enabled:    truthy(config["enabled"]),
		Time:       textValue(config["time"]),
		UpdateCore: truthy(config["updateCore"]),
		UpdateCLI:  truthy(config["updateCli"]),
	}
}

// RunAutoUpdate is the scheduler AutoUpdater implementation. It runs the
// configured core/resource update followed by the CLI update. Core failures
// stop the run; CLI failures follow the Node scheduling behavior: unsupported
// builds are skipped, Docker failures are logged, and other failures bubble up.
func (s *Service) RunAutoUpdate(ctx context.Context, config map[string]any) error {
	parsed := ParseAutoUpdateConfig(config)

	if parsed.UpdateCore {
		s.logger.Info("开始更新 MaaCore 与资源")
		if _, err := s.runMAA(ctx, "update", []string{}, autoUpdateTaskName, autoUpdateLeaseName); err != nil {
			s.logger.Error("自动更新失败", "error", errorMessage(err))
			return err
		}
		s.logger.Info("MaaCore 与资源更新完成")
	}

	if parsed.UpdateCLI {
		s.logger.Info("开始更新 MAA CLI")
		if err := s.runAutoCLIUpdate(ctx); err != nil {
			s.logger.Error("自动更新失败", "error", errorMessage(err))
			return err
		}
	}

	s.logger.Info("所有自动更新任务完成")
	return nil
}

func (s *Service) runAutoCLIUpdate(ctx context.Context) error {
	plan, docker, err := s.planUpdateCLI(ctx)
	if err != nil {
		if appErr, ok := apperrors.As(err); ok && appErr.Code == "AGENT_MAA_CLI_UPDATE_UNSUPPORTED" {
			s.logger.Warn("当前 maa-cli 构建没有 self 子命令，跳过 CLI 更新", "platform", plan.Platform)
			return nil
		}
		return err
	}
	// The scheduled auto-update path only supports brew on macOS and self
	// update on Linux/Windows; other platforms are skipped with a warning.
	if plan.Platform != "darwin" && plan.Platform != "linux" && plan.Platform != "win32" {
		s.logger.Warn("当前平台不支持自动更新 MAA CLI", "platform", plan.Platform)
		return nil
	}

	var runErr error
	if plan.Command != nil && *plan.Command == "brew upgrade maa-cli" {
		_, _, runErr = s.system.Run(ctx, "brew", "upgrade", "maa-cli")
	} else {
		_, runErr = s.runMAA(ctx, "self", []string{"update"}, cliUpdateTaskName, cliUpdateTaskType)
	}
	if runErr != nil {
		if docker {
			s.logger.Error("MAA CLI 更新失败", "error", errorMessage(runErr))
			return nil
		}
		return cliUpdateError(runErr, plan)
	}
	s.logger.Info("MAA CLI 更新完成", "platform", plan.Platform)
	return nil
}

// AutoUpdateStatus mirrors getAutoUpdateStatus. Timer state stays in the
// scheduler; this type keeps the response shape with the update service.
type AutoUpdateStatus struct {
	Enabled bool    `json:"enabled"`
	Time    *string `json:"time"`
}

// BuildAutoUpdateStatus builds the /auto-update/status shape. A disabled or
// clock-less registration reports time null.
func BuildAutoUpdateStatus(enabled bool, clock string) AutoUpdateStatus {
	if !enabled || clock == "" {
		return AutoUpdateStatus{Enabled: false, Time: nil}
	}
	return AutoUpdateStatus{Enabled: true, Time: &clock}
}

func (s *Service) runMAA(ctx context.Context, command string, args []string, taskName, taskType string) (domainrun.DTO, error) {
	if s.runner == nil {
		return domainrun.DTO{}, apperrors.WithStatus(
			"MAA_CLI_NOT_FOUND",
			"MAA CLI 未配置",
			503,
			false,
			nil,
		)
	}
	if args == nil {
		args = []string{}
	}
	return s.runner.RunCommand(ctx, command, args, taskName, taskType, true)
}

func commandStdout(run domainrun.DTO) string {
	return commandStream(run, "stdout")
}

func commandOutput(run domainrun.DTO) string {
	return firstNonEmpty(commandStream(run, "stdout"), commandStream(run, "stderr"))
}

func commandStream(run domainrun.DTO, key string) string {
	record, ok := run.Result.(map[string]any)
	if !ok {
		return ""
	}
	value, ok := record[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

func parseVersionOutput(output string) MaaVersionInfo {
	trimmed := strings.TrimSpace(output)
	info := MaaVersionInfo{Raw: trimmed}
	for _, rawLine := range strings.Split(trimmed, "\n") {
		line := strings.TrimSpace(rawLine)
		switch {
		case strings.HasPrefix(line, "maa-cli"):
			info.CLI = strings.TrimSpace(strings.TrimPrefix(line, "maa-cli"))
		case strings.HasPrefix(line, "MaaCore"):
			info.Core = strings.TrimSpace(strings.TrimPrefix(line, "MaaCore"))
		}
	}
	return info
}

func errorMessage(err error) string {
	if appErr, ok := apperrors.As(err); ok {
		return appErr.Message
	}
	if err == nil {
		return ""
	}
	return err.Error()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func truthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case float64:
		return typed != 0
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case uint64:
		return typed != 0
	case json.Number:
		number, err := typed.Float64()
		return err != nil || number != 0
	default:
		// Maps, slices and other objects are truthy in JavaScript.
		return true
	}
}

func textValue(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return text
}

func defaultPlatform() string {
	if runtime.GOOS == "windows" {
		return "win32"
	}
	return runtime.GOOS
}

func defaultIsDocker() bool {
	if os.Getenv("NODE_ENV") != "production" {
		return false
	}
	_, err := os.Stat("/.dockerenv")
	return err == nil
}

func defaultMaaCLIPath() string {
	if value := strings.TrimSpace(os.Getenv("MAA_CLI_PATH")); value != "" {
		return value
	}
	if os.Getenv("DOCKER_ENV") != "" {
		return "/usr/local/bin/maa"
	}
	return "maa"
}
