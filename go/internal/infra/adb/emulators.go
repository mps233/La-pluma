package adb

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// EmulatorInstallation identifies an ADB executable shipped with a running
// emulator. Windows emulator vendors bundle their own adb builds that are not
// on PATH; discovery lets La Pluma use the binary the emulator itself uses.
type EmulatorInstallation struct {
	ADBPath string
	Label   string
	Source  string
}

type emulatorSpec struct {
	names    []string
	label    string
	adbFiles []string
}

// windowsEmulatorSpecs mirrors the emulator process and bundled-adb layout
// used by the former Node service.
var windowsEmulatorSpecs = []emulatorSpec{
	{names: []string{"HD-Player.exe"}, label: "BlueStacks", adbFiles: []string{"HD-Adb.exe", "adb.exe"}},
	{names: []string{"dnplayer.exe"}, label: "LDPlayer", adbFiles: []string{"adb.exe"}},
	{names: []string{"Nox.exe", "NoxVMHandle.exe"}, label: "夜神模拟器", adbFiles: []string{"nox_adb.exe", "adb.exe"}},
	{names: []string{"MuMuPlayer.exe", "MuMuNxDevice.exe"}, label: "MuMu 模拟器", adbFiles: []string{"adb.exe", "shell/adb.exe"}},
	{names: []string{"MEmu.exe", "MEmuHeadless.exe"}, label: "逍遥模拟器", adbFiles: []string{"adb.exe", "MEmuHyperv/adb.exe"}},
}

type windowsProcess struct {
	Name           string `json:"Name"`
	ExecutablePath string `json:"ExecutablePath"`
}

// DiscoverEmulatorADBs locates ADB executables bundled with running Windows
// emulators. Other platforms return nil: their emulators do not ship adb and
// the configured binary is authoritative.
func DiscoverEmulatorADBs(ctx context.Context) []EmulatorInstallation {
	if runtime.GOOS != "windows" {
		return nil
	}
	return emulatorInstallations(windowsEmulatorProcesses(ctx), regularFile)
}

func windowsEmulatorProcesses(ctx context.Context) []windowsProcess {
	names := make([]string, 0, len(windowsEmulatorSpecs))
	filters := make([]string, 0, len(windowsEmulatorSpecs))
	for _, spec := range windowsEmulatorSpecs {
		names = append(names, spec.names...)
	}
	for _, name := range names {
		filters = append(filters, "Name='"+name+"'")
	}
	command := "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process -Filter \"" +
		strings.Join(filters, " OR ") + "\" | Select-Object Name, ExecutablePath | ConvertTo-Json -Compress"
	runCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	output, err := exec.CommandContext(runCtx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command).Output()
	if err != nil {
		return nil
	}
	return parseWindowsProcesses(output)
}

func parseWindowsProcesses(output []byte) []windowsProcess {
	trimmed := strings.TrimSpace(string(output))
	if trimmed == "" {
		return nil
	}
	var processes []windowsProcess
	if err := json.Unmarshal([]byte(trimmed), &processes); err == nil {
		return processes
	}
	var single windowsProcess
	if err := json.Unmarshal([]byte(trimmed), &single); err != nil {
		return nil
	}
	if single.Name == "" && single.ExecutablePath == "" {
		return nil
	}
	return []windowsProcess{single}
}

// emulatorInstallations is the pure part of discovery so the path layout can
// be tested on every platform.
func emulatorInstallations(processes []windowsProcess, isRegularFile func(string) bool) []EmulatorInstallation {
	seen := make(map[string]bool)
	installations := make([]EmulatorInstallation, 0)
	for _, process := range processes {
		spec := findEmulatorSpec(process.Name)
		if spec == nil || strings.TrimSpace(process.ExecutablePath) == "" {
			continue
		}
		executable := filepath.Clean(process.ExecutablePath)
		// Emulator processes may run from the install root or a bin/shell
		// subdirectory; checking both parents covers the supported layouts.
		roots := []string{filepath.Dir(executable), filepath.Dir(filepath.Dir(executable))}
		for _, root := range roots {
			for _, adbFile := range spec.adbFiles {
				candidate := filepath.Join(root, filepath.FromSlash(adbFile))
				key := strings.ToLower(filepath.Clean(candidate))
				if seen[key] || !isRegularFile(candidate) {
					continue
				}
				seen[key] = true
				installations = append(installations, EmulatorInstallation{
					ADBPath: candidate,
					Label:   spec.label,
					Source:  "emulator-adb",
				})
			}
		}
	}
	return installations
}

func findEmulatorSpec(name string) *emulatorSpec {
	for index := range windowsEmulatorSpecs {
		spec := &windowsEmulatorSpecs[index]
		for _, candidate := range spec.names {
			if strings.EqualFold(candidate, name) {
				return spec
			}
		}
	}
	return nil
}

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
