package agentrun

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const (
	storeVersion         = 1
	defaultRetention     = 24 * time.Hour
	defaultMaxTerminal   = 500
	idempotencyKeyRegexp = `^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$`
)

var idempotencyKeyPattern = regexp.MustCompile(idempotencyKeyRegexp)

type idempotencyEntry struct {
	RunID            string
	InputFingerprint string
}

type Service struct {
	mu sync.Mutex

	runs        map[string]*agentrun.Record
	idempotency map[string]idempotencyEntry
	sequence    int64
	terminalSeq int64

	filePath    string
	enabled     bool
	required    bool
	persistErr  error
	logger      *slog.Logger
	now         func() time.Time
	retention   time.Duration
	maxTerminal int
}

type BeginInput struct {
	OperationID    string
	IdempotencyKey *string
	Input          any
	Metadata       any
	Trigger        any
	Progress       any
	TaskResults    []any
}

type Summary struct {
	FilePath        string
	RestoredRuns    int
	InterruptedRuns int
	PrunedRuns      int
}

type storeSnapshot struct {
	Version int                `json:"version"`
	SavedAt string             `json:"savedAt"`
	Runs    []*agentrun.Record `json:"runs"`
}

func New(filePath string, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		runs:        make(map[string]*agentrun.Record),
		idempotency: make(map[string]idempotencyEntry),
		filePath:    filePath,
		required:    true,
		logger:      logger,
		now:         func() time.Time { return time.Now().UTC() },
		retention:   defaultRetention,
		maxTerminal: defaultMaxTerminal,
	}
}

// FilePath is the store path used by diagnostics and /health.
func (s *Service) FilePath() string { return s.filePath }

// Ready reports whether the store is usable. A failed initialization keeps it
// closed so execution cannot start without durable idempotency records.
func (s *Service) Ready() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.enabled
}

func (s *Service) Initialize() (Summary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.enabled = false
	s.persistErr = nil

	raw, err := jsonstore.Read(s.filePath, map[string]any{"version": storeVersion, "runs": []any{}})
	if err != nil {
		s.persistErr = err
		return Summary{FilePath: s.filePath}, apperrors.WithStatus("AGENT_RUN_PERSISTENCE_FAILED", "Agent run 存储读取失败", 503, true, map[string]any{"filePath": s.filePath})
	}
	snapshot, err := decodeSnapshot(raw)
	if err != nil {
		s.persistErr = err
		return Summary{FilePath: s.filePath}, err
	}
	records, sequence, terminalSeq, interrupted, err := validateSnapshot(snapshot, s.now())
	if err != nil {
		s.persistErr = err
		return Summary{FilePath: s.filePath}, err
	}

	s.runs = make(map[string]*agentrun.Record, len(records))
	s.idempotency = make(map[string]idempotencyEntry)
	for _, record := range records {
		s.runs[record.Run.RunID] = record
		if record.Run.IdempotencyKey != nil {
			s.idempotency[idempotencyKey(record.Run.OperationID, *record.Run.IdempotencyKey)] = idempotencyEntry{
				RunID:            record.Run.RunID,
				InputFingerprint: record.Run.InputFingerprint,
			}
		}
	}
	s.sequence = sequence
	s.terminalSeq = terminalSeq
	pruned := s.pruneLocked(s.now())
	s.enabled = true
	if err := s.persistLocked(); err != nil {
		s.enabled = false
		return Summary{FilePath: s.filePath}, err
	}
	s.logger.Info("agent run store restored", "file", s.filePath, "runs", len(s.runs), "interrupted", interrupted, "pruned", pruned)
	return Summary{FilePath: s.filePath, RestoredRuns: len(s.runs), InterruptedRuns: interrupted, PrunedRuns: pruned}, nil
}

func decodeSnapshot(raw any) (*storeSnapshot, error) {
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, storeError("Agent run 存储格式无效", map[string]any{"reason": err.Error()})
	}
	var snapshot storeSnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return nil, storeError("Agent run 存储格式无效", map[string]any{"reason": err.Error()})
	}
	return &snapshot, nil
}

