package webrtc

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/pion/turn/v5"

	"github.com/mps233/la-pluma/go/internal/config"
	"github.com/mps233/la-pluma/go/internal/infra/adb"
	"github.com/mps233/la-pluma/go/internal/infra/scrcpy"
	scwebrtc "github.com/mps233/la-pluma/go/internal/infra/webrtc"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const defaultDeviceID = "mumu-la-pluma"

type StartRequest struct {
	ADBPath       string
	Address       string
	DeviceID      string
	ServerPath    string
	ServerVersion string
	MaxSize       int
	MaxFPS        int
	BitRate       int
}

type Service struct {
	cfg    config.Config
	logger *slog.Logger

	mu      sync.Mutex
	current *activeRuntime

	turnMu          sync.Mutex
	turnServer      *turn.Server
	turnCredentials *turnCredentials

	adbPath       string
	address       string
	deviceID      string
	serverPath    string
	serverVersion string
	maxSize       int
	maxFPS        int
	bitRate       int
}

type activeRuntime struct {
	session   *scrcpy.Session
	publisher *scwebrtc.Publisher
	address   string
	deviceID  string
	startedAt time.Time
}

func New(cfg config.Config, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	adbPath := strings.TrimSpace(os.Getenv("ADB_PATH"))
	if adbPath == "" {
		if runtime.GOOS == "darwin" {
			adbPath = "/opt/homebrew/bin/adb"
		} else {
			adbPath = "adb"
		}
	}
	address := strings.TrimSpace(os.Getenv("ADB_ADDRESS"))
	if address == "" {
		address = "127.0.0.1:16384"
	}
	deviceID := strings.TrimSpace(os.Getenv("LA_PLUMA_WEBRTC_DEVICE_ID"))
	if deviceID == "" {
		deviceID = defaultDeviceID
	}
	version := strings.TrimSpace(os.Getenv("LA_PLUMA_SCRCPY_SERVER_VERSION"))
	if version == "" {
		version = "3.3.4"
	}
	serverPath := resolveServerPath()
	return &Service{
		cfg:           cfg,
		logger:        logger,
		adbPath:       adbPath,
		address:       address,
		deviceID:      deviceID,
		serverPath:    serverPath,
		serverVersion: version,
		maxSize:       1280,
		maxFPS:        30,
		bitRate:       4_000_000,
	}
}

func resolveServerPath() string {
	if value := strings.TrimSpace(os.Getenv("LA_PLUMA_SCRCPY_SERVER_PATH")); value != "" {
		return value
	}
	candidates := []string{
		"resources/scrcpy-server-v3.3.4",
		"resources/scrcpy-server",
		"../resources/scrcpy-server-v3.3.4",
		"../resources/scrcpy-server",
		"/tmp/scrcpy-server-v3.3.4",
	}
	if executable, err := os.Executable(); err == nil {
		dir := filepath.Dir(executable)
		candidates = append(candidates,
			filepath.Join(dir, "scrcpy-server"),
			filepath.Join(dir, "resources", "scrcpy-server"),
			filepath.Join(dir, "..", "resources", "scrcpy-server"),
		)
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			absolute, absErr := filepath.Abs(candidate)
			if absErr == nil {
				return absolute
			}
			return candidate
		}
	}
	return ""
}

