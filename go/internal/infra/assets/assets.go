// Package assets ports the read-only MaaResource image routes.
//
// The routes are mounted at /api/maa-assets before API auth because <img>
// requests cannot attach the bearer header. Only the template item and avatar
// namespaces are exposed, and every key is validated before it touches disk.
package assets

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

var (
	itemKeyPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	avatarKeyPattern = regexp.MustCompile(`^char_[A-Za-z0-9_]{1,120}$`)
)

// NormalizeItemKey trims a key, strips one optional case-insensitive ".png"
// suffix and validates the allowlisted character set.
func NormalizeItemKey(value any) string {
	key := strings.TrimSpace(coerceString(value))
	if len(key) >= 4 && strings.EqualFold(key[len(key)-4:], ".png") {
		key = key[:len(key)-4]
	}
	if !itemKeyPattern.MatchString(key) {
		return ""
	}
	return key
}

// NormalizeAvatarID validates a character avatar id.
func NormalizeAvatarID(value any) string {
	id := strings.TrimSpace(coerceString(value))
	if !avatarKeyPattern.MatchString(id) {
		return ""
	}
	return id
}

// SelectItemAssetID resolves an icon alias (for example MTL_SL_G2 -> 30012).
// A nil or empty map keeps the normalized key, matching the Node helper.
func SelectItemAssetID(key any, assetMap map[string]string) string {
	normalized := NormalizeItemKey(key)
	if normalized == "" {
		return ""
	}
	if assetMap == nil {
		return normalized
	}
	if mapped := assetMap[normalized]; mapped != "" {
		return mapped
	}
	return normalized
}

// BuildItemAssetMap builds iconId -> material id from item_index.json and
// gamedata/excel/item_table.json.
//
// The Node implementation iterates object insertion order and keeps the first
// entry for a duplicate iconId. Go maps are unordered, so keys are sorted for
// deterministic output; that only changes which id wins when two items share
// an iconId.
func BuildItemAssetMap(itemIndex, itemTable any) map[string]string {
	byIconID := map[string]string{}
	source, _ := itemIndex.(map[string]any)
	table, _ := itemTable.(map[string]any)
	tableItems, _ := table["items"].(map[string]any)

	ids := make([]string, 0, len(source))
	for id := range source {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	for _, id := range ids {
		tableItem, _ := tableItems[id].(map[string]any)
		iconID := coerceString(truthyValue(tableItem["iconId"]))
		if iconID == "" {
			continue
		}
		if _, exists := byIconID[iconID]; !exists {
			byIconID[iconID] = id
		}
	}
	return byIconID
}

// LoadItemAssetMap reads the two MaaResource JSON files. Missing files behave
// like empty objects, matching readJson's ENOENT fallback.
func LoadItemAssetMap(resourceDir string) (map[string]string, error) {
	itemIndex, err := jsonstore.Read(filepath.Join(resourceDir, "item_index.json"), nil)
	if err != nil {
		return nil, err
	}
	itemTable, err := jsonstore.Read(filepath.Join(resourceDir, "gamedata", "excel", "item_table.json"), nil)
	if err != nil {
		return nil, err
	}
	return BuildItemAssetMap(itemIndex, itemTable), nil
}

func safeJoin(root string, parts ...string) (string, bool) {
	segments := make([]string, 0, len(parts)+1)
	segments = append(segments, root)
	segments = append(segments, parts...)
	joined := filepath.Join(segments...)
	relative, err := filepath.Rel(root, joined)
	if err != nil || !filepath.IsLocal(relative) {
		return "", false
	}
	return joined, true
}

func coerceString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case json.Number:
		return typed.String()
	default:
		return fmt.Sprint(typed)
	}
}

func truthyValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return ""
	case bool:
		if typed {
			return "true"
		}
		return ""
	case string:
		return typed
	case json.Number:
		if typed == "0" {
			return ""
		}
		return typed
	default:
		return value
	}
}
