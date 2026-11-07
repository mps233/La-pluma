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

	"github.com/mps233/la-pluma/go/internal/config"
	"github.com/mps233/la-pluma/go/internal/infra/adb"
	"github.com/mps233/la-pluma/go/internal/infra/scrcpy"
	scwebrtc "github.com/mps233/la-pluma/go/internal/infra/webrtc"
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

func (s *Service) Stop(ctx context.Context) error {
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
	status := map[string]any{
		"installed":            true,
		"built":                true,
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

func (s *Service) Devices(ctx context.Context) ([]string, error) {
	client := adb.New(s.adbPath)
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

func (s *Service) Screenshot(ctx context.Context) ([]byte, error) {
	s.mu.Lock()
	address := s.address
	if s.current != nil {
		address = s.current.address
	}
	s.mu.Unlock()
	return adb.New(s.adbPath).Screenshot(ctx, address)
}

func (s *Service) Snapshot(ctx context.Context, deviceID string) (map[string]any, error) {
	image, err := s.Screenshot(ctx)
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
