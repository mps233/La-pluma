package config

import (
	"path/filepath"
	"testing"
)

func TestNormalizeBasePath(t *testing.T) {
	cases := map[string]string{
		"":               "/",
		"/":              "/",
		"la-pluma":       "/la-pluma/",
		"/la-pluma":      "/la-pluma/",
		"/la-pluma//":    "/la-pluma/",
		" /nested/path ": "/nested/path/",
	}
	for input, want := range cases {
		if got := NormalizeBasePath(input); got != want {
			t.Fatalf("NormalizeBasePath(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestLoadDefaults(t *testing.T) {
	env := map[string]string{}
	cfg, err := Load(func(key string) string { return env[key] }, "darwin", "/Users/test", "/repo")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Host != "0.0.0.0" || cfg.Port != 3000 || cfg.BasePath != "/" {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if cfg.LogBufferSize != 5000 {
		t.Fatalf("unexpected log buffer default: %d", cfg.LogBufferSize)
	}
	if cfg.MAAExecutable() != "maa" {
		t.Fatalf("unexpected MAA executable default: %s", cfg.MAAExecutable())
	}
	if cfg.Paths.DataDir != filepath.Join("/repo", "server", "data") {
		t.Fatalf("unexpected data dir: %s", cfg.Paths.DataDir)
	}
	if cfg.Paths.ClientDist != filepath.Join("/repo", "client", "dist") {
		t.Fatalf("unexpected client dist: %s", cfg.Paths.ClientDist)
	}
}

func TestLoadRejectsHalfTLS(t *testing.T) {
	env := map[string]string{"LA_PLUMA_HTTPS_CERT_PATH": "/tmp/cert.pem"}
	if _, err := Load(func(key string) string { return env[key] }, "darwin", "/Users/test", "/repo"); err == nil {
		t.Fatal("expected an error for cert without key")
	}
}

func TestLoadRejectsInvalidHost(t *testing.T) {
	env := map[string]string{"LA_PLUMA_HOST": "not-an-ip"}
	if _, err := Load(func(key string) string { return env[key] }, "darwin", "/Users/test", "/repo"); err == nil {
		t.Fatal("expected an error for an invalid host")
	}
}

func TestLoadLogBufferSize(t *testing.T) {
	cfg, err := Load(func(key string) string {
		if key == "LA_PLUMA_MAX_REALTIME_LOGS" {
			return "1200"
		}
		return ""
	}, "darwin", "/Users/test", "/repo")
	if err != nil || cfg.LogBufferSize != 1200 {
		t.Fatalf("log buffer = %d, err = %v", cfg.LogBufferSize, err)
	}

	_, err = Load(func(key string) string {
		if key == "LA_PLUMA_MAX_REALTIME_LOGS" {
			return "10"
		}
		return ""
	}, "darwin", "/Users/test", "/repo")
	if err == nil {
		t.Fatal("expected an error for an out-of-range log buffer")
	}
}

func TestPathsDataFiles(t *testing.T) {
	paths := Paths{DataDir: "/data"}
	if got := paths.OperBoxPath(); got != filepath.Join("/data", "operbox.json") {
		t.Fatalf("OperBoxPath = %s", got)
	}
	if got := paths.DepotPath(); got != filepath.Join("/data", "depot.json") {
		t.Fatalf("DepotPath = %s", got)
	}
	if got := paths.UserConfigDir(); got != filepath.Join("/data", "user-configs") {
		t.Fatalf("UserConfigDir = %s", got)
	}
	if got := paths.UserConfigPath("notification.json"); got != filepath.Join("/data", "user-configs", "notification.json") {
		t.Fatalf("UserConfigPath = %s", got)
	}
}

func TestLoadMaaCLIPath(t *testing.T) {
	cfg, err := Load(func(key string) string {
		if key == "MAA_CLI_PATH" {
			return "/custom/maa"
		}
		return ""
	}, "darwin", "/Users/test", "/repo")
	if err != nil || cfg.MAAExecutable() != "/custom/maa" {
		t.Fatalf("maa path = %q, err = %v", cfg.MAAExecutable(), err)
	}

	cfg, err = Load(func(key string) string {
		if key == "DOCKER_ENV" {
			return "1"
		}
		return ""
	}, "linux", "/root", "/app")
	if err != nil || cfg.MAAExecutable() != "/usr/local/bin/maa" {
		t.Fatalf("docker maa path = %q, err = %v", cfg.MAAExecutable(), err)
	}
}

func TestResolveMaaPathsPerOS(t *testing.T) {
	t.Setenv("MAA_DATA_DIR", "")
	env := map[string]string{}
	resolve := func(key string) string { return env[key] }

	darwin := ResolvePaths(resolve, "darwin", "/Users/test", "/repo")
	if darwin.MaaConfigDir != filepath.Join("/Users/test", "Library", "Application Support", "com.loong.maa", "config") {
		t.Fatalf("unexpected darwin config dir: %s", darwin.MaaConfigDir)
	}

	windows := ResolvePaths(func(key string) string {
		switch key {
		case "APPDATA":
			return `C:\Users\test\AppData\Roaming`
		case "LOCALAPPDATA":
			return `C:\Users\test\AppData\Local`
		}
		return ""
	}, "windows", `C:\Users\test`, `C:\repo`)
	if windows.MaaConfigDir != filepath.Join(`C:\Users\test\AppData\Roaming`, "loong", "maa", "config") {
		t.Fatalf("unexpected windows config dir: %s", windows.MaaConfigDir)
	}

	linux := ResolvePaths(func(key string) string {
		if key == "XDG_CONFIG_HOME" {
			return "/home/test/.config"
		}
		return ""
	}, "linux", "/home/test", "/repo")
	if linux.MaaConfigDir != "/home/test/.config/maa" {
		t.Fatalf("unexpected linux config dir: %s", linux.MaaConfigDir)
	}
}

func TestLoadEnvOverrides(t *testing.T) {
	env := map[string]string{
		"LA_PLUMA_HOST":        "127.0.0.1",
		"PORT":                 "0",
		"LA_PLUMA_DATA_DIR":    "/tmp/la-pluma-data",
		"LA_PLUMA_CLIENT_DIST": "/tmp/la-pluma-client",
		"LA_PLUMA_TOKEN":       "secret",
	}
	cfg, err := Load(func(key string) string { return env[key] }, "linux", "/home/test", "/repo")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Host != "127.0.0.1" || cfg.Port != 0 || cfg.Token != "secret" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if cfg.Paths.DataDir != "/tmp/la-pluma-data" || cfg.Paths.ClientDist != "/tmp/la-pluma-client" {
		t.Fatalf("unexpected paths: %+v", cfg.Paths)
	}
}
