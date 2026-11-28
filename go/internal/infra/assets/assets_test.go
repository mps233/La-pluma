package assets

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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

func TestSafeJoinRejectsTraversal(t *testing.T) {
	root := t.TempDir()
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
}