func validateSnapshot(snapshot *storeSnapshot, now time.Time) ([]*agentrun.Record, int64, int64, int, error) {
	if snapshot == nil || snapshot.Version != storeVersion || snapshot.Runs == nil {
		actual := any(nil)
		if snapshot != nil {
			actual = snapshot.Version
		}
		return nil, 0, 0, 0, storeError("Agent run 存储版本或顶层格式无效", map[string]any{"expectedVersion": storeVersion, "actualVersion": actual})
	}
	seenRuns := map[string]bool{}
	seenSequences := map[int64]bool{}
	seenTerminal := map[int64]bool{}
	seenIdempotency := map[string]bool{}
	var sequence, terminalSeq int64
	var interrupted int

	for index, record := range snapshot.Runs {
		if record == nil || record.Run == nil {
			return nil, 0, 0, 0, storeError("Agent run 存储记录格式无效", map[string]any{"index": index})
		}
		run := record.Run
		if run.RunID == "" || run.OperationID == "" || !run.Status.Valid() {
			return nil, 0, 0, 0, storeError("Agent run 存储记录缺少有效的身份或状态字段", map[string]any{"index": index, "runId": run.RunID})
		}
		if seenRuns[run.RunID] {
			return nil, 0, 0, 0, storeError("Agent run 存储包含重复 runId", map[string]any{"runId": run.RunID})
		}
		seenRuns[run.RunID] = true
		if record.Sequence <= 0 || seenSequences[record.Sequence] {
			return nil, 0, 0, 0, storeError("Agent run 存储中的 sequence 无效", map[string]any{"index": index})
		}
		seenSequences[record.Sequence] = true
		if record.Sequence > sequence {
			sequence = record.Sequence
		}
		if run.IdempotencyKey != nil && !idempotencyKeyPattern.MatchString(*run.IdempotencyKey) {
			return nil, 0, 0, 0, storeError("Agent run 存储中的幂等键无效", map[string]any{"index": index})
		}
		if run.IdempotencyKey != nil && run.InputFingerprint == "" {
			return nil, 0, 0, 0, storeError("Agent run 存储缺少请求指纹", map[string]any{"index": index})
		}
		if run.IdempotencyKey != nil {
			key := idempotencyKey(run.OperationID, *run.IdempotencyKey)
			if seenIdempotency[key] {
				return nil, 0, 0, 0, storeError("Agent run 存储包含重复幂等键", map[string]any{"index": index})
			}
			seenIdempotency[key] = true
		}
		if _, err := parseTime(run.CreatedAt); err != nil {
			return nil, 0, 0, 0, storeError("Agent run 存储中的 createdAt 无效", map[string]any{"index": index})
		}
		if _, err := parseTime(run.UpdatedAt); err != nil {
			return nil, 0, 0, 0, storeError("Agent run 存储中的 updatedAt 无效", map[string]any{"index": index})
		}
		if run.StartedAt != nil {
			if _, err := parseTime(*run.StartedAt); err != nil {
				return nil, 0, 0, 0, storeError("Agent run 存储中的 startedAt 无效", map[string]any{"index": index})
			}
		}
		if record.TerminalSequence != nil {
			if *record.TerminalSequence <= 0 || seenTerminal[*record.TerminalSequence] {
				return nil, 0, 0, 0, storeError("Agent run 存储包含无效的 terminalSequence", map[string]any{"index": index})
			}
			seenTerminal[*record.TerminalSequence] = true
			if *record.TerminalSequence > terminalSeq {
				terminalSeq = *record.TerminalSequence
			}
		}

		if record.CreatedAtMS <= 0 {
			parsed, err := parseTime(run.CreatedAt)
			if err != nil {
				return nil, 0, 0, 0, storeError("Agent run 存储中的 createdAt 无效", map[string]any{"index": index})
			}
			record.CreatedAtMS = parsed.UnixMilli()
		}
		if record.StartedAtMS == nil && run.StartedAt != nil {
			parsed, err := parseTime(*run.StartedAt)
			if err != nil {
				return nil, 0, 0, 0, storeError("Agent run 存储中的 startedAt 无效", map[string]any{"index": index})
			}
			ms := parsed.UnixMilli()
			record.StartedAtMS = &ms
		}

		if run.Status.Terminal() {
			if run.FinishedAt == nil {
				return nil, 0, 0, 0, storeError("Agent run 终态记录缺少 finishedAt", map[string]any{"index": index})
			}
			if _, err := parseTime(*run.FinishedAt); err != nil {
				return nil, 0, 0, 0, storeError("Agent run 终态记录的 finishedAt 无效", map[string]any{"index": index})
			}
			if record.FinishedAtMS == nil {
				parsed, err := parseTime(*run.FinishedAt)
				if err != nil {
					return nil, 0, 0, 0, storeError("Agent run 终态记录的 finishedAt 无效", map[string]any{"index": index})
				}
				ms := parsed.UnixMilli()
				record.FinishedAtMS = &ms
			}
			if *record.FinishedAtMS < 0 {
				return nil, 0, 0, 0, storeError("Agent run 终态记录缺少 finishedAtMs", map[string]any{"index": index})
			}
			if record.TerminalSequence == nil {
				return nil, 0, 0, 0, storeError("Agent run 终态记录缺少 terminalSequence", map[string]any{"index": index})
			}
			if (run.Status == agentrun.StatusFailed || run.Status == agentrun.StatusInterrupted) && run.Error == nil {
				return nil, 0, 0, 0, storeError("Agent run 失败终态缺少错误信息", map[string]any{"index": index})
			}
			continue
		}

		if run.FinishedAt != nil {
			return nil, 0, 0, 0, storeError("Agent run 活跃记录不能包含 finishedAt", map[string]any{"index": index})
		}
		if record.TerminalSequence != nil {
			return nil, 0, 0, 0, storeError("Agent run 活跃记录不能包含 terminalSequence", map[string]any{"index": index})
		}

		// Active runs restored after a restart are never resumed silently.
		previous := run.Status
		nowString := formatTime(now)
		nowMS := now.UnixMilli()
		run.Status = agentrun.StatusInterrupted
		run.UpdatedAt = nowString
		run.FinishedAt = &nowString
		startMS := record.CreatedAtMS
		if record.StartedAtMS != nil {
			startMS = *record.StartedAtMS
		}
		duration := nowMS - startMS
		if duration < 0 {
			duration = 0
		}
		run.DurationMS = &duration
		run.Error = &agentrun.Failure{
			Code:       "AGENT_RUN_INTERRUPTED",
			Message:    "服务重启时该执行尚未结束，已标记为中断且不会自动续跑",
			StatusCode: 503,
			Details:    map[string]any{"reason": "server_restart", "previousState": string(previous)},
			Retryable:  false,
		}
		record.FinishedAtMS = &nowMS
		terminalSeq++
		seq := terminalSeq
		record.TerminalSequence = &seq
		interrupted++
	}
	return snapshot.Runs, sequence, terminalSeq, interrupted, nil
}

