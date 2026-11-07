package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const existingProfileTOML = `profile_name = "daily"

[connection]
adb_path = "adb"
address = "127.0.0.1:5555"
auto_reconnect = true
retry_count = 3
ports = [5555, 16384]

[resource]
channel = "beta"
auto_update = false

[instance_options]
touch_mode = "maatouch"
`

func TestValidateProfileName(t *testing.T) {
	valid := []string{"default", "emulator_2", "A" + strings.Repeat("b", 63)}
	for _, name := range valid {
		got, err := ValidateProfileName(name)
		if err != nil || got != name {
			t.Fatalf("ValidateProfileName(%q) = %q, %v", name, got, err)
		}
	}

	invalid := []string{"", "../default", "_hidden", "a" + strings.Repeat("b", 64), "a/b", "a b"}
	for _, name := range invalid {
		_, err := ValidateProfileName(name)
		appErr := requireSameErrorCode(t, err, CodeProfileIDInvalid)
		if appErr.StatusCode != 400 || appErr.Retryable {
			t.Fatalf("unexpected status/retryable for %q: %+v", name, appErr)
		}
		if !reflect.DeepEqual(appErr.Details, map[string]any{"profileId": name}) {
			t.Fatalf("unexpected details: %#v", appErr.Details)
		}
	}
}

func TestProfilesSaveLoadRoundTrip(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "profiles")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(dir, "daily.toml"),
		[]byte("profile_name = \"daily\"\n\n[resource]\nchannel = \"beta\"\nauto_update = false\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	profiles := Profiles{Dir: dir}
	err := profiles.Save("daily", map[string]any{
		"connection": map[string]any{
			"adb_path":       "adb",
			"address":        "127.0.0.1:5555",
			"auto_reconnect": true,
			"retry_count":    int64(3),
			"ports":          []any{int64(5555), int64(16384)},
			"touch_mode":     "maatouch",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(profiles.Dir, "daily.toml")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	raw := parseTOML(t, data)

	connection := requireMap(t, raw["connection"], "connection")
	if connection["adb_path"] != "adb" || connection["address"] != "127.0.0.1:5555" {
		t.Fatalf("unexpected connection: %#v", connection)
	}
	if numericValue(connection["retry_count"]) != 3 {
		t.Fatalf("retry_count = %#v", connection["retry_count"])
	}
	if _, exists := connection["auto_reconnect"]; exists {
		t.Fatalf("auto_reconnect should move out of connection: %#v", connection)
	}
	if _, exists := connection["touch_mode"]; exists {
		t.Fatalf("touch_mode should move out of connection: %#v", connection)
	}

	behavior := requireMap(t, raw["behavior"], "behavior")
	if behavior["auto_reconnect"] != true {
		t.Fatalf("behavior = %#v", behavior)
	}
	instanceOptions := requireMap(t, raw["instance_options"], "instance_options")
	if instanceOptions["touch_mode"] != "maatouch" {
		t.Fatalf("instance_options = %#v", instanceOptions)
	}
	resource := requireMap(t, raw["resource"], "resource")
	if resource["channel"] != "beta" || resource["auto_update"] != false {
		t.Fatalf("resource = %#v", resource)
	}

	loaded, err := profiles.Load("daily")
	if err != nil {
		t.Fatal(err)
	}
	if loaded["adb_path"] != "adb" || loaded["address"] != "127.0.0.1:5555" {
		t.Fatalf("loaded = %#v", loaded)
	}
	if loaded["auto_reconnect"] != true || loaded["touch_mode"] != "maatouch" {
		t.Fatalf("loaded behavior/instance values = %#v", loaded)
	}
	if _, exists := loaded["connection"]; exists {
		t.Fatalf("Load should flatten connection: %#v", loaded)
	}

	if os.PathSeparator != '\\' {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("mode = %o", info.Mode().Perm())
		}
	}
}

func TestMergeConnectionPreservesUnknownSections(t *testing.T) {
	profiles := Profiles{Dir: t.TempDir()}
	existing := parseTOML(t, []byte(existingProfileTOML))

	merged := profiles.MergeConnection(existing, map[string]any{
		"connection": map[string]any{
			"address":        "192.168.1.10:5555",
			"auto_reconnect": false,
		},
	})
	if merged == nil {
		t.Fatal("expected merged profile")
	}

	connection := requireMap(t, merged["connection"], "connection")
	if connection["adb_path"] != "adb" {
		t.Fatalf("adb_path lost: %#v", connection)
	}
	if connection["address"] != "192.168.1.10:5555" {
		t.Fatalf("address = %#v", connection["address"])
	}
	if numericValue(connection["retry_count"]) != 3 {
		t.Fatalf("retry_count lost: %#v", connection)
	}
	ports := connection["ports"].([]any)
	if len(ports) != 2 || numericValue(ports[0]) != 5555 || numericValue(ports[1]) != 16384 {
		t.Fatalf("ports = %#v", connection["ports"])
	}
	if _, exists := connection["auto_reconnect"]; exists {
		t.Fatalf("auto_reconnect should move to behavior: %#v", connection)
	}

	behavior := requireMap(t, merged["behavior"], "behavior")
	if behavior["auto_reconnect"] != false {
		t.Fatalf("behavior = %#v", behavior)
	}
	resource := requireMap(t, merged["resource"], "resource")
	if resource["channel"] != "beta" || resource["auto_update"] != false {
		t.Fatalf("resource = %#v", resource)
	}
	instanceOptions := requireMap(t, merged["instance_options"], "instance_options")
	if instanceOptions["touch_mode"] != "maatouch" {
		t.Fatalf("instance_options = %#v", instanceOptions)
	}
	if merged["profile_name"] != "daily" {
		t.Fatalf("profile_name lost: %#v", merged["profile_name"])
	}

	// The merge is pure: the source document keeps its legacy fields.
	originalConnection := requireMap(t, existing["connection"], "original connection")
	if originalConnection["auto_reconnect"] != true {
		t.Fatalf("source profile was mutated: %#v", originalConnection)
	}
	if _, exists := existing["behavior"]; exists {
		t.Fatalf("source profile gained behavior: %#v", existing["behavior"])
	}
}

func TestMergeConnectionMovesTouchMode(t *testing.T) {
	profiles := Profiles{Dir: t.TempDir()}
	existing := parseTOML(t, []byte(existingProfileTOML))

	merged := profiles.MergeConnection(existing, map[string]any{
		"connection": map[string]any{
			"preset":      "MuMuPro",
			"client_type": "Bilibili",
			"touch_mode":  "maafwadb",
		},
	})
	connection := requireMap(t, merged["connection"], "connection")
	if connection["preset"] != "MuMuPro" || connection["client_type"] != "Bilibili" {
		t.Fatalf("connection = %#v", connection)
	}
	if _, exists := connection["touch_mode"]; exists {
		t.Fatalf("touch_mode should move to instance_options: %#v", connection)
	}
	instanceOptions := requireMap(t, merged["instance_options"], "instance_options")
	if instanceOptions["touch_mode"] != "maafwadb" {
		t.Fatalf("instance_options = %#v", instanceOptions)
	}
}

func TestMergeConnectionRejectsInvalidSections(t *testing.T) {
	profiles := Profiles{Dir: t.TempDir()}
	if merged := profiles.MergeConnection(nil, map[string]any{"connection": "invalid"}); merged != nil {
		t.Fatalf("expected nil for invalid connection, got %#v", merged)
	}
	if merged := profiles.MergeConnection(map[string]any{"connection": []any{}}, nil); merged != nil {
		t.Fatalf("expected nil for invalid existing connection, got %#v", merged)
	}
}

func TestProfilesLoadFallback(t *testing.T) {
	defaults := ConnectionDefaults{
		ADBPath:    "/custom/adb",
		Address:    "127.0.0.1:5555",
		ClientType: "Bilibili",
	}
	profiles := Profiles{Dir: filepath.Join(t.TempDir(), "profiles"), Defaults: &defaults}

	loaded, err := profiles.Load("missing")
	if err != nil {
		t.Fatal(err)
	}
	if loaded["adb_path"] != "/custom/adb" || loaded["address"] != "127.0.0.1:5555" {
		t.Fatalf("fallback = %#v", loaded)
	}
	if loaded["config"] != "CompatMac" {
		t.Fatalf("legacy fallback key = %#v", loaded["config"])
	}

	dir := filepath.Join(t.TempDir(), "profiles")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "broken.toml"), []byte("connection = ["), 0o600); err != nil {
		t.Fatal(err)
	}
	broken := Profiles{Dir: dir, Defaults: &defaults}
	loaded, err = broken.Load("broken")
	if err != nil {
		t.Fatal(err)
	}
	if loaded["adb_path"] != "/custom/adb" {
		t.Fatalf("malformed profile should fall back: %#v", loaded)
	}
}

