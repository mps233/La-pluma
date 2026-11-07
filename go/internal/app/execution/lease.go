package execution

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const leaseVersion = 1

type Owner struct {
	Version   int     `json:"version"`
	Token     string  `json:"token"`
	PID       int     `json:"pid"`
	Host      string  `json:"host"`
	Source    string  `json:"source"`
	TaskName  *string `json:"taskName"`
	Command   *string `json:"command"`
	RunID     *string `json:"runId"`
	StartedAt string  `json:"startedAt"`
}

type Request struct {
	Source   string
	TaskName *string
	Command  *string
	RunID    *string
}

type Lease struct {
	Owner    Owner
	lockPath string
	manager  *Manager
	released bool
	mu       sync.Mutex
}

type Snapshot struct {
	State    string `json:"state"`
	LockPath string `json:"lockPath"`
	Owner    *Owner `json:"owner"`
}

type Manager struct {
	mu              sync.Mutex
	lockPath        string
	host            string
	logger          *slog.Logger
	admissionClosed bool
	admissionReason string
	active          *Lease
	now             func() time.Time
}

func NewManager(lockPath, host string, logger *slog.Logger) *Manager {
	if host == "" {
		host = "unknown-host"
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Manager{
		lockPath: lockPath,
		host:     host,
		logger:   logger,
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// Acquire takes the single MAA execution lease. The returned lease must be
// passed explicitly to the MAA runner; do not use ambient context for it.
func (m *Manager) Acquire(ctx context.Context, request Request) (*Lease, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.admissionClosed {
		return nil, apperrors.WithStatus("MAA_EXECUTION_SHUTTING_DOWN", "服务正在关闭，不再接受新的 MAA 执行", 503, true, map[string]any{"reason": m.admissionReason})
	}
	if m.active != nil && !m.active.released {
		return nil, busyError(&m.active.Owner)
	}

	if err := jsonstore.EnsureDir(filepath.Dir(m.lockPath)); err != nil {
		return nil, apperrors.WithStatus("MAA_EXECUTION_LOCK_FAILED", "无法创建 MAA 执行锁目录", 500, true, map[string]any{"error": err.Error()})
	}

	token, err := newToken()
	if err != nil {
		return nil, apperrors.WithStatus("MAA_EXECUTION_LOCK_FAILED", "无法创建 MAA 执行锁", 500, true, nil)
	}
	owner := Owner{
		Version:   leaseVersion,
		Token:     token,
		PID:       os.Getpid(),
		Host:      m.host,
		Source:    defaultString(request.Source, "maa-command"),
		TaskName:  request.TaskName,
		Command:   request.Command,
		RunID:     request.RunID,
		StartedAt: m.now().UTC().Format(time.RFC3339Nano),
	}

	for attempt := 0; attempt < 3; attempt++ {
		current, state := m.readLocked()
		switch state {
		case lockMissing:
			if err := m.publishLocked(owner); err != nil {
				if isExist(err) {
					continue
				}
				return nil, apperrors.WithStatus("MAA_EXECUTION_LOCK_FAILED", "无法发布 MAA 执行锁", 500, true, map[string]any{"error": err.Error()})
			}
			lease := &Lease{Owner: owner, lockPath: m.lockPath, manager: m}
			m.active = lease
			return lease, nil
		case lockInvalid, lockUnreadable:
			return nil, busyError(nil)
		case lockPresent:
			if current.Host != m.host || processAlive(current.PID) {
				return nil, busyError(current)
			}
			if err := m.removeIfMatchesLocked(*current); err != nil {
				m.logger.Warn("remove stale MAA lease", "error", err)
			}
		}
	}
	return nil, busyError(nil)
}

func (l *Lease) Release() error {
	if l == nil || l.manager == nil {
		return nil
	}
	l.mu.Lock()
	if l.released {
		l.mu.Unlock()
		return nil
	}
	l.released = true
	l.mu.Unlock()
	return l.manager.release(l)
}

func (m *Manager) release(lease *Lease) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active == lease {
		m.active = nil
	}
	current, state := m.readLocked()
	if state == lockPresent && current.Token == lease.Owner.Token {
		if err := os.Remove(m.lockPath); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func (m *Manager) CloseAdmission(reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.admissionClosed = true
	m.admissionReason = reason
}

func (m *Manager) AdmissionClosed() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.admissionClosed
}

func (m *Manager) Status() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	owner, state := m.readLocked()
	snapshot := Snapshot{LockPath: m.lockPath}
	switch state {
	case lockMissing:
		snapshot.State = "free"
	case lockInvalid, lockUnreadable:
		snapshot.State = "unknown"
	case lockPresent:
		if owner.Host != m.host || processAlive(owner.PID) {
			snapshot.State = "held"
		} else {
			snapshot.State = "stale"
		}
		snapshot.Owner = owner
	}
	return snapshot
}

func (m *Manager) WithLease(ctx context.Context, request Request, fn func(*Lease) error) error {
	lease, err := m.Acquire(ctx, request)
	if err != nil {
		return err
	}
	defer lease.Release()
	return fn(lease)
}

type lockState int

const (
	lockMissing lockState = iota
	lockPresent
	lockInvalid
	lockUnreadable
)

func (m *Manager) readLocked() (*Owner, lockState) {
	data, err := os.ReadFile(m.lockPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, lockMissing
		}
		return nil, lockUnreadable
	}
	var owner Owner
	if err := json.Unmarshal(data, &owner); err != nil || owner.PID <= 0 {
		return nil, lockInvalid
	}
	if owner.Version != 0 && owner.Version != leaseVersion {
		return nil, lockInvalid
	}
	if owner.Version == leaseVersion && (owner.Token == "" || owner.Host == "" || owner.StartedAt == "") {
		return nil, lockInvalid
	}
	return &owner, lockPresent
}

func (m *Manager) publishLocked(owner Owner) error {
	data, err := json.Marshal(owner)
	if err != nil {
		return err
	}
	dir := filepath.Dir(m.lockPath)
	temp, err := os.CreateTemp(dir, ".maa-lease-*.tmp")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Link(tempName, m.lockPath)
}

func (m *Manager) removeIfMatchesLocked(owner Owner) error {
	current, state := m.readLocked()
	if state != lockPresent || current.Token != owner.Token {
		return nil
	}
	return os.Remove(m.lockPath)
}

func busyError(owner *Owner) *apperrors.Error {
	message := "MAA 正在被其他任务使用"
	details := map[string]any{"owner": nil}
	if owner != nil {
		if owner.TaskName != nil && *owner.TaskName != "" {
			message = "MAA 正在执行：" + *owner.TaskName
		}
		details["owner"] = owner
	}
	return apperrors.WithStatus("MAA_EXECUTION_BUSY", message, 409, true, details)
}

func isExist(err error) bool {
	return err != nil && os.IsExist(err)
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