func (s *Service) Start(ctx context.Context, request StartRequest) (map[string]any, error) {
	s.ensureTURN()
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.current != nil {
		return s.statusLocked(), nil
	}
	adbPath := firstNonEmpty(request.ADBPath, s.adbPath)
	address := firstNonEmpty(request.Address, s.address)
	deviceID := firstNonEmpty(request.DeviceID, s.deviceID)
	serverPath := firstNonEmpty(request.ServerPath, s.serverPath)
	if serverPath == "" {
		return nil, fmt.Errorf("找不到 scrcpy-server jar；请设置 LA_PLUMA_SCRCPY_SERVER_PATH")
	}
	client := adb.New(adbPath)
	if err := ensureDevice(ctx, client, address); err != nil {
		return nil, err
	}
	session := scrcpy.New(scrcpy.Options{
		ADB:           client,
		Serial:        address,
		ServerPath:    serverPath,
		ServerVersion: firstNonEmpty(request.ServerVersion, s.serverVersion),
		BitRate:       positive(request.BitRate, s.bitRate),
		MaxSize:       positive(request.MaxSize, s.maxSize),
		MaxFPS:        positive(request.MaxFPS, s.maxFPS),
		Control:       true,
		Audio:         false,
		Logger:        s.logger,
	})
	if err := session.Start(ctx); err != nil {
		return nil, err
	}
	publisher, err := scwebrtc.New(session, s.logger)
	if err != nil {
		session.Close()
		return nil, err
	}
	publisher.SetOnEnded(func() { s.handleVideoEnded(publisher) })
	go publisher.FeedVideo()
	s.current = &activeRuntime{
		session:   session,
		publisher: publisher,
		address:   address,
		deviceID:  deviceID,
		startedAt: time.Now(),
	}
	s.logger.Info("webrtc start", "address", address, "device_id", deviceID, "width", session.Width, "height", session.Height)
	return s.statusLocked(), nil
}

// handleVideoEnded clears a session whose scrcpy stream died, so /status stops
// reporting a live preview and the next Start can create a fresh session.
func (s *Service) handleVideoEnded(publisher *scwebrtc.Publisher) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.current.publisher != publisher {
		return
	}
	publisher.Close()
	_ = s.current.session.Close()
	s.current = nil
	s.logger.Warn("webrtc session ended after video failure")
}

func (s *Service) Stop(ctx context.Context) error {
	s.stopTURN()
	s.mu.Lock()
	entry := s.current
	s.current = nil
	s.mu.Unlock()
	if entry == nil {
		return nil
	}
	entry.publisher.Close()
	return entry.session.Close()
}

func (s *Service) currentSession() (*scrcpy.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.current.session == nil {
		return nil, apperrors.WithStatus("WEBRTC_NOT_RUNNING", "实时预览未启动", 409, false, nil)
	}
	return s.current.session, nil
}

// GetClipboard requests the device clipboard from the active preview.
func (s *Service) GetClipboard(ctx context.Context) (string, error) {
	session, err := s.currentSession()
	if err != nil {
		return "", err
	}
	text, err := session.GetClipboard(ctx)
	if err != nil {
		return "", apperrors.WithStatus("WEBRTC_CLIPBOARD_READ_FAILED", "读取设备剪贴板失败", 502, true, map[string]any{"error": err.Error()})
	}
	return text, nil
}

// SetClipboard writes text to the device clipboard; paste asks the device to
// inject a paste keyevent after setting it.
func (s *Service) SetClipboard(ctx context.Context, text string, paste bool) error {
	session, err := s.currentSession()
	if err != nil {
		return err
	}
	if err := session.SetClipboard(ctx, text, paste); err != nil {
		return apperrors.WithStatus("WEBRTC_CLIPBOARD_WRITE_FAILED", "写入设备剪贴板失败", 502, true, map[string]any{"error": err.Error()})
	}
	return nil
}

func (s *Service) CurrentPublisher() *scwebrtc.Publisher {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil {
		return nil
	}
	return s.current.publisher
}

func (s *Service) Status() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statusLocked()
}

func (s *Service) statusLocked() map[string]any {
	running := s.current != nil
	installed := s.serverPath != ""
	if info, err := os.Stat(s.serverPath); err != nil || info.IsDir() {
		installed = false
	}
	status := map[string]any{
		"installed":            installed,
		"built":                installed,
		"serverRunning":        running,
		"agentRunning":         running,
		"signalingUrl":         "/webrtc-signaling",
		"directSignalingUrl":   "",
		"deviceId":             s.deviceID,
		"devices":              []string{},
		"serverVersion":        s.serverVersion,
		"agentVersion":         "pion-scrcpy",
		"agentOnline":          running,
		"agentVersionStatus":   "ok",
		"minimumAgentVersion":  "0.0.0",
		"screenState":          nil,
		"usingDefaultPassword": false,
		"runtimeVersion":       "pion-scrcpy",
	}
	if s.current != nil {
		status["deviceId"] = s.current.deviceID
		status["address"] = s.current.address
		status["width"] = s.current.session.Width
		status["height"] = s.current.session.Height
		status["viewers"] = s.current.publisher.PeerCount()
		status["startedAt"] = s.current.startedAt.UTC().Format(time.RFC3339)
		status["devices"] = []string{s.current.address}
	}
	return status
}

