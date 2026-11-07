package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// handleCommand executes one dispatched command. A nil response means the
// command already sent its own messages (screenshot and task flows).
func (b *Bot) handleCommand(ctx context.Context, chatID, command string, args []string) {
	switch command {
	case "startup", "fight", "copilot", "roguelike":
		status := b.handler.TaskStatus(ctx)
		if status.IsRunning {
			b.logger.Info("检测到新任务命令，停止当前任务", "currentTask", status.TaskName, "newCommand", command)
			stopResult := b.handler.StopTask(ctx)
			if stopResult.Success {
				b.sendMessage(ctx, chatID, "⏹️ 已强制停止当前任务: "+status.TaskName+"\n\n✅ 开始执行新任务...")
				if b.sleep(ctx, 2*time.Second) != nil {
					return
				}
			} else {
				message := stopResult.Message
				b.sendMessage(ctx, chatID, "⚠️ "+message+"\n\n继续执行新任务...")
				if b.sleep(ctx, 1*time.Second) != nil {
					return
				}
			}
		}
	}

	var response *string
	switch command {
	case "start":
		text := helpMessage()
		response = &text
	case "help":
		text := helpMessage()
		response = &text
	case "status":
		text := b.getStatus(ctx)
		response = &text
	case "startup":
		clientType := firstArg(args, 0, defaultClientType())
		text, err := b.executeStartup(ctx, clientType)
		response = commandResponse(text, err)
	case "closedown":
		clientType := firstArg(args, 0, defaultClientType())
		text, err := b.executeClosedown(ctx, clientType)
		response = commandResponse(text, err)
	case "screenshot":
		b.executeScreenshot(ctx, chatID)
		return
	case "setcommands":
		b.setupBotCommands(ctx)
		text := "✅ 命令菜单已更新\n\n请重新打开聊天窗口查看新菜单"
		response = &text
	case "fight":
		if len(args) == 0 {
			text := "❌ 请指定关卡，例如：/fight 1-7"
			response = &text
		} else {
			text, err := b.executeFight(ctx, args[0])
			response = commandResponse(text, err)
		}
	case "roguelike":
		theme := firstArg(args, 0, "Sami")
		text, err := b.executeRoguelike(ctx, theme)
		response = commandResponse(text, err)
	case "copilot":
		if len(args) == 0 {
			text := "❌ 请指定作业 URI，例如：/copilot prts://12345"
			response = &text
		} else {
			text, err := b.executeCopilot(ctx, args[0])
			response = commandResponse(text, err)
		}
	case "schedule":
		text := "❌ 暂不支持通过 Bot 执行定时任务\n\n请使用以下命令：\n/fight <关卡> - 执行理智作战\n/roguelike [主题] - 执行肉鸽任务"
		response = &text
	case "stop":
		text, err := b.executeStop(ctx)
		response = commandResponse(text, err)
	case "run", "flow":
		flowType := firstArg(args, 0, "automation")
		text, err := b.executeTaskFlow(ctx, flowType)
		if err != nil {
			response = commandResponse("", err)
		} else {
			response = text
		}
	default:
		text := "❌ 未知命令: " + command + "\n\n使用 /help 查看可用命令"
		response = &text
	}
	if response != nil {
		b.sendMessage(ctx, chatID, *response)
	}
}

func commandResponse(text string, err error) *string {
	if err != nil {
		message := "❌ 执行失败: " + errMessage(err)
		return &message
	}
	return &text
}

func firstArg(args []string, index int, fallback string) string {
	if index >= 0 && index < len(args) && args[index] != "" {
		return args[index]
	}
	return fallback
}

// defaultClientType mirrors DEFAULT_CLIENT_TYPE in connectionDefaults.ts.
func defaultClientType() string {
	if value := strings.TrimSpace(os.Getenv("MAA_CLIENT_TYPE")); value != "" {
		return value
	}
	return "Official"
}

