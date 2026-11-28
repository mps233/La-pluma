package prts

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) (*Client, *httptest.Server) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return New(Options{BaseURL: server.URL, HTTPClient: server.Client()}), server
}

func TestDoDecodesJSONWithNumbers(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"id":9007199254740993}`)
	})
	value, err := client.Do(context.Background(), http.MethodGet, client.BaseURL()+"/test", nil)
	if err != nil {
		t.Fatal(err)
	}
	record := value.(map[string]any)
	if record["id"] != json.Number("9007199254740993") {
		t.Fatalf("id = %#v", record["id"])
	}
}

func TestDoReturnsStatusError(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	_, err := client.Do(context.Background(), http.MethodGet, client.BaseURL()+"/test", nil)
	var statusErr *StatusError
	if !errors.As(err, &statusErr) || statusErr.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("err = %v", err)
	}
}

func TestDoWithRetryUsesThePolicyDelays(t *testing.T) {
	attempts := 0
	var delays []time.Duration
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts < 3 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	t.Cleanup(server.Close)
	client := New(Options{
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
		Sleep: func(ctx context.Context, duration time.Duration) error {
			delays = append(delays, duration)
			return nil
		},
	})
	value, err := client.DoWithRetry(context.Background(), http.MethodGet, client.BaseURL()+"/test", nil, RetryPolicy{
		Attempts: 3,
		Delay:    func(attempt int) time.Duration { return time.Duration(250*(attempt+1)) * time.Millisecond },
	})
	if err != nil {
		t.Fatal(err)
	}
	if value.(map[string]any)["ok"] != true || attempts != 3 {
		t.Fatalf("value = %#v attempts = %d", value, attempts)
	}
	if len(delays) != 2 || delays[0] != 250*time.Millisecond || delays[1] != 500*time.Millisecond {
		t.Fatalf("delays = %v", delays)
	}
}

func TestDoWithRetryStopsWhenSleepFails(t *testing.T) {
	attempts := 0
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		attempts++
		w.WriteHeader(http.StatusBadGateway)
	})
	client.sleep = func(ctx context.Context, duration time.Duration) error {
		return context.Canceled
	}
	_, err := client.DoWithRetry(context.Background(), http.MethodGet, client.BaseURL()+"/test", nil, RetryPolicy{Attempts: 3})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d", attempts)
	}
}

func TestDoWithRetryFuncAllowsApplicationChecks(t *testing.T) {
	attempts := 0
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if attempts < 3 {
			_, _ = io.WriteString(w, `{"status_code":500}`)
			return
		}
		_, _ = io.WriteString(w, `{"status_code":200,"data":"ok"}`)
	})
	value, err := client.DoWithRetryFunc(context.Background(), func() (any, error) {
		attempts++
		payload, err := client.Do(context.Background(), http.MethodGet, client.BaseURL()+"/test", nil)
		if err != nil {
			return nil, err
		}
		record := payload.(map[string]any)
		if record["status_code"] != json.Number("200") {
			return nil, errors.New("application status")
		}
		return payload, nil
	}, RetryPolicy{Attempts: 3})
	if err != nil || value == nil || attempts != 3 {
		t.Fatalf("value = %#v err = %v attempts = %d", value, err, attempts)
	}
}

func TestDoPostsJSONBody(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("method = %s content-type = %q", r.Method, r.Header.Get("Content-Type"))
		}
		body, _ := io.ReadAll(r.Body)
		if strings.TrimSpace(string(body)) != `{"keyword":"x"}` {
			t.Errorf("body = %s", body)
		}
		_, _ = io.WriteString(w, `{"ok":true}`)
	})
	if _, err := client.Do(context.Background(), http.MethodPost, client.BaseURL()+"/test", map[string]any{"keyword": "x"}); err != nil {
		t.Fatal(err)
	}
}
