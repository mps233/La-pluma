package activity

import (
	"context"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const resourceCacheTTL = 5 * time.Minute

var activityStagePattern = regexp.MustCompile(`-(\d+)$`)

type resourceCache struct {
	expiresAt time.Time
	stages    []map[string]any
	byCode    map[string]map[string]any
}

// ResourceIndex reads MaaResource stages.json. It is deliberately independent
// of internal/app/copilot so the activity package stays self-contained.
type ResourceIndex struct {
	resourceDir string
	now         func() time.Time

	mu    sync.Mutex
	cache *resourceCache
}

func NewResourceIndex(paths config.Paths) *ResourceIndex {
	return NewResourceIndexWithNow(paths, time.Now)
}

func NewResourceIndexWithNow(paths config.Paths, now func() time.Time) *ResourceIndex {
	if now == nil {
		now = time.Now
	}
	return &ResourceIndex{
		resourceDir: filepath.Join(paths.MaaDataDir, "resource"),
		now:         now,
	}
}

func (r *ResourceIndex) ResourceDir() string { return r.resourceDir }

func (r *ResourceIndex) load() ([]map[string]any, map[string]map[string]any, error) {
	r.mu.Lock()
	if cached := r.cache; cached != nil && cached.expiresAt.After(r.now()) {
		stages, byCode := cached.stages, cached.byCode
		r.mu.Unlock()
		return stages, byCode, nil
	}
	r.mu.Unlock()

	value, err := jsonstore.Read(filepath.Join(r.resourceDir, "stages.json"), nil)
	if err != nil {
		return nil, nil, err
	}
	stages := stageRecords(value)
	byCode := make(map[string]map[string]any, len(stages))
	for _, record := range stages {
		code := asString(record["code"])
		if code == "" {
			continue
		}
		byCode[strings.ToUpper(code)] = record
	}

	r.mu.Lock()
	r.cache = &resourceCache{expiresAt: r.now().Add(resourceCacheTTL), stages: stages, byCode: byCode}
	r.mu.Unlock()
	return stages, byCode, nil
}

// StageID resolves a display stage code to stages.json's stageId.
func (r *ResourceIndex) StageID(_ context.Context, code string) (string, bool) {
	_, byCode, err := r.load()
	if err != nil {
		return "", false
	}
	record, ok := byCode[strings.ToUpper(strings.TrimSpace(code))]
	if !ok {
		return "", false
	}
	stageID, ok := record["stageId"].(string)
	if !ok || stageID == "" {
		return "", false
	}
	return stageID, true
}

// ListActivityStageCodes mirrors collectMaaActivityStageCodes: only numeric
// suffixes are returned, ordered by stage number then code.
func (r *ResourceIndex) ListActivityStageCodes(activityCode string) ([]string, error) {
	stages, _, err := r.load()
	if err != nil {
		return nil, err
	}
	return collectActivityStageCodes(stages, activityCode), nil
}

func collectActivityStageCodes(stages []map[string]any, activityCode string) []string {
	prefix := strings.ToUpper(strings.TrimSpace(activityCode)) + "-"
	if prefix == "-" {
		return []string{}
	}
	type entry struct {
		code   string
		number int
	}
	byCode := map[string]int{}
	order := make([]string, 0)
	for _, stage := range stages {
		code := strings.ToUpper(strings.TrimSpace(asString(stage["code"])))
		if !strings.HasPrefix(code, prefix) {
			continue
		}
		suffix := strings.TrimPrefix(code, prefix)
		if suffix == "" {
			continue
		}
		if _, err := strconv.Atoi(suffix); err != nil {
			continue
		}
		number, err := strconv.Atoi(suffix)
		if err != nil || number < 0 {
			continue
		}
		if _, exists := byCode[code]; !exists {
			byCode[code] = number
			order = append(order, code)
		}
	}
	entries := make([]entry, 0, len(order))
	for _, code := range order {
		entries = append(entries, entry{code: code, number: byCode[code]})
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].number != entries[j].number {
			return entries[i].number < entries[j].number
		}
		return entries[i].code < entries[j].code
	})
	result := make([]string, 0, len(entries))
	for _, item := range entries {
		result = append(result, item.code)
	}
	return result
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

func activityStageNumber(stage string) *int {
	match := activityStagePattern.FindStringSubmatch(stage)
	if match == nil {
		return nil
	}
	number, err := strconv.Atoi(match[1])
	if err != nil {
		return nil
	}
	return &number
}
