package logs

import (
	"sync"
	"time"
)

type Level string

const (
	LevelDebug Level = "DEBUG"
	LevelInfo  Level = "INFO"
	LevelWarn  Level = "WARN"
	LevelError Level = "ERROR"
)

type Entry struct {
	Time        string `json:"time"`
	Level       Level  `json:"level"`
	Message     string `json:"message"`
	Service     string `json:"service,omitempty"`
	RunID       string `json:"runId,omitempty"`
	OperationID string `json:"operationId,omitempty"`
	Sequence    int64  `json:"sequence"`
}

type Service struct {
	mu      sync.Mutex
	max     int
	entries []Entry
	next    int64
}

func New(max int) *Service {
	if max <= 0 {
		max = 5000
	}
	return &Service{max: max}
}

func (s *Service) Append(level Level, service, message string) {
	s.AppendWithRun(level, service, message, "", "")
}

func (s *Service) AppendWithRun(level Level, service, message, runID, operationID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.next++
	if len(s.entries) >= s.max {
		copy(s.entries, s.entries[1:])
		s.entries[len(s.entries)-1] = Entry{}
		s.entries = s.entries[:len(s.entries)-1]
	}
	s.entries = append(s.entries, Entry{
		Time:        time.Now().UTC().Format(time.RFC3339),
		Level:       level,
		Message:     message,
		Service:     service,
		RunID:       runID,
		OperationID: operationID,
		Sequence:    s.next,
	})
}

func (s *Service) AppendLine(stream, line string) {
	s.AppendLineWithRun(stream, line, "", "")
}

func (s *Service) AppendLineWithRun(stream, line, runID, operationID string) {
	level := LevelInfo
	if stream == "stderr" {
		level = LevelWarn
	}
	s.AppendWithRun(level, "MAA", line, runID, operationID)
}

func (s *Service) RecentAfter(lines int, afterSequence int64) []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	filtered := make([]Entry, 0, len(s.entries))
	for _, entry := range s.entries {
		if entry.Sequence > afterSequence {
			filtered = append(filtered, entry)
		}
	}
	if lines <= 0 || lines > len(filtered) {
		lines = len(filtered)
	}
	start := len(filtered) - lines
	out := make([]Entry, lines)
	copy(out, filtered[start:])
	return out
}

func (s *Service) Recent(lines int) []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	if lines <= 0 || lines > len(s.entries) {
		lines = len(s.entries)
	}
	start := len(s.entries) - lines
	out := make([]Entry, lines)
	copy(out, s.entries[start:])
	return out
}

func (s *Service) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries = nil
}
