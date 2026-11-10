// Package connection probes and discovers ADB devices for the connection
// settings page. It keeps the user-facing result shapes in one place so the
// HTTP handlers stay thin.
package connection

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/infra/adb"
)

const (
	// DefaultProbeTimeout bounds one local emulator-port probe. A closed port
	// on loopback fails immediately; the timeout only covers a wedged stack.
	DefaultProbeTimeout = 400 * time.Millisecond
	// DefaultConnectWait bounds how long a fresh adb connect may take to
	// surface the device. adb connect is normally synchronous, but some
	// emulators publish the transport a moment later.
	DefaultConnectWait = time.Second
	// DefaultConnectPoll is the interval between device-list refreshes while
	// waiting for a fresh connection.
	DefaultConnectPoll = 200 * time.Millisecond
)

// defaultLocalAddresses are the ADB endpoints used by the emulators the
// project supports. Ports that are open but not reported by any configured
// ADB become confirmable candidates; they are never connected automatically.
var defaultLocalAddresses = []string{
	"127.0.0.1:16384",
	"127.0.0.1:5555",
	"127.0.0.1:7555",
	"127.0.0.1:62001",
	"127.0.0.1:21503",
}

// Options configures a Service. Zero values use the production defaults;
// tests inject probe/emulator functions and short waits.
type Options struct {
	LocalAddresses []string
	ProbeTimeout   time.Duration
	ConnectWait    time.Duration
	ConnectPoll    time.Duration
	Logger         *slog.Logger
	Probe          func(ctx context.Context, address string, timeout time.Duration) bool
	EmulatorADBs   func(ctx context.Context) []adb.EmulatorInstallation
	Sleep          func(ctx context.Context, duration time.Duration) bool
}

// Service lists ADB devices and tests emulator connectivity.
type Service struct {
	localAddresses []string
	probeTimeout   time.Duration
	connectWait    time.Duration
	connectPoll    time.Duration
	logger         *slog.Logger
	probe          func(context.Context, string, time.Duration) bool
	emulatorADBs   func(context.Context) []adb.EmulatorInstallation
	sleep          func(context.Context, time.Duration) bool
}

// Device is one discoverable endpoint. Address is the adb serial the UI
// stores as the connection address.
type Device struct {
	Address string `json:"address"`
	Serial  string `json:"serial,omitempty"`
	State   string `json:"state"`
	Details string `json:"details,omitempty"`
	ADBPath string `json:"adbPath,omitempty"`
	Source  string `json:"source"`
	Model   string `json:"model,omitempty"`
	Raw     string `json:"raw,omitempty"`
}

// Installation is an emulator-bundled ADB executable found on Windows.
type Installation struct {
	ADBPath string `json:"adbPath"`
	Label   string `json:"label"`
	Source  string `json:"source"`
}

// DiscoveryResult mirrors the connection settings UI contract.
type DiscoveryResult struct {
	Success          bool           `json:"success"`
	ADBAvailable     bool           `json:"adbAvailable"`
	Message          string         `json:"message"`
	Devices          []Device       `json:"devices"`
	Candidates       []Device       `json:"candidates"`
	ADBInstallations []Installation `json:"adbInstallations"`
}

// TestResult mirrors the connection test UI contract. Connected and State are
// retained for scripts that already consumed the earlier Agent response.
type TestResult struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	Connected bool   `json:"connected"`
	State     string `json:"state"`
	ADBPath   string `json:"adbPath"`
	Address   string `json:"address"`
}

