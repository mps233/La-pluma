package config

import (
	"os"
	"os/user"
	"runtime"
)

func envLookup(key string) string {
	return os.Getenv(key)
}

func homeDir() string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	if current, err := user.Current(); err == nil && current.HomeDir != "" {
		return current.HomeDir
	}
	return "."
}

// LoadProcess is the headless entry point used by cmd/server.
func LoadProcess() (Config, error) {
	cwd, err := os.Getwd()
	if err != nil {
		cwd = "."
	}
	return Load(os.Getenv, runtime.GOOS, homeDir(), cwd)
}
