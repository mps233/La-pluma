package scheduler

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mps233/la-pluma/go/internal/util/jsval"
	"github.com/mps233/la-pluma/go/internal/util/timefmt"
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
	return jsval.Record(value)
}

func mapField(source map[string]any, key string) map[string]any {
	if source == nil {
		return nil
	}
	return jsval.Record(source[key])
}

func stringField(source map[string]any, key string) string {
	if source == nil {
		return ""
	}
	return jsval.Text(source[key])
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
	return configuredNumber(source[key])
}

// explicitlyDisabled mirrors task.enabled !== false: anything except the
// boolean false still participates in validation.
func explicitlyDisabled(task map[string]any) bool {
	value, ok := task["enabled"].(bool)
	return ok && !value
}

// taskEnabled mirrors task.enabled in execution and plan filters.
func taskEnabled(task map[string]any) bool {
	return jsval.Truthy(task["enabled"])
}

// numberValue treats a blank string as absent rather than Number("") == 0;
// scheduler parameters use "" to mean "not configured".
func configuredNumber(value any) (float64, bool) {
	if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
		return 0, false
	}
	return jsval.FiniteNumber(value)
}

func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		if text, ok := jsval.TextOK(value); ok && text != "" {
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
			rawEntries = append(rawEntries, key+"="+jsval.StringOrNullish(typed[key]))
		}
	case string:
		for _, entry := range strings.Split(typed, ",") {
			entry = strings.TrimSpace(entry)
			if entry != "" {
				rawEntries = append(rawEntries, entry)
			}
		}
	default:
		for _, entry := range strings.Split(jsval.StringOrNullish(value), ",") {
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
	return timefmt.FormatMillis(time.UnixMilli(epochMillis))
}