func (s *Service) Begin(input BeginInput) (agentrun.DTO, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.required && !s.enabled {
		return agentrun.DTO{}, false, agentRunPersistenceError(s.filePath, s.persistErr)
	}
	operationID, err := normalizeOperationID(input.OperationID)
	if err != nil {
		return agentrun.DTO{}, false, err
	}
	key, err := normalizeIdempotencyKey(input.IdempotencyKey)
	if err != nil {
		return agentrun.DTO{}, false, err
	}
	normalizedInput, err := normalizeJSON(input.Input, "input")
	if err != nil {
		return agentrun.DTO{}, false, err
	}
	metadata, err := normalizeJSON(defaultObject(input.Metadata), "metadata")
	if err != nil {
		return agentrun.DTO{}, false, err
	}
	trigger, err := normalizeOptionalJSON(input.Trigger, "trigger")
	if err != nil {
		return agentrun.DTO{}, false, err
	}
	progress, err := normalizeOptionalJSON(input.Progress, "progress")
	if err != nil {
		return agentrun.DTO{}, false, err
	}
	taskResults, err := normalizeTaskResults(input.TaskResults)
	if err != nil {
		return agentrun.DTO{}, false, err
	}
	fingerprint, err := fingerprintInput(normalizedInput)
	if err != nil {
		return agentrun.DTO{}, false, err
	}

	if key != nil {
		indexKey := idempotencyKey(operationID, *key)
		if existing, ok := s.idempotency[indexKey]; ok {
			if record, ok := s.runs[existing.RunID]; ok {
				if existing.InputFingerprint == fingerprint {
					return record.Run.ToDTO(), true, nil
				}
				return agentrun.DTO{}, false, apperrors.WithStatus("AGENT_IDEMPOTENCY_KEY_REUSED", "同一 operation 的幂等键不能用于不同输入", 409, false, map[string]any{
					"operationId":         operationID,
					"idempotencyKey":      *key,
					"runId":               existing.RunID,
					"existingFingerprint": existing.InputFingerprint,
					"inputFingerprint":    fingerprint,
				})
			}
			delete(s.idempotency, indexKey)
		}
	}

	now := s.now()
	createdAt := formatTime(now)
	runID, err := newUUID()
	if err != nil {
		return agentrun.DTO{}, false, apperrors.New("AGENT_RUN_CREATE_FAILED", "无法创建 run")
	}
	run := &agentrun.Run{
		RunID:            runID,
		OperationID:      operationID,
		IdempotencyKey:   key,
		InputFingerprint: fingerprint,
		Input:            normalizedInput,
		Metadata:         metadata,
		Trigger:          trigger,
		Progress:         progress,
		TaskResults:      taskResults,
		Status:           agentrun.StatusAccepted,
		CreatedAt:        createdAt,
		UpdatedAt:        createdAt,
	}
	s.sequence++
	record := &agentrun.Record{Run: run, Sequence: s.sequence, CreatedAtMS: now.UnixMilli()}
	s.runs[runID] = record
	if key != nil {
		s.idempotency[idempotencyKey(operationID, *key)] = idempotencyEntry{RunID: runID, InputFingerprint: fingerprint}
	}
	pruned := s.pruneLocked(now)
	if err := s.persistLocked(); err != nil {
		delete(s.runs, runID)
		if key != nil {
			delete(s.idempotency, idempotencyKey(operationID, *key))
		}
		return agentrun.DTO{}, false, err
	}
	_ = pruned
	return run.ToDTO(), false, nil
}

