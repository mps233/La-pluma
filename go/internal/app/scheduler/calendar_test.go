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

func TestGameTimeZoneForClientType(t *testing.T) {
	cases := map[string]string{
		"Official":    "Asia/Shanghai",
		"bilibili":    "Asia/Shanghai",
		"  YostarEN ": "Etc/GMT+7",
		"YostarJP":    "Asia/Tokyo",
		"yostarkr":    "Asia/Seoul",
		"unknown":     "Asia/Shanghai",
		"":            "Asia/Shanghai",
	}
	for clientType, want := range cases {
		if got := GameTimeZoneForClientType(clientType); got != want {
			t.Fatalf("GameTimeZoneForClientType(%q) = %q, want %q", clientType, got, want)
		}
	}
}

func TestGetGameDayUsesFourAMServerReset(t *testing.T) {
	// 2025-12-31 19:30 UTC is 2026-01-01 03:30 in Asia/Shanghai, before the
	// 04:00 reset, so it still belongs to 2025-12-31.
	beforeReset := GetGameDay(time.Date(2025, 12, 31, 19, 30, 0, 0, time.UTC), "Official")
	if beforeReset.Date != "2025-12-31" || beforeReset.Weekday != int(time.Wednesday) {
		t.Fatalf("before reset game day = %+v", beforeReset)
	}

	afterReset := GetGameDay(time.Date(2025, 12, 31, 20, 0, 0, 0, time.UTC), "Official")
	if afterReset.Date != "2026-01-01" || afterReset.Weekday != int(time.Thursday) {
		t.Fatalf("after reset game day = %+v", afterReset)
	}

	// YostarEN is UTC-7 with the same reset hour: 2026-01-02 10:30 UTC is
	// 03:30 local, before the reset, so it still belongs to 2026-01-01.
	yostar := GetGameDay(time.Date(2026, 1, 2, 10, 30, 0, 0, time.UTC), "YostarEN")
	if yostar.Date != "2026-01-01" {
		t.Fatalf("yostar game day = %+v", yostar)
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
