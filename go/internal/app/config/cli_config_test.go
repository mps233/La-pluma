package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestNormalizeMaaCoreChannel(t *testing.T) {
	cases := map[string]string{
		"stable": "Stable",
		" BETA ": "Beta",
		"alpha":  "Alpha",
		"Alpha":  "Alpha",
	}
	for input, want := range cases {
		got, err := NormalizeMaaCoreChannel(input)
		if err != nil || got != want {
			t.Fatalf("NormalizeMaaCoreChannel(%q) = %q, %v", input, got, err)
		}
	}

	_, err := NormalizeMaaCoreChannel("nightly")
	appErr := requireSameErrorCode(t, err, CodeMaaCoreChannelInvalid)
	if appErr.StatusCode != 400 || appErr.Retryable {
		t.Fatalf("unexpected error: %+v", appErr)
	}
	if !strings.Contains(appErr.Message, "不支持") {
		t.Fatalf("message = %s", appErr.Message)
	}
}

func TestBuildMaaCliConfigWithChannel(t *testing.T) {
	config := map[string]any{
		"cli":  map[string]any{"channel": "Stable"},
		"core": map[string]any{"component": map[string]any{"resource": true}},
	}
	built, err := BuildMaaCliConfigWithChannel(config, "beta")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(built["cli"], map[string]any{"channel": "Stable"}) {
		t.Fatalf("cli section = %#v", built["cli"])
	}
	core := requireMap(t, built["core"], "core")
	if core["channel"] != "Beta" {
		t.Fatalf("core = %#v", core)
	}
	component := requireMap(t, core["component"], "component")
	if component["resource"] != true {
		t.Fatalf("component = %#v", component)
	}

	sourceCore := requireMap(t, config["core"], "source core")
	if _, exists := sourceCore["channel"]; exists {
		t.Fatalf("source config was mutated: %#v", sourceCore)
	}

	withoutCore, err := BuildMaaCliConfigWithChannel(map[string]any{"core": "legacy"}, "stable")
	if err != nil {
		t.Fatal(err)
	}
	if requireMap(t, withoutCore["core"], "replaced core")["channel"] != "Stable" {
		t.Fatalf("core = %#v", withoutCore["core"])
	}
}

func TestCLIConfigSetAndGet(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "cli.toml")
	if err := os.WriteFile(path, []byte("[cli]\nchannel = \"Stable\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	config := NewCLIConfig(root)

	channel, err := config.SetCoreChannel("beta")
	if err != nil {
		t.Fatal(err)
	}
	if channel != "Beta" {
		t.Fatalf("channel = %s", channel)
	}
	got, err := config.GetCoreChannel()
	if err != nil {
		t.Fatal(err)
	}
	if got != "Beta" {
		t.Fatalf("GetCoreChannel = %s", got)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	raw := parseTOML(t, data)
	if requireMap(t, raw["cli"], "cli")["channel"] != "Stable" {
		t.Fatalf("cli section = %#v", raw["cli"])
	}
	if requireMap(t, raw["core"], "core")["channel"] != "Beta" {
		t.Fatalf("core section = %#v", raw["core"])
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

func TestCLIConfigMissingFile(t *testing.T) {
	config := NewCLIConfig(t.TempDir())
	channel, err := config.GetCoreChannel()
	if err != nil {
		t.Fatal(err)
	}
	if channel != "Stable" {
		t.Fatalf("channel = %s", channel)
	}
}

func TestCLIConfigRejectsInvalidChannel(t *testing.T) {
	root := t.TempDir()
	config := NewCLIConfig(root)
	_, err := config.SetCoreChannel("nightly")
	if !isAppError(err, CodeMaaCoreChannelInvalid) {
		t.Fatalf("error = %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(root, "cli.toml")); !os.IsNotExist(statErr) {
		t.Fatalf("invalid channel wrote cli.toml: %v", statErr)
	}
}

func TestCLIConfigMalformedFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "cli.toml"), []byte("core = ["), 0o600); err != nil {
		t.Fatal(err)
	}
	config := NewCLIConfig(root)
	_, err := config.GetCoreChannel()
	if !isAppError(err, CodeCLIConfigReadFailed) {
		t.Fatalf("error = %v", err)
	}
}
