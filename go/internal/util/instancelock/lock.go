// Package instancelock enforces one writer per La Pluma data directory across
// processes. The Agent run store is still a single-process JSON store, so a
// second server/desktop instance pointed at the same data directory must fail
// closed instead of silently racing on writes.
package instancelock

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const (
	// Version is written into the lock file so older tools can detect an
	// incompatible payload.
	Version = 1

	// FileName is the conventional lock file inside a data directory.
	FileName = "la-pluma.instance.lock"
)

// Owner describes the process holding the data-directory lock. It is written
// for diagnostics only; the OS lock, not this payload, is authoritative.
type Owner struct {
	Version   int    `json:"version"`
	PID       int    `json:"pid"`
	Host      string `json:"host"`
	Role      string `json:"role,omitempty"`
	StartedAt string `json:"startedAt"`
}

// Lock is an exclusive, process-lifetime lock on a data directory. Release is
// safe to call once; callers should keep the lock until all stores are closed.
type Lock struct {
	mu    sync.Mutex
	file  *os.File
	path  string
	owner Owner
}

// Acquire takes the exclusive lock for path, creating parent directories when
// needed. A file left behind by a crashed process is not an obstacle: the OS
// releases the advisory lock when the owning process exits.
func Acquire(path string) (*Lock, error) {
	return AcquireAs(path, "")
}

// AcquireAs is Acquire with a role label ("desktop", "server", ...) recorded
// in the lock payload for diagnostics.
func AcquireAs(path, role string) (*Lock, error) {
	if path == "" {
		return nil, lockFailed("", "锁文件路径为空")
	}
	if err := jsonstore.EnsureDir(filepath.Dir(path)); err != nil {
		return nil, lockFailed(path, err.Error())
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, lockFailed(path, err.Error())
	}
	if err := lockFile(file); err != nil {
		// The file may hold the previous owner's metadata; read it before
		// closing so a busy error can explain who is using the directory.
		owner, ok := readOwner(path)
		_ = file.Close()
		if isBusy(err) {
			return nil, busyError(path, owner, ok)
		}
		return nil, lockFailed(path, err.Error())
	}

	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "unknown-host"
	}
	owner := Owner{
		Version:   Version,
		PID:       os.Getpid(),
		Host:      host,
		Role:      role,
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := writeOwner(file, owner); err != nil {
		_ = unlockFile(file)
		_ = file.Close()
		return nil, lockFailed(path, err.Error())
	}
	return &Lock{file: file, path: path, owner: owner}, nil
}

// Path returns the lock file path.
func (l *Lock) Path() string {
	if l == nil {
		return ""
	}
	return l.path
}

// Owner returns the metadata of the process that acquired this lock.
func (l *Lock) Owner() Owner {
	if l == nil {
		return Owner{}
	}
	return l.owner
}

// Release drops the OS lock. The lock file itself is intentionally kept: it is
// the rendezvous point, and removing it would race with another process that
// already opened the same inode.
func (l *Lock) Release() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file == nil {
		return nil
	}
	unlockErr := unlockFile(l.file)
	closeErr := l.file.Close()
	l.file = nil
	if unlockErr != nil {
		return unlockErr
	}
	return closeErr
}

func writeOwner(file *os.File, owner Owner) error {
	data, err := json.Marshal(owner)
	if err != nil {
		return err
	}
	if err := file.Truncate(0); err != nil {
		return err
	}
	if _, err := file.Seek(0, 0); err != nil {
		return err
	}
	if _, err := file.Write(data); err != nil {
		return err
	}
	return file.Sync()
}

func readOwner(path string) (Owner, bool) {
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return Owner{}, false
	}
	var owner Owner
	if err := json.Unmarshal(data, &owner); err != nil {
		return Owner{}, false
	}
	if owner.Version != Version || owner.PID <= 0 || owner.StartedAt == "" {
		return Owner{}, false
	}
	return owner, true
}

func busyError(path string, owner Owner, ok bool) *apperrors.Error {
	message := "数据目录正在被另一个 La Pluma 实例使用"
	details := map[string]any{"path": path, "owner": nil}
	if ok {
		message = fmt.Sprintf("数据目录正在被另一个 La Pluma 实例使用（PID %d）", owner.PID)
		details["owner"] = owner
	}
	return apperrors.WithStatus("LA_PLUMA_INSTANCE_LOCKED", message, 409, false, details)
}

func lockFailed(path, cause string) *apperrors.Error {
	return apperrors.WithStatus("LA_PLUMA_INSTANCE_LOCK_FAILED", "无法锁定 La Pluma 数据目录", 500, true, map[string]any{
		"path":  path,
		"error": cause,
	})
}
