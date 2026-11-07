package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
)

const defaultCopilotAPIBaseURL = "https://prts.maa.plus"

// TaskStatus is the handler-provided MAA task state.
type TaskStatus struct {
	IsRunning bool
	TaskName  string
	// StartTime is Unix milliseconds; nil means the task never recorded one.
	StartTime *int64
}

// StopResult is the handler-provided stop outcome.
type StopResult struct {
	Success bool
	Message string
}

// ScheduleStatus is the handler-provided task-flow state.
type ScheduleStatus struct {
	IsRunning   bool
	ScheduleID  string
	CurrentTask string
	CurrentStep int
	TotalSteps  int
	// StartTime is Unix milliseconds; nil means the flow never recorded one.
	StartTime *int64
}

// TaskRequest is the MAA-side execution requested by a bot command.
type TaskRequest struct {
	Command  string
	Args     []string
	TaskName string
	TaskType string
}

// CommandHandler is the bot's only hook into task execution. It keeps this
// package free of app/MAA imports and lets callers inject a scheduler or a
// test double.
type CommandHandler interface {
	TaskStatus(ctx context.Context) TaskStatus
	StopTask(ctx context.Context) StopResult
	ExecuteTask(ctx context.Context, request TaskRequest) error
	CaptureScreenshot(ctx context.Context) (string, error)
	ScheduleStatus(ctx context.Context) ScheduleStatus
	RunFlow(ctx context.Context, flowType string, tasks []map[string]any) error
}

// BotConfig mirrors the telegram channel config plus the connection values the
// Node bot received from runtime initialization.
type BotConfig struct {
	Enabled        bool   `json:"enabled"`
	BotToken       string `json:"botToken"`
	ChatID         string `json:"chatId"`
	AllowedUserIDs []any  `json:"allowedUserIds,omitempty"`
	ADBPath        string `json:"adbPath,omitempty"`
	ADBAddress     string `json:"adbAddress,omitempty"`
}

// BotConfigFromChannel converts the persisted telegram channel object.
func BotConfigFromChannel(channel ChannelConfig) BotConfig {
	config := BotConfig{}
	if channel == nil {
		return config
	}
	config.Enabled = truthy(channel["enabled"])
	if value, ok := channel["botToken"]; ok && value != nil {
		config.BotToken = stringValue(value)
	}
	if value, ok := channel["chatId"]; ok && value != nil {
		config.ChatID = stringValue(value)
	}
	switch ids := channel["allowedUserIds"].(type) {
	case []any:
		config.AllowedUserIDs = append([]any(nil), ids...)
	case []string:
		config.AllowedUserIDs = make([]any, 0, len(ids))
		for _, id := range ids {
			config.AllowedUserIDs = append(config.AllowedUserIDs, id)
		}
	}
	return config
}

// BotOptions configures the Telegram bot. Tests replace the HTTP clients, API
// base URLs and sleep hook so no real network or timer is used.
type BotOptions struct {
	Paths              config.Paths
	Config             BotConfig
	Handler            CommandHandler
	HTTPClient         *http.Client
	TelegramAPIBaseURL string
	CopilotAPIBaseURL  string
	Logger             *slog.Logger
	Sleep              func(ctx context.Context, duration time.Duration) error
	Now                func() time.Time
}

// Bot runs Telegram getUpdates long polling and dispatches commands.
type Bot struct {
	mu sync.Mutex

	config  BotConfig
	handler CommandHandler
	paths   config.Paths
	logger  *slog.Logger
	sleep   func(ctx context.Context, duration time.Duration) error
	now     func() time.Time

	telegram *telegramClient
	copilot  string
	http     *http.Client

	polling      bool
	cancel       context.CancelFunc
	done         chan struct{}
	lastUpdateID int64
	inflight     sync.WaitGroup
}

