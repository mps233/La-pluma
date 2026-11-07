package jsonstore

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Read decodes a JSON file. A missing file returns fallback without an error,
// matching the Node readJsonFile helper.
func Read(path string, fallback any) (any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fallback, nil
		}
		return nil, err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return fallback, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("decode %s: %w", path, err)
	}
	return value, nil
}

// Write atomically replaces a JSON file. The temporary file lives in the same
// directory, is mode 0600, and is fsynced before rename.
func Write(path string, value any, pretty bool) error {
	data, err := marshal(value, pretty)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := EnsureDir(dir); err != nil {
		return err
	}
	temp, err := os.CreateTemp(dir, ".la-pluma-*.tmp")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempName, path); err != nil {
		return err
	}
	return syncDir(dir)
}

func marshal(value any, pretty bool) ([]byte, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if pretty {
		encoder.SetIndent("", "  ")
	}
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	data := buf.Bytes()
	// Encoder appends a newline; keeping it is harmless and mirrors JSON.stringify?
	// Node writes without a trailing newline for the agent run store. Trim it so
	// byte-oriented comparisons stay simple.
	return bytes.TrimSuffix(data, []byte("\n")), nil
}

// EnsureDir creates a directory with 0700 permissions.
func EnsureDir(path string) error {
	if path == "" || path == "." {
		return nil
	}
	return os.MkdirAll(path, 0o700)
}

// Exists reports whether a regular file exists.
func Exists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// Normalize decodes through a JSON round trip with UseNumber, rejecting values
// that cannot be represented in JSON.
func Normalize(value any) (any, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(buf.Bytes()))
	decoder.UseNumber()
	var normalized any
	if err := decoder.Decode(&normalized); err != nil {
		return nil, err
	}
	return normalized, nil
}

// StableJSON serializes maps with sorted keys recursively. It is used for the
// run input fingerprint.
func StableJSON(value any) (string, error) {
	var buf strings.Builder
	if err := writeStable(&buf, value); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func writeStable(buf *strings.Builder, value any) error {
	switch typed := value.(type) {
	case nil:
		buf.WriteString("null")
		return nil
	case []any:
		buf.WriteByte('[')
		for index, item := range typed {
			if index > 0 {
				buf.WriteByte(',')
			}
			if err := writeStable(buf, item); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
		return nil
	case map[string]any:
		buf.WriteByte('{')
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sortStrings(keys)
		for index, key := range keys {
			if index > 0 {
				buf.WriteByte(',')
			}
			encodedKey, _ := json.Marshal(key)
			buf.Write(encodedKey)
			buf.WriteByte(':')
			if err := writeStable(buf, typed[key]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
		return nil
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return err
		}
		buf.Write(encoded)
		return nil
	}
}

func sortStrings(values []string) {
	// Small local insertion sort keeps the helper dependency-free.
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}

func syncDir(dir string) error {
	handle, err := os.Open(dir)
	if err != nil {
		return nil
	}
	defer handle.Close()
	if err := handle.Sync(); err != nil {
		// Windows does not support syncing a directory handle.
		return nil
	}
	return nil
}