func (s *Service) Start(runID string) (agentrun.DTO, error) {
	return s.transition(runID, agentrun.StatusRunning, []agentrun.Status{agentrun.StatusAccepted}, nil)
}

func (s *Service) MarkWaiting(runID string) (agentrun.DTO, error) {
	return s.transition(runID, agentrun.StatusWaiting, []agentrun.Status{agentrun.StatusRunning}, nil)
}

func (s *Service) StartForExecution(runID string) (agentrun.DTO, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, err := s.requireRecordLocked(runID)
	if err != nil {
		return agentrun.DTO{}, err
	}
	switch record.Run.Status {
	case agentrun.StatusAccepted, agentrun.StatusWaiting:
		return s.transitionLocked(record, agentrun.StatusRunning, nil, agentrun.StatusAccepted, agentrun.StatusWaiting)
	case agentrun.StatusRunning:
		return record.Run.ToDTO(), nil
	default:
		return agentrun.DTO{}, transitionError(record, agentrun.StatusRunning, []agentrun.Status{agentrun.StatusAccepted, agentrun.StatusWaiting, agentrun.StatusRunning})
	}
}

func (s *Service) MarkStopping(runID string) (agentrun.DTO, error) {
	return s.transition(runID, agentrun.StatusStopping, []agentrun.Status{agentrun.StatusAccepted, agentrun.StatusWaiting, agentrun.StatusRunning}, nil)
}

