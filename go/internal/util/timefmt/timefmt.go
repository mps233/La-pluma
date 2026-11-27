// Package timefmt owns the timestamp layouts shared by persisted state and
// the Agent API. Formatting through these helpers keeps UTC and precision
// consistent; callers that need a local calendar date format the time in the
// business timezone themselves and use DateLayout.
package timefmt

import "time"

const (
	// MillisLayout is the Agent API and persisted-state timestamp: UTC with
	// millisecond precision and a literal Z.
	MillisLayout = "2006-01-02T15:04:05.000Z"
	// OffsetMillisLayout is the same instant with a numeric offset instead of
	// Z; used by resource metadata that preserves the source offset.
	OffsetMillisLayout = "2006-01-02T15:04:05.000Z07:00"
	// DateLayout is a calendar date.
	DateLayout = "2006-01-02"
)

// FormatMillis renders t in UTC with millisecond precision.
func FormatMillis(t time.Time) string {
	return t.UTC().Format(MillisLayout)
}
