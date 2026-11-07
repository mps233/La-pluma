package jsonstore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteReadAtomic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "data.json")
	if err := Write(path, map[string]any{"b": 2, "a": 1}, true); err != nil {
		t.Fatal(err)
	}
	value, err := Read(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("unexpected value: %#v", value)
	}
	if numericInt(record["a"]) != 1 || numericInt(record["b"]) != 2 {
		t.Fatalf("unexpected record: %#v", record)
	}
}

func TestReadMissingFallback(t *testing.T) {
	fallback := map[string]any{"version": 1}
	value, err := Read(filepath.Join(t.TempDir(), "missing.json"), fallback)
	if err != nil {
		t.Fatal(err)
	}
	if value == nil {
		t.Fatal("expected fallback")
	}
}

func TestStableJSON(t *testing.T) {
	value := map[string]any{"z": []any{map[string]any{"b": 2, "a": 1}}, "a": "x"}
	stable, err := StableJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"a":"x","z":[{"a":1,"b":2}]}`
	if stable != want {
		t.Fatalf("stable = %s, want %s", stable, want)
	}
}

func TestNormalizeUsesJSONNumbers(t *testing.T) {
	normalized, err := Normalize(map[string]any{"n": json.Number("9007199254740993")})
	if err != nil {
		t.Fatal(err)
	}
	record := normalized.(map[string]any)
	if record["n"] != json.Number("9007199254740993") {
		t.Fatalf("unexpected normalized number: %#v", record["n"])
	}
}

func TestWriteMode(t *testing.T) {
	if os.PathSeparator == '\\' {
		t.Skip("POSIX mode")
	}
	path := filepath.Join(t.TempDir(), "data.json")
	if err := Write(path, map[string]any{"a": 1}, false); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %o", info.Mode().Perm())
	}
}

func numericInt(value any) int {
	switch typed := value.(type) {
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	case float64:
		return int(typed)
	}
	return 0
}
