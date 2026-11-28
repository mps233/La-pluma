package training

import (
	"math"
	"time"

	"github.com/mps233/la-pluma/go/internal/util/jsval"
	"github.com/mps233/la-pluma/go/internal/util/timefmt"
)

// asRecord accepts the settings map type in addition to decoded JSON objects.
func asRecord(value any) (map[string]any, bool) {
	if settings, ok := value.(TrainingSettings); ok {
		return map[string]any(settings), true
	}
	record := jsval.Record(value)
	return record, record != nil
}

func asArray(value any) ([]any, bool) {
	array := jsval.Array(value)
	return array, array != nil
}

// numberOr mirrors `jsval.FiniteNumber(value) ?? fallback`.
func numberOr(value any, fallback float64) float64 {
	if number, ok := jsval.FiniteNumber(value); ok {
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
	if jsval.Truthy(value) {
		return value
	}
	return float64(0)
}

func settingString(settings TrainingSettings, key string) (string, bool) {
	return jsval.TextOK(settingValue(settings, key))
}

func formatISO(now time.Time) string {
	return timefmt.FormatMillis(now)
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
