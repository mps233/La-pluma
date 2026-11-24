package copilot

import (
	"regexp"
	"strconv"
	"strings"
)

var (
	loadedCopilotFilePattern = regexp.MustCompile(`"file_name"\s*:\s*"([^"]+)"(?s:.{0,500}?)"what"\s*:\s*"CopilotListLoadTaskFileSuccess"`)
	battleProgressPattern    = regexp.MustCompile(`Kills:\s*(\d{1,4})\s*/\s*(\d{1,4})`)
)

// ExtractLoadedCopilotFiles returns file_name values that precede a successful
// CopilotListLoadTaskFileSuccess callback within the 500 character window MAA
// uses for a single log line.
func ExtractLoadedCopilotFiles(logText string) []string {
	matches := loadedCopilotFilePattern.FindAllStringSubmatch(logText, -1)
	files := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) > 1 {
			files = append(files, match[1])
		}
	}
	return files
}

// ParseBattleProgress reads the latest `Kills: X / Y` line from MAA's trace
// log. Values outside 1..500 for the total, or a kill count above it, are
// rejected so a result-screen counter cannot become the battle counter.
func ParseBattleProgress(logText string) *BattleProgress {
	matches := battleProgressPattern.FindAllStringSubmatch(logText, -1)
	if len(matches) == 0 {
		return nil
	}
	last := matches[len(matches)-1]
	kills, err := strconv.Atoi(last[1])
	if err != nil {
		return nil
	}
	total, err := strconv.Atoi(last[2])
	if err != nil || total <= 0 || total > 500 || kills < 0 || kills > total {
		return nil
	}
	return &BattleProgress{Kills: kills, Total: total}
}

// StageProgressItem maps one generated copilot file to its display stage.
type StageProgressItem struct {
	Filename     string
	DisplayStage string
	Entry        *PlanEntry
}

// StageProgress is the currently loading copilot stage.
type StageProgress struct {
	Index        int    `json:"index"`
	DisplayStage string `json:"displayStage"`
}

// FindCopilotStageProgress maps the latest loaded copilot file to the matching
// progress item.
func FindCopilotStageProgress(items []StageProgressItem, logText string) *StageProgress {
	files := ExtractLoadedCopilotFiles(logText)
	if len(files) == 0 {
		return nil
	}
	currentFile := files[len(files)-1]
	for index, item := range items {
		if currentFile == item.Filename || strings.HasSuffix(currentFile, item.Filename) {
			return &StageProgress{Index: index, DisplayStage: item.DisplayStage}
		}
	}
	return nil
}
