package copilot

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// asRecord narrows an arbitrary JSON value to an object. Arrays are not
// records, matching the Node isRecord helper.
func asRecord(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return nil
}

func asArray(value any) []any {
	if array, ok := value.([]any); ok {
		return array
	}
	return nil
}

func asString(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

// truthy mirrors JavaScript truthiness for the JSON value set.
func truthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case json.Number:
		number, err := typed.Float64()
		if err != nil || math.IsNaN(number) {
			return false
		}
		return number != 0
	case float64:
		return !math.IsNaN(typed) && typed != 0
	case float32:
		return !math.IsNaN(float64(typed)) && typed != 0
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
	default:
		return true
	}
}

// jsString mirrors JavaScript String(value) for JSON scalars. A nil value is
// treated as undefined; callers that need String(value || ”) use
// jsStringOrEmpty instead.
func jsString(value any) string {
	switch typed := value.(type) {
	case nil:
		return "undefined"
	case string:
		return typed
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case json.Number:
		return typed.String()
	case float64:
		return formatJSFloat(typed)
	case float32:
		return formatJSFloat(float64(typed))
	case int:
		return strconv.Itoa(typed)
	case int8:
		return strconv.FormatInt(int64(typed), 10)
	case int16:
		return strconv.FormatInt(int64(typed), 10)
	case int32:
		return strconv.FormatInt(int64(typed), 10)
	case int64:
		return strconv.FormatInt(typed, 10)
	case uint:
		return strconv.FormatUint(uint64(typed), 10)
	case uint8:
		return strconv.FormatUint(uint64(typed), 10)
	case uint16:
		return strconv.FormatUint(uint64(typed), 10)
	case uint32:
		return strconv.FormatUint(uint64(typed), 10)
	case uint64:
		return strconv.FormatUint(typed, 10)
	default:
		return ""
	}
}

func jsStringOrEmpty(value any) string {
	if value == nil {
		return ""
	}
	return jsString(value)
}

// jsStringTruthyOrEmpty mirrors String(value || ”) for JSON scalars: falsy
// values (0, false, "", null) become the empty string.
func jsStringTruthyOrEmpty(value any) string {
	if !truthy(value) {
		return ""
	}
	return jsString(value)
}

func formatJSFloat(value float64) string {
	if math.IsNaN(value) {
		return "NaN"
	}
	if math.IsInf(value, 1) {
		return "Infinity"
	}
	if math.IsInf(value, -1) {
		return "-Infinity"
	}
	// JS prints integral numbers without a decimal point.
	if value == math.Trunc(value) && math.Abs(value) < 1e21 {
		return strconv.FormatFloat(value, 'f', -1, 64)
	}
	return strconv.FormatFloat(value, 'g', -1, 64)
}

// numberValue mirrors Number(value). The second result is false when the
// value is undefined/absent or cannot be converted; callers usually coalesce
// that to zero.
func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case nil:
		return 0, false
	case bool:
		if typed {
			return 1, true
		}
		return 0, true
	case json.Number:
		parsed, err := typed.Float64()
		if err != nil {
			return 0, false
		}
		return parsed, true
	case float64:
		if math.IsNaN(typed) {
			return 0, false
		}
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int8:
		return float64(typed), true
	case int16:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint8:
		return float64(typed), true
	case uint16:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0, true
		}
		switch trimmed {
		case "Infinity", "+Infinity":
			return math.Inf(1), true
		case "-Infinity":
			return math.Inf(-1), true
		}
		parsed, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

func numberOrZero(value any) float64 {
	parsed, ok := numberValue(value)
	if !ok {
		return 0
	}
	return parsed
}

// integerValue mirrors Number.isInteger(Number(value)).
func integerValue(value any) (int, bool) {
	parsed, ok := numberValue(value)
	if !ok || math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed != math.Trunc(parsed) {
		return 0, false
	}
	return int(parsed), true
}

// decodeJSON parses JSON with json.Number, matching jsonstore and avoiding
// float precision loss for large ids.
func decodeJSON(data []byte, target any) error {
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.UseNumber()
	return decoder.Decode(target)
}

func copyRecord(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}
