// Package adb wraps the external `adb` executable used to reach Android
// devices and emulators. It does not reimplement the ADB wire protocol:
// every operation invokes the configured executable with an explicit
// argument vector, applies a bounded context, and translates failures into
// stable application errors. Callers that need the ADB protocol itself must
// use the real binary; nothing here talks to the adb server directly.
package adb

import (
	"bytes"
	"context"
	stderrors "errors"
	"fmt"
	"io/fs"
	"net/http"
	"os/exec"
	"strings"
	"time"
	"unicode"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// Stable ADB error codes. They are part of the package contract and must not
// change when messages or HTTP status mappings are adjusted.
const (
	CodeADBNotFound      = "ADB_NOT_FOUND"
	CodeADBCommandFailed = "ADB_COMMAND_FAILED"
	CodeADBTimeout       = "ADB_TIMEOUT"
)

// DefaultTimeout bounds a single ADB invocation. It is long enough for a
// screencap on a slow emulator and short enough that a wedged adb server does
// not block callers indefinitely. Node uses per-operation timeouts between
// 5s and 15s; a single conservative bound covers the same window.
const DefaultTimeout = 15 * time.Second

// commandWaitDelay bounds how long Wait may wait for inherited pipes after the
// process exits or the context deadline fires. Without it, a grandchild that
// keeps stdout open can block Run past the context timeout.
const commandWaitDelay = 2 * time.Second

var pngSignature = []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}

// Client invokes a specific adb executable. Path may be a bare command name,
// a Windows absolute path containing spaces, or any other path accepted by
// exec.CommandContext. Timeout applies to each method call; zero or negative
// values fall back to DefaultTimeout.
type Client struct {
	Path    string
	Timeout time.Duration
}

// Device is one line of `adb devices -l`.
type Device struct {
	Serial      string
	State       string
	Product     string
	Model       string
	Device      string
	TransportID string
	// Raw preserves the trimmed source line, including attributes that have
	// no dedicated field (for example usb).
	Raw string
}

// New returns a Client for path with the default timeout. The path is
// validated when an operation runs, so construction cannot fail.
func New(path string) *Client {
	return &Client{Path: path, Timeout: DefaultTimeout}
}

// Devices lists visible devices and emulators via `adb devices -l`.
func (c *Client) Devices(ctx context.Context) ([]Device, error) {
	output, err := c.run(ctx, "devices", "-l")
	if err != nil {
		return nil, err
	}
	return parseDevices(string(output)), nil
}

