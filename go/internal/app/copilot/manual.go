package copilot

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// Manual session states. The Node service projects these from AgentRun.
const (
	ManualStateRunning   = "running"
	ManualStateWaiting   = "waiting"
	ManualStateSucceeded = "succeeded"
	ManualStateStopped   = "stopped"
)

// ManualSession is the stable session projection returned to API callers.
type ManualSession struct {
	RunID               string         `json:"runId"`
	SetID               string         `json:"setId"`
	Name                string         `json:"name"`
	Raid                string         `json:"raid"`
	SelectedItemIndexes []int          `json:"selectedItemIndexes"`
	Options             map[string]any `json:"options"`
}

// ManualStepResult is the result of starting, continuing or stopping a
// manual copilot set.
type ManualStepResult struct {
	RunID          string `json:"runId"`
	State          string `json:"state"`
	SetID          string `json:"setId"`
	Name           string `json:"name"`
	WaitingForNext bool   `json:"waitingForNext"`
	Finished       bool   `json:"finished"`
	Stopped        bool   `json:"stopped"`
	NextItemIndex  *int   `json:"nextItemIndex"`
	TaskResults    []any  `json:"taskResults"`
	Message        string `json:"message"`
}

// ManualStepRequest is passed to the injected executor. Wiring it to the MAA
// dynamic Copilot task belongs to a later integration; this package does not
// import the MAA service.
type ManualStepRequest struct {
	RunID           string
	SetID           string
	Raid            string
	SelectedIndexes []int
	Options         map[string]any
	Plan            *Plan
	ItemIndex       int
}

// StepExecutor runs one plan item. When nil, manual sessions are unsupported.
type StepExecutor func(ctx context.Context, request ManualStepRequest) ([]any, error)

// ManualOptions configures clocks and run ids.
type ManualOptions struct {
	Now      func() time.Time
	NewRunID func() string
}

type manualSessionState struct {
	session     ManualSession
	state       string
	taskResults []any
}

// ManualManager is a small state machine over cached plans. It does not own an
// AgentRun store; callers either pass a RunID or use the generated id.
type ManualManager struct {
	build   PlanBuilder
	execute StepExecutor
	now     func() time.Time
	newRun  func() string

	mu       sync.Mutex
	sessions map[string]*manualSessionState
}

// NewManualManager creates a session manager. A nil executor leaves manual
// sessions deliberately unsupported.
func NewManualManager(build PlanBuilder, execute StepExecutor) *ManualManager {
	return NewManualManagerWithOptions(build, execute, ManualOptions{})
}

func NewManualManagerWithOptions(build PlanBuilder, execute StepExecutor, options ManualOptions) *ManualManager {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	newRun := options.NewRunID
	if newRun == nil {
		newRun = func() string { return defaultManualRunID(now()) }
	}
	return &ManualManager{
		build:    build,
		execute:  execute,
		now:      now,
		newRun:   newRun,
		sessions: map[string]*manualSessionState{},
	}
}

// ManualStartRequest starts the first pending item.
type ManualStartRequest struct {
	SetID           string
	Raid            string
	SelectedIndexes []any
	Options         map[string]any
	RunID           string
}

// StartManualSet executes the first pending item and waits before the next.
func (m *ManualManager) StartManualSet(ctx context.Context, request ManualStartRequest) (*ManualStepResult, error) {
	if m.execute == nil {
		return nil, manualUnsupportedError()
	}
	raid := request.Raid
	if raid == "" {
		raid = "normal"
	}
	plan, err := m.build(ctx, request.SetID, raid)
	if err != nil {
		return nil, err
	}
	selected := normalizeSelectedIndexes(request.SelectedIndexes)
	pending := pendingItemIndexes(plan, selected)
	if len(pending) == 0 {
		return &ManualStepResult{
			RunID:       "",
			State:       ManualStateSucceeded,
			SetID:       request.SetID,
			Name:        plan.Name,
			Finished:    true,
			TaskResults: []any{},
			Message:     "作业集没有待执行条目",
		}, nil
	}

	runID := request.RunID
	if runID == "" {
		runID = m.newRun()
	}
	session := &manualSessionState{
		session: ManualSession{
			RunID:               runID,
			SetID:               request.SetID,
			Name:                plan.Name,
			Raid:                raid,
			SelectedItemIndexes: selected,
			Options:             copyAnyMap(request.Options),
		},
		state:       ManualStateRunning,
		taskResults: []any{},
	}
	m.mu.Lock()
	if _, exists := m.sessions[runID]; exists {
		m.mu.Unlock()
		return nil, apperrors.WithStatus("COPILOT_MANUAL_RUN_CONFLICT", "手动作业集 Run 已存在", http.StatusConflict, false, map[string]any{"runId": runID})
	}
	m.sessions[runID] = session
	m.mu.Unlock()

	if err := m.executeStep(ctx, runID, plan, pending[0], session); err != nil {
		m.deleteSession(runID)
		return nil, err
	}
	return m.advance(ctx, runID)
}

