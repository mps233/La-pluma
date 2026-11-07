package updates

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	configapp "github.com/mps233/la-pluma/go/internal/app/config"
	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const testMaaCLIPath = "maa"

type runCall struct {
	command  string
	args     []string
	taskName string
	taskType string
	wait     bool
}

type fakeRunner struct {
	mu    sync.Mutex
	calls []runCall
	run   func(call runCall) (domainrun.DTO, error)
}

func (f *fakeRunner) RunCommand(ctx context.Context, command string, args []string, taskName, taskType string, wait bool) (domainrun.DTO, error) {
	call := runCall{
		command:  command,
		args:     append([]string{}, args...),
		taskName: taskName,
		taskType: taskType,
		wait:     wait,
	}
	f.mu.Lock()
	f.calls = append(f.calls, call)
	f.mu.Unlock()
	if f.run == nil {
		return successDTO(""), nil
	}
	return f.run(call)
}

func (f *fakeRunner) Calls() []runCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]runCall{}, f.calls...)
}

type fakeSystemRunner struct {
	mu    sync.Mutex
	calls [][]string
	run   func(name string, args []string) (string, string, error)
}

func (f *fakeSystemRunner) Run(_ context.Context, name string, args ...string) (string, string, error) {
	call := append([]string{name}, args...)
	f.mu.Lock()
	f.calls = append(f.calls, call)
	f.mu.Unlock()
	if f.run != nil {
		return f.run(name, args)
	}
	return "", "", nil
}

func successDTO(stdout string) domainrun.DTO {
	return domainrun.DTO{
		State:  domainrun.StatusSucceeded,
		Result: map[string]any{"stdout": stdout},
	}
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newService(t *testing.T, paths config.Paths, runner CommandRunner, mutate func(*Options)) *Service {
	t.Helper()
	options := Options{
		Paths:      paths,
		Logger:     testLogger(),
		Runner:     runner,
		MaaCLIPath: testMaaCLIPath,
		Platform:   func() string { return "linux" },
		IsDocker:   func() bool { return false },
		Now:        func() time.Time { return time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC) },
	}
	if mutate != nil {
		mutate(&options)
	}
	return NewWithOptions(options)
}

func tempPaths(t *testing.T) config.Paths {
	t.Helper()
	return config.Paths{
		DataDir:      t.TempDir(),
		MaaConfigDir: t.TempDir(),
		MaaDataDir:   t.TempDir(),
	}
}

func writeResourceVersion(t *testing.T, dir string, lastUpdated string, modifiedAt time.Time) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir resource dir: %v", err)
	}
	content := map[string]any{"last_updated": lastUpdated}
	data, err := json.Marshal(content)
	if err != nil {
		t.Fatalf("marshal version: %v", err)
	}
	path := filepath.Join(dir, "version.json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write version: %v", err)
	}
	if err := os.Chtimes(path, modifiedAt, modifiedAt); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
	return dir
}

func resourceRunner(resourceDir string) *fakeRunner {
	return &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		switch call.command {
		case "dir":
			return successDTO(resourceDir), nil
		case "version":
			return successDTO("maa-cli 0.7.8\nMaaCore 6.21.4\n"), nil
		default:
			return successDTO("ok"), nil
		}
	}}
}

func requireAppError(t *testing.T, err error, code string, status int, retryable bool) *apperrors.Error {
	t.Helper()
	appErr, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("error = %v, want app error %s", err, code)
	}
	if appErr.Code != code || appErr.StatusCode != status || appErr.Retryable != retryable {
		t.Fatalf("error = %+v, want code=%s status=%d retryable=%v", appErr, code, status, retryable)
	}
	return appErr
}

func TestBuildResourceInfoCurrent(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	modified := time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)
	info := BuildResourceInfo(map[string]any{
		"last_updated": "2026-07-09 23:28:49.000",
	}, &modified, now)

	if info.Status != ResourceStatusCurrent || info.AgeDays == nil || *info.AgeDays != 0 {
		t.Fatalf("info = %+v", info)
	}
	if info.Message != "资源版本正常" {
		t.Fatalf("message = %q", info.Message)
	}
	if info.LastUpdated == nil || *info.LastUpdated != "2026-07-09 23:28:49.000" {
		t.Fatalf("lastUpdated = %v", info.LastUpdated)
	}
	if info.ModifiedAt == nil || *info.ModifiedAt != "2026-07-10T00:00:00.000Z" {
		t.Fatalf("modifiedAt = %v", info.ModifiedAt)
	}
	if info.Activity != nil || info.Gacha != nil {
		t.Fatalf("activity/gacha = %v/%v", info.Activity, info.Gacha)
	}
}