// Connect runs `adb connect address` and returns the trimmed command output.
// ADB reports some connection failures on stdout with exit code 0, so callers
// must inspect the returned text as well as the error.
func (c *Client) Connect(ctx context.Context, address string) (string, error) {
	if err := validateToken("address", "ADB 地址", address); err != nil {
		return "", err
	}
	output, err := c.run(ctx, "connect", address)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// Disconnect runs `adb disconnect address`.
func (c *Client) Disconnect(ctx context.Context, address string) error {
	if err := validateToken("address", "ADB 地址", address); err != nil {
		return err
	}
	_, err := c.run(ctx, "disconnect", address)
	return err
}

// ExecOut runs `adb -s serial args...` and returns raw stdout bytes. It is used
// for binary-producing commands such as `exec-out screencap -p`.
func (c *Client) ExecOut(ctx context.Context, serial string, args ...string) ([]byte, error) {
	if err := validateToken("serial", "ADB 设备标识", serial); err != nil {
		return nil, err
	}
	command := make([]string, 0, len(args)+2)
	command = append(command, "-s", serial)
	command = append(command, args...)
	return c.run(ctx, command...)
}

// Shell runs `adb -s serial shell args...` and returns trimmed stdout.
func (c *Client) Shell(ctx context.Context, serial string, args ...string) (string, error) {
	if err := validateToken("serial", "ADB 设备标识", serial); err != nil {
		return "", err
	}
	command := make([]string, 0, len(args)+3)
	command = append(command, "-s", serial, "shell")
	command = append(command, args...)
	output, err := c.run(ctx, command...)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// Screenshot captures the current screen with
// `adb -s serial exec-out screencap -p` and returns the PNG bytes.
func (c *Client) Screenshot(ctx context.Context, serial string) ([]byte, error) {
	data, err := c.ExecOut(ctx, serial, "exec-out", "screencap", "-p")
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, apperrors.WithStatus(CodeADBCommandFailed, "ADB 截图返回了空数据", http.StatusBadGateway, true, map[string]any{
			"serial": serial,
			"reason": "empty_output",
		})
	}
	if !bytes.HasPrefix(data, pngSignature) {
		return nil, apperrors.WithStatus(CodeADBCommandFailed, "ADB 截图返回了无效的 PNG 数据", http.StatusBadGateway, true, map[string]any{
			"serial":       serial,
			"reason":       "invalid_png_signature",
			"outputLength": len(data),
		})
	}
	return data, nil
}

// Input runs `adb -s serial shell input args...` and returns trimmed stdout.
func (c *Client) Input(ctx context.Context, serial string, args ...string) (string, error) {
	command := make([]string, 0, len(args)+1)
	command = append(command, "input")
	command = append(command, args...)
	return c.Shell(ctx, serial, command...)
}

// Forward runs `adb -s serial forward local remote`.
func (c *Client) Forward(ctx context.Context, serial, local, remote string) error {
	if err := validateToken("serial", "ADB 设备标识", serial); err != nil {
		return err
	}
	if err := validateToken("local", "ADB 本地端口", local); err != nil {
		return err
	}
	if err := validateToken("remote", "ADB 远程端口", remote); err != nil {
		return err
	}
	_, err := c.run(ctx, "-s", serial, "forward", local, remote)
	return err
}

// run executes one argument vector without ever constructing a shell string,
// normalizes context failures, and maps process failures to app errors.
func (c *Client) run(ctx context.Context, args ...string) ([]byte, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	path := c.path()
	if err := validatePath(path); err != nil {
		return nil, err
	}
	timeout := c.timeout()
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	command := exec.CommandContext(runCtx, path, args...)
	command.WaitDelay = commandWaitDelay
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr

	runErr := command.Run()
	if runErr == nil {
		return stdout.Bytes(), nil
	}

	stderrText := strings.TrimSpace(stderr.String())
	if stderrors.Is(runErr, fs.ErrNotExist) || stderrors.Is(runErr, exec.ErrNotFound) {
		return nil, apperrors.WithStatus(CodeADBNotFound,
			fmt.Sprintf("找不到 ADB 可执行文件：%s", path),
			http.StatusServiceUnavailable, false,
			map[string]any{"path": path, "error": runErr.Error()})
	}

	details := map[string]any{"path": path, "args": args}
	if stderrText != "" {
		details["stderr"] = stderrText
	}

	if runCtx.Err() == context.DeadlineExceeded {
		details["timeout"] = timeout.String()
		message := fmt.Sprintf("ADB 命令执行超时（%s）", timeout)
		if stderrText != "" {
			message = fmt.Sprintf("%s：%s", message, stderrText)
		}
		details["error"] = runErr.Error()
		return nil, apperrors.WithStatus(CodeADBTimeout, message, http.StatusGatewayTimeout, true, details)
	}

	if runCtx.Err() == context.Canceled || ctx.Err() == context.Canceled {
		details["error"] = runErr.Error()
		return nil, apperrors.WithStatus(CodeADBCommandFailed, "ADB 命令已取消", http.StatusBadGateway, false, details)
	}

	exitCode := -1
	var exitErr *exec.ExitError
	if stderrors.As(runErr, &exitErr) {
		exitCode = exitErr.ExitCode()
	}
	details["exitCode"] = exitCode
	message := "ADB 命令执行失败"
	if stderrText != "" {
		message = fmt.Sprintf("%s：%s", message, stderrText)
	}
	details["error"] = runErr.Error()
	// A command that started and exited is usually a transient device or
	// server condition; a start failure (bad executable, permissions) is not.
	return nil, apperrors.WithStatus(CodeADBCommandFailed, message, http.StatusBadGateway, exitCode >= 0, details)
}

func (c *Client) path() string {
	if c == nil {
		return ""
	}
	return c.Path
}

func (c *Client) timeout() time.Duration {
	if c == nil || c.Timeout <= 0 {
		return DefaultTimeout
	}
	return c.Timeout
}

// validatePath accepts command names and paths, including Windows paths with
// spaces, but rejects empty paths and control characters that cannot appear in
// a real executable path or would corrupt diagnostics.
func validatePath(path string) error {
	if strings.TrimSpace(path) == "" {
		return apperrors.Validation(CodeADBCommandFailed, "ADB 路径不能为空", map[string]any{"field": "path"})
	}
	for _, r := range path {
		if r == 0 || unicode.IsControl(r) {
			return apperrors.Validation(CodeADBCommandFailed, "ADB 路径包含非法字符", map[string]any{"field": "path"})
		}
	}
	return nil
}

// validateToken rejects empty or whitespace-bearing single-argument values
// such as serials, addresses, and port specs. Arguments are never passed
// through a shell, so only values that ADB itself cannot represent are
// rejected here.
func validateToken(field, label, value string) error {
	if strings.TrimSpace(value) == "" {
		return apperrors.Validation(CodeADBCommandFailed, label+"不能为空", map[string]any{"field": field})
	}
	for _, r := range value {
		if r == 0 || unicode.IsControl(r) || unicode.IsSpace(r) {
			return apperrors.Validation(CodeADBCommandFailed, label+"包含非法字符", map[string]any{"field": field})
		}
	}
	return nil
}

// parseDevices parses `adb devices -l` output. The header, blank lines, and
// lines without fields are ignored. Attributes after the state are key:value
// tokens; unknown keys remain available in Raw.
func parseDevices(output string) []Device {
	var devices []Device
	for _, rawLine := range strings.Split(output, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "List of devices attached") || strings.HasPrefix(line, "(no serial number)") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		device := Device{Serial: fields[0], State: "unknown", Raw: line}
		if len(fields) > 1 {
			device.State = fields[1]
		}
		if len(fields) > 2 {
			for _, attribute := range fields[2:] {
				key, value, ok := strings.Cut(attribute, ":")
				if !ok || key == "" {
					continue
				}
				switch key {
				case "product":
					device.Product = value
				case "model":
					device.Model = value
				case "device":
					device.Device = value
				case "transport_id":
					device.TransportID = value
				}
			}
		}
		devices = append(devices, device)
	}
	return devices
}

