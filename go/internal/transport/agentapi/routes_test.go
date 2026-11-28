package agentapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func assertSuccess(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	if body["success"] != true {
		t.Fatalf("success = %v, body = %s", body["success"], rec.Body.String())
	}
}

func doJSONRequestBody(t *testing.T, handler http.Handler, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return doJSONRequest(t, handler, method, target, string(data))
}

// TestReadOnlyRoutesReturnSuccess covers the read-only Agent surface that does
// not start MAA, so a broken envelope or route registration is caught without
// touching a device.
func TestReadOnlyRoutesReturnSuccess(t *testing.T) {
	_, handler := newTestHandler(t)
	routes := []string{
		"/config/user",
		"/config/user/combat-tasks",
		"/config/maa/default",
		"/config-directory",
		"/notifications/config",
		"/logs/recent",
		"/logs/files",
		"/drops/today",
		"/drops/recent",
		"/drops/statistics",
		"/training/operators",
		"/training/operator-counts",
		"/training/queue",
		"/schedules/status",
		"/schedules/execution",
		"/stages/open-today",
		"/custom-tools",
		"/webrtc/status",
		"/skland/status",
		"/operator-mastery/status",
	}
	for _, route := range routes {
		t.Run(route, func(t *testing.T) {
			assertSuccess(t, doRequest(t, handler, http.MethodGet, route))
		})
	}
}

func TestMasteryCatalogWithoutDataIsUnavailable(t *testing.T) {
	_, handler := newTestHandler(t)
	rec := doRequest(t, handler, http.MethodGet, "/operator-mastery/catalog")
	if rec.Code != http.StatusServiceUnavailable || envelopeErrorCode(t, rec) != "AGENT_MASTERY_DATA_MISSING" {
		t.Fatalf("catalog = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestUserConfigRouteLifecycle(t *testing.T) {
	_, handler := newTestHandler(t)

	saved := doJSONRequest(t, handler, http.MethodPost, "/config/user/combat-tasks", `{"value":1}`)
	assertSuccess(t, saved)

	loaded := doRequest(t, handler, http.MethodGet, "/config/user/combat-tasks")
	assertSuccess(t, loaded)
	data := envelopeData(t, loaded)
	if data["value"] != float64(1) {
		t.Fatalf("loaded config = %#v", data)
	}

	listed := doRequest(t, handler, http.MethodGet, "/config/user")
	assertSuccess(t, listed)
	types, _ := envelopeData(t, listed)["types"].([]any)
	found := false
	for _, value := range types {
		if value == "combat-tasks" {
			found = true
		}
	}
	if !found {
		t.Fatalf("listed types = %#v", types)
	}

	deleted := doRequest(t, handler, http.MethodDelete, "/config/user/combat-tasks")
	assertSuccess(t, deleted)
}

func TestNotificationConfigRoundTrip(t *testing.T) {
	_, handler := newTestHandler(t)

	loaded := doRequest(t, handler, http.MethodGet, "/notifications/config")
	assertSuccess(t, loaded)
	config := envelopeData(t, loaded)

	saved := doJSONRequestBody(t, handler, http.MethodPost, "/notifications/config", config)
	assertSuccess(t, saved)

	reloaded := doRequest(t, handler, http.MethodGet, "/notifications/config")
	assertSuccess(t, reloaded)
	if reloadedData := envelopeData(t, reloaded); reloadedData["enabled"] != config["enabled"] {
		t.Fatalf("notification config = %#v, want %#v", reloadedData, config)
	}
}

func TestLogRoutesClear(t *testing.T) {
	application, handler := newTestHandler(t)
	application.Logs.AppendLine("stdout", "route-test-line")

	recent := doRequest(t, handler, http.MethodGet, "/logs/recent")
	assertSuccess(t, recent)
	var recentBody struct {
		Data []any `json:"data"`
	}
	if err := json.Unmarshal(recent.Body.Bytes(), &recentBody); err != nil {
		t.Fatal(err)
	}
	if len(recentBody.Data) == 0 {
		t.Fatalf("recent logs = %#v", recentBody.Data)
	}

	cleared := doRequest(t, handler, http.MethodPost, "/logs/recent/clear")
	assertSuccess(t, cleared)

	after := doRequest(t, handler, http.MethodGet, "/logs/recent")
	assertSuccess(t, after)
	var afterBody struct {
		Data []any `json:"data"`
	}
	if err := json.Unmarshal(after.Body.Bytes(), &afterBody); err != nil {
		t.Fatal(err)
	}
	if len(afterBody.Data) != 0 {
		t.Fatalf("logs after clear = %#v", afterBody.Data)
	}
}
