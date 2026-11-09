package scheduler

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
)

func noDelay(ctx context.Context, _ time.Duration) bool {
	return ctx.Err() == nil
}

type fakeCall struct {
	Kind       string
	Command    string
	Args       []string
	TaskConfig map[string]any
	Name       string
	TaskType   string
	Wait       bool
}

type fakeExecutor struct {
	mu                sync.Mutex
	calls             []fakeCall
	stdout            string
	stderr            string
	commandErrors     map[string]error
	taskError         error
	taskErrorSequence []error
	blockCommands     map[string]bool
	started           chan string
	stopCount         int
	runSequence       int
}

func (f *fakeExecutor) RunCommand(ctx context.Context, command string, args []string, taskName, taskType string, wait bool) (domainrun.DTO, error) {
	f.mu.Lock()
	f.calls = append(f.calls, fakeCall{
		Kind:     "command",
		Command:  command,
		Args:     append([]string(nil), args...),
		Name:     taskName,
		TaskType: taskType,
		Wait:     wait,
	})
	f.runSequence++
	sequence := f.runSequence
	commandErr := f.commandErrors[command]
	block := f.blockCommands[command]
	started := f.started
	stdout, stderr := f.stdout, f.stderr
	f.mu.Unlock()

	if started != nil {
		select {
		case started <- command:
		default:
		}
	}
	if block {
		<-ctx.Done()
		return domainrun.DTO{}, ctx.Err()
	}
	if commandErr != nil {
		return domainrun.DTO{}, commandErr
	}
	return domainrun.DTO{
		RunID: fmt.Sprintf("run-%d", sequence),
		State: domainrun.StatusSucceeded,
		Result: map[string]any{
			"stdout": stdout,
			"stderr": stderr,
		},
	}, nil
}

func (f *fakeExecutor) RunTask(ctx context.Context, taskConfig map[string]any, wait bool) (domainrun.DTO, error) {
	f.mu.Lock()
	f.calls = append(f.calls, fakeCall{
		Kind:       "task",
		TaskConfig: taskConfig,
		Wait:       wait,
	})
	f.runSequence++
	sequence := f.runSequence
	taskErr := f.taskError
	if len(f.taskErrorSequence) > 0 {
		taskErr = f.taskErrorSequence[0]
		f.taskErrorSequence = f.taskErrorSequence[1:]
	}
	stdout, stderr := f.stdout, f.stderr
	f.mu.Unlock()

	if taskErr != nil {
		return domainrun.DTO{}, taskErr
	}
	return domainrun.DTO{
		RunID: fmt.Sprintf("run-%d", sequence),
		State: domainrun.StatusSucceeded,
		Result: map[string]any{
			"stdout": stdout,
			"stderr": stderr,
		},
	}, nil
}

func (f *fakeExecutor) Stop(context.Context) error {
	f.mu.Lock()
	f.stopCount++
	f.mu.Unlock()
	return nil
}

func (f *fakeExecutor) callsSnapshot() []fakeCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]fakeCall(nil), f.calls...)
}

func (f *fakeExecutor) stopCountSnapshot() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.stopCount
}

type fakeDropRecorder struct {
	mu       sync.Mutex
	payloads []any
}

func (r *fakeDropRecorder) RecordDrops(payload any) error {
	r.mu.Lock()
	r.payloads = append(r.payloads, payload)
	r.mu.Unlock()
	return nil
}

func (r *fakeDropRecorder) payloadSnapshot() []any {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]any(nil), r.payloads...)
}

type fakeConfigSource struct {
	configs map[string]map[string]any
	errors  map[string]error
}

func (s *fakeConfigSource) Load(configType string) (map[string]any, error) {
	if err := s.errors[configType]; err != nil {
		return nil, err
	}
	return s.configs[configType], nil
}

func newTestService(executor TaskExecutor, options Options) *Service {
	if options.Delay == nil {
		options.Delay = noDelay
	}
	options.DisableCronSchedule = true
	return New(executor, config.Paths{}, options)
}
