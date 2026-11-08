package gamedata

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var leadingIntegerPattern = regexp.MustCompile(`^[\t\n\v\f\r ]*([+-]?[0-9]+)`)

// asRecord mirrors the Node `isRecord`/object guards.
func asRecord(value any) map[string]any {
	record, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return record
}

// asArray returns the slice value or nil, like `Array.isArray(value) ? value : []`.
func asArray(value any) []any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	return items
}

// asArrayOK distinguishes a missing value from an empty JSON array.
func asArrayOK(value any) ([]any, bool) {
	items, ok := value.([]any)
	return items, ok
}

// truthy mirrors JavaScript truthiness for decoded JSON values.
func truthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case json.Number:
		parsed, err := typed.Float64()
		return err != nil || parsed != 0
	case float64:
		return typed != 0 && !math.IsNaN(typed)
	case float32:
		return typed != 0
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

// firstTruthy implements the `a || b || c` chain used by the Node scripts. It
// returns the last operand when every value is falsy, like JavaScript `||`.
func firstTruthy(values ...any) any {
	for _, value := range values {
		if truthy(value) {
			return value
		}
	}
	if len(values) == 0 {
		return nil
	}
	return values[len(values)-1]
}

// jsString approximates JavaScript String(value) for decoded JSON values.
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
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 32)
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
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			if item == nil {
				parts = append(parts, "")
				continue
			}
			parts = append(parts, jsString(item))
		}
		return strings.Join(parts, ",")
	case map[string]any:
		return "[object Object]"
	default:
		return fmt.Sprint(value)
	}
}

// parseIntJS parses the leading integer of String(value), falling back to 0
// like `parseInt(value, 10) || 0`.
func parseIntJS(value any) int {
	text := jsString(value)
	match := leadingIntegerPattern.FindStringSubmatch(text)
	if match == nil {
		return 0
	}
	parsed, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		return 0
	}
	return int(parsed)
}

// jsNumber approximates JavaScript Number(value). The boolean result is false
// for NaN/Infinity, which the generators treat as non-numeric.
func jsNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case nil:
		return 0, true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case float64:
		return typed, !math.IsNaN(typed)
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
		parsed, err := strconv.ParseFloat(trimmed, 64)
		return parsed, err == nil
	case bool:
		if typed {
			return 1, true
		}
		return 0, true
	default:
		return 0, false
	}
}

// numericValue accepts only numeric JSON values, matching `typeof x === 'number'`.
func numericValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case float64:
		return typed, !math.IsNaN(typed)
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
	default:
		return 0, false
	}
}

// roundToFixed4 mirrors `parseFloat((value / 10000).toFixed(4))` for positive
// drop rates: the value is rounded to four decimal places.
func roundToFixed4(value float64) float64 {
	return math.Round(value*10000) / 10000
}

func dateOnly(now time.Time) string {
	return now.UTC().Format("2006-01-02")
}

func stringValue(value any) (string, bool) {
	text, ok := value.(string)
	return text, ok
}
