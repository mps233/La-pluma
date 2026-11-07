package notifications

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
)

type flowRequest struct {
	flowType string
	tasks    []map[string]any
}

type fakeCommandHandler struct {
	mu sync.Mutex

	status        TaskStatus
	stop          StopResult
	executeErr    error
	executed      []TaskRequest
	screenshot    string
	screenshotErr error
	schedule      ScheduleStatus
	flows         []flowRequest
	runFlowErr    error

	executedCh chan TaskRequest
	flowCh     chan flowRequest
}

func newFakeCommandHandler() *fakeCommandHandler {
	return &fakeCommandHandler{
		executedCh: make(chan TaskRequest, 32),
		flowCh:     make(chan flowRequest, 8),
	}
}

func (h *fakeCommandHandler) TaskStatus(context.Context) TaskStatus {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.status
}

func (h *fakeCommandHandler) StopTask(context.Context) StopResult {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.stop
}

func (h *fakeCommandHandler) ExecuteTask(_ context.Context, request TaskRequest) error {
	h.mu.Lock()
	h.executed = append(h.executed, request)
	err := h.executeErr
	h.mu.Unlock()
	h.executedCh <- request
	return err
}

func (h *fakeCommandHandler) CaptureScreenshot(context.Context) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.screenshot, h.screenshotErr
}

func (h *fakeCommandHandler) ScheduleStatus(context.Context) ScheduleStatus {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.schedule
}

func (h *fakeCommandHandler) RunFlow(_ context.Context, flowType string, tasks []map[string]any) error {
	h.mu.Lock()
	h.flows = append(h.flows, flowRequest{flowType: flowType, tasks: tasks})
	err := h.runFlowErr
	h.mu.Unlock()
	h.flowCh <- flowRequest{flowType: flowType, tasks: tasks}
	return err
}

func (h *fakeCommandHandler) setSchedule(status ScheduleStatus) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.schedule = status
}

func (h *fakeCommandHandler) requests() []TaskRequest {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]TaskRequest(nil), h.executed...)
}

func testBotConfig() BotConfig {
	return BotConfig{
		Enabled:  true,
		BotToken: testBotToken,
		ChatID:   "42",
	}
}

func newTestBot(
	t *testing.T,
	telegram *fakeTelegram,
	copilotURL string,
	handler CommandHandler,
	sleep func(context.Context, time.Duration) error,
) *Bot {
	t.Helper()
	if sleep == nil {
		sleep = immediateSleep
	}
	return NewBot(BotOptions{
		Paths:              config.Paths{DataDir: t.TempDir()},
		Config:             testBotConfig(),
		Handler:            handler,
		HTTPClient:         telegram.server.Client(),
		TelegramAPIBaseURL: telegram.server.URL,
		CopilotAPIBaseURL:  copilotURL,
		Logger:             discardLogger(),
		Sleep:              sleep,
		Now:                func() time.Time { return fixedNow },
	})
}

func textUpdate(text string, chatID, userID any) TelegramUpdate {
	return TelegramUpdate{
		UpdateID: 1,
		Message: &TelegramUpdateMessage{
			Text: text,
			Chat: TelegramChat{ID: chatID},
			From: &TelegramUser{ID: userID},
		},
	}
}

