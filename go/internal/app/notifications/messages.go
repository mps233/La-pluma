package notifications

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

// Message is a channel-agnostic notification payload. The JSON tags match the
// existing Agent API request/response fields.
type Message struct {
	Title   string         `json:"title"`
	Content string         `json:"content"`
	Level   string         `json:"level,omitempty"`
	Data    map[string]any `json:"data,omitempty"`
	Image   string         `json:"image,omitempty"`
}

// NotificationMessage mirrors the Node type name.
type NotificationMessage = Message

// SendResult mirrors the Node sendToAll result. Results and Errors are
// pointers so the disabled-notification response can omit both arrays while a
// normal send still serializes empty arrays, matching JSON.stringify output.
type SendResult struct {
	Success bool             `json:"success"`
	Message string           `json:"message"`
	Results *[]ChannelResult `json:"results,omitempty"`
	Errors  *[]ChannelError  `json:"errors,omitempty"`
}

// ChannelResult records one successful channel delivery.
type ChannelResult struct {
	Channel string `json:"channel"`
	Success bool   `json:"success"`
}

// ChannelError records one failed channel delivery.
type ChannelError struct {
	Channel string `json:"channel"`
	Error   string `json:"error"`
}

// TestResult mirrors the Node channel test response.
type TestResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// TaskAction is one structured task execution result.
type TaskAction struct {
	Task    string `json:"task,omitempty"`
	Status  string `json:"status,omitempty"`
	Message string `json:"message,omitempty"`
}

// TaskReport is one drop-reporting provider result.
type TaskReport struct {
	Status   string `json:"status,omitempty"`
	Provider string `json:"provider,omitempty"`
	Message  string `json:"message,omitempty"`
}

// TaskRecruit is one recruitment summary row.
type TaskRecruit struct {
	Tags  string `json:"tags,omitempty"`
	Stars any    `json:"stars,omitempty"`
}

// TaskSummary is one per-task summary row. Times, Duration, Medicine and
// Stone stay untyped because the Node payload accepts string or number.
type TaskSummary struct {
	Task     string        `json:"task,omitempty"`
	Stage    string        `json:"stage,omitempty"`
	Times    any           `json:"times,omitempty"`
	Duration any           `json:"duration,omitempty"`
	Medicine any           `json:"medicine,omitempty"`
	Stone    any           `json:"stone,omitempty"`
	Drops    string        `json:"drops,omitempty"`
	Recruits []TaskRecruit `json:"recruits,omitempty"`
	Infrast  string        `json:"infrast,omitempty"`
}

// TaskInfo is the scheduler-facing task completion payload.
type TaskInfo struct {
	TaskName     string
	TotalTasks   int
	SuccessTasks int
	FailedTasks  int
	SkippedTasks int
	// Duration is milliseconds, matching the Node scheduler payload.
	Duration   float64
	Errors     []any
	Skipped    []any
	Summaries  []TaskSummary
	Actions    []TaskAction
	Reports    []TaskReport
	Warnings   []any
	Screenshot *string
}

var levelEmojis = map[string]string{
	"info":    "ℹ️",
	"success": "✅",
	"warning": "⚠️",
	"error":   "❌",
}

// FormatTelegramMessage formats a Telegram Markdown message exactly like
// formatTelegramMessage in notificationService.ts. Data entries are emitted in
// sorted key order for deterministic Go output.
func FormatTelegramMessage(title, content, level string, data map[string]any, now time.Time) string {
	if now.IsZero() {
		now = time.Now()
	}
	emoji, ok := levelEmojis[level]
	if !ok {
		emoji = levelEmojis["info"]
	}
	text := emoji + " *" + title + "*\n\n" + content
	if data != nil {
		text += "\n\n📊 *详细信息*"
		keys := make([]string, 0, len(data))
		for key := range data {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			text += "\n• " + key + ": " + jsString(data[key])
		}
	}
	return text + "\n\n🕐 " + formatTelegramTime(now)
}

