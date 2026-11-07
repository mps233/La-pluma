package config

import (
	"os"
	"runtime"
	"strings"
)

const (
	DefaultADBAddress = "127.0.0.1:16384"
	DefaultClientType = "Official"
	darwinADBPath     = "/opt/homebrew/bin/adb"
	fallbackADBPath   = "adb"
)

// ConnectionDefaults holds the environment/platform fallbacks applied after a
// saved MAA profile when resolving a connection.
type ConnectionDefaults struct {
	ADBPath    string
	Address    string
	ClientType string
}

// ResolvedConnection is the effective adb/maa connection. It intentionally
// stays a pure value so handlers can resolve once and pass it to services.
type ResolvedConnection struct {
	ADBPath       string
	Address       string
	ClientType    string
	TouchMode     string
	AutoReconnect bool
}

// ConnectionDefaultsFromEnv mirrors the DEFAULT_* values in
// server/config/connectionDefaults.ts, made platform-aware. Unlike Node it
// trims environment values; blank values are treated as unset.
func ConnectionDefaultsFromEnv(getenv func(string) string, goos string) ConnectionDefaults {
	read := func(key string) string {
		if getenv == nil {
			return ""
		}
		return strings.TrimSpace(getenv(key))
	}

	adbPath := read("ADB_PATH")
	if adbPath == "" {
		if goos == "darwin" {
			adbPath = darwinADBPath
		} else {
			adbPath = fallbackADBPath
		}
	}
	address := read("ADB_ADDRESS")
	if address == "" {
		address = DefaultADBAddress
	}
	clientType := read("MAA_CLIENT_TYPE")
	if clientType == "" {
		clientType = DefaultClientType
	}
	return ConnectionDefaults{ADBPath: adbPath, Address: address, ClientType: clientType}
}

// DefaultConnectionDefaults reads the process environment and runtime OS.
func DefaultConnectionDefaults() ConnectionDefaults {
	return ConnectionDefaultsFromEnv(os.Getenv, runtime.GOOS)
}

// ResolveConnection resolves a saved profile against explicit overrides using
// process-level defaults. It performs no I/O.
func ResolveConnection(profile, overrides map[string]any) (ResolvedConnection, error) {
	return ResolveConnectionWithDefaults(profile, overrides, DefaultConnectionDefaults())
}

// ResolveConnectionWithDefaults is the pure resolution core. The profile may be
// either a flattened getConfig result or a raw profile document with
// [connection], [behavior], and [instance_options] sections. Override strings
// are trimmed and blank overrides are ignored, matching resolveConnectionInput.
func ResolveConnectionWithDefaults(profile, overrides map[string]any, defaults ConnectionDefaults) (ResolvedConnection, error) {
	source := profile
	if connection, ok := profile["connection"].(map[string]any); ok {
		source = connection
	}

	adbPath := firstNonEmptyString(source, "adb_path", "adbPath")
	address := firstNonEmptyString(source, "address")
	clientType := firstNonEmptyString(source, "client_type", "clientType")

	autoReconnect, hasAutoReconnect := firstBool(source, "auto_reconnect", "autoReconnect")
	if !hasAutoReconnect {
		if behavior, ok := profile["behavior"].(map[string]any); ok {
			autoReconnect, hasAutoReconnect = firstBool(behavior, "auto_reconnect", "autoReconnect")
		}
	}

	// getConfig gives [instance_options].touch_mode precedence over the
	// connection section; fall back to the connection section when absent.
	touchMode := ""
	if instanceOptions, ok := profile["instance_options"].(map[string]any); ok {
		touchMode = firstNonEmptyString(instanceOptions, "touch_mode", "touchMode")
	}
	if touchMode == "" {
		touchMode = firstNonEmptyString(source, "touch_mode", "touchMode")
	}

	if value, ok := overrideString(overrides, "adbPath", "adb_path"); ok {
		adbPath = value
	}
	if value, ok := overrideString(overrides, "address"); ok {
		address = value
	}
	if value, ok := overrideString(overrides, "clientType", "client_type"); ok {
		clientType = value
	}
	if value, ok := overrideString(overrides, "touchMode", "touch_mode"); ok {
		touchMode = value
	}
	if value, ok := firstBool(overrides, "autoReconnect", "auto_reconnect"); ok {
		autoReconnect = value
	} else if !hasAutoReconnect {
		autoReconnect = false
	}

	if adbPath == "" {
		adbPath = defaults.ADBPath
	}
	if address == "" {
		address = defaults.Address
	}
	if clientType == "" {
		clientType = defaults.ClientType
	}

	return ResolvedConnection{
		ADBPath:       adbPath,
		Address:       address,
		ClientType:    clientType,
		TouchMode:     touchMode,
		AutoReconnect: autoReconnect,
	}, nil
}

func firstNonEmptyString(source map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := source[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

func firstBool(source map[string]any, keys ...string) (bool, bool) {
	for _, key := range keys {
		if value, ok := source[key].(bool); ok {
			return value, true
		}
	}
	return false, false
}

func overrideString(source map[string]any, keys ...string) (string, bool) {
	for _, key := range keys {
		if value, ok := source[key].(string); ok {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				return trimmed, true
			}
		}
	}
	return "", false
}

// jsTruthy follows JavaScript truthiness for the scalar values TOML
// can produce. Maps and arrays are always truthy, as in JavaScript.
func jsTruthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case int:
		return typed != 0
	case int8:
		return typed != 0
	case int16:
		return typed != 0
	case int32:
		return typed != 0
	case int64:
		return typed != 0
	case uint:
		return typed != 0
	case uint8:
		return typed != 0
	case uint16:
		return typed != 0
	case uint32:
		return typed != 0
	case uint64:
		return typed != 0
	case float32:
		return typed != 0
	case float64:
		return typed != 0
	default:
		return true
	}
}
