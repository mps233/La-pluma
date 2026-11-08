package gamedata

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
)

// fixtureServer serves a fixed path -> JSON payload map. It records request
// counts so tests can assert that only fixture URLs were used.
func fixtureServer(t *testing.T, files map[string]any) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		value, ok := files[request.URL.Path]
		if !ok {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(writer).Encode(value); err != nil {
			t.Errorf("encode fixture %s: %v", request.URL.Path, err)
		}
	}))
	t.Cleanup(server.Close)
	return server, &requests
}

func readFileBytes(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return data
}

func decodeFile(t *testing.T, path string) any {
	t.Helper()
	data := readFileBytes(t, path)
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	return value
}

func mustRecord(t *testing.T, value any, context string) map[string]any {
	t.Helper()
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s: expected object, got %#v", context, value)
	}
	return record
}

func mustArray(t *testing.T, value any, context string) []any {
	t.Helper()
	items, ok := value.([]any)
	if !ok {
		t.Fatalf("%s: expected array, got %#v", context, value)
	}
	return items
}
