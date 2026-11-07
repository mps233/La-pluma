package config

import (
	"path/filepath"
	"runtime"
	"strings"
)

// Paths holds every filesystem root the server needs. The desktop entry
// replaces the defaults with MyGo App.Path values; the headless entry uses
// environment overrides and repo/Docker defaults.
type Paths struct {
	DataDir    string
	CacheDir   string
	ClientDist string

	MaaDataDir   string
	MaaConfigDir string
	MaaStateDir  string
	MaaCacheDir  string
}

type Getenv func(string) string

// ResolvePaths mirrors server/config/paths.ts and adds the la-pluma data and
// client roots. Empty environment values are treated as unset.
func ResolvePaths(getenv Getenv, osName, home, cwd string) Paths {
	if getenv == nil {
		getenv = func(string) string { return "" }
	}
	read := func(key string) string {
		value := strings.TrimSpace(getenv(key))
		return value
	}
	dirEnv := func(key, fallback string) string {
		if value := read(key); value != "" {
			return value
		}
		return fallback
	}

	var maaData, maaState, maaConfig, maaCache string
	switch osName {
	case "darwin":
		support := filepath.Join(home, "Library", "Application Support", "com.loong.maa")
		maaData = support
		maaState = support
		maaConfig = filepath.Join(support, "config")
		maaCache = filepath.Join(home, "Library", "Caches", "com.loong.maa")
	case "windows":
		roaming := dirEnv("APPDATA", filepath.Join(home, "AppData", "Roaming"))
		local := dirEnv("LOCALAPPDATA", filepath.Join(home, "AppData", "Local"))
		maaData = filepath.Join(roaming, "loong", "maa", "data")
		maaState = maaData
		maaConfig = filepath.Join(roaming, "loong", "maa", "config")
		maaCache = filepath.Join(local, "loong", "maa", "cache")
	default:
		xdg := func(key, fallback string) string {
			if value := read(key); value != "" {
				return filepath.Join(value, "maa")
			}
			return fallback
		}
		maaData = xdg("XDG_DATA_HOME", filepath.Join(home, ".local", "share", "maa"))
		maaState = xdg("XDG_STATE_HOME", filepath.Join(home, ".local", "state", "maa"))
		maaConfig = xdg("XDG_CONFIG_HOME", filepath.Join(home, ".config", "maa"))
		maaCache = xdg("XDG_CACHE_HOME", filepath.Join(home, ".cache", "maa"))
	}

	return Paths{
		DataDir:      dirEnv("LA_PLUMA_DATA_DIR", filepath.Join(cwd, "server", "data")),
		CacheDir:     dirEnv("LA_PLUMA_CACHE_DIR", filepath.Join(cwd, "server", "data", "cache")),
		ClientDist:   dirEnv("LA_PLUMA_CLIENT_DIST", filepath.Join(cwd, "client", "dist")),
		MaaDataDir:   dirEnv("MAA_DATA_DIR", maaData),
		MaaConfigDir: dirEnv("MAA_CONFIG_DIR", maaConfig),
		MaaStateDir:  dirEnv("MAA_STATE_DIR", maaState),
		MaaCacheDir:  dirEnv("MAA_CACHE_DIR", maaCache),
	}
}

// DefaultPaths resolves against the current process environment.
func DefaultPaths(cwd string) Paths {
	return ResolvePaths(envLookup, runtime.GOOS, homeDir(), cwd)
}
