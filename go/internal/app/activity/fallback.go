package activity

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	defaultPenguinBaseURL  = "https://penguin-stats.io/PenguinStats/api/v2"
	defaultFallbackTTL     = 30 * time.Minute
	defaultFallbackTimeout = 5 * time.Second
)

var penguinStagePrefixPattern = regexp.MustCompile(`(?i)^([A-Z]{2,5})-`)

var clientServers = map[string]string{
	"Official": "CN",
	"Bilibili": "CN",
	"YostarEN": "US",
	"YostarJP": "JP",
	"YostarKR": "KR",
}

type activityExistence struct {
	openTime  int64
	closeTime *int64
}

type fallbackCacheEntry struct {
	timestamp time.Time
	value     *PenguinActivity
}

type fallbackCall struct {
	done  chan struct{}
	value *PenguinActivity
	err   error
}

// FallbackOptions configures the penguin-stats fallback client. Tests inject
// an httptest base URL.
type FallbackOptions struct {
	BaseURL    string
	HTTPClient HTTPClient
	Timeout    time.Duration
	CacheTTL   time.Duration
	Now        func() time.Time
	Logger     *slog.Logger
}

// FallbackService caches and de-duplicates penguin-stats activity requests.
type FallbackService struct {
	baseURL    string
	httpClient HTTPClient
	timeout    time.Duration
	cacheTTL   time.Duration
	now        func() time.Time
	logger     *slog.Logger

	mu       sync.Mutex
	cache    map[string]fallbackCacheEntry
	inFlight map[string]*fallbackCall
}

