//go:build !windows

package adb

import (
	"bytes"
	"context"
	stderrors "errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// fakeAdbScript answers the commands the client issues. It writes shell input
// arguments to an adjacent file so tests can assert the exact argument vector
// without relying on shell quoting.
const fakeAdbScript = `
args_file="@ARGS_FILE@"
case "$1" in
devices)
	printf 'List of devices attached\n'
	printf 'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1 usb:1-1\n'
	printf '192.168.1.2:5555       offline usb:1-2 transport_id:2\n'
	printf 'emulator-5556          unauthorized product:razor model:razor device:razor transport_id:3\n'
	printf '\n'
	;;
connect)
	echo "connected to $2"
	;;
disconnect)
	echo "disconnected $2"
	;;
-s)
	serial=$2
	verb=$3
	shift 3
	case "$verb" in
	exec-out)
		if [ "$serial" = "badpng" ]; then
			echo "this is not a png"
		elif [ "$serial" = "empty" ]; then
			:
		else
			printf '\211PNG\r\n\032\n'
			printf 'fake-png-data'
		fi
		;;
	shell)
		if [ "$1" = "input" ]; then
			printf '%s\n' "$@" > "$args_file"
			echo "input ok"
		else
			printf '  shell output  \n'
		fi
		;;
	forward)
		echo "forwarded"
		;;
	*)
		echo "unsupported verb: $verb" >&2
		exit 3
		;;
	esac
	;;
*)
	echo "unknown command: $1" >&2
	exit 2
	;;
esac
`

func writeScript(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
		t.Fatal(err)
	}
}

func newFakeClient(t *testing.T) (*Client, string) {
	t.Helper()
	dir := t.TempDir()
	argsFile := filepath.Join(dir, "input.args")
	script := filepath.Join(dir, "adb")
	writeScript(t, script, strings.ReplaceAll(fakeAdbScript, "@ARGS_FILE@", argsFile))
	return New(script), argsFile
}

func requireAppError(t *testing.T, err error, code string) *apperrors.Error {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error with code %s, got nil", code)
	}
	appErr, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("expected *apperrors.Error, got %T: %v", err, err)
	}
	if appErr.Code != code {
		t.Fatalf("code = %q, want %q (error: %v)", appErr.Code, code, err)
	}
	return appErr
}

func TestDevicesParsesDeviceList(t *testing.T) {
	client, _ := newFakeClient(t)
	devices, err := client.Devices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 3 {
		t.Fatalf("devices = %d, want 3: %#v", len(devices), devices)
	}

	first := devices[0]
	if first.Serial != "emulator-5554" {
		t.Errorf("serial = %q", first.Serial)
	}
	if first.State != "device" {
		t.Errorf("state = %q", first.State)
	}
	if first.Product != "sdk_gphone64_arm64" {
		t.Errorf("product = %q", first.Product)
	}
	if first.Model != "sdk_gphone64_arm64" {
		t.Errorf("model = %q", first.Model)
	}
	if first.Device != "emu64a" {
		t.Errorf("device = %q", first.Device)
	}
	if first.TransportID != "1" {
		t.Errorf("transport id = %q", first.TransportID)
	}
	if !strings.Contains(first.Raw, "usb:1-1") || !strings.Contains(first.Raw, "transport_id:1") {
		t.Errorf("raw line does not preserve attributes: %q", first.Raw)
	}
	if strings.Contains(first.Raw, "\n") || strings.HasPrefix(first.Raw, "List of devices") {
		t.Errorf("raw line was not trimmed: %q", first.Raw)
	}

	if devices[1].Serial != "192.168.1.2:5555" || devices[1].State != "offline" {
		t.Errorf("second device = %#v", devices[1])
	}
	if devices[2].State != "unauthorized" {
		t.Errorf("third device state = %q", devices[2].State)
	}
}

