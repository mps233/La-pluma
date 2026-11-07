package copilot

import "fmt"

// ProgressStatus is one per-entry execution status.
type ProgressStatus string

const (
	ProgressPending ProgressStatus = "pending"
	ProgressRunning ProgressStatus = "running"
	ProgressSuccess ProgressStatus = "success"
	ProgressFailed  ProgressStatus = "failed"
	ProgressStopped ProgressStatus = "stopped"
	ProgressSkipped ProgressStatus = "skipped"
)

// ProgressEntryResult is the per-entry snapshot exposed as taskResults.
type ProgressEntryResult struct {
	Key       string         `json:"key"`
	ItemIndex int            `json:"itemIndex"`
	CopilotID int            `json:"copilotId"`
	Stage     string         `json:"stage"`
	Mode      string         `json:"mode"`
	Status    ProgressStatus `json:"status"`
	Error     string         `json:"error,omitempty"`
}

// ProgressTracker projects a copilot set as it advances between entries.
type ProgressTracker struct {
	order   []string
	results map[string]*ProgressEntryResult
}

// NewProgressTracker creates a tracker in entry order.
func NewProgressTracker(entries []PlanEntry) *ProgressTracker {
	tracker := &ProgressTracker{results: map[string]*ProgressEntryResult{}}
	for _, entry := range entries {
		key := progressEntryKey(entry)
		if _, exists := tracker.results[key]; !exists {
			tracker.order = append(tracker.order, key)
		}
		tracker.results[key] = &ProgressEntryResult{
			Key:       key,
			ItemIndex: entry.ItemIndex,
			CopilotID: entry.CopilotID,
			Stage:     entry.DisplayStage,
			Mode:      entry.Mode,
			Status:    ProgressPending,
		}
	}
	return tracker
}

func progressEntryKey(entry PlanEntry) string {
	if entry.Key != "" {
		return entry.Key
	}
	return fmt.Sprintf("%d:%d:%s", entry.ItemIndex, entry.CopilotID, entry.Mode)
}

// Snapshot returns copies in the original entry order.
func (t *ProgressTracker) Snapshot() []ProgressEntryResult {
	if t == nil {
		return nil
	}
	result := make([]ProgressEntryResult, 0, len(t.order))
	for _, key := range t.order {
		item := t.results[key]
		if item == nil {
			continue
		}
		result = append(result, *item)
	}
	return result
}

// MarkRunning settles earlier pending/running entries as success, then marks
// the entry running. This mirrors markRunning in createCopilotSetProgressTracker.
func (t *ProgressTracker) MarkRunning(entry PlanEntry) {
	t.MarkRunningKey(progressEntryKey(entry))
}

func (t *ProgressTracker) MarkRunningKey(key string) {
	if t == nil {
		return
	}
	index := -1
	for position, orderedKey := range t.order {
		if orderedKey == key {
			index = position
			break
		}
	}
	if index > 0 {
		for position := 0; position < index; position++ {
			item := t.results[t.order[position]]
			if item != nil && (item.Status == ProgressPending || item.Status == ProgressRunning) {
				item.Status = ProgressSuccess
			}
		}
	}
	t.settle(key, ProgressRunning, "")
}

// MarkSettled records a terminal status for one entry.
func (t *ProgressTracker) MarkSettled(entry PlanEntry, status ProgressStatus, errorMessage string) {
	t.MarkSettledKey(progressEntryKey(entry), status, errorMessage)
}

func (t *ProgressTracker) MarkSettledKey(key string, status ProgressStatus, errorMessage string) {
	if t == nil {
		return
	}
	t.settle(key, status, errorMessage)
}

func (t *ProgressTracker) settle(key string, status ProgressStatus, errorMessage string) {
	item := t.results[key]
	if item == nil {
		return
	}
	item.Status = status
	if errorMessage != "" {
		item.Error = errorMessage
	} else {
		item.Error = ""
	}
}

// MarkGroupSuccess records success for a whole formation group.
func (t *ProgressTracker) MarkGroupSuccess(entries []PlanEntry) {
	if t == nil {
		return
	}
	for _, entry := range entries {
		t.settle(progressEntryKey(entry), ProgressSuccess, "")
	}
}

// SettleRunning terminates entries still marked running.
func (t *ProgressTracker) SettleRunning(status ProgressStatus, errorMessage string) {
	if t == nil {
		return
	}
	for _, key := range t.order {
		item := t.results[key]
		if item == nil || item.Status != ProgressRunning {
			continue
		}
		item.Status = status
		if errorMessage != "" {
			item.Error = errorMessage
		}
	}
}
