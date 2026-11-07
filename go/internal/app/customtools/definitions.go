package customtools

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

// customToolsDir is the runtime directory holding optional tool definitions.
// A missing directory is normal and leaves the built-in definitions active.
const customToolsDir = "custom-tools"

// Definition is one runnable Custom task. The fields mirror the whitelist
// entries in server/services/customTaskService.ts. JSON definition files may
// use either camelCase (taskNames, paramsKey) or snake_case (task_names,
// params_key).
type Definition struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	TaskNames   []string `json:"taskNames"`
	ParamsKey   string   `json:"paramsKey,omitempty"`
}

// Tool is the public listCustomTools() shape consumed by the client. ParamsKey
// is null rather than omitted for tools without parameters.
type Tool struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Description    string  `json:"description"`
	RequiresParams bool    `json:"requiresParams"`
	ParamsKey      *string `json:"paramsKey"`
}

// builtinDefinitions returns a fresh copy of the five whitelisted tools from
// the Node service. Definitions loaded from Paths.DataDir/custom-tools are
// merged over these, matching ids in place and appending new tools.
func builtinDefinitions() []Definition {
	return []Definition{
		{
			ID:          "pixel-paint",
			Name:        "像素画填色",
			Description: "按 24×24 点阵和色板序号自动填色。",
			TaskNames:   []string{"MiniGame@PixelPaint@Begin"},
			ParamsKey:   "pixel_paint",
		},
		{
			ID:          "auto-raise-potential",
			Name:        "自动提升潜能",
			Description: "从干员列表自动提升带提示标记的干员潜能。",
			TaskNames:   []string{"MiniGame@AutoRaisePotential@Begin"},
			ParamsKey:   "auto_raise_potential",
		},
		{
			ID:          "material-synthesis",
			Name:        "缺口材料合成",
			Description: "从缺少材料的弹窗进入加工站，递归合成下级材料。",
			TaskNames:   []string{"MiniGame@MaterialSynthesis@Begin"},
		},
		{
			ID:          "cursed-relic",
			Name:        "刷傀影维多利亚皇冠",
			Description: "反复开始傀影肉鸽探索，刷到维多利亚王冠后停止。",
			TaskNames:   []string{"MiniGame@CursedRelic@Begin"},
		},
		{
			ID:          "event-shop-blacklist",
			Name:        "活动商店兑换",
			Description: "自动购买活动商店商品，可配置不购买的商品名。",
			TaskNames:   []string{"SS@Store@Begin"},
			ParamsKey:   "event_shop",
		},
	}
}

// definitions merges the built-ins with JSON files from the custom-tools
// directory. Files are read in name order; a later definition with the same id
// replaces the earlier one while keeping its list position.
func (s *Service) definitions() ([]Definition, error) {
	merged := builtinDefinitions()
	custom, err := loadCustomDefinitions(s.paths.DataDir)
	if err != nil {
		return nil, err
	}

	positions := make(map[string]int, len(merged))
	for index := range merged {
		positions[merged[index].ID] = index
	}
	for _, definition := range custom {
		if index, ok := positions[definition.ID]; ok {
			merged[index] = definition
			continue
		}
		positions[definition.ID] = len(merged)
		merged = append(merged, definition)
	}
	return merged, nil
}

// loadCustomDefinitions reads *.json files under dataDir/custom-tools. Each
// file may contain one definition object, an array of definitions, or an
// object with a "tools" array. Ids missing from a single-object file fall back
// to the file name without its extension.
func loadCustomDefinitions(dataDir string) ([]Definition, error) {
	dir := filepath.Join(dataDir, customToolsDir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, apperrors.WithStatus(
			"AGENT_CUSTOM_TOOL_DEFINITIONS_FAILED",
			"自定义工具目录读取失败",
			http.StatusInternalServerError,
			true,
			map[string]any{"path": dir, "error": err.Error()},
		)
	}

	var definitions []Definition
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || strings.HasPrefix(name, ".") || !strings.EqualFold(filepath.Ext(name), ".json") {
			continue
		}
		path := filepath.Join(dir, name)
		value, err := jsonstore.Read(path, nil)
		if err != nil {
			return nil, definitionError(name, "JSON 解析失败: "+err.Error(), nil)
		}
		fallbackID := strings.TrimSuffix(name, filepath.Ext(name))
		parsed, reason := parseDefinitionDocument(value, fallbackID)
		if reason != "" {
			return nil, definitionError(name, reason, nil)
		}
		definitions = append(definitions, parsed...)
	}
	return definitions, nil
}

