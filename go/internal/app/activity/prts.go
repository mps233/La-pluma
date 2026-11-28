package activity

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	prtsinfra "github.com/mps233/la-pluma/go/internal/infra/prts"
	"github.com/mps233/la-pluma/go/internal/util/jsval"
)

const (
	defaultPRTSTimeout     = 12 * time.Second
	defaultPRTSMaxAttempts = 3
)

// HTTPClient is the narrow seam used by tests with httptest.Server. The
// production client uses net/http; tests never reach the real services.
type HTTPClient = prtsinfra.HTTPClient

// PRTSOptions configures the public PRTS copilot client.
type PRTSOptions struct {
	BaseURL     string
	HTTPClient  HTTPClient
	Timeout     time.Duration
	MaxAttempts int
	Sleep       func(ctx context.Context, duration time.Duration) error
}

type prtsClient struct {
	client   *prtsinfra.Client
	attempts int
}

func NewPRTSClient(options PRTSOptions) *prtsClient {
	timeout := options.Timeout
	if timeout <= 0 {
		timeout = defaultPRTSTimeout
	}
	attempts := options.MaxAttempts
	if attempts <= 0 {
		attempts = defaultPRTSMaxAttempts
	}
	return &prtsClient{
		client: prtsinfra.New(prtsinfra.Options{
			BaseURL:    options.BaseURL,
			HTTPClient: options.HTTPClient,
			Timeout:    timeout,
			Sleep:      options.Sleep,
		}),
		attempts: attempts,
	}
}

func (c *prtsClient) BaseURL() string { return c.client.BaseURL() }

// retryPolicy uses the shared canonical cadence (500 ms × attempt).
func (c *prtsClient) retryPolicy() prtsinfra.RetryPolicy {
	return prtsinfra.RetryPolicy{
		Attempts: c.attempts,
		Delay: func(attempt int) time.Duration {
			return time.Duration(500*(attempt+1)) * time.Millisecond
		},
	}
}

// GetCopilot reads /copilot/get/{id} and unwraps data or the payload itself.
func (c *prtsClient) GetCopilot(ctx context.Context, id int) (map[string]any, error) {
	value, err := c.client.Do(ctx, http.MethodGet, c.client.BaseURL()+"/copilot/get/"+url.PathEscape(strconv.Itoa(id)), nil)
	if err != nil {
		return nil, err
	}
	record := jsval.Record(value)
	if data := jsval.Record(record["data"]); data != nil {
		return data, nil
	}
	if record != nil {
		return record, nil
	}
	return map[string]any{}, nil
}

// GetCopilotWithRetry mirrors fetchCopilotRecord's three attempts.
func (c *prtsClient) GetCopilotWithRetry(ctx context.Context, id int) (map[string]any, error) {
	value, err := c.client.DoWithRetry(
		ctx,
		http.MethodGet,
		c.client.BaseURL()+"/copilot/get/"+url.PathEscape(strconv.Itoa(id)),
		nil,
		c.retryPolicy(),
	)
	if err == nil {
		record := jsval.Record(value)
		if data := jsval.Record(record["data"]); data != nil {
			return data, nil
		}
		if record != nil {
			return record, nil
		}
		return map[string]any{}, nil
	}
	message := errorMessage(err)
	if message == "" {
		message = "网络异常"
	}
	return nil, fmt.Errorf("作业读取失败: %s", message)
}

// QueryCopilots reads /copilot/query and returns data.data only on an explicit
// status_code 200 envelope. A non-200 envelope is retryable like a transport
// error.
func (c *prtsClient) QueryCopilots(ctx context.Context, keyword string, page, limit int, orderBy string) ([]any, error) {
	endpoint := fmt.Sprintf("%s/copilot/query?level_keyword=%s&page=%d&limit=%d&order_by=%s",
		c.client.BaseURL(), url.QueryEscape(keyword), page, limit, url.QueryEscape(orderBy))
	value, err := c.client.DoWithRetryFunc(ctx, func() (any, error) {
		value, err := c.client.Do(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		payload := jsval.Record(value)
		if payload == nil {
			return nil, fmt.Errorf("作业站查询失败: status_code %v", -1)
		}
		if status := jsval.NumberOrZero(payload["status_code"]); status != 200 {
			return nil, fmt.Errorf("作业站查询失败: status_code %v", status)
		}
		return value, nil
	}, c.retryPolicy())
	if err != nil {
		return nil, err
	}
	payload := jsval.Record(value)
	data := jsval.Record(payload["data"])
	if data == nil {
		return []any{}, nil
	}
	return jsval.Array(data["data"]), nil
}

// QuerySets reads /set/query and returns data.data only on an explicit
// status_code 200 envelope.
func (c *prtsClient) QuerySets(ctx context.Context, keyword string, page, limit int) ([]any, error) {
	value, err := c.client.Do(ctx, http.MethodPost, c.client.BaseURL()+"/set/query", map[string]any{
		"keyword": keyword,
		"page":    page,
		"limit":   limit,
	})
	if err != nil {
		return nil, err
	}
	payload := jsval.Record(value)
	if payload == nil || jsval.NumberOrZero(payload["status_code"]) != 200 {
		return []any{}, nil
	}
	data := jsval.Record(payload["data"])
	if data == nil {
		return []any{}, nil
	}
	return jsval.Array(data["data"]), nil
}
