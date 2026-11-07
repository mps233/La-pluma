package notifications

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

var fixedNow = time.Date(2026, time.July, 26, 12, 34, 56, 0, time.UTC)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func immediateSleep(ctx context.Context, _ time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func testPaths(t *testing.T) config.Paths {
	t.Helper()
	return config.Paths{DataDir: t.TempDir()}
}

const testBotToken = "unit-test-token"

func enabledTelegramConfig() Config {
	return Config{
		Enabled: true,
		Channels: map[string]ChannelConfig{
			"telegram": {
				"enabled":  true,
				"botToken": testBotToken,
				"chatId":   "chat-1",
			},
		},
	}
}

type recordedRequest struct {
	Method      string
	Body        []byte
	ContentType string
}

type fakeTelegram struct {
	server   *httptest.Server
	mu       sync.Mutex
	requests []recordedRequest
}

func newFakeTelegram(t *testing.T, respond func(method string, request recordedRequest) (int, string)) *fakeTelegram {
	t.Helper()
	fake := &fakeTelegram{}
	fake.server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		record := recordedRequest{
			Method:      methodFromPath(request.URL.Path),
			Body:        body,
			ContentType: request.Header.Get("Content-Type"),
		}
		fake.mu.Lock()
		fake.requests = append(fake.requests, record)
		fake.mu.Unlock()
		status, response := respond(record.Method, record)
		writer.WriteHeader(status)
		_, _ = io.WriteString(writer, response)
	}))
	t.Cleanup(fake.server.Close)
	return fake
}

func methodFromPath(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 2 {
		return ""
	}
	return parts[len(parts)-1]
}

func (f *fakeTelegram) recorded() []recordedRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	result := make([]recordedRequest, len(f.requests))
	copy(result, f.requests)
	return result
}

func (f *fakeTelegram) methods() []string {
	requests := f.recorded()
	methods := make([]string, 0, len(requests))
	for _, request := range requests {
		methods = append(methods, request.Method)
	}
	return methods
}

func telegramOKResponse(method string, _ recordedRequest) (int, string) {
	return http.StatusOK, `{"ok":true,"result":{"message_id":42}}`
}

func newTestService(t *testing.T, fake *fakeTelegram) *Service {
	t.Helper()
	service := New(Options{
		Paths:              testPaths(t),
		HTTPClient:         fake.server.Client(),
		TelegramAPIBaseURL: fake.server.URL,
		Logger:             discardLogger(),
		Now:                func() time.Time { return fixedNow },
		Sleep:              immediateSleep,
	})
	service.SetConfig(enabledTelegramConfig())
	return service
}

func TestFormatTelegramMessage(t *testing.T) {
	text := FormatTelegramMessage(
		"任务完成",
		"自动化流程已完成",
		"success",
		map[string]any{"成功": 3, "耗时": "12 秒"},
		fixedNow,
	)
	want := strings.Join([]string{
		"✅ *任务完成*",
		"",
		"自动化流程已完成",
		"",
		"📊 *详细信息*",
		"• 成功: 3",
		"• 耗时: 12 秒",
		"",
		"🕐 2026/7/26 20:34:56",
	}, "\n")
	if text != want {
		t.Fatalf("unexpected message:\n%q\nwant:\n%q", text, want)
	}
}

func TestFormatTelegramMessageFallsBackToInfo(t *testing.T) {
	text := FormatTelegramMessage("状态", "没有额外数据", "unknown", nil, fixedNow)
	if !strings.HasPrefix(text, "ℹ️ *状态*\n\n没有额外数据") {
		t.Fatalf("unexpected prefix: %q", text)
	}
	if strings.Contains(text, "详细信息") {
		t.Fatalf("unexpected detail section: %q", text)
	}
	if strings.Count(text, "🕐") != 1 {
		t.Fatalf("expected one timestamp: %q", text)
	}
}

