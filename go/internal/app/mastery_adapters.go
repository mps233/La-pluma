package app

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/mps233/la-pluma/go/internal/app/execution"
	"github.com/mps233/la-pluma/go/internal/app/mastery"
	"github.com/mps233/la-pluma/go/internal/app/notifications"
	"github.com/mps233/la-pluma/go/internal/app/skland"
	"github.com/mps233/la-pluma/go/internal/config"
)

var masteryVersionPattern = regexp.MustCompile(`(?i)(?:maa-cli|MaaCore)\s+v?([0-9][0-9A-Za-z.+-]*)`)

type masteryVersionProvider struct{ path string }

func (v masteryVersionProvider) MAAVersion(ctx context.Context) (string, string, error) {
	path := strings.TrimSpace(v.path)
	if path == "" {
		path = "maa"
	}
	output, err := exec.CommandContext(ctx, path, "version").CombinedOutput()
	if err != nil {
		return "", "", fmt.Errorf("maa version: %w: %s", err, strings.TrimSpace(string(output)))
	}
	cli, core := "", ""
	for _, line := range strings.Split(string(output), "\n") {
		trimmed := strings.TrimSpace(line)
		lower := strings.ToLower(trimmed)
		if !strings.HasPrefix(lower, "maa-cli") && !strings.HasPrefix(lower, "maacore") {
			continue
		}
		match := masteryVersionPattern.FindStringSubmatch(trimmed)
		if match == nil {
			continue
		}
		if strings.HasPrefix(lower, "maa-cli") {
			cli = match[1]
		} else {
			core = match[1]
		}
	}
	if cli == "" || core == "" {
		return cli, core, fmt.Errorf("无法解析 MAA 版本: %s", strings.TrimSpace(string(output)))
	}
	return cli, core, nil
}

type masteryLogReader struct{ path string }

func (r masteryLogReader) CreateCheckpoint(ctx context.Context) (*mastery.LogCheckpoint, error) {
	info, err := os.Stat(r.path)
	if err != nil {
		if os.IsNotExist(err) {
			return &mastery.LogCheckpoint{Path: r.path, Size: 0}, nil
		}
		return nil, err
	}
	return &mastery.LogCheckpoint{Path: r.path, Size: info.Size()}, nil
}

func (r masteryLogReader) ReadSince(ctx context.Context, checkpoint *mastery.LogCheckpoint, maxBytes int64) (string, error) {
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	default:
	}
	if checkpoint == nil {
		return "", nil
	}
	file, err := os.Open(checkpoint.Path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	if _, err := file.Seek(checkpoint.Size, 0); err != nil {
		return "", err
	}
	if maxBytes <= 0 || maxBytes > 4*1024*1024 {
		maxBytes = 4 * 1024 * 1024
	}
	buffer := make([]byte, maxBytes)
	n, err := file.Read(buffer)
	if err != nil && n == 0 {
		return "", err
	}
	return string(buffer[:n]), nil
}

// masteryExternalExecution defers a tick while another MAA consumer holds the
// shared execution lease. The lease is the only cross-service signal today.
type masteryExternalExecution struct {
	execution *execution.Manager
}

func (e masteryExternalExecution) ExternalExecutionActive(ctx context.Context) bool {
	if e.execution == nil {
		return false
	}
	return e.execution.Status().State == "held"
}

type masteryNotifier struct{ notifications *notifications.Service }

func (n masteryNotifier) Notify(ctx context.Context, title, content, level string) error {
	if n.notifications == nil {
		return nil
	}
	result := n.notifications.Send(ctx, notifications.Message{Title: title, Content: content, Level: level})
	if !result.Success {
		return fmt.Errorf("%s", result.Message)
	}
	return nil
}

type masteryTrainingProbe struct{ service *skland.Service }

func (p masteryTrainingProbe) TrainingState(ctx context.Context) (mastery.TrainingState, bool) {
	if p.service == nil {
		return mastery.TrainingState{}, false
	}
	state, ok, err := p.service.Training(ctx)
	if err != nil || !ok {
		return mastery.TrainingState{}, false
	}
	return mastery.TrainingState{
		TraineeID:   state.TraineeID,
		TraineeName: state.TraineeName,
		RemainSecs:  state.RemainSecs,
		SlotState:   state.SlotState,
	}, true
}

func newMasteryService(cfg config.Config, logger *slog.Logger, executor maaServiceAdapter, executionManager *execution.Manager, notificationService *notifications.Service, training mastery.TrainingProbe) *mastery.Service {
	maaPath := cfg.MAAExecutable()
	service := mastery.NewService(mastery.ServiceOptions{
		Paths:             cfg.Paths,
		Logger:            logger,
		Executor:          executor,
		Versions:          masteryVersionProvider{path: maaPath},
		Logs:              masteryLogReader{path: filepath.Join(cfg.Paths.MaaStateDir, "debug", "asst.log")},
		ExternalExecution: masteryExternalExecution{execution: executionManager},
		Notifier:          masteryNotifier{notifications: notificationService},
		Training:          training,
		TickInterval:      cfg.Tuning.MasteryTick,
	})
	if err := service.RecoverOnStartup(); err != nil {
		logger.Warn("恢复专精队列状态失败", "error", err)
	}
	service.StartScheduler(context.Background())
	return service
}