func TestBuildResourceInfoStale(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	info := BuildResourceInfo(map[string]any{
		"last_updated": "2026-06-20 00:00:00.000",
	}, nil, now)

	if info.Status != ResourceStatusStale || info.AgeDays == nil || *info.AgeDays != 20 {
		t.Fatalf("info = %+v", info)
	}
	if !strings.Contains(info.Message, "建议立即同步") {
		t.Fatalf("message = %q", info.Message)
	}
	if info.ModifiedAt != nil {
		t.Fatalf("modifiedAt = %v", *info.ModifiedAt)
	}
}

func TestBuildResourceInfoUnknownAndPayloads(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	activity := map[string]any{"name": "活动"}
	info := BuildResourceInfo(map[string]any{
		"last_updated": "not-a-date",
		"activity":     activity,
		"gacha":        "",
	}, nil, now)

	if info.Status != ResourceStatusUnknown || info.AgeDays != nil {
		t.Fatalf("info = %+v", info)
	}
	if !strings.Contains(info.Message, "无法读取资源版本") {
		t.Fatalf("message = %q", info.Message)
	}
	if !reflect.DeepEqual(info.Activity, activity) {
		t.Fatalf("activity = %#v", info.Activity)
	}
	if info.Gacha != nil {
		t.Fatalf("gacha = %#v", info.Gacha)
	}

	for _, value := range []any{nil, []any{"x"}, "text", 42} {
		fallback := BuildResourceInfo(value, nil, now)
		if fallback.Status != ResourceStatusUnknown || fallback.LastUpdated != nil {
			t.Fatalf("value %v -> %+v", value, fallback)
		}
	}
}

func TestBuildResourceInfoFutureTimestampClampsAge(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	info := BuildResourceInfo(map[string]any{
		"last_updated": "2026-07-12 12:00:00.000",
	}, nil, now)
	if info.Status != ResourceStatusCurrent || info.AgeDays == nil || *info.AgeDays != 0 {
		t.Fatalf("info = %+v", info)
	}
}

func TestGetResourceInfo(t *testing.T) {
	paths := tempPaths(t)
	modified := time.Date(2026, 7, 9, 8, 30, 0, 0, time.UTC)
	resourceDir := writeResourceVersion(t, filepath.Join(paths.DataDir, "resource"), "2026-07-09 23:28:49.000", modified)
	runner := resourceRunner(resourceDir)
	service := newService(t, paths, runner, nil)

	info, err := service.GetResourceInfo(context.Background())
	if err != nil {
		t.Fatalf("GetResourceInfo: %v", err)
	}
	if info.Status != ResourceStatusCurrent || info.AgeDays == nil || *info.AgeDays != 0 {
		t.Fatalf("info = %+v", info)
	}
	if info.ModifiedAt == nil || *info.ModifiedAt != "2026-07-09T08:30:00.000Z" {
		t.Fatalf("modifiedAt = %v", info.ModifiedAt)
	}

	calls := runner.Calls()
	if len(calls) != 1 || calls[0].command != "dir" || !reflect.DeepEqual(calls[0].args, []string{"resource"}) {
		t.Fatalf("calls = %+v", calls)
	}
	if calls[0].taskName != "" || calls[0].taskType != "" || !calls[0].wait {
		t.Fatalf("dir call = %+v", calls[0])
	}
}

func TestGetResourceInfoMissingVersionFile(t *testing.T) {
	paths := tempPaths(t)
	runner := resourceRunner(t.TempDir())
	service := newService(t, paths, runner, nil)

	if _, err := service.GetResourceInfo(context.Background()); err == nil {
		t.Fatal("missing version.json should fail")
	}
}

