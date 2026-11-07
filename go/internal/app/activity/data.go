package activity

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	resourceCollectionCacheWindow = 60 * time.Second
	stageActivityTimeLayout       = "2006/01/02 15:04:05"
)

var (
	stageActivityTimePattern = regexp.MustCompile(`^(\d{4})/(\d{2})/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$`)
	stagePrefixPattern       = regexp.MustCompile(`(?i)^([A-Z]{1,8})-`)
	sideStoryReopenPattern   = regexp.MustCompile(`(?i)^SSReopen-`)
)

type activityWindow struct {
	startTime *int64
	endTime   *int64
}

// NormalizeClientType mirrors normalizeActivityClientType.
func NormalizeClientType(clientType string) string {
	switch strings.ToLower(strings.TrimSpace(clientType)) {
	case "bilibili":
		return "Official"
	case "txwy":
		return "txwy"
	case "yostaren":
		return "YostarEN"
	case "yostarjp":
		return "YostarJP"
	case "yostarkr":
		return "YostarKR"
	default:
		return "Official"
	}
}

// NormalizeActivityClientType is the Node-name alias for NormalizeClientType.
func NormalizeActivityClientType(clientType string) string { return NormalizeClientType(clientType) }

// ParseStageActivityTime parses "YYYY/MM/DD HH:mm:ss" at the given UTC offset
// in hours (default 8).
func ParseStageActivityTime(value any, timeZone any) (int64, bool) {
	text, ok := value.(string)
	if !ok {
		return 0, false
	}
	match := stageActivityTimePattern.FindStringSubmatch(text)
	if match == nil {
		return 0, false
	}
	offsetHours := 8.0
	if parsed, ok := numberValue(timeZone); ok {
		offsetHours = parsed
	}
	year := mustAtoi(match[1])
	month := mustAtoi(match[2])
	day := mustAtoi(match[3])
	hour := mustAtoi(match[4])
	minute := mustAtoi(match[5])
	second := mustAtoi(match[6])
	utc := time.Date(year, time.Month(month), day, hour, minute, second, 0, time.UTC)
	return utc.UnixMilli() - int64(offsetHours*60*60*1000), true
}

func mustAtoi(value string) int {
	parsed := 0
	for _, char := range value {
		parsed = parsed*10 + int(char-'0')
	}
	return parsed
}

func getActivityWindow(activity any) activityWindow {
	record := asRecord(activity)
	if record == nil {
		record = map[string]any{}
	}
	window := activityWindow{}
	if start, ok := ParseStageActivityTime(record["UtcStartTime"], record["TimeZone"]); ok {
		window.startTime = &start
	}
	if end, ok := ParseStageActivityTime(record["UtcExpireTime"], record["TimeZone"]); ok {
		window.endTime = &end
	}
	return window
}

// getStagePrefix returns the most common stage prefix, excluding SSReopen.
func getStagePrefix(stages []any) string {
	counts := map[string]int{}
	order := make([]string, 0)
	for _, rawStage := range stages {
		stage := asRecord(rawStage)
		if stage == nil {
			continue
		}
		value := strings.TrimSpace(jsStringOrEmpty(stage["Value"]))
		if value == "" || sideStoryReopenPattern.MatchString(value) {
			continue
		}
		match := stagePrefixPattern.FindStringSubmatch(value)
		if match == nil {
			continue
		}
		prefix := strings.ToUpper(match[1])
		if _, exists := counts[prefix]; !exists {
			order = append(order, prefix)
		}
		counts[prefix]++
	}
	sort.SliceStable(order, func(i, j int) bool {
		return counts[order[i]] > counts[order[j]]
	})
	if len(order) == 0 {
		return "SSReopen"
	}
	return order[0]
}

