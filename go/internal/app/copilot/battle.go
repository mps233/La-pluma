package copilot

import (
	"context"
	"os"
	"strconv"
	"strings"
	"time"
)

// BattleProgress is the current battle kill counter. MaaCore already OCRs the
// counter and writes `Kills: X / Y` to its trace log, so the Go backend reads
// that line instead of running a second OCR engine.
type BattleProgress struct {
	Kills int `json:"kills"`
	Total int `json:"total"`
}

// BattleProgressSampler reads the MAA battle counter and the current copilot
// stage from the asst.log tail. Checkpoint records the log position at task
// start; the read and sample methods inspect only lines at or after it.
type BattleProgressSampler interface {
	Checkpoint(ctx context.Context) string
	ReadLogSince(ctx context.Context, checkpoint string) string
	SampleBattleProgress(ctx context.Context, checkpoint string, expectedTotal *int) (*BattleProgress, error)
}

const (
	defaultBattleProgressInterval = 5 * time.Second
	minBattleProgressInterval     = 2 * time.Second
	maxBattleProgressInterval     = 60 * time.Second
)

// BattleProgressEnabled follows the Node environment contract. The value is
// kept even though the Go backend parses MAA's log instead of running OCR.
func BattleProgressEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("LA_PLUMA_BATTLE_OCR")))
	return value != "0" && value != "false" && value != "off"
}

// BattleProgressInterval returns the sampling interval, clamped like the Node
// service so a bad environment value cannot poll the log every few milliseconds.
func BattleProgressInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv("LA_PLUMA_BATTLE_OCR_INTERVAL_MS"))
	if raw == "" {
		return defaultBattleProgressInterval
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return defaultBattleProgressInterval
	}
	interval := time.Duration(value) * time.Millisecond
	if interval < minBattleProgressInterval {
		return minBattleProgressInterval
	}
	if interval > maxBattleProgressInterval {
		return maxBattleProgressInterval
	}
	return interval
}

// SampleBattleProgress returns nil when no sampler is wired, matching the Node
// behavior of silently skipping battle progress when it is disabled.
func (s *Service) SampleBattleProgress(ctx context.Context, checkpoint string, expectedTotal *int) *BattleProgress {
	if s == nil || s.battleSampler == nil {
		return nil
	}
	progress, err := s.battleSampler.SampleBattleProgress(ctx, checkpoint, expectedTotal)
	if err != nil {
		return nil
	}
	return progress
}
