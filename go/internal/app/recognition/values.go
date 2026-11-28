package recognition

import (
	"sort"
	"strconv"
)

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