func TestDevicesEmptyOutput(t *testing.T) {
	script := filepath.Join(t.TempDir(), "adb")
	writeScript(t, script, `echo "List of devices attached"`)
	client := New(script)
	devices, err := client.Devices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 0 {
		t.Fatalf("devices = %#v, want none", devices)
	}
}

func TestScreenshotReturnsPNG(t *testing.T) {
	client, _ := newFakeClient(t)
	data, err := client.Screenshot(context.Background(), "emulator-5554")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(data, pngSignature) {
		t.Fatalf("data does not start with PNG signature: %x", data)
	}
	if got := string(data[len(pngSignature):]); got != "fake-png-data" {
		t.Fatalf("payload = %q", got)
	}
}

func TestScreenshotRejectsNonPNG(t *testing.T) {
	client, _ := newFakeClient(t)
	for _, serial := range []string{"badpng", "empty"} {
		t.Run(serial, func(t *testing.T) {
			_, err := client.Screenshot(context.Background(), serial)
			requireAppError(t, err, CodeADBCommandFailed)
		})
	}
}

func TestExecOutReturnsRawBytes(t *testing.T) {
	client, _ := newFakeClient(t)
	data, err := client.ExecOut(context.Background(), "emulator-5554", "exec-out", "screencap", "-p")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, append(append([]byte{}, pngSignature...), []byte("fake-png-data")...)) {
		t.Fatalf("exec-out bytes = %x", data)
	}
}

func TestInputUsesExplicitArgs(t *testing.T) {
	client, argsFile := newFakeClient(t)
	output, err := client.Input(context.Background(), "emulator-5554", "tap", "100", "200")
	if err != nil {
		t.Fatal(err)
	}
	if output != "input ok" {
		t.Fatalf("output = %q", output)
	}
	raw, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Split(strings.TrimSpace(string(raw)), "\n")
	want := []string{"input", "tap", "100", "200"}
	if !slices.Equal(got, want) {
		t.Fatalf("args = %#v, want %#v", got, want)
	}
}

func TestShellTrimsOutput(t *testing.T) {
	client, _ := newFakeClient(t)
	output, err := client.Shell(context.Background(), "emulator-5554", "dumpsys", "window")
	if err != nil {
		t.Fatal(err)
	}
	if output != "shell output" {
		t.Fatalf("output = %q, want trimmed text", output)
	}
}

func TestConnectAndDisconnect(t *testing.T) {
	client, _ := newFakeClient(t)
	output, err := client.Connect(context.Background(), "127.0.0.1:5555")
	if err != nil {
		t.Fatal(err)
	}
	if output != "connected to 127.0.0.1:5555" {
		t.Fatalf("connect output = %q", output)
	}
	if err := client.Disconnect(context.Background(), "127.0.0.1:5555"); err != nil {
		t.Fatal(err)
	}
}

func TestForward(t *testing.T) {
	client, _ := newFakeClient(t)
	if err := client.Forward(context.Background(), "emulator-5554", "tcp:27183", "tcp:27183"); err != nil {
		t.Fatal(err)
	}
}

func TestMissingAdbReturnsNotFound(t *testing.T) {
	client := New(filepath.Join(t.TempDir(), "missing-adb"))
	_, err := client.Devices(context.Background())
	appErr := requireAppError(t, err, CodeADBNotFound)
	if appErr.Retryable {
		t.Error("missing executable must not be retryable")
	}
}

func TestCommandFailureIncludesStderr(t *testing.T) {
	script := filepath.Join(t.TempDir(), "adb")
	writeScript(t, script, "echo 'adb: device offline' >&2\nexit 7\n")
	client := New(script)
	_, err := client.Devices(context.Background())
	appErr := requireAppError(t, err, CodeADBCommandFailed)
	if !appErr.Retryable {
		t.Error("failed adb command should be retryable")
	}
	if !strings.Contains(appErr.Message, "device offline") {
		t.Errorf("message does not include stderr: %q", appErr.Message)
	}
	if stderr, _ := appErr.Details["stderr"].(string); !strings.Contains(stderr, "device offline") {
		t.Errorf("details stderr = %#v", appErr.Details["stderr"])
	}
	if exitCode, _ := appErr.Details["exitCode"].(int); exitCode != 7 {
		t.Errorf("details exitCode = %#v, want 7", appErr.Details["exitCode"])
	}
}

