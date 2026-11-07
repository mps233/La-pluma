package copilot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const (
	defaultPRTSBaseURL   = "https://prts.maa.plus"
	defaultStageStatsURL = "https://penguin-stats.io/PenguinStats/api/v2/stages?server=CN"
	PRTSRequestCode      = "COPILOT_PRTS_REQUEST_FAILED"
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