func TestHotUpdateResources(t *testing.T) {
	paths := tempPaths(t)
	modified := time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)
	resourceDir := writeResourceVersion(t, filepath.Join(paths.DataDir, "resource"), "2026-07-09 23:28:49.000", modified)
	runner := resourceRunner(resourceDir)
	runner.run = func(call runCall) (domainrun.DTO, error) {
		switch call.command {
		case "hot-update":
			return successDTO("hot update completed\n"), nil
		case "dir":
			return successDTO(resourceDir), nil
		case "version":
			return successDTO("maa-cli 0.7.8\nMaaCore 6.21.4\n"), nil
		}
		return successDTO(""), nil
	}
	cacheClears := 0
	service := newService(t, paths, runner, func(options *Options) {
		options.OnResourcesUpdated = func() { cacheClears++ }
	})

	result, err := service.HotUpdateResources(context.Background())
	if err != nil {
		t.Fatalf("HotUpdateResources: %v", err)
	}
	if result.Output != "hot update completed" {
		t.Fatalf("output = %q", result.Output)
	}
	if result.Resource.Status != ResourceStatusCurrent {
		t.Fatalf("resource = %+v", result.Resource)
	}
	if result.Plan.Action != "hot-update-resources" || result.Plan.Command != "hot-update" {
		t.Fatalf("plan = %+v", result.Plan)
	}
	if result.Message != HotUpdateSuccessMessage {
		t.Fatalf("message = %q", result.Message)
	}
	if cacheClears != 1 {
		t.Fatalf("cache clears = %d", cacheClears)
	}

	calls := runner.Calls()
	if len(calls) != 2 || calls[0].command != "hot-update" || calls[1].command != "dir" {
		t.Fatalf("calls = %+v", calls)
	}
	first := calls[0]
	if !reflect.DeepEqual(first.args, []string{}) || first.taskName != "同步 MAA 资源" || first.taskType != "resource-update" || !first.wait {
		t.Fatalf("hot-update call = %+v", first)
	}
}

func TestHotUpdateSharesInFlightUpdate(t *testing.T) {
	paths := tempPaths(t)
	resourceDir := writeResourceVersion(t, filepath.Join(paths.DataDir, "resource"), "2026-07-09 23:28:49.000", time.Now())
	runner := resourceRunner(resourceDir)
	started := make(chan struct{})
	release := make(chan struct{})
	var startOnce sync.Once
	runner.run = func(call runCall) (domainrun.DTO, error) {
		switch call.command {
		case "hot-update":
			startOnce.Do(func() { close(started) })
			<-release
			return successDTO("done"), nil
		case "dir":
			return successDTO(resourceDir), nil
		case "version":
			return successDTO("maa-cli 0.7.8\nMaaCore 6.21.4\n"), nil
		}
		return successDTO(""), nil
	}
	service := newService(t, paths, runner, nil)

	type outcome struct {
		result ResourceUpdateResult
		err    error
	}
	results := make(chan outcome, 2)
	go func() {
		result, err := service.HotUpdateResources(context.Background())
		results <- outcome{result, err}
	}()
	<-started
	go func() {
		result, err := service.HotUpdateResources(context.Background())
		results <- outcome{result, err}
	}()
	time.Sleep(20 * time.Millisecond)
	close(release)

	first := <-results
	second := <-results
	if first.err != nil || second.err != nil {
		t.Fatalf("errors = %v / %v", first.err, second.err)
	}
	if !reflect.DeepEqual(first.result, second.result) {
		t.Fatalf("results differ: %+v / %+v", first.result, second.result)
	}

	calls := runner.Calls()
	hotUpdates := 0
	dirs := 0
	for _, call := range calls {
		switch call.command {
		case "hot-update":
			hotUpdates++
		case "dir":
			dirs++
		}
	}
	if hotUpdates != 1 || dirs != 1 {
		t.Fatalf("hot-update=%d dir=%d calls=%+v", hotUpdates, dirs, calls)
	}
}

func TestHotUpdateResourcesError(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		if call.command == "hot-update" {
			return domainrun.DTO{}, apperrors.WithStatus("MAA_COMMAND_FAILED", "boom", 500, true, nil)
		}
		return successDTO(""), nil
	}}
	service := newService(t, paths, runner, nil)

	_, err := service.HotUpdateResources(context.Background())
	appErr := requireAppError(t, err, "AGENT_MAA_RESOURCE_UPDATE_FAILED", 500, true)
	if appErr.Message != "资源同步失败: boom" || appErr.Details["failedStep"] != "resources" {
		t.Fatalf("error = %+v", appErr)
	}
	if calls := runner.Calls(); len(calls) != 1 {
		t.Fatalf("calls = %+v", calls)
	}
}

