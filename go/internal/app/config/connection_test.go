package config

import (
	"testing"
)

func TestConnectionDefaultsFromEnv(t *testing.T) {
	darwin := ConnectionDefaultsFromEnv(nil, "darwin")
	if darwin.ADBPath != "/opt/homebrew/bin/adb" || darwin.Address != "127.0.0.1:16384" || darwin.ClientType != "Official" {
		t.Fatalf("darwin defaults = %+v", darwin)
	}

	linux := ConnectionDefaultsFromEnv(nil, "linux")
	if linux.ADBPath != "adb" {
		t.Fatalf("linux ADB path = %s", linux.ADBPath)
	}

	env := map[string]string{
		"ADB_PATH":        " /custom/adb ",
		"ADB_ADDRESS":     " 10.0.0.9:5555 ",
		"MAA_CLIENT_TYPE": "Bilibili",
	}
	overridden := ConnectionDefaultsFromEnv(func(key string) string { return env[key] }, "linux")
	if overridden.ADBPath != "/custom/adb" || overridden.Address != "10.0.0.9:5555" || overridden.ClientType != "Bilibili" {
		t.Fatalf("env defaults = %+v", overridden)
	}
}

func TestResolveConnectionDefaults(t *testing.T) {
	defaults := ConnectionDefaults{ADBPath: "/default/adb", Address: "127.0.0.1:16384", ClientType: "Official"}
	resolved, err := ResolveConnectionWithDefaults(nil, nil, defaults)
	if err != nil {
		t.Fatal(err)
	}
	want := ResolvedConnection{ADBPath: "/default/adb", Address: "127.0.0.1:16384", ClientType: "Official"}
	if resolved != want {
		t.Fatalf("resolved = %+v, want %+v", resolved, want)
	}
}

func TestResolveConnectionProfileSections(t *testing.T) {
	defaults := ConnectionDefaults{ADBPath: "/default/adb", Address: "127.0.0.1:16384", ClientType: "Official"}
	profile := map[string]any{
		"connection": map[string]any{
			"adb_path":       "/saved/adb",
			"address":        "127.0.0.1:5555",
			"client_type":    "Bilibili",
			"touch_mode":     "maatouch",
			"auto_reconnect": true,
		},
		"behavior":         map[string]any{"auto_reconnect": false},
		"instance_options": map[string]any{"touch_mode": "maafwadb"},
	}

	resolved, err := ResolveConnectionWithDefaults(profile, nil, defaults)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ADBPath != "/saved/adb" || resolved.Address != "127.0.0.1:5555" || resolved.ClientType != "Bilibili" {
		t.Fatalf("resolved = %+v", resolved)
	}
	// instance_options wins over the connection-section touch_mode, matching
	// getConfig's flattening order.
	if resolved.TouchMode != "maafwadb" {
		t.Fatalf("touch mode = %s", resolved.TouchMode)
	}
	if !resolved.AutoReconnect {
		t.Fatal("top-level auto_reconnect should win over behavior")
	}
}

func TestResolveConnectionCamelCaseAndBehaviorFallback(t *testing.T) {
	defaults := ConnectionDefaults{ADBPath: "/default/adb", Address: "127.0.0.1:16384", ClientType: "Official"}
	profile := map[string]any{
		"adbPath":    "/camel/adb",
		"address":    "127.0.0.1:5555",
		"clientType": "YostarEN",
		"behavior":   map[string]any{"auto_reconnect": true},
	}

	resolved, err := ResolveConnectionWithDefaults(profile, nil, defaults)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ADBPath != "/camel/adb" || resolved.ClientType != "YostarEN" {
		t.Fatalf("resolved = %+v", resolved)
	}
	if !resolved.AutoReconnect {
		t.Fatal("behavior.auto_reconnect was not applied")
	}
}

func TestResolveConnectionOverrides(t *testing.T) {
	defaults := ConnectionDefaults{ADBPath: "/default/adb", Address: "127.0.0.1:16384", ClientType: "Official"}
	profile := map[string]any{
		"adb_path":       "/saved/adb",
		"address":        "127.0.0.1:5555",
		"client_type":    "Bilibili",
		"touch_mode":     "maatouch",
		"auto_reconnect": true,
	}
	overrides := map[string]any{
		"adbPath":       " /custom/adb ",
		"address":       "   ",
		"clientType":    "Official",
		"touchMode":     " maafwadb ",
		"autoReconnect": false,
	}

	resolved, err := ResolveConnectionWithDefaults(profile, overrides, defaults)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ADBPath != "/custom/adb" {
		t.Fatalf("adb path = %q", resolved.ADBPath)
	}
	if resolved.Address != "127.0.0.1:5555" {
		t.Fatalf("blank override should preserve saved address: %q", resolved.Address)
	}
	if resolved.ClientType != "Official" || resolved.TouchMode != "maafwadb" {
		t.Fatalf("resolved = %+v", resolved)
	}
	if resolved.AutoReconnect {
		t.Fatal("explicit false override did not apply")
	}
}

func TestResolveConnectionBlankOverridesPreserveProfile(t *testing.T) {
	defaults := ConnectionDefaults{ADBPath: "/default/adb", Address: "127.0.0.1:16384", ClientType: "Official"}
	profile := map[string]any{
		"adb_path":    "/saved/adb",
		"address":     "127.0.0.1:5555",
		"client_type": "Bilibili",
	}
	overrides := map[string]any{"adbPath": " ", "address": "", "clientType": "\t"}

	resolved, err := ResolveConnectionWithDefaults(profile, overrides, defaults)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ADBPath != "/saved/adb" || resolved.Address != "127.0.0.1:5555" || resolved.ClientType != "Bilibili" {
		t.Fatalf("resolved = %+v", resolved)
	}
}

func TestResolveConnectionReadsProcessEnvironment(t *testing.T) {
	t.Setenv("ADB_PATH", "/tmp/test-adb")
	t.Setenv("ADB_ADDRESS", "10.0.0.9:5555")
	t.Setenv("MAA_CLIENT_TYPE", "Bilibili")

	resolved, err := ResolveConnection(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ADBPath != "/tmp/test-adb" || resolved.Address != "10.0.0.9:5555" || resolved.ClientType != "Bilibili" {
		t.Fatalf("resolved = %+v", resolved)
	}
}
