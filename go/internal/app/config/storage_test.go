package config

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	platformconfig "github.com/mps233/la-pluma/go/internal/config"
)

func TestValidateConfigType(t *testing.T) {
	allowed := []string{
		"activity-cache",
		"auto-update",
		"automation-tasks",
		"combat-tasks",
		"notification",
		"roguelike-tasks",
		"training-queue",
	}
	for _, configType := range allowed {
		got, err := ValidateConfigType(configType)
		if err != nil || got != configType {
			t.Fatalf("ValidateConfigType(%q) = %q, %v", configType, got, err)
		}
	}

	for _, configType := range []string{"", "invalid-config", "../../package", "notification.json"} {
		_, err := ValidateConfigType(configType)
		appErr := requireSameErrorCode(t, err, CodeConfigTypeInvalid)
		if appErr.StatusCode != 400 || appErr.Retryable {
			t.Fatalf("unexpected status/retryable for %q: %+v", configType, appErr)
		}
		if !reflect.DeepEqual(appErr.Details, map[string]any{"configType": configType}) {
			t.Fatalf("unexpected details: %#v", appErr.Details)
		}
	}
}

func TestStorageSaveLoadDelete(t *testing.T) {
	paths := platformconfig.Paths{DataDir: t.TempDir()}
	storage := NewStorage(paths)

	value := map[string]any{
		"enabled": true,
		"count":   2,
		"nested":  map[string]any{"stage": "1-7"},
	}
	if err := storage.Save("notification", value); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(paths.DataDir, "user-configs", "notification.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("config file missing: %v", err)
	}

	loaded, err := storage.Load("notification")
	if err != nil {
		t.Fatal(err)
	}
	if loaded["enabled"] != true || numericValue(loaded["count"]) != 2 {
		t.Fatalf("unexpected loaded config: %#v", loaded)
	}
	nested := requireMap(t, loaded["nested"], "nested")
	if nested["stage"] != "1-7" {
		t.Fatalf("unexpected nested: %#v", nested)
	}

	if err := storage.Delete("notification"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("config file still present: %v", err)
	}
	missing, err := storage.Load("notification")
	if err != nil || missing != nil {
		t.Fatalf("missing load = %#v, %v", missing, err)
	}
	if err := storage.Delete("notification"); err != nil {
		t.Fatalf("missing delete should be a no-op: %v", err)
	}
}

func TestStorageRejectsTraversal(t *testing.T) {
	paths := platformconfig.Paths{DataDir: t.TempDir()}
	storage := NewStorage(paths)
	traversal := "../../package"

	if _, err := storage.Load(traversal); !isAppError(err, CodeConfigTypeInvalid) {
		t.Fatalf("load error = %v", err)
	}
	if err := storage.Save(traversal, map[string]any{"name": "overwritten"}); !isAppError(err, CodeConfigTypeInvalid) {
		t.Fatalf("save error = %v", err)
	}
	if err := storage.Delete(traversal); !isAppError(err, CodeConfigTypeInvalid) {
		t.Fatalf("delete error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(paths.DataDir, "package.json")); !os.IsNotExist(err) {
		t.Fatalf("traversal created a file: %v", err)
	}
}

func TestStorageList(t *testing.T) {
	paths := platformconfig.Paths{DataDir: t.TempDir()}
	storage := NewStorage(paths)
	if err := storage.Save("notification", map[string]any{"a": 1}); err != nil {
		t.Fatal(err)
	}
	if err := storage.Save("auto-update", map[string]any{"b": 2}); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(paths.DataDir, "user-configs")
	if err := os.WriteFile(filepath.Join(dir, "legacy.json"), []byte(`{"c":3}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("ignored"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "combat-tasks.json"), 0o700); err != nil {
		t.Fatal(err)
	}

	types, err := storage.List()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"auto-update", "notification"}
	if !reflect.DeepEqual(types, want) {
		t.Fatalf("types = %#v, want %#v", types, want)
	}
}

func TestStorageLoadErrors(t *testing.T) {
	paths := platformconfig.Paths{DataDir: t.TempDir()}
	storage := NewStorage(paths)

	dir := filepath.Join(paths.DataDir, "user-configs")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notification.json"), []byte(`{not json`), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := storage.Load("notification")
	appErr := requireSameErrorCode(t, err, CodeConfigLoadFailed)
	if appErr.StatusCode != 500 || !appErr.Retryable {
		t.Fatalf("unexpected load error: %+v", appErr)
	}

	if err := os.WriteFile(filepath.Join(dir, "combat-tasks.json"), []byte(`[1,2]`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := storage.Load("combat-tasks"); !isAppError(err, CodeConfigLoadFailed) {
		t.Fatalf("non-object load error = %v", err)
	}
}

func TestStorageSaveFailure(t *testing.T) {
	dataDir := t.TempDir()
	// A file where the user-configs directory should be makes the write fail.
	if err := os.WriteFile(filepath.Join(dataDir, "user-configs"), []byte("blocked"), 0o600); err != nil {
		t.Fatal(err)
	}
	storage := NewStorage(platformconfig.Paths{DataDir: dataDir})
	err := storage.Save("notification", map[string]any{"a": 1})
	appErr := requireSameErrorCode(t, err, CodeConfigSaveFailed)
	if appErr.StatusCode != 500 || !appErr.Retryable {
		t.Fatalf("unexpected save error: %+v", appErr)
	}
}

func TestStorageDeleteFailure(t *testing.T) {
	paths := platformconfig.Paths{DataDir: t.TempDir()}
	storage := NewStorage(paths)
	dir := filepath.Join(paths.DataDir, "user-configs")
	nested := filepath.Join(dir, "notification.json")
	if err := os.MkdirAll(nested, 0o700); err != nil {
		t.Fatal(err)
	}
	err := storage.Delete("notification")
	if !isAppError(err, CodeConfigDeleteFailed) {
		t.Fatalf("delete error = %v", err)
	}
	if _, statErr := os.Stat(nested); statErr != nil {
		t.Fatalf("directory should remain: %v", statErr)
	}
}
