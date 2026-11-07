package activity

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"time"

	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
)

const activityCacheTTL = 24 * 60 * 60 * 1000

var (
	activityNamePattern  = regexp.MustCompile(`「([^」]+)」`)
	activityCodePatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\(([A-Z]{2,3})-\d+`),
		regexp.MustCompile(`(?i)([A-Z]{2,3})-\d+`),
		regexp.MustCompile(`(?i)SideStory[:\s]+.*?([A-Z]{2,3})-\d+`),
		regexp.MustCompile(`(?i)\b([A-Z]{2,3})-\d+\b`),
	}
)

// GetCurrentActivity is the Node-name alias for CurrentActivity.
func (s *Service) GetCurrentActivity(ctx context.Context, clientType string) (*Info, error) {
	return s.CurrentActivity(ctx, clientType)
}

// CurrentActivity mirrors maaService.getCurrentActivity: memory cache,
// persisted activity-cache, StageActivityV2, `maa activity`, penguin-stats,
// then a stale fallback. It never fails because every source is optional.
func (s *Service) CurrentActivity(ctx context.Context, clientType string) (*Info, error) {
	if strings.TrimSpace(clientType) == "" {
		clientType = DefaultClientType
	}
	now := s.now()

	s.cacheMu.Lock()
	entry, exists := s.memoryCache[clientType]
	s.cacheMu.Unlock()

	var staleCandidate *Info
	if exists && entry.Code != nil && *entry.Code != "" {
		copyValue := entry
		staleCandidate = &copyValue
	}
	if exists {
		if cached, ok := validCachedActivity(entry, now); ok {
			full := s.withFullActivityStages(ctx, activeActivity(cached, entry.Timestamp, entry.Timestamp))
			return &full, nil
		}
		s.cacheMu.Lock()
		delete(s.memoryCache, clientType)
		s.cacheMu.Unlock()
	}

	persistedData, err := s.activityCache.Load(ctx)
	if err != nil || persistedData == nil {
		persistedData = map[string]any{}
	}
	rawPersisted, hasPersisted := persistedData[clientType]
	persistedEntry := asRecord(rawPersisted)
	if !hasPersisted {
		persistedEntry = nil
	}
	if persistedEntry != nil {
		persistedInfo, timestamp, ttl := infoFromPersisted(persistedEntry)
		persistedInfo.Timestamp = &timestamp
		persistedInfo.TTL = &ttl
		if cached, ok := validCachedActivity(persistedInfo, now); ok {
			memoryEntry := persistedInfo
			s.cacheMu.Lock()
			s.memoryCache[clientType] = memoryEntry
			s.cacheMu.Unlock()
			dataUpdated := &timestamp
			if timestamp == 0 {
				value := now.UnixMilli()
				dataUpdated = &value
			}
			full := s.withFullActivityStages(ctx, activeActivity(cached, dataUpdated, dataUpdated))
			return &full, nil
		}
		if code, ok := persistedEntry["code"].(string); ok && code != "" && staleCandidate == nil {
			info, timestamp, ttl := infoFromPersisted(persistedEntry)
			info.Timestamp = &timestamp
			info.TTL = &ttl
			staleCandidate = &info
		}
	}

	failureMessage := ""
	if stageActivity, err := s.GetStageActivityInfo(ctx, clientType, now); err != nil {
		failureMessage = err.Error()
	} else if stageActivity != nil && stageActivity.Code != "" {
		info := infoFromStageActivity(stageActivity)
		cached := s.cacheActivity(ctx, clientType, info)
		full := s.withFullActivityStages(ctx, activeActivity(cached, int64Ptr(now.UnixMilli()), int64Ptr(now.UnixMilli())))
		return &full, nil
	}

	if s.executor != nil {
		run, err := s.executor.RunCommand(ctx, "activity", []string{clientType}, "", "", true)
		if err != nil {
			failureMessage = err.Error()
		} else {
			name, code := parseMAAActivityOutput(commandStdout(run))
			if code != "" {
				info := Info{
					Code:   &code,
					Name:   name,
					Source: stringPtr("maa"),
					Stages: []string{},
				}
				cached := s.cacheActivity(ctx, clientType, info)
				full := s.withFullActivityStages(ctx, activeActivity(cached, int64Ptr(now.UnixMilli()), int64Ptr(now.UnixMilli())))
				return &full, nil
			}
		}
	}

	fallback, err := s.fallback.GetFallbackActivity(ctx, clientType)
	if err != nil {
		failureMessage = err.Error()
	} else if fallback != nil && fallback.Code != "" {
		info := infoFromPenguinActivity(fallback)
		cached := s.cacheActivity(ctx, clientType, info)
		full := s.withFullActivityStages(ctx, activeActivity(cached, int64Ptr(now.UnixMilli()), int64Ptr(now.UnixMilli())))
		return &full, nil
	}

	if staleCandidate != nil {
		stale := *staleCandidate
		stale.Status = "stale"
		stale.Failure = nil
		stale.DataUpdatedAt = stale.Timestamp
		stale.LastSuccessAt = stale.Timestamp
		if failureMessage != "" {
			stale.Failure = &Failure{Source: "maa", Message: failureMessage}
		}
		full := s.withFullActivityStages(ctx, stale)
		return &full, nil
	}

	status := "none"
	var failure *Failure
	if failureMessage != "" {
		status = "unavailable"
		failure = &Failure{Source: "maa", Message: failureMessage}
	}
	return &Info{
		Code:    nil,
		Name:    nil,
		Source:  nil,
		Stages:  []string{},
		Status:  status,
		Failure: failure,
	}, nil
}

func validCachedActivity(entry Info, now time.Time) (Info, bool) {
	if entry.Code == nil || *entry.Code == "" || entry.Timestamp == nil || *entry.Timestamp == 0 {
		return Info{}, false
	}
	ttl := int64(activityCacheTTL)
	if entry.TTL != nil && *entry.TTL != 0 {
		ttl = *entry.TTL
	}
	expiresAt := *entry.Timestamp + ttl
	if endTime, ok := timeValueMillis(entry.EndTime); ok && endTime > 0 && endTime < expiresAt {
		expiresAt = endTime
	}
	if now.UnixMilli() >= expiresAt {
		return Info{}, false
	}
	result := entry
	result.Timestamp = nil
	result.TTL = nil
	result.Status = ""
	result.DataUpdatedAt = nil
	result.LastSuccessAt = nil
	result.Failure = nil
	return result, true
}

func activeActivity(info Info, dataUpdated, lastSuccess *int64) Info {
	info.Status = "active"
	info.Failure = nil
	info.DataUpdatedAt = dataUpdated
	info.LastSuccessAt = lastSuccess
	return info
}

func (s *Service) withFullActivityStages(ctx context.Context, info Info) Info {
	if info.Code == nil || *info.Code == "" {
		return info
	}
	_ = ctx
	stages, err := s.resource.ListActivityStageCodes(*info.Code)
	if err == nil && len(stages) > 0 {
		info.Stages = stages
	}
	if info.Stages == nil {
		info.Stages = []string{}
	}
	return info
}

func (s *Service) cacheActivity(ctx context.Context, clientType string, info Info) Info {
	nowMS := s.now().UnixMilli()
	ttl := int64(activityCacheTTL)
	cached := info
	cached.Timestamp = &nowMS
	cached.TTL = &ttl
	cached.Status = ""
	cached.DataUpdatedAt = nil
	cached.LastSuccessAt = nil
	cached.Failure = nil

	s.cacheMu.Lock()
	s.memoryCache[clientType] = cached
	s.cacheMu.Unlock()

	_ = s.activityCache.Save(ctx, map[string]any{clientType: cached})
	return info
}

func infoFromStageActivity(activity *StageActivity) Info {
	info := Info{
		Code:   stringPtr(activity.Code),
		Name:   stringPtr(activity.Name),
		Source: stringPtr(activity.Source),
		Stages: cloneStrings(activity.Stages),
	}
	if activity.StartTime != 0 {
		info.StartTime = activity.StartTime
	}
	if activity.EndTime != nil {
		info.EndTime = *activity.EndTime
	}
	return info
}

func infoFromPenguinActivity(activity *PenguinActivity) Info {
	info := Info{
		Code:   stringPtr(activity.Code),
		Name:   stringPtr(activity.Name),
		Source: stringPtr(activity.Source),
		Stages: cloneStrings(activity.Stages),
	}
	if activity.StartTime != 0 {
		info.StartTime = activity.StartTime
	}
	if activity.EndTime != nil {
		info.EndTime = *activity.EndTime
	}
	return info
}

func infoFromPersisted(entry map[string]any) (Info, int64, int64) {
	ttl := int64(activityCacheTTL)
	if parsed, ok := numberValue(entry["ttl"]); ok && parsed != 0 {
		ttl = int64(parsed)
	}
	timestamp := int64(0)
	if parsed, ok := numberValue(entry["timestamp"]); ok {
		timestamp = int64(parsed)
	}
	return infoFromPersistedEntry(entry), timestamp, ttl
}

func infoFromPersistedEntry(entry map[string]any) Info {
	info := Info{Stages: []string{}}
	if code, ok := entry["code"].(string); ok {
		info.Code = &code
	}
	if name, ok := entry["name"].(string); ok {
		info.Name = &name
	}
	if source, ok := entry["source"].(string); ok {
		info.Source = &source
	}
	if start, ok := entry["startTime"]; ok {
		info.StartTime = start
	}
	if end, ok := entry["endTime"]; ok {
		info.EndTime = end
	}
	if stages := strictStringSlice(entry["stages"]); len(stages) > 0 {
		info.Stages = stages
	}
	return info
}

func parseMAAActivityOutput(output string) (*string, string) {
	var name *string
	if match := activityNamePattern.FindStringSubmatch(output); match != nil && match[1] != "" {
		name = stringPtr(match[1])
	}
	for _, pattern := range activityCodePatterns {
		match := pattern.FindStringSubmatch(output)
		if match == nil {
			continue
		}
		code := strings.ToUpper(match[1])
		if code != "" {
			return name, code
		}
	}
	return name, ""
}

func commandStdout(run domainrun.DTO) string {
	record := asRecord(run.Result)
	if record == nil {
		return ""
	}
	return asString(record["stdout"])
}

func timeValueMillis(value any) (int64, bool) {
	switch typed := value.(type) {
	case nil:
		return 0, false
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return 0, false
		}
		if parsed, err := strconv.ParseInt(text, 10, 64); err == nil {
			return parsed, true
		}
		layouts := []string{
			time.RFC3339Nano,
			time.RFC3339,
			"2006-01-02T15:04:05",
			"2006-01-02 15:04:05",
			"2006-01-02",
		}
		for _, layout := range layouts {
			if parsed, err := time.Parse(layout, text); err == nil {
				return parsed.UnixMilli(), true
			}
		}
		return 0, false
	default:
		if parsed, ok := numberValue(value); ok {
			return int64(parsed), true
		}
		return 0, false
	}
}

func cloneStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	result := make([]string, len(values))
	copy(result, values)
	return result
}

func int64Ptr(value int64) *int64 { return &value }
