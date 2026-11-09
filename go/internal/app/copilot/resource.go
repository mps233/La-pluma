package copilot

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const (
	stageMapCacheTTL = 5 * time.Minute
	tilePosDirName   = "Arknights-Tile-Pos"
)

// StageCodeInfo is the display code and AP cost of one internal stage id.
type StageCodeInfo struct {
	Code   string
	APCost float64
}

type stageMapCacheEntry struct {
	expiresAt time.Time
	value     map[string]StageCodeInfo
}

type tileNamesCache struct {
	dir       string
	expiresAt time.Time
	names     []string
}

type stageCatalogCache struct {
	expiresAt time.Time
	byCode    map[string]map[string]any
}

// ResourceIndex reads MaaResource stages and Arknights-Tile-Pos metadata from
// Paths.MaaDataDir/resource. It deliberately does not import the MAA service:
// only local JSON files are consulted.
type ResourceIndex struct {
	resourceDir string
	now         func() time.Time

	mu          sync.Mutex
	stageMaps   map[string]stageMapCacheEntry
	tileNames   *tileNamesCache
	stageRecord map[string]stageCatalogCache
}

func NewResourceIndex(paths config.Paths) *ResourceIndex {
	return &ResourceIndex{
		resourceDir: filepath.Join(paths.MaaDataDir, "resource"),
		now:         time.Now,
		stageMaps:   map[string]stageMapCacheEntry{},
		stageRecord: map[string]stageCatalogCache{},
	}
}

func (r *ResourceIndex) ResourceDir() string { return r.resourceDir }