func TestProfilesSaveRejectsInvalidName(t *testing.T) {
	profiles := Profiles{Dir: filepath.Join(t.TempDir(), "profiles")}
	err := profiles.Save("../default", map[string]any{"connection": map[string]any{}})
	appErr := requireSameErrorCode(t, err, CodeProfileIDInvalid)
	if appErr.StatusCode != 400 {
		t.Fatalf("status = %d", appErr.StatusCode)
	}
	if _, statErr := os.Stat(filepath.Join(profiles.Dir, "default.toml")); !os.IsNotExist(statErr) {
		t.Fatalf("invalid name wrote a profile: %v", statErr)
	}
}

func TestProfilesSaveRejectsMalformedExistingProfile(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "profiles")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "daily.toml")
	if err := os.WriteFile(path, []byte("connection = ["), 0o600); err != nil {
		t.Fatal(err)
	}
	profiles := Profiles{Dir: dir}
	err := profiles.Save("daily", map[string]any{"connection": map[string]any{"address": "127.0.0.1:5555"}})
	appErr := requireSameErrorCode(t, err, CodeProfileSaveFailed)
	if !strings.Contains(appErr.Message, "保存配置失败") {
		t.Fatalf("message = %s", appErr.Message)
	}
	data, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(data) != "connection = [" {
		t.Fatalf("malformed profile was overwritten: %q", data)
	}
}

func TestProfilesSaveEmptyValue(t *testing.T) {
	profiles := Profiles{Dir: filepath.Join(t.TempDir(), "profiles")}
	if err := profiles.Save("default", nil); err != nil {
		t.Fatal(err)
	}
	loaded, err := profiles.Load("default")
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 0 {
		t.Fatalf("empty profile = %#v", loaded)
	}
	data, err := os.ReadFile(filepath.Join(profiles.Dir, "default.toml"))
	if err != nil {
		t.Fatal(err)
	}
	raw := parseTOML(t, data)
	if len(raw) != 1 || raw["connection"] == nil {
		t.Fatalf("empty profile document = %#v", raw)
	}
}