func lastMessageText(t *testing.T, fake *fakeTelegram) string {
	t.Helper()
	requests := fake.recorded()
	if len(requests) == 0 {
		t.Fatal("no Telegram request recorded")
	}
	last := requests[len(requests)-1]
	if last.Method != "sendMessage" {
		t.Fatalf("last method = %q, want sendMessage", last.Method)
	}
	var payload struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(last.Body, &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Text
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for condition")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestBotHelpCommand(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	bot := newTestBot(t, fake, "", newFakeCommandHandler(), nil)

	bot.handleUpdate(context.Background(), textUpdate("/help", "42", "42"))

	if text := lastMessageText(t, fake); text != helpMessage() {
		t.Fatalf("unexpected help text: %q", text)
	}
}

func TestBotUnauthorizedSenderIsIgnored(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	bot := newTestBot(t, fake, "", newFakeCommandHandler(), nil)

	bot.handleUpdate(context.Background(), textUpdate("/help", "99", "7"))
	if requests := fake.recorded(); len(requests) != 0 {
		t.Fatalf("unauthorized sender should not receive a reply: %#v", requests)
	}
}

func TestBotAuthorizationUsesAllowedUserIDs(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	bot := newTestBot(t, fake, "", newFakeCommandHandler(), nil)
	bot.config.AllowedUserIDs = []any{float64(7)}

	bot.handleUpdate(context.Background(), textUpdate("/help", "99", float64(7)))
	if text := lastMessageText(t, fake); text != helpMessage() {
		t.Fatalf("allowed user should be authorized: %q", text)
	}
}

func TestBotIgnoresBotSendersAndEmptyMessages(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	bot := newTestBot(t, fake, "", newFakeCommandHandler(), nil)

	update := textUpdate("/help", "42", "42")
	update.Message.From.IsBot = true
	bot.handleUpdate(context.Background(), update)
	bot.handleUpdate(context.Background(), TelegramUpdate{UpdateID: 2, Message: &TelegramUpdateMessage{Text: ""}})
	bot.handleUpdate(context.Background(), TelegramUpdate{UpdateID: 3})

	if requests := fake.recorded(); len(requests) != 0 {
		t.Fatalf("unexpected replies: %#v", requests)
	}
}

func TestBotKeywordFightDispatchesTask(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	handler := newFakeCommandHandler()
	bot := newTestBot(t, fake, "", handler, nil)

	bot.handleUpdate(context.Background(), textUpdate("刷 1-7", "42", "42"))

	requests := handler.requests()
	if len(requests) != 1 {
		t.Fatalf("expected one task, got %#v", requests)
	}
	request := requests[0]
	if request.Command != "fight" || request.TaskName != "刷关卡 1-7" || request.TaskType != "combat" {
		t.Fatalf("unexpected task request: %+v", request)
	}
	if len(request.Args) != 1 || request.Args[0] != "1-7" {
		t.Fatalf("unexpected args: %#v", request.Args)
	}
	text := lastMessageText(t, fake)
	if !strings.Contains(text, "已开始执行理智作战") || !strings.Contains(text, "关卡：1-7") {
		t.Fatalf("unexpected response: %q", text)
	}
}

func TestBotStopsRunningTaskBeforeNewTask(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	handler := newFakeCommandHandler()
	handler.status = TaskStatus{IsRunning: true, TaskName: "理智作战"}
	handler.stop = StopResult{Success: true}
	var sleeps []time.Duration
	bot := newTestBot(t, fake, "", handler, func(ctx context.Context, duration time.Duration) error {
		sleeps = append(sleeps, duration)
		return nil
	})

	bot.handleUpdate(context.Background(), textUpdate("/fight 1-7", "42", "42"))

	requests := fake.recorded()
	if len(requests) != 2 {
		t.Fatalf("expected stop notice and start notice, got %d", len(requests))
	}
	var stopText string
	if err := json.Unmarshal(requests[0].Body, &struct {
		Text *string `json:"text"`
	}{Text: &stopText}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stopText, "已强制停止当前任务: 理智作战") {
		t.Fatalf("unexpected stop notice: %q", stopText)
	}
	if len(sleeps) != 1 || sleeps[0] != 2*time.Second {
		t.Fatalf("unexpected sleeps: %#v", sleeps)
	}
}

func TestBotStatusPrefersSchedule(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	handler := newFakeCommandHandler()
	start := fixedNow.Add(-65 * time.Second).UnixMilli()
	handler.status = TaskStatus{IsRunning: true, TaskName: "理智作战", StartTime: &start}
	handler.schedule = ScheduleStatus{
		IsRunning:   true,
		ScheduleID:  "default",
		CurrentTask: "基建换班",
		CurrentStep: 1,
		TotalSteps:  4,
		StartTime:   &start,
	}
	bot := newTestBot(t, fake, "", handler, nil)

	bot.handleUpdate(context.Background(), textUpdate("状态", "42", "42"))

	text := lastMessageText(t, fake)
	for _, expected := range []string{"正在执行任务流程", "流程: default", "当前任务: 基建换班", "进度: 2/4", "运行时间: 65 秒"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("status missing %q:\n%s", expected, text)
		}
	}
	if strings.Contains(text, "理智作战") {
		t.Fatalf("schedule status should take precedence:\n%s", text)
	}
}

func TestBotStatusFallsBackToWaiting(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	bot := newTestBot(t, fake, "", newFakeCommandHandler(), nil)
	bot.handleUpdate(context.Background(), textUpdate("/status", "42", "42"))
	text := lastMessageText(t, fake)
	if !strings.Contains(text, "⏰ 等待命令...") || !strings.Contains(text, "使用 /help 查看可用命令") {
		t.Fatalf("unexpected status: %q", text)
	}
}

