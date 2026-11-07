package copilot

import "context"

// BattleProgress is the current battle kill counter read from OCR.
type BattleProgress struct {
	Kills int `json:"kills"`
	Total int `json:"total"`
}

// BattleProgressSampler is the OCR hook used by copilot execution progress.
// It is intentionally declared here instead of importing app/training or the
// MAA log service: callers wire an implementation (screen OCR + log parsing)
// when it becomes available. A nil sampler means battle OCR is disabled.
type BattleProgressSampler interface {
	SampleBattleProgress(ctx context.Context, expectedTotal *int) (*BattleProgress, error)
}

// SampleBattleProgress returns nil when no sampler is wired, matching the
// Node behavior of silently skipping OCR when battle OCR is disabled.
func (s *Service) SampleBattleProgress(ctx context.Context, expectedTotal *int) *BattleProgress {
	if s == nil || s.battleSampler == nil {
		return nil
	}
	progress, err := s.battleSampler.SampleBattleProgress(ctx, expectedTotal)
	if err != nil {
		return nil
	}
	return progress
}
