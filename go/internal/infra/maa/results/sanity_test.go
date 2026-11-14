package results

import (
	"strings"
	"testing"
)

func TestLatestSanityStatePicksTheNewestReading(t *testing.T) {
	log := strings.Join([]string{
		`[2026-11-14 18:14:23.587][INF][Px1][Tx1] Assistant::append_callback | SubTaskExtraInfo {"class":"asst::FightTimesTaskPlugin","details":{"current_sanity":13,"max_sanity":210,"report_time":"2026-11-14 18:14:23.436"},"subtask":"FightTimesTask","taskchain":"Fight","what":"SanityBeforeStage"}`,
		`[2026-11-14 18:14:37.389][INF][Px1][Tx1] Assistant::append_callback | SubTaskExtraInfo {"class":"asst::FightTimesTaskPlugin","details":{"current_sanity":6,"max_sanity":210,"report_time":"2026-11-14 18:14:37.156"},"subtask":"FightTimesTask","taskchain":"Fight","what":"SanityBeforeStage"}`,
	}, "\n")

	reading, ok := LatestSanityState(log)
	if !ok {
		t.Fatal("expected a sanity reading")
	}
	if reading.Current != 6 || reading.Max != 210 {
		t.Fatalf("reading = %+v", reading)
	}
	if reading.ReportAt != "2026-11-14 18:14:37.156" {
		t.Fatalf("reportAt = %q", reading.ReportAt)
	}
}

func TestLatestSanityStateIgnoresOtherCallbacks(t *testing.T) {
	log := `[2026-11-14 18:14:23.587][INF][Px1][Tx1] Assistant::append_callback | SubTaskExtraInfo {"details":{"count":2},"what":"RoguelikeInvestment","taskchain":"Roguelike"}`
	if _, ok := LatestSanityState(log); ok {
		t.Fatal("expected no reading")
	}
}
