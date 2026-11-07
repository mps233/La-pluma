package quotes

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/mps233/la-pluma/go/internal/config"
)

func newTestRouter(t *testing.T) (http.Handler, *Service) {
	t.Helper()
	service := NewWithOptions(Options{
		Paths:  config.Paths{DataDir: t.TempDir()},
		Random: func(n int) int { return 0 },
	})
	return http.StripPrefix("/api/operator-quotes", NewHandler(service)), service
}

func performRequest(t *testing.T, router http.Handler, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	} else {
		reader = bytes.NewReader(nil)
	}
	request := httptest.NewRequest(method, target, reader)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func decodeQuoteList(t *testing.T, recorder *httptest.ResponseRecorder) []OperatorQuote {
	t.Helper()
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if contentType := recorder.Header().Get("Content-Type"); contentType != "application/json; charset=utf-8" {
		t.Fatalf("content type = %q", contentType)
	}
	var quotes []OperatorQuote
	if err := json.Unmarshal(recorder.Body.Bytes(), &quotes); err != nil {
		t.Fatalf("decode: %v (%s)", err, recorder.Body.String())
	}
	return quotes
}

func TestHandlerReads(t *testing.T) {
	router, _ := newTestRouter(t)

	all := decodeQuoteList(t, performRequest(t, router, http.MethodGet, "/api/operator-quotes/all", nil))
	if len(all) != len(DefaultQuotes) {
		t.Fatalf("all len = %d", len(all))
	}

	dailyRecorder := performRequest(t, router, http.MethodGet, "/api/operator-quotes/daily", nil)
	if dailyRecorder.Code != http.StatusOK {
		t.Fatalf("daily status = %d", dailyRecorder.Code)
	}
	var daily OperatorQuote
	if err := json.Unmarshal(dailyRecorder.Body.Bytes(), &daily); err != nil {
		t.Fatal(err)
	}
	if daily.Operator == "" || daily.Quote == "" {
		t.Fatalf("daily = %#v", daily)
	}

	randomRecorder := performRequest(t, router, http.MethodGet, "/api/operator-quotes/random", nil)
	var random OperatorQuote
	if err := json.Unmarshal(randomRecorder.Body.Bytes(), &random); err != nil || random.Operator == "" {
		t.Fatalf("random = %#v err=%v", random, err)
	}

	name := url.PathEscape("银灰")
	operatorRecorder := performRequest(t, router, http.MethodGet, "/api/operator-quotes/operator/"+name, nil)
	if operatorRecorder.Code != http.StatusOK {
		t.Fatalf("operator status = %d", operatorRecorder.Code)
	}
	var quote OperatorQuote
	if err := json.Unmarshal(operatorRecorder.Body.Bytes(), &quote); err != nil {
		t.Fatal(err)
	}
	if quote.Operator != "银灰" || quote.OperatorID != "char_172_svrash" {
		t.Fatalf("operator quote = %#v", quote)
	}

	missing := performRequest(t, router, http.MethodGet, "/api/operator-quotes/operator/不存在", nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing status = %d", missing.Code)
	}
	var failure map[string]string
	if err := json.Unmarshal(missing.Body.Bytes(), &failure); err != nil || failure["error"] != "未找到该干员的台词" {
		t.Fatalf("missing body = %s", missing.Body.String())
	}

	notFound := performRequest(t, router, http.MethodGet, "/api/operator-quotes/nope", nil)
	if notFound.Code != http.StatusNotFound {
		t.Fatalf("unknown route status = %d", notFound.Code)
	}
}

func TestHandlerCRUD(t *testing.T) {
	router, _ := newTestRouter(t)

	created := decodeQuoteList(t, performRequest(t, router, http.MethodPost, "/api/operator-quotes", map[string]any{
		"operator": "自定义干员",
		"quote":    "第一条",
	}))
	if len(created) != len(DefaultQuotes)+1 {
		t.Fatalf("created len = %d", len(created))
	}
	last := created[len(created)-1]
	if last.OperatorID != "" || last.Operator != "自定义干员" || last.Quote != "第一条" {
		t.Fatalf("created quote = %#v", last)
	}

	name := url.PathEscape("自定义干员")
	updatedRecorder := performRequest(t, router, http.MethodPut, "/api/operator-quotes/operator/"+name, map[string]any{
		"quote": "第二条",
	})
	if updatedRecorder.Code != http.StatusOK {
		t.Fatalf("update status = %d body=%s", updatedRecorder.Code, updatedRecorder.Body.String())
	}
	var updated OperatorQuote
	if err := json.Unmarshal(updatedRecorder.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Quote != "第二条" {
		t.Fatalf("updated = %#v", updated)
	}

	deleted := decodeQuoteList(t, performRequest(t, router, http.MethodDelete, "/api/operator-quotes/operator/"+name, nil))
	if len(deleted) != len(DefaultQuotes) {
		t.Fatalf("deleted len = %d", len(deleted))
	}

	missingUpdate := performRequest(t, router, http.MethodPut, "/api/operator-quotes/operator/不存在", map[string]any{
		"quote": "x",
	})
	if missingUpdate.Code != http.StatusNotFound {
		t.Fatalf("missing update status = %d", missingUpdate.Code)
	}
}

func TestHandlerValidation(t *testing.T) {
	router, _ := newTestRouter(t)

	cases := []struct {
		method string
		target string
		body   any
		status int
	}{
		{http.MethodPost, "/api/operator-quotes", map[string]any{"operator": "", "quote": "x"}, http.StatusBadRequest},
		{http.MethodPost, "/api/operator-quotes", map[string]any{"operator": "干员"}, http.StatusBadRequest},
		{http.MethodPost, "/api/operator-quotes", map[string]any{"operator": 1, "quote": "x"}, http.StatusBadRequest},
		{http.MethodPut, "/api/operator-quotes/operator/" + url.PathEscape("银灰"), map[string]any{"quote": ""}, http.StatusBadRequest},
		{http.MethodPut, "/api/operator-quotes/operator/" + url.PathEscape("银灰"), map[string]any{"quote": 2}, http.StatusBadRequest},
	}
	for _, testCase := range cases {
		recorder := performRequest(t, router, testCase.method, testCase.target, testCase.body)
		if recorder.Code != testCase.status {
			t.Fatalf("%s %s status = %d, want %d (%s)", testCase.method, testCase.target, recorder.Code, testCase.status, recorder.Body.String())
		}
		var payload map[string]string
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil || payload["error"] == "" {
			t.Fatalf("error body = %s", recorder.Body.String())
		}
	}

	malformed := performRequest(t, router, http.MethodPost, "/api/operator-quotes", "not-json")
	if malformed.Code != http.StatusBadRequest {
		t.Fatalf("malformed status = %d", malformed.Code)
	}
}
