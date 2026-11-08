// Package gamedata ports the build-time game data generators from
// server/scripts: stage data, paradox operators, the materials/formula
// pipeline, operator elite materials and operator mastery.
//
// The generators fetch Kengxxiao/ArknightsGameData JSON tables. Network access
// is hidden behind HTTPClient so tests can use httptest fixtures and never
// reach the real service.
package gamedata

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const (
	// DefaultSourceURL is the zh_CN gamedata root used by the Node scripts.
	DefaultSourceURL = "https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata"
	// SourceAttribution is written into the generated metadata records.
	SourceAttribution = "Kengxxiao/ArknightsGameData"
	// StageThumbnailBaseURL is the stage preview host used by the client.
	StageThumbnailBaseURL = "https://web.hycdn.cn/arknights/game/assets/stage_pic"

	defaultTimeout = 60 * time.Second
)

// HTTPClient is the narrow seam used by tests with httptest.Server. The
// production client uses net/http.
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// ClientOptions configures a game data client. Zero values fall back to the
// public gamedata source, a 60 second timeout and time.Now.
type ClientOptions struct {
	HTTPClient HTTPClient
	BaseURL    string
	Timeout    time.Duration
	Now        func() time.Time
}

// Client fetches the game data tables used by the generators.
type Client struct {
	httpClient HTTPClient
	baseURL    string
	timeout    time.Duration
	now        func() time.Time
}

// NewClient builds a client with defaults for unset options.
func NewClient(options ClientOptions) *Client {
	baseURL := strings.TrimRight(strings.TrimSpace(options.BaseURL), "/")
	if baseURL == "" {
		baseURL = DefaultSourceURL
	}
	timeout := options.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: timeout}
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &Client{httpClient: client, baseURL: baseURL, timeout: timeout, now: now}
}

// BaseURL returns the resolved gamedata root, without a trailing slash.
func (c *Client) BaseURL() string { return c.baseURL }

// Now returns the injected clock (UTC conversion happens at the call site).
func (c *Client) Now() time.Time { return c.now() }

func (c *Client) excelURL(name string) string {
	return c.baseURL + "/excel/" + name
}

// FetchJSON reads and decodes one JSON document. Relative paths are resolved
// against the configured gamedata root; absolute http(s) URLs are used as is.
func (c *Client) FetchJSON(ctx context.Context, pathOrURL string) (any, error) {
	url := pathOrURL
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		url = c.baseURL + "/" + strings.TrimLeft(pathOrURL, "/")
	}

	requestCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil, apperrors.WithStatus(
			"GAMEDATA_REQUEST_INVALID",
			"游戏数据请求无效",
			http.StatusInternalServerError,
			false,
			map[string]any{"url": url, "cause": err.Error()},
		)
	}
	request.Header.Set("Accept", "application/json")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, apperrors.WithStatus(
			"GAMEDATA_FETCH_FAILED",
			"获取游戏数据失败",
			http.StatusBadGateway,
			true,
			map[string]any{"url": url, "cause": err.Error()},
		)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, response.Body)
		return nil, apperrors.WithStatus(
			"GAMEDATA_HTTP_ERROR",
			fmt.Sprintf("获取游戏数据失败: HTTP %d", response.StatusCode),
			http.StatusBadGateway,
			retryableStatus(response.StatusCode),
			map[string]any{"url": url, "status": response.StatusCode},
		)
	}

	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, apperrors.WithStatus(
			"GAMEDATA_INVALID_JSON",
			"游戏数据不是有效 JSON",
			http.StatusBadGateway,
			true,
			map[string]any{"url": url, "cause": err.Error()},
		)
	}
	return value, nil
}

func (c *Client) fetchExcelJSON(ctx context.Context, name string) (any, error) {
	return c.FetchJSON(ctx, c.excelURL(name))
}

func retryableStatus(status int) bool {
	return status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= 500
}

// fetchTables fetches the given excel table names in order. The Node scripts
// use Promise.all for some groups; sequential reads keep error reporting and
// test request ordering deterministic without changing the generated data.
func (c *Client) fetchTables(ctx context.Context, names ...string) (map[string]any, error) {
	tables := make(map[string]any, len(names))
	for _, name := range names {
		value, err := c.fetchExcelJSON(ctx, name)
		if err != nil {
			return nil, err
		}
		tables[name] = value
	}
	return tables, nil
}
