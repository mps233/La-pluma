package copilot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const (
	defaultPRTSBaseURL   = "https://prts.maa.plus"
	defaultStageStatsURL = "https://penguin-stats.io/PenguinStats/api/v2/stages?server=CN"
	PRTSRequestCode      = "COPILOT_PRTS_REQUEST_FAILED"

	levelCatalogPath       = "/arknights/level?language=zh_cn"
	levelCatalogTTL        = 6 * time.Hour
	levelCatalogFailureTTL = time.Minute
	levelCatalogTimeout    = 12 * time.Second
)

// HTTPClient is the narrow seam used by tests with httptest.Server. The
// production client uses net/http; tests always inject a test server so the
// suite never reaches the real PRTS or PenguinStats services.
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// PRTSClientOptions configures the PRTS HTTP client. Zero values fall back to
// the public PRTS endpoint, a 15 second timeout and three attempts.
type PRTSClientOptions struct {
	BaseURL       string
	StageStatsURL string
	// StageStatsURL may be set to "-" to disable the PenguinStats fallback.
	HTTPClient  HTTPClient
	Timeout     time.Duration
	MaxAttempts int
	Sleep       func(context.Context, time.Duration) error
}

// PRTSClient talks to the public copilot service and the optional stage
// statistics fallback. All requests are retried like the Node fetchJson helper.
type PRTSClient struct {
	baseURL       string
	stageStatsURL string
	httpClient    HTTPClient
	timeout       time.Duration
	maxAttempts   int
	sleep         func(context.Context, time.Duration) error

	levelMu    sync.Mutex
	levelCache *levelCatalogCache
}

// levelCatalogCache maps display stage codes and exact stage names to the
// internal level ids PRTS indexes. The public level table is the authority
// for activity and newly released stages that local MAA/game-data catalogs
// may not know yet, so it is fetched on demand and cached in memory.
type levelCatalogCache struct {
	expiresAt time.Time
	byCode    map[string][]string
	byName    map[string]string
}