func (s *Service) SetAcceptedResult(runID string, result any) (agentrun.DTO, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, err := s.requireRecordLocked(runID)
	if err != nil {
		return agentrun.DTO{}, err
	}
	if record.Run.Status.Terminal() {
		return record.Run.ToDTO(), nil
	}
	normalized, err := normalizeJSON(result, "result")
	if err != nil {
		return agentrun.DTO{}, err
	}
	record.Run.Result = normalized
	record.Run.UpdatedAt = formatTime(s.now())
	if err := s.persistLocked(); err != nil {
		return agentrun.DTO{}, err
	}
	return record.Run.ToDTO(), nil
}

func (s *Service) Complete(runID string, result any) (agentrun.DTO, error) {
	normalized, err := normalizeJSON(result, "result")
	if err != nil {
		return agentrun.DTO{}, err
	}
	return s.transition(runID, agentrun.StatusSucceeded, []agentrun.Status{agentrun.StatusAccepted, agentrun.StatusWaiting, agentrun.StatusRunning}, func(run *agentrun.Run) {
		run.Result = normalized
		run.Error = nil
	})
}

func (s *Service) Fail(runID string, cause any) (agentrun.DTO, error) {
	failure := NormalizeFailure(cause)
	return s.transition(runID, agentrun.StatusFailed, []agentrun.Status{agentrun.StatusAccepted, agentrun.StatusWaiting, agentrun.StatusRunning, agentrun.StatusStopping}, func(run *agentrun.Run) {
		run.Result = nil
		run.Error = failure
	})
}

func (s *Service) Stop(runID string, result any) (agentrun.DTO, error) {
	normalized, err := normalizeJSON(result, "result")
	if err != nil {
		return agentrun.DTO{}, err
	}
	return s.transition(runID, agentrun.StatusStopped, []agentrun.Status{agentrun.StatusAccepted, agentrun.StatusWaiting, agentrun.StatusRunning, agentrun.StatusStopping}, func(run *agentrun.Run) {
		run.Result = normalized
		run.Error = nil
	})
}

func (s *Service) UpdateProgress(runID string, progress any, taskResults []any) (agentrun.DTO, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, err := s.requireRecordLocked(runID)
	if err != nil {
		return agentrun.DTO{}, err
	}
	if record.Run.Status.Terminal() {
		return record.Run.ToDTO(), nil
	}
	normalized, err := normalizeOptionalJSON(progress, "progress")
	if err != nil {
		return agentrun.DTO{}, err
	}
	record.Run.Progress = normalized
	if taskResults != nil {
		normalizedResults, err := normalizeTaskResults(taskResults)
		if err != nil {
			return agentrun.DTO{}, err
		}
		record.Run.TaskResults = normalizedResults
	}
	record.Run.UpdatedAt = formatTime(s.now())
	if err := s.persistLocked(); err != nil {
		return agentrun.DTO{}, err
	}
	return record.Run.ToDTO(), nil
}

func (s *Service) ReleaseIdempotency(runID string) (agentrun.DTO, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, err := s.requireRecordLocked(runID)
	if err != nil {
		return agentrun.DTO{}, err
	}
	if record.Run.IdempotencyKey == nil {
		return record.Run.ToDTO(), nil
	}
	key := idempotencyKey(record.Run.OperationID, *record.Run.IdempotencyKey)
	if entry, ok := s.idempotency[key]; ok && entry.RunID == runID {
		delete(s.idempotency, key)
	}
	if err := s.persistLocked(); err != nil {
		return agentrun.DTO{}, err
	}
	return record.Run.ToDTO(), nil
}

