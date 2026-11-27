package app

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/mps233/la-pluma/go/internal/config"
)

func TestAppWiresEveryService(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MAA_CLI_PATH", filepath.Join(root, "missing-maa"))
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		LogBufferSize: 100,
		Paths: config.Paths{
			DataDir:      filepath.Join(root, "data"),
			MaaConfigDir: filepath.Join(root, "maa-config"),
		},
	}

	application, err := New(cfg, logger)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := application.Close(context.Background()); err != nil {
			t.Fatalf("close: %v", err)
		}
	})

	services := map[string]any{
		"Runs":          application.Runs,
		"Execution":     application.Execution,
		"ConfigStore":   application.ConfigStore,
		"Profiles":      application.Profiles,
		"MAA":           application.MAA,
		"MAAService":    application.MAAService,
		"Logs":          application.Logs,
		"Drops":         application.Drops,
		"Scheduler":     application.Scheduler,
		"Training":      application.Training,
		"Activity":      application.Activity,
		"Copilot":       application.Copilot,
		"Connection":    application.Connection,
		"Notifications": application.Notifications,
		"Quotes":        application.Quotes,
		"CustomTools":   application.CustomTools,
		"Recognition":   application.Recognition,
		"Updates":       application.Updates,
		"Mastery":       application.Mastery,
		"Skland":        application.Skland,
		"Assets":        application.Assets,
		"WebRTC":        application.WebRTC,
		"Bot":           application.Bot,
	}
	for name, service := range services {
		if service == nil {
			t.Errorf("%s is nil after New", name)
		}
	}
}
