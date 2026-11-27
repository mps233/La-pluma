package logs

import (
	"testing"
	"time"
)

func TestAppendEvictsOldestEntries(t *testing.T) {
	service := New(3)
	for _, message := range []string{"one", "two", "three", "four"} {
		service.Append(LevelInfo, "test", message)
	}

	entries := service.Recent(10)
	if len(entries) != 3 {
		t.Fatalf("entries = %d, want 3", len(entries))
	}
	if entries[0].Message != "two" || entries[2].Message != "four" {
		t.Fatalf("entries = %#v", entries)
	}
	if entries[0].Sequence != 2 || entries[2].Sequence != 4 {
		t.Fatalf("sequences = %d, %d", entries[0].Sequence, entries[2].Sequence)
	}
}

func TestRecentLimitsAndZero(t *testing.T) {
	service := New(10)
	for index := 0; index < 5; index++ {
		service.Append(LevelInfo, "test", "message")
	}

	if got := len(service.Recent(2)); got != 2 {
		t.Fatalf("Recent(2) = %d", got)
	}
	if got := len(service.Recent(0)); got != 5 {
		t.Fatalf("Recent(0) = %d", got)
	}
	if got := len(service.Recent(99)); got != 5 {
		t.Fatalf("Recent(99) = %d", got)
	}
}

func TestRecentAfterFiltersBySequence(t *testing.T) {
	service := New(10)
	service.Append(LevelInfo, "test", "one")
	service.Append(LevelInfo, "test", "two")
	service.Append(LevelInfo, "test", "three")

	entries := service.RecentAfter(0, 1)
	if len(entries) != 2 || entries[0].Message != "two" || entries[1].Message != "three" {
		t.Fatalf("entries = %#v", entries)
	}
	if got := service.RecentAfter(1, 1); len(got) != 1 || got[0].Message != "three" {
		t.Fatalf("RecentAfter(1, 1) = %#v", got)
	}
}

func TestAppendLineMapsStreamToLevel(t *testing.T) {
	service := New(10)
	service.AppendLine("stdout", "hello")
	service.AppendLineWithRun("stderr", "boom", "run-1", "fight")

	entries := service.Recent(10)
	if entries[0].Level != LevelInfo || entries[0].Service != "MAA" {
		t.Fatalf("stdout entry = %#v", entries[0])
	}
	if entries[1].Level != LevelWarn || entries[1].RunID != "run-1" || entries[1].OperationID != "fight" {
		t.Fatalf("stderr entry = %#v", entries[1])
	}
}

func TestClearKeepsSequenceMonotonic(t *testing.T) {
	service := New(10)
	service.Append(LevelInfo, "test", "one")
	service.Clear()
	if got := len(service.Recent(10)); got != 0 {
		t.Fatalf("entries after clear = %d", got)
	}

	service.Append(LevelInfo, "test", "two")
	entries := service.Recent(1)
	if len(entries) != 1 || entries[0].Sequence != 2 {
		t.Fatalf("entry after clear = %#v", entries)
	}
}

func TestEntryTimeIsUTC(t *testing.T) {
	service := New(1)
	service.Append(LevelError, "test", "message")
	entry := service.Recent(1)[0]
	parsed, err := time.Parse(time.RFC3339, entry.Time)
	if err != nil {
		t.Fatalf("time %q: %v", entry.Time, err)
	}
	if parsed.Location() != time.UTC {
		t.Fatalf("time zone = %v", parsed.Location())
	}
}

func TestNewDefaultsInvalidCapacity(t *testing.T) {
	service := New(0)
	if service.max != 5000 {
		t.Fatalf("max = %d", service.max)
	}
}
