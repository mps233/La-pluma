package results

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// asRecord narrows an arbitrary value to the JSON object shape used by MAA
// callbacks. Non-objects behave like an empty object.
func asRecord(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return nil
}

// coalesceValue mirrors the nullish coalescing operator: it returns the first
// key that is present with a non-nil value.
func coalesceValue(record map[string]any, keys ...string) any {
	if record == nil {
		return nil
	}
	for _, key := range keys {
		if value, ok := record[key]; ok && value != nil {
			return value
		}
	}
	return nil
}

// hasField reports whether the key exists, regardless of its value. JavaScript
// treats an absent key and an explicit null differently in a few places.
func hasField(record map[string]any, key string) bool {
	if record == nil {
		return false
	}
	_, ok := record[key]
	return ok
}

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
		// Arrays and objects are truthy in JavaScript.
		return true
	}
}

// stringValue approximates JavaScript String(). It is used where the Node code
// calls String(value) directly, including on nil values.
func stringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return "null"
	case string:
		return typed
	case []byte:
		return string(typed)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case json.Number:
		return typed.String()
	case float64:
		if math.IsNaN(typed) {
			return "NaN"
		}
		if math.IsInf(typed, 1) {
			return "Infinity"
		}
		if math.IsInf(typed, -1) {
			return "-Infinity"
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return stringValue(float64(typed))
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
	case []any:
		return joinStringValues(typed)
	case []string:
		return strings.Join(typed, ",")
	case map[string]any:
		return "[object Object]"
	default:
		return "[object Object]"
	}
}

func joinStringValues(values []any) string {
	parts := make([]string, len(values))
	for index, value := range values {
		// Array.prototype.join renders null and undefined as empty strings.
		if value == nil {
			parts[index] = ""
			continue
		}
		parts[index] = stringValue(value)
	}
	return strings.Join(parts, ",")
}

// truthyString mirrors String(value || ”).
func truthyString(value any) string {
	if !truthy(value) {
		return ""
	}
	return stringValue(value)
}

// trimTruthyString mirrors String(value || ”).trim().
func trimTruthyString(value any) string {
	return strings.TrimSpace(truthyString(value))
}

// numberValue approximates Number(value) and reports whether the result is
// finite. A nil value maps to 0, matching Number(null); callers that need to
// distinguish a missing field check hasField first.
func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case nil:
		return 0, true
	case bool:
		if typed {
			return 1, true
		}
		return 0, true
	case json.Number:
		parsed, err := typed.Float64()
		if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
			return 0, false
		}
		return parsed, true
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return 0, false
		}
		return typed, true
	case float32:
		return numberValue(float64(typed))
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
		text := strings.TrimSpace(typed)
		if text == "" {
			return 0, true
		}
		parsed, err := strconv.ParseFloat(text, 64)
		if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

// nativeNumber converts decoder-owned json.Number values to float64 so Go
// callers and JSON marshaling see the same numeric shape as Node.
func nativeNumber(value any) any {
	if number, ok := value.(json.Number); ok {
		if parsed, err := number.Float64(); err == nil {
			return parsed
		}
	}
	return value
}

func numberOrZero(value any) float64 {
	number, ok := numberValue(value)
	if !ok {
		return 0
	}
	return number
}

// lookupNumber converts a field that must exist. Missing and NaN-like values
// report false; an explicit null reports (0, true) like Number(null).
func lookupNumber(record map[string]any, key string) (float64, bool) {
	if !hasField(record, key) {
		return 0, false
	}
	return numberValue(record[key])
}

// indexOrNil mirrors Number(value) || null.
func indexOrNil(value any) any {
	number, ok := numberValue(value)
	if !ok || number == 0 {
		return nil
	}
	return number
}

// asAnySlice accepts both parser-produced []any and hand-built []string.
func asAnySlice(value any) ([]any, bool) {
	switch typed := value.(type) {
	case []any:
		return typed, true
	case []string:
		values := make([]any, len(typed))
		for index, item := range typed {
			values[index] = item
		}
		return values, true
	default:
		return nil, false
	}
}

func stringSlice(value any) []string {
	values, ok := asAnySlice(value)
	if !ok {
		return nil
	}
	result := make([]string, len(values))
	for index, item := range values {
		result[index] = stringValue(item)
	}
	return result
}

func uniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

// uniqueNonEmptyStrings mirrors the Node helper that keeps non-empty strings
// from arbitrary mixed arrays.
func uniqueNonEmptyStrings(values []any) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		text, ok := value.(string)
		if !ok || strings.TrimSpace(text) == "" {
			continue
		}
		if _, exists := seen[text]; exists {
			continue
		}
		seen[text] = struct{}{}
		result = append(result, text)
	}
	return result
}

func firstTruthy(values ...any) any {
	for _, value := range values {
		if truthy(value) {
			return value
		}
	}
	return nil
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func itoa(value int) string {
	return strconv.Itoa(value)
}

func pushCapped[T any](values []T, value T, limit int) []T {
	values = append(values, value)
	if len(values) > limit {
		values = values[len(values)-limit:]
	}
	return values
}
