package scheduler

import (
	"path/filepath"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

var restorableConfigTypes = map[string]struct{}{
	"automation-tasks": {},
	"auto-update":      {},
}

// FileConfigSource reads the same user-config files as
// internal/app/config.Storage without importing that package (which would be a
// cycle once the app wires the scheduler).
type FileConfigSource struct {
	paths config.Paths
}

func NewFileConfigSource(paths config.Paths) *FileConfigSource {
	return &FileConfigSource{paths: paths}
}

func (s *FileConfigSource) Load(configType string) (map[string]any, error) {
	if _, ok := restorableConfigTypes[configType]; !ok {
		return nil, apperrors.Validation("SCHEDULER_CONFIG_TYPE_INVALID", "定时任务无法读取该配置", map[string]any{"configType": configType})
	}
	path := filepath.Join(s.paths.DataDir, "user-configs", configType+".json")
	value, err := jsonstore.Read(path, nil)
	if err != nil {
		return nil, apperrors.WithStatus("SCHEDULER_CONFIG_LOAD_FAILED", "读取配置失败", 500, true, map[string]any{"configType": configType})
	}
	if value == nil {
		return nil, nil
	}
	record, ok := value.(map[string]any)
	if !ok {
		return nil, apperrors.WithStatus("SCHEDULER_CONFIG_LOAD_FAILED", "配置格式无效", 500, false, map[string]any{"configType": configType})
	}
	return record, nil
}
