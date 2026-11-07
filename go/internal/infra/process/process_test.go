//go:build !windows

package process

import (
	"bytes"
	"testing"
	"time"
)

func TestStartWaitOutput(t *testing.T) {
	var stdout bytes.Buffer
	child, err := Start("/bin/sh", []string{"-c", "printf hello"}, Options{Stdout: &stdout})
	if err != nil {
		t.Fatal(err)
	}
	if err := child.Wait(); err != nil {
		t.Fatal(err)
	}
	if stdout.String() != "hello" {
		t.Fatalf("stdout = %q", stdout.String())
	}
	if child.ExitCode() != 0 {
		t.Fatalf("exit code = %d", child.ExitCode())
	}
}

func TestTerminateKillsProcessGroup(t *testing.T) {
	child, err := Start("/bin/sh", []string{"-c", "trap '' TERM; sleep 30"}, Options{Detached: true})
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	if err := child.Terminate(150 * time.Millisecond); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("terminate took too long: %s", elapsed)
	}
	select {
	case <-child.Done():
	default:
		t.Fatal("process still running after terminate")
	}
}

func TestTerminateAlreadyExited(t *testing.T) {
	child, err := Start("/bin/sh", []string{"-c", "true"}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if err := child.Wait(); err != nil {
		t.Fatal(err)
	}
	if err := child.Terminate(10 * time.Millisecond); err != nil {
		t.Fatal(err)
	}
}
