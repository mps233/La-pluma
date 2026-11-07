package activity

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultPRTSTimeout     = 12 * time.Second
	defaultPRTSMaxAttempts = 3
)

// HTTPClient is the narrow seam used by tests with httptest.Server. The
// production client uses net/http; tests never reach the real services.
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// PRTSOptions configures the public PRTS copilot client.
type PRTSOptions struct {
	BaseURL     string
	HTTPClient  HTTPClient
	Timeout     time.Duration
	MaxAttempts int
	Sleep       func(ctx context.Context, duration time.Duration) error
}

type prtsClient struct {
	baseURL     string
	httpClient  HTTPClient
	timeout     time.Duration
	maxAttempts int
	sleep       func(ctx context.Context, duration time.Duration) error
}

type httpStatusError struct {
	status int
}

func (e *httpStatusError) Error() string { return fmt.Sprintf("HTTP %d", e.status) }

func NewPRTSClient(options PRTSOptions) *prtsClient {
	baseURL := strings.TrimRight(strings.TrimSpace(options.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultPRTSBaseURL
	}
	timeout := options.Timeout
	if timeout <= 0 {
		timeout = defaultPRTSTimeout
	}
	attempts := options.MaxAttempts
	if attempts <= 0 {
		attempts = defaultPRTSMaxAttempts
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{}
	}
	sleep := options.Sleep
	if sleep == nil {
		sleep = sleepContext
	}
	return &prtsClient{
		baseURL:     baseURL,
		httpClient:  client,
		timeout:     timeout,
		maxAttempts: attempts,
		sleep:       sleep,
	}
}

func (c *prtsClient) BaseURL() string { return c.baseURL }

// GetCopilot reads /copilot/get/{id} and unwraps data or the payload itself.
func (c *prtsClient) GetCopilot(ctx context.Context, id int) (map[string]any, error) {
	value, err := c.fetchJSON(ctx, http.MethodGet, c.baseURL+"/copilot/get/"+url.PathEscape(strconv.Itoa(id)), nil)
	if err != nil {
		return nil, err
	}
	record := asRecord(value)
	if data := asRecord(record["data"]); data != nil {
		return data, nil
	}
	if record != nil {
		return record, nil
	}
	return map[string]any{}, nil
}

// GetCopilotWithRetry mirrors fetchCopilotRecord's three attempts.
func (c *prtsClient) GetCopilotWithRetry(ctx context.Context, id int) (map[string]any, error) {
	var lastError error
	for attempt := 0; attempt < c.maxAttempts; attempt++ {
		value, err := c.GetCopilot(ctx, id)
		if err == nil {
			return value, nil
		}
		lastError = err
		if attempt < c.maxAttempts-1 {
			if sleepErr := c.sleep(ctx, time.Duration(250*(attempt+1))*time.Millisecond); sleepErr != nil {
				return nil, sleepErr
			}
		}
	}
	message := errorMessage(lastError)
	if message == "" {
		message = "网络异常"
	}
	return nil, fmt.Errorf("作业读取失败: %s", message)
}

// QueryCopilots reads /copilot/query and returns data.data only on an explicit
// status_code 200 envelope.
func (c *prtsClient) QueryCopilots(ctx context.Context, keyword string, page, limit int, orderBy string) ([]any, error) {
	endpoint := fmt.Sprintf("%s/copilot/query?level_keyword=%s&page=%d&limit=%d&order_by=%s",
		c.baseURL, url.QueryEscape(keyword), page, limit, url.QueryEscape(orderBy))
	value, err := c.fetchJSON(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	payload := asRecord(value)
	if payload == nil || jsNumber(payload["status_code"]) != 200 {
		return []any{}, nil
	}
	data := asRecord(payload["data"])
	if data == nil {
		return []any{}, nil
	}
	return asArray(data["data"]), nil
}

// QuerySets reads /set/query and returns data.data only on an explicit
// status_code 200 envelope.
func (c *prtsClient) QuerySets(ctx context.Context, keyword string, page, limit int) ([]any, error) {
	body, err := json.Marshal(map[string]any{"keyword": keyword, "page": page, "limit": limit})
	if err != nil {
		return nil, err
	}
	value, err := c.fetchJSON(ctx, http.MethodPost, c.baseURL+"/set/query", body)
	if err != nil {
		return nil, err
	}
	payload := asRecord(value)
	if payload == nil || jsNumber(payload["status_code"]) != 200 {
		return []any{}, nil
	}
	data := asRecord(payload["data"])
	if data == nil {
		return []any{}, nil
	}
	return asArray(data["data"]), nil
}

func (c *prtsClient) fetchJSON(ctx context.Context, method, endpoint string, body []byte) (any, error) {
	requestCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
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
		_, _ = io.Copy(io.Discard, response.Body)
		return nil, &httpStatusError{status: response.StatusCode}
	}
	var value any
	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

func sleepContext(ctx context.Context, duration time.Duration) error {
	if duration <= 0 {
		return nil
	}
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