func TestBuildTaskCompletionMessageIncludesStructuredResults(t *testing.T) {
	message := BuildTaskCompletionMessage(TaskInfo{
		TaskName:     "晚间流程",
		TotalTasks:   4,
		SuccessTasks: 3,
		SkippedTasks: 1,
		Duration:     12000,
		Actions: []TaskAction{
			{Task: "理智作战", Status: "success", Message: "作战完成：1-7 × 3；获得 2 种掉落"},
			{Task: "自动公招", Status: "success", Message: "公招处理完成：开始 1 次招募"},
			{Task: "基建换班", Status: "success", Message: "基建流程完成：已收取产物"},
			{Task: "信用收支", Status: "skipped", Message: "未启用好友访问、信用购物或信用作战，已跳过"},
		},
		Reports: []TaskReport{
			{Provider: "penguin", Status: "failed", Message: "企鹅物流汇报失败"},
		},
		Warnings: []any{"存在未识别掉落，未发送汇报"},
	})
	if message.Level != "warning" {
		t.Fatalf("level = %q, want warning", message.Level)
	}
	if message.Title != "任务完成（部分失败/跳过）" {
		t.Fatalf("title = %q", message.Title)
	}
	for _, expected := range []string{
		"执行结果",
		"作战完成：1-7 × 3",
		"公招处理完成",
		"基建流程完成",
		"信用收支",
		"掉落汇报",
		"执行提示",
	} {
		if !strings.Contains(message.Content, expected) {
			t.Fatalf("content missing %q:\n%s", expected, message.Content)
		}
	}
	if message.Data["汇报失败"] != 1 {
		t.Fatalf("unexpected data: %#v", message.Data)
	}
}

func TestBuildTaskCompletionMessageDeduplicatesStructuredFailures(t *testing.T) {
	message := BuildTaskCompletionMessage(TaskInfo{
		FailedTasks: 1,
		Actions: []TaskAction{
			{Task: "自动公招", Status: "failed", Message: "自动公招未能进入公招界面"},
		},
		Errors: []any{
			map[string]any{"task": "自动公招", "error": "自动公招未能进入公招界面"},
		},
	})
	if count := strings.Count(message.Content, "自动公招未能进入公招界面"); count != 1 {
		t.Fatalf("expected one occurrence, got %d:\n%s", count, message.Content)
	}
	if strings.Contains(message.Content, "失败任务") {
		t.Fatalf("legacy error section should be omitted:\n%s", message.Content)
	}
}

func TestBuildTaskCompletionMessagePreservesLegacyErrors(t *testing.T) {
	message := BuildTaskCompletionMessage(TaskInfo{
		FailedTasks: 1,
		Errors: []any{
			map[string]any{"task": "未知任务", "error": "连接失败"},
		},
	})
	if !strings.Contains(message.Content, "失败任务") {
		t.Fatalf("missing failure section:\n%s", message.Content)
	}
	if !strings.Contains(message.Content, "未知任务 - 连接失败") {
		t.Fatalf("missing legacy error line:\n%s", message.Content)
	}
}

func TestGetGameDay(t *testing.T) {
	cases := []struct {
		name       string
		now        time.Time
		clientType string
		date       string
		weekday    int
	}{
		{"official day", time.Date(2026, time.July, 26, 12, 34, 56, 0, time.UTC), "Official", "2026-07-26", 0},
		{"before reset", time.Date(2026, time.July, 26, 19, 59, 59, 0, time.UTC), "", "2026-07-26", 0},
		{"after reset", time.Date(2026, time.July, 26, 20, 0, 0, 0, time.UTC), "Official", "2026-07-27", 1},
		{"yostaren", time.Date(2026, time.July, 26, 15, 0, 0, 0, time.UTC), "yostaren", "2026-07-26", 0},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			day := GetGameDay(testCase.now, testCase.clientType)
			if day.Date != testCase.date || day.Weekday != testCase.weekday {
				t.Fatalf("GetGameDay() = %+v, want %s/%d", day, testCase.date, testCase.weekday)
			}
		})
	}
}

