package maa

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"time"

	runapp "github.com/mps233/la-pluma/go/internal/app/agentrun"
	"github.com/mps233/la-pluma/go/internal/app/execution"
	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	infraMaa "github.com/mps233/la-pluma/go/internal/infra/maa"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const dynamicTaskDir = "_lapluma"

// Service executes MAA CLI commands through the shared execution lease and
// records every accepted side effect as a durable Agent run.
type Service struct {
	cfg       config.Config
	logger    *slog.Logger
	runner    *infraMaa.Runner
	execution *execution.Manager
	runs      *runapp.Service

	mu     sync.Mutex
	onLine func(stream, line string)
}

type RunRequest struct {
	OperationID    string
	Command        string
	Args           []string
	TaskName       string
	TaskType       string
	Wait           bool
	Input          any
	Metadata       any
	Trigger        any
	IdempotencyKey *string
}

func NewService(cfg config.Config, logger *slog.Logger, runner *infraMaa.Runner, executionManager *execution.Manager, runs *runapp.Service) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{cfg: cfg, logger: logger, runner: runner, execution: executionManager, runs: runs}
}

func (s *Service) SetLineHandler(handler func(stream, line string)) {
	s.mu.Lock()
	s.onLine = handler
	s.mu.Unlock()
}

func (s *Service) lineHandler() func(stream, line string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.onLine
}

func (s *Service) Run(ctx context.Context, request RunRequest) (domainrun.DTO, bool, error) {
	if strings.TrimSpace(request.Command) == "" {
		return domainrun.DTO{}, false, apperrors.Validation("MAA_COMMAND_REQUIRED", "MAA 命令不能为空", nil)
	}
	operationID := request.OperationID
	if operationID == "" {
		operationID = "run_task"
	}
	run, replayed, err := s.runs.Begin(runapp.BeginInput{
		OperationID:    operationID,
		IdempotencyKey: request.IdempotencyKey,
		Input:          request.Input,
		Metadata:       request.Metadata,
		Trigger:        request.Trigger,
	})
	if err != nil {
		return domainrun.DTO{}, false, err
	}
	if replayed {
		return run, true, nil
	}

	if request.Wait {
		return s.execute(ctx, run, request)
	}
	go func() {
		execCtx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		if _, _, err := s.execute(execCtx, run, request); err != nil {
			s.logger.Warn("background MAA task failed", "run_id", run.RunID, "error", err)
		}
	}()
	return run, false, nil
}

func (s *Service) execute(ctx context.Context, run domainrun.DTO, request RunRequest) (domainrun.DTO, bool, error) {
	if _, err := s.runs.StartForExecution(run.RunID); err != nil {
		return domainrun.DTO{}, false, err
	}
	lease, err := s.execution.Acquire(ctx, execution.Request{
		Source:   request.TaskType,
		TaskName: stringPtr(request.TaskName),
		Command:  stringPtr(request.Command),
		RunID:    stringPtr(run.RunID),
	})
	if err != nil {
		failed, _ := s.runs.Fail(run.RunID, err)
		return failed, false, err
	}
	defer lease.Release()

	task, err := s.runner.Exec(ctx, request.Command, request.Args, infraMaa.ExecOptions{
		TaskName: request.TaskName,
		Wait:     true,
		Dir:      s.cfg.Paths.MaaConfigDir,
		Env:      os.Environ(),
		OnLine:   s.lineHandler(),
	})
	if err != nil {
		failed, _ := s.runs.Fail(run.RunID, err)
		return failed, false, err
	}
	result := task.Wait(ctx)
	if result.Err != nil {
		failed, _ := s.runs.Fail(run.RunID, result.Err)
		return failed, false, result.Err
	}
	completed, err := s.runs.Complete(run.RunID, map[string]any{
		"exitCode": result.ExitCode,
		"stdout":   result.Stdout,
	})
	if err != nil {
		return domainrun.DTO{}, false, err
	}
	return completed, false, nil
}

