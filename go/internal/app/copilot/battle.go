package copilot

import (
	"context"
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

const defaultBattleProgressInterval = 5 * time.Second

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
