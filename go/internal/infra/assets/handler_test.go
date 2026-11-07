package assets

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mps233/la-pluma/go/internal/config"
)

// tinyPNG is a valid 1x1 PNG; the routes only stream bytes.
var tinyPNG = func() []byte {
	data, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
	if err != nil {
		panic(err)
	}
	return data
}()

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func createResourceFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	itemsDir := filepath.Join(root, "template", "items")
	avatarDir := filepath.Join(root, "template", "avatar")
	if err := os.MkdirAll(itemsDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(avatarDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(itemsDir, "30012.png"), tinyPNG, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(avatarDir, "char_002_amiya.png"), tinyPNG, 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}

func mountedHandler(root string, cfg Config) http.Handler {
	if cfg.ResourceDir == "" && cfg.ResourceDirFunc == nil {
		cfg.ResourceDir = root
	}
	if cfg.Logger == nil {
		cfg.Logger = discardLogger()
	}
	return http.StripPrefix("/api/maa-assets", New(config.Paths{}, cfg))
}

func getAsset(t *testing.T, handler http.Handler, target string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, target, nil)
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestNormalizeKeys(t *testing.T) {
	valid := map[string]string{
		"30012":                  "30012",
		"30012.png":              "30012",
		"30012.PNG":              "30012",
		"MTL_SL_G2":              "MTL_SL_G2",
		" icon-name ":            "icon-name",
		strings.Repeat("a", 128): strings.Repeat("a", 128),
	}
	for input, want := range valid {
		if got := NormalizeItemKey(input); got != want {
			t.Fatalf("NormalizeItemKey(%q) = %q, want %q", input, got, want)
		}
	}
	for _, input := range []string{"", "../secret", "..", "a/b", "a\\b", "a.png.png", strings.Repeat("a", 129), "图标"} {
		if got := NormalizeItemKey(input); got != "" {
			t.Fatalf("NormalizeItemKey(%q) = %q, want rejection", input, got)
		}
	}

	if got := NormalizeAvatarID("char_002_amiya"); got != "char_002_amiya" {
		t.Fatalf("avatar = %q", got)
	}
	for _, input := range []string{"", "char_", "char_002_amiya.png", "../char_002", "char_002/amiya", "char_002 ami"} {
		if got := NormalizeAvatarID(input); got != "" {
			t.Fatalf("NormalizeAvatarID(%q) = %q, want rejection", input, got)
		}
	}
}

func TestSelectItemAssetID(t *testing.T) {
	aliases := map[string]string{"MTL_SL_G2": "30012"}
	if got := SelectItemAssetID("MTL_SL_G2", aliases); got != "30012" {
		t.Fatalf("alias = %q", got)
	}
	if got := SelectItemAssetID("30012.png", aliases); got != "30012" {
		t.Fatalf("direct = %q", got)
	}
	if got := SelectItemAssetID("MTL_SL_G2", map[string]string{}); got != "MTL_SL_G2" {
		t.Fatalf("empty map = %q", got)
	}
	if got := SelectItemAssetID("../secret", aliases); got != "" {
		t.Fatalf("traversal = %q", got)
	}
	if got := SelectItemAssetID("x", nil); got != "x" {
		t.Fatalf("nil map = %q", got)
	}
}

func TestBuildItemAssetMap(t *testing.T) {
	index := map[string]any{
		"30012": map[string]any{"name": "固源岩"},
		"30013": map[string]any{"name": "固源岩组"},
		"30014": map[string]any{"name": "no icon"},
	}
	table := map[string]any{
		"items": map[string]any{
			"30012": map[string]any{"iconId": "MTL_SL_G2"},
			"30013": map[string]any{"iconId": "MTL_SL_G2"},
			"30014": map[string]any{},
		},
	}
	got := BuildItemAssetMap(index, table)
	if got["MTL_SL_G2"] != "30012" {
		t.Fatalf("deterministic first entry = %#v", got)
	}
	if len(got) != 1 {
		t.Fatalf("map = %#v", got)
	}

	if empty := BuildItemAssetMap(nil, nil); len(empty) != 0 {
		t.Fatalf("nil input = %#v", empty)
	}
}

func TestLoadItemAssetMap(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "gamedata", "excel"), 0o700); err != nil {
		t.Fatal(err)
	}
	itemIndex := `{"30012":{"name":"固源岩"}}`
	itemTable := `{"items":{"30012":{"iconId":"MTL_SL_G2"}}}`
	if err := os.WriteFile(filepath.Join(root, "item_index.json"), []byte(itemIndex), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "gamedata", "excel", "item_table.json"), []byte(itemTable), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := LoadItemAssetMap(root)
	if err != nil {
		t.Fatal(err)
	}
	if got["MTL_SL_G2"] != "30012" {
		t.Fatalf("map = %#v", got)
	}

	missing, err := LoadItemAssetMap(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(missing) != 0 {
		t.Fatalf("missing files = %#v", missing)
	}
}

