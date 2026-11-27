package timefmt

import (
	"testing"
	"time"
)

func TestFormatMillis(t *testing.T) {
	location := time.FixedZone("UTC+8", 8*60*60)
	value := time.Date(2026, 11, 28, 10, 30, 5, 123_456_789, location)
	if got := FormatMillis(value); got != "2026-11-28T02:30:05.123Z" {
		t.Fatalf("FormatMillis = %q", got)
	}
}

func TestOffsetLayoutKeepsOffset(t *testing.T) {
	location := time.FixedZone("UTC+8", 8*60*60)
	value := time.Date(2026, 11, 28, 10, 30, 5, 0, location)
	if got := value.Format(OffsetMillisLayout); got != "2026-11-28T10:30:05.000+08:00" {
		t.Fatalf("offset = %q", got)
	}
}
