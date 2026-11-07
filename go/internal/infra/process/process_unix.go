//go:build !windows

package process

import (
	"os"
	"os/exec"
	"syscall"
)

func configure(cmd *exec.Cmd, detached bool) {
	if detached {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	}
}

func signalProcess(cmd *exec.Cmd, detached bool, signal os.Signal) error {
	if cmd == nil || cmd.Process == nil {
		return os.ErrProcessDone
	}
	if detached {
		if sysSignal, ok := signal.(syscall.Signal); ok {
			if err := syscall.Kill(-cmd.Process.Pid, sysSignal); err == nil {
				return nil
			}
		}
	}
	return cmd.Process.Signal(signal)
}

func killProcess(cmd *exec.Cmd, detached bool) error {
	if cmd == nil || cmd.Process == nil {
		return os.ErrProcessDone
	}
	if detached {
		if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err == nil {
			return nil
		}
	}
	return cmd.Process.Kill()
}
func terminationSignal() os.Signal { return syscall.SIGTERM }