func (b *Bot) executeStartup(ctx context.Context, clientType string) (string, error) {
	if err := b.handler.ExecuteTask(ctx, TaskRequest{
		Command:  "startup",
		Args:     []string{clientType},
		TaskName: "启动游戏",
		TaskType: "startup",
	}); err != nil {
		return "", fmt.Errorf("启动失败: %s", errMessage(err))
	}
	return "✅ 已开始启动游戏\n📱 客户端：" + clientType + "\n\n游戏启动需要约 15-30 秒\n请稍后再执行其他任务", nil
}

func (b *Bot) executeClosedown(ctx context.Context, clientType string) (string, error) {
	if err := b.handler.ExecuteTask(ctx, TaskRequest{
		Command:  "closedown",
		Args:     []string{clientType},
		TaskName: "关闭游戏",
		TaskType: "closedown",
	}); err != nil {
		return "", fmt.Errorf("关闭失败: %s", errMessage(err))
	}
	return "✅ 已关闭游戏\n📱 客户端：" + clientType, nil
}

func (b *Bot) executeScreenshot(ctx context.Context, chatID string) {
	b.sendMessage(ctx, chatID, "📸 正在截图...")
	image, err := b.handler.CaptureScreenshot(ctx)
	if err != nil {
		b.sendMessage(ctx, chatID, "❌ 截图失败: "+errMessage(err)+"\n\n请检查 ADB 连接是否正常")
		return
	}
	if image == "" {
		b.sendMessage(ctx, chatID, "❌ 截图失败：未获取到图片数据")
		return
	}
	if err := b.sendPhoto(ctx, chatID, "📸 当前屏幕截图", image); err != nil {
		b.sendMessage(ctx, chatID, "❌ 截图失败: "+errMessage(err)+"\n\n请检查 ADB 连接是否正常")
	}
}

func (b *Bot) executeFight(ctx context.Context, stage string) (string, error) {
	if err := b.handler.ExecuteTask(ctx, TaskRequest{
		Command:  "fight",
		Args:     []string{stage},
		TaskName: "刷关卡 " + stage,
		TaskType: "combat",
	}); err != nil {
		return "", fmt.Errorf("执行失败: %s", errMessage(err))
	}
	return "✅ 已开始执行理智作战\n📍 关卡：" + stage + "\n\n任务完成后会自动发送通知", nil
}

func (b *Bot) executeRoguelike(ctx context.Context, theme string) (string, error) {
	if err := b.handler.ExecuteTask(ctx, TaskRequest{
		Command:  "roguelike",
		Args:     []string{theme},
		TaskName: "肉鸽 " + theme,
		TaskType: "roguelike",
	}); err != nil {
		return "", fmt.Errorf("执行失败: %s", errMessage(err))
	}
	return "✅ 已开始执行肉鸽任务\n🎯 主题：" + theme + "\n\n任务完成后会自动发送通知", nil
}

func (b *Bot) executeCopilot(ctx context.Context, uri string) (string, error) {
	stageInfo := b.getStageInfoFromCopilot(ctx, uri)
	displayName := "对应关卡"
	if stageInfo != nil && stageInfo.DisplayName != "" {
		displayName = stageInfo.DisplayName
	}
	configuredChatID := b.Config().ChatID
	b.sendMessage(ctx, configuredChatID, "✅ 准备执行抄作业\n📋 作业 URI："+uri+"\n📍 关卡："+displayName+
		"\n\n⚠️ 请在 15 秒内手动进入关卡界面\n\n倒计时开始...")

	b.inflight.Add(1)
	go func() {
		defer b.inflight.Done()
		b.runCopilotCountdown(ctx, uri, configuredChatID)
	}()
	return "✅ 倒计时已开始\n\n任务完成后会自动发送通知", nil
}

