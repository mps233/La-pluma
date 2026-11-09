package main

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mps233/la-pluma/go/internal/app"
	"github.com/mps233/la-pluma/go/internal/app/mastery"
	"github.com/mps233/la-pluma/go/internal/config"
)

func TestRotatingFileWriterKeepsLogBounded(t *testing.T) {
	path := filepath.Join(t.TempDir(), "la-pluma.log")
	writer, err := newRotatingFileWriter(path, 8, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()

	if _, err := writer.Write([]byte("first-run\n")); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte("second-run\n")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".1"); err != nil {
		t.Fatalf("expected rotated file: %v", err)
	}
	current, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(current) != "second-run\n" {
		t.Fatalf("current log = %q", current)
	}
}

func TestStopAllTasksIsSafeWhenIdle(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MAA_CLI_PATH", filepath.Join(root, "missing-maa"))
	cfg := config.Config{Paths: config.Paths{
		DataDir:      filepath.Join(root, "data"),
		MaaConfigDir: filepath.Join(root, "maa-config"),
	}}
	application, err := app.New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = application.Close(context.Background()) })

	runtime := &desktopRuntime{app: application}
	runtime.stopAllTasks(context.Background())

	if status := application.Scheduler.ExecutionStatus(); status.IsRunning {
		t.Fatalf("scheduler still running: %+v", status)
	}
	status, err := application.Mastery.Status()
	if err != nil {
		t.Fatal(err)
	}
	if status.Campaign.Status == mastery.CampaignRunning {
		t.Fatalf("mastery campaign still running: %+v", status)
	}
}

func TestNormalizeDesktopAccessToken(t *testing.T) {
	cases := []struct {
		input   string
		want    string
		wantErr bool
	}{
		{"  abcdefgh12345678  ", "abcdefgh12345678", false},
		{"123456", "123456", false},
		{"Bearer abcdefgh12345678", "abcdefgh12345678", false},
		{"short", "", true},
		{"has space token", "", true},
		{"中文令牌abcdefgh", "", true},
		{strings.Repeat("a", 129), "", true},
	}
	for _, testCase := range cases {
		got, err := normalizeDesktopAccessToken(testCase.input)
		if testCase.wantErr {
			if err == nil {
				t.Fatalf("input %q: expected error", testCase.input)
			}
			continue
		}
		if err != nil || got != testCase.want {
			t.Fatalf("input %q: got %q, err %v", testCase.input, got, err)
		}
	}
}
