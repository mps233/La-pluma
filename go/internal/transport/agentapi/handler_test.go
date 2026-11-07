package agentapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/mps233/la-pluma/go/internal/app"
	runapp "github.com/mps233/la-pluma/go/internal/app/agentrun"
	"github.com/mps233/la-pluma/go/internal/config"
)

func newTestHandler(t *testing.T) (*app.App, http.Handler) {
	t.Helper()
	t.Setenv("MAA_CLI_PATH", filepath.Join(t.TempDir(), "missing-maa"))
	cfg := config.Config{Paths: config.Paths{DataDir: t.TempDir()}}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	application, err := app.New(cfg, logger)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = application.Close(t.Context()) })
	return application, New(application, logger)
}

func doRequest(t *testing.T, handler http.Handler, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func envelopeData(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	data, _ := body["data"].(map[string]any)
	return data
}

func TestStatusAndCurrentRun(t *testing.T) {
	application, handler := newTestHandler(t)

	status := doRequest(t, handler, http.MethodGet, "/status")
	if status.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", status.Code, status.Body.String())
	}
	data := envelopeData(t, status)
	api, _ := data["api"].(map[string]any)
	if api["version"] != apiVersion || api["name"] != "la-pluma-agent-api" {
		t.Fatalf("unexpected api: %#v", api)
	}

	current := doRequest(t, handler, http.MethodGet, "/runs/current")
	if current.Code != http.StatusOK {
		t.Fatalf("current status = %d", current.Code)
	}
	currentData := envelopeData(t, current)
	if currentData["run"] != nil {
		t.Fatalf("expected no current run: %#v", currentData)
	}

	run, _, err := application.Runs.Begin(appRunInput("run_task", "test-run"))
	if err != nil {
		t.Fatal(err)
	}
	got := doRequest(t, handler, http.MethodGet, "/runs/"+run.RunID)
	if got.Code != http.StatusOK {
		t.Fatalf("get run status = %d, body = %s", got.Code, got.Body.String())
	}
	runData := envelopeData(t, got)
	if runData["runId"] != run.RunID || runData["state"] != "accepted" {
		t.Fatalf("unexpected run: %#v", runData)
	}
}

func TestStopAcceptedRun(t *testing.T) {
	application, handler := newTestHandler(t)
	run, _, err := application.Runs.Begin(appRunInput("run_task", "stop-run"))
	if err != nil {
		t.Fatal(err)
	}
	stopped := doRequest(t, handler, http.MethodPost, "/runs/"+run.RunID+"/stop")
	if stopped.Code != http.StatusOK {
		t.Fatalf("stop status = %d, body = %s", stopped.Code, stopped.Body.String())
	}
	data := envelopeData(t, stopped)
	if data["stopped"] != true {
		t.Fatalf("unexpected stop response: %#v", data)
	}
	runData, _ := data["run"].(map[string]any)
	if runData["state"] != "stopped" {
		t.Fatalf("unexpected stopped run: %#v", runData)
	}
}

func TestManifestPlaceholder(t *testing.T) {
	_, handler := newTestHandler(t)
	rec := doRequest(t, handler, http.MethodGet, "/manifest")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("manifest status = %d", rec.Code)
	}
}
func appRunInput(operationID, idempotencyKey string) runapp.BeginInput {
	return runapp.BeginInput{
		OperationID:    operationID,
		IdempotencyKey: &idempotencyKey,
		Input:          map[string]any{"source": "test"},
	}
}
