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

	runapp "github.com/mps233/la-pluma/go/internal/app/agentrun"
	"github.com/mps233/la-pluma/go/internal/app/execution"
	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	infraMaa "github.com/mps233/la-pluma/go/internal/infra/maa"
)

func newTestService(t *testing.T) (*Service, string) {
	t.Helper()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	maaConfigDir := filepath.Join(root, "maa-config")
	if err := os.MkdirAll(maaConfigDir, 0o700); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(root, "maa")
	body := "#!/bin/sh\necho \"$@\" > \"" + filepath.Join(root, "args.txt") + "\"\n" +
		"if [ \"$1\" = run ]; then cat \"tasks/$3.json\" 2>/dev/null || cat \"$3\" 2>/dev/null; fi\nexit 0\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{Paths: config.Paths{DataDir: dataDir, MaaConfigDir: maaConfigDir}}
	runner := infraMaa.New(script, logger)
	manager := execution.NewManager(filepath.Join(dataDir, "maa-execution.lock"), "test-host", logger)
	runs := runapp.New(filepath.Join(dataDir, "agent-runs.json"), logger)
	if _, err := runs.Initialize(); err != nil {
		t.Fatal(err)
	}
	return NewService(cfg, logger, runner, manager, runs), root
}

func TestStartGameRecordsRun(t *testing.T) {
	service, root := newTestService(t)
	run, replayed, err := service.StartGame(context.Background(), true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if replayed || run.State != domainrun.StatusSucceeded {
		t.Fatalf("unexpected run: %+v replayed=%v", run, replayed)
	}
	args, err := os.ReadFile(filepath.Join(root, "args.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(strings.TrimSpace(string(args)), "startup Official --addr ") {
		t.Fatalf("args = %q", string(args))
	}
	if _, err := os.Stat(filepath.Join(root, "data", "maa-execution.lock")); !os.IsNotExist(err) {
		t.Fatalf("lease should be released: %v", err)
	}
}

func TestStartGameDisabledUsesDynamicStartup(t *testing.T) {
	service, root := newTestService(t)
	run, replayed, err := service.StartGameWithOptions(context.Background(), StartGameOptions{
		ClientType:       "Bilibili",
		Address:          "10.0.0.2:5555",
		AccountName:      "alt",
		StartGameEnabled: false,
		Wait:             true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if replayed || run.State != domainrun.StatusSucceeded {
		t.Fatalf("unexpected run: %+v replayed=%v", run, replayed)
	}
	args, err := os.ReadFile(filepath.Join(root, "args.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(strings.TrimSpace(string(args)), "run --batch ") || !strings.Contains(string(args), "--addr 10.0.0.2:5555") {
		t.Fatalf("args = %q", string(args))
	}
	result, _ := run.Result.(map[string]any)
	stdout, _ := result["stdout"].(string)
	for _, want := range []string{`"start_game_enabled": false`, `"account_name": "alt"`, `"client_type": "Bilibili"`} {
		if !strings.Contains(stdout, want) {
			t.Fatalf("task config missing %s: %s", want, stdout)
		}
	}
}

func TestRunTaskWithOptionsUsesAddress(t *testing.T) {
	service, root := newTestService(t)
	_, _, err := service.RunTaskWithOptions(context.Background(), map[string]any{
		"name": "测试任务", "type": "Fight", "params": map[string]any{"stage": "1-7"},
	}, true, nil, RunTaskOptions{Address: "192.168.1.9:5555"})
	if err != nil {
		t.Fatal(err)
	}
	args, err := os.ReadFile(filepath.Join(root, "args.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "--addr 192.168.1.9:5555") {
		t.Fatalf("args = %q", string(args))
	}
}

func TestRunUnderParentAttachesToOuterRun(t *testing.T) {
	service, _ := newTestService(t)
	outer, _, err := service.runs.Begin(runapp.BeginInput{
		OperationID: "run_daily_flow",
		Input:       map[string]any{"scheduleId": "default"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.runs.StartForExecution(outer.RunID); err != nil {
		t.Fatal(err)
	}
	ctx := runapp.WithParentRun(context.Background(), outer.RunID)
	run, replayed, err := service.Run(ctx, RunRequest{
		OperationID: "run_task",
		Command:     "fight",
		Args:        []string{"CE-6"},
		TaskName:    "作战",
		TaskType:    "fight",
		Wait:        true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if replayed || run.RunID != outer.RunID {
		t.Fatalf("parent run = %+v replayed=%v", run, replayed)
	}
	if runs := service.runs.List(); len(runs) != 1 {
		t.Fatalf("nested runs = %d", len(runs))
	}
	current, ok := service.runs.Get(outer.RunID)
	if !ok || current.State != domainrun.StatusRunning {
		t.Fatalf("outer run state = %+v", current)
	}
	if len(current.TaskResults) != 1 {
		t.Fatalf("task results = %#v", current.TaskResults)
	}
	result, _ := current.TaskResults[0].(map[string]any)
	if result["command"] != "fight" || result["state"] != "succeeded" {
		t.Fatalf("task result = %#v", result)
	}
}

func TestStopCurrentReportsRunningTask(t *testing.T) {
	service, _ := newTestService(t)
	outcome := service.StopCurrent(context.Background())
	if outcome.Success {
		t.Fatalf("expected no running task: %+v", outcome)
	}
	if outcome.Message != "当前没有正在运行的任务" || outcome.Err != nil {
		t.Fatalf("outcome = %+v", outcome)
	}
}

func TestRunTaskWritesAndRemovesDynamicFile(t *testing.T) {
	service, root := newTestService(t)
	taskConfig := map[string]any{
		"name":   "测试任务",
		"type":   "Fight",
		"params": map[string]any{"stage": "1-7"},
	}
	run, _, err := service.RunTask(context.Background(), taskConfig, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if run.State != domainrun.StatusSucceeded {
		t.Fatalf("state = %s", run.State)
	}
	args, err := os.ReadFile(filepath.Join(root, "args.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "run --batch _lapluma/") {
		t.Fatalf("unexpected args: %q", string(args))
	}
	entries, err := os.ReadDir(filepath.Join(root, "maa-config", "tasks", "_lapluma"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("dynamic task file should be removed, found %d", len(entries))
	}
}

func TestRunTaskValidation(t *testing.T) {
	service, _ := newTestService(t)
	if _, _, err := service.RunTask(context.Background(), "not-a-map", true, nil); err == nil {
		t.Fatal("expected validation error")
	}
}

func TestStopTransitionsCurrentRun(t *testing.T) {
	service, root := newTestService(t)
	// Replace the fake with a long-running script.
	script := filepath.Join(root, "maa")
	if err := os.WriteFile(script, []byte("#!/bin/sh\ntrap '' TERM\nsleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	run, _, err := service.StartGame(context.Background(), false, nil)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		current, ok := service.runs.Get(run.RunID)
		if ok && current.State == domainrun.StatusRunning {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("run did not start: %+v", current)
		}
		time.Sleep(20 * time.Millisecond)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := service.Stop(ctx); err != nil {
		t.Fatal(err)
	}
	stopped, ok := service.runs.Get(run.RunID)
	if !ok || !stopped.State.Terminal() {
		t.Fatalf("run not terminal after stop: %+v", stopped)
	}
}
