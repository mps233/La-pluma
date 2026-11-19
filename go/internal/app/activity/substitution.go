package activity

import (
	"context"
	"fmt"
	"sort"
)

// ActivitySubstitution reports one stage whose set copilot was replaced by a
// box-compatible PRTS candidate.
type ActivitySubstitution struct {
	ItemIndex         int      `json:"itemIndex"`
	Stage             string   `json:"stage"`
	Mode              string   `json:"mode"`
	OriginalCopilotID int      `json:"originalCopilotId"`
	CopilotID         int      `json:"copilotId"`
	Title             string   `json:"title,omitempty"`
	MissingOperators  []string `json:"missingOperators,omitempty"`
}

// ActivitySkippedStage reports a stage that had no compatible copilot. The
// stage stays pending so it can be retried after fixing the box.
type ActivitySkippedStage struct {
	ItemIndex        int      `json:"itemIndex"`
	Stage            string   `json:"stage"`
	Mode             string   `json:"mode"`
	CopilotID        int      `json:"copilotId"`
	Reason           string   `json:"reason"`
	MissingOperators []string `json:"missingOperators,omitempty"`
}

// resolveSetSubstitutions checks every selected entry against the saved
// OperBox. Incompatible entries are replaced by the best compatible candidate
// for the same stage; entries without a candidate are dropped so the remaining
// stages still run.
func (s *Service) resolveSetSubstitutions(
	ctx context.Context,
	plan Plan,
	selected []PlanEntry,
	selection SelectionContext,
) (Plan, []ActivitySubstitution, []ActivitySkippedStage) {
	operators := selection.UsableOperators
	if len(operators) == 0 {
		operators = selection.OwnedOperators
	}
	if len(selected) == 0 || len(operators) == 0 {
		return plan, nil, nil
	}
	replacements := map[string]ActivitySubstitution{}
	skipped := map[string]ActivitySkippedStage{}
	for _, entry := range selected {
		key := entryKey(entry)
		contentItem, err := s.prts.GetCopilot(ctx, entry.CopilotID)
		if err != nil {
			// Keep the original entry; the executor reports its own error.
			continue
		}
		missing := FindMissingOperators(parseContent(contentItem), operators)
		if missing.Count == 0 {
			continue
		}
		allowed := CanRunWithOperators(&missing, selection.Preferences.Map())
		candidateSelection := selection
		candidateSelection.OwnedOperators = operators
		candidate := s.findStageSubstitute(ctx, entry, candidateSelection)
		if s.logger != nil {
			candidateID := 0
			candidateMissing := -1
			candidateTitle := ""
			if candidate != nil {
				candidateID = candidate.ID
				candidateMissing = candidate.MissingOperatorCount
				candidateTitle = candidate.Title
			}
			s.logger.Debug("activity substitution probe",
				"stage", entry.DisplayStage,
				"stageId", entry.StageID,
				"copilotId", entry.CopilotID,
				"mode", entry.Mode,
				"usable", len(operators),
				"missing", missing.Count,
				"allowed", allowed,
				"candidateId", candidateID,
				"candidateMissing", candidateMissing,
				"candidateTitle", candidateTitle,
			)
		}
		// Prefer a zero-missing candidate over an original that would need a
		// support unit; MAA's formation can still fail on operators the saved
		// box reports as owned but the game does not offer.
		if candidate != nil && candidate.MissingOperatorCount == 0 {
			replacements[key] = ActivitySubstitution{
				ItemIndex:         entry.ItemIndex,
				Stage:             entry.DisplayStage,
				Mode:              entry.Mode,
				OriginalCopilotID: entry.CopilotID,
				CopilotID:         candidate.ID,
				Title:             candidate.Title,
				MissingOperators:  missing.Names,
			}
			continue
		}
		if allowed {
			continue
		}
		if candidate == nil {
			skipped[key] = ActivitySkippedStage{
				ItemIndex:        entry.ItemIndex,
				Stage:            entry.DisplayStage,
				Mode:             entry.Mode,
				CopilotID:        entry.CopilotID,
				Reason:           "没有找到适合当前干员 Box 的作业",
				MissingOperators: missing.Names,
			}
			continue
		}
		replacements[key] = ActivitySubstitution{
			ItemIndex:         entry.ItemIndex,
			Stage:             entry.DisplayStage,
			Mode:              entry.Mode,
			OriginalCopilotID: entry.CopilotID,
			CopilotID:         candidate.ID,
			Title:             candidate.Title,
			MissingOperators:  missing.Names,
		}
	}
	if len(replacements) == 0 && len(skipped) == 0 {
		return plan, nil, nil
	}

	modified := plan
	modified.Entries = make([]PlanEntry, 0, len(plan.Entries))
	for _, entry := range plan.Entries {
		key := entryKey(entry)
		if _, drop := skipped[key]; drop {
			continue
		}
		if replacement, exists := replacements[key]; exists {
			entry.OriginalCopilotID = entry.CopilotID
			entry.CopilotID = replacement.CopilotID
			// Keep the original key so set progress remains stable.
		}
		modified.Entries = append(modified.Entries, entry)
	}

	substitutions := make([]ActivitySubstitution, 0, len(replacements))
	for _, replacement := range replacements {
		substitutions = append(substitutions, replacement)
	}
	skips := make([]ActivitySkippedStage, 0, len(skipped))
	for _, skip := range skipped {
		skips = append(skips, skip)
	}
	return modified, substitutions, skips
}

