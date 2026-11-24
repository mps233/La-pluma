//go:build !windows

package maa

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
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

func TestClassifyMAAFailureKnownFailures(t *testing.T) {
	failure := classifyMAAFailure(1, "Error: Failed to add task with params: invalid params", "")
	if failure.Retryable || !strings.Contains(failure.Message, "热更新") || failure.Kind != "invalid_params" {
		t.Fatalf("invalid params: %+v", failure)
	}
	failure = classifyMAAFailure(1, "Error: Network error\nCaused by:\n    io: unexpected end of file\n", "")
	if !failure.Retryable || !strings.Contains(failure.Message, "网络失败") || failure.Kind != "network" {
		t.Fatalf("network failure: %+v", failure)
	}
	failure = classifyMAAFailure(1, "some other failure", "")
	if !failure.Retryable || failure.Message != "MAA 退出码 1" || failure.Kind != "exit_code" {
		t.Fatalf("other failure: %+v", failure)
	}
}

// The real-world copilot set failure: MaaCore prints the offending operator to
// asst.log, and the generic "invalid params" branch must not win over it.
func TestClassifyMAAFailureCopilotOperElite(t *testing.T) {
	logText := `[2026-11-22 17:57:24.440][ERR][Px24425][Tx22887] parse_oper_usage | Oper 狮蝎 has higher elite requirement: 2 , but elite requirement is set to 1
[2026-11-22 17:57:24.440][ERR][Px24425][Tx22887] parse_groups | Failed to parse oper {
    "name": "狮蝎",
    "requirements": {
        "elite": 1,
        "level": 70,
        "module": 1,
        "skill_level": 7
    },
    "skill": 1,
    "skill_usage": 0
}
[2026-11-22 17:57:24.440][ERR][Px24425][Tx22887] CopilotConfig parse failed
[2026-11-22 17:57:24.441][ERR][Px24425][Tx22887] append_task | invalid params: {`
	failure := classifyMAAFailure(1, "MaaCore returned an error, check its log", logText)
	if failure.Retryable || failure.Kind != "copilot_oper_requirement" {
		t.Fatalf("unexpected failure: %+v", failure)
	}
	for _, want := range []string{"狮蝎", "模组", "精二"} {
		if !strings.Contains(failure.Message, want) {
			t.Fatalf("message %q missing %q", failure.Message, want)
		}
	}
	if failure.Details["oper"] != "狮蝎" || failure.Details["requiredElite"] != 2 || failure.Details["declaredElite"] != 1 {
		t.Fatalf("unexpected details: %#v", failure.Details)
	}
}

func TestClassifyMAAFailureCopilotConfigWithoutOperator(t *testing.T) {
	failure := classifyMAAFailure(1, "", "[ERR] CopilotConfig parse failed\n")
	if failure.Retryable || failure.Kind != "copilot_config_invalid" || !strings.Contains(failure.Message, "作业配置错误") {
		t.Fatalf("unexpected failure: %+v", failure)
	}
}

func TestParseFailedOperEntryStopsAtJSON(t *testing.T) {
	entry, ok := parseFailedOperEntry("parse_groups | Failed to parse oper {\n  \"name\": \"怒潮凛冬\",\n  \"requirements\": {\"elite\": 1, \"module\": 1}\n}\n[ERR] next line")
	if !ok || entry.Name != "怒潮凛冬" || entry.Requirements.Module == nil || *entry.Requirements.Module != 1 {
		t.Fatalf("unexpected entry: %+v ok=%v", entry, ok)
	}
	if entry.Requirements.Elite == nil || *entry.Requirements.Elite != 1 {
		t.Fatalf("unexpected elite: %+v", entry.Requirements)
	}
}

func TestExecFailureUsesFailureLogTail(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "asst.log")
	stale := "parse_oper_usage | Oper 旧错误 has higher elite requirement: 2 , but elite requirement is set to 1\n"
	if err := os.WriteFile(logPath, []byte(stale), 0o644); err != nil {
		t.Fatal(err)
	}
	script := `printf '%s\n' 'parse_oper_usage | Oper 狮蝎 has higher elite requirement: 2 , but elite requirement is set to 1' >> "$MAA_TEST_LOG"
printf '%s\n' 'parse_groups | Failed to parse oper {"name":"狮蝎","requirements":{"elite":1,"module":1}}' >> "$MAA_TEST_LOG"
echo boom >&2
exit 1`
	runner := New(fakeMAA(t, script), testLogger())
	runner.SetLogPath(logPath)
	_, err := runner.Exec(context.Background(), "copilot", nil, ExecOptions{
		Wait: true,
		Env:  append(os.Environ(), "MAA_TEST_LOG="+logPath),
	})
	if err == nil {
		t.Fatal("expected failure")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != "MAA_COMMAND_FAILED" {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Contains(appErr.Message, "旧错误") || !strings.Contains(appErr.Message, "狮蝎") || !strings.Contains(appErr.Message, "模组") {
		t.Fatalf("message should only describe the new failure: %q", appErr.Message)
	}
	if appErr.Retryable {
		t.Fatalf("copilot config failure must not be retryable: %+v", appErr)
	}
}