func (s *Service) Discard(runID string) (agentrun.DTO, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.runs[runID]
	if !ok {
		return agentrun.DTO{}, notFoundError(runID)
	}
	dto := record.Run.ToDTO()
	delete(s.runs, runID)
	if record.Run.IdempotencyKey != nil {
		key := idempotencyKey(record.Run.OperationID, *record.Run.IdempotencyKey)
		if entry, ok := s.idempotency[key]; ok && entry.RunID == runID {
			delete(s.idempotency, key)
		}
	}
	if err := s.persistLocked(); err != nil {
		return agentrun.DTO{}, err
	}
	return dto, nil
}

func (s *Service) Get(runID string) (agentrun.DTO, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.runs[runID]
	if !ok {
		return agentrun.DTO{}, false
	}
	return record.Run.ToDTO(), true
}

func (s *Service) Current() (agentrun.DTO, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var latest *agentrun.Record
	for _, record := range s.runs {
		if !record.Run.Status.Active() {
			continue
		}
		if latest == nil || record.Sequence > latest.Sequence {
			latest = record
		}
	}
	if latest == nil {
		return agentrun.DTO{}, false
	}
	return latest.Run.ToDTO(), true
}

func (s *Service) List() []agentrun.DTO {
	s.mu.Lock()
	defer s.mu.Unlock()
	records := make([]*agentrun.Record, 0, len(s.runs))
	for _, record := range s.runs {
		records = append(records, record)
	}
	sort.Slice(records, func(i, j int) bool { return records[i].Sequence < records[j].Sequence })
	out := make([]agentrun.DTO, 0, len(records))
	for _, record := range records {
		out = append(out, record.Run.ToDTO())
	}
	return out
}

func (s *Service) Flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.enabled {
		return s.persistErr
	}
	return s.persistLocked()
}

func (s *Service) transition(runID string, target agentrun.Status, allowed []agentrun.Status, update func(*agentrun.Run)) (agentrun.DTO, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, err := s.requireRecordLocked(runID)
	if err != nil {
		return agentrun.DTO{}, err
	}
	return s.transitionLocked(record, target, update, allowed...)
}

func (s *Service) transitionLocked(record *agentrun.Record, target agentrun.Status, update func(*agentrun.Run), allowed ...agentrun.Status) (agentrun.DTO, error) {
	if record.Run.Status == target {
		return record.Run.ToDTO(), nil
	}
	ok := false
	for _, candidate := range allowed {
		if record.Run.Status == candidate {
			ok = true
			break
		}
	}
	if !ok {
		return agentrun.DTO{}, transitionError(record, target, allowed)
	}
	now := s.now()
	nowString := formatTime(now)
	record.Run.Status = target
	record.Run.UpdatedAt = nowString
	if update != nil {
		update(record.Run)
	}
	if target == agentrun.StatusRunning && record.Run.StartedAt == nil {
		record.Run.StartedAt = &nowString
		ms := now.UnixMilli()
		record.StartedAtMS = &ms
	}
	if target.Terminal() {
		record.Run.FinishedAt = &nowString
		startMS := record.CreatedAtMS
		if record.StartedAtMS != nil {
			startMS = *record.StartedAtMS
		}
		duration := now.UnixMilli() - startMS
		if duration < 0 {
			duration = 0
		}
		record.Run.DurationMS = &duration
		ms := now.UnixMilli()
		record.FinishedAtMS = &ms
		s.terminalSeq++
		seq := s.terminalSeq
		record.TerminalSequence = &seq
		s.pruneLocked(now)
	}
	if err := s.persistLocked(); err != nil {
		return agentrun.DTO{}, err
	}
	return record.Run.ToDTO(), nil
}

func (s *Service) requireRecordLocked(runID string) (*agentrun.Record, error) {
	if s.pruneLocked(s.now()) > 0 {
		_ = s.persistLocked()
	}
	record, ok := s.runs[runID]
	if !ok {
		return nil, notFoundError(runID)
	}
	return record, nil
}