func TestUpdateCoreDefaultChannel(t *testing.T) {
	paths := tempPaths(t)
	modified := time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)
	resourceDir := writeResourceVersion(t, filepath.Join(paths.DataDir, "resource"), "2026-07-09 23:28:49.000", modified)
	runner := resourceRunner(resourceDir)
	runner.run = func(call runCall) (domainrun.DTO, error) {
		switch call.command {
		case "update":
			return successDTO("core updated"), nil
		case "dir":
			return successDTO(resourceDir), nil
		case "version":
			return successDTO("maa-cli 0.7.8\nMaaCore 6.21.4\n"), nil
		}
		return successDTO(""), nil
	}
	service := newService(t, paths, runner, nil)

	result, err := service.UpdateCore(context.Background(), "")
	if err != nil {
		t.Fatalf("UpdateCore: %v", err)
	}
	if result.Plan.Action != "update-core-and-resources" || !result.Plan.ResourcesIncluded || len(result.Plan.Steps) != 1 {
		t.Fatalf("plan = %+v", result.Plan)
	}
	step := result.Plan.Steps[0]
	if step.TargetChannel != "current" || step.Command != "update" || len(step.Args) != 0 {
		t.Fatalf("step = %+v", step)
	}
	if result.Channel == nil || *result.Channel != "Stable" || !result.ChannelPersisted {
		t.Fatalf("channel = %v persisted=%v", result.Channel, result.ChannelPersisted)
	}
	coreStep, ok := result.Steps["core"].(map[string]any)
	if !ok || coreStep["success"] != true || coreStep["output"] != "core updated" {
		t.Fatalf("core step = %#v", result.Steps["core"])
	}
	resourceStep, ok := result.Steps["resources"].(map[string]any)
	if !ok || resourceStep["success"] != true {
		t.Fatalf("resource step = %#v", result.Steps["resources"])
	}
	if result.Runtime.CLI != "0.7.8" || result.Runtime.Core != "6.21.4" {
		t.Fatalf("runtime = %+v", result.Runtime)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	if !strings.Contains(string(encoded), `"runtime":{"raw":"maa-cli 0.7.8\nMaaCore 6.21.4","cli":"0.7.8","core":"6.21.4","resource":{`) {
		t.Fatalf("runtime json order = %s", encoded)
	}
	if result.Message != coreUpdateDefaultMessage {
		t.Fatalf("message = %q", result.Message)
	}

	calls := runner.Calls()
	if len(calls) != 3 || calls[0].command != "update" || calls[1].command != "dir" || calls[2].command != "version" {
		t.Fatalf("calls = %+v", calls)
	}
	if calls[0].taskName != "更新 MaaCore 与资源" || calls[0].taskType != "core-update" {
		t.Fatalf("core call = %+v", calls[0])
	}
}

func TestUpdateCoreBetaPersistsChannel(t *testing.T) {
	paths := tempPaths(t)
	resourceDir := writeResourceVersion(t, filepath.Join(paths.DataDir, "resource"), "2026-07-09 23:28:49.000", time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC))
	runner := resourceRunner(resourceDir)
	runner.run = func(call runCall) (domainrun.DTO, error) {
		switch call.command {
		case "install":
			return successDTO("installed beta"), nil
		case "dir":
			return successDTO(resourceDir), nil
		case "version":
			return successDTO("maa-cli 0.7.8\nMaaCore 6.21.4\n"), nil
		}
		return successDTO(""), nil
	}
	service := newService(t, paths, runner, nil)

	result, err := service.UpdateCore(context.Background(), "beta")
	if err != nil {
		t.Fatalf("UpdateCore: %v", err)
	}
	step := result.Plan.Steps[0]
	if step.TargetChannel != "beta" || step.Command != "install" || !reflect.DeepEqual(step.Args, []string{"beta", "--force"}) {
		t.Fatalf("step = %+v", step)
	}
	if result.Channel == nil || *result.Channel != "Beta" || !result.ChannelPersisted {
		t.Fatalf("channel = %v persisted=%v", result.Channel, result.ChannelPersisted)
	}
	if result.Message != "已切换到 beta 渠道并同步最新资源" {
		t.Fatalf("message = %q", result.Message)
	}
	persisted, err := configapp.NewCLIConfig(paths.MaaConfigDir).GetCoreChannel()
	if err != nil || persisted != "Beta" {
		t.Fatalf("persisted channel = %q, %v", persisted, err)
	}
	calls := runner.Calls()
	if calls[0].command != "install" || !reflect.DeepEqual(calls[0].args, []string{"beta", "--force"}) {
		t.Fatalf("install call = %+v", calls[0])
	}
}

func TestUpdateCoreFailure(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		return domainrun.DTO{}, apperrors.WithStatus("MAA_COMMAND_FAILED", "update exploded", 500, true, nil)
	}}
	service := newService(t, paths, runner, nil)

	_, err := service.UpdateCore(context.Background(), "stable")
	appErr := requireAppError(t, err, "AGENT_MAA_UPDATE_CORE_FAILED", 500, true)
	if appErr.Message != "MaaCore 更新失败: update exploded" {
		t.Fatalf("message = %q", appErr.Message)
	}
	if appErr.Details["failedStep"] != "core" || appErr.Details["coreUpdated"] != false || appErr.Details["version"] != "stable" {
		t.Fatalf("details = %+v", appErr.Details)
	}
	if calls := runner.Calls(); len(calls) != 1 {
		t.Fatalf("calls = %+v", calls)
	}
}

