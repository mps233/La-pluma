package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

var coreChannelNames = map[string]string{
	"stable": "Stable",
	"beta":   "Beta",
	"alpha":  "Alpha",
}

// CLIConfig owns maa-cli's cli.toml. Dir is the maa-cli config root (the file
// lives at <Dir>/cli.toml).
type CLIConfig struct {
	Dir string
}

func NewCLIConfig(maaConfigDir string) *CLIConfig {
	return &CLIConfig{Dir: maaConfigDir}
}

// NormalizeMaaCoreChannel mirrors normalizeMaaCoreChannel.
func NormalizeMaaCoreChannel(channel any) (string, error) {
	key := strings.ToLower(strings.TrimSpace(channelDisplay(channel)))
	normalized, ok := coreChannelNames[key]
	if !ok {
		return "", coreChannelInvalid(channel)
	}
	return normalized, nil
}

// BuildMaaCliConfigWithChannel preserves every existing cli.toml section while
// setting core.channel.
func BuildMaaCliConfigWithChannel(config map[string]any, channel any) (map[string]any, error) {
	normalized, err := NormalizeMaaCoreChannel(channel)
	if err != nil {
		return nil, err
	}
	if config == nil {
		config = map[string]any{}
	}

	result := make(map[string]any, len(config)+1)
	for key, value := range config {
		result[key] = value
	}

	core := map[string]any{}
	if existing, ok := config["core"].(map[string]any); ok {
		core = make(map[string]any, len(existing)+1)
		for key, value := range existing {
			core[key] = value
		}
	}
	core["channel"] = normalized
	result["core"] = core
	return result, nil
}

func (c *CLIConfig) path() string {
	return filepath.Join(c.Dir, "cli.toml")
}

func (c *CLIConfig) read() (map[string]any, error) {
	data, err := os.ReadFile(c.path())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]any{}, nil
		}
		return nil, cliConfigReadError(err)
	}
	var config map[string]any
	if err := toml.Unmarshal(data, &config); err != nil {
		return nil, cliConfigReadError(err)
	}
	if config == nil {
		config = map[string]any{}
	}
	return config, nil
}

// GetCoreChannel returns core.channel, defaulting to Stable when cli.toml or
// the setting is absent.
func (c *CLIConfig) GetCoreChannel() (string, error) {
	config, err := c.read()
	if err != nil {
		return "", err
	}
	if core, ok := config["core"].(map[string]any); ok {
		if channel, ok := core["channel"].(string); ok {
			return channel, nil
		}
	}
	return "Stable", nil
}

// SetCoreChannel persists the normalized core channel while retaining the rest
// of cli.toml.
func (c *CLIConfig) SetCoreChannel(channel any) (string, error) {
	normalized, err := NormalizeMaaCoreChannel(channel)
	if err != nil {
		return "", err
	}
	config, err := c.read()
	if err != nil {
		return "", err
	}
	updated, err := BuildMaaCliConfigWithChannel(config, normalized)
	if err != nil {
		return "", err
	}
	encoded, err := toml.Marshal(updated)
	if err != nil {
		return "", cliConfigWriteError(err)
	}
	if err := writeAtomic(c.path(), encoded); err != nil {
		return "", cliConfigWriteError(err)
	}
	return normalized, nil
}