func TestHandlerServesAssets(t *testing.T) {
	root := createResourceFixture(t)
	handler := mountedHandler(root, Config{
		LoadItemAssetMap: func(string) (map[string]string, error) {
			return map[string]string{"MTL_SL_G2": "30012"}, nil
		},
	})

	direct := getAsset(t, handler, "/api/maa-assets/item/30012", nil)
	if direct.Code != http.StatusOK {
		t.Fatalf("direct status = %d body=%s", direct.Code, direct.Body.String())
	}
	if direct.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("content type = %q", direct.Header().Get("Content-Type"))
	}
	if direct.Header().Get("Cache-Control") != "public, max-age=86400" {
		t.Fatalf("cache control = %q", direct.Header().Get("Cache-Control"))
	}
	if direct.Header().Get("Vary") != "Accept" {
		t.Fatalf("vary = %q", direct.Header().Get("Vary"))
	}
	if direct.Body.Len() != len(tinyPNG) {
		t.Fatalf("body length = %d", direct.Body.Len())
	}

	versioned := getAsset(t, handler, "/api/maa-assets/item/30012?v=7", nil)
	if versioned.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("versioned cache control = %q", versioned.Header().Get("Cache-Control"))
	}

	withSuffix := getAsset(t, handler, "/api/maa-assets/item/30012.png", nil)
	if withSuffix.Code != http.StatusOK {
		t.Fatalf("suffix status = %d", withSuffix.Code)
	}

	alias := getAsset(t, handler, "/api/maa-assets/item/MTL_SL_G2", nil)
	if alias.Code != http.StatusOK {
		t.Fatalf("alias status = %d body=%s", alias.Code, alias.Body.String())
	}

	avatar := getAsset(t, handler, "/api/maa-assets/avatar/char_002_amiya", nil)
	if avatar.Code != http.StatusOK {
		t.Fatalf("avatar status = %d", avatar.Code)
	}

	missing := getAsset(t, handler, "/api/maa-assets/avatar/char_missing", nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing status = %d", missing.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(missing.Body.Bytes(), &body); err != nil || body["error"] != "Not Found" {
		t.Fatalf("missing body = %s", missing.Body.String())
	}
	if missing.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("missing content type = %q", missing.Header().Get("Content-Type"))
	}
}

func TestHandlerUsesPathsResourceRoot(t *testing.T) {
	maaDataDir := t.TempDir()
	root := filepath.Join(maaDataDir, "resource")
	if err := os.MkdirAll(filepath.Join(root, "template", "items"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "template", "items", "30012.png"), tinyPNG, 0o600); err != nil {
		t.Fatal(err)
	}

	handler := http.StripPrefix("/api/maa-assets", New(config.Paths{MaaDataDir: maaDataDir}, Config{Logger: discardLogger()}))
	recorder := getAsset(t, handler, "/api/maa-assets/item/30012", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestHandlerRejectsInvalidKeys(t *testing.T) {
	root := createResourceFixture(t)
	handler := mountedHandler(root, Config{
		LoadItemAssetMap: func(string) (map[string]string, error) {
			return nil, nil
		},
	})

	invalidItem := getAsset(t, handler, "/api/maa-assets/item/invalid!key", nil)
	if invalidItem.Code != http.StatusBadRequest {
		t.Fatalf("invalid item status = %d", invalidItem.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(invalidItem.Body.Bytes(), &body); err != nil || body["error"] != "Invalid asset key" {
		t.Fatalf("invalid item body = %s", invalidItem.Body.String())
	}

	invalidAvatar := getAsset(t, handler, "/api/maa-assets/avatar/char_002_amiya.png", nil)
	if invalidAvatar.Code != http.StatusBadRequest {
		t.Fatalf("invalid avatar status = %d", invalidAvatar.Code)
	}

	// A percent-encoded backslash survives path routing as a key character and
	// is rejected by the allowlist before any join.
	traversal := getAsset(t, handler, "/api/maa-assets/item/..%5Csecret", nil)
	if traversal.Code != http.StatusBadRequest {
		t.Fatalf("traversal key status = %d body=%s", traversal.Code, traversal.Body.String())
	}
}

func TestHandlerTraversalRejection(t *testing.T) {
	root := createResourceFixture(t)
	secretPath := filepath.Join(filepath.Dir(root), "secret.png")
	if err := os.WriteFile(secretPath, tinyPNG, 0o600); err != nil {
		t.Fatal(err)
	}

	// safeJoin must reject any alias that escapes the item namespace, even if
	// a malicious resource file produced it.
	itemsDir := filepath.Join(root, "template", "items")
	avatarDir := filepath.Join(root, "template", "avatar")
	if _, ok := safeJoin(itemsDir, "../secret.png"); ok {
		t.Fatal("safeJoin accepted a traversal path")
	}
	if _, ok := safeJoin(avatarDir, "../../secret.png"); ok {
		t.Fatal("safeJoin accepted a parent escape")
	}
	if _, ok := safeJoin(itemsDir, "30012.png"); !ok {
		t.Fatal("safeJoin rejected a valid in-namespace path")
	}

	// The key validator rejects traversal before the filesystem is touched.
	handler := New(config.Paths{}, Config{
		ResourceDir: root,
		Logger:      discardLogger(),
		LoadItemAssetMap: func(string) (map[string]string, error) {
			return map[string]string{"../secret": "../secret"}, nil
		},
	})
	request := httptest.NewRequest(http.MethodGet, "/item/anything", nil)
	request.SetPathValue("key", "../secret")
	recorder := httptest.NewRecorder()
	handler.item(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("traversal status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}