func TestUpdateCoreResourceFailure(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		switch call.command {
		case "update":
			return successDTO("core updated"), nil
		case "version":
			return successDTO("maa-cli 0.7.8\nMaaCore 6.21.4\n"), nil
		case "dir":
			return successDTO(filepath.Join(paths.DataDir, "missing")), nil
		}
		return successDTO(""), nil
	}}
	service := newService(t, paths, runner, nil)

	_, err := service.UpdateCore(context.Background(), "")
	appErr := requireAppError(t, err, "AGENT_MAA_UPDATE_RESOURCE_FAILED", 500, true)
	if appErr.Details["failedStep"] != "resources" || appErr.Details["coreUpdated"] != true {
		t.Fatalf("details = %+v", appErr.Details)
	}
	runtime, ok := appErr.Details["runtime"].(RuntimeInfo)
	if !ok || runtime.Core != "6.21.4" || runtime.Resource != nil {
		t.Fatalf("runtime = %#v", appErr.Details["runtime"])
	}
}

func TestUpdateCoreResourceFailureWhenVersionFails(t *testing.T) {
	paths := tempPaths(t)
	resourceDir := writeResourceVersion(t, filepath.Join(paths.DataDir, "resource"), "2026-07-09 23:28:49.000", time.Now())
	runner := &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		switch call.command {
		case "update":
			return successDTO("core updated"), nil
		case "dir":
			return successDTO(resourceDir), nil
		case "version":
			return domainrun.DTO{}, apperrors.WithStatus("MAA_COMMAND_FAILED", "version failed", 500, true, nil)
		}
		return successDTO(""), nil
	}}
	service := newService(t, paths, runner, nil)

	_, err := service.UpdateCore(context.Background(), "")
	appErr := requireAppError(t, err, "AGENT_MAA_UPDATE_RESOURCE_FAILED", 500, true)
	if appErr.Details["runtime"] != nil {
		t.Fatalf("runtime = %#v", appErr.Details["runtime"])
	}
}

func TestUpdateCLIUnsupported(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		return domainrun.DTO{}, apperrors.WithStatus("MAA_COMMAND_FAILED", "no self", 500, true, nil)
	}}
	service := newService(t, paths, runner, nil)

	_, err := service.UpdateCLI(context.Background())
	appErr := requireAppError(t, err, "AGENT_MAA_CLI_UPDATE_UNSUPPORTED", 409, false)
	if appErr.Details["platform"] != "linux" || appErr.Details["cliPath"] != testMaaCLIPath || appErr.Details["selfUpdateAvailable"] != false {
		t.Fatalf("details = %+v", appErr.Details)
	}
	for _, call := range runner.Calls() {
		if call.command == "self" && len(call.args) == 1 && call.args[0] == "update" {
			t.Fatalf("self update should not run: %+v", call)
		}
	}
}

func TestUpdateCLIBrewOnDarwin(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{}
	system := &fakeSystemRunner{run: func(name string, args []string) (string, string, error) {
		return "brew output", "", nil
	}}
	service := newService(t, paths, runner, func(options *Options) {
		options.Platform = func() string { return "darwin" }
		options.SystemRunner = system
	})

	result, err := service.UpdateCLI(context.Background())
	if err != nil {
		t.Fatalf("UpdateCLI: %v", err)
	}
	if result.Plan.Command == nil || *result.Plan.Command != "brew upgrade maa-cli" || !result.Plan.SelfUpdateAvailable {
		t.Fatalf("plan = %+v", result.Plan)
	}
	if result.Output != "brew output" || result.Message != "MAA CLI 更新完成" {
		t.Fatalf("result = %+v", result)
	}
	if len(system.calls) != 1 || !reflect.DeepEqual(system.calls[0], []string{"brew", "upgrade", "maa-cli"}) {
		t.Fatalf("system calls = %+v", system.calls)
	}
	calls := runner.Calls()
	if len(calls) != 1 || calls[0].command != "self" || !reflect.DeepEqual(calls[0].args, []string{"--help"}) {
		t.Fatalf("runner calls = %+v", calls)
	}
}

