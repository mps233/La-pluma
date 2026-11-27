package config

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config is the headless and desktop runtime configuration. Fields are read
// once at startup; services must not consult the environment directly.
type Config struct {
	Host     string
	Port     int
	BasePath string
	Token    string

	TLSCertFile string
	TLSKeyFile  string

	// LogBufferSize caps the in-memory realtime log buffer.
	LogBufferSize int
	// MAACLIPath is the resolved maa executable. Use MAAExecutable for the
	// non-empty form.
	MAACLIPath string

	Paths Paths
}

// Load reads the environment and resolves all roots. The desktop entry uses
// the same struct but supplies MyGo paths and a loopback host/port.
func Load(getenv Getenv, osName, home, cwd string) (Config, error) {
	if getenv == nil {
		getenv = func(string) string { return "" }
	}
	read := func(key, fallback string) string {
		if value := strings.TrimSpace(getenv(key)); value != "" {
			return value
		}
		return fallback
	}

	host := read("LA_PLUMA_HOST", "0.0.0.0")
	if net.ParseIP(host) == nil && host != "localhost" {
		return Config{}, fmt.Errorf("LA_PLUMA_HOST 必须是 IP 或 localhost，收到 %q", host)
	}
	port := 3000
	if raw := strings.TrimSpace(getenv("PORT")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 || parsed > 65535 {
			return Config{}, fmt.Errorf("PORT 必须是 0-65535 的整数，收到 %q", raw)
		}
		port = parsed
	}

	logBufferSize := 5000
	if raw := strings.TrimSpace(getenv("LA_PLUMA_MAX_REALTIME_LOGS")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 100 || parsed > 1_000_000 {
			return Config{}, fmt.Errorf("LA_PLUMA_MAX_REALTIME_LOGS 必须是 100-1000000 的整数，收到 %q", raw)
		}
		logBufferSize = parsed
	}

	maaCLIPath := read("MAA_CLI_PATH", "")
	if maaCLIPath == "" {
		if read("DOCKER_ENV", "") != "" {
			maaCLIPath = "/usr/local/bin/maa"
		} else {
			maaCLIPath = "maa"
		}
	}

	cert := strings.TrimSpace(getenv("LA_PLUMA_HTTPS_CERT_PATH"))
	key := strings.TrimSpace(getenv("LA_PLUMA_HTTPS_KEY_PATH"))
	if (cert == "") != (key == "") {
		return Config{}, fmt.Errorf("LA_PLUMA_HTTPS_CERT_PATH 和 LA_PLUMA_HTTPS_KEY_PATH 必须同时配置")
	}
	if cert != "" {
		if _, err := os.Stat(cert); err != nil {
			return Config{}, fmt.Errorf("TLS 证书不可读: %w", err)
		}
		if _, err := os.Stat(key); err != nil {
			return Config{}, fmt.Errorf("TLS 私钥不可读: %w", err)
		}
	}

	paths := ResolvePaths(getenv, osName, home, cwd)
	if abs, err := filepath.Abs(paths.DataDir); err == nil {
		paths.DataDir = abs
	}
	if abs, err := filepath.Abs(paths.CacheDir); err == nil {
		paths.CacheDir = abs
	}
	if abs, err := filepath.Abs(paths.ClientDist); err == nil {
		paths.ClientDist = abs
	}

	return Config{
		Host:          host,
		Port:          port,
		BasePath:      NormalizeBasePath(getenv("LA_PLUMA_BASE_PATH")),
		Token:         strings.TrimSpace(getenv("LA_PLUMA_TOKEN")),
		TLSCertFile:   cert,
		TLSKeyFile:    key,
		LogBufferSize: logBufferSize,
		MAACLIPath:    maaCLIPath,
		Paths:         paths,
	}, nil
}

// MAAExecutable returns the configured maa executable. A zero-value Config
// still honors MAA_CLI_PATH so direct Config literals (tests, embedded
// callers) keep the previous behavior; the environment is read only here.
func (c Config) MAAExecutable() string {
	if value := strings.TrimSpace(c.MAACLIPath); value != "" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv("MAA_CLI_PATH")); value != "" {
		return value
	}
	return "maa"
}

// NormalizeBasePath returns "/" or "/name/" with exactly one leading slash and
// one trailing slash. It mirrors server.ts and vite.config.ts.
func NormalizeBasePath(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "/" {
		return "/"
	}
	if !strings.HasPrefix(trimmed, "/") {
		trimmed = "/" + trimmed
	}
	trimmed = strings.TrimRight(trimmed, "/")
	if trimmed == "" {
		return "/"
	}
	return trimmed + "/"
}
