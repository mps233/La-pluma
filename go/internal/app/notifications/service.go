package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const (
	defaultTelegramAPIBaseURL = "https://api.telegram.org"
	notificationConfigName    = "notification"
)

// ChannelConfig is a channel's raw JSON object. Keeping it open preserves
// unknown fields (for example future Telegram options) across load/save.
type ChannelConfig map[string]any

// Config is the persisted notification.json document and the in-memory state
// exposed by the notification manager.
type Config struct {
	Enabled  bool                     `json:"enabled"`
	Channels map[string]ChannelConfig `json:"channels"`
}

// NotificationConfig mirrors the Node type name.
type NotificationConfig = Config

// DefaultConfig is the state used before any notification.json exists.
func DefaultConfig() Config {
	return Config{
		Enabled: false,
		Channels: map[string]ChannelConfig{
			"telegram": {
				"enabled":  false,
				"botToken": "",
				"chatId":   "",
			},
		},
	}
}

// Channel delivers one notification payload. Implementations are bound to a
// channel config snapshot.
type Channel interface {
	Send(ctx context.Context, message Message) (map[string]any, error)
	Test(ctx context.Context) TestResult
	CanSendImage() bool
}

// ChannelFactory builds a channel from its config.
type ChannelFactory func(config ChannelConfig) Channel

// Options configures the notification service. Zero values use production
// defaults; tests replace the HTTP client, base URL and sleep hook.
type Options struct {
	Paths              config.Paths
	HTTPClient         *http.Client
	TelegramAPIBaseURL string
	Logger             *slog.Logger
	Now                func() time.Time
	Sleep              func(ctx context.Context, duration time.Duration) error
}

// Service owns the notification config and the registered channels.
type Service struct {
	mu sync.RWMutex

	paths  config.Paths
	config Config

	logger *slog.Logger
	client *telegramClient
	now    func() time.Time
	sleep  func(ctx context.Context, duration time.Duration) error

	channels map[string]ChannelFactory
	order    []string
}

// New builds the notification service with the Telegram channel registered.
func New(options Options) *Service {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	baseURL := strings.TrimSpace(options.TelegramAPIBaseURL)
	if baseURL == "" {
		baseURL = defaultTelegramAPIBaseURL
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	sleep := options.Sleep
	if sleep == nil {
		sleep = contextSleep
	}
	service := &Service{
		paths:    options.Paths,
		config:   DefaultConfig(),
		logger:   logger,
		client:   newTelegramClient(httpClient, baseURL),
		now:      now,
		sleep:    sleep,
		channels: make(map[string]ChannelFactory),
	}
	service.RegisterChannel("telegram", func(channelConfig ChannelConfig) Channel {
		return &telegramChannel{
			config: channelConfig,
			client: service.client,
			now:    service.now,
			sleep:  service.sleep,
			logger: service.logger,
		}
	})
	return service
}

func contextSleep(ctx context.Context, duration time.Duration) error {
	if duration <= 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			return nil
		}
	}
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// RegisterChannel adds or replaces a channel factory. Registration order is
// the delivery order and matches the Node Map insertion order.
func (s *Service) RegisterChannel(name string, factory ChannelFactory) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.channels[name]; !exists {
		s.order = append(s.order, name)
	}
	s.channels[name] = factory
}

// ConfigPath is the persisted notification config location.
func (s *Service) ConfigPath() string {
	return filepath.Join(s.paths.DataDir, "user-configs", notificationConfigName+".json")
}

// Load reads notification.json and applies it in memory. A missing file keeps
// the default config. Unknown top-level fields are ignored; unknown channel
// fields are preserved.
func (s *Service) Load() (Config, error) {
	path := s.ConfigPath()
	raw, err := jsonstore.Read(path, nil)
	if err != nil {
		return Config{}, apperrors.WithStatus(
			"AGENT_NOTIFICATION_CONFIG_LOAD_FAILED",
			"通知配置读取失败",
			http.StatusInternalServerError,
			true,
			map[string]any{"path": path, "error": err.Error()},
		)
	}
	if raw == nil {
		config := DefaultConfig()
		s.SetConfig(config)
		return s.GetConfig(), nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return Config{}, configLoadError(path, err)
	}
	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return Config{}, configLoadError(path, err)
	}
	if config.Channels == nil {
		config.Channels = DefaultConfig().Channels
	}
	s.SetConfig(config)
	return s.GetConfig(), nil
}

