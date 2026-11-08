//go:build !windows

package maa

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func fakeMAA(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "maa")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func errorCode(err error) string {
	if appErr, ok := apperrors.As(err); ok {
		return appErr.Code
	}
	return ""
}

func TestExecWaitCaptureAndLines(t *testing.T) {
	runner := New(fakeMAA(t, "echo 'Assistant::append_callback | {\"type\":\"TaskStarted\"}'\necho done\nexit 0"), testLogger())
	var lines []string
	task, err := runner.Exec(context.Background(), "run", nil, ExecOptions{
		TaskName: "daily",
		Wait:     true,
		OnLine: func(stream, line string) {
			lines = append(lines, stream+":"+line)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	result := task.Wait(context.Background())
	if result.ExitCode != 0 || !result.Started || result.Err != nil {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(lines) != 2 || lines[0] != `stdout:Assistant::append_callback | {"type":"TaskStarted"}` || lines[1] != "stdout:done" {
		t.Fatalf("unexpected lines: %#v", lines)
	}
}

func TestExecAsyncAndStop(t *testing.T) {
	runner := New(fakeMAA(t, "trap '' TERM; sleep 30"), testLogger())
	task, err := runner.Exec(context.Background(), "run", nil, ExecOptions{TaskName: "long"})
	if err != nil {
		t.Fatal(err)
	}
	if !task.Running() {
		t.Fatal("task should be running")
	}
	if _, err := runner.Exec(context.Background(), "run", nil, ExecOptions{}); err == nil || errorCode(err) != "MAA_TASK_BUSY" {
		t.Fatalf("expected busy, got %v", err)
	}
	if err := task.Stop(context.Background(), 150*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	result := task.Wait(context.Background())
	if !result.Stopped {
		t.Fatalf("expected stopped result: %+v", result)
	}
	if _, ok := runner.Current(); ok {
		t.Fatal("runner should be clear after task exit")
	}
}

func TestExecFailure(t *testing.T) {
	runner := New(fakeMAA(t, "echo boom >&2; exit 7"), testLogger())
	task, err := runner.Exec(context.Background(), "run", nil, ExecOptions{Wait: true})
	if err == nil || errorCode(err) != "MAA_COMMAND_FAILED" {
		t.Fatalf("expected command failure, got %v", err)
	}
	if result := task.Wait(context.Background()); result.ExitCode != 7 || result.Stderr == "" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestSetPath(t *testing.T) {
	runner := New("old-maa", nil)
	if runner.Path() != "old-maa" {
		t.Fatalf("path = %s", runner.Path())
	}
	runner.SetPath("new-maa")
	if runner.Path() != "new-maa" {
		t.Fatalf("path = %s", runner.Path())
	}
}

func TestMissingCLI(t *testing.T) {
	runner := New(filepath.Join(t.TempDir(), "missing-maa"), testLogger())
	if _, err := runner.Exec(context.Background(), "run", nil, ExecOptions{Wait: true}); err == nil || errorCode(err) != "MAA_CLI_NOT_FOUND" {
		t.Fatalf("expected CLI not found, got %v", err)
	}
}
