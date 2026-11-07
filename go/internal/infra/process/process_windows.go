//go:build windows

package process

import (
	"os"
	"os/exec"
	"syscall"
)

const createNewProcessGroup = 0x00000200

func configure(cmd *exec.Cmd, detached bool) {
	if detached {
		cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}
	}
}

func signalProcess(cmd *exec.Cmd, detached bool, signal os.Signal) error {
	if cmd == nil || cmd.Process == nil {
		return os.ErrProcessDone
	}
	// Windows has no SIGTERM. The console control path is handled by the
	// caller; a terminate here is a hard stop.
	return cmd.Process.Kill()
}

func killProcess(cmd *exec.Cmd, detached bool) error {
	if cmd == nil || cmd.Process == nil {
		return os.ErrProcessDone
	}
	return cmd.Process.Kill()
}
func terminationSignal() os.Signal { return os.Interrupt }
