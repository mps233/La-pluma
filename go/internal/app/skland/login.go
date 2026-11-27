package skland

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/timefmt"
)

const (
	hypergryphBaseURL = "https://as.hypergryph.com"
	sklandAppCode     = "4ca99fa6b56cc2ba"
)

type hypergryphEnvelope struct {
	Status  int             `json:"status"`
	Message string          `json:"msg"`
	Data    json.RawMessage `json:"data"`
}

// Login exchanges a phone/password pair for a Skland cred/token pair. It uses
// a SenseBot device id exactly like Mower; no password is persisted.
func (c *Client) Login(ctx context.Context, account, password string) (Credentials, error) {
	deviceID, err := sensebotDeviceID(ctx, c.HTTP)
	if err != nil {
		return Credentials{}, apperrors.WithStatus("AGENT_SKLAND_DEVICE_ID_FAILED", "获取森空岛设备标识失败："+err.Error(), http.StatusBadGateway, true, nil)
	}
	token, err := c.passwordToken(ctx, account, password, deviceID)
	if err != nil {
		return Credentials{}, err
	}
	grant, err := c.grantCode(ctx, token, deviceID)
	if err != nil {
		return Credentials{}, err
	}
	credentials, err := c.credByCode(ctx, grant, deviceID)
	if err != nil {
		return Credentials{}, err
	}
	if credentials.Cred == "" || credentials.Token == "" {
		return Credentials{}, apperrors.WithStatus("AGENT_SKLAND_LOGIN_FAILED", "森空岛登录未返回有效凭证", http.StatusBadGateway, true, nil)
	}
	return credentials, nil
}

func (c *Client) passwordToken(ctx context.Context, account, password, deviceID string) (string, error) {
	body := map[string]any{"phone": strings.TrimSpace(account), "password": password}
	var payload struct {
		Token string `json:"token"`
	}
	if err := c.postHypergryph(ctx, hypergryphBaseURL+"/user/auth/v1/token_by_phone_password", body, deviceID, &payload); err != nil {
		return "", err
	}
	if payload.Token == "" {
		return "", apperrors.WithStatus("AGENT_SKLAND_LOGIN_FAILED", "森空岛登录未返回 token，请检查账号密码或人机验证", http.StatusUnauthorized, false, nil)
	}
	return payload.Token, nil
}

func (c *Client) grantCode(ctx context.Context, token, deviceID string) (string, error) {
	body := map[string]any{"appCode": sklandAppCode, "token": token, "type": 0}
	var payload struct {
		Code string `json:"code"`
	}
	if err := c.postHypergryph(ctx, hypergryphBaseURL+"/user/oauth2/v2/grant", body, deviceID, &payload); err != nil {
		return "", err
	}
	if payload.Code == "" {
		return "", apperrors.WithStatus("AGENT_SKLAND_LOGIN_FAILED", "森空岛授权未返回 code", http.StatusBadGateway, true, nil)
	}
	return payload.Code, nil
}

func (c *Client) credByCode(ctx context.Context, code, deviceID string) (Credentials, error) {
	body := map[string]any{"code": code, "kind": 1}
	raw, err := json.Marshal(body)
	if err != nil {
		return Credentials{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/web/v1/user/auth/generate_cred_by_code", bytes.NewReader(raw))
	if err != nil {
		return Credentials{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", sklandUserAgent)
	req.Header.Set("dId", deviceID)
	response, err := c.HTTP.Do(req)
	if err != nil {
		return Credentials{}, apperrors.WithStatus("AGENT_SKLAND_LOGIN_FAILED", "森空岛凭证交换失败："+err.Error(), http.StatusBadGateway, true, nil)
	}
	defer response.Body.Close()
	var result struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Cred  string `json:"cred"`
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return Credentials{}, apperrors.WithStatus("AGENT_SKLAND_LOGIN_FAILED", "森空岛凭证返回无法解析", http.StatusBadGateway, true, nil)
	}
	if result.Code != 0 {
		message := strings.TrimSpace(result.Message)
		if message == "" {
			message = "森空岛拒绝登录"
		}
		return Credentials{}, apperrors.WithStatus("AGENT_SKLAND_LOGIN_FAILED", message, http.StatusUnauthorized, false, map[string]any{"code": result.Code})
	}
	return Credentials{
		Cred:      result.Data.Cred,
		Token:     result.Data.Token,
		UpdatedAt: timefmt.FormatMillis(time.Now()),
	}, nil
}

func (c *Client) postHypergryph(ctx context.Context, url string, body any, deviceID string, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", sklandUserAgent)
	req.Header.Set("dId", deviceID)
	response, err := c.HTTP.Do(req)
	if err != nil {
		return apperrors.WithStatus("AGENT_SKLAND_LOGIN_FAILED", "森空岛登录请求失败："+err.Error(), http.StatusBadGateway, true, nil)
	}
	defer response.Body.Close()
	var envelope hypergryphEnvelope
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return apperrors.WithStatus("AGENT_SKLAND_LOGIN_FAILED", "森空岛登录返回无法解析", http.StatusBadGateway, true, nil)
	}
	if envelope.Status != 0 {
		message := strings.TrimSpace(envelope.Message)
		if message == "" {
			message = "森空岛登录被拒绝"
		}
		return apperrors.WithStatus("AGENT_SKLAND_LOGIN_FAILED", message, http.StatusUnauthorized, false, map[string]any{"status": envelope.Status})
	}
	if out != nil {
		if err := json.Unmarshal(envelope.Data, out); err != nil {
			return fmt.Errorf("decode login payload: %w", err)
		}
	}
	return nil
}
