package notifications

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

type telegramClient struct {
	http    *http.Client
	baseURL string
}

func newTelegramClient(client *http.Client, baseURL string) *telegramClient {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &telegramClient{http: client, baseURL: strings.TrimRight(baseURL, "/")}
}

func (c *telegramClient) methodURL(token, method string) string {
	return c.baseURL + "/bot" + token + "/" + method
}

func (c *telegramClient) call(ctx context.Context, token, method string, payload any) (map[string]any, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("Telegram 请求序列化失败: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.methodURL(token, method), bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("Telegram 请求创建失败: %s", safeTransportError(err))
	}
	request.Header.Set("Content-Type", "application/json")
	return c.do(request)
}

type multipartFile struct {
	field       string
	filename    string
	contentType string
	data        []byte
}

func (c *telegramClient) callMultipart(
	ctx context.Context,
	token, method string,
	fields [][2]string,
	file multipartFile,
) (map[string]any, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, field := range fields {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			return nil, fmt.Errorf("Telegram 表单构建失败: %w", err)
		}
	}
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="`+file.field+`"; filename="`+file.filename+`"`)
	header.Set("Content-Type", file.contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return nil, fmt.Errorf("Telegram 表单构建失败: %w", err)
	}
	if _, err := part.Write(file.data); err != nil {
		return nil, fmt.Errorf("Telegram 表单构建失败: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("Telegram 表单构建失败: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.methodURL(token, method), &body)
	if err != nil {
		return nil, fmt.Errorf("Telegram 请求创建失败: %s", safeTransportError(err))
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return c.do(request)
}

func (c *telegramClient) do(request *http.Request) (map[string]any, error) {
	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("Telegram 请求失败: %s", safeTransportError(err))
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("Telegram 响应读取失败: %s", safeTransportError(err))
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var raw map[string]any
	if err := decoder.Decode(&raw); err != nil {
		return nil, fmt.Errorf("Telegram 响应格式无效: %s", err)
	}
	if raw == nil {
		raw = map[string]any{}
	}
	return raw, nil
}

// safeTransportError strips the request URL, which contains the bot token.
func safeTransportError(err error) string {
	var urlErr *url.Error
	if errors.As(err, &urlErr) && urlErr.Err != nil {
		return urlErr.Err.Error()
	}
	return err.Error()
}

func telegramOK(response map[string]any) bool {
	value, ok := response["ok"].(bool)
	return ok && value
}

func telegramDescription(response map[string]any) string {
	value, _ := response["description"].(string)
	return value
}

func sendFailure(err error) error {
	var appErr *apperrors.Error
	if errors.As(err, &appErr) {
		return appErr
	}
	return apperrors.WithStatus(
		"AGENT_NOTIFICATION_SEND_FAILED",
		errMessage(err),
		http.StatusBadGateway,
		true,
		map[string]any{"channel": "telegram"},
	)
}

func telegramAPIError(method string, response map[string]any) error {
	description := telegramDescription(response)
	if description == "" {
		description = "未知错误"
	}
	prefix := "Telegram 发送失败: "
	if method == "sendPhoto" {
		prefix = "Telegram 发送图片失败: "
	}
	return apperrors.WithStatus(
		"AGENT_NOTIFICATION_SEND_FAILED",
		prefix+description,
		http.StatusBadGateway,
		true,
		map[string]any{"channel": "telegram"},
	)
}

type telegramChannel struct {
	config ChannelConfig
	client *telegramClient
	now    func() time.Time
	sleep  func(context.Context, time.Duration) error
	logger *slog.Logger
}

func (c *telegramChannel) botToken() string {
	if c.config == nil {
		return ""
	}
	value := c.config["botToken"]
	if !truthy(value) {
		return ""
	}
	return jsString(value)
}

func (c *telegramChannel) chatID() any {
	if c.config == nil {
		return nil
	}
	return c.config["chatId"]
}

func (c *telegramChannel) CanSendImage() bool {
	return c.botToken() != "" && truthy(c.chatID())
}

func (c *telegramChannel) Send(ctx context.Context, message Message) (map[string]any, error) {
	token := c.botToken()
	chatID := c.chatID()
	if token == "" || !truthy(chatID) {
		return nil, apperrors.Validation(
			"AGENT_NOTIFICATION_TELEGRAM_INCOMPLETE",
			"Telegram 配置不完整",
			map[string]any{"channel": "telegram"},
		)
	}
	if message.Image != "" {
		return c.sendPhoto(ctx, message, token, chatID)
	}
	text := FormatTelegramMessage(message.Title, message.Content, message.Level, message.Data, c.now())
	response, err := c.client.call(ctx, token, "sendMessage", map[string]any{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "Markdown",
	})
	if err != nil {
		return nil, sendFailure(err)
	}
	if !telegramOK(response) {
		return nil, telegramAPIError("sendMessage", response)
	}
	return response, nil
}

func (c *telegramChannel) sendPhoto(ctx context.Context, message Message, token string, chatID any) (map[string]any, error) {
	caption := FormatTelegramMessage(message.Title, message.Content, message.Level, message.Data, c.now())
	image, err := decodeImageBase64(message.Image)
	if err != nil {
		c.logger.Warn("图片 base64 无效，改为发送纯文本消息", "error", errMessage(err))
		return c.Send(ctx, textOnlyMessage(message))
	}
	sizeMB := float64(len(image)) / 1024 / 1024
	c.logger.Debug("图片大小检查", "sizeMB", fmt.Sprintf("%.2f", sizeMB))
	if sizeMB > 10 {
		c.logger.Warn("图片超过 10MB，尝试不发送图片", "sizeMB", fmt.Sprintf("%.2f", sizeMB))
		return c.Send(ctx, textOnlyMessage(message))
	}

	fields := [][2]string{
		{"chat_id", jsString(chatID)},
		{"caption", caption},
		{"parse_mode", "Markdown"},
	}
	file := multipartFile{field: "photo", filename: "screenshot.png", contentType: "image/png", data: image}

	var lastError error
	for attempt := 1; attempt <= 3; attempt++ {
		c.logger.Debug("发送 Telegram 图片", "attempt", attempt, "maxRetries", 3)
		attemptCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		response, requestErr := c.client.callMultipart(attemptCtx, token, "sendPhoto", fields, file)
		cancel()
		if requestErr == nil && !telegramOK(response) {
			requestErr = telegramAPIError("sendPhoto", response)
		}
		if requestErr == nil {
			c.logger.Info("Telegram 图片发送成功")
			return response, nil
		}
		lastError = requestErr
		c.logger.Error("发送 Telegram 图片失败", "attempt", attempt, "maxRetries", 3, "error", errMessage(requestErr))
		if attempt < 3 {
			if err := c.sleep(ctx, time.Duration(attempt)*2*time.Second); err != nil {
				return nil, sendFailure(err)
			}
		}
	}

	c.logger.Warn("发送图片失败，改为发送纯文本消息")
	response, fallbackErr := c.Send(ctx, textOnlyMessage(message))
	if fallbackErr != nil {
		return nil, apperrors.WithStatus(
			"AGENT_NOTIFICATION_SEND_FAILED",
			"发送图片和文本消息都失败: "+errMessage(lastError),
			http.StatusBadGateway,
			true,
			map[string]any{"channel": "telegram"},
		)
	}
	return response, nil
}

func textOnlyMessage(message Message) Message {
	message.Image = ""
	return message
}

func (c *telegramChannel) Test(ctx context.Context) TestResult {
	_, err := c.Send(ctx, Message{
		Title:   "测试通知",
		Content: "La Pluma 通知系统测试成功！",
		Level:   "info",
	})
	if err != nil {
		return TestResult{Success: false, Message: errMessage(err)}
	}
	return TestResult{Success: true, Message: "测试消息已发送"}
}

// decodeImageBase64 accepts raw base64, data URIs and whitespace-wrapped
// payloads. Node's Buffer.from is lenient; trying the common alphabets covers
// the same inputs without silently producing garbage.
func decodeImageBase64(encoded string) ([]byte, error) {
	value := strings.TrimSpace(encoded)
	if index := strings.IndexByte(value, ','); index >= 0 && strings.Contains(strings.ToLower(value[:index]), "base64") {
		value = value[index+1:]
	}
	value = strings.Map(func(char rune) rune {
		switch char {
		case ' ', '\n', '\r', '\t':
			return -1
		default:
			return char
		}
	}, value)
	if value == "" {
		return nil, errors.New("图片数据为空")
	}
	encodings := []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	}
	for _, encoding := range encodings {
		if data, err := encoding.DecodeString(value); err == nil {
			return data, nil
		}
	}
	return nil, errors.New("图片 base64 数据无效")
}