// ContinueManualSet runs the next pending item of a waiting session.
func (m *ManualManager) ContinueManualSet(ctx context.Context, runID string, options map[string]any) (*ManualStepResult, error) {
	if m.execute == nil {
		return nil, manualUnsupportedError()
	}
	m.mu.Lock()
	session := m.sessions[runID]
	if session == nil {
		m.mu.Unlock()
		return nil, manualSessionNotFoundError()
	}
	if session.state != ManualStateWaiting && session.state != ManualStateRunning {
		state := session.state
		delete(m.sessions, runID)
		m.mu.Unlock()
		return nil, apperrors.WithStatus(
			"COPILOT_MANUAL_RUN_NOT_CONTINUABLE",
			fmt.Sprintf("手动作业集 Run 当前状态为 %s，不能继续", state),
			http.StatusConflict,
			false,
			map[string]any{"runId": runID, "state": state},
		)
	}
	if len(options) > 0 {
		merged := copyAnyMap(session.session.Options)
		for key, value := range options {
			merged[key] = value
		}
		session.session.Options = merged
	}
	session.state = ManualStateRunning
	selected := append([]int{}, session.session.SelectedItemIndexes...)
	setID := session.session.SetID
	raid := session.session.Raid
	m.mu.Unlock()

	plan, err := m.build(ctx, setID, raid)
	if err != nil {
		m.deleteSession(runID)
		return nil, err
	}
	pending := pendingItemIndexes(plan, selected)
	if len(pending) == 0 {
		return m.finish(runID)
	}
	if err := m.executeStep(ctx, runID, plan, pending[0], session); err != nil {
		m.deleteSession(runID)
		return nil, err
	}
	return m.advance(ctx, runID)
}

// StopManualSetRun removes the session and returns a stopped projection.
func (m *ManualManager) StopManualSetRun(runID string) (*ManualStepResult, bool) {
	m.mu.Lock()
	session := m.sessions[runID]
	if session == nil {
		m.mu.Unlock()
		return nil, false
	}
	delete(m.sessions, runID)
	result := m.makeResult(session, false, false, true, nil, "手动作业集已停止")
	result.State = ManualStateStopped
	m.mu.Unlock()
	return result, true
}

// ManualSession returns a defensive copy of the live session.
func (m *ManualManager) ManualSession(runID string) (*ManualSession, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session := m.sessions[runID]
	if session == nil {
		return nil, false
	}
	copySession := session.session
	copySession.SelectedItemIndexes = append([]int{}, session.session.SelectedItemIndexes...)
	copySession.Options = copyAnyMap(session.session.Options)
	return &copySession, true
}

func (m *ManualManager) executeStep(ctx context.Context, runID string, plan *Plan, itemIndex int, session *manualSessionState) error {
	m.mu.Lock()
	options := copyAnyMap(session.session.Options)
	setID := session.session.SetID
	raid := session.session.Raid
	m.mu.Unlock()
	results, err := m.execute(ctx, ManualStepRequest{
		RunID:           runID,
		SetID:           setID,
		Raid:            raid,
		SelectedIndexes: []int{itemIndex},
		Options:         options,
		Plan:            plan,
		ItemIndex:       itemIndex,
	})
	if err != nil {
		return err
	}
	if len(results) > 0 {
		m.mu.Lock()
		if live := m.sessions[runID]; live != nil {
			live.taskResults = append(live.taskResults, results...)
		}
		m.mu.Unlock()
	}
	return nil
}

