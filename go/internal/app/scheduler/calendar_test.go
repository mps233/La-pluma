package scheduler

import (
	"testing"
	"time"
)

func TestParseClock(t *testing.T) {
	cases := []struct {
		value  string
		hour   int
		minute int
		ok     bool
	}{
		{"00:00", 0, 0, true},
		{"04:05", 4, 5, true},
		{"23:59", 23, 59, true},
		{" 08:30 ", 8, 30, true},
		{"24:00", 0, 0, false},
		{"7:05", 0, 0, false},
		{"12:60", 0, 0, false},
		{"", 0, 0, false},
		{"12:00:00", 0, 0, false},
	}
	for _, testCase := range cases {
		hour, minute, ok := ParseClock(testCase.value)
		if ok != testCase.ok || (ok && (hour != testCase.hour || minute != testCase.minute)) {
			t.Fatalf("ParseClock(%q) = %d:%d,%v; want %d:%d,%v", testCase.value, hour, minute, ok, testCase.hour, testCase.minute, testCase.ok)
		}
	}
}

func TestNormalizeScheduleTimes(t *testing.T) {
	got := NormalizeScheduleTimes([]string{"08:00", "bad", "08:00", "07:30", "23:00"})
	want := []string{"08:00", "07:30", "23:00"}
	if len(got) != len(want) {
		t.Fatalf("times = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("times = %v, want %v", got, want)
		}
	}
}

func TestNextDailyOccurrence(t *testing.T) {
	location := gameLocation("Official")
	after := time.Date(2026, 1, 1, 17, 30, 0, 0, location)
	next := nextDailyOccurrence(after, location, 18, 0)
	if next.Day() != 1 || next.Hour() != 18 || next.Minute() != 0 {
		t.Fatalf("next = %v", next)
	}
	next = nextDailyOccurrence(next, location, 18, 0)
	if next.Day() != 2 || next.Hour() != 18 {
		t.Fatalf("next day = %v", next)
	}
}