func configLoadError(path string, err error) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_NOTIFICATION_CONFIG_LOAD_FAILED",
		"通知配置读取失败: 文件格式无效",
		http.StatusInternalServerError,
		false,
		map[string]any{"path": path, "error": err.Error()},
	)
}

// Save validates, persists atomically and applies the config. A nil Channels
// map falls back to the currently loaded channels, matching the Node merge
// behavior for a partial body.
func (s *Service) Save(config Config) error {
	if config.Channels == nil {
		config.Channels = s.GetConfig().Channels
	}
	if err := s.Validate(config); err != nil {
		return err
	}
	path := s.ConfigPath()
	if err := jsonstore.Write(path, config, true); err != nil {
		return apperrors.WithStatus(
			"AGENT_NOTIFICATION_CONFIG_SAVE_FAILED",
			"通知配置保存失败",
			http.StatusInternalServerError,
			true,
			map[string]any{"path": path, "error": err.Error()},
		)
	}
	s.SetConfig(config)
	return nil
}

// Validate enforces the persisted notification.json shape while allowing
// unknown channels and unknown fields for forward compatibility.
func (s *Service) Validate(config Config) error {
	if config.Channels == nil {
		return invalidConfig("channels", "channels 必须是对象")
	}
	for name, channel := range config.Channels {
		if strings.TrimSpace(name) == "" {
			return invalidConfig("channels", "通知渠道名称不能为空")
		}
		if channel == nil {
			continue
		}
		if value, ok := channel["enabled"]; ok {
			if _, isBool := value.(bool); !isBool {
				return invalidConfig("channels."+name+".enabled", "enabled 必须是布尔值")
			}
		}
		switch name {
		case "telegram":
			if value, ok := channel["botToken"]; ok {
				if _, isString := value.(string); !isString {
					return invalidConfig("channels.telegram.botToken", "botToken 必须是字符串")
				}
			}
			if value, ok := channel["chatId"]; ok {
				if !isStringOrNumber(value) {
					return invalidConfig("channels.telegram.chatId", "chatId 必须是字符串或数字")
				}
			}
			if value, ok := channel["allowedUserIds"]; ok {
				if !isIDList(value) {
					return invalidConfig("channels.telegram.allowedUserIds", "allowedUserIds 必须是字符串或数字数组")
				}
			}
		}
	}
	return nil
}

func invalidConfig(field, reason string) *apperrors.Error {
	return apperrors.Validation(
		"AGENT_NOTIFICATION_CONFIG_INVALID",
		"通知配置格式无效: "+reason,
		map[string]any{"field": field},
	)
}

func isStringOrNumber(value any) bool {
	switch value.(type) {
	case string, json.Number:
		return true
	case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return true
	default:
		return false
	}
}

