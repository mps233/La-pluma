package skland

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"io"
	"testing"
)

func TestGzipBytesIsBase64Wrapped(t *testing.T) {
	encoded := gzipBytes([]byte(`{"a":1}`))
	if len(encoded) == 0 || encoded[0] != 'H' {
		t.Fatalf("expected base64 gzip, got %q", string(encoded[:min(len(encoded), 8)]))
	}
	decoded, err := base64.StdEncoding.DecodeString(string(encoded))
	if err != nil {
		t.Fatalf("base64: %v", err)
	}
	reader, err := gzip.NewReader(bytes.NewReader(decoded))
	if err != nil {
		t.Fatalf("gzip reader: %v", err)
	}
	plain, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("gzip read: %v", err)
	}
	if string(plain) != `{"a":1}` {
		t.Fatalf("plain = %q", string(plain))
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
