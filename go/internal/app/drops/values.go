package drops

// coalesceValue mirrors nullish coalescing over one or more object keys.
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

// asAnySlice accepts the slice shapes Go callers pass in addition to JSON
// arrays. This is a Go-shape adapter, not a JavaScript coercion.
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
	case []map[string]any:
		values := make([]any, len(typed))
		for index, item := range typed {
			values[index] = item
		}
		return values, true
	default:
		return nil, false
	}
}
