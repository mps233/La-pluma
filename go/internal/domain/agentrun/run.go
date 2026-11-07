package agentrun

// Status is the tracked Run state machine. The string values are part of the
// public Agent API contract.
type Status string

const (
	StatusAccepted    Status = "accepted"
	StatusWaiting     Status = "waiting"
	StatusRunning     Status = "running"
	StatusStopping    Status = "stopping"
	StatusSucceeded   Status = "succeeded"
	StatusFailed      Status = "failed"
	StatusStopped     Status = "stopped"
	StatusInterrupted Status = "interrupted"
)

func (s Status) Terminal() bool {
	switch s {
	case StatusSucceeded, StatusFailed, StatusStopped, StatusInterrupted:
		return true
	}
	return false
}

func (s Status) Active() bool {
	switch s {
	case StatusAccepted, StatusWaiting, StatusRunning, StatusStopping:
		return true
	}
	return false
}

func (s Status) Valid() bool {
	return s.Active() || s.Terminal()
}

type Failure struct {
	Code       string         `json:"code"`
	Message    string         `json:"message"`
	StatusCode int            `json:"statusCode"`
	Details    map[string]any `json:"details"`
	Retryable  bool           `json:"retryable"`
}

type Run struct {
	RunID            string   `json:"runId"`
	OperationID      string   `json:"operationId"`
	IdempotencyKey   *string  `json:"idempotencyKey"`
	InputFingerprint string   `json:"inputFingerprint"`
	Input            any      `json:"input"`
	Metadata         any      `json:"metadata"`
	Trigger          any      `json:"trigger"`
	Progress         any      `json:"progress"`
	TaskResults      []any    `json:"taskResults"`
	Status           Status   `json:"status"`
	CreatedAt        string   `json:"createdAt"`
	UpdatedAt        string   `json:"updatedAt"`
	StartedAt        *string  `json:"startedAt"`
	FinishedAt       *string  `json:"finishedAt"`
	DurationMS       *int64   `json:"durationMs"`
	Result           any      `json:"result"`
	Error            *Failure `json:"error"`
}

type Record struct {
	Run              *Run   `json:"run"`
	Sequence         int64  `json:"sequence"`
	CreatedAtMS      int64  `json:"createdAtMs"`
	StartedAtMS      *int64 `json:"startedAtMs"`
	FinishedAtMS     *int64 `json:"finishedAtMs"`
	TerminalSequence *int64 `json:"terminalSequence"`
}

type Links struct {
	Self         string `json:"self"`
	Stop         string `json:"stop"`
	TargetedStop string `json:"targetedStop"`
}

type DTO struct {
	RunID       string   `json:"runId"`
	OperationID string   `json:"operationId"`
	State       Status   `json:"state"`
	AcceptedAt  string   `json:"acceptedAt"`
	StartedAt   *string  `json:"startedAt"`
	FinishedAt  *string  `json:"finishedAt"`
	DurationMS  *int64   `json:"durationMs,omitempty"`
	Trigger     any      `json:"trigger"`
	Progress    any      `json:"progress,omitempty"`
	TaskResults []any    `json:"taskResults"`
	Result      any      `json:"result"`
	Error       *Failure `json:"error,omitempty"`
	Links       Links    `json:"links"`
}

func (r *Run) ToDTO() DTO {
	if r == nil {
		return DTO{}
	}
	dto := DTO{
		RunID:       r.RunID,
		OperationID: r.OperationID,
		State:       r.Status,
		AcceptedAt:  r.CreatedAt,
		StartedAt:   r.StartedAt,
		FinishedAt:  r.FinishedAt,
		Trigger:     r.Trigger,
		TaskResults: r.TaskResults,
		Result:      r.Result,
		Links: Links{
			Self:         "/api/agent/runs/" + r.RunID,
			Stop:         "/api/agent/actions/stop",
			TargetedStop: "/api/agent/runs/" + r.RunID + "/stop",
		},
	}
	if r.DurationMS != nil {
		dto.DurationMS = r.DurationMS
	}
	if r.Progress != nil {
		dto.Progress = r.Progress
	}
	if r.Error != nil {
		dto.Error = r.Error
	}
	return dto
}