// RunTask writes a MAA dynamic task file and executes it with `maa run
// --batch`. The temporary file lives under the MAA tasks directory and is
// removed after the run.
func (s *Service) RunTask(ctx context.Context, input any, wait bool, idempotencyKey *string) (domainrun.DTO, bool, error) {
	configMap, ok := input.(map[string]any)
	if !ok {
		return domainrun.DTO{}, false, apperrors.Validation("AGENT_VALIDATION_TASK_CONFIG_INVALID", "taskConfig 必须是对象", nil)
	}
	taskName, taskType := taskIdentity(configMap)
	taskID := fmt.Sprintf("task_%d_%s", time.Now().UnixNano(), randomSuffix())
	taskContent, err := buildTaskFile(configMap)
	if err != nil {
		return domainrun.DTO{}, false, err
	}
	dir := filepath.Join(s.cfg.Paths.MaaConfigDir, "tasks", dynamicTaskDir)
	if err := jsonstore.EnsureDir(dir); err != nil {
		return domainrun.DTO{}, false, apperrors.WithStatus("MAA_TASK_FILE_FAILED", "无法创建动态任务目录", 500, false, map[string]any{"error": err.Error()})
	}
	taskPath := filepath.Join(dir, taskID+".json")
	if err := jsonstore.Write(taskPath, taskContent, true); err != nil {
		return domainrun.DTO{}, false, apperrors.WithStatus("MAA_TASK_FILE_FAILED", "无法写入动态任务文件", 500, false, map[string]any{"error": err.Error()})
	}
	cleanup := func() { _ = os.Remove(taskPath) }
	address := os.Getenv("ADB_ADDRESS")
	if strings.TrimSpace(address) == "" {
		address = "127.0.0.1:16384"
	}
	args := []string{"--batch", filepath.ToSlash(filepath.Join(dynamicTaskDir, taskID)), "--addr", address}
	run, replayed, err := s.Run(ctx, RunRequest{
		OperationID:    "run_task",
		Command:        "run",
		Args:           args,
		TaskName:       taskName,
		TaskType:       taskType,
		Wait:           wait,
		Input:          input,
		Metadata:       map[string]any{"taskName": taskName, "taskType": taskType},
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		cleanup()
		return domainrun.DTO{}, false, err
	}
	if !wait {
		go func() {
			// The task goroutine removes the file after it exits; a stale file
			// would otherwise remain until the next cleanup pass.
			time.Sleep(30 * time.Second)
			cleanup()
		}()
	} else {
		cleanup()
	}
	return run, replayed, nil
}

func (s *Service) StartGame(ctx context.Context, wait bool, idempotencyKey *string) (domainrun.DTO, bool, error) {
	address := os.Getenv("ADB_ADDRESS")
	if strings.TrimSpace(address) == "" {
		address = "127.0.0.1:16384"
	}
	return s.Run(ctx, RunRequest{
		OperationID:    "start_game",
		Command:        "startup",
		Args:           []string{"Official", "--addr", address},
		TaskName:       "启动游戏",
		TaskType:       "StartUp",
		Wait:           wait,
		Input:          map[string]any{"action": "start-game"},
		Metadata:       map[string]any{"taskName": "启动游戏", "taskType": "StartUp"},
		IdempotencyKey: idempotencyKey,
	})
}

func (s *Service) Stop(ctx context.Context) error {
	current, ok := s.runs.Current()
	if ok {
		_, _ = s.runs.MarkStopping(current.RunID)
	}
	if err := s.runner.Stop(ctx, 3*time.Second); err != nil {
		return err
	}
	if ok {
		_, err := s.runs.Stop(current.RunID, map[string]any{"stopped": true})
		if err != nil {
			if record, exists := s.runs.Get(current.RunID); exists && record.State.Terminal() {
				return nil
			}
			return err
		}
	}
	return nil
}

func buildTaskFile(input map[string]any) (map[string]any, error) {
	tasksInput, hasTasks := input["tasks"]
	tasks := []any{}
	if hasTasks {
		array, ok := asAnyArray(tasksInput)
		if !ok {
			return nil, apperrors.Validation("AGENT_VALIDATION_TASK_CONFIG_INVALID", "taskConfig.tasks 必须是数组", nil)
		}
		tasks = array
	} else {
		tasks = []any{input}
	}
	normalized := make([]any, 0, len(tasks))
	for _, item := range tasks {
		task, ok := item.(map[string]any)
		if !ok {
			return nil, apperrors.Validation("AGENT_VALIDATION_TASK_CONFIG_INVALID", "任务配置必须是对象", nil)
		}
		params := defaultMap(task["params"])
		if task["type"] == "StartUp" {
			if _, exists := params["start_game_enabled"]; !exists {
				params["start_game_enabled"] = true
			}
		}
		entry := map[string]any{
			"name":   task["name"],
			"type":   task["type"],
			"params": params,
		}
		for _, key := range []string{"strategy", "condition", "variants"} {
			if value, ok := task[key]; ok {
				entry[key] = value
			}
		}
		if entry["name"] == nil || entry["name"] == "" || entry["type"] == nil || entry["type"] == "" {
			return nil, apperrors.Validation("AGENT_VALIDATION_TASK_CONFIG_INVALID", "任务 name 和 type 不能为空", nil)
		}
		normalized = append(normalized, entry)
	}
	output := map[string]any{"tasks": normalized}
	if clientType, ok := input["client_type"].(string); ok && clientType != "" {
		output["client_type"] = clientType
	} else if clientType, ok := input["clientType"].(string); ok && clientType != "" {
		output["client_type"] = clientType
	}
	return output, nil
}

func taskIdentity(input map[string]any) (string, string) {
	name := "MAA 任务"
	taskType := "Custom"
	if tasks, ok := asAnyArray(input["tasks"]); ok && len(tasks) > 0 {
		if first, ok := tasks[0].(map[string]any); ok {
			if value, ok := first["name"].(string); ok && value != "" {
				name = value
			}
			if value, ok := first["type"].(string); ok && value != "" {
				taskType = value
			}
		}
	} else {
		if value, ok := input["name"].(string); ok && value != "" {
			name = value
		}
		if value, ok := input["type"].(string); ok && value != "" {
			taskType = value
		}
	}
	return name, taskType
}

func defaultMap(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return map[string]any{}
}

func stringPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func randomSuffix() string {
	var bytes [4]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "0000"
	}
	return hex.EncodeToString(bytes[:])
}

// MarshalTaskConfig is exported for diagnostics/tests.
func MarshalTaskConfig(value map[string]any) ([]byte, error) {
	return json.MarshalIndent(value, "", "  ")
}

func asAnyArray(value any) ([]any, bool) {
	if value == nil {
		return nil, false
	}
	rv := reflect.ValueOf(value)
	if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
		return nil, false
	}
	if typed, ok := value.([]any); ok {
		return typed, true
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	var result []any
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, false
	}
	return result, true
}
