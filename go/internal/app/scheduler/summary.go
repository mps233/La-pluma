package scheduler

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"

	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

var (
	fightSummaryPattern    = regexp.MustCompile(`(?i)Fight\s+([A-Za-z0-9-]+)\s+(\d+)\s+times?`)
	totalDropsPattern      = regexp.MustCompile(`(?i)total drops:\s*(.+?)(?:\n|$)`)
	dropItemPattern        = regexp.MustCompile(`(?:"([^"]+)"|([^\s,×]+))\s*×\s*(\d+)`)
	medicineUsedPattern    = regexp.MustCompile(`(?i)used\s+(\d+)\s+medicine`)
	medicineLabelPattern   = regexp.MustCompile(`(?i)medicine[:\s]+(\d+)`)
	stoneUsedPattern       = regexp.MustCompile(`(?i)used\s+(\d+)\s+stone`)
	stoneLabelPattern      = regexp.MustCompile(`(?i)stone[:\s]+(\d+)`)
	fightDurationPattern   = regexp.MustCompile(`\[Fight\]\s+([\d:]+)\s+-\s+([\d:]+)\s+\(([^)]+)\)`)
	recruitLinePattern     = regexp.MustCompile(`(?m)^\s*\d+\.\s*(★+)\s*(.*?)(?:,\s*(Recruited|Refreshed))?\s*$`)
	recruitSummaryPattern  = regexp.MustCompile(`(?i)Recruit[:\s]+\[([^\]]+)\]\s*->\s*(\d+)\*`)
	recruitedCountPattern  = regexp.MustCompile(`(?i)Recruited\s+(\d+)\s+times`)
	refreshedCountPattern  = regexp.MustCompile(`(?i)Refreshed\s+(\d+)\s+times`)
	infrastLinePattern     = regexp.MustCompile(`^(Control|Mfg|Trade|Power|Office|Reception|Dorm|Processing|Training|Unknown)\b`)
	infrastFallbackPattern = regexp.MustCompile(`(?i)Infrast[:\s]+([^\n]+)`)
	completedFightPattern  = regexp.MustCompile(`(?i)Fight\s+\S+\s+[1-9]\d*\s+times?`)
	fightZeroTimesPattern  = regexp.MustCompile(`(?i)Fight\s+(?:[a-z0-9-]+\s+)?0\s+times?`)
	penguinFailurePattern  = regexp.MustCompile(`(?i)FailedToReportToPenguinStats`)
	yituliuFailurePattern  = regexp.MustCompile(`(?i)FailedToReportToYituliu`)
	stageNotOpenPattern    = regexp.MustCompile(`(?i)stage not open|关卡未开放`)
	annihilationPattern    = regexp.MustCompile(`(?i)annihilation|剿灭`)
)

// ParseTaskSummary mirrors parseTaskSummary. It returns nil when the output
// carries no task-specific information.
func ParseTaskSummary(taskName, output string) *TaskSummary {
	summary := &TaskSummary{Task: taskName}

	if match := fightSummaryPattern.FindStringSubmatch(output); match != nil {
		summary.Stage = match[1]
		summary.Times = match[2]
	}

	if match := totalDropsPattern.FindStringSubmatch(output); match != nil {
		dropsText := strings.TrimSpace(match[1])
		drops := make([]string, 0, 4)
		items := make([]FightDropItem, 0, 4)
		for _, itemMatch := range dropItemPattern.FindAllStringSubmatch(dropsText, -1) {
			itemName := itemMatch[1]
			if itemName == "" {
				itemName = itemMatch[2]
			}
			count, err := strconv.ParseFloat(itemMatch[3], 64)
			if err != nil {
				continue
			}
			drops = append(drops, itemName+" × "+strconv.FormatFloat(count, 'f', -1, 64))
			items = append(items, FightDropItem{Name: itemName, Count: count})
		}
		if len(drops) > 0 {
			summary.Drops = strings.Join(drops, ", ")
			summary.DropItems = items
		}
	}

	if match := firstMatch(output, medicineUsedPattern, medicineLabelPattern); match != nil {
		summary.Medicine = match[1]
	}
	if match := firstMatch(output, stoneUsedPattern, stoneLabelPattern); match != nil {
		summary.Stone = match[1]
	}
	if match := fightDurationPattern.FindStringSubmatch(output); match != nil {
		summary.Duration = match[3]
	}

	if strings.Contains(output, "Detected tags") {
		recruits := make([]RecruitSummary, 0, 4)
		for _, match := range recruitLinePattern.FindAllStringSubmatch(output, -1) {
			tags := make([]string, 0, 4)
			for _, tag := range strings.Split(match[2], ",") {
				if trimmed := strings.TrimSpace(tag); trimmed != "" {
					tags = append(tags, trimmed)
				}
			}
			state := any(nil)
			if match[3] != "" {
				state = match[3]
			}
			recruits = append(recruits, RecruitSummary{
				Stars: float64(len([]rune(match[1]))),
				Tags:  tags,
				State: state,
			})
		}
		if len(recruits) > 0 {
			summary.Recruits = recruits
		}
		if match := recruitedCountPattern.FindStringSubmatch(output); match != nil {
			if count, err := strconv.Atoi(match[1]); err == nil {
				summary.RecruitCount = &count
			}
		}
		if match := refreshedCountPattern.FindStringSubmatch(output); match != nil {
			if count, err := strconv.Atoi(match[1]); err == nil {
				summary.RefreshCount = &count
			}
		}
	} else if strings.Contains(output, "Recruit") {
		for _, match := range recruitSummaryPattern.FindAllStringSubmatch(output, -1) {
			summary.Recruits = append(summary.Recruits, RecruitSummary{
				Tags:  match[1],
				Stars: match[2],
			})
		}
	}

	infrastLines := make([]string, 0, 4)
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" && infrastLinePattern.MatchString(trimmed) {
			infrastLines = append(infrastLines, trimmed)
		}
	}
	if len(infrastLines) > 0 {
		summary.Infrast = strings.Join(infrastLines, "\n")
	} else if strings.Contains(output, "Infrast") {
		if match := infrastFallbackPattern.FindStringSubmatch(output); match != nil {
			summary.Infrast = strings.TrimSpace(match[1])
		}
	}

	if !summaryHasContent(summary) {
		return nil
	}
	return summary
}

