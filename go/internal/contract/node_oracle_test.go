package contract

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

// The fixtures are generated from the Node oracle with:
//
//	buildAgentManifest({adbPath:'/custom/platform-tools/adb',adbAddress:'127.0.0.1:7555',clientType:'Bilibili'})
//	buildOpenApiSpec({...same defaults})
//
// They keep the shared React client and Agent callers from drifting silently.
func oracleDefaults() RuntimeDefaults {
	return RuntimeDefaults{
		ADBPath:    "/custom/platform-tools/adb",
		ADBAddress: "127.0.0.1:7555",
		ClientType: "Bilibili",
	}
}

func readOracleFixture(t *testing.T, name string) any {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func normalizeForComparison(t *testing.T, value any) any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var normalized any
	if err := json.Unmarshal(data, &normalized); err != nil {
		t.Fatal(err)
	}
	return normalized
}

func firstJSONDifference(want, got any, path string) string {
	switch expected := want.(type) {
	case map[string]any:
		actual, ok := got.(map[string]any)
		if !ok {
			return path + ": type mismatch"
		}
		keys := make([]string, 0, len(expected))
		for key := range expected {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			actualValue, exists := actual[key]
			if !exists {
				return path + "." + key + ": missing"
			}
			if difference := firstJSONDifference(expected[key], actualValue, path+"."+key); difference != "" {
				return difference
			}
		}
		actualKeys := make([]string, 0, len(actual))
		for key := range actual {
			actualKeys = append(actualKeys, key)
		}
		sort.Strings(actualKeys)
		for _, key := range actualKeys {
			if _, exists := expected[key]; !exists {
				return path + "." + key + ": unexpected"
			}
		}
	case []any:
		actual, ok := got.([]any)
		if !ok {
			return path + ": type mismatch"
		}
		if len(actual) != len(expected) {
			return fmt.Sprintf("%s: length %d, want %d", path, len(actual), len(expected))
		}
		for index := range expected {
			if difference := firstJSONDifference(expected[index], actual[index], fmt.Sprintf("%s[%d]", path, index)); difference != "" {
				return difference
			}
		}
	default:
		if !reflect.DeepEqual(want, got) {
			return fmt.Sprintf("%s: got %#v, want %#v", path, got, want)
		}
	}
	return ""
}

func TestManifestMatchesNodeOracle(t *testing.T) {
	want := readOracleFixture(t, "node-manifest-defaults.json")
	got := normalizeForComparison(t, ManifestWithDefaults(oracleDefaults()))
	if difference := firstJSONDifference(want, got, "manifest"); difference != "" {
		t.Fatalf("Go manifest differs from the Node oracle: %s", difference)
	}
}

// sortOpenAPIParameters ignores parameter order, which is not semantic. Go
// builds query parameters from a map, while the Node registry preserves
// insertion order.
func sortOpenAPIParameters(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			result[key] = sortOpenAPIParameters(item)
		}
		if parameters, ok := result["parameters"].([]any); ok {
			sort.SliceStable(parameters, func(i, j int) bool {
				left, _ := parameters[i].(map[string]any)
				right, _ := parameters[j].(map[string]any)
				return fmt.Sprint(left["name"]) < fmt.Sprint(right["name"])
			})
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			result[index] = sortOpenAPIParameters(item)
		}
		return result
	default:
		return value
	}
}

func TestOpenAPIMatchesNodeOracle(t *testing.T) {
	want := sortOpenAPIParameters(readOracleFixture(t, "node-openapi-defaults.json"))
	got := sortOpenAPIParameters(normalizeForComparison(t, OpenAPIWithDefaults(oracleDefaults())))
	if difference := firstJSONDifference(want, got, "openapi"); difference != "" {
		t.Fatalf("Go OpenAPI differs from the Node oracle: %s", difference)
	}
}
