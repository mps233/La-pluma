package training

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"
)

func asRecord(value any) (map[string]any, bool) {
	switch typed := value.(type) {
	case map[string]any:
		return typed, true
	case TrainingSettings:
		return map[string]any(typed), true
	default:
		return nil, false
	}
}

func asArray(value any) ([]any, bool) {
	array, ok := value.([]any)
	return array, ok
}

// toFiniteNumber mirrors the Node helper: Number(value) followed by
// Number.isFinite. A nil value (absent property) is not a finite number.
func toFiniteNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case nil:
		return 0, false
	case bool:
		if typed {
			return 1, true
		}
		return 0, true
	case json.Number:
		number, err := typed.Float64()
		if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
			return 0, false
		}
		return number, true
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return 0, false
		}
		return typed, true
	case float32:
		number := float64(typed)
		if math.IsNaN(number) || math.IsInf(number, 0) {
			return 0, false
		}
		return number, true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0, true
		}
		number, err := strconv.ParseFloat(trimmed, 64)
		if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
			return 0, false
		}
		return number, true
	default:
		return 0, false
	}
}

// jsonNumberValue reports whether value is a JSON numeric primitive (as
// opposed to a numeric string), which is what strict comparison needs.
func jsonNumberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil && !math.IsNaN(number) && !math.IsInf(number, 0)
	case float64:
		return typed, !math.IsNaN(typed) && !math.IsInf(typed, 0)
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	default:
		return 0, false
	}
}

// jsStringApprox mirrors String(value) for the scalar shapes found in the
// training data. Objects/arrays are not used as identifiers by the service.
func jsStringApprox(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}

// isTruthy implements JavaScript truthiness for the JSON shapes used here.
func isTruthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case json.Number:
		number, err := typed.Float64()
		if err != nil {
			return true
		}
		return number != 0 && !math.IsNaN(number)
	case float64:
		return typed != 0 && !math.IsNaN(typed)
	case float32:
		return typed != 0 && !math.IsNaN(float64(typed))
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case int32:
		return typed != 0
	case uint64:
		return typed != 0
	case []any:
		return true
	case map[string]any:
		return true
	default:
		return true
	}
}

// numberOr mirrors `toFiniteNumber(value) ?? fallback`.
func numberOr(value any, fallback float64) float64 {
	if number, ok := toFiniteNumber(value); ok {
		return number
	}
	return fallback
}

func defaultTrainingSettings() TrainingSettings {
	return TrainingSettings{
		"autoSwitch":       true,
		"notifyOnComplete": true,
		"useMedicine":      float64(0),
		"useStone":         float64(0),
	}
}

// normalizeTrainingSettings mirrors the Node normalization: copy the record,
// migrate the legacy `notify` flag, then overlay the defaults.
func normalizeTrainingSettings(value any) TrainingSettings {
	normalized := TrainingSettings{}
	if record, ok := asRecord(value); ok {
		for key, item := range record {
			normalized[key] = item
		}
	}
	if notify, ok := normalized["notify"].(bool); ok {
		if _, alreadyBoolean := normalized["notifyOnComplete"].(bool); !alreadyBoolean {
			normalized["notifyOnComplete"] = notify
		}
	}
	delete(normalized, "notify")

	result := defaultTrainingSettings()
	for key, item := range normalized {
		result[key] = item
	}
	return result
}

func cloneSettings(settings TrainingSettings) TrainingSettings {
	clone := TrainingSettings{}
	for key, value := range settings {
		clone[key] = value
	}
	return clone
}

func mergeSettings(base TrainingSettings, overrides map[string]any) TrainingSettings {
	merged := cloneSettings(base)
	for key, value := range overrides {
		merged[key] = value
	}
	return merged
}

func settingValue(settings TrainingSettings, key string) any {
	if settings == nil {
		return nil
	}
	return settings[key]
}

// settingOrZero mirrors `value || 0` for medicine/stone emission.
func settingOrZero(settings TrainingSettings, key string) any {
	value := settingValue(settings, key)
	if isTruthy(value) {
		return value
	}
	return float64(0)
}

func settingString(settings TrainingSettings, key string) (string, bool) {
	value, ok := settingValue(settings, key).(string)
	return value, ok
}

func formatISO(now time.Time) string {
	return now.UTC().Format("2006-01-02T15:04:05.000Z")
}

func roundProgress(value float64) int {
	if value < 0 {
		value = 0
	}
	if value > 100 {
		value = 100
	}
	return int(math.Round(value))
}