func firstMatch(output string, patterns ...*regexp.Regexp) []string {
	for _, pattern := range patterns {
		if match := pattern.FindStringSubmatch(output); match != nil {
			return match
		}
	}
	return nil
}

func summaryHasContent(summary *TaskSummary) bool {
	return summary.Stage != "" || summary.Times != "" || summary.Drops != "" ||
		len(summary.DropItems) > 0 || summary.Medicine != "" || summary.Stone != "" ||
		summary.Duration != "" || len(summary.Recruits) > 0 ||
		summary.RecruitCount != nil || summary.RefreshCount != nil ||
		summary.Infrast != "" || summary.Sanity != 0
}

// IsFightSanityDepleted mirrors isFightSanityDepleted.
func IsFightSanityDepleted(output, stage string) bool {
	if output == "" {
		return false
	}
	lowerOutput := strings.ToLower(output)
	lowerStage := strings.ToLower(stage)
	for _, pattern := range []string{
		"sanity is not enough",
		"理智不足",
		"理智已耗尽",
		"not enough sanity",
		"insufficient sanity",
		"no sanity",
		"sanity depleted",
	} {
		if strings.Contains(lowerOutput, pattern) {
			return true
		}
	}
	if fightZeroTimesPattern.MatchString(output) {
		return true
	}
	if strings.Contains(output, "Summary") && strings.Contains(output, "[Fight]") && strings.Contains(output, "Completed") {
		hasFightRecord := completedFightPattern.MatchString(output)
		isAnnihilation := strings.Contains(lowerStage, "annihilation") || strings.Contains(lowerStage, "剿灭")
		if !hasFightRecord && !isAnnihilation {
			return true
		}
	}
	return false
}

// GetFightReportResults mirrors getFightReportResults. The Node diagnostics
// channel is not part of the executor interface, so unknown-drop suppression is
// skipped; per-provider outcomes are still derived from stderr.
func GetFightReportResults(task map[string]any, stage, stdout, stderr string) []FightReportResult {
	completedFight := completedFightPattern.MatchString(stdout)
	if !completedFight {
		return nil
	}
	params := taskParams(task)
	reports := make([]FightReportResult, 0, 2)
	addReport := func(provider string, enabled any, failurePattern *regexp.Regexp, successMessage, failureMessage string) {
		if !truthy(enabled) {
			return
		}
		failed := failurePattern.MatchString(stderr)
		status := "success"
		message := successMessage
		if failed {
			status = "failed"
			message = failureMessage
		}
		reports = append(reports, FightReportResult{
			Provider: provider,
			Stage:    stage,
			Status:   status,
			Message:  message,
		})
	}
	addReport("penguin", params["report_to_penguin"], penguinFailurePattern, "已汇报至企鹅物流", "企鹅物流汇报失败")
	addReport("yituliu", params["report_to_yituliu"], yituliuFailurePattern, "已汇报至一图流", "一图流汇报失败")
	return reports
}