func NewPRTSClient(options PRTSClientOptions) *PRTSClient {
	baseURL := strings.TrimRight(strings.TrimSpace(options.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultPRTSBaseURL
	}
	stageStatsURL := options.StageStatsURL
	if stageStatsURL == "" {
		stageStatsURL = defaultStageStatsURL
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	timeout := options.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	attempts := options.MaxAttempts
	if attempts <= 0 {
		attempts = 3
	}
	sleep := options.Sleep
	if sleep == nil {
		sleep = sleepContext
	}
	return &PRTSClient{
		baseURL:       baseURL,
		stageStatsURL: stageStatsURL,
		httpClient:    client,
		timeout:       timeout,
		maxAttempts:   attempts,
		sleep:         sleep,
	}
}

func (c *PRTSClient) BaseURL() string { return c.baseURL }

// GetSet reads /set/get?id=... and returns the unwrapped data object.
func (c *PRTSClient) GetSet(ctx context.Context, setId string) (map[string]any, error) {
	value, err := c.fetchJSON(ctx, http.MethodGet, fmt.Sprintf("%s/set/get?id=%s", c.baseURL, url.QueryEscape(setId)), nil)
	if err != nil {
		return nil, err
	}
	return asRecord(value), nil
}

// GetSetRaw returns the raw /set/get envelope, matching the Node proxy.
func (c *PRTSClient) GetSetRaw(ctx context.Context, setId string) (map[string]any, error) {
	value, err := c.doJSON(ctx, http.MethodGet, fmt.Sprintf("%s/set/get?id=%s", c.baseURL, url.QueryEscape(setId)), nil)
	if err != nil {
		return nil, err
	}
	return asRecord(value), nil
}

// GetCopilotRaw returns the raw /copilot/get/{id} envelope, matching the Node
// proxy. Plan builders still use GetCopilot for the unwrapped content.
func (c *PRTSClient) GetCopilotRaw(ctx context.Context, id string) (map[string]any, error) {
	value, err := c.doJSON(ctx, http.MethodGet, fmt.Sprintf("%s/copilot/get/%s", c.baseURL, id), nil)
	if err != nil {
		return nil, err
	}
	return asRecord(value), nil
}

// GetCopilot reads /copilot/get/{id} and returns the unwrapped data object.
func (c *PRTSClient) GetCopilot(ctx context.Context, id string) (map[string]any, error) {
	value, err := c.fetchJSON(ctx, http.MethodGet, fmt.Sprintf("%s/copilot/get/%s", c.baseURL, id), nil)
	if err != nil {
		return nil, err
	}
	return asRecord(value), nil
}

// QueryCopilots reads /copilot/query and returns the data.data array. A
// non-200 status_code produces an empty result, matching the Node discovery
// service, which only trusts an explicit success envelope.
func (c *PRTSClient) QueryCopilots(ctx context.Context, keyword string, page, limit int, orderBy string) ([]any, error) {
	endpoint := fmt.Sprintf("%s/copilot/query?level_keyword=%s&page=%d&limit=%d&order_by=%s",
		c.baseURL, url.QueryEscape(keyword), page, limit, url.QueryEscape(orderBy))
	payload, err := c.doJSON(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	record := asRecord(payload)
	if record == nil {
		return []any{}, nil
	}
	if code, ok := numberValue(record["status_code"]); !ok || code != 200 {
		return []any{}, nil
	}
	data := asRecord(record["data"])
	return append([]any{}, asArray(dataArray(data))...), nil
}

// QuerySets posts /set/query and returns the data.data array.
func (c *PRTSClient) QuerySets(ctx context.Context, keyword string, page, limit int) ([]any, error) {
	body := map[string]any{"keyword": keyword, "page": page, "limit": limit}
	payload, err := c.doJSON(ctx, http.MethodPost, c.baseURL+"/set/query", body)
	if err != nil {
		return nil, err
	}
	record := asRecord(payload)
	if record == nil {
		return []any{}, nil
	}
	if code, ok := numberValue(record["status_code"]); !ok || code != 200 {
		return []any{}, nil
	}
	data := asRecord(record["data"])
	return append([]any{}, asArray(dataArray(data))...), nil
}

// ResolveStageIDs maps a display stage code (for example TL-EX-8) or an exact,
// unambiguous stage name (for example 暴君) to the internal level ids accepted
// by /copilot/query. The public level table is fetched on demand and cached;
// callers should treat a nil result as "not resolved" and fall back to local
// catalogs. Querying PRTS with an unknown level keyword is not an error: the
// server silently returns its global operation list, so resolving first is
// what makes the search filter effective.
func (c *PRTSClient) ResolveStageIDs(ctx context.Context, query string) []string {
	normalized := strings.ToUpper(strings.TrimSpace(query))
	if normalized == "" {
		return nil
	}
	catalog := c.levelCatalog(ctx)
	if catalog == nil {
		return nil
	}
	if ids, ok := catalog.byCode[normalized]; ok && len(ids) > 0 {
		return append([]string(nil), ids...)
	}
	if id, ok := catalog.byName[strings.TrimSpace(query)]; ok && id != "" {
		return []string{id}
	}
	return nil
}

func (c *PRTSClient) levelCatalog(ctx context.Context) *levelCatalogCache {
	c.levelMu.Lock()
	defer c.levelMu.Unlock()
	now := time.Now()
	if c.levelCache != nil && c.levelCache.expiresAt.After(now) {
		if len(c.levelCache.byCode) == 0 && len(c.levelCache.byName) == 0 {
			return nil
		}
		return c.levelCache
	}
	catalog, err := c.fetchLevelCatalog(ctx)
	if err != nil {
		// Cache the failure briefly so a burst of unresolved searches does not
		// hammer a level endpoint that is already failing.
		c.levelCache = &levelCatalogCache{expiresAt: now.Add(levelCatalogFailureTTL)}
		return nil
	}
	c.levelCache = catalog
	return catalog
}

func (c *PRTSClient) fetchLevelCatalog(ctx context.Context) (*levelCatalogCache, error) {
	fetchCtx, cancel := context.WithTimeout(ctx, levelCatalogTimeout)
	defer cancel()
	payload, err := c.doJSON(fetchCtx, http.MethodGet, c.baseURL+levelCatalogPath, nil)
	if err != nil {
		return nil, err
	}
	record := asRecord(payload)
	if record == nil {
		return nil, fmt.Errorf("关卡列表格式无效")
	}
	if code, ok := numberValue(record["status_code"]); !ok || code != 200 {
		return nil, fmt.Errorf("关卡列表返回失败")
	}
	items := asArray(record["data"])
	if len(items) == 0 {
		return nil, fmt.Errorf("关卡列表为空")
	}

	type codeCandidate struct {
		id   string
		rank int
	}
	codeCandidates := map[string][]codeCandidate{}
	addCandidate := func(code, stageID string, rank int) {
		if code == "" || stageID == "" {
			return
		}
		codeCandidates[code] = append(codeCandidates[code], codeCandidate{id: stageID, rank: rank})
	}
	nameIDs := map[string]map[string]struct{}{}
	for _, raw := range items {
		level := asRecord(raw)
		if level == nil {
			continue
		}
		stageID := cleanStageSearchID(asString(level["stage_id"]))
		if stageID == "" {
			continue
		}
		display := strings.ToUpper(strings.TrimSpace(asString(level["cat_three"])))
		if display != "" {
			addCandidate(display, stageID, 0)
			if base, rank := splitStageVariant(display); base != display {
				addCandidate(base, stageID, rank)
			}
		}
		if name := strings.TrimSpace(asString(level["name"])); name != "" {
			ids := nameIDs[name]
			if ids == nil {
				ids = map[string]struct{}{}
				nameIDs[name] = ids
			}
			ids[stageID] = struct{}{}
		}
	}

	byCode := make(map[string][]string, len(codeCandidates))
	for code, candidates := range codeCandidates {
		sort.SliceStable(candidates, func(i, j int) bool {
			return candidates[i].rank < candidates[j].rank
		})
		ids := make([]string, 0, len(candidates))
		seen := map[string]struct{}{}
		for _, candidate := range candidates {
			if _, exists := seen[candidate.id]; exists {
				continue
			}
			seen[candidate.id] = struct{}{}
			ids = append(ids, candidate.id)
		}
		byCode[code] = ids
	}
	byName := map[string]string{}
	for name, ids := range nameIDs {
		if len(ids) != 1 {
			// Ambiguous names (for example 坚城高墙) are left unresolved
			// instead of guessing one difficulty variant.
			continue
		}
		for id := range ids {
			byName[name] = id
		}
	}
	return &levelCatalogCache{
		expiresAt: time.Now().Add(levelCatalogTTL),
		byCode:    byCode,
		byName:    byName,
	}, nil
}

// splitStageVariant strips the localized difficulty suffix PRTS appends to
// mainline codes. Plain codes rank first, then the standard variant, then the
// easier and tougher variants.
func splitStageVariant(display string) (string, int) {
	variants := []struct {
		suffix string
		rank   int
	}{
		{"（标准）", 1},
		{"（简单）", 2},
		{"（磨难）", 3},
	}
	for _, variant := range variants {
		if strings.HasSuffix(display, variant.suffix) {
			base := strings.TrimSpace(strings.TrimSuffix(display, variant.suffix))
			return base, variant.rank
		}
	}
	return display, 0
}

// StageStats reads the PenguinStats stage table used as the last AP-cost
// fallback. An empty or "-" URL disables the request and returns nil.
func (c *PRTSClient) StageStats(ctx context.Context) ([]any, error) {
	if c.stageStatsURL == "" || c.stageStatsURL == "-" {
		return nil, nil
	}
	value, err := c.fetchJSON(ctx, http.MethodGet, c.stageStatsURL, nil)
	if err != nil {
		return nil, err
	}
	return asArray(value), nil
}

func dataArray(data map[string]any) any {
	if data == nil {
		return nil
	}
	return data["data"]
}

// fetchJSON mirrors copilotPlanService.fetchJson: non-2xx responses fail, a
// non-200 status_code fails, and the `data` field is unwrapped when truthy.
// API-level failures are retried like the Node helper.
func (c *PRTSClient) fetchJSON(ctx context.Context, method, endpoint string, body any) (any, error) {
	var lastErr error
	for attempt := 1; attempt <= c.maxAttempts; attempt++ {
		payload, err := c.doJSONOnce(ctx, method, endpoint, body)
		if err == nil {
			value, unwrapErr := unwrapPayload(payload)
			if unwrapErr == nil {
				return value, nil
			}
			err = unwrapErr
		}
		lastErr = err
		if attempt < c.maxAttempts {
			if sleepErr := c.sleep(ctx, time.Duration(attempt)*500*time.Millisecond); sleepErr != nil {
				return nil, prtsRequestError(sleepErr)
			}
		}
	}
	return nil, prtsRequestError(lastErr)
}

func unwrapPayload(payload any) (any, error) {
	record := asRecord(payload)
	if record == nil {
		return payload, nil
	}
	if code, ok := numberValue(record["status_code"]); ok && code != 0 && code != 200 {
		message := "作业站返回失败"
		if text := asString(record["message"]); text != "" {
			message = text
		}
		return nil, fmt.Errorf("%s", message)
	}
	if data := record["data"]; truthy(data) {
		return data, nil
	}
	return payload, nil
}

// doJSON performs a retried request and decodes the raw JSON payload.
func (c *PRTSClient) doJSON(ctx context.Context, method, endpoint string, body any) (any, error) {
	var lastErr error
	for attempt := 1; attempt <= c.maxAttempts; attempt++ {
		value, err := c.doJSONOnce(ctx, method, endpoint, body)
		if err == nil {
			return value, nil
		}
		lastErr = err
		if attempt < c.maxAttempts {
			if sleepErr := c.sleep(ctx, time.Duration(attempt)*500*time.Millisecond); sleepErr != nil {
				return nil, prtsRequestError(sleepErr)
			}
		}
	}
	return nil, prtsRequestError(lastErr)
}

func (c *PRTSClient) doJSONOnce(ctx context.Context, method, endpoint string, body any) (any, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	requestCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, method, endpoint, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// Drain a small amount so the connection can be reused.
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4*1024))
		return nil, fmt.Errorf("作业站请求失败: %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 64*1024*1024))
	if err != nil {
		return nil, err
	}
	var payload any
	if err := decodeJSON(data, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func prtsRequestError(cause error) *apperrors.Error {
	message := "网络异常"
	if cause != nil && cause.Error() != "" {
		message = cause.Error()
	}
	return apperrors.WithStatus(PRTSRequestCode, "作业站请求失败: "+message, http.StatusBadGateway, true, map[string]any{
		"cause": message,
	})
}

func sleepContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