func definitionError(fileName, reason string, extra map[string]any) *apperrors.Error {
	details := map[string]any{"file": fileName, "reason": reason}
	for key, value := range extra {
		details[key] = value
	}
	return apperrors.WithStatus(
		"AGENT_CUSTOM_TOOL_DEFINITION_INVALID",
		"自定义工具定义不合法: "+reason,
		http.StatusInternalServerError,
		false,
		details,
	)
}

func parseDefinitionDocument(value any, fallbackID string) ([]Definition, string) {
	switch typed := value.(type) {
	case []any:
		return parseDefinitionList(typed, "")
	case map[string]any:
		if rawTools, ok := typed["tools"]; ok {
			items, ok := toSlice(rawTools)
			if !ok {
				return nil, "tools 必须是数组"
			}
			return parseDefinitionList(items, "")
		}
		definition, reason := parseDefinition(typed, fallbackID)
		if reason != "" {
			return nil, reason
		}
		return []Definition{definition}, ""
	default:
		return nil, "定义必须是对象或数组"
	}
}

func parseDefinitionList(items []any, fallbackID string) ([]Definition, string) {
	definitions := make([]Definition, 0, len(items))
	for index, item := range items {
		record, ok := toRecord(item)
		if !ok {
			return nil, "第 " + itoa(index+1) + " 个定义必须是对象"
		}
		definition, reason := parseDefinition(record, fallbackID)
		if reason != "" {
			return nil, "第 " + itoa(index+1) + " 个定义: " + reason
		}
		definitions = append(definitions, definition)
	}
	if len(definitions) == 0 {
		return nil, "至少需要一个定义"
	}
	return definitions, ""
}

func parseDefinition(record map[string]any, fallbackID string) (Definition, string) {
	var definition Definition
	definition.ID = strings.TrimSpace(stringValue(record["id"]))
	if definition.ID == "" {
		definition.ID = fallbackID
	}
	if definition.ID == "" {
		return definition, "缺少 id"
	}
	definition.Name = strings.TrimSpace(stringValue(record["name"]))
	if definition.Name == "" {
		definition.Name = definition.ID
	}
	definition.Description = strings.TrimSpace(stringValue(record["description"]))

	taskNamesValue, hasTaskNames := firstValue(record, "taskNames", "task_names")
	if !hasTaskNames {
		return definition, "taskNames 必须是非空字符串数组"
	}
	taskNames, ok := toSlice(taskNamesValue)
	if !ok || len(taskNames) == 0 {
		return definition, "taskNames 必须是非空字符串数组"
	}
	for _, item := range taskNames {
		name, ok := item.(string)
		name = strings.TrimSpace(name)
		if !ok || name == "" {
			return definition, "taskNames 必须是非空字符串数组"
		}
		definition.TaskNames = append(definition.TaskNames, name)
	}

	if paramsKeyValue, ok := firstValue(record, "paramsKey", "params_key"); ok && paramsKeyValue != nil {
		paramsKey, ok := paramsKeyValue.(string)
		if !ok {
			return definition, "paramsKey 必须是字符串"
		}
		definition.ParamsKey = strings.TrimSpace(paramsKey)
	}
	return definition, ""
}

func firstValue(record map[string]any, keys ...string) (any, bool) {
	for _, key := range keys {
		if value, ok := record[key]; ok {
			return value, true
		}
	}
	return nil, false
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func toolFromDefinition(definition Definition) Tool {
	tool := Tool{
		ID:             definition.ID,
		Name:           definition.Name,
		Description:    definition.Description,
		RequiresParams: definition.ParamsKey != "",
	}
	if definition.ParamsKey != "" {
		key := definition.ParamsKey
		tool.ParamsKey = &key
	}
	return tool
}

// customToolsPath exposes the directory for diagnostics and tests.
func customToolsPath(paths config.Paths) string {
	return filepath.Join(paths.DataDir, customToolsDir)
}