func (b *Bot) runCopilotCountdown(ctx context.Context, uri, chatID string) {
	for remaining := 15; remaining > 0; remaining-- {
		if b.sleep(ctx, time.Second) != nil {
			return
		}
		if remaining == 10 || remaining == 5 || remaining == 3 || remaining == 1 {
			b.sendMessage(ctx, chatID, fmt.Sprintf("⏰ %d 秒...", remaining))
		}
	}
	b.sendMessage(ctx, chatID, "🚀 开始执行作业！")
	err := b.handler.ExecuteTask(ctx, TaskRequest{
		Command:  "copilot",
		Args:     []string{uri, "--formation"},
		TaskName: "抄作业 " + uri,
		TaskType: "copilot",
	})
	if err != nil {
		b.sendMessage(ctx, chatID, "❌ 作业执行失败: "+errMessage(err))
	}
}

func (b *Bot) executeStop(ctx context.Context) (string, error) {
	result := b.handler.StopTask(ctx)
	if result.Success {
		return "⏹️ 已发送停止信号\n\n当前任务将在完成当前步骤后停止", nil
	}
	message := result.Message
	if message == "" {
		message = "当前没有正在运行的任务"
	}
	return "ℹ️ " + message, nil
}

var flowNames = map[string]string{
	"automation": "日常流程",
	"combat":     "作战流程",
	"roguelike":  "肉鸽流程",
}

func (b *Bot) executeTaskFlow(ctx context.Context, flowType string) (*string, error) {
	flowName, valid := flowNames[flowType]
	if !valid {
		text := "❌ 无效的流程类型: " + flowType +
			"\n\n支持的流程类型：\n• automation - 日常流程\n• combat - 作战流程\n• roguelike - 肉鸽流程"
		return &text, nil
	}
	tasks, err := b.loadTaskFlow(flowType)
	if err != nil {
		return nil, err
	}
	if len(tasks) == 0 {
		text := "❌ " + flowName + "未配置任何任务\n\n请先在 WebUI 中配置任务流程"
		return &text, nil
	}
	enabled := 0
	for _, task := range tasks {
		if truthy(task["enabled"]) {
			enabled++
		}
	}
	chatID := b.Config().ChatID
	initial := b.sendMessage(ctx, chatID, fmt.Sprintf("✅ 已开始执行%s\n\n📊 准备执行 %d 个任务...", flowName, enabled))
	messageID := messageIDFromResponse(initial)

	if messageID != 0 {
		b.inflight.Add(1)
		go func() {
			defer b.inflight.Done()
			b.watchFlow(ctx, chatID, messageID, flowName)
		}()
	}
	b.inflight.Add(1)
	go func() {
		defer b.inflight.Done()
		if err := b.handler.RunFlow(ctx, flowType, tasks); err != nil {
			b.logger.Error("任务流程执行失败", "error", errMessage(err))
			if messageID != 0 {
				b.editMessage(ctx, chatID, messageID, "❌ "+flowName+"执行失败\n\n错误: "+errMessage(err))
			}
		}
	}()
	return nil, nil
}

