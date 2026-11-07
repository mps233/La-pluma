package process

import (
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

// Options configures a child process. Detached starts the child in its own
// process group on POSIX so a stop can terminate the whole tree.
type Options struct {
	Dir      string
	Env      []string
	Detached bool
	Stdin    io.Reader
	Stdout   io.Writer
	Stderr   io.Writer
}

type Process struct {
	cmd      *exec.Cmd
	detached bool
	done     chan struct{}
	waitErr  error
	waitOnce sync.Once
}

func Start(path string, args []string, options Options) (*Process, error) {
	cmd := exec.Command(path, args...)
	cmd.Dir = options.Dir
	cmd.Env = options.Env
	cmd.Stdin = options.Stdin
	cmd.Stdout = options.Stdout
	cmd.Stderr = options.Stderr
	configure(cmd, options.Detached)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	process := &Process{cmd: cmd, detached: options.Detached, done: make(chan struct{})}
	go func() {
		process.waitOnce.Do(func() {
			process.waitErr = cmd.Wait()
			close(process.done)
		})
	}()
	return process, nil
}

func (p *Process) PID() int {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return 0
	}
	return p.cmd.Process.Pid
}

func (p *Process) Done() <-chan struct{} {
	return p.done
}

func (p *Process) Wait() error {
	if p == nil {
		return nil
	}
	<-p.done
	return p.waitErr
}

func (p *Process) ExitCode() int {
	if p == nil || p.cmd == nil || p.cmd.ProcessState == nil {
		return -1
	}
	return p.cmd.ProcessState.ExitCode()
}

func (p *Process) Signal(signal os.Signal) error {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return os.ErrProcessDone
	}
	return signalProcess(p.cmd, p.detached, signal)
}

// Terminate sends SIGTERM, waits up to grace, then escalates to SIGKILL. It
// always waits for the child so callers do not leak zombies.
func (p *Process) Terminate(grace time.Duration) error {
	if p == nil {
		return nil
	}
	select {
	case <-p.done:
		return nil
	default:
	}
	_ = p.Signal(terminationSignal())
	if grace <= 0 {
		grace = 3 * time.Second
	}
	timer := time.NewTimer(grace)
	defer timer.Stop()
	select {
	case <-p.done:
		return nil
	case <-timer.C:
		_ = p.Kill()
		<-p.done
		return nil
	}
}

func (p *Process) Kill() error {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return os.ErrProcessDone
	}
	return killProcess(p.cmd, p.detached)
}