// New returns a Service with production defaults for any zero option.
func New(options Options) *Service {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	addresses := options.LocalAddresses
	if addresses == nil {
		addresses = defaultLocalAddresses
	}
	probeTimeout := options.ProbeTimeout
	if probeTimeout <= 0 {
		probeTimeout = DefaultProbeTimeout
	}
	connectWait := options.ConnectWait
	if connectWait <= 0 {
		connectWait = DefaultConnectWait
	}
	connectPoll := options.ConnectPoll
	if connectPoll <= 0 {
		connectPoll = DefaultConnectPoll
	}
	probe := options.Probe
	if probe == nil {
		probe = probeAddress
	}
	emulatorADBs := options.EmulatorADBs
	if emulatorADBs == nil {
		emulatorADBs = adb.DiscoverEmulatorADBs
	}
	sleep := options.Sleep
	if sleep == nil {
		sleep = waitContext
	}
	return &Service{
		localAddresses: append([]string(nil), addresses...),
		probeTimeout:   probeTimeout,
		connectWait:    connectWait,
		connectPoll:    connectPoll,
		logger:         logger,
		probe:          probe,
		emulatorADBs:   emulatorADBs,
		sleep:          sleep,
	}
}

// Test checks whether address is connected, trying adb connect once for an
// offline or unknown network endpoint.
func (s *Service) Test(ctx context.Context, adbPath, address string) (TestResult, error) {
	result := TestResult{ADBPath: adbPath, Address: address, State: "unknown"}
	client := adb.New(adbPath)
	devices, err := client.Devices(ctx)
	if err != nil {
		return TestResult{}, err
	}
	state, found := deviceState(devices, address)
	if found {
		result.State = normalizeState(state)
	}
	if found && result.State == "device" {
		return connectedResult(result, "已连接到 "+address), nil
	}
	// A recognized but unauthorized device needs user approval, not another
	// connect attempt. Offline and unknown network endpoints may recover.
	if strings.Contains(address, ":") && (!found || result.State == "offline") {
		if _, connectErr := client.Connect(ctx, address); connectErr != nil {
			s.logger.Debug("adb connect failed during connection test", "address", address, "error", connectErr)
		}
		if s.waitForDevice(ctx, client, address) {
			result.State = "device"
			return connectedResult(result, "成功连接到 "+address), nil
		}
		if refreshed, listErr := client.Devices(ctx); listErr == nil {
			if state, found = deviceState(refreshed, address); found {
				result.State = normalizeState(state)
			}
		}
	}
	result.Message = connectionFailureMessage(address, result.State)
	return result, nil
}

// Discover lists devices from the configured ADB and any running Windows
// emulator's bundled ADB, then reports reachable local emulator ports that no
// ADB reported. Candidates are not connected automatically.
func (s *Service) Discover(ctx context.Context, adbPath string) (DiscoveryResult, error) {
	result := DiscoveryResult{
		Success:          true,
		ADBAvailable:     true,
		Devices:          []Device{},
		Candidates:       []Device{},
		ADBInstallations: []Installation{},
	}

	byAddress := map[string]Device{}
	order := make([]string, 0)
	addDevice := func(device Device) {
		existing, ok := byAddress[device.Address]
		if !ok {
			order = append(order, device.Address)
		}
		// The configured ADB is authoritative when two servers report the
		// same serial.
		if !ok || (existing.Source == "emulator-adb" && device.Source != "emulator-adb") {
			byAddress[device.Address] = device
		}
	}

	var configuredErr error
	if configuredDevices, err := adb.New(adbPath).Devices(ctx); err != nil {
		configuredErr = err
		result.ADBAvailable = false
		s.logger.Debug("configured ADB unavailable during discovery", "path", adbPath, "error", err)
	} else {
		for _, device := range configuredDevices {
			addDevice(deviceFromADB(device, adbPath, "adb", ""))
		}
	}

	installations := s.emulatorADBs(ctx)
	for _, installation := range installations {
		result.ADBInstallations = append(result.ADBInstallations, Installation{
			ADBPath: installation.ADBPath,
			Label:   installation.Label,
			Source:  installation.Source,
		})
		devices, err := adb.New(installation.ADBPath).Devices(ctx)
		if err != nil {
			s.logger.Debug("emulator ADB unavailable during discovery", "path", installation.ADBPath, "error", err)
			continue
		}
		for _, device := range devices {
			addDevice(deviceFromADB(device, installation.ADBPath, "emulator-adb", installation.Label))
		}
	}
	// Only a discovery that has no usable ADB at all is an operational error.
	// A missing configured ADB is recoverable when an emulator bundled one.
	if configuredErr != nil && len(installations) == 0 {
		return DiscoveryResult{}, configuredErr
	}

	for _, address := range order {
		result.Devices = append(result.Devices, byAddress[address])
	}
	known := make(map[string]bool, len(result.Devices))
	for _, device := range result.Devices {
		known[device.Address] = true
	}
	result.Candidates = s.probeCandidates(ctx, known)
	result.Message = discoveryMessage(len(result.Devices), len(result.Candidates), len(result.ADBInstallations))
	return result, nil
}