// NewBot builds a bot. A nil handler answers idle status and rejects
// screenshot requests.
func NewBot(options BotOptions) *Bot {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	handler := options.Handler
	if handler == nil {
		handler = noopCommandHandler{}
	}
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	telegramBase := strings.TrimSpace(options.TelegramAPIBaseURL)
	if telegramBase == "" {
		telegramBase = defaultTelegramAPIBaseURL
	}
	copilotBase := strings.TrimSpace(options.CopilotAPIBaseURL)
	if copilotBase == "" {
		copilotBase = defaultCopilotAPIBaseURL
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	sleep := options.Sleep
	if sleep == nil {
		sleep = contextSleep
	}
	config := options.Config
	config.ADBPath, config.ADBAddress = withConnectionDefaults(config.ADBPath, config.ADBAddress)
	return &Bot{
		config:   config,
		handler:  handler,
		paths:    options.Paths,
		logger:   logger,
		sleep:    sleep,
		now:      now,
		telegram: newTelegramClient(httpClient, telegramBase),
		copilot:  strings.TrimRight(copilotBase, "/"),
		http:     httpClient,
	}
}

func withConnectionDefaults(adbPath, adbAddress string) (string, string) {
	if strings.TrimSpace(adbPath) == "" {
		adbPath = strings.TrimSpace(os.Getenv("ADB_PATH"))
		if adbPath == "" {
			adbPath = "/opt/homebrew/bin/adb"
		}
	}
	if strings.TrimSpace(adbAddress) == "" {
		adbAddress = strings.TrimSpace(os.Getenv("ADB_ADDRESS"))
		if adbAddress == "" {
			adbAddress = "127.0.0.1:16384"
		}
	}
	return adbPath, adbAddress
}

// Config returns a copy of the current bot config.
func (b *Bot) Config() BotConfig {
	b.mu.Lock()
	defer b.mu.Unlock()
	config := b.config
	config.AllowedUserIDs = append([]any(nil), b.config.AllowedUserIDs...)
	return config
}

// Running reports whether the poll loop is active.
func (b *Bot) Running() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.polling
}

// Init applies config and starts polling when it is complete and enabled.
// Incomplete configs are ignored, matching initTelegramBot.
func (b *Bot) Init(ctx context.Context, botConfig BotConfig) error {
	if botConfig.BotToken == "" || botConfig.ChatID == "" {
		b.logger.Debug("配置不完整，跳过初始化")
		return nil
	}
	b.mu.Lock()
	if botConfig.AllowedUserIDs == nil {
		botConfig.AllowedUserIDs = append([]any(nil), b.config.AllowedUserIDs...)
	}
	if botConfig.ADBPath == "" {
		botConfig.ADBPath = b.config.ADBPath
	}
	if botConfig.ADBAddress == "" {
		botConfig.ADBAddress = b.config.ADBAddress
	}
	botConfig.ADBPath, botConfig.ADBAddress = withConnectionDefaults(botConfig.ADBPath, botConfig.ADBAddress)
	b.config = botConfig
	enabled := botConfig.Enabled
	b.mu.Unlock()
	if !enabled {
		return nil
	}
	return b.Start(ctx)
}

// Start launches the polling loop. It is a no-op when already polling or when
// the token/chat pair is missing.
func (b *Bot) Start(ctx context.Context) error {
	b.mu.Lock()
	if b.polling {
		b.mu.Unlock()
		return nil
	}
	if !b.config.Enabled || b.config.BotToken == "" || b.config.ChatID == "" {
		b.mu.Unlock()
		return nil
	}
	pollContext, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	b.polling = true
	b.cancel = cancel
	b.done = done
	b.mu.Unlock()

	go func() {
		defer close(done)
		b.pollLoop(pollContext)
	}()
	return nil
}