// HasStageTile reports whether the installed MAA resource has tile metadata
// for the internal stage id. A missing Arknights-Tile-Pos directory means the
// resource cannot be inspected, so execution is not blocked on it; an existing
// directory without the stage is a stale resource MaaCore would reject.
func (r *ResourceIndex) HasStageTile(stageID string) bool {
	stageID = strings.TrimSpace(stageID)
	if stageID == "" {
		return true
	}
	tileDir := filepath.Join(r.resourceDir, tilePosDirName)
	if info, err := os.Stat(tileDir); err != nil || !info.IsDir() {
		return true
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, name := range r.tileFilenamesLocked(tileDir) {
		if strings.HasPrefix(name, stageID+"-") || strings.HasPrefix(name, stageID+"#") {
			return true
		}
	}
	return false
}

// StageByCode looks up a stage record in MaaResource stages.json by display
// code (case-insensitive). It mirrors getMaaStageByCode.
func (r *ResourceIndex) StageByCode(code string) (map[string]any, bool, error) {
	normalized := strings.ToUpper(strings.TrimSpace(code))
	if normalized == "" {
		return nil, false, nil
	}
	catalog, err := r.loadStageCatalog()
	if err != nil {
		return nil, false, err
	}
	record, ok := catalog[normalized]
	return record, ok, nil
}

func (r *ResourceIndex) loadStageCatalog() (map[string]map[string]any, error) {
	path := filepath.Join(r.resourceDir, "stages.json")
	r.mu.Lock()
	if cached, ok := r.stageRecord[path]; ok && cached.expiresAt.After(r.now()) {
		byCode := cached.byCode
		r.mu.Unlock()
		return byCode, nil
	}
	r.mu.Unlock()

	value, err := jsonstore.Read(path, nil)
	if err != nil {
		return nil, err
	}
	byCode := map[string]map[string]any{}
	for _, record := range stageRecords(value) {
		code := asString(record["code"])
		if code == "" {
			continue
		}
		byCode[strings.ToUpper(code)] = record
	}

	r.mu.Lock()
	r.stageRecord[path] = stageCatalogCache{expiresAt: r.now().Add(stageMapCacheTTL), byCode: byCode}
	r.mu.Unlock()
	return byCode, nil
}

// StageCodeMap resolves display codes and AP costs for the requested internal
// stage ids. Tile metadata supplies the display code, stages.json supplies AP
// costs (both object and array shapes are accepted because MaaResource has
// shipped both), and PenguinStats is the final AP fallback.
func (r *ResourceIndex) StageCodeMap(
	ctx context.Context,
	stageIDs []string,
	stats func(context.Context) ([]any, error),
) map[string]StageCodeInfo {
	normalized := normalizeStageIDs(stageIDs)
	if len(normalized) == 0 {
		return map[string]StageCodeInfo{}
	}
	cacheKey := strings.Join(normalized, "\x00")

	r.mu.Lock()
	if cached, ok := r.stageMaps[cacheKey]; ok && cached.expiresAt.After(r.now()) {
		value := cloneStageCodeMap(cached.value)
		r.mu.Unlock()
		return value
	}
	result := r.loadStageCodeMapLocal(normalized)
	r.mu.Unlock()

	missing := map[string]struct{}{}
	for _, stageID := range stageIDs {
		if stageID == "" {
			continue
		}
		info, exists := result[stageID]
		if !exists || info.APCost == 0 {
			missing[stageID] = struct{}{}
		}
	}
	if len(missing) > 0 && stats != nil {
		if stages, err := stats(ctx); err == nil {
			for _, raw := range stages {
				stage := asRecord(raw)
				if stage == nil || !truthy(stage["code"]) {
					continue
				}
				stageID := jsStringOrEmpty(stage["stageId"])
				if _, needed := missing[stageID]; !needed {
					continue
				}
				result[stageID] = StageCodeInfo{
					Code:   jsString(stage["code"]),
					APCost: mathMaxZero(numberOrZero(stage["apCost"])),
				}
			}
		}
	}

	r.mu.Lock()
	r.stageMaps[cacheKey] = stageMapCacheEntry{expiresAt: r.now().Add(stageMapCacheTTL), value: cloneStageCodeMap(result)}
	r.mu.Unlock()
	return result
}

// loadStageCodeMapLocal must be called with r.mu held.
func (r *ResourceIndex) loadStageCodeMapLocal(stageIDs []string) map[string]StageCodeInfo {
	result := map[string]StageCodeInfo{}

	tileDir := filepath.Join(r.resourceDir, tilePosDirName)
	names := r.tileFilenamesLocked(tileDir)
	for _, stageID := range stageIDs {
		filename := ""
		for _, name := range names {
			if !strings.HasSuffix(name, ".json") {
				continue
			}
			if strings.HasPrefix(name, stageID+"-") || strings.HasPrefix(name, stageID+"#") {
				filename = name
				break
			}
		}
		if filename == "" {
			continue
		}
		value, err := jsonstore.Read(filepath.Join(tileDir, filename), nil)
		if err != nil {
			continue
		}
		metadata := asRecord(value)
		if metadata == nil {
			continue
		}
		if code := asString(metadata["code"]); code != "" {
			result[stageID] = StageCodeInfo{Code: code, APCost: 0}
		}
	}

	if stages, err := jsonstore.Read(filepath.Join(r.resourceDir, "stages.json"), nil); err == nil {
		for _, rawStage := range stageRecords(stages) {
			if rawStage == nil {
				continue
			}
			if !truthy(rawStage["stageId"]) || !truthy(rawStage["code"]) {
				continue
			}
			stageID := jsString(rawStage["stageId"])
			code := jsString(rawStage["code"])
			existing := result[stageID]
			displayCode := code
			if existing.Code != "" {
				displayCode = existing.Code
			}
			result[stageID] = StageCodeInfo{
				Code:   displayCode,
				APCost: mathMaxZero(numberOrZero(rawStage["apCost"])),
			}
		}
	}

	return result
}

// tileFilenamesLocked caches the Arknights-Tile-Pos directory listing.
// Callers must hold r.mu.
func (r *ResourceIndex) tileFilenamesLocked(tileDir string) []string {
	now := r.now()
	if r.tileNames != nil && r.tileNames.dir == tileDir && r.tileNames.expiresAt.After(now) {
		return r.tileNames.names
	}
	entries, err := os.ReadDir(tileDir)
	if err != nil {
		// A missing resource is a normal unsupported state; keep the negative
		// result cached so repeated plan builds do not hit the filesystem.
		empty := []string{}
		r.tileNames = &tileNamesCache{dir: tileDir, expiresAt: now.Add(stageMapCacheTTL), names: empty}
		return empty
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		names = append(names, entry.Name())
	}
	r.tileNames = &tileNamesCache{dir: tileDir, expiresAt: now.Add(stageMapCacheTTL), names: names}
	return names
}

func normalizeStageIDs(stageIDs []string) []string {
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(stageIDs))
	for _, stageID := range stageIDs {
		if stageID == "" {
			continue
		}
		if _, exists := seen[stageID]; exists {
			continue
		}
		seen[stageID] = struct{}{}
		normalized = append(normalized, stageID)
	}
	sort.Strings(normalized)
	return normalized
}

// stageRecords accepts both array-shaped and object-shaped stages.json.
func stageRecords(value any) []map[string]any {
	switch typed := value.(type) {
	case []any:
		records := make([]map[string]any, 0, len(typed))
		for _, raw := range typed {
			if record := asRecord(raw); record != nil {
				records = append(records, record)
			}
		}
		return records
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		records := make([]map[string]any, 0, len(keys))
		for _, key := range keys {
			if record := asRecord(typed[key]); record != nil {
				records = append(records, record)
			}
		}
		return records
	default:
		return nil
	}
}

func cloneStageCodeMap(source map[string]StageCodeInfo) map[string]StageCodeInfo {
	clone := make(map[string]StageCodeInfo, len(source))
	for key, value := range source {
		clone[key] = value
	}
	return clone
}

func mathMaxZero(value float64) float64 {
	if value < 0 || math.IsNaN(value) {
		return 0
	}
	return value
}