func TestUpdateCLISelfUpdate(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		if call.command == "self" && len(call.args) > 0 && call.args[0] == "update" {
			return successDTO("cli updated\n"), nil
		}
		return successDTO("help"), nil
	}}
	service := newService(t, paths, runner, nil)

	result, err := service.UpdateCLI(context.Background())
	if err != nil {
		t.Fatalf("UpdateCLI: %v", err)
	}
	if result.Plan.Command == nil || *result.Plan.Command != "maa self update" {
		t.Fatalf("plan = %+v", result.Plan)
	}
	if result.Output != "cli updated" {
		t.Fatalf("output = %q", result.Output)
	}
	calls := runner.Calls()
	if len(calls) != 2 || calls[0].command != "self" || !reflect.DeepEqual(calls[0].args, []string{"--help"}) {
		t.Fatalf("calls = %+v", calls)
	}
	if calls[1].command != "self" || !reflect.DeepEqual(calls[1].args, []string{"update"}) {
		t.Fatalf("self update call = %+v", calls[1])
	}
	if calls[1].taskName != "更新 MAA CLI" || calls[1].taskType != "cli-update" || !calls[1].wait {
		t.Fatalf("self update metadata = %+v", calls[1])
	}
}

func TestUpdateCLIDockerSelfUpdateMessage(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{}
	service := newService(t, paths, runner, func(options *Options) {
		options.Platform = func() string { return "darwin" }
		options.IsDocker = func() bool { return true }
	})

	result, err := service.UpdateCLI(context.Background())
	if err != nil {
		t.Fatalf("UpdateCLI: %v", err)
	}
	if result.Plan.Command == nil || *result.Plan.Command != "maa self update" {
		t.Fatalf("plan = %+v", result.Plan)
	}
	if result.Message != "MAA CLI 更新完成（Docker 环境）" {
		t.Fatalf("message = %q", result.Message)
	}
}

func TestUpdateCLIFailure(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		if call.command == "self" && len(call.args) > 0 && call.args[0] == "update" {
			return domainrun.DTO{}, apperrors.WithStatus("MAA_COMMAND_FAILED", "update failed", 500, true, nil)
		}
		return successDTO("help"), nil
	}}
	service := newService(t, paths, runner, nil)

	_, err := service.UpdateCLI(context.Background())
	appErr := requireAppError(t, err, "AGENT_MAA_CLI_UPDATE_FAILED", 500, true)
	if appErr.Details["command"] != "maa self update" {
		t.Fatalf("details = %+v", appErr.Details)
	}
}

func TestPlanUpdateCLIHasNoSideEffect(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{}
	service := newService(t, paths, runner, nil)

	plan, err := service.PlanUpdateCLI(context.Background())
	if err != nil {
		t.Fatalf("PlanUpdateCLI: %v", err)
	}
	if plan.Action != "update-cli" || plan.Command == nil || *plan.Command != "maa self update" || plan.Platform != "linux" || !plan.SelfUpdateAvailable {
		t.Fatalf("plan = %+v", plan)
	}
	calls := runner.Calls()
	if len(calls) != 1 || calls[0].command != "self" {
		t.Fatalf("calls = %+v", calls)
	}
}

func TestRunAutoUpdate(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		if call.command == "self" && len(call.args) > 0 && call.args[0] == "update" {
			return successDTO("cli updated"), nil
		}
		return successDTO("updated"), nil
	}}
	service := newService(t, paths, runner, nil)

	config := map[string]any{"enabled": true, "time": "09:15", "updateCore": true, "updateCli": true}
	if err := service.RunAutoUpdate(context.Background(), config); err != nil {
		t.Fatalf("RunAutoUpdate: %v", err)
	}
	calls := runner.Calls()
	if len(calls) != 3 {
		t.Fatalf("calls = %+v", calls)
	}
	if calls[0].command != "update" || calls[0].taskName != "自动更新 MAA" || calls[0].taskType != "auto-update" {
		t.Fatalf("core call = %+v", calls[0])
	}
	if calls[1].command != "self" || !reflect.DeepEqual(calls[1].args, []string{"--help"}) {
		t.Fatalf("probe call = %+v", calls[1])
	}
	if calls[2].command != "self" || !reflect.DeepEqual(calls[2].args, []string{"update"}) {
		t.Fatalf("cli call = %+v", calls[2])
	}
}

func TestRunAutoUpdateCoreFailureStopsCLI(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		return domainrun.DTO{}, apperrors.WithStatus("MAA_COMMAND_FAILED", "update failed", 500, true, nil)
	}}
	service := newService(t, paths, runner, nil)

	err := service.RunAutoUpdate(context.Background(), map[string]any{"updateCore": true, "updateCli": true})
	if err == nil {
		t.Fatal("expected core failure")
	}
	calls := runner.Calls()
	if len(calls) != 1 || calls[0].command != "update" {
		t.Fatalf("calls = %+v", calls)
	}
}

