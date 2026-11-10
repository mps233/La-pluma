package connection

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/infra/adb"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

func writeScript(t *testing.T, name, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func closedLocalAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	return address
}

func noEmulatorADBs(context.Context) []adb.EmulatorInstallation { return nil }

func TestDiscoverReportsDevicesAndReachableCandidates(t *testing.T) {
	adbPath := writeScript(t, "adb", `#!/bin/sh
if [ "$1" = "devices" ]; then
  echo "List of devices attached"
  printf '10.0.0.2:5555\tdevice product:foo model:Pixel device:foo transport_id:1\n'
fi
exit 0
`)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	service := New(Options{
		LocalAddresses: []string{listener.Addr().String(), closedLocalAddress(t)},
		ProbeTimeout:   100 * time.Millisecond,
		EmulatorADBs:   noEmulatorADBs,
	})
	result, err := service.Discover(context.Background(), adbPath)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || !result.ADBAvailable {
		t.Fatalf("discovery flags = %#v", result)
	}
	if len(result.Devices) != 1 {
		t.Fatalf("devices = %#v", result.Devices)
	}
	device := result.Devices[0]
	if device.Address != "10.0.0.2:5555" || device.Serial != "10.0.0.2:5555" ||
		device.State != "device" || device.Source != "adb" || device.ADBPath != adbPath {
		t.Fatalf("device = %#v", device)
	}
	if len(result.Candidates) != 1 || result.Candidates[0].Address != listener.Addr().String() ||
		result.Candidates[0].State != "candidate" || result.Candidates[0].Source != "local-port" {
		t.Fatalf("candidates = %#v", result.Candidates)
	}
	if result.Message != "找到 2 个设备或可尝试地址" {
		t.Fatalf("message = %q", result.Message)
	}
}

func TestDiscoverUsesEmulatorADBWhenConfiguredADBIsMissing(t *testing.T) {
	adbPath := writeScript(t, "adb", `#!/bin/sh
if [ "$1" = "devices" ]; then
  echo "List of devices attached"
  printf '10.0.0.3:5555\tdevice product:bar model:MuMu device:bar transport_id:2\n'
fi
exit 0
`)
	service := New(Options{
		LocalAddresses: []string{},
		EmulatorADBs: func(context.Context) []adb.EmulatorInstallation {
			return []adb.EmulatorInstallation{{ADBPath: adbPath, Label: "MuMu 模拟器", Source: "emulator-adb"}}
		},
	})
	result, err := service.Discover(context.Background(), filepath.Join(t.TempDir(), "missing-adb"))
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.ADBAvailable {
		t.Fatalf("discovery flags = %#v", result)
	}
	if len(result.Devices) != 1 {
		t.Fatalf("devices = %#v", result.Devices)
	}
	device := result.Devices[0]
	if device.Address != "10.0.0.3:5555" || device.Source != "emulator-adb" ||
		device.ADBPath != adbPath || device.Details != "MuMu 模拟器 内置 ADB" {
		t.Fatalf("device = %#v", device)
	}
	if len(result.ADBInstallations) != 1 || result.ADBInstallations[0].Label != "MuMu 模拟器" {
		t.Fatalf("installations = %#v", result.ADBInstallations)
	}
	if result.Message != "找到 1 个设备或可尝试地址" {
		t.Fatalf("message = %q", result.Message)
	}
}

