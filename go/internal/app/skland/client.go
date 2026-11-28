package skland

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/mps233/la-pluma/go/internal/infra/httpclient"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const (
	defaultBaseURL  = "https://zonai.skland.com"
	sklandUserAgent = "Skland/1.53.0 (com.hypergryph.skland; build:105300018; Android 31; ) Okhttp/4.11.0"
)

// Client is a signed Skland API client. It only performs GET requests; the
// credential exchange happens in the UI / upstream login flow.
type Client struct {
	HTTP    *http.Client
	BaseURL string
	Cred    string
	Token   string
}

// NewClient returns a signed client for one credential pair.
func NewClient(baseURL, cred, token string, httpClient *http.Client) *Client {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = defaultBaseURL
	}
	if httpClient == nil {
		httpClient = httpclient.New(20 * time.Second)
	}
	return &Client{HTTP: httpClient, BaseURL: strings.TrimRight(baseURL, "/"), Cred: cred, Token: token}
}

type envelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func (c *Client) get(ctx context.Context, path string, query url.Values, out any) error {
	encoded := query.Encode()
	timestamp := time.Now().Unix() - 2
	signature := signRequest(c.Token, path, encoded, timestamp)
	target := c.BaseURL + path
	if encoded != "" {
		target += "?" + encoded
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	req.Header.Set("cred", c.Cred)
	req.Header.Set("sign", signature)
	req.Header.Set("platform", "")
	req.Header.Set("timestamp", strconv.FormatInt(timestamp, 10))
	req.Header.Set("dId", "")
	req.Header.Set("vName", "")
	req.Header.Set("User-Agent", sklandUserAgent)
	req.Header.Set("Connection", "close")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return apperrors.WithStatus("AGENT_SKLAND_REQUEST_FAILED", "森空岛请求失败："+err.Error(), http.StatusBadGateway, true, nil)
	}
	defer resp.Body.Close()

	var body envelope
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return apperrors.WithStatus("AGENT_SKLAND_RESPONSE_INVALID", "森空岛返回内容无法解析", http.StatusBadGateway, true, nil)
	}
	if resp.StatusCode == http.StatusUnauthorized || body.Code == 10000 || body.Code == 10002 {
		return apperrors.WithStatus("AGENT_SKLAND_AUTH_INVALID", "森空岛凭证已失效，请重新获取 cred/token", http.StatusUnauthorized, false, map[string]any{"code": body.Code})
	}
	if body.Code != 0 {
		message := strings.TrimSpace(body.Message)
		if message == "" {
			message = "森空岛请求被拒绝"
		}
		return apperrors.WithStatus("AGENT_SKLAND_REQUEST_REJECTED", message, http.StatusBadGateway, false, map[string]any{"code": body.Code})
	}
	if out != nil {
		if err := json.Unmarshal(body.Data, out); err != nil {
			return apperrors.WithStatus("AGENT_SKLAND_RESPONSE_INVALID", "森空岛返回数据结构不符合预期", http.StatusBadGateway, true, nil)
		}
	}
	return nil
}

// BindingAccount is one Arknights binding under the Skland account.
type BindingAccount struct {
	UID         string `json:"uid"`
	ChannelName string `json:"channelName"`
	Nickname    string `json:"nickname"`
	IsOfficial  bool   `json:"isOfficial"`
}

type bindingResponse struct {
	List []struct {
		AppCode     string `json:"appCode"`
		DefaultUID  string `json:"defaultUid"`
		BindingList []struct {
			UID         string `json:"uid"`
			ChannelName string `json:"channelName"`
			Nickname    string `json:"nickname"`
			IsOfficial  bool   `json:"isOfficial"`
		} `json:"bindingList"`
	} `json:"list"`
}

// Binding returns the Arknights bindings for the credential.
func (c *Client) Binding(ctx context.Context) ([]BindingAccount, error) {
	var payload bindingResponse
	if err := c.get(ctx, "/api/v1/game/player/binding", nil, &payload); err != nil {
		return nil, err
	}
	accounts := make([]BindingAccount, 0)
	for _, app := range payload.List {
		if app.AppCode != "arknights" {
			continue
		}
		for _, binding := range app.BindingList {
			accounts = append(accounts, BindingAccount{
				UID:         binding.UID,
				ChannelName: binding.ChannelName,
				Nickname:    binding.Nickname,
				IsOfficial:  binding.IsOfficial,
			})
		}
	}
	if len(accounts) == 0 {
		return nil, apperrors.WithStatus("AGENT_SKLAND_BINDING_MISSING", "该森空岛账号没有绑定明日方舟角色", http.StatusUnprocessableEntity, false, nil)
	}
	return accounts, nil
}

// Cultivate returns the raw cultivate/player payload.
func (c *Client) Cultivate(ctx context.Context, uid string) (json.RawMessage, error) {
	query := url.Values{}
	query.Set("uid", uid)
	var payload json.RawMessage
	if err := c.get(ctx, "/api/v1/game/cultivate/player", query, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

// PlayerInfo returns the raw player/info payload.
func (c *Client) PlayerInfo(ctx context.Context, uid string) (json.RawMessage, error) {
	query := url.Values{}
	query.Set("uid", uid)
	var payload json.RawMessage
	if err := c.get(ctx, "/api/v1/game/player/info", query, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}