func TestRunAutoUpdateSkipsUnsupportedCLI(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		if call.command == "self" {
			return domainrun.DTO{}, apperrors.WithStatus("MAA_COMMAND_FAILED", "no self", 500, true, nil)
		}
		return successDTO("updated"), nil
	}}
	service := newService(t, paths, runner, nil)

	if err := service.RunAutoUpdate(context.Background(), map[string]any{"updateCli": true}); err != nil {
		t.Fatalf("RunAutoUpdate: %v", err)
	}
	calls := runner.Calls()
	if len(calls) != 1 || calls[0].command != "self" {
		t.Fatalf("calls = %+v", calls)
	}
}

func TestRunAutoUpdateDockerCLIFailureIsLogged(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		if call.command == "self" && len(call.args) > 0 && call.args[0] == "update" {
			return domainrun.DTO{}, apperrors.WithStatus("MAA_COMMAND_FAILED", "update failed", 500, true, nil)
		}
		return successDTO("help"), nil
	}}
	service := newService(t, paths, runner, func(options *Options) {
		options.IsDocker = func() bool { return true }
	})

	if err := service.RunAutoUpdate(context.Background(), map[string]any{"updateCli": true}); err != nil {
		t.Fatalf("Docker CLI failure should be logged only: %v", err)
	}
}

func TestRunAutoUpdateNonDockerCLIFailure(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{run: func(call runCall) (domainrun.DTO, error) {
		if call.command == "self" && len(call.args) > 0 && call.args[0] == "update" {
			return domainrun.DTO{}, apperrors.WithStatus("MAA_COMMAND_FAILED", "update failed", 500, true, nil)
		}
		return successDTO("help"), nil
	}}
	service := newService(t, paths, runner, nil)

	err := service.RunAutoUpdate(context.Background(), map[string]any{"updateCli": true})
	requireAppError(t, err, "AGENT_MAA_CLI_UPDATE_FAILED", 500, true)
}

func TestRunAutoUpdateDisabledFlags(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{}
	service := newService(t, paths, runner, nil)

	if err := service.RunAutoUpdate(context.Background(), map[string]any{"enabled": true}); err != nil {
		t.Fatalf("RunAutoUpdate: %v", err)
	}
	if calls := runner.Calls(); len(calls) != 0 {
		t.Fatalf("calls = %+v", calls)
	}
}

func TestParseAutoUpdateConfig(t *testing.T) {
	parsed := ParseAutoUpdateConfig(map[string]any{
		"enabled":    true,
		"time":       "09:15",
		"updateCore": true,
		"updateCli":  "yes",
	})
	if !parsed.Enabled || parsed.Time != "09:15" || !parsed.UpdateCore || !parsed.UpdateCLI {
		t.Fatalf("parsed = %+v", parsed)
	}

	empty := ParseAutoUpdateConfig(nil)
	if empty.Enabled || empty.Time != "" || empty.UpdateCore || empty.UpdateCLI {
		t.Fatalf("empty = %+v", empty)
	}

	zero := ParseAutoUpdateConfig(map[string]any{"enabled": float64(0), "updateCore": float64(1)})
	if zero.Enabled || !zero.UpdateCore {
		t.Fatalf("zero = %+v", zero)
	}
}

func TestBuildAutoUpdateStatus(t *testing.T) {
	enabled := BuildAutoUpdateStatus(true, "09:15")
	if !enabled.Enabled || enabled.Time == nil || *enabled.Time != "09:15" {
		t.Fatalf("enabled = %+v", enabled)
	}
	for _, status := range []AutoUpdateStatus{
		BuildAutoUpdateStatus(false, "09:15"),
		BuildAutoUpdateStatus(true, ""),
	} {
		encoded, err := json.Marshal(status)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		if string(encoded) != `{"enabled":false,"time":null}` {
			t.Fatalf("status json = %s", encoded)
		}
	}
}

func TestPlanUpdateCoreChannels(t *testing.T) {
	current := PlanUpdateCore("")
	if current.Steps[0].TargetChannel != "current" || current.Steps[0].Command != "update" {
		t.Fatalf("current = %+v", current.Steps[0])
	}
	stable := PlanUpdateCore("stable")
	if stable.Steps[0].TargetChannel != "stable" || !reflect.DeepEqual(stable.Steps[0].Args, []string{"stable", "--force"}) {
		t.Fatalf("stable = %+v", stable.Steps[0])
	}
	hot := PlanHotUpdateResources()
	if hot.Action != "hot-update-resources" || hot.Command != "hot-update" {
		t.Fatalf("hot = %+v", hot)
	}
}

