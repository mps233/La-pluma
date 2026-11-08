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
		if strings.HasPrefix(strings.ToLower(trimmed), "maa-cli") {
			if match := regexp.MustCompile(`v?([0-9][0-9A-Za-z.+-]*)`).FindStringSubmatch(trimmed); match != nil {
				cli = match[1]
			}
		}
		if strings.HasPrefix(strings.ToLower(trimmed), "maacore") {
			if match := regexp.MustCompile(`v?([0-9][0-9A-Za-z.+-]*)`).FindStringSubmatch(trimmed); match != nil {
				core = match[1]
			}
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

type masteryExternalExecution struct {
	execution *execution.Manager
	runs      interface{ Current() (interface{}, bool) }
}

func (e masteryExternalExecution) ExternalExecutionActive(ctx context.Context) bool {
	if e.execution != nil {
		state := e.execution.Status().State
		if state == "held" || state == "stale" || state == "unknown" {
			return state == "held"
		}
	}
	return false
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

func newMasteryService(cfg config.Config, logger *slog.Logger, executor maaServiceAdapter, executionManager *execution.Manager, notificationService *notifications.Service) *mastery.Service {
	maaPath := os.Getenv("MAA_CLI_PATH")
	if strings.TrimSpace(maaPath) == "" {
		maaPath = "maa"
	}
	service := mastery.NewService(mastery.ServiceOptions{
		Paths:             cfg.Paths,
		Logger:            logger,
		Executor:          executor,
		Versions:          masteryVersionProvider{path: maaPath},
		Logs:              masteryLogReader{path: filepath.Join(cfg.Paths.MaaStateDir, "debug", "asst.log")},
		ExternalExecution: masteryExternalExecution{execution: executionManager},
		Notifier:          masteryNotifier{notifications: notificationService},
	})
	if err := service.RecoverOnStartup(); err != nil {
		logger.Warn("恢复专精队列状态失败", "error", err)
	}
	service.StartScheduler(context.Background())
	return service
}
