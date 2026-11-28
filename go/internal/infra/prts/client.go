// Package prts implements the shared HTTP transport for the public PRTS API.
// Callers keep their own retry policy and envelope parsing; this package owns
// request construction, the per-attempt timeout, status handling, and JSON
// decoding so the two service clients cannot drift apart again.
package prts

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mps233/la-pluma/go/internal/infra/httpclient"
	"github.com/mps233/la-pluma/go/internal/util/jsval"
)

// DefaultBaseURL is the public PRTS copilot service.
const DefaultBaseURL = "https://prts.maa.plus"

// maxResponseBytes bounds a decoded response.
const maxResponseBytes = 64 * 1024 * 1024

// HTTPClient is the narrow seam used by tests with httptest.Server. The
// production client uses net/http; tests never reach the real service.
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// Options configures the transport. Zero values fall back to the public
// endpoint, a 15 second per-attempt timeout, and a context-aware sleep.
type Options struct {
	BaseURL    string
	HTTPClient HTTPClient
	Timeout    time.Duration
	Sleep      func(context.Context, time.Duration) error
}

// Client executes PRTS HTTP requests. It is safe for concurrent use.
type Client struct {
	baseURL    string
	httpClient HTTPClient
	timeout    time.Duration
	sleep      func(context.Context, time.Duration) error
}

// New builds a client from options.
func New(options Options) *Client {
	baseURL := strings.TrimRight(strings.TrimSpace(options.BaseURL), "/")
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	client := options.HTTPClient
	if client == nil {
		client = httpclient.Default()
	}
	timeout := options.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	sleep := options.Sleep
	if sleep == nil {
		sleep = SleepContext
	}
	return &Client{baseURL: baseURL, httpClient: client, timeout: timeout, sleep: sleep}
}

// BaseURL is the normalized service root.
func (c *Client) BaseURL() string { return c.baseURL }

// StatusError reports a non-2xx response.
type StatusError struct {
	StatusCode int
}

func (e *StatusError) Error() string {
	return "HTTP " + strconv.Itoa(e.StatusCode)
}

// RetryPolicy configures DoWithRetry. Attempts includes the first try; Delay
// receives the zero-based index of the failed attempt.
type RetryPolicy struct {
	Attempts int
	Delay    func(attempt int) time.Duration
}

// Do performs one request and decodes the JSON response.
func (c *Client) Do(ctx context.Context, method, endpoint string, body any) (any, error) {
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
		return nil, &StatusError{StatusCode: response.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return nil, err
	}
	var payload any
	if err := jsval.DecodeJSON(data, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

// DoWithRetry retries the request according to policy.
func (c *Client) DoWithRetry(ctx context.Context, method, endpoint string, body any, policy RetryPolicy) (any, error) {
	return c.DoWithRetryFunc(ctx, func() (any, error) {
		return c.Do(ctx, method, endpoint, body)
	}, policy)
}

// DoWithRetryFunc retries an arbitrary attempt function, so callers can treat
// application-level status codes as retryable without another loop.
func (c *Client) DoWithRetryFunc(ctx context.Context, attempt func() (any, error), policy RetryPolicy) (any, error) {
	attempts := policy.Attempts
	if attempts <= 0 {
		attempts = 1
	}
	var lastErr error
	for index := 0; index < attempts; index++ {
		value, err := attempt()
		if err == nil {
			return value, nil
		}
		lastErr = err
		if index == attempts-1 {
			break
		}
		delay := time.Duration(0)
		if policy.Delay != nil {
			delay = policy.Delay(index)
		}
		if sleepErr := c.sleep(ctx, delay); sleepErr != nil {
			return nil, sleepErr
		}
	}
	return nil, lastErr
}

// SleepContext waits for duration or until the context is done.
func SleepContext(ctx context.Context, duration time.Duration) error {
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