func TestRunnerUnavailableFailsClosed(t *testing.T) {
	paths := tempPaths(t)
	service := newService(t, paths, nil, nil)

	_, err := service.GetVersion(context.Background())
	appErr := requireAppError(t, err, "MAA_CLI_NOT_FOUND", 503, false)
	if appErr.Message != "MAA CLI 未配置" {
		t.Fatalf("message = %q", appErr.Message)
	}
}

func TestErrorPassThroughPreservesMessage(t *testing.T) {
	if got := errorMessage(errors.New("plain")); got != "plain" {
		t.Fatalf("errorMessage = %q", got)
	}
	appErr := apperrors.WithStatus("X", "wrapped", 500, true, nil)
	if got := errorMessage(appErr); got != "wrapped" {
		t.Fatalf("errorMessage = %q", got)
	}
}

func TestDryRunActionPayloads(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{}
	service := newService(t, paths, runner, nil)

	core, err := service.UpdateCoreAction(context.Background(), "beta", true)
	if err != nil {
		t.Fatalf("UpdateCoreAction: %v", err)
	}
	data, ok := core.Data.(map[string]any)
	if !ok || !core.DryRun || core.Message != DryRunMessage {
		t.Fatalf("core outcome = %+v", core)
	}
	plan, ok := data["plan"].(UpdateCorePlan)
	if !ok || plan.Steps[0].TargetChannel != "beta" || plan.Steps[0].Command != "install" {
		t.Fatalf("core plan = %#v", data["plan"])
	}

	hot, err := service.HotUpdateResourcesAction(context.Background(), true)
	if err != nil {
		t.Fatalf("HotUpdateResourcesAction: %v", err)
	}
	hotData, ok := hot.Data.(map[string]any)
	if !ok || !hot.DryRun || hot.Message != DryRunMessage {
		t.Fatalf("hot outcome = %+v", hot)
	}
	hotPlan, ok := hotData["plan"].(HotUpdatePlan)
	if !ok || hotPlan.Action != "hot-update-resources" {
		t.Fatalf("hot plan = %#v", hotData["plan"])
	}

	if calls := runner.Calls(); len(calls) != 0 {
		t.Fatalf("dry runs should not call the runner: %+v", calls)
	}
}

func TestUpdateCLIDryRunActionStillProbesSelf(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{}
	service := newService(t, paths, runner, nil)

	outcome, err := service.UpdateCLIAction(context.Background(), true)
	if err != nil {
		t.Fatalf("UpdateCLIAction: %v", err)
	}
	data, ok := outcome.Data.(map[string]any)
	if !ok || !outcome.DryRun || outcome.Message != DryRunMessage {
		t.Fatalf("outcome = %+v", outcome)
	}
	plan, ok := data["plan"].(UpdateCLIPlan)
	if !ok || plan.Command == nil || *plan.Command != "maa self update" {
		t.Fatalf("plan = %#v", data["plan"])
	}
	calls := runner.Calls()
	if len(calls) != 1 || calls[0].command != "self" {
		t.Fatalf("calls = %+v", calls)
	}
}

func TestActionPayloadJSONShapes(t *testing.T) {
	corePlan, err := json.Marshal(PlanUpdateCore(""))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	wantCore := `{"action":"update-core-and-resources","steps":[{"action":"update-core","targetChannel":"current","command":"update","args":[]}],"resourcesIncluded":true}`
	if string(corePlan) != wantCore {
		t.Fatalf("core plan json = %s", corePlan)
	}

	hotPlan, err := json.Marshal(PlanHotUpdateResources())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(hotPlan) != `{"action":"hot-update-resources","command":"hot-update"}` {
		t.Fatalf("hot plan json = %s", hotPlan)
	}

	status, err := json.Marshal(BuildAutoUpdateStatus(true, "09:15"))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(status) != `{"enabled":true,"time":"09:15"}` {
		t.Fatalf("status json = %s", status)
	}
}

func TestRunAutoUpdateSkipsUnsupportedPlatformCLI(t *testing.T) {
	paths := tempPaths(t)
	runner := &fakeRunner{}
	service := newService(t, paths, runner, func(options *Options) {
		options.Platform = func() string { return "freebsd" }
	})

	if err := service.RunAutoUpdate(context.Background(), map[string]any{"updateCli": true}); err != nil {
		t.Fatalf("RunAutoUpdate: %v", err)
	}
	if calls := runner.Calls(); len(calls) != 1 || calls[0].command != "self" {
		t.Fatalf("calls = %+v", calls)
	}
}