func TestDiscoverFailsWhenNoADBIsAvailable(t *testing.T) {
	service := New(Options{LocalAddresses: []string{}, EmulatorADBs: noEmulatorADBs})
	_, err := service.Discover(context.Background(), filepath.Join(t.TempDir(), "missing-adb"))
	if err == nil {
		t.Fatal("expected an error")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != adb.CodeADBNotFound {
		t.Fatalf("error = %#v", err)
	}
}

func TestTestConnectionAlreadyConnected(t *testing.T) {
	adbPath := writeScript(t, "adb", `#!/bin/sh
if [ "$1" = "devices" ]; then
  echo "List of devices attached"
  printf '10.0.0.2:5555\tdevice product:foo model:Pixel device:foo transport_id:1\n'
fi
exit 0
`)
	service := New(Options{})
	result, err := service.Test(context.Background(), adbPath, "10.0.0.2:5555")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || !result.Connected || result.State != "device" {
		t.Fatalf("result = %#v", result)
	}
	if result.Message != "已连接到 10.0.0.2:5555" {
		t.Fatalf("message = %q", result.Message)
	}
}

func TestTestConnectionConnectsOfflineDevice(t *testing.T) {
	root := t.TempDir()
	stateFile := filepath.Join(root, "state")
	argsFile := filepath.Join(root, "args")
	if err := os.WriteFile(stateFile, []byte("List of devices attached\n10.0.0.2:5555\toffline\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	adbPath := writeScript(t, "adb", `#!/bin/sh
printf '%s\n' "$*" >> "`+argsFile+`"
if [ "$1" = "devices" ]; then
  cat "`+stateFile+`"
  exit 0
fi
if [ "$1" = "connect" ]; then
  printf 'List of devices attached\n10.0.0.2:5555\tdevice\n' > "`+stateFile+`"
  echo "connected to $2"
  exit 0
fi
exit 0
`)
	service := New(Options{ConnectWait: 300 * time.Millisecond, ConnectPoll: 10 * time.Millisecond})
	result, err := service.Test(context.Background(), adbPath, "10.0.0.2:5555")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || !result.Connected || result.State != "device" {
		t.Fatalf("result = %#v", result)
	}
	if result.Message != "成功连接到 10.0.0.2:5555" {
		t.Fatalf("message = %q", result.Message)
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "connect 10.0.0.2:5555") {
		t.Fatalf("args = %q", string(args))
	}
}

func TestTestConnectionDoesNotReconnectUnauthorizedDevice(t *testing.T) {
	root := t.TempDir()
	argsFile := filepath.Join(root, "args")
	adbPath := writeScript(t, "adb", `#!/bin/sh
printf '%s\n' "$*" >> "`+argsFile+`"
if [ "$1" = "devices" ]; then
  echo "List of devices attached"
  printf '10.0.0.2:5555\tunauthorized usb:1-1 transport_id:1\n'
fi
exit 0
`)
	service := New(Options{ConnectWait: 50 * time.Millisecond, ConnectPoll: 5 * time.Millisecond})
	result, err := service.Test(context.Background(), adbPath, "10.0.0.2:5555")
	if err != nil {
		t.Fatal(err)
	}
	if result.Success || result.Connected || result.State != "unauthorized" {
		t.Fatalf("result = %#v", result)
	}
	if !strings.Contains(result.Message, "未授权") {
		t.Fatalf("message = %q", result.Message)
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(args), "connect 10.0.0.2:5555") {
		t.Fatalf("unexpected connect attempt: %q", string(args))
	}
}

func TestTestConnectionReportsUnreachableAddress(t *testing.T) {
	root := t.TempDir()
	argsFile := filepath.Join(root, "args")
	adbPath := writeScript(t, "adb", `#!/bin/sh
printf '%s\n' "$*" >> "`+argsFile+`"
if [ "$1" = "devices" ]; then
  echo "List of devices attached"
fi
exit 0
`)
	service := New(Options{ConnectWait: 20 * time.Millisecond, ConnectPoll: 5 * time.Millisecond})
	result, err := service.Test(context.Background(), adbPath, "127.0.0.1:16384")
	if err != nil {
		t.Fatal(err)
	}
	if result.Success || result.Connected {
		t.Fatalf("result = %#v", result)
	}
	if !strings.Contains(result.Message, "无法连接到 127.0.0.1:16384") {
		t.Fatalf("message = %q", result.Message)
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "connect 127.0.0.1:16384") {
		t.Fatalf("args = %q", string(args))
	}
}

func TestTestConnectionPropagatesMissingADB(t *testing.T) {
	service := New(Options{})
	_, err := service.Test(context.Background(), filepath.Join(t.TempDir(), "missing-adb"), "127.0.0.1:16384")
	if err == nil {
		t.Fatal("expected an error")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != adb.CodeADBNotFound {
		t.Fatalf("error = %#v", err)
	}
}
