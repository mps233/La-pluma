package agentapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/app"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
)

func postScheduleExecute(t *testing.T, handler http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/schedules/test/execute", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func waitForTerminalRun(t *testing.T, application *app.App, runID string) domainrun.DTO {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		run, ok := application.Runs.Get(runID)
		if ok && run.State.Terminal() {
			return run
		}
		if time.Now().After(deadline) {
			t.Fatalf("run %s did not reach a terminal state: %#v", runID, run)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestExecuteScheduleBackgroundReturnsAccepted(t *testing.T) {
	application, handler := newTestHandler(t)

	rec := postScheduleExecute(t, handler, `{"taskFlow":[],"waitForCompletion":false}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	data := envelopeData(t, rec)
	runID, _ := data["runId"].(string)
	if runID == "" {
		t.Fatalf("missing runId: %#v", data)
	}

	run := waitForTerminalRun(t, application, runID)
	if run.State != domainrun.StatusSucceeded {
		t.Fatalf("background run = %#v", run)
	}
}

func TestExecuteScheduleWaitsForCompletionByDefault(t *testing.T) {
	_, handler := newTestHandler(t)

	rec := postScheduleExecute(t, handler, `{"taskFlow":[]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	data := envelopeData(t, rec)
	if data["state"] != string(domainrun.StatusSucceeded) {
		t.Fatalf("run state = %#v, want %s", data["state"], domainrun.StatusSucceeded)
	}
}