func (s *Service) pruneLocked(now time.Time) int {
	cutoff := now.Add(-s.retention).UnixMilli()
	removed := 0
	terminal := make([]*agentrun.Record, 0)
	for runID, record := range s.runs {
		if !record.Run.Status.Terminal() {
			continue
		}
		if record.FinishedAtMS != nil && *record.FinishedAtMS <= cutoff {
			s.removeLocked(runID)
			removed++
			continue
		}
		terminal = append(terminal, record)
	}
	if len(terminal) <= s.maxTerminal {
		return removed
	}
	sort.Slice(terminal, func(i, j int) bool {
		left, right := int64(0), int64(0)
		if terminal[i].TerminalSequence != nil {
			left = *terminal[i].TerminalSequence
		}
		if terminal[j].TerminalSequence != nil {
			right = *terminal[j].TerminalSequence
		}
		return left < right
	})
	excess := len(terminal) - s.maxTerminal
	for _, record := range terminal[:excess] {
		s.removeLocked(record.Run.RunID)
		removed++
	}
	return removed
}

func (s *Service) removeLocked(runID string) {
	record, ok := s.runs[runID]
	if !ok {
		return
	}
	delete(s.runs, runID)
	if record.Run.IdempotencyKey != nil {
		key := idempotencyKey(record.Run.OperationID, *record.Run.IdempotencyKey)
		if entry, ok := s.idempotency[key]; ok && entry.RunID == runID {
			delete(s.idempotency, key)
		}
	}
}

func (s *Service) persistLocked() error {
	records := make([]*agentrun.Record, 0, len(s.runs))
	for _, record := range s.runs {
		records = append(records, record)
	}
	sort.Slice(records, func(i, j int) bool { return records[i].Sequence < records[j].Sequence })
	snapshot := storeSnapshot{Version: storeVersion, SavedAt: formatTime(s.now()), Runs: records}
	if err := jsonstore.Write(s.filePath, snapshot, false); err != nil {
		s.persistErr = err
		return agentRunPersistenceError(s.filePath, err)
	}
	s.persistErr = nil
	return nil
}

func NormalizeFailure(cause any) *agentrun.Failure {
	if cause == nil {
		cause = map[string]any{"message": "Agent run 执行失败"}
	}
	if appErr, ok := apperrors.As(asError(cause)); ok {
		return &agentrun.Failure{
			Code:       appErr.Code,
			Message:    appErr.Message,
			StatusCode: appErr.StatusCode,
			Details:    appErr.Details,
			Retryable:  appErr.Retryable,
		}
	}
	normalized, err := normalizeJSON(cause, "error")
	if err != nil {
		normalized = map[string]any{"message": "Agent run 执行失败"}
	}
	if text, ok := normalized.(string); ok {
		return &agentrun.Failure{Code: "AGENT_RUN_FAILED", Message: text, StatusCode: 500, Details: map[string]any{}}
	}
	record, _ := normalized.(map[string]any)
	failure := &agentrun.Failure{Code: "AGENT_RUN_FAILED", Message: "Agent run 执行失败", StatusCode: 500, Details: map[string]any{}}
	if code, ok := record["code"].(string); ok && code != "" {
		failure.Code = code
	}
	if message, ok := record["message"].(string); ok && message != "" {
		failure.Message = message
	}
	if status, ok := numericInt(record["statusCode"]); ok && status >= 400 && status <= 599 {
		failure.StatusCode = status
	}
	if details, ok := record["details"].(map[string]any); ok {
		failure.Details = details
	}
	if retryable, ok := record["retryable"].(bool); ok {
		failure.Retryable = retryable
	}
	return failure
}

func asError(value any) error {
	if err, ok := value.(error); ok {
		return err
	}
	return fmt.Errorf("%v", value)
}

func fingerprintInput(input any) (string, error) {
	stable, err := jsonstore.StableJSON(input)
	if err != nil {
		return "", apperrors.Validation("AGENT_RUN_JSON_INVALID", "input 必须是可序列化的 JSON", map[string]any{"field": "input"})
	}
	sum := sha256.Sum256([]byte(stable))
	return hex.EncodeToString(sum[:]), nil
}