// SetConnection updates the default ADB path and address used by later
// previews and screenshots. A running preview keeps its own session.
func (s *Service) SetConnection(adbPath, address string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if value := strings.TrimSpace(adbPath); value != "" {
		s.adbPath = value
	}
	if value := strings.TrimSpace(address); value != "" {
		s.address = value
	}
}

func (s *Service) defaultADBPath() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.adbPath
}

func (s *Service) effectiveAddress() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	address := s.address
	if s.current != nil {
		address = s.current.address
	}
	return address
}

func (s *Service) Devices(ctx context.Context) ([]string, error) {
	return s.DevicesWithConnection(ctx, "")
}

// DevicesWithConnection lists online devices with an optional ADB override.
func (s *Service) DevicesWithConnection(ctx context.Context, adbPath string) ([]string, error) {
	client := adb.New(firstNonEmpty(adbPath, s.defaultADBPath()))
	devices, err := client.Devices(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(devices))
	for _, device := range devices {
		if device.State == "device" {
			result = append(result, device.Serial)
		}
	}
	return result, nil
}

func (s *Service) DeviceStats(ctx context.Context) (*adb.DeviceStats, error) {
	return s.DeviceStatsWithConnection(ctx, "", "")
}

// DeviceStatsWithConnection reads device stats with optional connection
// overrides. Empty values fall back to the service defaults.
func (s *Service) DeviceStatsWithConnection(ctx context.Context, adbPath, address string) (*adb.DeviceStats, error) {
	return adb.New(firstNonEmpty(adbPath, s.defaultADBPath())).DeviceStats(ctx, firstNonEmpty(address, s.effectiveAddress()))
}

func (s *Service) Screenshot(ctx context.Context) ([]byte, error) {
	return s.ScreenshotWithConnection(ctx, "", "")
}

// ScreenshotWithConnection captures a frame with optional connection
// overrides. Empty values fall back to the service defaults.
func (s *Service) ScreenshotWithConnection(ctx context.Context, adbPath, address string) ([]byte, error) {
	return adb.New(firstNonEmpty(adbPath, s.defaultADBPath())).Screenshot(ctx, firstNonEmpty(address, s.effectiveAddress()))
}

func (s *Service) Snapshot(ctx context.Context, deviceID string) (map[string]any, error) {
	return s.SnapshotWithConnection(ctx, deviceID, "", "")
}

// SnapshotWithConnection captures a base64 snapshot with optional connection
// overrides.
func (s *Service) SnapshotWithConnection(ctx context.Context, deviceID, adbPath, address string) (map[string]any, error) {
	image, err := s.ScreenshotWithConnection(ctx, adbPath, address)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"deviceId":   firstNonEmpty(deviceID, s.deviceID),
		"image":      base64.StdEncoding.EncodeToString(image),
		"mediaType":  "image/png",
		"size":       len(image),
		"capturedAt": time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func ensureDevice(ctx context.Context, client *adb.Client, address string) error {
	devices, err := client.Devices(ctx)
	if err != nil {
		return err
	}
	for _, device := range devices {
		if device.Serial == address && device.State == "device" {
			return nil
		}
	}
	if strings.Contains(address, ":") {
		if _, err := client.Connect(ctx, address); err != nil {
			return err
		}
		devices, err = client.Devices(ctx)
		if err != nil {
			return err
		}
		for _, device := range devices {
			if device.Serial == address && device.State == "device" {
				return nil
			}
		}
	}
	return fmt.Errorf("ADB 设备不可用: %s", address)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func positive(value, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}