func TestBotStopCommand(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	handler := newFakeCommandHandler()
	handler.stop = StopResult{Success: true}
	bot := newTestBot(t, fake, "", handler, nil)

	bot.handleUpdate(context.Background(), textUpdate("/stop", "42", "42"))
	if text := lastMessageText(t, fake); !strings.Contains(text, "已发送停止信号") {
		t.Fatalf("unexpected stop response: %q", text)
	}

	handler.stop = StopResult{Success: false}
	bot.handleUpdate(context.Background(), textUpdate("停止", "42", "42"))
	if text := lastMessageText(t, fake); text != "ℹ️ 当前没有正在运行的任务" {
		t.Fatalf("unexpected idle stop response: %q", text)
	}
}

func TestBotUnknownCommand(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	bot := newTestBot(t, fake, "", newFakeCommandHandler(), nil)
	bot.handleUpdate(context.Background(), textUpdate("/nope", "42", "42"))
	if text := lastMessageText(t, fake); !strings.Contains(text, "未知命令: nope") {
		t.Fatalf("unexpected response: %q", text)
	}
}

func TestBotPollingDispatchesAndStops(t *testing.T) {
	sendDone := make(chan struct{})
	getUpdatesCalls := 0
	fake := newFakeTelegram(t, func(method string, _ recordedRequest) (int, string) {
		switch method {
		case "getUpdates":
			getUpdatesCalls++
			if getUpdatesCalls == 1 {
				return http.StatusOK, `{"ok":true,"result":[{"update_id":10,"message":{"text":"/help","chat":{"id":42},"from":{"id":42,"is_bot":false}}}]}`
			}
			return http.StatusOK, `{"ok":true,"result":[]}`
		case "sendMessage":
			close(sendDone)
			return http.StatusOK, `{"ok":true,"result":{"message_id":1}}`
		default:
			return http.StatusOK, `{"ok":true,"result":true}`
		}
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sleep := func(ctx context.Context, _ time.Duration) error {
		<-sendDone
		cancel()
		return ctx.Err()
	}
	bot := newTestBot(t, fake, "", newFakeCommandHandler(), sleep)
	if err := bot.Start(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-sendDone:
	case <-time.After(3 * time.Second):
		t.Fatal("polling did not dispatch the update")
	}
	stopCtx, stopCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer stopCancel()
	if err := bot.Stop(stopCtx); err != nil {
		t.Fatal(err)
	}
	if bot.Running() {
		t.Fatal("bot still running after Stop")
	}

	methods := fake.methods()
	if len(methods) < 4 || methods[0] != "deleteMyCommands" || methods[1] != "setMyCommands" {
		t.Fatalf("unexpected startup calls: %#v", methods)
	}
	if methods[2] != "getUpdates" || methods[3] != "sendMessage" {
		t.Fatalf("unexpected polling sequence: %#v", methods)
	}
	var commandsPayload struct {
		Commands []struct {
			Command     string `json:"command"`
			Description string `json:"description"`
		} `json:"commands"`
	}
	if err := json.Unmarshal(fake.recorded()[1].Body, &commandsPayload); err != nil {
		t.Fatal(err)
	}
	if len(commandsPayload.Commands) != len(botCommands) || commandsPayload.Commands[0].Command != "help" {
		t.Fatalf("unexpected command menu: %#v", commandsPayload.Commands)
	}
}

func TestBotTaskFlow(t *testing.T) {
	dataDir := t.TempDir()
	configDir := filepath.Join(dataDir, "user-configs")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatal(err)
	}
	flowDocument := `{"taskFlow":[{"enabled":true,"name":"a"},{"enabled":false,"name":"b"},{"enabled":true,"name":"c"}]}`
	if err := os.WriteFile(filepath.Join(configDir, "automation-tasks.json"), []byte(flowDocument), 0o600); err != nil {
		t.Fatal(err)
	}

	fake := newFakeTelegram(t, telegramOKResponse)
	handler := newFakeCommandHandler()
	bot := NewBot(BotOptions{
		Paths:              config.Paths{DataDir: dataDir},
		Config:             testBotConfig(),
		Handler:            handler,
		HTTPClient:         fake.server.Client(),
		TelegramAPIBaseURL: fake.server.URL,
		Logger:             discardLogger(),
		Sleep:              immediateSleep,
		Now:                func() time.Time { return fixedNow },
	})

	bot.handleCommand(context.Background(), "42", "run", []string{"automation"})

	select {
	case flow := <-handler.flowCh:
		if flow.flowType != "automation" || len(flow.tasks) != 3 {
			t.Fatalf("unexpected flow: %+v", flow)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("task flow was not executed")
	}
	waitFor(t, func() bool {
		return len(fake.methods()) >= 2
	})
	requests := fake.recorded()
	var initial struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(requests[0].Body, &initial); err != nil {
		t.Fatal(err)
	}
	if initial.Text != "✅ 已开始执行日常流程\n\n📊 准备执行 2 个任务..." {
		t.Fatalf("unexpected initial message: %q", initial.Text)
	}
	var edit struct {
		Text string `json:"text"`
	}
	if requests[1].Method != "editMessageText" {
		t.Fatalf("unexpected second call: %q", requests[1].Method)
	}
	if err := json.Unmarshal(requests[1].Body, &edit); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(edit.Text, "✅ 日常流程执行完成") {
		t.Fatalf("unexpected completion message: %q", edit.Text)
	}
	if err := bot.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestBotTaskFlowRejectsUnknownType(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	bot := newTestBot(t, fake, "", newFakeCommandHandler(), nil)
	bot.handleCommand(context.Background(), "42", "run", []string{"other"})
	text := lastMessageText(t, fake)
	if !strings.Contains(text, "无效的流程类型: other") {
		t.Fatalf("unexpected response: %q", text)
	}
}

func TestBotTaskFlowMissingConfigIsAnError(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	bot := newTestBot(t, fake, "", newFakeCommandHandler(), nil)
	bot.handleCommand(context.Background(), "42", "run", []string{"combat"})
	text := lastMessageText(t, fake)
	if !strings.Contains(text, "❌ 执行失败:") {
		t.Fatalf("unexpected response: %q", text)
	}
}

func TestBotScreenshot(t *testing.T) {
	image := []byte("screenshot-bytes")
	fake := newFakeTelegram(t, telegramOKResponse)
	handler := newFakeCommandHandler()
	handler.screenshot = base64.StdEncoding.EncodeToString(image)
	bot := newTestBot(t, fake, "", handler, nil)

	bot.handleUpdate(context.Background(), textUpdate("截图", "42", "42"))

	methods := fake.methods()
	if len(methods) != 2 || methods[0] != "sendMessage" || methods[1] != "sendPhoto" {
		t.Fatalf("unexpected methods: %#v", methods)
	}
	form := parseMultipart(t, fake.recorded()[1])
	files := form.File["photo"]
	if len(files) != 1 || files[0].Filename != "screenshot.png" {
		t.Fatalf("unexpected photo: %#v", files)
	}
	if captions := form.Value["caption"]; len(captions) != 1 || captions[0] != "📸 当前屏幕截图" {
		t.Fatalf("unexpected caption: %#v", captions)
	}
}

func TestBotScreenshotWithoutImage(t *testing.T) {
	fake := newFakeTelegram(t, telegramOKResponse)
	handler := newFakeCommandHandler()
	bot := newTestBot(t, fake, "", handler, nil)
	bot.handleUpdate(context.Background(), textUpdate("/screenshot", "42", "42"))
	if methods := fake.methods(); len(methods) != 2 || methods[1] != "sendMessage" {
		t.Fatalf("unexpected methods: %#v", methods)
	}
	if text := lastMessageText(t, fake); !strings.Contains(text, "未获取到图片数据") {
		t.Fatalf("unexpected response: %q", text)
	}
}

func TestBotCopilotCountdown(t *testing.T) {
	copilotRequests := 0
	copilot := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		copilotRequests++
		if request.URL.Path != "/copilot/get/12345" {
			t.Errorf("unexpected copilot path: %s", request.URL.Path)
		}
		_, _ = writer.Write([]byte(`{"data":{"content":"{\"doc\":{\"title\":\"OR-EX-8 测试\"},\"stage_name\":\"act40side_ex08\"}"}}`))
	}))
	defer copilot.Close()

	fake := newFakeTelegram(t, telegramOKResponse)
	handler := newFakeCommandHandler()
	bot := newTestBot(t, fake, copilot.URL, handler, nil)

	response, err := bot.executeCopilot(context.Background(), "prts://s12345")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(response, "倒计时已开始") {
		t.Fatalf("unexpected response: %q", response)
	}
	select {
	case request := <-handler.executedCh:
		if request.Command != "copilot" || request.TaskType != "copilot" {
			t.Fatalf("unexpected task: %+v", request)
		}
		if len(request.Args) != 2 || request.Args[0] != "prts://s12345" || request.Args[1] != "--formation" {
			t.Fatalf("unexpected args: %#v", request.Args)
		}
		if request.TaskName != "抄作业 prts://s12345" {
			t.Fatalf("unexpected task name: %q", request.TaskName)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("copilot task was not executed")
	}
	if err := bot.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}

	requests := fake.recorded()
	if len(requests) != 6 {
		t.Fatalf("expected prep + 4 countdown ticks + start, got %d", len(requests))
	}
	var prep struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(requests[0].Body, &prep); err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"准备执行抄作业", "作业 URI：prts://s12345", "关卡：OR-EX-8"} {
		if !strings.Contains(prep.Text, expected) {
			t.Fatalf("prep missing %q:\n%s", expected, prep.Text)
		}
	}
	var start struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(requests[5].Body, &start); err != nil {
		t.Fatal(err)
	}
	if start.Text != "🚀 开始执行作业！" {
		t.Fatalf("unexpected start message: %q", start.Text)
	}
	if copilotRequests != 1 {
		t.Fatalf("copilot requests = %d, want 1", copilotRequests)
	}
}