// Push runs `adb -s serial push local remote`.
func (c *Client) Push(ctx context.Context, serial, local, remote string) error {
	if err := validateToken("serial", "ADB 设备标识", serial); err != nil {
		return err
	}
	if err := validatePath(local); err != nil {
		return err
	}
	if err := validateToken("remote", "ADB 远程路径", remote); err != nil {
		return err
	}
	_, err := c.run(ctx, "-s", serial, "push", local, remote)
	return err
}

// Reverse runs `adb -s serial reverse remote local`.
func (c *Client) Reverse(ctx context.Context, serial, remote, local string) error {
	if err := validateToken("serial", "ADB 设备标识", serial); err != nil {
		return err
	}
	if err := validateToken("remote", "ADB 远程套接字", remote); err != nil {
		return err
	}
	if err := validateToken("local", "ADB 本地端口", local); err != nil {
		return err
	}
	_, err := c.run(ctx, "-s", serial, "reverse", remote, local)
	return err
}

// RemoveReverse removes one reverse tunnel.
func (c *Client) RemoveReverse(ctx context.Context, serial, remote string) error {
	if err := validateToken("serial", "ADB 设备标识", serial); err != nil {
		return err
	}
	if err := validateToken("remote", "ADB 远程套接字", remote); err != nil {
		return err
	}
	_, err := c.run(ctx, "-s", serial, "reverse", "--remove", remote)
	return err
}

// RemoveAllReverse removes all reverse tunnels for the device.
func (c *Client) RemoveAllReverse(ctx context.Context, serial string) error {
	if err := validateToken("serial", "ADB 设备标识", serial); err != nil {
		return err
	}
	_, err := c.run(ctx, "-s", serial, "reverse", "--remove-all")
	return err
}

// RemoveForward removes one forward tunnel.
func (c *Client) RemoveForward(ctx context.Context, serial, local string) error {
	if err := validateToken("serial", "ADB 设备标识", serial); err != nil {
		return err
	}
	if err := validateToken("local", "ADB 本地端口", local); err != nil {
		return err
	}
	_, err := c.run(ctx, "-s", serial, "forward", "--remove", local)
	return err
}