func NewFallbackService(options FallbackOptions) *FallbackService {
	baseURL := strings.TrimRight(strings.TrimSpace(options.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultPenguinBaseURL
	}
	timeout := options.Timeout
	if timeout <= 0 {
		timeout = defaultFallbackTimeout
	}
	cacheTTL := options.CacheTTL
	if cacheTTL <= 0 {
		cacheTTL = defaultFallbackTTL
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{}
	}
	return &FallbackService{
		baseURL:    baseURL,
		httpClient: client,
		timeout:    timeout,
		cacheTTL:   cacheTTL,
		now:        now,
		logger:     logger,
		cache:      map[string]fallbackCacheEntry{},
		inFlight:   map[string]*fallbackCall{},
	}
}

func getActiveExistence(item any, server string, now int64) *activityExistence {
	itemRecord := asRecord(item)
	if itemRecord == nil {
		itemRecord = map[string]any{}
	}
	existenceMap := asRecord(itemRecord["existence"])
	if existenceMap == nil {
		existenceMap = map[string]any{}
	}
	existence := asRecord(existenceMap[server])
	if existence == nil || !truthy(existence["exist"]) {
		return nil
	}
	openTime, openOK := numberValue(existence["openTime"])
	if !openOK || openTime > float64(now) {
		return nil
	}
	closeTime, closeOK := numberValue(existence["closeTime"])
	if closeOK && closeTime <= float64(now) {
		return nil
	}
	result := &activityExistence{openTime: int64(openTime)}
	if closeOK {
		value := int64(closeTime)
		result.closeTime = &value
	}
	return result
}

func getPenguinStagePrefix(stageCodes []string) string {
	counts := map[string]int{}
	order := make([]string, 0)
	for _, code := range stageCodes {
		match := penguinStagePrefixPattern.FindStringSubmatch(code)
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
		return ""
	}
	return order[0]
}

// SelectCurrentPenguinActivity mirrors selectCurrentPenguinActivity.
func SelectCurrentPenguinActivity(zones any, stages any, server string, now int64) *PenguinActivity {
	zoneList := asArray(zones)
	stageList := asArray(stages)
	if zoneList == nil || stageList == nil {
		return nil
	}

	type activeZone struct {
		zone     map[string]any
		window   *activityExistence
		position int
	}
	activeZones := make([]activeZone, 0)
	for position, rawZone := range zoneList {
		zone := asRecord(rawZone)
		if zone == nil || zone["type"] != "ACTIVITY" {
			continue
		}
		window := getActiveExistence(zone, server, now)
		if window == nil {
			continue
		}
		activeZones = append(activeZones, activeZone{zone: zone, window: window, position: position})
	}
	sort.SliceStable(activeZones, func(i, j int) bool {
		return activeZones[i].window.openTime > activeZones[j].window.openTime
	})

	for _, candidate := range activeZones {
		zone := candidate.zone
		stageCodes := make([]string, 0)
		for _, rawStage := range stageList {
			stage := asRecord(rawStage)
			if stage == nil {
				continue
			}
			if !equalJSONScalar(stage["zoneId"], zone["zoneId"]) {
				continue
			}
			if getActiveExistence(stage, server, now) == nil {
				continue
			}
			code := strings.TrimSpace(jsStringOrEmpty(stage["code"]))
			if code == "" {
				continue
			}
			stageCodes = append(stageCodes, code)
		}
		sort.SliceStable(stageCodes, func(i, j int) bool {
			return naturalCompare(stageCodes[i], stageCodes[j]) < 0
		})
		code := getPenguinStagePrefix(stageCodes)
		if code == "" {
			continue
		}

		name := ""
		if zoneName, ok := zone["zoneName"].(string); ok && zoneName != "" {
			name = zoneName
		} else if i18n := asRecord(zone["zoneName_i18n"]); i18n != nil {
			if zh, ok := i18n["zh"].(string); ok && zh != "" {
				name = zh
			}
		}
		if name == "" {
			name = code
		}

		return &PenguinActivity{
			Code:      code,
			Name:      name,
			Source:    "penguin",
			StartTime: candidate.window.openTime,
			EndTime:   candidate.window.closeTime,
			Stages:    stageCodes,
		}
	}
	return nil
}

// naturalCompare approximates localeCompare(..., {numeric:true}).
func naturalCompare(left, right string) int {
	leftIndex, rightIndex := 0, 0
	for leftIndex < len(left) && rightIndex < len(right) {
		leftDigit := left[leftIndex] >= '0' && left[leftIndex] <= '9'
		rightDigit := right[rightIndex] >= '0' && right[rightIndex] <= '9'
		if leftDigit && rightDigit {
			leftEnd := leftIndex
			for leftEnd < len(left) && left[leftEnd] >= '0' && left[leftEnd] <= '9' {
				leftEnd++
			}
			rightEnd := rightIndex
			for rightEnd < len(right) && right[rightEnd] >= '0' && right[rightEnd] <= '9' {
				rightEnd++
			}
			leftNumber := strings.TrimLeft(left[leftIndex:leftEnd], "0")
			rightNumber := strings.TrimLeft(right[rightIndex:rightEnd], "0")
			if leftNumber == "" {
				leftNumber = "0"
			}
			if rightNumber == "" {
				rightNumber = "0"
			}
			if len(leftNumber) != len(rightNumber) {
				if len(leftNumber) < len(rightNumber) {
					return -1
				}
				return 1
			}
			if leftNumber != rightNumber {
				return strings.Compare(leftNumber, rightNumber)
			}
			leftIndex, rightIndex = leftEnd, rightEnd
			continue
		}
		if left[leftIndex] != right[rightIndex] {
			return strings.Compare(left[leftIndex:], right[rightIndex:])
		}
		leftIndex++
		rightIndex++
	}
	switch {
	case leftIndex < len(left):
		return 1
	case rightIndex < len(right):
		return -1
	default:
		return 0
	}
}

// GetFallbackActivity returns the current penguin-stats activity, caching per
// client server for 30 minutes and de-duplicating concurrent requests.
func (s *FallbackService) GetFallbackActivity(ctx context.Context, clientType string) (*PenguinActivity, error) {
	server, ok := clientServers[clientType]
	if !ok {
		s.logger.Debug("Penguin 没有该客户端的数据源", "clientType", clientType)
		return nil, nil
	}

	s.mu.Lock()
	if cached, exists := s.cache[server]; exists && s.now().Sub(cached.timestamp) < s.cacheTTL {
		value := cached.value
		s.mu.Unlock()
		return value, nil
	}
	if call, exists := s.inFlight[server]; exists {
		s.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-call.done:
			return call.value, call.err
		}
	}
	call := &fallbackCall{done: make(chan struct{})}
	s.inFlight[server] = call
	s.mu.Unlock()

	go func() {
		requestCtx, cancel := context.WithTimeout(context.Background(), s.timeout)
		defer cancel()
		zones, stages, err := s.fetchZonesAndStages(requestCtx, server)
		var value *PenguinActivity
		if err == nil {
			value = SelectCurrentPenguinActivity(zones, stages, server, s.now().UnixMilli())
		}
		call.value = value
		call.err = err
		if err == nil {
			s.mu.Lock()
			s.cache[server] = fallbackCacheEntry{timestamp: s.now(), value: value}
			s.mu.Unlock()
		}
		s.mu.Lock()
		delete(s.inFlight, server)
		s.mu.Unlock()
		close(call.done)
	}()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-call.done:
		return call.value, call.err
	}
}

func (s *FallbackService) fetchZonesAndStages(ctx context.Context, server string) (any, any, error) {
	type result struct {
		value any
		err   error
	}
	zonesCh := make(chan result, 1)
	stagesCh := make(chan result, 1)
	go func() {
		value, err := s.fetchJSON(ctx, fmt.Sprintf("%s/zones?server=%s", s.baseURL, url.QueryEscape(server)))
		zonesCh <- result{value: value, err: err}
	}()
	go func() {
		value, err := s.fetchJSON(ctx, fmt.Sprintf("%s/stages?server=%s", s.baseURL, url.QueryEscape(server)))
		stagesCh <- result{value: value, err: err}
	}()
	zones := <-zonesCh
	stages := <-stagesCh
	if zones.err != nil {
		return nil, nil, zones.err
	}
	if stages.err != nil {
		return nil, nil, stages.err
	}
	return zones.value, stages.value, nil
}

func (s *FallbackService) fetchJSON(ctx context.Context, endpoint string) (any, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	response, err := s.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, response.Body)
		return nil, fmt.Errorf("HTTP %d", response.StatusCode)
	}
	var value any
	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}
