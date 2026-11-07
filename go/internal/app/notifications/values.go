package notifications

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// truthy mirrors JavaScript truthiness for values decoded from JSON and for
// values supplied by Go callers. Empty maps and slices are truthy in JS.
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
		if err != nil {
			return typed.String() != ""
		}
		return number != 0 && !math.IsNaN(number)
	case float64:
		return typed != 0 && !math.IsNaN(typed)
	case float32:
		return typed != 0 && !math.IsNaN(float64(typed))
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

// jsString approximates String(value) for JSON-shaped values.
func jsString(value any) string {
	switch typed := value.(type) {
	case nil:
		return "null"
	case string:
		return typed
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case json.Number:
		number, err := typed.Float64()
		if err != nil {
			return typed.String()
		}
		return formatJSNumber(number)
	case float64:
		return formatJSNumber(typed)
	case float32:
		return formatJSNumber(float64(typed))
	case int:
		return strconv.FormatInt(int64(typed), 10)
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
			parts = append(parts, jsString(item))
		}
		return strings.Join(parts, ",")
	case []string:
		return strings.Join(typed, ",")
	default:
		// JavaScript String({}) is "[object Object]"; unknown composites are
		// only used for diagnostics, so avoid leaking Go representations.
		return "[object Object]"
	}
}

func formatJSNumber(value float64) string {
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

func asRecord(value any) (map[string]any, bool) {
	record, ok := value.(map[string]any)
	return record, ok
}

// itemTask extracts the task name used to deduplicate legacy skip/error
// entries against structured actions. ok is false when the item has no string
// task field at all, which keeps it in the legacy section.
func itemTask(value any) (task string, ok bool) {
	if text, isString := value.(string); isString {
		return text, true
	}
	record, isRecord := asRecord(value)
	if !isRecord {
		return "", false
	}
	task, isString := record["task"].(string)
	return task, isString
}

func errMessage(err error) string {
	if err == nil {
		return ""
	}
	var appErr *apperrors.Error
	if errors.As(err, &appErr) && appErr.Message != "" {
		return appErr.Message
	}
	return err.Error()
}

var shanghaiZone = time.FixedZone("Asia/Shanghai", 8*60*60)

// formatTelegramTime renders the Node zh-CN localized string in Asia/Shanghai
// without relying on host tzdata.
func formatTelegramTime(now time.Time) string {
	return now.In(shanghaiZone).Format("2006/1/2 15:04:05")
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return jsString(value)
}

func formatID(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	if number, ok := value.(json.Number); ok {
		return number.String()
	}
	if number, ok := value.(float64); ok {
		if number == math.Trunc(number) && math.Abs(number) < 1<<53 {
			return strconv.FormatInt(int64(number), 10)
		}
		return formatJSNumber(number)
	}
	return fmt.Sprint(value)
}