func (s *Service) probeCandidates(ctx context.Context, known map[string]bool) []Device {
	if len(s.localAddresses) == 0 {
		return []Device{}
	}
	type probeResult struct {
		address   string
		reachable bool
	}
	results := make(chan probeResult, len(s.localAddresses))
	var waitGroup sync.WaitGroup
	for _, address := range s.localAddresses {
		waitGroup.Add(1)
		go func(address string) {
			defer waitGroup.Done()
			results <- probeResult{address: address, reachable: s.probe(ctx, address, s.probeTimeout)}
		}(address)
	}
	waitGroup.Wait()
	close(results)

	reachable := make(map[string]bool, len(s.localAddresses))
	for probe := range results {
		reachable[probe.address] = probe.reachable
	}
	candidates := make([]Device, 0)
	for _, address := range s.localAddresses {
		if !reachable[address] || known[address] {
			continue
		}
		candidates = append(candidates, Device{
			Address: address,
			State:   "candidate",
			Details: "发现可尝试连接的本机模拟器端口",
			Source:  "local-port",
		})
	}
	return candidates
}

func (s *Service) waitForDevice(ctx context.Context, client *adb.Client, address string) bool {
	deadline := time.Now().Add(s.connectWait)
	for {
		if devices, err := client.Devices(ctx); err == nil {
			if state, found := deviceState(devices, address); found && state == "device" {
				return true
			}
		}
		if !time.Now().Before(deadline) {
			return false
		}
		if !s.sleep(ctx, s.connectPoll) {
			return false
		}
	}
}

func deviceFromADB(device adb.Device, adbPath, source, label string) Device {
	details := ""
	if source == "emulator-adb" && label != "" {
		details = label + " 内置 ADB"
	}
	return Device{
		Address: device.Serial,
		Serial:  device.Serial,
		State:   normalizeState(device.State),
		Details: details,
		ADBPath: adbPath,
		Source:  source,
		Model:   device.Model,
		Raw:     device.Raw,
	}
}

func deviceState(devices []adb.Device, address string) (string, bool) {
	for _, device := range devices {
		if device.Serial == address {
			return device.State, true
		}
	}
	return "", false
}

func normalizeState(state string) string {
	switch state {
	case "device", "offline", "unauthorized":
		return state
	default:
		return "unknown"
	}
}

func connectedResult(result TestResult, message string) TestResult {
	result.Success = true
	result.Connected = true
	result.State = "device"
	result.Message = message
	return result
}

func connectionFailureMessage(address, state string) string {
	switch state {
	case "unauthorized":
		return fmt.Sprintf("设备 %s 未授权，请在设备或模拟器上允许调试后重试", address)
	case "offline":
		return fmt.Sprintf("设备 %s 处于离线状态，请重启 ADB 或模拟器后重试", address)
	default:
		return fmt.Sprintf("无法连接到 %s，请确保模拟器已启动并已开启 ADB 调试", address)
	}
}

func discoveryMessage(deviceCount, candidateCount, installationCount int) string {
	total := deviceCount + candidateCount
	switch {
	case total > 0:
		return fmt.Sprintf("找到 %d 个设备或可尝试地址", total)
	case installationCount > 0:
		return fmt.Sprintf("未找到已连接的模拟器，已发现 %d 个模拟器内置 ADB", installationCount)
	default:
		return "未找到已连接的模拟器"
	}
}

func probeAddress(ctx context.Context, address string, timeout time.Duration) bool {
	dialer := net.Dialer{Timeout: timeout}
	connection, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return false
	}
	_ = connection.Close()
	return true
}

func waitContext(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
