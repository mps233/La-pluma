package app

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/mps233/la-pluma/go/internal/app/notifications"
	"github.com/mps233/la-pluma/go/internal/config"
)

func TestTelegramHandlerExecuteTaskCreatesRun(t *testing.T) {
	root := t.TempDir()
	script := filepath.Join(root, "maa")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAA_CLI_PATH", script)
	application, err := New(config.Config{Paths: config.Paths{
		DataDir:      filepath.Join(root, "data"),
		MaaConfigDir: filepath.Join(root, "maa-config"),
	}}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = application.Close(context.Background()) })

	if application.Bot == nil || application.Bot.Running() {
		t.Fatalf("disabled Telegram bot should not poll: %#v", application.Bot)
	}

	handler := telegramCommandHandler{app: application}
	err = handler.ExecuteTask(context.Background(), notifications.TaskRequest{
		Command: "fight", Args: []string{"1-7"}, TaskName: "刷关卡 1-7", TaskType: "combat",
	})
	if err != nil {
		t.Fatal(err)
	}
	if runs := application.Runs.List(); len(runs) != 1 {
		t.Fatalf("runs = %#v", runs)
	}
}

func TestTelegramHandlerStopWhenIdle(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MAA_CLI_PATH", filepath.Join(root, "missing-maa"))
	application, err := New(config.Config{Paths: config.Paths{
		DataDir:      filepath.Join(root, "data"),
		MaaConfigDir: filepath.Join(root, "maa-config"),
	}}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = application.Close(context.Background()) })

	handler := telegramCommandHandler{app: application}
	result := handler.StopTask(context.Background())
	if result.Success {
		t.Fatalf("idle stop = %+v", result)
	}
}
