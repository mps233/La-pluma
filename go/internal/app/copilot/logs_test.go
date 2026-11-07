package copilot

import (
	"strings"
	"testing"
)

func TestFindCopilotStageProgressMapsLatestFile(t *testing.T) {
	items := []StageProgressItem{
		{Filename: "/tmp/1-101-normal-1.json", DisplayStage: "TL-1"},
		{Filename: "/tmp/2-102-normal-1.json", DisplayStage: "TL-2"},
	}
	logText := strings.Join([]string{
		`{"details":{"file_name":"/tmp/1-101-normal-1.json"},"what":"CopilotListLoadTaskFileSuccess"}`,
		`{"details":{"file_name":"/tmp/2-102-normal-1.json"},"what":"CopilotListLoadTaskFileSuccess"}`,
	}, "\n")
	progress := FindCopilotStageProgress(items, logText)
	if progress == nil || progress.Index != 1 || progress.DisplayStage != "TL-2" {
		t.Fatalf("progress = %#v", progress)
	}
	if FindCopilotStageProgress(items, "no stage events") != nil {
		t.Fatal("expected nil progress")
	}
}

func TestParseCopilotBattleTotalUsesLatestStageLoad(t *testing.T) {
	stageLoad := `{"details":{"file_name":"/tmp/2-102-normal-1.json"},"what":"CopilotListLoadTaskFileSuccess"}`
	logText := strings.Join([]string{
		"Kills: 0 / 22",
		`{"details":{"file_name":"/tmp/1-101-normal-1.json"},"what":"CopilotListLoadTaskFileSuccess"}`,
		"Kills: 11 / 35",
		"Kills: 0 / 41",
		stageLoad,
		"Kills: 0 / 52",
	}, "\n")
	if total := ParseCopilotBattleTotal(logText); total == nil || *total != 52 {
		t.Fatalf("total = %#v", total)
	}
	if total := ParseCopilotBattleTotal("Kills: 0 / 41"); total == nil || *total != 41 {
		t.Fatalf("plain total = %#v", total)
	}
	if ParseCopilotBattleTotal("Kills: 0 / 0") != nil {
		t.Fatal("zero total must be rejected")
	}
	if ParseCopilotBattleTotal("Kills: 0 / 501") != nil {
		t.Fatal("out-of-range total must be rejected")
	}
	if ParseCopilotBattleTotal("no battle lines") != nil {
		t.Fatal("missing battle lines must return nil")
	}
}

func TestExtractLoadedCopilotFiles(t *testing.T) {
	logText := `{"details":{"file_name":"/tmp/6-97353-normal-1.json"},"what":"CopilotListLoadTaskFileSuccess"}`
	files := ExtractLoadedCopilotFiles(logText)
	if len(files) != 1 || files[0] != "/tmp/6-97353-normal-1.json" {
		t.Fatalf("files = %#v", files)
	}
	if files := ExtractLoadedCopilotFiles(`{"file_name":"/tmp/a.json","what":"OtherEvent"}`); len(files) != 0 {
		t.Fatalf("non-copilot event = %#v", files)
	}
}

func TestProgressTrackerProjectsEntries(t *testing.T) {
	entries := []PlanEntry{
		{Key: "0:101:normal", ItemIndex: 0, CopilotID: 101, DisplayStage: "TL-1", Mode: "normal"},
		{Key: "1:102:normal", ItemIndex: 1, CopilotID: 102, DisplayStage: "TL-2", Mode: "normal"},
		{Key: "2:103:normal", ItemIndex: 2, CopilotID: 103, DisplayStage: "TL-3", Mode: "normal"},
	}
	tracker := NewProgressTracker(entries)
	assertStatuses(t, tracker, []ProgressStatus{ProgressPending, ProgressPending, ProgressPending})

	tracker.MarkRunning(entries[1])
	assertStatuses(t, tracker, []ProgressStatus{ProgressSuccess, ProgressRunning, ProgressPending})

	tracker.MarkGroupSuccess(entries[1:2])
	assertStatuses(t, tracker, []ProgressStatus{ProgressSuccess, ProgressSuccess, ProgressPending})

	tracker.MarkRunning(entries[2])
	tracker.SettleRunning(ProgressFailed, "测试失败")
	snapshot := tracker.Snapshot()
	if snapshot[2].Stage != "TL-3" || snapshot[2].Status != ProgressFailed || snapshot[2].Error != "测试失败" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}

func assertStatuses(t *testing.T, tracker *ProgressTracker, want []ProgressStatus) {
	t.Helper()
	snapshot := tracker.Snapshot()
	if len(snapshot) != len(want) {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	for index, status := range want {
		if snapshot[index].Status != status {
			t.Fatalf("snapshot[%d] = %#v, want %s", index, snapshot[index], status)
		}
	}
}
