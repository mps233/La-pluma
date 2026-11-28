// Package jsval implements the JavaScript value coercions the backend needs
// when it consumes upstream JSON that was shaped by JS code. The rules mirror
// JS semantics for the JSON value set; keep the differences explicit:
//
//   - String(value) treats nil as "undefined".
//   - StringJSON(value) treats nil as JSON null and renders "null", because
//     documents decoded from JSON cannot distinguish null from a missing key.
//   - StringOrNullish(value) is value ?? "" followed by String(value).
//   - StringOrEmpty(value) is String(value || ""), so 0, false, and "" all
//     become "".
//
// Use these instead of growing another package-local copy.
package jsval

import (
	"bytes"
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// Record narrows an arbitrary JSON value to an object. Arrays are not records,
// matching the Node isRecord helper.
func Record(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return nil
}

// Array narrows an arbitrary JSON value to an array.
func Array(value any) []any {
	if array, ok := value.([]any); ok {
		return array
	}
	return nil
}

// Text returns value when it is a string and "" otherwise. This is a type
// assertion, not JS String coercion; use String when numbers or booleans
// should be rendered.
func Text(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

// String mirrors JavaScript String(value) for JSON scalars. Nil is treated as
// undefined; use StringOrNullish or StringOrEmpty for the other common idioms.
func String(value any) string {
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
		return FormatFloat(typed)
	case float32:
		return FormatFloat(float64(typed))
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

// StringJSON mirrors String(value) for JSON-decoded documents, where nil is a
// real null rather than an absent/undefined value. It renders null as "null",
// joins arrays with commas (null entries become empty), and renders objects as
// "[object Object]".
func StringJSON(value any) string {
	switch typed := value.(type) {
	case nil:
		return "null"
	case []any:
		parts := make([]string, len(typed))
		for index, item := range typed {
			if item == nil {
				continue
			}
			parts[index] = StringJSON(item)
		}
		return strings.Join(parts, ",")
	case []string:
		return strings.Join(typed, ",")
	case map[string]any:
		return "[object Object]"
	default:
		return String(value)
	}
}

// StringOrNullish mirrors value ?? "" followed by String(value).
func StringOrNullish(value any) string {
	if value == nil {
		return ""
	}
	return String(value)
}

// StringOrEmpty mirrors String(value || ""): falsy values become "".
func StringOrEmpty(value any) string {
	if !Truthy(value) {
		return ""
	}
	return String(value)
}

// Truthy mirrors JavaScript truthiness for the JSON value set.
func Truthy(value any) bool {
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

// FormatFloat prints a float the way JavaScript prints numbers: decimal form
// for [1e-6, 1e21), exponential form outside that range with a normalized
// exponent, and NaN/Infinity spelled out.
func FormatFloat(value float64) string {
	if math.IsNaN(value) {
		return "NaN"
	}
	if math.IsInf(value, 1) {
		return "Infinity"
	}
	if math.IsInf(value, -1) {
		return "-Infinity"
	}
	abs := math.Abs(value)
	if abs != 0 && (abs < 1e-6 || abs >= 1e21) {
		return normalizeExponent(strconv.FormatFloat(value, 'g', -1, 64))
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}

// normalizeExponent removes leading zeros from a strconv exponent so it
// matches JavaScript's rendering ("1e-7", not "1e-07").
func normalizeExponent(value string) string {
	index := strings.LastIndexByte(value, 'e')
	if index < 0 {
		return value
	}
	sign := ""
	digits := value[index+1:]
	if strings.HasPrefix(digits, "-") || strings.HasPrefix(digits, "+") {
		sign = digits[:1]
		digits = digits[1:]
	}
	digits = strings.TrimLeft(digits, "0")
	if digits == "" {
		digits = "0"
	}
	return value[:index+1] + sign + digits
}

// Number mirrors Number(value). The second result is false when the value is
// undefined/absent or cannot be converted.
func Number(value any) (float64, bool) {
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

// NumberOrZero coalesces an inconvertible value to zero.
func NumberOrZero(value any) float64 {
	parsed, ok := Number(value)
	if !ok {
		return 0
	}
	return parsed
}

// FiniteNumber mirrors Number(value) followed by Number.isFinite for
// JSON-decoded documents: null becomes 0 and the second result is false for
// values that do not convert to a finite number. JSON-decoded values cannot
// distinguish null from a missing key, and every document reader treats nil as
// null here.
func FiniteNumber(value any) (float64, bool) {
	if value == nil {
		return 0, true
	}
	parsed, ok := Number(value)
	if !ok || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 0, false
	}
	return parsed, true
}

// FiniteNumberOrZero coalesces a non-finite or inconvertible value to zero.
func FiniteNumberOrZero(value any) float64 {
	parsed, ok := FiniteNumber(value)
	if !ok {
		return 0
	}
	return parsed
}

// Integer mirrors Number.isInteger(Number(value)).
func Integer(value any) (int, bool) {
	parsed, ok := Number(value)
	if !ok || math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed != math.Trunc(parsed) {
		return 0, false
	}
	return int(parsed), true
}

// ParseJSON parses a JSON document with json.Number so large ids keep their
// precision.
func ParseJSON(data []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

// DecodeJSON decodes a JSON document into target with json.Number semantics.
func DecodeJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	return decoder.Decode(target)
}
