package maa

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/infra/process"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const (
	defaultGrace   = 3 * time.Second
	maxStdoutBytes = 5 * 1024 * 1024
	maxStderrBytes = 1024 * 1024
	maxLineChars   = 4000
)

// Runner owns the maa CLI process. It deliberately does not own the execution
// lease: callers must acquire internal/app/execution before starting a task.
type Runner struct {
	mu      sync.Mutex
	path    string
	logger  *slog.Logger
	current *Task
}

type ExecOptions struct {
	TaskName string
	Wait     bool
	Timeout  time.Duration
	Dir      string
	Env      []string
	OnLine   func(stream, line string)
}

type Result struct {
	ExitCode int
	Stdout   string
	Stderr   string
	Started  bool
	Stopped  bool
	Err      error
	Duration time.Duration
}

type Task struct {
	runner    *Runner
	name      string
	process   *process.Process
	stdout    *boundedBuffer
	stderr    *boundedBuffer
	stdoutLog *lineWriter
	stderrLog *lineWriter
	startedAt time.Time
	done      chan struct{}
	mu        sync.Mutex
	result    Result
	stopped   bool
}

func New(path string, logger *slog.Logger) *Runner {
	if logger == nil {
		logger = slog.Default()
	}
	return &Runner{path: path, logger: logger}
}

func (r *Runner) Path() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.path
}

// SetPath changes the executable used by the next MAA command. It does not
// interrupt a running task.
func (r *Runner) SetPath(path string) {
	r.mu.Lock()
	r.path = path
	r.mu.Unlock()
}

func (r *Runner) Exec(ctx context.Context, command string, args []string, options ExecOptions) (*Task, error) {
	r.mu.Lock()
	executable := r.path
	if strings.TrimSpace(executable) == "" {
		r.mu.Unlock()
		return nil, apperrors.WithStatus("MAA_CLI_NOT_FOUND", "MAA CLI 路径为空", 503, false, nil)
	}
	if r.current != nil && r.current.Running() {
		current := r.current
		r.mu.Unlock()
		return nil, apperrors.WithStatus("MAA_TASK_BUSY", "MAA 正在执行："+current.name, 409, true, map[string]any{"taskName": current.name})
	}
	r.mu.Unlock()

	fullArgs := append([]string{command}, args...)
	stdout := &boundedBuffer{limit: maxStdoutBytes}
	stderr := &boundedBuffer{limit: maxStderrBytes}
	stdoutLog := &lineWriter{stream: "stdout", onLine: options.OnLine}
	stderrLog := &lineWriter{stream: "stderr", onLine: options.OnLine}

	env := options.Env
	if env == nil {
		env = os.Environ()
	}
	child, err := process.Start(executable, fullArgs, process.Options{
		Dir:      options.Dir,
		Env:      env,
		Detached: true,
		Stdout:   io.MultiWriter(stdout, stdoutLog),
		Stderr:   io.MultiWriter(stderr, stderrLog),
	})
	if err != nil {
		return nil, apperrors.WithStatus("MAA_CLI_NOT_FOUND", "无法启动 MAA CLI: "+err.Error(), 503, false, map[string]any{"path": executable, "error": err.Error()})
	}
	task := &Task{
		runner:    r,
		name:      options.TaskName,
		process:   child,
		stdout:    stdout,
		stderr:    stderr,
		stdoutLog: stdoutLog,
		stderrLog: stderrLog,
		startedAt: time.Now(),
		done:      make(chan struct{}),
		result:    Result{Started: true},
	}
	r.mu.Lock()
	r.current = task
	r.mu.Unlock()

	go func() {
		waitErr := child.Wait()
		stdoutLog.Close()
		stderrLog.Close()
		task.mu.Lock()
		exitCode := child.ExitCode()
		task.result.ExitCode = exitCode
		task.result.Stdout = stdout.String()
		task.result.Stderr = stderr.String()
		task.result.Duration = time.Since(task.startedAt)
		task.result.Stopped = task.stopped
		if waitErr != nil && exitCode < 0 {
			task.result.Err = apperrors.WithStatus("MAA_PROCESS_EXITED", "MAA 进程异常退出", 503, true, map[string]any{"error": waitErr.Error()})
		} else if exitCode != 0 && !task.stopped {
			message, retryable := maaFailureMessage(exitCode, stderr.String())
			task.result.Err = apperrors.WithStatus("MAA_COMMAND_FAILED", message, 500, retryable, map[string]any{"exitCode": exitCode, "stdout": stdout.String(), "stderr": stderr.String()})
		}
		task.mu.Unlock()
		close(task.done)
		r.clear(task)
	}()

	// Stop the task if the caller's context is cancelled. The waiter is
	// detached from the task's lifecycle and exits when the task does.
	go func() {
		select {
		case <-ctx.Done():
			_ = task.Stop(context.Background(), defaultGrace)
		case <-task.done:
		}
	}()

	if options.Wait {
		result := task.Wait(ctx)
		return task, result.Err
	}
	return task, nil
}