func TestGetTodayOpenStages(t *testing.T) {
	result := GetTodayOpenStages(StageOptions{Now: fixedNow, ClientType: "Official"})
	if result.Weekday != 0 || result.Date != "2026-07-26" || result.ClientType != "Official" {
		t.Fatalf("unexpected header: %+v", result)
	}
	if len(result.Open)+len(result.Closed) != 9 {
		t.Fatalf("expected 9 visible stages, got %d", len(result.Open)+len(result.Closed))
	}
	if len(result.Closed) != 1 || result.Closed[0].Stage != "PR-B" {
		t.Fatalf("unexpected closed stages: %+v", result.Closed)
	}
	for _, stage := range append(append([]StageVisibility{}, result.Open...), result.Closed...) {
		if stage.Stage == "PR-A-1" || stage.Stage == "PR-B-2" {
			t.Fatalf("hidden stage leaked: %+v", stage)
		}
	}
	allOpen := GetTodayOpenStages(StageOptions{Now: fixedNow, ClientType: "Official", ResourceCollectionOpen: true})
	if len(allOpen.Closed) != 0 || len(allOpen.Open) != 9 {
		t.Fatalf("resource collection should open every stage: %+v", allOpen)
	}
}

func TestIsStageOpenToday(t *testing.T) {
	closed := IsStageOpenToday("pr-b", StageOptions{Now: fixedNow})
	if closed.IsOpen {
		t.Fatal("PR-B should be closed on Sunday")
	}
	if closed.Reason == nil || *closed.Reason != "狙击/术师芯片今日未开放" {
		t.Fatalf("unexpected reason: %+v", closed.Reason)
	}
	if closed.StageName == nil || *closed.StageName != "狙击/术师芯片" {
		t.Fatalf("unexpected stage name: %+v", closed.StageName)
	}
	open := IsStageOpenToday("CE-6", StageOptions{Now: fixedNow})
	if !open.IsOpen || open.Reason != nil {
		t.Fatalf("CE-6 should be open: %+v", open)
	}
	unknown := IsStageOpenToday("1-7", StageOptions{Now: fixedNow})
	if !unknown.IsOpen || unknown.Reason != nil || unknown.StageName != nil {
		t.Fatalf("unknown stages default open: %+v", unknown)
	}
	forced := IsStageOpenToday("PR-B", StageOptions{Now: fixedNow, ResourceCollectionOpen: true})
	if !forced.IsOpen {
		t.Fatalf("resource collection should force PR-B open: %+v", forced)
	}
}

func TestLoadMissingConfigReturnsDefault(t *testing.T) {
	service := New(Options{Paths: testPaths(t), Logger: discardLogger()})
	config, err := service.Load()
	if err != nil {
		t.Fatal(err)
	}
	if config.Enabled {
		t.Fatal("default config should be disabled")
	}
	telegram := config.Channels["telegram"]
	if telegram == nil {
		t.Fatal("default telegram channel missing")
	}
	if telegram["enabled"] != false || telegram["botToken"] != "" || telegram["chatId"] != "" {
		t.Fatalf("unexpected telegram default: %#v", telegram)
	}
	if _, err := os.Stat(service.ConfigPath()); !os.IsNotExist(err) {
		t.Fatalf("Load should not create the file: %v", err)
	}
}

func TestSaveAndLoadConfig(t *testing.T) {
	service := New(Options{Paths: testPaths(t), Logger: discardLogger()})
	saved := enabledTelegramConfig()
	saved.Channels["telegram"]["allowedUserIds"] = []any{"42"}
	if err := service.Save(saved); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(service.ConfigPath())
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatalf("persisted JSON is invalid: %v", err)
	}
	if document["enabled"] != true {
		t.Fatalf("unexpected document: %#v", document)
	}
	channels, ok := document["channels"].(map[string]any)
	if !ok {
		t.Fatalf("channels must be an object: %#v", document["channels"])
	}
	telegram, ok := channels["telegram"].(map[string]any)
	if !ok || telegram["botToken"] != testBotToken || telegram["chatId"] != "chat-1" {
		t.Fatalf("unexpected telegram object: %#v", channels["telegram"])
	}

	reloaded := New(Options{Paths: service.paths, Logger: discardLogger()})
	config, err := reloaded.Load()
	if err != nil {
		t.Fatal(err)
	}
	if !config.Enabled || config.Channels["telegram"]["botToken"] != testBotToken {
		t.Fatalf("unexpected reloaded config: %#v", config)
	}
}