// buildFightAction mirrors createFightExecutionAction.
func buildFightAction(taskName, requestedStage string, summary *TaskSummary, output string, err error, skipReason string) TaskActionResult {
	stage := ""
	times := float64(0)
	dropCount := 0
	drops := ""
	medicine := float64(0)
	stone := float64(0)
	sanity := float64(0)
	duration := ""
	if summary != nil {
		stage = summary.Stage
		if number, ok := numberValue(summary.Times); ok {
			times = math.Max(0, number)
		}
		dropCount = len(summary.DropItems)
		drops = summary.Drops
		if number, ok := numberValue(summary.Medicine); ok {
			medicine = math.Max(0, number)
		}
		if number, ok := numberValue(summary.Stone); ok {
			stone = math.Max(0, number)
		}
		sanity = math.Max(0, summary.Sanity)
		duration = summary.Duration
	}
	if strings.TrimSpace(stage) == "" {
		stage = strings.TrimSpace(requestedStage)
	}

	errorText := ""
	if err != nil {
		errorText = err.Error()
	}
	combined := strings.TrimSpace(strings.Join(nonEmpty(output, errorText), "\n"))
	sanityDepleted := IsFightSanityDepleted(combined, stage)
	action := TaskActionResult{
		Task:           taskName,
		Action:         "fight",
		Stage:          stage,
		Times:          times,
		DropCount:      dropCount,
		Drops:          drops,
		Medicine:       medicine,
		Stone:          stone,
		Sanity:         sanity,
		Duration:       duration,
		SanityDepleted: sanityDepleted,
	}
	stageLabel := stage
	if stageLabel == "" {
		stageLabel = "当前关卡"
	}
	if skipReason != "" {
		action.Status = "skipped"
		action.Message = stageLabel + "已跳过：" + skipReason
		return action
	}
	if errorText != "" {
		if sanityDepleted {
			action.Status = "skipped"
			action.Message = stageLabel + "未继续作战：理智已耗尽"
			return action
		}
		if stageNotOpenPattern.MatchString(errorText) {
			action.Status = "skipped"
			action.Message = stageLabel + "已跳过：关卡未开放或不存在"
			return action
		}
		if annihilationPattern.MatchString(stage) {
			action.Status = "skipped"
			action.Message = stageLabel + "已跳过：奖励可能已领完或未找到入口"
			return action
		}
		action.Status = "failed"
		action.Message = stageLabel + "作战失败：" + firstLine(errorText)
		return action
	}
	if times == 0 && sanityDepleted {
		action.Status = "skipped"
		action.Message = stageLabel + "未开始作战：理智已耗尽"
		return action
	}
	if times == 0 && annihilationPattern.MatchString(stage) {
		action.Status = "skipped"
		action.Message = stageLabel + "未执行作战，奖励可能已领完"
		return action
	}

	details := make([]string, 0, 4)
	if times > 0 {
		details = append(details, stageLabel+" × "+strconv.FormatFloat(times, 'f', -1, 64))
	} else if stage != "" {
		details = append(details, stage)
	}
	if dropCount > 0 {
		details = append(details, "获得 "+strconv.Itoa(dropCount)+" 种掉落")
	}
	if sanityDepleted {
		details = append(details, "理智已耗尽")
	}
	action.Status = "success"
	if len(details) > 0 {
		action.Message = "作战完成：" + strings.Join(details, "；")
	} else {
		action.Message = "理智作战已完成"
	}
	return action
}

func nonEmpty(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}

func firstLine(text string) string {
	if index := strings.IndexByte(text, '\n'); index >= 0 {
		text = text[:index]
	}
	return text
}

// resultOutput extracts stdout/stderr from a completed DTO. The executor
// convention is to place them in Result as a JSON object.
func resultOutput(result domainrun.DTO) (stdout, stderr string) {
	if result.Result == nil {
		return "", ""
	}
	record, ok := result.Result.(map[string]any)
	if !ok {
		encoded, err := json.Marshal(result.Result)
		if err != nil {
			return "", ""
		}
		if err := json.Unmarshal(encoded, &record); err != nil {
			return "", ""
		}
	}
	return stringField(record, "stdout"), stringField(record, "stderr")
}

func errorOutput(err error) (stdout, stderr string) {
	if err == nil {
		return "", ""
	}
	appError, ok := apperrors.As(err)
	if !ok || appError.Details == nil {
		return "", ""
	}
	return jsString(appError.Details["stdout"]), jsString(appError.Details["stderr"])
}
