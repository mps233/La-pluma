package activity

import (
	"bytes"
	"fmt"
	"os"

	"github.com/mps233/la-pluma/go/internal/util/jsval"
)

// DefaultClientType mirrors DEFAULT_CLIENT_TYPE in the Node server.
const DefaultClientType = "Official"

// readJSONFile decodes a JSON file with json.Number, returning the underlying
// error for missing or malformed files so callers can distinguish "absent"
// from "empty" (the Node services use fs.readFile + JSON.parse).
func readJSONFile(path string) (any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, fmt.Errorf("empty JSON file %s", path)
	}
	return jsval.ParseJSON(data)
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

// strictStringSlice mirrors Array.isArray(value) ? value : [] while
// stringifying array members the way Node consumers do.
func strictStringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			result = append(result, jsval.StringOrEmpty(item))
		}
		return result
	default:
		return nil
	}
}

func stringPtr(value string) *string {
	copyValue := value
	return &copyValue
}

// errorMessage mirrors getErrorMessage for plain errors.
func errorMessage(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// equalJSONScalar compares zoneId-style values with JavaScript strict
// equality for the scalar types JSON produces.
func equalJSONScalar(left, right any) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	if leftNumber, ok := jsval.Number(left); ok {
		rightNumber, rightOK := jsval.Number(right)
		return rightOK && leftNumber == rightNumber
	}
	if leftString, ok := left.(string); ok {
		rightString, rightOK := right.(string)
		return rightOK && leftString == rightString
	}
	if leftBool, ok := left.(bool); ok {
		rightBool, rightOK := right.(bool)
		return rightOK && leftBool == rightBool
	}
	return false
}