func TestLoadConfigDefaultsMissingChannels(t *testing.T) {
	service := New(Options{Paths: testPaths(t), Logger: discardLogger()})
	if err := os.MkdirAll(filepath.Dir(service.ConfigPath()), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(service.ConfigPath(), []byte(`{"enabled":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	config, err := service.Load()
	if err != nil {
		t.Fatal(err)
	}
	if !config.Enabled || config.Channels["telegram"] == nil {
		t.Fatalf("missing channels should merge the default: %#v", config)
	}
}

func TestLoadConfigRejectsMalformedJSON(t *testing.T) {
	service := New(Options{Paths: testPaths(t), Logger: discardLogger()})
	if err := os.MkdirAll(filepath.Dir(service.ConfigPath()), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(service.ConfigPath(), []byte(`{not json`), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := service.Load()
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != "AGENT_NOTIFICATION_CONFIG_LOAD_FAILED" || appErr.StatusCode != http.StatusInternalServerError {
		t.Fatalf("unexpected error: %#v (%v)", appErr, err)
	}
}

func TestValidateRejectsInvalidConfig(t *testing.T) {
	service := New(Options{Paths: testPaths(t), Logger: discardLogger()})
	cases := []Config{
		{Enabled: true, Channels: nil},
		{Enabled: true, Channels: map[string]ChannelConfig{"telegram": {"enabled": "yes"}}},
		{Enabled: true, Channels: map[string]ChannelConfig{"telegram": {"botToken": 42}}},
		{Enabled: true, Channels: map[string]ChannelConfig{"telegram": {"chatId": true}}},
		{Enabled: true, Channels: map[string]ChannelConfig{"telegram": {"allowedUserIds": "42"}}},
	}
	for index, config := range cases {
		err := service.Validate(config)
		appErr, ok := apperrors.As(err)
		if !ok || appErr.Code != "AGENT_NOTIFICATION_CONFIG_INVALID" || appErr.StatusCode != http.StatusBadRequest {
			t.Fatalf("case %d: unexpected error: %#v (%v)", index, appErr, err)
		}
	}
	if err := service.Validate(enabledTelegramConfig()); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
}

func TestSaveReportsPersistenceFailure(t *testing.T) {
	parent := t.TempDir()
	dataDir := filepath.Join(parent, "data-file")
	if err := os.WriteFile(dataDir, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := New(Options{Paths: config.Paths{DataDir: dataDir}, Logger: discardLogger()})
	err := service.Save(enabledTelegramConfig())
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != "AGENT_NOTIFICATION_CONFIG_SAVE_FAILED" || appErr.StatusCode != http.StatusInternalServerError || !appErr.Retryable {
		t.Fatalf("unexpected error: %#v (%v)", appErr, err)
	}
}

func TestShouldCaptureScreenshot(t *testing.T) {
	service := New(Options{Paths: testPaths(t), Logger: discardLogger()})
	service.SetConfig(Config{
		Enabled: false,
		Channels: map[string]ChannelConfig{"telegram": {
			"enabled": true, "botToken": "token", "chatId": "chat",
		}},
	})
	if service.ShouldCaptureScreenshot() {
		t.Fatal("disabled notifications must not capture screenshots")
	}
	service.SetConfig(Config{
		Enabled: true,
		Channels: map[string]ChannelConfig{"telegram": {
			"enabled": true, "botToken": "", "chatId": "chat",
		}},
	})
	if service.ShouldCaptureScreenshot() {
		t.Fatal("incomplete Telegram channel must not capture screenshots")
	}
	service.SetConfig(Config{
		Enabled: true,
		Channels: map[string]ChannelConfig{"telegram": {
			"enabled": true, "botToken": "token", "chatId": "chat",
		}},
	})
	if !service.ShouldCaptureScreenshot() {
		t.Fatal("configured Telegram channel should capture screenshots")
	}
}

func TestSendDisabled(t *testing.T) {
	service := New(Options{Paths: testPaths(t), Logger: discardLogger()})
	result := service.Send(context.Background(), Message{Title: "t", Content: "c"})
	if !result.Success || result.Message != "通知功能未启用" || result.Results != nil || result.Errors != nil {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestSendResultJSONShape(t *testing.T) {
	disabled, err := json.Marshal(SendResult{Success: true, Message: "通知功能未启用"})
	if err != nil {
		t.Fatal(err)
	}
	if string(disabled) != `{"success":true,"message":"通知功能未启用"}` {
		t.Fatalf("unexpected disabled shape: %s", disabled)
	}
	results := make([]ChannelResult, 0)
	failures := make([]ChannelError, 0)
	enabled, err := json.Marshal(SendResult{
		Success: true,
		Message: "通知已发送到 0 个渠道",
		Results: &results,
		Errors:  &failures,
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"success":true,"message":"通知已发送到 0 个渠道","results":[],"errors":[]}`
	if string(enabled) != want {
		t.Fatalf("unexpected enabled shape: %s", enabled)
	}
}

func TestSendToAllTelegram(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	service := newTestService(t, fake)

	result := service.Send(context.Background(), Message{
		Title:   "状态",
		Content: "没有额外数据",
		Level:   "info",
	})
	if !result.Success {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.Message != "通知已发送到 1 个渠道" {
		t.Fatalf("message = %q", result.Message)
	}
	if result.Results == nil || len(*result.Results) != 1 || (*result.Results)[0].Channel != "telegram" {
		t.Fatalf("unexpected results: %#v", result.Results)
	}
	if result.Errors == nil || len(*result.Errors) != 0 {
		t.Fatalf("unexpected errors: %#v", result.Errors)
	}

	requests := fake.recorded()
	if len(requests) != 1 || requests[0].Method != "sendMessage" {
		t.Fatalf("unexpected requests: %#v", requests)
	}
	var payload struct {
		ChatID    string `json:"chat_id"`
		Text      string `json:"text"`
		ParseMode string `json:"parse_mode"`
	}
	if err := json.Unmarshal(requests[0].Body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ChatID != "chat-1" || payload.ParseMode != "Markdown" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	want := FormatTelegramMessage("状态", "没有额外数据", "info", nil, fixedNow)
	if payload.Text != want {
		t.Fatalf("text = %q, want %q", payload.Text, want)
	}
}

func TestSendToChannel(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	service := newTestService(t, fake)
	response, err := service.SendToChannel(context.Background(), "telegram", Message{Title: "t", Content: "c"})
	if err != nil {
		t.Fatal(err)
	}
	if response["ok"] != true {
		t.Fatalf("unexpected response: %#v", response)
	}

	_, err = service.SendToChannel(context.Background(), "unknown", Message{})
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != "AGENT_NOTIFICATION_CHANNEL_UNKNOWN" || appErr.StatusCode != http.StatusBadRequest {
		t.Fatalf("unexpected unknown-channel error: %#v", appErr)
	}

	service.SetConfig(Config{Enabled: true, Channels: map[string]ChannelConfig{
		"telegram": {"enabled": false, "botToken": "token", "chatId": "chat"},
	}})
	_, err = service.SendToChannel(context.Background(), "telegram", Message{})
	appErr, ok = apperrors.As(err)
	if !ok || appErr.Code != "AGENT_NOTIFICATION_CHANNEL_DISABLED" || !strings.Contains(appErr.Message, "未启用") {
		t.Fatalf("unexpected disabled-channel error: %#v", appErr)
	}
}

func TestTestChannel(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	service := newTestService(t, fake)

	result, err := service.TestChannel(context.Background(), "telegram", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Message != "测试消息已发送" {
		t.Fatalf("unexpected result: %+v", result)
	}
	recorded := fake.recorded()
	if len(recorded) != 1 {
		t.Fatalf("expected one request, got %d", len(recorded))
	}
	var payload struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(recorded[0].Body, &payload); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(payload.Text, "测试通知") || !strings.Contains(payload.Text, "La Pluma 通知系统测试成功！") {
		t.Fatalf("unexpected test text: %q", payload.Text)
	}

	_, err = service.TestChannel(context.Background(), "", nil)
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != "AGENT_VALIDATION_CHANNEL_REQUIRED" || appErr.StatusCode != http.StatusBadRequest {
		t.Fatalf("unexpected missing-channel error: %#v", appErr)
	}

	service.SetConfig(Config{Enabled: true, Channels: map[string]ChannelConfig{}})
	_, err = service.TestChannel(context.Background(), "telegram", nil)
	appErr, ok = apperrors.As(err)
	if !ok || appErr.Code != "AGENT_NOTIFICATION_CHANNEL_NOT_CONFIGURED" {
		t.Fatalf("unexpected unconfigured error: %#v", appErr)
	}

	override := ChannelConfig{"enabled": false, "botToken": "", "chatId": "chat"}
	result, err = service.TestChannel(context.Background(), "telegram", override)
	if err != nil {
		t.Fatal(err)
	}
	if result.Success || result.Message != "Telegram 配置不完整" {
		t.Fatalf("unexpected incomplete result: %+v", result)
	}
}

func TestTelegramAPIFailureIsReported(t *testing.T) {
	fake := newFakeTelegram(t, func(string, recordedRequest) (int, string) {
		return http.StatusBadRequest, `{"ok":false,"description":"chat not found"}`
	})
	service := newTestService(t, fake)
	result := service.Send(context.Background(), Message{Title: "t", Content: "c"})
	if result.Success {
		t.Fatalf("expected failure: %+v", result)
	}
	if result.Message != "部分渠道发送失败: telegram" {
		t.Fatalf("message = %q", result.Message)
	}
	if result.Errors == nil || len(*result.Errors) != 1 {
		t.Fatalf("unexpected errors: %#v", result.Errors)
	}
	if (*result.Errors)[0].Error != "Telegram 发送失败: chat not found" {
		t.Fatalf("error = %q", (*result.Errors)[0].Error)
	}
}

func TestTelegramSendPhoto(t *testing.T) {
	image := []byte("fake-png-bytes")
	fake := newFakeTelegram(t, telegramOKResponse)
	service := newTestService(t, fake)

	result := service.Send(context.Background(), Message{
		Title:   "截图",
		Content: "当前屏幕",
		Image:   base64.StdEncoding.EncodeToString(image),
	})
	if !result.Success {
		t.Fatalf("unexpected result: %+v", result)
	}
	requests := fake.recorded()
	if len(requests) != 1 || requests[0].Method != "sendPhoto" {
		t.Fatalf("unexpected requests: %#v", requests)
	}
	form := parseMultipart(t, requests[0])
	if got := form.Value["chat_id"]; len(got) != 1 || got[0] != "chat-1" {
		t.Fatalf("unexpected chat_id: %#v", got)
	}
	if got := form.Value["parse_mode"]; len(got) != 1 || got[0] != "Markdown" {
		t.Fatalf("unexpected parse_mode: %#v", got)
	}
	caption := form.Value["caption"]
	if len(caption) != 1 || !strings.Contains(caption[0], "*截图*") || !strings.Contains(caption[0], "当前屏幕") {
		t.Fatalf("unexpected caption: %#v", caption)
	}
	files := form.File["photo"]
	if len(files) != 1 || files[0].Filename != "screenshot.png" {
		t.Fatalf("unexpected photo part: %#v", files)
	}
	handle, err := files[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	data, _ := io.ReadAll(handle)
	if !bytes.Equal(data, image) {
		t.Fatalf("photo bytes = %q, want %q", data, image)
	}
}

func parseMultipart(t *testing.T, request recordedRequest) *multipart.Form {
	t.Helper()
	_, parameters, err := mime.ParseMediaType(request.ContentType)
	if err != nil {
		t.Fatal(err)
	}
	reader := multipart.NewReader(bytes.NewReader(request.Body), parameters["boundary"])
	form, err := reader.ReadForm(4 << 20)
	if err != nil {
		t.Fatal(err)
	}
	return form
}

func TestTelegramPhotoRetriesThenSucceeds(t *testing.T) {
	attempts := 0
	fake := newFakeTelegram(t, func(method string, _ recordedRequest) (int, string) {
		if method != "sendPhoto" {
			t.Fatalf("unexpected method %q", method)
		}
		attempts++
		if attempts < 3 {
			return http.StatusBadRequest, `{"ok":false,"description":"temporary"}`
		}
		return http.StatusOK, `{"ok":true,"result":{"message_id":7}}`
	})
	var sleeps []time.Duration
	service := New(Options{
		Paths:              testPaths(t),
		HTTPClient:         fake.server.Client(),
		TelegramAPIBaseURL: fake.server.URL,
		Logger:             discardLogger(),
		Now:                func() time.Time { return fixedNow },
		Sleep: func(_ context.Context, duration time.Duration) error {
			sleeps = append(sleeps, duration)
			return nil
		},
	})
	service.SetConfig(enabledTelegramConfig())

	image := base64.StdEncoding.EncodeToString([]byte("image"))
	result := service.Send(context.Background(), Message{Title: "t", Content: "c", Image: image})
	if !result.Success {
		t.Fatalf("unexpected result: %+v", result)
	}
	if attempts != 3 {
		t.Fatalf("attempts = %d, want 3", attempts)
	}
	if len(sleeps) != 2 || sleeps[0] != 2*time.Second || sleeps[1] != 4*time.Second {
		t.Fatalf("unexpected retry waits: %#v", sleeps)
	}
}

func TestTelegramPhotoFallsBackToText(t *testing.T) {
	photoAttempts := 0
	fake := newFakeTelegram(t, func(method string, _ recordedRequest) (int, string) {
		switch method {
		case "sendPhoto":
			photoAttempts++
			return http.StatusBadRequest, `{"ok":false,"description":"photo denied"}`
		case "sendMessage":
			return http.StatusOK, `{"ok":true,"result":{"message_id":8}}`
		default:
			t.Fatalf("unexpected method %q", method)
			return http.StatusInternalServerError, ""
		}
	})
	service := newTestService(t, fake)
	result := service.Send(context.Background(), Message{
		Title:   "t",
		Content: "c",
		Image:   base64.StdEncoding.EncodeToString([]byte("image")),
	})
	if !result.Success {
		t.Fatalf("expected fallback success: %+v", result)
	}
	if photoAttempts != 3 {
		t.Fatalf("photo attempts = %d, want 3", photoAttempts)
	}
	methods := fake.methods()
	if len(methods) != 4 || methods[3] != "sendMessage" {
		t.Fatalf("unexpected methods: %#v", methods)
	}
}

func TestTelegramPhotoAndTextFailure(t *testing.T) {
	fake := newFakeTelegram(t, func(method string, _ recordedRequest) (int, string) {
		return http.StatusBadRequest, `{"ok":false,"description":"denied"}`
	})
	service := newTestService(t, fake)
	result := service.Send(context.Background(), Message{
		Title:   "t",
		Content: "c",
		Image:   base64.StdEncoding.EncodeToString([]byte("image")),
	})
	if result.Success {
		t.Fatalf("expected failure: %+v", result)
	}
	if result.Errors == nil || len(*result.Errors) != 1 {
		t.Fatalf("unexpected errors: %#v", result.Errors)
	}
	if (*result.Errors)[0].Error != "发送图片和文本消息都失败: Telegram 发送图片失败: denied" {
		t.Fatalf("error = %q", (*result.Errors)[0].Error)
	}
}

func TestTelegramOversizePhotoFallsBackToText(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	service := newTestService(t, fake)
	oversize := make([]byte, 10*1024*1024+1)
	result := service.Send(context.Background(), Message{
		Title:   "t",
		Content: "c",
		Image:   base64.StdEncoding.EncodeToString(oversize),
	})
	if !result.Success {
		t.Fatalf("unexpected result: %+v", result)
	}
	methods := fake.methods()
	if len(methods) != 1 || methods[0] != "sendMessage" {
		t.Fatalf("unexpected methods: %#v", methods)
	}
}
