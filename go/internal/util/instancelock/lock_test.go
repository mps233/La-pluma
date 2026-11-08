package instancelock

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const (
	helperEnv     = "LA_PLUMA_INSTANCE_LOCK_HELPER"
	helperPathEnv = "LA_PLUMA_INSTANCE_LOCK_HELPER_PATH"
	helperModeEnv = "LA_PLUMA_INSTANCE_LOCK_HELPER_MODE"
)

func errorCode(err error) string {
	if appErr, ok := apperrors.As(err); ok {
		return appErr.Code
	}
	return ""
}

func lockPath(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "nested", FileName)
}

func TestAcquireReleaseAndOwner(t *testing.T) {
	path := lockPath(t)
	lock, err := AcquireAs(path, "test")
	if err != nil {
		t.Fatal(err)
	}
	if lock.Path() != path {
		t.Fatalf("path = %q", lock.Path())
	}
	owner := lock.Owner()
	if owner.PID != os.Getpid() || owner.Role != "test" || owner.Version != Version || owner.StartedAt == "" {
		t.Fatalf("unexpected owner: %+v", owner)
	}
	if owner.Host == "" {
		t.Fatal("expected host")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var onDisk Owner
	if err := json.Unmarshal(data, &onDisk); err != nil {
		t.Fatalf("lock payload: %v", err)
	}
	if onDisk.PID != os.Getpid() {
		t.Fatalf("on-disk owner = %+v", onDisk)
	}
	if err := lock.Release(); err != nil {
		t.Fatal(err)
	}
	if err := lock.Release(); err != nil {
		t.Fatalf("second release: %v", err)
	}

	again, err := Acquire(path)
	if err != nil {
		t.Fatalf("reacquire: %v", err)
	}
	if err := again.Release(); err != nil {
		t.Fatal(err)
	}
}

func TestSecondAcquireInSameProcessFails(t *testing.T) {
	path := lockPath(t)
	first, err := Acquire(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()

	_, err = Acquire(path)
	if err == nil || errorCode(err) != "LA_PLUMA_INSTANCE_LOCKED" {
		t.Fatalf("expected LA_PLUMA_INSTANCE_LOCKED, got %v", err)
	}
	appErr, _ := apperrors.As(err)
	owner, _ := appErr.Details["owner"].(Owner)
	if owner.PID != os.Getpid() {
		t.Fatalf("busy owner = %+v", appErr.Details["owner"])
	}
}

func TestCrossProcessLockAndRelease(t *testing.T) {
	path := lockPath(t)
	child, stdout := startHelper(t, path, "hold")
	waitReady(t, stdout)

	if _, err := Acquire(path); err == nil || errorCode(err) != "LA_PLUMA_INSTANCE_LOCKED" {
		_ = child.Process.Kill()
		t.Fatalf("expected busy while helper holds the lock, got %v", err)
	}

	if _, err := fmt.Fprintln(child.stdin, "exit"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = child.stdin.Close() })
	if err := child.Wait(); err != nil {
		t.Fatalf("helper exit: %v", err)
	}

	lock, err := Acquire(path)
	if err != nil {
		t.Fatalf("acquire after helper release: %v", err)
	}
	if err := lock.Release(); err != nil {
		t.Fatal(err)
	}
}

func TestCrashedProcessLockIsReusable(t *testing.T) {
	path := lockPath(t)
	child, stdout := startHelper(t, path, "abandon")
	waitReady(t, stdout)
	if err := child.Wait(); err != nil {
		t.Fatalf("helper exit: %v", err)
	}

	lock, err := Acquire(path)
	if err != nil {
		t.Fatalf("acquire after abandoned lock: %v", err)
	}
	if err := lock.Release(); err != nil {
		t.Fatal(err)
	}
}

// TestInstanceLockHelperProcess is not a real test: it is the child process
// used by the cross-process tests above.
func TestInstanceLockHelperProcess(t *testing.T) {
	if os.Getenv(helperEnv) != "1" {
		t.Skip("helper process only")
	}
	path := os.Getenv(helperPathEnv)
	mode := os.Getenv(helperModeEnv)
	lock, err := Acquire(path)
	if err != nil {
		fmt.Printf("error %v\n", err)
		os.Exit(1)
	}
	fmt.Println("ready")
	if mode == "abandon" {
		// Deliberately skip Release to simulate a crash.
		os.Exit(0)
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Scan()
	if err := lock.Release(); err != nil {
		fmt.Printf("release error %v\n", err)
		os.Exit(1)
	}
	os.Exit(0)
}

type helperProcess struct {
	*exec.Cmd
	stdin io.WriteCloser
}

func startHelper(t *testing.T, path, mode string) (*helperProcess, *bufio.Reader) {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestInstanceLockHelperProcess$")
	cmd.Env = append(os.Environ(),
		helperEnv+"=1",
		helperPathEnv+"="+path,
		helperModeEnv+"="+mode,
	)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	child := &helperProcess{Cmd: cmd, stdin: stdin}
	t.Cleanup(func() {
		_ = stdin.Close()
		if child.Process != nil {
			_ = child.Process.Kill()
		}
	})
	return child, bufio.NewReader(stdout)
}

func waitReady(t *testing.T, stdout *bufio.Reader) {
	t.Helper()
	lineCh := make(chan string, 1)
	errCh := make(chan error, 1)
	go func() {
		line, err := stdout.ReadString('\n')
		if err != nil {
			errCh <- err
			return
		}
		lineCh <- line
	}()
	select {
	case line := <-lineCh:
		if strings.TrimSpace(line) != "ready" {
			t.Fatalf("helper output = %q", line)
		}
	case err := <-errCh:
		t.Fatalf("helper did not become ready: %v", err)
	case <-time.After(10 * time.Second):
		t.Fatal("timeout waiting for helper")
	}
}
