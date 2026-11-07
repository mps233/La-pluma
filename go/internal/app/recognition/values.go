package recognition

import (
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
)

// asRecord narrows a decoded JSON value to an object.
func asRecord(value any) (map[string]any, bool) {
	record, ok := value.(map[string]any)
	return record, ok
}

// numberValue mirrors Number(value) followed by Number.isFinite for the
// coercions used by the Node parser. It returns (0, true) for null.
func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case nil:
		return 0, true
	case json.Number:
		parsed, err := strconv.ParseFloat(typed.String(), 64)
		if err != nil {
			return 0, false
		}
		return parsed, !math.IsNaN(parsed)
	case float64:
		return typed, !math.IsNaN(typed) && !math.IsInf(typed, 0)
	case float32:
		return float64(typed), !math.IsNaN(float64(typed)) && !math.IsInf(float64(typed), 0)
	case int:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case bool:
		if typed {
			return 1, true
		}
		return 0, true
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0, true
		}
		parsed, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return 0, false
		}
		return parsed, !math.IsNaN(parsed) && !math.IsInf(parsed, 0)
	}
	return 0, false
}

// finiteNumberOrZero mirrors `Number(value) || 0` for finite JSON output.
func finiteNumberOrZero(value any) float64 {
	parsed, ok := numberValue(value)
	if !ok || parsed == 0 || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 0
	}
	return parsed
}

// jsonNumberValue accepts only JSON numeric values, mirroring `typeof ===
// 'number'` checks in the Node resource builder.
func jsonNumberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := strconv.ParseFloat(typed.String(), 64)
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
		parsed := float64(typed)
		if math.IsNaN(parsed) || math.IsInf(parsed, 0) {
			return 0, false
		}
		return parsed, true
	case int:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	}
	return 0, false
}

// depotEntry keeps the callback key and its raw count value.
type depotEntry struct {
	ID    string
	Count any
}

// depotEntries reproduces Object.entries iteration order closely enough for
// the stable sortId ordering: integer-like keys ascend numerically, other keys
// are ordered deterministically. Node preserves insertion order for non-index
// keys; a Go map cannot, so those rare keys use lexical order instead.
func depotEntries(data any) []depotEntry {
	switch value := data.(type) {
	case []any:
		entries := make([]depotEntry, 0, len(value))
		for index, count := range value {
			entries = append(entries, depotEntry{ID: strconv.Itoa(index), Count: count})
		}
		return entries
	case map[string]any:
		keys := make([]string, 0, len(value))
		for key := range value {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(left, right int) bool {
			leftIndex, leftOK := jsIntegerIndex(keys[left])
			rightIndex, rightOK := jsIntegerIndex(keys[right])
			if leftOK && rightOK {
				return leftIndex < rightIndex
			}
			if leftOK != rightOK {
				return leftOK
			}
			return keys[left] < keys[right]
		})
		entries := make([]depotEntry, 0, len(keys))
		for _, key := range keys {
			entries = append(entries, depotEntry{ID: key, Count: value[key]})
		}
		return entries
	default:
		return nil
	}
}

// jsIntegerIndex reports whether key is a canonical non-negative integer
// property key, which JavaScript enumerates in ascending numeric order.
func jsIntegerIndex(key string) (uint64, bool) {
	if key == "" || (len(key) > 1 && key[0] == '0') {
		return 0, false
	}
	for _, char := range key {
		if char < '0' || char > '9' {
			return 0, false
		}
	}
	index, err := strconv.ParseUint(key, 10, 64)
	if err != nil || index > 9007199254740991 {
		return 0, false
	}
	return index, true
}

// depotDataLength mirrors Object.keys(data).length for objects and arrays.
func depotDataLength(data any) int {
	switch value := data.(type) {
	case map[string]any:
		return len(value)
	case []any:
		return len(value)
	default:
		return 0
	}
}
