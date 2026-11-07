package execution

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

func leaseLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newManager(t *testing.T) (*Manager, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "maa-execution.lock")
	return NewManager(path, "test-host", leaseLogger()), path
}

func errorCode(err error) string {
	if appErr, ok := apperrors.As(err); ok {
		return appErr.Code
	}
	return ""
}

func TestAcquireBusyRelease(t *testing.T) {
	manager, path := newManager(t)
	first, err := manager.Acquire(context.Background(), Request{Source: "test", TaskName: stringPtr("daily")})
	if err != nil {
		t.Fatal(err)
	}
	if first.Owner.PID != os.Getpid() || first.Owner.Host != "test-host" {
		t.Fatalf("unexpected owner: %+v", first.Owner)
	}
	if manager.Status().State != "held" {
		t.Fatalf("unexpected status: %+v", manager.Status())
	}

	if _, err := manager.Acquire(context.Background(), Request{Source: "test"}); err == nil || errorCode(err) != "MAA_EXECUTION_BUSY" {
		t.Fatalf("expected busy, got %v", err)
	}

	if err := first.Release(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("lock should be removed, stat err = %v", err)
	}
	if manager.Status().State != "free" {
		t.Fatalf("unexpected status after release: %+v", manager.Status())
	}

	second, err := manager.Acquire(context.Background(), Request{Source: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if err := second.Release(); err != nil {
		t.Fatal(err)
	}
}

func TestStaleAndForeignOwner(t *testing.T) {
	manager, path := newManager(t)
	writeOwner(t, path, Owner{Version: leaseVersion, Token: "stale", PID: 999999, Host: "test-host", StartedAt: time.Now().UTC().Format(time.RFC3339Nano)})
	if manager.Status().State != "stale" {
		t.Fatalf("expected stale status: %+v", manager.Status())
	}
	lease, err := manager.Acquire(context.Background(), Request{Source: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if err := lease.Release(); err != nil {
		t.Fatal(err)
	}

	foreign := Owner{Version: leaseVersion, Token: "foreign", PID: os.Getpid(), Host: "other-host", StartedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	writeOwner(t, path, foreign)
	if _, err := manager.Acquire(context.Background(), Request{Source: "test"}); err == nil || errorCode(err) != "MAA_EXECUTION_BUSY" {
		t.Fatalf("expected foreign owner to be busy, got %v", err)
	}
}

func TestAdmissionClosed(t *testing.T) {
	manager, _ := newManager(t)
	manager.CloseAdmission("server_shutdown")
	if _, err := manager.Acquire(context.Background(), Request{Source: "test"}); err == nil || errorCode(err) != "MAA_EXECUTION_SHUTTING_DOWN" {
		t.Fatalf("expected shutdown error, got %v", err)
	}
}

func TestWithLeaseReleasesOnError(t *testing.T) {
	manager, _ := newManager(t)
	err := manager.WithLease(context.Background(), Request{Source: "test"}, func(*Lease) error {
		if manager.Status().State != "held" {
			t.Fatalf("expected held status inside callback")
		}
		return context.Canceled
	})
	if err != context.Canceled {
		t.Fatalf("unexpected callback error: %v", err)
	}
	if manager.Status().State != "free" {
		t.Fatalf("lease not released: %+v", manager.Status())
	}
}

func stringPtr(value string) *string { return &value }

func writeOwner(t *testing.T, path string, owner Owner) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}
