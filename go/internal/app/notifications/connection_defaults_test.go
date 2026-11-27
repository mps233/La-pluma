package notifications

import (
	"runtime"
	"testing"
)

func TestWithConnectionDefaultsUsesPlatformDefaults(t *testing.T) {
	t.Setenv("ADB_PATH", "")
	t.Setenv("ADB_ADDRESS", "")

	path, address := withConnectionDefaults("", "")
	wantPath := "adb"
	if runtime.GOOS == "darwin" {
		wantPath = "/opt/homebrew/bin/adb"
	}
	if path != wantPath {
		t.Fatalf("adb path = %q, want %q", path, wantPath)
	}
	if address != "127.0.0.1:16384" {
		t.Fatalf("address = %q", address)
	}
}

func TestWithConnectionDefaultsPrecedence(t *testing.T) {
	t.Setenv("ADB_PATH", "/env/adb")
	t.Setenv("ADB_ADDRESS", "env:5555")

	path, address := withConnectionDefaults("/explicit/adb", "explicit:5555")
	if path != "/explicit/adb" || address != "explicit:5555" {
		t.Fatalf("explicit values lost: %q %q", path, address)
	}

	path, address = withConnectionDefaults("", "")
	if path != "/env/adb" || address != "env:5555" {
		t.Fatalf("env values lost: %q %q", path, address)
	}
}