func TestCopilotStageNameFallback(t *testing.T) {
	copilot := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`{"data":{"content":"{\"doc\":{\"title\":\"无编号标题\"},\"stage_name\":\"act40side_ex08\"}"}}`))
	}))
	defer copilot.Close()
	fake := newFakeTelegram(t, telegramOKResponse)
	bot := newTestBot(t, fake, copilot.URL, newFakeCommandHandler(), nil)

	info := bot.getStageInfoFromCopilot(context.Background(), "maa://999")
	if info == nil || info.DisplayName != "OR-EX-8" || info.StageName != "act40side_ex08" {
		t.Fatalf("unexpected stage info: %+v", info)
	}
}

func TestCopilotLocalJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "copilot.json")
	if err := os.WriteFile(path, []byte(`{"stage_name":"act40side_ex07"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fake := newFakeTelegram(t, telegramOKResponse)
	bot := newTestBot(t, fake, "", newFakeCommandHandler(), nil)
	info := bot.getStageInfoFromCopilot(context.Background(), path)
	if info == nil || info.StageName != "act40side_ex07" || info.DisplayName != "" {
		t.Fatalf("unexpected stage info: %+v", info)
	}
}

func TestCopilotCodeExtractionAndTitles(t *testing.T) {
	cases := map[string]string{
		"prts://s12345": "12345",
		"maa://12345s":  "12345",
		"prts://12345":  "12345",
		"prts://abc":    "abc",
	}
	for input, want := range cases {
		if got := extractCopilotCode(input); got != want {
			t.Fatalf("extractCopilotCode(%q) = %q, want %q", input, got, want)
		}
	}
	titles := map[string]string{
		"OR-EX-8 测试":  "OR-EX-8",
		"1-7 攻略":      "1-7",
		"CE-6 测试":     "CE-6",
		"【OR-EX-7】xx": "OR-EX-7",
		"【3-8】xx":     "3-8",
		"任意 4-4 标题":   "4-4",
	}
	for input, want := range titles {
		if got := matchStageTitle(input); got != want {
			t.Fatalf("matchStageTitle(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestBotTaskFlowWithRunningScheduleUpdatesMessage(t *testing.T) {
	dataDir := t.TempDir()
	configDir := filepath.Join(dataDir, "user-configs")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "automation-tasks.json"), []byte(`{"taskFlow":[{"enabled":true}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fake := newFakeTelegram(t, telegramOKResponse)
	handler := newFakeCommandHandler()
	start := fixedNow.Add(-10 * time.Second).UnixMilli()
	handler.setSchedule(ScheduleStatus{IsRunning: true, CurrentTask: "作战", CurrentStep: 0, TotalSteps: 2, StartTime: &start})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sleepCalls := 0
	sleep := func(ctx context.Context, _ time.Duration) error {
		sleepCalls++
		if sleepCalls > 1 {
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}
	bot := NewBot(BotOptions{
		Paths:              config.Paths{DataDir: dataDir},
		Config:             testBotConfig(),
		Handler:            handler,
		HTTPClient:         fake.server.Client(),
		TelegramAPIBaseURL: fake.server.URL,
		Logger:             discardLogger(),
		Sleep:              sleep,
		Now:                func() time.Time { return fixedNow },
	})

	bot.handleCommand(ctx, "42", "run", []string{"automation"})
	waitFor(t, func() bool {
		for _, request := range fake.recorded() {
			if request.Method != "editMessageText" {
				continue
			}
			var payload struct {
				Text string `json:"text"`
			}
			if err := json.Unmarshal(request.Body, &payload); err == nil {
				if strings.Contains(payload.Text, "🔄 正在执行日常流程") {
					return true
				}
			}
		}
		return false
	})
	cancel()
	if err := bot.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
}
