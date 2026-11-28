package agentrun

import (
	"context"
	"errors"

	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// ErrActionStopped reports that an action ended because a stop was requested.
// Execute settles such a run as stopped instead of failed.
var ErrActionStopped = errors.New("agent action stopped")

// Request describes a run to begin or replay.
type Request struct {
	OperationID    string
	IdempotencyKey *string
	Input          any
	Metadata       any
	Trigger        any
	Progress       any
	TaskResults    []any
}

// Scope is the single writer for one run's lifecycle. Transport decodes and
// validates its input, then delegates here so accepted, failed, stopped, and
// manual continuation semantics have one owner.
type Scope struct {
	service *Service
	initial agentrun.DTO
}

// Open begins a run. replayed reports that an identical idempotent request
// already owns the run, in which case the action must not run again.
func (s *Service) Open(request Request) (*Scope, bool, error) {
	dto, replayed, err := s.begin(request)
	if err != nil {
		return nil, false, err
	}
	return &Scope{service: s, initial: dto}, replayed, nil
}

// Scope returns the scope for an existing run. It is false after the run has
// been pruned from the store.
func (s *Service) Scope(runID string) (*Scope, bool) {
	dto, ok := s.Get(runID)
	if !ok {
		return nil, false
	}
	return &Scope{service: s, initial: dto}, true
}

// RunID is the run this scope owns.
func (sc *Scope) RunID() string { return sc.initial.RunID }

// Run returns the latest snapshot of the run.
func (sc *Scope) Run() (agentrun.DTO, bool) {
	if run, ok := sc.service.Get(sc.RunID()); ok {
		return run, true
	}
	if sc.initial.RunID != "" {
		return sc.initial, true
	}
	return agentrun.DTO{}, false
}

// Progress records partial progress and completed task results.
func (sc *Scope) Progress(progress any, taskResults []any) (agentrun.DTO, error) {
	return sc.service.updateProgress(sc.RunID(), progress, taskResults)
}

// Start moves the run to running. A run that cannot start is failed so it
// cannot stay active forever; the transition error is still returned.
func (sc *Scope) Start() (agentrun.DTO, error) {
	run, err := sc.service.startForExecution(sc.RunID())
	if err == nil {
		return run, nil
	}
	if current, ok := sc.service.Get(sc.RunID()); ok && (current.State.Terminal() || current.State == agentrun.StatusStopping) {
		return current, err
	}
	failed, _ := sc.service.fail(sc.RunID(), err)
	if failed.RunID == "" {
		if current, ok := sc.service.Get(sc.RunID()); ok {
			return current, err
		}
	}
	return failed, err
}

// Execute starts the run, invokes action with a context that carries the run
// id, and settles the run as succeeded, failed, or stopped. The returned run is
// the settled snapshot.
func (sc *Scope) Execute(ctx context.Context, action func(context.Context) (any, error)) (agentrun.DTO, error) {
	run, err := sc.Start()
	if err != nil {
		return run, err
	}
	actionCtx := withScope(WithParentRun(ctx, sc.RunID()), sc)
	result, actionErr := action(actionCtx)

	current, ok := sc.service.Get(sc.RunID())
	if !ok {
		current = run
	}
	if current.State.Terminal() {
		if current.State == agentrun.StatusStopped {
			return current, nil
		}
		return current, failureError(current)
	}
	if actionErr != nil {
		if isActionStopError(actionErr) || current.State == agentrun.StatusStopping {
			stopped, stopErr := sc.service.stop(sc.RunID(), map[string]any{"message": actionErr.Error()})
			if stopErr != nil {
				return agentrun.DTO{}, stopErr
			}
			return stopped, nil
		}
		failed, failErr := sc.service.fail(sc.RunID(), actionErr)
		if failErr != nil {
			return agentrun.DTO{}, failErr
		}
		return failed, actionErr
	}
	if current.State == agentrun.StatusStopping {
		stopped, stopErr := sc.service.stop(sc.RunID(), result)
		if stopErr != nil {
			return agentrun.DTO{}, stopErr
		}
		return stopped, nil
	}
	completed, err := sc.service.complete(sc.RunID(), result)
	if err != nil {
		return agentrun.DTO{}, err
	}
	return completed, nil
}

// Outcome is the transport-neutral result of one manual step: it either
// finished, stopped, or waits for the next continuation.
type Outcome struct {
	Result   any
	Stopped  bool
	Finished bool
}

// Settle applies a manual step outcome. A nil Result completes the run; a
// stopped step stops it, a finished step completes it, and any other result
// moves the run to waiting and stores the result for the next continuation.
func (sc *Scope) Settle(outcome Outcome, actionErr error) error {
	if current, ok := sc.service.Get(sc.RunID()); ok && current.State.Terminal() {
		if current.State == agentrun.StatusStopped {
			return nil
		}
		return failureError(current)
	}
	if actionErr != nil {
		if isActionStopError(actionErr) {
			_, stopErr := sc.service.stop(sc.RunID(), map[string]any{"message": actionErr.Error()})
			return stopErr
		}
		if _, failErr := sc.service.fail(sc.RunID(), actionErr); failErr != nil {
			return failErr
		}
		return actionErr
	}
	if outcome.Result == nil {
		_, err := sc.service.complete(sc.RunID(), nil)
		return err
	}
	if outcome.Stopped {
		_, err := sc.service.stop(sc.RunID(), outcome.Result)
		return err
	}
	if outcome.Finished {
		_, err := sc.service.complete(sc.RunID(), outcome.Result)
		return err
	}
	if _, err := sc.service.markWaiting(sc.RunID()); err != nil {
		return err
	}
	_, err := sc.service.setAcceptedResult(sc.RunID(), outcome.Result)
	return err
}

// StopRequest describes how to stop a run. CancelResult is stored when the run
// has not started yet; StopResult is stored for an active run. StopProcess
// interrupts external work after the run is marked stopping. Its error is
// logged and the run still settles as stopped unless AbortOnProcessError is
// set, in which case the caller decides what a failed interruption means.
// Force sends accepted runs through the stopping escalation instead of
// canceling them immediately, which the global stop path needs so a
// just-accepted run cannot race past the process stop.
type StopRequest struct {
	CancelResult        any
	StopResult          any
	StopProcess         func(context.Context) error
	AbortOnProcessError bool
	Force               bool
}

// StopOutcome reports which stop path a run took.
type StopOutcome struct {
	Run             agentrun.DTO
	AlreadyTerminal bool
	Canceled        bool
	NotStoppable    bool
}

// Stop cancels an accepted run or stops an active one. An accepted run is
// canceled without calling StopProcess and releases its idempotency key so the
// request can be retried; a forced stop escalates it through the process stop
// instead and keeps the key.
func (sc *Scope) Stop(ctx context.Context, request StopRequest) (StopOutcome, error) {
	run, ok := sc.service.Get(sc.RunID())
	if !ok {
		return StopOutcome{}, notFoundError(sc.RunID())
	}
	if run.State.Terminal() {
		return StopOutcome{Run: run, AlreadyTerminal: true}, nil
	}
	if run.State == agentrun.StatusAccepted && !request.Force {
		stopped, err := sc.service.stop(sc.RunID(), request.CancelResult)
		if err != nil {
			return StopOutcome{}, err
		}
		if _, err := sc.service.releaseIdempotency(sc.RunID()); err != nil {
			return StopOutcome{Run: stopped}, err
		}
		return StopOutcome{Run: stopped, Canceled: true}, nil
	}
	stopping, err := sc.service.markStopping(sc.RunID())
	if err != nil {
		current, _ := sc.service.Get(sc.RunID())
		return StopOutcome{Run: current, NotStoppable: true}, nil
	}
	if request.StopProcess != nil {
		if err := request.StopProcess(ctx); err != nil {
			if request.AbortOnProcessError {
				return StopOutcome{Run: stopping}, err
			}
			sc.service.logger.Warn("agent run stop callback failed", "runId", sc.RunID(), "error", err)
		}
	}
	stopped, err := sc.service.stop(sc.RunID(), request.StopResult)
	if err != nil {
		return StopOutcome{}, err
	}
	return StopOutcome{Run: stopped}, nil
}

// Interrupt marks the run interrupted for a deliberate shutdown. The startup
// resumer may continue a supported flow; a user stop goes through Stop instead.
func (sc *Scope) Interrupt(reason string) (agentrun.DTO, error) {
	return sc.service.interrupt(sc.RunID(), reason)
}

// isActionStopError reports whether an action ended because a stop was
// requested rather than because it failed.
func isActionStopError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrActionStopped) || errors.Is(err, context.Canceled) {
		return true
	}
	if appErr, ok := apperrors.As(err); ok {
		if appErr.Code == "COPILOT_PLAN_STOPPED" {
			return true
		}
		if stopped, _ := appErr.Details["stopped"].(bool); stopped {
			return true
		}
	}
	return false
}

func failureError(run agentrun.DTO) error {
	if run.Error != nil {
		return apperrors.WithStatus(run.Error.Code, run.Error.Message, run.Error.StatusCode, run.Error.Retryable, run.Error.Details)
	}
	return apperrors.New("AGENT_RUN_FAILED", "Agent run 执行失败")
}