// SelectCurrentStageActivity mirrors selectCurrentStageActivity.
func SelectCurrentStageActivity(data any, clientType string, now time.Time) *StageActivity {
	root := asRecord(data)
	if root == nil {
		root = map[string]any{}
	}
	clientKey := NormalizeClientType(clientType)
	rawClientData := root[clientKey]
	if !truthy(rawClientData) {
		rawClientData = root["Official"]
	}
	clientData := asRecord(rawClientData)
	if clientData == nil {
		clientData = map[string]any{}
	}
	sideStoryStage := asRecord(clientData["sideStoryStage"])
	if sideStoryStage == nil {
		return nil
	}

	nowMS := now.UnixMilli()
	type candidate struct {
		activity *StageActivity
		sortKey  string
	}
	active := make([]candidate, 0)
	for key, rawValue := range sideStoryStage {
		raw := asRecord(rawValue)
		if raw == nil {
			raw = map[string]any{}
		}
		activity := asRecord(raw["Activity"])
		stages := asArray(raw["Stages"])
		if activity == nil || len(stages) == 0 {
			continue
		}

		window := getActivityWindow(activity)
		if window.startTime == nil {
			continue
		}
		if *window.startTime > nowMS {
			continue
		}
		if window.endTime != nil && *window.endTime <= nowMS {
			continue
		}

		stageValues := make([]string, 0, len(stages))
		for _, rawStage := range stages {
			stage := asRecord(rawStage)
			value := ""
			if stage != nil {
				value = strings.TrimSpace(jsStringOrEmpty(stage["Value"]))
			}
			if value == "" {
				continue
			}
			stageValues = append(stageValues, value)
		}
		if len(stageValues) == 0 {
			continue
		}

		name := ""
		if stageName, ok := activity["StageName"].(string); ok && stageName != "" {
			name = stageName
		} else if tip, ok := activity["Tip"].(string); ok && tip != "" {
			name = tip
		} else {
			name = key
		}

		minimumRequired := raw["MinimumRequired"]
		if !truthy(minimumRequired) {
			minimumRequired = nil
		}
		active = append(active, candidate{
			activity: &StageActivity{
				Code:            getStagePrefix(stages),
				Name:            name,
				Source:          "stage-activity",
				StartTime:       *window.startTime,
				EndTime:         window.endTime,
				Stages:          stageValues,
				MinimumRequired: minimumRequired,
			},
			sortKey: key,
		})
	}

	sort.SliceStable(active, func(i, j int) bool {
		if active[i].activity.StartTime != active[j].activity.StartTime {
			return active[i].activity.StartTime > active[j].activity.StartTime
		}
		return active[i].sortKey < active[j].sortKey
	})
	if len(active) == 0 {
		return nil
	}
	return active[0].activity
}

// StageActivityPath is the resolved StageActivityV2.json location.
func (s *Service) StageActivityPath() string { return s.stageActivityPath }

// GetStageActivityInfo reads StageActivityV2.json and selects the current
// activity for the client. File and JSON errors are returned to the caller,
// matching getStageActivityInfo.
func (s *Service) GetStageActivityInfo(_ context.Context, clientType string, now time.Time) (*StageActivity, error) {
	value, err := readJSONFile(s.stageActivityPath)
	if err != nil {
		return nil, err
	}
	return SelectCurrentStageActivity(value, clientType, now), nil
}

type resourceCollectionCacheEntry struct {
	value    bool
	cachedAt int64
}

// IsResourceCollectionOpen reports whether the resource collection window
// covers now, mirroring isResourceCollectionOpen.
func IsResourceCollectionOpen(data any, clientType string, now time.Time) bool {
	root := asRecord(data)
	if root == nil {
		root = map[string]any{}
	}
	clientKey := NormalizeClientType(clientType)
	rawClientData := root[clientKey]
	if !truthy(rawClientData) {
		rawClientData = root["Official"]
	}
	clientData := asRecord(rawClientData)
	if clientData == nil {
		clientData = map[string]any{}
	}
	resource := asRecord(clientData["resourceCollection"])
	if resource == nil || resource["IsResourceCollection"] != true {
		return false
	}
	window := getActivityWindow(resource)
	if window.startTime == nil {
		return false
	}
	nowMS := now.UnixMilli()
	return *window.startTime <= nowMS && (window.endTime == nil || *window.endTime > nowMS)
}

// IsResourceCollectionOpenNow reads and caches the collection window for up
// to 60 seconds. Read failures mean "closed".
func (s *Service) IsResourceCollectionOpenNow(_ context.Context, clientType string, now time.Time) bool {
	key := NormalizeClientType(clientType)
	nowMS := now.UnixMilli()

	s.resourceCollectionMu.Lock()
	cached, ok := s.resourceCollectionCache[key]
	s.resourceCollectionMu.Unlock()
	if ok && absInt64(nowMS-cached.cachedAt) < resourceCollectionCacheWindow.Milliseconds() {
		return cached.value
	}

	value, err := readJSONFile(s.stageActivityPath)
	if err != nil {
		return false
	}
	open := IsResourceCollectionOpen(value, key, now)

	s.resourceCollectionMu.Lock()
	s.resourceCollectionCache[key] = resourceCollectionCacheEntry{value: open, cachedAt: nowMS}
	s.resourceCollectionMu.Unlock()
	return open
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}
