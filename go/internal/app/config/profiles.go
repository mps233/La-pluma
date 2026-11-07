package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"

	"github.com/pelletier/go-toml/v2"
)

const DefaultProfileName = "default"

var profileNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

var (
	errInvalidConnection         = errors.New("connection 配置格式不合法")
	errInvalidExistingConnection = errors.New("现有 connection section 格式不合法")
)

// ValidateProfileName matches validateMaaProfileName in maaService.ts.
func ValidateProfileName(name string) (string, error) {
	if !profileNamePattern.MatchString(name) {
		return "", invalidProfileName(name)
	}
	return name, nil
}

// Profiles owns maa-cli TOML profiles under <maa-config-dir>/profiles.
type Profiles struct {
	// Dir is the profiles directory itself, not the maa-cli config root.
	Dir string
	// Defaults, when set, supplies the fallback connection values that
	// getConfig returns for a missing or unreadable profile. A nil value uses
	// ADB_PATH/ADB_ADDRESS/MAA_CLIENT_TYPE and platform defaults.
	Defaults *ConnectionDefaults
}

func NewProfiles(maaConfigDir string) *Profiles {
	return &Profiles{Dir: filepath.Join(maaConfigDir, "profiles")}
}

func (p *Profiles) connectionDefaults() ConnectionDefaults {
	if p.Defaults != nil {
		return *p.Defaults
	}
	return DefaultConnectionDefaults()
}

func (p *Profiles) pathFor(name string) (string, error) {
	normalized, err := ValidateProfileName(name)
	if err != nil {
		return "", err
	}
	dir := filepath.Clean(p.Dir)
	path := filepath.Join(dir, normalized+".toml")
	if filepath.Dir(path) != dir {
		return "", invalidProfileName(name)
	}
	return path, nil
}

// Load mirrors getConfig: it returns the connection section flattened with
// [behavior].auto_reconnect and [instance_options].touch_mode. Missing or
// malformed profiles fall back to connection defaults instead of failing, so
// callers always get a usable connection shape.
func (p *Profiles) Load(name string) (map[string]any, error) {
	path, err := p.pathFor(name)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return p.fallback(), nil
	}
	var profile map[string]any
	if err := toml.Unmarshal(data, &profile); err != nil {
		return p.fallback(), nil
	}
	if profile == nil {
		return map[string]any{}, nil
	}
	return flattenProfileConnection(profile), nil
}

func (p *Profiles) fallback() map[string]any {
	defaults := p.connectionDefaults()
	// "config" is the legacy key returned by maaService.getConfig's fallback.
	return map[string]any{
		"adb_path": defaults.ADBPath,
		"address":  defaults.Address,
		"config":   "CompatMac",
	}
}

// Save mirrors saveConfig: read the existing profile, merge the connection
// updates while preserving unknown sections, then atomically write TOML.
func (p *Profiles) Save(name string, value map[string]any) error {
	path, err := p.pathFor(name)
	if err != nil {
		return err
	}
	if value == nil {
		value = map[string]any{}
	}

	existing := map[string]any{}
	data, readErr := os.ReadFile(path)
	switch {
	case readErr == nil:
		if err := toml.Unmarshal(data, &existing); err != nil {
			return profileSaveError(err)
		}
		if existing == nil {
			existing = map[string]any{}
		}
	case !errors.Is(readErr, os.ErrNotExist):
		return profileSaveError(readErr)
	}

	merged, err := mergeMaaProfileConnection(existing, value)
	if err != nil {
		return profileSaveError(err)
	}
	encoded, err := toml.Marshal(merged)
	if err != nil {
		return profileSaveError(err)
	}
	if err := writeAtomic(path, encoded); err != nil {
		return profileSaveError(err)
	}
	return nil
}

// MergeConnection applies the same connection/behavior/instance_options
// migration as mergeMaaProfileConnection. Invalid section shapes yield nil;
// Save validates the same input through its error-returning path.
func (p *Profiles) MergeConnection(profile, connection map[string]any) map[string]any {
	merged, err := mergeMaaProfileConnection(profile, connection)
	if err != nil {
		return nil
	}
	return merged
}

func flattenProfileConnection(profile map[string]any) map[string]any {
	source := profile
	if connection, ok := profile["connection"].(map[string]any); ok {
		source = connection
	}
	result := make(map[string]any, len(source)+2)
	for key, value := range source {
		result[key] = value
	}
	if behavior, ok := profile["behavior"].(map[string]any); ok {
		if value, exists := behavior["auto_reconnect"]; exists {
			if _, exists := result["auto_reconnect"]; !exists {
				result["auto_reconnect"] = value
			}
		}
	}
	if instanceOptions, ok := profile["instance_options"].(map[string]any); ok {
		if value, exists := instanceOptions["touch_mode"]; exists && jsTruthy(value) {
			result["touch_mode"] = value
		}
	}
	return result
}

func mergeMaaProfileConnection(profile, connection map[string]any) (map[string]any, error) {
	if profile == nil {
		profile = map[string]any{}
	}
	if connection == nil {
		connection = map[string]any{}
	}

	rawConnection := any(connection)
	if value, exists := connection["connection"]; exists {
		rawConnection = value
	}
	updates, ok := rawConnection.(map[string]any)
	if !ok {
		return nil, errInvalidConnection
	}

	existingConnection := map[string]any{}
	if value, exists := profile["connection"]; exists && value != nil {
		record, ok := value.(map[string]any)
		if !ok {
			return nil, errInvalidExistingConnection
		}
		existingConnection = record
	}

	var (
		autoReconnect    any
		hasAutoReconnect bool
		touchMode        any
		hasTouchMode     bool
	)
	connectionOnlyUpdates := make(map[string]any, len(updates))
	for key, value := range updates {
		// The Node merge drops undefined values; nil is the Go equivalent and
		// TOML cannot represent it anyway.
		if value == nil {
			continue
		}
		switch key {
		case "auto_reconnect":
			autoReconnect, hasAutoReconnect = value, true
		case "touch_mode":
			touchMode, hasTouchMode = value, true
		default:
			connectionOnlyUpdates[key] = value
		}
	}

	mergedConnection := make(map[string]any, len(existingConnection)+len(connectionOnlyUpdates))
	for key, value := range existingConnection {
		// maa-cli 0.7.3+ reads these from [behavior]/[instance_options].
		if key == "auto_reconnect" || key == "touch_mode" {
			continue
		}
		mergedConnection[key] = value
	}
	for key, value := range connectionOnlyUpdates {
		mergedConnection[key] = value
	}

	result := make(map[string]any, len(profile)+2)
	for key, value := range profile {
		result[key] = value
	}
	result["connection"] = mergedConnection

	if hasAutoReconnect {
		behavior := map[string]any{}
		if existing, ok := profile["behavior"].(map[string]any); ok {
			behavior = make(map[string]any, len(existing)+1)
			for key, value := range existing {
				behavior[key] = value
			}
		}
		behavior["auto_reconnect"] = autoReconnect
		result["behavior"] = behavior
	}
	if hasTouchMode {
		instanceOptions := map[string]any{}
		if existing, ok := profile["instance_options"].(map[string]any); ok {
			instanceOptions = make(map[string]any, len(existing)+1)
			for key, value := range existing {
				instanceOptions[key] = value
			}
		}
		instanceOptions["touch_mode"] = touchMode
		result["instance_options"] = instanceOptions
	}

	return result, nil
}

// channelDisplay renders a channel value the way JavaScript's template
// interpolation would for the common input types.
func channelDisplay(channel any) string {
	if channel == nil {
		return "undefined"
	}
	return fmt.Sprint(channel)
}