func (s *Service) findStageSubstitute(
	ctx context.Context,
	entry PlanEntry,
	selection SelectionContext,
) *CopilotCandidate {
	candidates := s.stageSubstituteCandidates(ctx, entry, selection)
	if len(candidates) == 0 {
		return nil
	}
	return &candidates[0]
}

// stageSubstituteCandidates returns every compatible candidate for the stage,
// ordered by missing operators then rating. The retry loop consumes the next
// item when a substituted copilot still fails formation.
func (s *Service) stageSubstituteCandidates(
	ctx context.Context,
	entry PlanEntry,
	selection SelectionContext,
) []CopilotCandidate {
	// Always use the display stage plus an optional internal id. The generic
	// discovery path is limited to the first hot page and omits many special
	// stage candidates; substitution needs the wider merged pool.
	result, err := s.queryStageCandidatesByID(ctx, entry.StageID, entry.DisplayStage, &selection)
	if err != nil || result == nil {
		return nil
	}
	candidates := make([]CopilotCandidate, 0, len(result.Candidates))
	for _, candidate := range result.Candidates {
		if !candidate.Allowed || candidate.ID == entry.CopilotID {
			continue
		}
		if entry.Mode == "raid" && candidate.PresetFormation {
			continue
		}
		if entry.StageID != "" && candidate.StageName != "" && candidate.StageName != entry.StageID {
			continue
		}
		candidates = append(candidates, candidate)
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].MissingOperatorCount != candidates[j].MissingOperatorCount {
			return candidates[i].MissingOperatorCount < candidates[j].MissingOperatorCount
		}
		return candidates[i].RatingLevel > candidates[j].RatingLevel
	})
	return candidates
}

// nextStageCandidate returns the first candidate not already tried for this
// stage. Both the current copilot and the original set copilot are excluded by
// the caller's tried set.
func (s *Service) nextStageCandidate(
	ctx context.Context,
	entry PlanEntry,
	tried map[int]struct{},
	selection SelectionContext,
) *CopilotCandidate {
	for _, candidate := range s.stageSubstituteCandidates(ctx, entry, selection) {
		if _, exists := tried[candidate.ID]; exists {
			continue
		}
		if candidate.ID == entry.CopilotID {
			continue
		}
		copyValue := candidate
		return &copyValue
	}
	return nil
}

func entryKey(entry PlanEntry) string {
	if entry.Key != "" {
		return entry.Key
	}
	return fmt.Sprintf("%d:%d:%s", entry.ItemIndex, entry.CopilotID, entry.Mode)
}

// appendSkippedPending keeps skipped stages in the pending list so the UI
// leaves them selected for a later retry instead of treating them as done.
func appendSkippedPending(result *ExecutionResult, plan Plan, skipped []ActivitySkippedStage) {
	if result == nil || len(skipped) == 0 {
		return
	}
	if result.Data == nil {
		result.Data = map[string]any{}
	}
	pending, _ := result.Data["pending"].([]any)
	for _, entry := range plan.Entries {
		for _, skip := range skipped {
			if entry.ItemIndex != skip.ItemIndex || entry.CopilotID != skip.CopilotID || entry.Mode != skip.Mode {
				continue
			}
			pending = append(pending, map[string]any{
				"key":          entry.Key,
				"itemIndex":    entry.ItemIndex,
				"copilotId":    entry.CopilotID,
				"stageId":      entry.StageID,
				"displayStage": entry.DisplayStage,
				"mode":         entry.Mode,
			})
			break
		}
	}
	result.Data["pending"] = pending
}
