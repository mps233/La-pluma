package results

import (
	"math"
	"regexp"
	"strings"
)

type FightSummary struct {
	Stage     any   `json:"stage"`
	Times     any   `json:"times"`
	DropItems []any `json:"dropItems"`
	Drops     any   `json:"drops"`
	Medicine  any   `json:"medicine"`
	Stone     any   `json:"stone"`
	Sanity    any   `json:"sanity"`
	Duration  any   `json:"duration"`
}

type FightExecutionOptions struct {
	Summary    *FightSummary
	Output     any
	Error      any
	SkipReason any
}

type FightExecutionAction struct {
	Task           string  `json:"task"`
	Action         string  `json:"action"`
	Status         string  `json:"status"`
	Stage          string  `json:"stage"`
	Times          float64 `json:"times"`
	DropCount      int     `json:"dropCount"`
	Drops          any     `json:"drops"`
	Medicine       float64 `json:"medicine"`
	Stone          float64 `json:"stone"`
	Sanity         float64 `json:"sanity"`
	Duration       any     `json:"duration"`
	SanityDepleted bool    `json:"sanityDepleted"`
	Message        string  `json:"message"`
}

var (
	fightZeroTimesPattern = regexp.MustCompile(`(?i)fight\s+(?:[a-z0-9-]+\s+)?0\s+times?`)
	fightRecordPattern    = regexp.MustCompile(`(?i)Fight\s+[A-Z0-9-]+\s+[1-9]\d*\s+times?`)
	stageNotOpenPattern   = regexp.MustCompile(`(?i)stage not open|关卡未开放`)
	annihilationPattern   = regexp.MustCompile(`(?i)annihilation|剿灭`)
)

var sanityDepletionPatterns = []string{
	"sanity is not enough",
	"理智不足",
	"理智已耗尽",
	"not enough sanity",
	"insufficient sanity",
	"no sanity",
	"sanity depleted",
}

// IsFightSanityDepleted recognizes the MAA outputs that mean no further fight
// can start because sanity ran out.
func IsFightSanityDepleted(output any, stage any) bool {
	text := truthyString(output)
	if text == "" {
		return false
	}

	lowerOutput := strings.ToLower(text)
	lowerStage := strings.ToLower(truthyString(stage))
	for _, pattern := range sanityDepletionPatterns {
		if strings.Contains(lowerOutput, pattern) {
			return true
		}
	}
	if fightZeroTimesPattern.MatchString(text) {
		return true
	}

	if strings.Contains(text, "Summary") &&
		strings.Contains(text, "[Fight]") &&
		strings.Contains(text, "Completed") {
		hasFightRecord := fightRecordPattern.MatchString(text)
		isAnnihilation := strings.Contains(lowerStage, "annihilation") ||
			strings.Contains(lowerStage, "剿灭")
		if !hasFightRecord && !isAnnihilation {
			return true
		}
	}

	return false
}

// CreateFightExecutionAction mirrors the scheduler's fight result shape for a
// configured stage, including skip reasons and depleted sanity.
func CreateFightExecutionAction(taskName string, requestedStage any, options FightExecutionOptions) FightExecutionAction {
	summary := options.Summary
	stage := ""
	if summary != nil && truthy(summary.Stage) {
		stage = stringValue(summary.Stage)
	} else {
		stage = truthyString(requestedStage)
	}
	stage = strings.TrimSpace(stage)

	times := math.Max(0, numberOrZero(summaryValue(summary, func(s *FightSummary) any { return s.Times })))
	dropCount := 0
	if summary != nil && summary.DropItems != nil {
		dropCount = len(summary.DropItems)
	}

	output := truthyString(options.Output)
	errorText := fightErrorText(options.Error)
	combined := make([]string, 0, 2)
	if output != "" {
		combined = append(combined, output)
	}
	if errorText != "" {
		combined = append(combined, errorText)
	}
	sanityDepleted := IsFightSanityDepleted(strings.Join(combined, "\n"), stage)

	drops := any("")
	if summary != nil && truthy(summary.Drops) {
		drops = summary.Drops
	}
	duration := any("")
	if summary != nil && truthy(summary.Duration) {
		duration = summary.Duration
	}

	action := FightExecutionAction{
		Task:           taskName,
		Action:         "fight",
		Stage:          stage,
		Times:          times,
		DropCount:      dropCount,
		Drops:          drops,
		Medicine:       math.Max(0, numberOrZero(summaryValue(summary, func(s *FightSummary) any { return s.Medicine }))),
		Stone:          math.Max(0, numberOrZero(summaryValue(summary, func(s *FightSummary) any { return s.Stone }))),
		Sanity:         math.Max(0, numberOrZero(summaryValue(summary, func(s *FightSummary) any { return s.Sanity }))),
		Duration:       duration,
		SanityDepleted: sanityDepleted,
	}

	if truthy(options.SkipReason) {
		action.Status = "skipped"
		action.Message = fightStageLabel(stage) + "已跳过：" + stringValue(options.SkipReason)
		return action
	}

	if errorText != "" {
		if sanityDepleted {
			action.Status = "skipped"
			action.Message = fightStageLabel(stage) + "未继续作战：理智已耗尽"
			return action
		}
		if stageNotOpenPattern.MatchString(errorText) {
			action.Status = "skipped"
			action.Message = fightStageLabel(stage) + "已跳过：关卡未开放或不存在"
			return action
		}
		if annihilationPattern.MatchString(stage) {
			action.Status = "skipped"
			action.Message = fightStageLabel(stage, "剿灭关卡") + "已跳过：奖励可能已领完或未找到入口"
			return action
		}
		firstLine := strings.SplitN(errorText, "\n", 2)[0]
		action.Status = "failed"
		action.Message = fightStageLabel(stage) + "作战失败：" + firstLine
		return action
	}

	if times == 0 && sanityDepleted {
		action.Status = "skipped"
		action.Message = fightStageLabel(stage) + "未开始作战：理智已耗尽"
		return action
	}

	if times == 0 && annihilationPattern.MatchString(stage) {
		action.Status = "skipped"
		action.Message = fightStageLabel(stage, "剿灭关卡") + "未执行作战，奖励可能已领完"
		return action
	}

	details := make([]string, 0)
	if times > 0 {
		details = append(details, fightStageLabel(stage)+" × "+stringValue(times))
	} else if stage != "" {
		details = append(details, stage)
	}
	if dropCount > 0 {
		details = append(details, "获得 "+itoa(dropCount)+" 种掉落")
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

func summaryValue(summary *FightSummary, field func(*FightSummary) any) any {
	if summary == nil {
		return nil
	}
	return field(summary)
}

// fightStageLabel mirrors `${stage || fallback}`.
func fightStageLabel(stage string, fallback ...string) string {
	if stage != "" {
		return stage
	}
	if len(fallback) > 0 {
		return fallback[0]
	}
	return "当前关卡"
}

func fightErrorText(value any) string {
	if !truthy(value) {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	if err, ok := value.(error); ok {
		return err.Error()
	}
	message := ""
	if record, ok := value.(map[string]any); ok {
		if text, ok := record["message"].(string); ok {
			message = text
		} else {
			message = stringValue(record)
		}
	} else {
		message = stringValue(value)
	}
	return message
}