func (b *Bot) loadTaskFlow(flowType string) ([]map[string]any, error) {
	path := b.flowConfigPath(flowType)
	b.logger.Debug("读取配置文件", "configPath", path)
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var payload struct {
		TaskFlow []map[string]any `json:"taskFlow"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		return nil, err
	}
	return payload.TaskFlow, nil
}

func (b *Bot) watchFlow(ctx context.Context, chatID string, messageID int64, flowName string) {
	for {
		if b.sleep(ctx, 3*time.Second) != nil {
			return
		}
		status := b.handler.ScheduleStatus(ctx)
		if !status.IsRunning {
			b.editMessage(ctx, chatID, messageID, "✅ "+flowName+"执行完成\n\n任务已全部完成\n详细结果请查看通知消息")
			return
		}
		duration := durationSeconds(b.now(), status.StartTime)
		minutes := duration / 60
		seconds := duration % 60
		timeText := fmt.Sprintf("%d秒", seconds)
		if minutes > 0 {
			timeText = fmt.Sprintf("%d分%d秒", minutes, seconds)
		}
		currentTask := status.CurrentTask
		if currentTask == "" {
			currentTask = "准备中..."
		}
		b.editMessage(ctx, chatID, messageID, fmt.Sprintf(
			"🔄 正在执行%s\n\n📍 当前任务: %s\n📊 进度: %d/%d\n⏱️ 运行时间: %s\n\n请稍候...",
			flowName,
			currentTask,
			status.CurrentStep+1,
			status.TotalSteps,
			timeText,
		))
	}
}

func (b *Bot) getStatus(ctx context.Context) string {
	scheduleStatus := b.handler.ScheduleStatus(ctx)
	taskStatus := b.handler.TaskStatus(ctx)
	var builder strings.Builder
	builder.WriteString("📊 系统状态\n\n✅ Bot 运行中\n")
	switch {
	case scheduleStatus.IsRunning:
		builder.WriteString("🎮 正在执行任务流程\n")
		scheduleID := scheduleStatus.ScheduleID
		if scheduleID == "" {
			scheduleID = "未知"
		}
		currentTask := scheduleStatus.CurrentTask
		if currentTask == "" {
			currentTask = "未知"
		}
		builder.WriteString("📝 流程: " + scheduleID + "\n")
		builder.WriteString("📍 当前任务: " + currentTask + "\n")
		builder.WriteString(fmt.Sprintf("📊 进度: %d/%d\n", scheduleStatus.CurrentStep+1, scheduleStatus.TotalSteps))
		builder.WriteString(fmt.Sprintf("⏱️ 运行时间: %d 秒\n", durationSeconds(b.now(), scheduleStatus.StartTime)))
	case taskStatus.IsRunning:
		taskName := taskStatus.TaskName
		if taskName == "" {
			taskName = "未知"
		}
		builder.WriteString("🎮 正在执行任务\n")
		builder.WriteString("📝 当前任务: " + taskName + "\n")
		builder.WriteString(fmt.Sprintf("⏱️ 运行时间: %d 秒\n", durationSeconds(b.now(), taskStatus.StartTime)))
	default:
		builder.WriteString("⏰ 等待命令...\n")
	}
	builder.WriteString("\n使用 /help 查看可用命令")
	return builder.String()
}

func durationSeconds(now time.Time, startTime *int64) int64 {
	startMillis := now.UnixMilli()
	if startTime != nil {
		startMillis = *startTime
	}
	return int64(math.Floor(float64(now.UnixMilli()-startMillis) / 1000))
}

func messageIDFromResponse(response map[string]any) int64 {
	if response == nil {
		return 0
	}
	result, ok := response["result"].(map[string]any)
	if !ok {
		return 0
	}
	return int64FromAny(result["message_id"])
}

func int64FromAny(value any) int64 {
	switch typed := value.(type) {
	case json.Number:
		number, err := typed.Int64()
		if err == nil {
			return number
		}
		asFloat, err := typed.Float64()
		if err == nil {
			return int64(asFloat)
		}
	case float64:
		return int64(typed)
	case int:
		return int64(typed)
	case int64:
		return typed
	case string:
		number, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		if err == nil {
			return number
		}
	}
	return 0
}

// CopilotStageInfo is the copilot metadata used for the navigation prompt.
type CopilotStageInfo struct {
	StageName   string
	DisplayName string
}

var (
	copilotURIPattern   = regexp.MustCompile(`(?i)^(?:maa|prts)://`)
	copilotCodePatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)^s([0-9]+)$`),
		regexp.MustCompile(`^([0-9]+)s$`),
		regexp.MustCompile(`^([0-9]+)$`),
	}
	stageTitlePatterns = []*regexp.Regexp{
		regexp.MustCompile(`^([A-Z]{1,3}-[A-Z]{1,3}-[0-9]+)`),
		regexp.MustCompile(`^([0-9]+-[0-9]+)`),
		regexp.MustCompile(`^([A-Z]{1,3}-[0-9]+)`),
		regexp.MustCompile(`[【\[]([A-Z]{1,3}-[A-Z]{1,3}-[0-9]+)[】\]]`),
		regexp.MustCompile(`[【\[]([0-9]+-[0-9]+)[】\]]`),
		regexp.MustCompile(`([A-Z]{1,3}-[A-Z]{1,3}-[0-9]+)`),
		regexp.MustCompile(`([0-9]+-[0-9]+)`),
	}
)

// stageNameMap mirrors the Node fallback for copilot payloads whose title has
// no recognizable stage code.
var stageNameMap = map[string]string{
	"act40side_ex08": "OR-EX-8",
	"act40side_ex07": "OR-EX-7",
	"act40side_ex06": "OR-EX-6",
	"act40side_ex05": "OR-EX-5",
	"act40side_ex04": "OR-EX-4",
	"act40side_ex03": "OR-EX-3",
	"act40side_ex02": "OR-EX-2",
	"act40side_ex01": "OR-EX-1",
}

func isCopilotURI(value string) bool {
	return copilotURIPattern.MatchString(strings.TrimSpace(value))
}

func stripCopilotScheme(value string) string {
	return copilotURIPattern.ReplaceAllString(strings.TrimSpace(value), "")
}

func extractCopilotCode(value string) string {
	raw := stripCopilotScheme(value)
	for _, pattern := range copilotCodePatterns {
		if match := pattern.FindStringSubmatch(raw); match != nil {
			return match[1]
		}
	}
	return raw
}

func matchStageTitle(title string) string {
	for _, pattern := range stageTitlePatterns {
		if match := pattern.FindStringSubmatch(title); match != nil {
			return match[1]
		}
	}
	return ""
}

func (b *Bot) getStageInfoFromCopilot(ctx context.Context, uri string) *CopilotStageInfo {
	trimmed := strings.TrimSpace(uri)
	if isCopilotURI(trimmed) {
		code := extractCopilotCode(trimmed)
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, b.copilot+"/copilot/get/"+code, nil)
		if err != nil {
			b.logger.Error("Copilot 获取关卡信息失败", "error", errMessage(err))
			return nil
		}
		response, err := b.http.Do(request)
		if err != nil {
			b.logger.Error("Copilot 获取关卡信息失败", "error", safeTransportError(err))
			return nil
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			b.logger.Error("Copilot API 请求失败", "status", response.Status)
			return nil
		}
		body, err := io.ReadAll(response.Body)
		if err != nil {
			b.logger.Error("Copilot 获取关卡信息失败", "error", safeTransportError(err))
			return nil
		}
		var payload struct {
			Data *struct {
				Content string `json:"content"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			b.logger.Error("Copilot 获取关卡信息失败", "error", errMessage(err))
			return nil
		}
		if payload.Data == nil || payload.Data.Content == "" {
			return nil
		}
		var content struct {
			Doc *struct {
				Title string `json:"title"`
			} `json:"doc"`
			StageName string `json:"stage_name"`
		}
		if err := json.Unmarshal([]byte(payload.Data.Content), &content); err != nil {
			b.logger.Error("Copilot 获取关卡信息失败", "error", errMessage(err))
			return nil
		}
		title := ""
		if content.Doc != nil {
			title = content.Doc.Title
		}
		b.logger.Debug("Copilot 作业标题", "title", title)
		displayName := matchStageTitle(title)
		if displayName == "" && content.StageName != "" {
			displayName = stageNameMap[content.StageName]
		}
		b.logger.Debug("Copilot 关卡信息", "displayName", displayName, "stageName", content.StageName)
		return &CopilotStageInfo{StageName: content.StageName, DisplayName: displayName}
	}
	if strings.HasSuffix(trimmed, ".json") {
		content, err := os.ReadFile(trimmed)
		if err != nil {
			b.logger.Error("Copilot 获取关卡信息失败", "error", errMessage(err))
			return nil
		}
		var payload struct {
			StageName string `json:"stage_name"`
		}
		if err := json.Unmarshal(content, &payload); err != nil {
			b.logger.Error("Copilot 获取关卡信息失败", "error", errMessage(err))
			return nil
		}
		return &CopilotStageInfo{StageName: payload.StageName}
	}
	return nil
}