// Stop cancels polling and waits for the poll loop and every in-flight command
// handler. Callers should pass a bounded context to avoid waiting forever on a
// handler that ignores cancellation.
func (b *Bot) Stop(ctx context.Context) error {
	b.mu.Lock()
	cancel := b.cancel
	done := b.done
	b.cancel = nil
	b.done = nil
	b.polling = false
	b.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if done != nil {
		select {
		case <-done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	handlerDone := make(chan struct{})
	go func() {
		b.inflight.Wait()
		close(handlerDone)
	}()
	select {
	case <-handlerDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (b *Bot) pollLoop(ctx context.Context) {
	b.setupBotCommands(ctx)
	for {
		if ctx.Err() != nil {
			return
		}
		updates, err := b.getUpdates(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			if !strings.Contains(errMessage(err), "Conflict: terminated by other getUpdates") {
				b.logger.Error("轮询错误", "error", errMessage(err))
			}
			if b.sleep(ctx, 5*time.Second) != nil {
				return
			}
			continue
		}
		for _, update := range updates {
			if ctx.Err() != nil {
				return
			}
			current := update
			b.inflight.Add(1)
			go func() {
				defer b.inflight.Done()
				b.handleUpdate(ctx, current)
			}()
			b.setLastUpdateID(current.UpdateID + 1)
		}
		if b.sleep(ctx, 2*time.Second) != nil {
			return
		}
	}
}

func (b *Bot) lastUpdate() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.lastUpdateID
}

func (b *Bot) setLastUpdateID(value int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.lastUpdateID = value
}

// TelegramUpdate is one getUpdates result.
type TelegramUpdate struct {
	UpdateID int64                  `json:"update_id"`
	Message  *TelegramUpdateMessage `json:"message"`
}

// TelegramUpdateMessage is the message subset the bot handles.
type TelegramUpdateMessage struct {
	Text string        `json:"text"`
	Chat TelegramChat  `json:"chat"`
	From *TelegramUser `json:"from"`
}

// TelegramChat and TelegramUser preserve numeric or string IDs.
type TelegramChat struct {
	ID any `json:"id"`
}

type TelegramUser struct {
	ID    any  `json:"id"`
	IsBot bool `json:"is_bot"`
}

func (b *Bot) getUpdates(ctx context.Context) ([]TelegramUpdate, error) {
	botConfig := b.Config()
	if botConfig.BotToken == "" {
		return nil, errors.New("Telegram token 未配置")
	}
	response, err := b.telegram.call(ctx, botConfig.BotToken, "getUpdates", map[string]any{
		"offset":          b.lastUpdate(),
		"timeout":         30,
		"allowed_updates": []string{"message"},
	})
	if err != nil {
		return nil, err
	}
	if !telegramOK(response) {
		description := telegramDescription(response)
		if description == "" {
			description = "Failed to get updates"
		}
		return nil, errors.New(description)
	}
	raw, ok := response["result"]
	if !ok || raw == nil {
		return nil, nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("Telegram updates 格式无效: %w", err)
	}
	var updates []TelegramUpdate
	if err := json.Unmarshal(data, &updates); err != nil {
		return nil, fmt.Errorf("Telegram updates 格式无效: %w", err)
	}
	return updates, nil
}

// handleUpdate validates the sender, maps keywords and dispatches commands.
func (b *Bot) handleUpdate(ctx context.Context, update TelegramUpdate) {
	message := update.Message
	if message == nil || message.Text == "" {
		return
	}
	sender := message.From
	if sender == nil || sender.IsBot {
		return
	}
	chatID := formatID(message.Chat.ID)
	userID := formatID(sender.ID)
	botConfig := b.Config()

	authorized := false
	if len(botConfig.AllowedUserIDs) > 0 {
		for _, allowed := range botConfig.AllowedUserIDs {
			if formatID(allowed) == userID {
				authorized = true
				break
			}
		}
	} else {
		authorized = chatID == botConfig.ChatID || userID == botConfig.ChatID
	}
	if !authorized {
		b.logger.Warn("拒绝未授权的请求", "chatId", chatID, "userId", userID, "configuredId", botConfig.ChatID)
		return
	}

	text := strings.TrimSpace(message.Text)
	if isCopilotURI(text) {
		b.logger.Debug("检测到作业 URI", "uri", text)
		b.handleCommand(ctx, chatID, "copilot", []string{text})
		return
	}
	if command, ok := commandKeywords[text]; ok {
		b.logger.Debug("检测到关键词", "keyword", text, "command", command)
		b.handleCommand(ctx, chatID, command, nil)
		return
	}

	words := strings.Split(text, " ")
	firstWord := words[0]
	restWords := words[1:]

	switch {
	case (firstWord == "刷" || firstWord == "刷关卡" || firstWord == "fight") && len(restWords) > 0:
		b.handleCommand(ctx, chatID, "fight", restWords)
		return
	case (firstWord == "肉鸽" || firstWord == "刷肉鸽" || firstWord == "roguelike") && len(restWords) > 0:
		b.handleCommand(ctx, chatID, "roguelike", restWords)
		return
	case (firstWord == "启动" || firstWord == "启动游戏" || firstWord == "开启" || firstWord == "打开" ||
		firstWord == "开启游戏" || firstWord == "打开游戏" || firstWord == "startup") && len(restWords) > 0:
		b.handleCommand(ctx, chatID, "startup", restWords)
		return
	case (firstWord == "关闭" || firstWord == "关闭游戏" || firstWord == "closedown") && len(restWords) > 0:
		b.handleCommand(ctx, chatID, "closedown", restWords)
		return
	case (firstWord == "运行" || firstWord == "运行流程" || firstWord == "执行流程" ||
		firstWord == "run" || firstWord == "flow") && len(restWords) > 0:
		b.handleCommand(ctx, chatID, "run", restWords)
		return
	}

	if !strings.HasPrefix(text, "/") {
		return
	}
	parts := strings.Split(text, " ")
	command := strings.Replace(parts[0], "/", "", 1)
	args := parts[1:]
	b.logger.Info("收到命令", "command", command, "args", strings.Join(args, " "))
	b.handleCommand(ctx, chatID, command, args)
}

var commandKeywords = map[string]string{
	"截图":         "screenshot",
	"截屏":         "screenshot",
	"screenshot": "screenshot",
	"帮助":         "help",
	"命令":         "help",
	"help":       "help",
	"状态":         "status",
	"status":     "status",
	"停止":         "stop",
	"停止任务":       "stop",
	"stop":       "stop",
	"启动游戏":       "startup",
	"开启游戏":       "startup",
	"打开游戏":       "startup",
	"关闭游戏":       "closedown",
	"肉鸽":         "roguelike",
	"运行":         "run",
	"运行流程":       "run",
	"执行流程":       "run",
	"日常":         "run",
}

func (b *Bot) sendMessage(ctx context.Context, chatID, text string) map[string]any {
	botConfig := b.Config()
	if botConfig.BotToken == "" {
		b.logger.Error("发送消息失败", "error", "Telegram token 未配置")
		return nil
	}
	response, err := b.telegram.call(ctx, botConfig.BotToken, "sendMessage", map[string]any{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "Markdown",
	})
	if err != nil {
		b.logger.Error("发送消息错误", "error", errMessage(err))
		return nil
	}
	if !telegramOK(response) {
		b.logger.Error("发送消息失败", "description", telegramDescription(response))
	}
	return response
}

func (b *Bot) editMessage(ctx context.Context, chatID string, messageID int64, text string) map[string]any {
	botConfig := b.Config()
	if botConfig.BotToken == "" {
		return nil
	}
	response, err := b.telegram.call(ctx, botConfig.BotToken, "editMessageText", map[string]any{
		"chat_id":    chatID,
		"message_id": messageID,
		"text":       text,
		"parse_mode": "Markdown",
	})
	if err != nil {
		b.logger.Error("编辑消息错误", "error", errMessage(err))
		return nil
	}
	if !telegramOK(response) {
		if !strings.Contains(telegramDescription(response), "message is not modified") {
			b.logger.Error("编辑消息失败", "description", telegramDescription(response))
		}
	}
	return response
}

func (b *Bot) sendPhoto(ctx context.Context, chatID, caption, imageBase64 string) error {
	botConfig := b.Config()
	if botConfig.BotToken == "" {
		return errors.New("Telegram token 未配置")
	}
	image, err := decodeImageBase64(imageBase64)
	if err != nil {
		return err
	}
	response, err := b.telegram.callMultipart(ctx, botConfig.BotToken, "sendPhoto", [][2]string{
		{"chat_id", chatID},
		{"caption", caption},
	}, multipartFile{field: "photo", filename: "screenshot.png", contentType: "image/png", data: image})
	if err != nil {
		b.logger.Error("发送图片错误", "error", errMessage(err))
		return err
	}
	if !telegramOK(response) {
		description := telegramDescription(response)
		if description == "" {
			description = "发送图片失败"
		}
		b.logger.Error("发送图片失败", "description", description)
		return errors.New(description)
	}
	return nil
}

func (b *Bot) setupBotCommands(ctx context.Context) {
	botConfig := b.Config()
	if botConfig.BotToken == "" {
		return
	}
	if _, err := b.telegram.call(ctx, botConfig.BotToken, "deleteMyCommands", map[string]any{}); err != nil {
		b.logger.Error("删除旧命令失败", "error", errMessage(err))
	} else {
		b.logger.Debug("已删除旧命令")
	}
	commands := make([]map[string]string, 0, len(botCommands))
	for _, command := range botCommands {
		commands = append(commands, map[string]string{
			"command":     command.command,
			"description": command.description,
		})
	}
	response, err := b.telegram.call(ctx, botConfig.BotToken, "setMyCommands", map[string]any{"commands": commands})
	if err != nil {
		b.logger.Error("设置命令菜单错误", "error", errMessage(err))
		return
	}
	if !telegramOK(response) {
		b.logger.Error("命令菜单设置失败", "description", telegramDescription(response))
		return
	}
	b.logger.Debug("命令菜单设置成功")
}

type noopCommandHandler struct{}

func (noopCommandHandler) TaskStatus(context.Context) TaskStatus { return TaskStatus{} }

func (noopCommandHandler) StopTask(context.Context) StopResult { return StopResult{} }

func (noopCommandHandler) ExecuteTask(context.Context, TaskRequest) error {
	return errors.New("任务执行未配置")
}

func (noopCommandHandler) CaptureScreenshot(context.Context) (string, error) {
	return "", errors.New("截图功能未配置")
}

func (noopCommandHandler) ScheduleStatus(context.Context) ScheduleStatus {
	return ScheduleStatus{}
}

func (noopCommandHandler) RunFlow(context.Context, string, []map[string]any) error { return nil }

// flowConfigPath is the persisted task-flow location.
func (b *Bot) flowConfigPath(flowType string) string {
	return filepath.Join(b.paths.DataDir, "user-configs", flowType+"-tasks.json")
}
