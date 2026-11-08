package app

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

func TestAppRefusesSecondInstanceOnSameDataDir(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MAA_CLI_PATH", filepath.Join(root, "missing-maa"))
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{Paths: config.Paths{
		DataDir:      filepath.Join(root, "data"),
		MaaConfigDir: filepath.Join(root, "maa-config"),
	}}

	first, err := New(cfg, logger)
	if err != nil {
		t.Fatal(err)
	}

	_, err = New(cfg, logger)
	if err == nil {
		_ = first.Close(context.Background())
		t.Fatal("expected the second instance to be rejected")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != "LA_PLUMA_INSTANCE_LOCKED" {
		_ = first.Close(context.Background())
		t.Fatalf("unexpected error: %v", err)
	}

	if err := first.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	second, err := New(cfg, logger)
	if err != nil {
		t.Fatalf("acquire after close: %v", err)
	}
	if err := second.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}
