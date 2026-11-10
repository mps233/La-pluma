package adb

import (
	"path/filepath"
	"testing"
)

func TestEmulatorInstallationsFindsBundledADB(t *testing.T) {
	muMuRoot := filepath.Join("C:", "Program Files", "MuMu", "shell")
	blueStacksRoot := filepath.Join("C:", "Program Files", "BlueStacks")
	processes := []windowsProcess{
		{Name: "MuMuPlayer.exe", ExecutablePath: filepath.Join(muMuRoot, "MuMuPlayer.exe")},
		{Name: "HD-Player.exe", ExecutablePath: filepath.Join(blueStacksRoot, "HD-Player.exe")},
		{Name: "notepad.exe", ExecutablePath: filepath.Join("C:", "Windows", "notepad.exe")},
		// A second matching process must not duplicate the same adb path.
		{Name: "MuMuPlayer.exe", ExecutablePath: filepath.Join(muMuRoot, "MuMuPlayer.exe")},
	}
	exists := map[string]bool{
		filepath.Join(muMuRoot, "adb.exe"):               true,
		filepath.Join(blueStacksRoot, "HD-Adb.exe"):      true,
		filepath.Join(filepath.Dir(muMuRoot), "adb.exe"): true,
	}
	installations := emulatorInstallations(processes, func(path string) bool { return exists[path] })

	if len(installations) != 3 {
		t.Fatalf("installations = %#v", installations)
	}
	assertInstallation(t, installations[0], filepath.Join(muMuRoot, "adb.exe"), "MuMu 模拟器")
	assertInstallation(t, installations[1], filepath.Join(filepath.Dir(muMuRoot), "adb.exe"), "MuMu 模拟器")
	assertInstallation(t, installations[2], filepath.Join(blueStacksRoot, "HD-Adb.exe"), "BlueStacks")
	for _, installation := range installations {
		if installation.Source != "emulator-adb" {
			t.Fatalf("source = %q", installation.Source)
		}
	}
}

func assertInstallation(t *testing.T, installation EmulatorInstallation, path, label string) {
	t.Helper()
	if installation.ADBPath != path || installation.Label != label {
		t.Fatalf("installation = %#v, want path %q label %q", installation, path, label)
	}
}

func TestParseWindowsProcessesHandlesArrayAndSingle(t *testing.T) {
	array := parseWindowsProcesses([]byte(`[{"Name":"MuMuPlayer.exe","ExecutablePath":"C:\\MuMu\\MuMuPlayer.exe"},{"Name":"dnplayer.exe","ExecutablePath":"C:\\LD\\dnplayer.exe"}]`))
	if len(array) != 2 || array[0].Name != "MuMuPlayer.exe" || array[1].ExecutablePath != `C:\LD\dnplayer.exe` {
		t.Fatalf("array = %#v", array)
	}
	single := parseWindowsProcesses([]byte(`{"Name":"HD-Player.exe","ExecutablePath":"C:\\BlueStacks\\HD-Player.exe"}`))
	if len(single) != 1 || single[0].Name != "HD-Player.exe" {
		t.Fatalf("single = %#v", single)
	}
	if parsed := parseWindowsProcesses([]byte("  ")); parsed != nil {
		t.Fatalf("empty = %#v", parsed)
	}
	if parsed := parseWindowsProcesses([]byte("not json")); parsed != nil {
		t.Fatalf("invalid = %#v", parsed)
	}
}