func isIDList(value any) bool {
	switch typed := value.(type) {
	case []string:
		return true
	case []int:
		return true
	case []int64:
		return true
	case []float64:
		return true
	case []any:
		for _, item := range typed {
			if !isStringOrNumber(item) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

// SetConfig replaces the top-level config. A nil Channels map retains the
// previously loaded channels, matching the Node object spread.
func (s *Service) SetConfig(config Config) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config.Enabled = config.Enabled
	if config.Channels != nil {
		s.config.Channels = cloneChannels(config.Channels)
	}
}

// GetConfig returns a deep copy so callers cannot mutate live state.
func (s *Service) GetConfig() Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneConfig(s.config)
}

func cloneConfig(config Config) Config {
	if data, err := json.Marshal(config); err == nil {
		var cloned Config
		if err := json.Unmarshal(data, &cloned); err == nil {
			if cloned.Channels == nil {
				cloned.Channels = make(map[string]ChannelConfig)
			}
			return cloned
		}
	}
	cloned := Config{Enabled: config.Enabled, Channels: make(map[string]ChannelConfig, len(config.Channels))}
	for name, channel := range config.Channels {
		cloned.Channels[name] = cloneChannelConfig(channel)
	}
	return cloned
}

func cloneChannels(channels map[string]ChannelConfig) map[string]ChannelConfig {
	cloned := make(map[string]ChannelConfig, len(channels))
	for name, channel := range channels {
		cloned[name] = cloneChannelConfig(channel)
	}
	return cloned
}

func cloneChannelConfig(config ChannelConfig) ChannelConfig {
	if config == nil {
		return nil
	}
	cloned := make(ChannelConfig, len(config))
	for key, value := range config {
		cloned[key] = value
	}
	return cloned
}

// Send delivers the message to every enabled registered channel.
func (s *Service) Send(ctx context.Context, message Message) SendResult {
	config := s.GetConfig()
	if !config.Enabled {
		s.logger.Info("通知功能未启用")
		return SendResult{Success: true, Message: "通知功能未启用"}
	}

	results := make([]ChannelResult, 0)
	failures := make([]ChannelError, 0)
	for _, name := range s.channelNames() {
		channelConfig := config.Channels[name]
		if channelConfig == nil || !truthy(channelConfig["enabled"]) {
			continue
		}
		factory, ok := s.channelFactory(name)
		if !ok {
			continue
		}
		if _, err := factory(channelConfig).Send(ctx, message); err != nil {
			failures = append(failures, ChannelError{Channel: name, Error: errMessage(err)})
			s.logger.Error("发送通知失败", "channel", name, "error", errMessage(err))
			continue
		}
		results = append(results, ChannelResult{Channel: name, Success: true})
		s.logger.Info("通知已发送", "channel", name)
	}

	messageText := fmt.Sprintf("通知已发送到 %d 个渠道", len(results))
	if len(failures) > 0 {
		names := make([]string, 0, len(failures))
		for _, failure := range failures {
			names = append(names, failure.Channel)
		}
		messageText = "部分渠道发送失败: " + strings.Join(names, ", ")
	}
	resultsValue := results
	failuresValue := failures
	return SendResult{
		Success: len(failures) == 0,
		Message: messageText,
		Results: &resultsValue,
		Errors:  &failuresValue,
	}
}

// SendToChannel delivers to one enabled channel and returns the raw provider
// response, matching the Node cast of channel.send().
func (s *Service) SendToChannel(ctx context.Context, name string, message Message) (map[string]any, error) {
	factory, ok := s.channelFactory(name)
	if !ok {
		return nil, apperrors.Validation(
			"AGENT_NOTIFICATION_CHANNEL_UNKNOWN",
			"未知的通知渠道: "+name,
			map[string]any{"channel": name},
		)
	}
	channelConfig := s.GetConfig().Channels[name]
	if channelConfig == nil || !truthy(channelConfig["enabled"]) {
		return nil, apperrors.Validation(
			"AGENT_NOTIFICATION_CHANNEL_DISABLED",
			"通知渠道 "+name+" 未启用",
			map[string]any{"channel": name},
		)
	}
	return factory(channelConfig).Send(ctx, message)
}

// TestChannel sends a test message. An explicit override, including an empty
// object, takes precedence over the persisted channel config.
func (s *Service) TestChannel(ctx context.Context, name string, override ChannelConfig) (TestResult, error) {
	if name == "" {
		return TestResult{}, apperrors.Validation(
			"AGENT_VALIDATION_CHANNEL_REQUIRED",
			"缺少通知渠道",
			map[string]any{},
		)
	}
	factory, ok := s.channelFactory(name)
	if !ok {
		return TestResult{}, apperrors.Validation(
			"AGENT_NOTIFICATION_CHANNEL_UNKNOWN",
			"未知的通知渠道: "+name,
			map[string]any{"channel": name},
		)
	}
	channelConfig := override
	if channelConfig == nil {
		channelConfig = s.GetConfig().Channels[name]
	}
	if channelConfig == nil {
		return TestResult{}, apperrors.Validation(
			"AGENT_NOTIFICATION_CHANNEL_NOT_CONFIGURED",
			"通知渠道 "+name+" 未配置",
			map[string]any{"channel": name},
		)
	}
	return factory(channelConfig).Test(ctx), nil
}

// SendTaskCompletion builds and sends a task completion notification.
func (s *Service) SendTaskCompletion(ctx context.Context, info TaskInfo) SendResult {
	return s.Send(ctx, BuildTaskCompletionMessage(info))
}

// ShouldCaptureScreenshot reports whether an enabled channel can carry images.
func (s *Service) ShouldCaptureScreenshot() bool {
	config := s.GetConfig()
	if !config.Enabled {
		return false
	}
	for _, name := range s.channelNames() {
		channelConfig := config.Channels[name]
		if channelConfig == nil || !truthy(channelConfig["enabled"]) {
			continue
		}
		factory, ok := s.channelFactory(name)
		if ok && factory(channelConfig).CanSendImage() {
			return true
		}
	}
	return false
}

func (s *Service) channelNames() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	names := make([]string, len(s.order))
	copy(names, s.order)
	return names
}

func (s *Service) channelFactory(name string) (ChannelFactory, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	factory, ok := s.channels[name]
	return factory, ok
}
