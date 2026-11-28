package results

import "github.com/mps233/la-pluma/go/internal/util/jsval"

// hasField reports whether the key exists, regardless of its value. JavaScript
// treats an absent key and an explicit null differently in a few places.
func hasField(record map[string]any, key string) bool {
	if record == nil {
		return false
	}
	_, ok := record[key]
	return ok
}

// lookupNumber converts a field that must exist. Missing and non-finite values
// report false; an explicit null reports (0, true) like Number(null).
func lookupNumber(record map[string]any, key string) (float64, bool) {
	if !hasField(record, key) {
		return 0, false
	}
	return jsval.FiniteNumber(record[key])
}