func (r *Runner) clear(task *Task) {
	r.mu.Lock()
	if r.current == task {
		r.current = nil
	}
	r.mu.Unlock()
}

func (r *Runner) Current() (*Task, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.current == nil {
		return nil, false
	}
	return r.current, true
}

func (r *Runner) Stop(ctx context.Context, grace time.Duration) error {
	r.mu.Lock()
	task := r.current
	r.mu.Unlock()
	if task == nil {
		return nil
	}
	return task.Stop(ctx, grace)
}

func (t *Task) Name() string { return t.name }

func (t *Task) PID() int {
	if t == nil || t.process == nil {
		return 0
	}
	return t.process.PID()
}

func (t *Task) Running() bool {
	if t == nil {
		return false
	}
	select {
	case <-t.done:
		return false
	default:
		return true
	}
}

func (t *Task) Wait(ctx context.Context) Result {
	if t == nil {
		return Result{}
	}
	select {
	case <-t.done:
	case <-ctx.Done():
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.result
}

func (t *Task) Stop(ctx context.Context, grace time.Duration) error {
	if t == nil {
		return nil
	}
	select {
	case <-t.done:
		return nil
	default:
	}
	t.mu.Lock()
	t.stopped = true
	t.mu.Unlock()
	err := t.process.Terminate(grace)
	select {
	case <-t.done:
	case <-ctx.Done():
		return ctx.Err()
	}
	return err
}

type boundedBuffer struct {
	mu    sync.Mutex
	buf   bytes.Buffer
	limit int
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	_, _ = b.buf.Write(p)
	if b.limit > 0 && b.buf.Len() > b.limit {
		data := b.buf.Bytes()
		keep := data[len(data)-b.limit:]
		copied := append([]byte(nil), keep...)
		b.buf.Reset()
		_, _ = b.buf.Write(copied)
	}
	return len(p), nil
}

func (b *boundedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

type lineWriter struct {
	mu      sync.Mutex
	stream  string
	onLine  func(stream, line string)
	pending []byte
}

func (w *lineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.pending = append(w.pending, p...)
	for {
		index := bytes.IndexByte(w.pending, '\n')
		if index < 0 {
			if len(w.pending) > maxLineChars {
				w.emit(string(w.pending[:maxLineChars]))
				w.pending = w.pending[maxLineChars:]
			}
			break
		}
		line := string(w.pending[:index])
		w.pending = w.pending[index+1:]
		w.emit(line)
	}
	return len(p), nil
}

func (w *lineWriter) Close() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.pending) > 0 {
		w.emit(string(w.pending))
		w.pending = nil
	}
}

func (w *lineWriter) emit(line string) {
	line = strings.TrimSuffix(line, "\r")
	if w.onLine == nil || line == "" {
		return
	}
	w.onLine(w.stream, line)
}

// maaFailureMessage turns the CLI exit into a user-facing message. MaaCore
// rejects a Copilot task whose stages are missing from the resource with
// "invalid params"; retrying the same command cannot help until the resource
// is refreshed. A network failure during the automatic resource update is
// transient and retryable.
func maaFailureMessage(exitCode int, stderr string) (string, bool) {
	text := strings.ToLower(stderr)
	if strings.Contains(text, "invalid params") {
		return "MAA 拒绝了任务参数，请先热更新 MAA 资源或检查作业配置", false
	}
	if strings.Contains(text, "network error") || strings.Contains(text, "unexpected end of file") {
		return "MAA 检查资源更新时网络失败，请稍后重试", true
	}
	return fmt.Sprintf("MAA 退出码 %d", exitCode), true
}