func normalizeJSON(value any, field string) (any, error) {
	normalized, err := jsonstore.Normalize(value)
	if err != nil {
		return nil, apperrors.Validation("AGENT_RUN_JSON_INVALID", field+" 必须是可序列化的 JSON", map[string]any{"field": field})
	}
	return normalized, nil
}

func normalizeOptionalJSON(value any, field string) (any, error) {
	if value == nil {
		return nil, nil
	}
	return normalizeJSON(value, field)
}

func normalizeTaskResults(results []any) ([]any, error) {
	if results == nil {
		return []any{}, nil
	}
	normalized, err := jsonstore.Normalize(results)
	if err != nil {
		return nil, apperrors.Validation("AGENT_RUN_TASK_RESULTS_INVALID", "taskResults 必须是数组", map[string]any{"field": "taskResults"})
	}
	array, ok := normalized.([]any)
	if !ok {
		return nil, apperrors.Validation("AGENT_RUN_TASK_RESULTS_INVALID", "taskResults 必须是数组", map[string]any{"field": "taskResults"})
	}
	return array, nil
}

func defaultObject(value any) any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func normalizeOperationID(value string) (string, error) {
	trimmed := value
	for len(trimmed) > 0 && (trimmed[0] == ' ' || trimmed[0] == '\t' || trimmed[0] == '\n' || trimmed[0] == '\r') {
		trimmed = trimmed[1:]
	}
	for len(trimmed) > 0 {
		last := trimmed[len(trimmed)-1]
		if last != ' ' && last != '\t' && last != '\n' && last != '\r' {
			break
		}
		trimmed = trimmed[:len(trimmed)-1]
	}
	if trimmed == "" {
		return "", apperrors.Validation("AGENT_OPERATION_ID_INVALID", "operationId 不能为空", map[string]any{"operationId": value})
	}
	return trimmed, nil
}

func normalizeIdempotencyKey(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	if !idempotencyKeyPattern.MatchString(*value) {
		return nil, apperrors.Validation("AGENT_IDEMPOTENCY_KEY_INVALID", "idempotencyKey 格式不合法", map[string]any{"idempotencyKey": *value, "pattern": idempotencyKeyRegexp})
	}
	copy := *value
	return &copy, nil
}

func idempotencyKey(operationID, key string) string {
	return operationID + "\x00" + key
}

func notFoundError(runID string) *apperrors.Error {
	return apperrors.NotFound("AGENT_RUN_NOT_FOUND", "未找到 Agent run: "+runID, map[string]any{"runId": runID})
}

func transitionError(record *agentrun.Record, target agentrun.Status, allowed []agentrun.Status) *apperrors.Error {
	allowedStrings := make([]string, 0, len(allowed))
	for _, status := range allowed {
		allowedStrings = append(allowedStrings, string(status))
	}
	return apperrors.WithStatus("AGENT_RUN_STATE_CONFLICT", fmt.Sprintf("无法将 run 从 %s 更新为 %s", record.Run.Status, target), 409, false, map[string]any{
		"runId":           record.Run.RunID,
		"status":          record.Run.Status,
		"targetStatus":    target,
		"allowedStatuses": allowedStrings,
	})
}

func storeError(message string, details map[string]any) *apperrors.Error {
	return apperrors.WithStatus("AGENT_RUN_STORE_INVALID", message, 503, false, details)
}

func agentRunPersistenceError(filePath string, cause error) *apperrors.Error {
	message := "Agent run 持久化失败"
	if cause != nil {
		message += ": " + cause.Error()
	}
	return apperrors.WithStatus("AGENT_RUN_PERSISTENCE_FAILED", message, 503, true, map[string]any{"filePath": filePath})
}

func formatTime(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000Z")
}

func parseTime(value string) (time.Time, error) {
	return time.Parse(time.RFC3339, value)
}

func numericInt(value any) (int, bool) {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := typed.Int64()
		return int(parsed), err == nil
	case float64:
		return int(typed), true
	case int:
		return typed, true
	case int64:
		return int(typed), true
	}
	return 0, false
}

func newUUID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}