func TestTimeoutMapsToADBTimeout(t *testing.T) {
	script := filepath.Join(t.TempDir(), "adb")
	writeScript(t, script, "exec sleep 10\n")
	client := &Client{Path: script, Timeout: 200 * time.Millisecond}
	start := time.Now()
	_, err := client.Devices(context.Background())
	appErr := requireAppError(t, err, CodeADBTimeout)
	if !appErr.Retryable {
		t.Error("timeout must be retryable")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("timeout took too long: %s", elapsed)
	}
}

func TestCanceledContextReturnsError(t *testing.T) {
	script := filepath.Join(t.TempDir(), "adb")
	writeScript(t, script, "exec sleep 10\n")
	client := New(script)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := client.Devices(ctx)
	appErr := requireAppError(t, err, CodeADBCommandFailed)
	if appErr.Retryable {
		t.Error("canceled command must not be retryable")
	}
	if !strings.Contains(appErr.Message, "取消") {
		t.Errorf("message = %q", appErr.Message)
	}
}

func TestPathValidation(t *testing.T) {
	for _, path := range []string{"", "   ", "bad\x00path", "bad\npath", "bad\tpath"} {
		t.Run(fmt.Sprintf("path-%q", path), func(t *testing.T) {
			client := New(path)
			_, err := client.Devices(context.Background())
			appErr := requireAppError(t, err, CodeADBCommandFailed)
			if appErr.StatusCode != 400 {
				t.Errorf("status = %d, want 400", appErr.StatusCode)
			}
			if appErr.Retryable {
				t.Error("invalid path must not be retryable")
			}
		})
	}
}

func TestPathWithSpacesIsAccepted(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "adb with space")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(dir, "adb")
	writeScript(t, script, `echo "List of devices attached"`)
	client := New(script)
	if _, err := client.Devices(context.Background()); err != nil {
		t.Fatalf("path with spaces rejected: %v", err)
	}
}

func TestTokenValidation(t *testing.T) {
	client, _ := newFakeClient(t)
	cases := []struct {
		name string
		call func() error
	}{
		{"empty serial", func() error { _, err := client.Shell(context.Background(), "", "true"); return err }},
		{"blank address", func() error { _, err := client.Connect(context.Background(), "   "); return err }},
		{"space in address", func() error { _, err := client.Connect(context.Background(), "127.0.0.1: 5555"); return err }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.call()
			appErr := requireAppError(t, err, CodeADBCommandFailed)
			if appErr.StatusCode != 400 {
				t.Errorf("status = %d, want 400", appErr.StatusCode)
			}
		})
	}
}

func TestParseDevicesSkipsMalformedLines(t *testing.T) {
	devices := parseDevices("List of devices attached\n\ntransport_id:9\nemulator-5554 device\n")
	if len(devices) != 2 {
		t.Fatalf("devices = %#v, want 2", devices)
	}
	if devices[0].Serial != "transport_id:9" || devices[0].State != "unknown" {
		t.Errorf("malformed line = %#v", devices[0])
	}
	if devices[1].Serial != "emulator-5554" || devices[1].State != "device" {
		t.Errorf("device line = %#v", devices[1])
	}
}

func TestErrorsAreStandard(t *testing.T) {
	script := filepath.Join(t.TempDir(), "adb")
	writeScript(t, script, "exit 1\n")
	client := New(script)
	_, err := client.Devices(context.Background())
	if !stderrors.As(err, new(*apperrors.Error)) {
		t.Fatalf("error is not an app error: %T", err)
	}
}
