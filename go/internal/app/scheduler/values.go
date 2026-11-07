package scheduler

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var dropTargetPattern = regexp.MustCompile(`^([A-Za-z0-9_-]+)\s*=\s*(\d+)$`)

var commaSeparatedArrayKeys = map[string]struct{}{
	"buy_first":         {},
	"blacklist":         {},
	"first_tags":        {},
	"preserve_tags":     {},
	"fiammetta_targets": {},
}

func asMap(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return nil
}

func mapField(source map[string]any, key string) map[string]any {
	if source == nil {
		return nil
	}
	return asMap(source[key])
}

func stringField(source map[string]any, key string) string {
	if source == nil {
		return ""
	}
	value, ok := source[key].(string)
	if !ok {
		return ""
	}
	return value
}

func boolField(source map[string]any, key string) bool {
	if source == nil {
		return false
	}
	value, _ := source[key].(bool)
	return value
}

func numberField(source map[string]any, key string) (float64, bool) {
	if source == nil {
		return 0, false
	}
	return numberValue(source[key])
}

// truthy approximates JavaScript truthiness for JSON-decoded values.
func truthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case float64:
		return typed != 0 && !math.IsNaN(typed)
	case float32:
		return typed != 0 && !math.IsNaN(float64(typed))
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case json.Number:
		number, err := typed.Float64()
		return err == nil && number != 0 && !math.IsNaN(number)
	case []any:
		return true
	case []string:
		return true
	case map[string]any:
		return true
	default:
		return true
	}
}

// explicitlyDisabled mirrors task.enabled !== false: anything except the
// boolean false still participates in validation.
func explicitlyDisabled(task map[string]any) bool {
	value, ok := task["enabled"].(bool)
	return ok && !value
}

// taskEnabled mirrors task.enabled in execution and plan filters.
func taskEnabled(task map[string]any) bool {
	return truthy(task["enabled"])
}

func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0, false
		}
		number, err := strconv.ParseFloat(trimmed, 64)
		return number, err == nil
	default:
		return 0, false
	}
}

func numericValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64, float32, int, int64, json.Number:
		return numberValue(typed)
	default:
		return 0, false
	}
}

func jsString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 32)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case json.Number:
		return typed.String()
	default:
		return fmt.Sprintf("%v", value)
	}
}

func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		if text, ok := value.(string); ok && text != "" {
			return text
		}
	}
	return ""
}

func copyMap(source map[string]any) map[string]any {
	copied := make(map[string]any, len(source))
	for key, value := range source {
		copied[key] = value
	}
	return copied
}

// parseDropTargetEntries mirrors parseDropTargetEntries. The second return is
// false for invalid input, matching the Node null sentinel.
func parseDropTargetEntries(value any) ([]string, bool) {
	if value == nil {
		return []string{}, true
	}
	if text, ok := value.(string); ok && text == "" {
		return []string{}, true
	}

	var rawEntries []string
	switch typed := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			rawEntries = append(rawEntries, key+"="+jsString(typed[key]))
		}
	case string:
		for _, entry := range strings.Split(typed, ",") {
			entry = strings.TrimSpace(entry)
			if entry != "" {
				rawEntries = append(rawEntries, entry)
			}
		}
	default:
		for _, entry := range strings.Split(jsString(value), ",") {
			entry = strings.TrimSpace(entry)
			if entry != "" {
				rawEntries = append(rawEntries, entry)
			}
		}
	}

	normalized := make([]string, 0, len(rawEntries))
	for _, entry := range rawEntries {
		match := dropTargetPattern.FindStringSubmatch(entry)
		if match == nil {
			return nil, false
		}
		count, err := strconv.ParseInt(match[2], 10, 64)
		if err != nil || count <= 0 {
			return nil, false
		}
		normalized = append(normalized, fmt.Sprintf("%s=%d", match[1], count))
	}
	return normalized, true
}

func dropTargetMap(entries []string) map[string]any {
	if len(entries) == 0 {
		return nil
	}
	drops := make(map[string]any, len(entries))
	for _, entry := range entries {
		parts := strings.SplitN(entry, "=", 2)
		if len(parts) != 2 {
			continue
		}
		count, err := strconv.ParseFloat(parts[1], 64)
		if err != nil {
			continue
		}
		drops[parts[0]] = count
	}
	return drops
}

func isoMillis(epochMillis int64) string {
	if epochMillis == 0 {
		return ""
	}
	return time.UnixMilli(epochMillis).UTC().Format("2006-01-02T15:04:05.000Z")
}