// advance refreshes completion flags and either waits for the next item or
// finishes the session.
func (m *ManualManager) advance(ctx context.Context, runID string) (*ManualStepResult, error) {
	m.mu.Lock()
	session := m.sessions[runID]
	if session == nil {
		m.mu.Unlock()
		return nil, manualSessionNotFoundError()
	}
	selected := append([]int{}, session.session.SelectedItemIndexes...)
	setID := session.session.SetID
	raid := session.session.Raid
	m.mu.Unlock()

	plan, err := m.build(ctx, setID, raid)
	if err != nil {
		m.deleteSession(runID)
		return nil, err
	}
	pending := pendingItemIndexes(plan, selected)
	if len(pending) == 0 {
		return m.finish(runID)
	}
	next := pending[0]

	m.mu.Lock()
	live := m.sessions[runID]
	if live == nil {
		m.mu.Unlock()
		return nil, manualSessionNotFoundError()
	}
	live.state = ManualStateWaiting
	nextCopy := next
	result := m.makeResult(live, true, false, false, &nextCopy, "等待开始下一关")
	m.mu.Unlock()
	return result, nil
}

func (m *ManualManager) finish(runID string) (*ManualStepResult, error) {
	m.mu.Lock()
	session := m.sessions[runID]
	if session == nil {
		m.mu.Unlock()
		return nil, manualSessionNotFoundError()
	}
	delete(m.sessions, runID)
	result := m.makeResult(session, false, true, false, nil, "手动作业集执行完成")
	result.State = ManualStateSucceeded
	m.mu.Unlock()
	return result, nil
}

// makeResult expects m.mu to be held when the session is live.
func (m *ManualManager) makeResult(
	session *manualSessionState,
	waiting bool,
	finished bool,
	stopped bool,
	next *int,
	message string,
) *ManualStepResult {
	taskResults := make([]any, len(session.taskResults))
	copy(taskResults, session.taskResults)
	return &ManualStepResult{
		RunID:          session.session.RunID,
		State:          session.state,
		SetID:          session.session.SetID,
		Name:           session.session.Name,
		WaitingForNext: waiting,
		Finished:       finished,
		Stopped:        stopped,
		NextItemIndex:  next,
		TaskResults:    taskResults,
		Message:        message,
	}
}

func (m *ManualManager) deleteSession(runID string) {
	m.mu.Lock()
	delete(m.sessions, runID)
	m.mu.Unlock()
}

func normalizeSelectedIndexes(value []any) []int {
	seen := map[int]struct{}{}
	result := make([]int, 0, len(value))
	for _, raw := range value {
		index, ok := integerValue(raw)
		if !ok {
			continue
		}
		if _, exists := seen[index]; exists {
			continue
		}
		seen[index] = struct{}{}
		result = append(result, index)
	}
	return result
}

func pendingItemIndexes(plan *Plan, selectedIndexes []int) []int {
	selected := map[int]struct{}{}
	for _, index := range selectedIndexes {
		selected[index] = struct{}{}
	}
	pending := map[int]struct{}{}
	for _, entry := range plan.Entries {
		if entry.Completed != nil && *entry.Completed {
			continue
		}
		if len(selected) > 0 {
			if _, ok := selected[entry.ItemIndex]; !ok {
				continue
			}
		}
		pending[entry.ItemIndex] = struct{}{}
	}
	result := make([]int, 0, len(pending))
	for index := range pending {
		result = append(result, index)
	}
	sort.Ints(result)
	return result
}

func copyAnyMap(source map[string]any) map[string]any {
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func manualUnsupportedError() *apperrors.Error {
	// TODO(go-port): wire the MAA dynamic Copilot executor and AgentRun
	// lifecycle. The plan/cache/discovery core is ported; execution needs the
	// shared MAA execution lease owned by internal/app/maa.
	return apperrors.WithStatus(
		"COPILOT_MANUAL_UNSUPPORTED",
		"手动作业集执行尚未接入 Go 服务",
		http.StatusNotImplemented,
		false,
		map[string]any{"todo": "wire MAA dynamic copilot task executor"},
	)
}

func manualSessionNotFoundError() *apperrors.Error {
	return apperrors.WithStatus("COPILOT_MANUAL_SESSION_NOT_FOUND", "手动作业集会话不存在或已结束", http.StatusNotFound, false, map[string]any{})
}

func defaultManualRunID(now time.Time) string {
	buffer := make([]byte, 8)
	_, _ = rand.Read(buffer)
	return fmt.Sprintf("copilot-manual-%d-%s", now.UnixMilli(), hex.EncodeToString(buffer))
}