// BuildTaskCompletionMessage ports buildTaskCompletionMessage. It never fails:
// malformed legacy entries are rendered as faithfully as the Node formatter.
func BuildTaskCompletionMessage(info TaskInfo) Message {
	taskName := info.TaskName
	if taskName == "" {
		taskName = "自动化任务"
	}
	actions := info.Actions
	reports := info.Reports
	warnings := info.Warnings
	skipped := info.Skipped
	errorsList := info.Errors
	summaries := info.Summaries

	hasStructuredFailure := false
	for _, action := range actions {
		if action.Status == "failed" {
			hasStructuredFailure = true
			break
		}
	}
	if !hasStructuredFailure {
		for _, report := range reports {
			if report.Status == "failed" {
				hasStructuredFailure = true
				break
			}
		}
	}
	hasStructuredSkip := false
	for _, action := range actions {
		if action.Status == "skipped" {
			hasStructuredSkip = true
			break
		}
	}

	hasFailure := info.FailedTasks > 0 || hasStructuredFailure
	hasSkip := info.SkippedTasks > 0 || hasStructuredSkip

	level := "success"
	title := "任务完成"
	switch {
	case hasFailure && hasSkip:
		level = "warning"
		title = "任务完成（部分失败/跳过）"
	case hasFailure:
		level = "warning"
		title = "任务完成（部分失败）"
	case hasSkip:
		level = "info"
		title = "任务完成（部分跳过）"
	}

	var content strings.Builder
	content.WriteString("*" + taskName + "* 执行完成")

	if len(actions) > 0 {
		statusIcons := map[string]string{"success": "✅", "skipped": "⏭️", "failed": "❌"}
		content.WriteString("\n\n🔎 *执行结果*")
		for _, action := range actions {
			icon, ok := statusIcons[action.Status]
			if !ok {
				icon = "•"
			}
			taskLabel := ""
			if action.Task != "" {
				taskLabel = action.Task + ": "
			}
			message := action.Message
			if message == "" {
				message = "状态未知"
			}
			content.WriteString("\n" + icon + " " + taskLabel + message)
		}
	}

	if len(reports) > 0 {
		providerLabels := map[string]string{"penguin": "企鹅物流", "yituliu": "一图流"}
		content.WriteString("\n\n📡 *掉落汇报*")
		for _, report := range reports {
			icon := "❌"
			if report.Status == "success" {
				icon = "✅"
			}
			provider := providerLabels[report.Provider]
			if provider == "" {
				provider = report.Provider
			}
			if provider == "" {
				provider = "未知平台"
			}
			message := report.Message
			if message == "" {
				message = "状态未知"
			}
			content.WriteString("\n" + icon + " " + provider + ": " + message)
		}
	}

	if len(warnings) > 0 {
		content.WriteString("\n\n⚠️ *执行提示*")
		for _, warning := range warnings {
			content.WriteString("\n• " + jsString(warning))
		}
	}

	if len(summaries) > 0 {
		content.WriteString("\n\n📋 *任务总结*")
		for _, summary := range summaries {
			content.WriteString("\n\n*" + summary.Task + "*")
			if summary.Stage != "" {
				content.WriteString("\n• 关卡: " + summary.Stage)
				if truthy(summary.Times) {
					content.WriteString("\n• 次数: " + jsString(summary.Times))
				}
				if truthy(summary.Duration) {
					content.WriteString("\n• 耗时: " + jsString(summary.Duration))
				}
				if truthy(summary.Medicine) && stringValue(summary.Medicine) != "0" {
					content.WriteString("\n• 理智药: " + jsString(summary.Medicine))
				}
				if truthy(summary.Stone) && stringValue(summary.Stone) != "0" {
					content.WriteString("\n• 源石: " + jsString(summary.Stone))
				}
				if summary.Drops != "" {
					content.WriteString("\n• 掉落: " + summary.Drops)
				}
			}
			if summary.Recruits != nil {
				content.WriteString("\n• 公招结果:")
				for _, recruit := range summary.Recruits {
					content.WriteString("\n  - [" + recruit.Tags + "] → " + jsString(recruit.Stars) + "⭐")
				}
			}
			if summary.Infrast != "" {
				content.WriteString("\n• " + summary.Infrast)
			}
		}
	}

	representedTasks := make(map[string]bool, len(actions))
	for _, action := range actions {
		if action.Task != "" {
			representedTasks[action.Task] = true
		}
	}

	remainingSkipped := make([]any, 0, len(skipped))
	for _, item := range skipped {
		task, hasTask := itemTask(item)
		if !hasTask || task == "" || !representedTasks[task] {
			remainingSkipped = append(remainingSkipped, item)
		}
	}
	if len(remainingSkipped) > 0 {
		content.WriteString("\n\n⏭️ *跳过任务*")
		for _, item := range remainingSkipped {
			if text, ok := item.(string); ok {
				content.WriteString("\n• " + text)
				continue
			}
			record, ok := asRecord(item)
			if !ok {
				continue
			}
			taskText := ""
			if truthy(record["task"]) {
				taskText = jsString(record["task"])
			}
			line := "\n• " + taskText
			if truthy(record["reason"]) {
				line += " - " + jsString(record["reason"])
			}
			content.WriteString(line)
		}
	}

	remainingErrors := make([]any, 0, len(errorsList))
	for _, item := range errorsList {
		task, hasTask := itemTask(item)
		if !hasTask || task == "" || !representedTasks[task] {
			remainingErrors = append(remainingErrors, item)
		}
	}
	if len(remainingErrors) > 0 {
		content.WriteString("\n\n❌ *失败任务*")
		for _, item := range remainingErrors {
			record, ok := asRecord(item)
			if ok && truthy(record["task"]) {
				line := "\n• " + jsString(record["task"])
				if truthy(record["error"]) {
					line += " - " + jsString(record["error"])
				}
				content.WriteString(line)
				continue
			}
			content.WriteString("\n• " + jsString(item))
		}
	}

	data := map[string]any{
		"总任务数": info.TotalTasks,
		"成功":   info.SuccessTasks,
	}
	if info.SkippedTasks > 0 {
		data["跳过"] = info.SkippedTasks
	}
	if info.FailedTasks > 0 {
		data["失败"] = info.FailedTasks
	}
	failedReports := 0
	for _, report := range reports {
		if report.Status == "failed" {
			failedReports++
		}
	}
	if failedReports > 0 {
		data["汇报失败"] = failedReports
	}
	data["耗时"] = fmt.Sprintf("%d 秒", int64(math.Floor(info.Duration/1000)))

	message := Message{
		Title:   title,
		Content: content.String(),
		Level:   level,
		Data:    data,
	}
	if info.Screenshot != nil {
		message.Image = *info.Screenshot
	}
	return message
}
