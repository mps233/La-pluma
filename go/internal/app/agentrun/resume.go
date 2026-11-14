package agentrun

import (
	"encoding/json"
	"sort"

	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
)

// ResumeCandidate is the durable part of a Run that the startup resumer needs:
// the normalized operation input, the last progress checkpoint, and the
// completed task results. The public DTO deliberately omits Input.
type ResumeCandidate struct {
	RunID       string
	OperationID string
	Input       any
	Metadata    any
	Trigger     any
	Progress    any
	TaskResults []any
	Error       *domainrun.Failure
	Sequence    int64
	CreatedAt   string
}

// ResumeCandidates returns interrupted runs created by a server restart that
// have not been offered to the resumer yet. The caller owns the returned maps.
func (s *Service) ResumeCandidates() []ResumeCandidate {
	s.mu.Lock()
	defer s.mu.Unlock()

	candidates := make([]ResumeCandidate, 0)
	for _, record := range s.runs {
		run := record.Run
		if run.Status != domainrun.StatusInterrupted || run.Error == nil {
			continue
		}
		if run.Error.Code != "AGENT_RUN_INTERRUPTED" {
			continue
		}
		if reason, _ := run.Error.Details["reason"].(string); reason != "server_restart" {
			continue
		}
		if _, resumed := run.Error.Details["resumedBy"]; resumed {
			continue
		}
		if _, skipped := run.Error.Details["resumeSkipped"]; skipped {
			continue
		}
		candidates = append(candidates, ResumeCandidate{
			RunID:       run.RunID,
			OperationID: run.OperationID,
			Input:       cloneJSON(run.Input),
			Metadata:    cloneJSON(run.Metadata),
			Trigger:     cloneJSON(run.Trigger),
			Progress:    cloneJSON(run.Progress),
			TaskResults: cloneTaskResults(run.TaskResults),
			Error:       run.Error,
			Sequence:    record.Sequence,
			CreatedAt:   run.CreatedAt,
		})
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Sequence < candidates[j].Sequence
	})
	return candidates
}

// MarkResumed records that a new Run continues runID. The old Run remains an
// interrupted history entry and is never offered to the resumer again.
func (s *Service) MarkResumed(runID, resumedBy string) error {
	return s.markResumeDetail(runID, "resumedBy", resumedBy)
}

// MarkResumeSkipped records why the resumer deliberately did not continue a
// candidate, so the next startup does not retry it.
func (s *Service) MarkResumeSkipped(runID, reason string) error {
	return s.markResumeDetail(runID, "resumeSkipped", reason)
}

func (s *Service) markResumeDetail(runID, key, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.runs[runID]
	if !ok || record.Run.Status != domainrun.StatusInterrupted {
		return nil
	}
	if record.Run.Error == nil {
		return nil
	}
	if record.Run.Error.Details == nil {
		record.Run.Error.Details = map[string]any{}
	}
	record.Run.Error.Details[key] = value
	record.Run.UpdatedAt = formatTime(s.now())
	return s.persistLocked()
}

func cloneJSON(value any) any {
	if value == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var out any
	if err := json.Unmarshal(data, &out); err != nil {
		return value
	}
	return out
}

func cloneTaskResults(results []any) []any {
	if results == nil {
		return nil
	}
	out := make([]any, len(results))
	for index, result := range results {
		out[index] = cloneJSON(result)
	}
	return out
}
