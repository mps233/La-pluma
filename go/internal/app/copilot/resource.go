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
	// byCode keeps every catalog record for a display code in source order:
	// MaaResource stages.json first, then the generated game-data catalog.
	// A code can occur more than once because MAA lists difficulty variants
	// and because the two catalogs overlap.
	byCode map[string][]map[string]any
}

// ResourceIndex reads MaaResource stages and Arknights-Tile-Pos metadata from
// Paths.MaaDataDir/resource plus the generated game-data stage catalog in
// Paths.DataDir. It deliberately does not import the MAA service: only local
// JSON files are consulted.
type ResourceIndex struct {
	resourceDir string
	gameDataDir string
	now         func() time.Time

	mu          sync.Mutex
	stageMaps   map[string]stageMapCacheEntry
	tileNames   *tileNamesCache
	stageRecord map[string]stageCatalogCache
}

func NewResourceIndex(paths config.Paths) *ResourceIndex {
	return &ResourceIndex{
		resourceDir: filepath.Join(paths.MaaDataDir, "resource"),
		gameDataDir: paths.DataDir,
		now:         time.Now,
		stageMaps:   map[string]stageMapCacheEntry{},
		stageRecord: map[string]stageCatalogCache{},
	}
}

func (r *ResourceIndex) ResourceDir() string { return r.resourceDir }

// HasStageTile reports whether the installed MAA resource has tile metadata
// for the internal stage id. MaaCore loads the base resource plus the
// hot-update checkout, so both are inspected. A missing tile directory means
// the resource cannot be inspected, so execution is not blocked on it.
func (r *ResourceIndex) HasStageTile(stageID string) bool {
	stageID = strings.TrimSpace(stageID)
	if stageID == "" {
		return true
	}
	tileDirs := []string{
		filepath.Join(r.resourceDir, tilePosDirName),
		// maa hot-update keeps its checkout next to the base resource.
		filepath.Join(filepath.Dir(r.resourceDir), "MaaResource", "resource", tilePosDirName),
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	inspected := false
	for _, tileDir := range tileDirs {
		if info, err := os.Stat(tileDir); err != nil || !info.IsDir() {
			continue
		}
		inspected = true
		for _, name := range r.tileFilenamesLocked(tileDir) {
			if strings.HasPrefix(name, stageID+"-") || strings.HasPrefix(name, stageID+"#") {
				return true
			}
		}
	}
	return !inspected
}

// StageByCode looks up a stage record in the local catalogs by display code
// (case-insensitive). MaaResource stages.json wins when both catalogs know the
// code, matching the previous behavior; the generated game-data catalog fills
// codes MAA does not ship (activity and newer mainline stages).
func (r *ResourceIndex) StageByCode(code string) (map[string]any, bool, error) {
	records, err := r.stageRecordsByCode(code)
	if err != nil || len(records) == 0 {
		return nil, false, err
	}
	return records[0], true, nil
}

// StageIDsByCode returns every distinct internal stage id the local catalogs
// map to a display code, in source order. PRTS accepts the base stage id as a
// level keyword; suffixes such as #f#/#s and MAA's _perm/_rep markers are not
// part of the level id it indexes.
func (r *ResourceIndex) StageIDsByCode(code string) []string {
	records, err := r.stageRecordsByCode(code)
	if err != nil || len(records) == 0 {
		return nil
	}
	ids := make([]string, 0, len(records))
	seen := map[string]struct{}{}
	for _, record := range records {
		stageID := cleanStageSearchID(asString(record["stageId"]))
		if stageID == "" {
			stageID = cleanStageSearchID(asString(record["id"]))
		}
		if stageID == "" {
			continue
		}
		if _, exists := seen[stageID]; exists {
			continue
		}
		seen[stageID] = struct{}{}
		ids = append(ids, stageID)
	}
	return ids
}

func (r *ResourceIndex) stageRecordsByCode(code string) ([]map[string]any, error) {
	normalized := strings.ToUpper(strings.TrimSpace(code))
	if normalized == "" {
		return nil, nil
	}
	catalog, err := r.loadStageCatalog()
	if err != nil {
		return nil, err
	}
	return catalog[normalized], nil
}

func (r *ResourceIndex) loadStageCatalog() (map[string][]map[string]any, error) {
	cacheKey := r.resourceDir + "\x00" + r.gameDataDir
	r.mu.Lock()
	if cached, ok := r.stageRecord[cacheKey]; ok && cached.expiresAt.After(r.now()) {
		byCode := cached.byCode
		r.mu.Unlock()
		return byCode, nil
	}
	r.mu.Unlock()

	paths := []string{
		filepath.Join(r.resourceDir, "stages.json"),
		// maa hot-update keeps a newer checkout next to the base resource.
		filepath.Join(filepath.Dir(r.resourceDir), "MaaResource", "resource", "stages.json"),
	}
	if strings.TrimSpace(r.gameDataDir) != "" {
		paths = append(paths, filepath.Join(r.gameDataDir, "stages.json"))
	}
	byCode := map[string][]map[string]any{}
	loaded := false
	var lastErr error
	for _, path := range paths {
		value, err := jsonstore.Read(path, nil)
		if err != nil {
			lastErr = err
			continue
		}
		loaded = true
		for _, record := range stageRecords(value) {
			code := strings.ToUpper(strings.TrimSpace(asString(record["code"])))
			if code == "" {
				continue
			}
			// The generated game-data catalog stores the internal id as `id`
			// while MaaResource uses `stageId`; normalize once here so callers
			// only need to know one shape.
			if strings.TrimSpace(asString(record["stageId"])) == "" {
				if id := strings.TrimSpace(asString(record["id"])); id != "" {
					record["stageId"] = id
				}
			}
			byCode[code] = append(byCode[code], record)
		}
	}
	if !loaded && lastErr != nil {
		return nil, lastErr
	}

	r.mu.Lock()
	r.stageRecord[cacheKey] = stageCatalogCache{expiresAt: r.now().Add(stageMapCacheTTL), byCode: byCode}
	r.mu.Unlock()
	return byCode, nil
}

// cleanStageSearchID trims markers that identify a variant in local catalogs
// but are absent from PRTS level keywords: #f#/#n#/#s suffixes and MAA's
// _perm/_rep markers. PRTS indexes the base level id (for example a001_01 for
// the permanent GT-1 stage), so querying the raw marker returns its global
// list instead of a filtered one.
func cleanStageSearchID(stageID string) string {
	stageID = strings.TrimSpace(stageID)
	if index := strings.IndexByte(stageID, '#'); index >= 0 {
		stageID = stageID[:index]
	}
	for _, suffix := range []string{"_perm", "_rep"} {
		if strings.HasSuffix(stageID, suffix) {
			stageID = strings.TrimSuffix(stageID, suffix)
			break
		}
	}
	return strings.TrimSpace(stageID)
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
