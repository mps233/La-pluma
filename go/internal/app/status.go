package app

import (
	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
)

// TaskStatus is the subset of the Node task status the first HTTP slice needs.
// More fields are added as the MAA orchestration is ported.
type TaskStatus struct {
	IsRunning     bool   `json:"isRunning"`
	TaskName      string `json:"taskName,omitempty"`
	TaskType      string `json:"taskType,omitempty"`
	StopRequested bool   `json:"stopRequested"`
	PID           int    `json:"pid,omitempty"`
	StartedAt     string `json:"startedAt,omitempty"`
}

func (a *App) TaskStatus() TaskStatus {
	status := TaskStatus{}
	if task, ok := a.MAA.Current(); ok && task.Running() {
		status.IsRunning = true
		status.TaskName = task.Name()
		status.PID = task.PID()
	}
	return status
}

func (a *App) CurrentRun() (agentrun.DTO, bool) {
	return a.Runs.Current()
}

func (a *App) LatestTerminalRun() (agentrun.DTO, bool) {
	list := a.Runs.List()
	for index := len(list) - 1; index >= 0; index-- {
		if list[index].State.Terminal() {
			return list[index], true
		}
	}
	return agentrun.DTO{}, false
}

func (a *App) LeaseSnapshot() map[string]any {
	snapshot := a.Execution.Status()
	return map[string]any{
		"state":    snapshot.State,
		"lockPath": snapshot.LockPath,
		"owner":    snapshot.Owner,
	}
}
