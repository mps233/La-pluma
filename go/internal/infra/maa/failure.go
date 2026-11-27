package maa

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

const maxFailureLogBytes = 512 * 1024

// maaFailure is the user-facing classification of a non-zero maa-cli exit.
type maaFailure struct {
	Message   string
	Retryable bool
	Kind      string
	Details   map[string]any
}

var operEliteFailurePattern = regexp.MustCompile(
	`(?i)parse_oper_usage\s*\|\s*Oper (.+?)\s+has higher elite requirement:\s*(\d+)\s*,\s*but elite requirement is set to\s*(\d+)`,
)

// classifyMAAFailure turns a non-zero maa-cli exit into an actionable message.
// MaaCore writes copilot config errors to its own debug log and maa-cli only
// reports "MaaCore returned an error, check its log", so the log tail is the
// only source for the concrete cause.
func classifyMAAFailure(exitCode int, stderr, logText string) maaFailure {
	if failure, ok := classifyCopilotOperFailure(logText); ok {
		return failure
	}
	if strings.Contains(logText, "CopilotConfig parse failed") {
		return maaFailure{
			Message:   "作业文件中的干员或关卡要求不合法，作业配置错误；请更换作业或反馈作业作者。",
			Retryable: false,
			Kind:      "copilot_config_invalid",
		}
	}
	lowerStderr := strings.ToLower(stderr)
	lowerLog := strings.ToLower(logText)
	// maa-cli rejects an unknown task command during argument parsing, so the
	// bare exit code is the only thing MaaCore never sees.
	if strings.Contains(lowerStderr, "unrecognized subcommand") || strings.Contains(lowerStderr, "unexpected argument") {
		return maaFailure{
			Message:   "maa-cli 不接受该任务命令，请检查任务配置或更新 maa-cli",
			Retryable: false,
			Kind:      "invalid_command",
		}
	}
	if strings.Contains(lowerStderr, "invalid params") || strings.Contains(lowerLog, "invalid params") {
		return maaFailure{
			Message:   "MAA 拒绝了任务参数，请先热更新 MAA 资源或检查作业配置",
			Retryable: false,
			Kind:      "invalid_params",
		}
	}
	if strings.Contains(lowerStderr, "network error") || strings.Contains(lowerStderr, "unexpected end of file") {
		return maaFailure{
			Message:   "MAA 检查资源更新时网络失败，请稍后重试",
			Retryable: true,
			Kind:      "network",
		}
	}
	return maaFailure{
		Message:   fmt.Sprintf("MAA 退出码 %d", exitCode),
		Retryable: true,
		Kind:      "exit_code",
	}
}

func classifyCopilotOperFailure(logText string) (maaFailure, bool) {
	matches := operEliteFailurePattern.FindAllStringSubmatch(logText, -1)
	if len(matches) == 0 {
		return maaFailure{}, false
	}
	match := matches[len(matches)-1]
	name := sanitizeLogValue(match[1], 80)
	required, _ := strconv.Atoi(match[2])
	declared, _ := strconv.Atoi(match[3])
	details := map[string]any{
		"oper":          name,
		"requiredElite": required,
		"declaredElite": declared,
	}

	cause := ""
	if entry, ok := parseFailedOperEntry(logText); ok {
		if entry.Name != "" {
			name = sanitizeLogValue(entry.Name, 80)
			details["oper"] = name
		}
		if entry.Requirements.Module != nil {
			details["module"] = *entry.Requirements.Module
		}
		if entry.Requirements.SkillLevel != nil {
			details["skillLevel"] = *entry.Requirements.SkillLevel
		}
		if entry.Skill != nil {
			details["skill"] = *entry.Skill
		}
		cause = describeOperRequirementCause(entry, declared)
	}

	message := ""
	if cause != "" {
		message = fmt.Sprintf("「%s」%s，作业配置错误；请更换作业或反馈作业作者。", name, cause)
	} else {
		message = fmt.Sprintf(
			"「%s」需要精%s，但作业只写了精%s，作业配置错误；请更换作业或反馈作业作者。",
			name,
			eliteLabel(required),
			eliteLabel(declared),
		)
	}
	return maaFailure{
		Message:   message,
		Retryable: false,
		Kind:      "copilot_oper_requirement",
		Details:   details,
	}, true
}

type failedOperEntry struct {
	Name         string `json:"name"`
	Requirements struct {
		Elite      *int `json:"elite"`
		Level      *int `json:"level"`
		Module     *int `json:"module"`
		SkillLevel *int `json:"skill_level"`
	} `json:"requirements"`
	Skill *int `json:"skill"`
}

const failedOperMarker = "parse_groups | Failed to parse oper"

// parseFailedOperEntry decodes the operator JSON MaaCore prints after a
// parse_groups failure. json.Decoder stops after the first value, so the
// following log lines do not need to be stripped.
func parseFailedOperEntry(logText string) (failedOperEntry, bool) {
	index := strings.LastIndex(logText, failedOperMarker)
	if index < 0 {
		return failedOperEntry{}, false
	}
	payload := logText[index+len(failedOperMarker):]
	if len(payload) > 16*1024 {
		payload = payload[:16*1024]
	}
	var entry failedOperEntry
	if err := json.NewDecoder(strings.NewReader(payload)).Decode(&entry); err != nil {
		return failedOperEntry{}, false
	}
	return entry, true
}

func describeOperRequirementCause(entry failedOperEntry, declared int) string {
	module := 0
	if entry.Requirements.Module != nil {
		module = *entry.Requirements.Module
	}
	skillLevel := 0
	if entry.Requirements.SkillLevel != nil {
		skillLevel = *entry.Requirements.SkillLevel
	}
	skill := 1
	if entry.Skill != nil {
		skill = *entry.Skill
	}
	switch {
	case module > 0 && declared < 2:
		return "配置了模组却只写精一（模组需要精二）"
	case skillLevel > 7 && declared < 2:
		return "技能专精要求精二，却只写精一"
	case skillLevel > 4 && declared < 1:
		return "技能等级要求精一，却只写精零"
	case skill > 2 && declared < 2:
		return "三技能要求精二，却只写精一"
	case skill == 2 && declared < 1:
		return "二技能要求精一，却只写精零"
	default:
		return ""
	}
}

func eliteLabel(value int) string {
	switch value {
	case 0:
		return "零"
	case 1:
		return "一"
	case 2:
		return "二"
	default:
		return strconv.Itoa(value)
	}
}

func sanitizeLogValue(value string, limit int) string {
	value = strings.TrimSpace(value)
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, value)
	runes := []rune(value)
	if limit > 0 && len(runes) > limit {
		value = string(runes[:limit]) + "…"
	}
	return value
}

func (r *Runner) failureLogPath() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.logPath
}

func (r *Runner) failureLogOffset() int64 {
	path := r.failureLogPath()
	if path == "" {
		return 0
	}
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

// readFailureLog returns the bytes appended to MaaCore's log after offset. It
// never returns stale errors from an earlier task, and caps the read so a long
// task cannot make it read the whole log.
func (r *Runner) readFailureLog(offset int64) string {
	path := r.failureLogPath()
	if path == "" {
		return ""
	}
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return ""
	}
	size := info.Size()
	start := offset
	if start < 0 || start > size {
		// The log rotated while the task ran; read the current file tail.
		start = 0
	}
	if size-start > maxFailureLogBytes {
		start = size - maxFailureLogBytes
	}
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return ""
	}
	data, err := io.ReadAll(io.LimitReader(file, maxFailureLogBytes))
	if err != nil {
		return ""
	}
	return string(data)
}
