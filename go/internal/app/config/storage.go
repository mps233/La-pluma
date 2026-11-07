package config

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	platformconfig "github.com/mps233/la-pluma/go/internal/config"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

// allowedConfigTypes mirrors ALLOWED_CONFIG_TYPES in
// server/services/configStorageService.ts.
var allowedConfigTypes = map[string]struct{}{
	"activity-cache":   {},
	"auto-update":      {},
	"automation-tasks": {},
	"combat-tasks":     {},
	"notification":     {},
	"roguelike-tasks":  {},
	"training-queue":   {},
}

// Storage owns user config JSON files under <data-dir>/user-configs.
type Storage struct {
	paths platformconfig.Paths
}

func NewStorage(paths platformconfig.Paths) *Storage {
	return &Storage{paths: paths}
}

// ValidateConfigType accepts only the explicit user config types. The typed
// value keeps callers from ever composing a traversal path.
func ValidateConfigType(configType string) (string, error) {
	if _, ok := allowedConfigTypes[configType]; !ok {
		return "", invalidConfigType(configType)
	}
	return configType, nil
}

func (s *Storage) dir() string {
	return filepath.Join(s.paths.DataDir, "user-configs")
}

func (s *Storage) pathFor(configType string) (string, error) {
	normalized, err := ValidateConfigType(configType)
	if err != nil {
		return "", err
	}
	dir := filepath.Clean(s.dir())
	path := filepath.Join(dir, normalized+".json")
	if filepath.Dir(path) != dir {
		return "", invalidConfigType(configType)
	}
	return path, nil
}

// Load reads one user config. A missing file yields a nil map, matching the
// null data returned by loadUserConfig. Only JSON objects are representable
// through this typed API.
func (s *Storage) Load(configType string) (map[string]any, error) {
	path, err := s.pathFor(configType)
	if err != nil {
		return nil, err
	}
	value, err := jsonstore.Read(path, nil)
	if err != nil {
		return nil, configOperationError(CodeConfigLoadFailed, "读取配置失败")
	}
	if value == nil {
		return nil, nil
	}
	record, ok := value.(map[string]any)
	if !ok {
		return nil, configOperationError(CodeConfigLoadFailed, "读取配置失败")
	}
	return record, nil
}

// Save writes one user config atomically as pretty JSON, creating the config
// directory when needed.
func (s *Storage) Save(configType string, value any) error {
	path, err := s.pathFor(configType)
	if err != nil {
		return err
	}
	if err := jsonstore.Write(path, value, true); err != nil {
		return configOperationError(CodeConfigSaveFailed, "保存配置失败")
	}
	return nil
}

// Delete removes one user config. A missing file is a successful no-op, as in
// deleteUserConfig.
func (s *Storage) Delete(configType string) error {
	path, err := s.pathFor(configType)
	if err != nil {
		return err
	}
	// os.Remove deletes an empty directory, while unlink in the Node service
	// never does. A directory at the config path is a delete failure.
	if info, err := os.Lstat(path); err == nil && info.IsDir() {
		return configOperationError(CodeConfigDeleteFailed, "删除配置失败")
	}
	if err := os.Remove(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return configOperationError(CodeConfigDeleteFailed, "删除配置失败")
	}
	return nil
}

// List returns the sorted names of stored, allowed config types. Unlike
// getAllUserConfigs it does not decode each file; callers can Load the types
// they need.
func (s *Storage) List() ([]string, error) {
	dir := s.dir()
	if err := jsonstore.EnsureDir(dir); err != nil {
		return nil, configOperationError(CodeConfigListFailed, "获取配置列表失败")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, configOperationError(CodeConfigListFailed, "获取配置列表失败")
	}
	configTypes := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		configType := strings.TrimSuffix(name, ".json")
		if _, ok := allowedConfigTypes[configType]; !ok {
			continue
		}
		configTypes = append(configTypes, configType)
	}
	sort.Strings(configTypes)
	return configTypes, nil
}
