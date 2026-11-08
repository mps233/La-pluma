package agentapi

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mps233/la-pluma/go/internal/app"
	runapp "github.com/mps233/la-pluma/go/internal/app/agentrun"
	appconfig "github.com/mps233/la-pluma/go/internal/app/config"
	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
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

func TestManifestAndOpenAPI(t *testing.T) {
	_, handler := newTestHandler(t)
	rec := doRequest(t, handler, http.MethodGet, "/manifest")
	if rec.Code != http.StatusOK {
		t.Fatalf("manifest status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	data, _ := body["data"].(map[string]any)
	actions, _ := data["actions"].([]any)
	if len(actions) != 40 {
		t.Fatalf("expected 40 advertised actions, got %d", len(actions))
	}
	openapi := doRequest(t, handler, http.MethodGet, "/openapi.json")
	if openapi.Code != http.StatusOK || !strings.Contains(openapi.Body.String(), `"openapi"`) {
		t.Fatalf("openapi status = %d", openapi.Code)
	}
}
func appRunInput(operationID, idempotencyKey string) runapp.BeginInput {
	return runapp.BeginInput{
		OperationID:    operationID,
		IdempotencyKey: &idempotencyKey,
		Input:          map[string]any{"source": "test"},
	}
}

func doJSONRequest(t *testing.T, handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func envelopeErrorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	errorBody, _ := body["error"].(map[string]any)
	code, _ := errorBody["code"].(string)
	return code
}

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func newActionApp(t *testing.T, paths config.Paths, script string) (*app.App, *Handler) {
	t.Helper()
	if err := os.MkdirAll(paths.MaaConfigDir, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAA_CLI_PATH", script)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	application, err := app.New(config.Config{Paths: paths}, logger)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = application.Close(t.Context()) })
	return application, New(application, logger)
}

func TestFightDryRunDoesNotInvokeMAA(t *testing.T) {
	root := t.TempDir()
	marker := filepath.Join(root, "maa-called")
	script := filepath.Join(root, "maa")
	writeTestFile(t, script, "#!/bin/sh\ntouch \""+marker+"\"\nexit 0\n")
	if err := os.Chmod(script, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := config.Paths{DataDir: filepath.Join(root, "data"), MaaConfigDir: filepath.Join(root, "maa-config")}
	_, handler := newActionApp(t, paths, script)

	rec := doJSONRequest(t, handler, http.MethodPost, "/actions/fight", `{"stages":[{"stage":"1-7","times":2},{"stage":"1-8"}],"dryRun":true}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	data := envelopeData(t, rec)
	plan, _ := data["plan"].(map[string]any)
	taskConfig, _ := plan["taskConfig"].(map[string]any)
	tasks, _ := taskConfig["tasks"].([]any)
	if len(tasks) != 2 {
		t.Fatalf("plan tasks = %#v", taskConfig)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("dry run started MAA")
	}
}

func TestFightStagesAreAcceptedAndWaited(t *testing.T) {
	root := t.TempDir()
	argsFile := filepath.Join(root, "maa-args.txt")
	script := filepath.Join(root, "maa")
	writeTestFile(t, script, "#!/bin/sh\necho \"$@\" > \""+argsFile+"\"\nif [ \"$1\" = run ]; then cat \"tasks/$3.json\" 2>/dev/null; fi\nexit 0\n")
	if err := os.Chmod(script, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := config.Paths{DataDir: filepath.Join(root, "data"), MaaConfigDir: filepath.Join(root, "maa-config")}
	_, handler := newActionApp(t, paths, script)

	rec := doJSONRequest(t, handler, http.MethodPost, "/actions/fight", `{"stages":[{"stage":"1-7","times":2},{"stage":"1-8"}],"waitForCompletion":false}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	data := envelopeData(t, rec)
	if data["state"] != "succeeded" {
		t.Fatalf("multi-stage fight should wait: %#v", data)
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "run --batch") {
		t.Fatalf("args = %q", string(args))
	}
	runRecord, _ := data["run"].(map[string]any)
	result, _ := runRecord["result"].(map[string]any)
	stdout, _ := result["stdout"].(string)
	if !strings.Contains(stdout, `"stage": "1-7"`) || !strings.Contains(stdout, `"times": 2`) {
		t.Fatalf("task config missing stages: %s", stdout)
	}
}

func testPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	source := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			source.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 128, A: 255})
		}
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, source); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestRunDailyFlowUsesSingleOuterRun(t *testing.T) {
	root := t.TempDir()
	argsFile := filepath.Join(root, "maa-args.txt")
	script := filepath.Join(root, "maa")
	writeTestFile(t, script, "#!/bin/sh\necho \"$@\" > \""+argsFile+"\"\nexit 0\n")
	if err := os.Chmod(script, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := config.Paths{DataDir: filepath.Join(root, "data"), MaaConfigDir: filepath.Join(root, "maa-config")}
	application, handler := newActionApp(t, paths, script)

	rec := doJSONRequest(t, handler, http.MethodPost, "/actions/run-daily-flow", `{"taskFlow":[{"id":"recruit","commandId":"recruit","name":"自动公招","enabled":true,"params":{}}]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	data := envelopeData(t, rec)
	if data["state"] != "succeeded" || data["runId"] == "" {
		t.Fatalf("tracked flow response = %#v", data)
	}
	runs := application.Runs.List()
	if len(runs) != 1 || runs[0].RunID != data["runId"] {
		t.Fatalf("runs = %#v", runs)
	}
	if len(runs[0].TaskResults) == 0 {
		t.Fatalf("task results = %#v", runs[0].TaskResults)
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "recruit") {
		t.Fatalf("maa args = %q", string(args))
	}
}

func TestExecuteTrackedOperationMarksStopped(t *testing.T) {
	root := t.TempDir()
	paths := config.Paths{DataDir: filepath.Join(root, "data"), MaaConfigDir: filepath.Join(root, "maa-config")}
	application, handler := newActionApp(t, paths, filepath.Join(root, "missing-maa"))

	run, replayed, err := handler.executeTrackedOperation(context.Background(), "test_stopped", map[string]any{"source": "test"}, nil, nil, func(ctx context.Context) (any, error) {
		runID := runapp.ParentRunID(ctx)
		if runID == "" {
			t.Fatal("parent run missing from context")
		}
		if _, err := application.Runs.MarkStopping(runID); err != nil {
			t.Fatal(err)
		}
		return nil, errTrackedActionStopped
	})
	if err != nil || replayed {
		t.Fatalf("err = %v replayed = %v", err, replayed)
	}
	if run.State != domainrun.StatusStopped {
		t.Fatalf("run state = %s", run.State)
	}
}

func TestClipboardRequiresActivePreview(t *testing.T) {
	root := t.TempDir()
	paths := config.Paths{DataDir: filepath.Join(root, "data"), MaaConfigDir: filepath.Join(root, "maa-config")}
	_, handler := newActionApp(t, paths, filepath.Join(root, "missing-maa"))

	get := doRequest(t, handler, http.MethodGet, "/clipboard")
	if get.Code != http.StatusConflict || envelopeErrorCode(t, get) != "WEBRTC_NOT_RUNNING" {
		t.Fatalf("get clipboard = %d, body = %s", get.Code, get.Body.String())
	}
	post := doJSONRequest(t, handler, http.MethodPost, "/clipboard", `{"text":"hello"}`)
	if post.Code != http.StatusConflict || envelopeErrorCode(t, post) != "WEBRTC_NOT_RUNNING" {
		t.Fatalf("set clipboard = %d, body = %s", post.Code, post.Body.String())
	}
}

func TestTaskStatusAndCurrentRunShape(t *testing.T) {
	root := t.TempDir()
	paths := config.Paths{DataDir: filepath.Join(root, "data"), MaaConfigDir: filepath.Join(root, "maa-config")}
	application, handler := newActionApp(t, paths, filepath.Join(root, "missing-maa"))
	application.Logs.AppendLine("stdout", "hello")

	status := doRequest(t, handler, http.MethodGet, "/tasks/status")
	if status.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", status.Code, status.Body.String())
	}
	statusData := envelopeData(t, status)
	if _, ok := statusData["startTime"]; !ok {
		t.Fatalf("task status missing startTime: %#v", statusData)
	}
	logs, _ := statusData["logs"].([]any)
	if len(logs) != 1 {
		t.Fatalf("task status logs = %#v", statusData["logs"])
	}

	current := doRequest(t, handler, http.MethodGet, "/runs/current?lines=1")
	if current.Code != http.StatusOK {
		t.Fatalf("current status = %d, body = %s", current.Code, current.Body.String())
	}
	currentData := envelopeData(t, current)
	if _, ok := currentData["schedule"].(map[string]any); !ok {
		t.Fatalf("current schedule = %#v", currentData["schedule"])
	}
	recent, _ := currentData["recentLogs"].([]any)
	if len(recent) != 1 {
		t.Fatalf("current recentLogs = %#v", currentData["recentLogs"])
	}
}

func TestLogFilesReturnsArrayWithNestedFiles(t *testing.T) {
	root := t.TempDir()
	paths := config.Paths{
		DataDir:      filepath.Join(root, "data"),
		MaaConfigDir: filepath.Join(root, "maa-config"),
		MaaStateDir:  filepath.Join(root, "state"),
	}
	writeTestFile(t, filepath.Join(paths.MaaStateDir, "debug", "nested", "asst.log"), "line\n")
	_, handler := newActionApp(t, paths, filepath.Join(root, "missing-maa"))

	rec := doRequest(t, handler, http.MethodGet, "/logs/files")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	files, ok := body["data"].([]any)
	if !ok || len(files) != 1 {
		t.Fatalf("log files = %#v", body["data"])
	}
	file, _ := files[0].(map[string]any)
	if file["name"] != "asst.log" || !strings.Contains(file["path"].(string), "nested") {
		t.Fatalf("log file = %#v", file)
	}
}

func TestDownscalePNGKeepsFrameUnder720(t *testing.T) {
	scaled := downscalePNG(testPNG(t, 1440, 720), 720)
	decoded, err := png.Decode(bytes.NewReader(scaled))
	if err != nil {
		t.Fatal(err)
	}
	bounds := decoded.Bounds()
	if bounds.Dx() != 720 || bounds.Dy() != 360 {
		t.Fatalf("scaled frame = %dx%d", bounds.Dx(), bounds.Dy())
	}
}

func TestCachedScreenFrameReusesFrame(t *testing.T) {
	handler := &Handler{}
	data := testPNG(t, 2, 2)
	calls := 0
	capture := func() ([]byte, error) {
		calls++
		return data, nil
	}
	if _, err := handler.cachedScreenFrame("default", capture); err != nil {
		t.Fatal(err)
	}
	if _, err := handler.cachedScreenFrame("default", capture); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("capture calls = %d", calls)
	}
}

func TestRunTaskCommandArgsPath(t *testing.T) {
	root := t.TempDir()
	argsFile := filepath.Join(root, "maa-args.txt")
	script := filepath.Join(root, "maa")
	writeTestFile(t, script, "#!/bin/sh\necho \"$@\" > \""+argsFile+"\"\nexit 0\n")
	if err := os.Chmod(script, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := config.Paths{DataDir: filepath.Join(root, "data"), MaaConfigDir: filepath.Join(root, "maa-config")}
	_, handler := newActionApp(t, paths, script)

	rec := doJSONRequest(t, handler, http.MethodPost, "/actions/run-task", `{"command":"fight","args":["CE-6","--times","1"],"taskName":"作战","taskType":"combat","waitForCompletion":true}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	data := envelopeData(t, rec)
	if data["state"] != "succeeded" {
		t.Fatalf("unexpected run: %#v", data)
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(args)) != "fight CE-6 --times 1" {
		t.Fatalf("args = %q", string(args))
	}

	unknown := doJSONRequest(t, handler, http.MethodPost, "/actions/run-task", `{"command":"rm","args":[]}`)
	if unknown.Code != http.StatusBadRequest || envelopeErrorCode(t, unknown) != "AGENT_VALIDATION_COMMAND_NOT_ALLOWED" {
		t.Fatalf("unknown command = %d, body = %s", unknown.Code, unknown.Body.String())
	}
}

func TestStartGameDisabledDoesNotLaunchGame(t *testing.T) {
	root := t.TempDir()
	argsFile := filepath.Join(root, "maa-args.txt")
	script := filepath.Join(root, "maa")
	writeTestFile(t, script, "#!/bin/sh\necho \"$@\" > \""+argsFile+"\"\nif [ \"$1\" = run ]; then cat \"tasks/$3.json\" 2>/dev/null; fi\nexit 0\n")
	if err := os.Chmod(script, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := config.Paths{DataDir: filepath.Join(root, "data"), MaaConfigDir: filepath.Join(root, "maa-config")}
	_, handler := newActionApp(t, paths, script)

	rec := doJSONRequest(t, handler, http.MethodPost, "/actions/start-game", `{"startGameEnabled":false,"clientType":"Bilibili","address":"10.0.0.2:5555","accountName":"alt","waitForCompletion":true}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(strings.TrimSpace(string(args)), "run --batch ") || !strings.Contains(string(args), "--addr 10.0.0.2:5555") {
		t.Fatalf("args = %q", string(args))
	}
	data := envelopeData(t, rec)
	runRecord, _ := data["run"].(map[string]any)
	result, _ := runRecord["result"].(map[string]any)
	stdout, _ := result["stdout"].(string)
	for _, want := range []string{`"start_game_enabled": false`, `"account_name": "alt"`, `"client_type": "Bilibili"`} {
		if !strings.Contains(stdout, want) {
			t.Fatalf("task config missing %s: %s", want, stdout)
		}
	}
}

func TestStopActionResponseShape(t *testing.T) {
	root := t.TempDir()
	paths := config.Paths{DataDir: filepath.Join(root, "data"), MaaConfigDir: filepath.Join(root, "maa-config")}
	application, handler := newActionApp(t, paths, filepath.Join(root, "missing-maa"))

	rec := doJSONRequest(t, handler, http.MethodPost, "/actions/stop", `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	data := envelopeData(t, rec)
	task, _ := data["task"].(map[string]any)
	if task["success"] != false || data["scheduleStopped"] != false || data["stopRequested"] != false {
		t.Fatalf("stop response = %#v", data)
	}

	missing := doJSONRequest(t, handler, http.MethodPost, "/actions/stop", `{"runId":"does-not-exist"}`)
	if missing.Code != http.StatusNotFound || envelopeErrorCode(t, missing) != "AGENT_RUN_NOT_FOUND" {
		t.Fatalf("missing run stop = %d, body = %s", missing.Code, missing.Body.String())
	}

	accepted, _, err := application.Runs.Begin(appRunInput("run_task", "stop-accepted"))
	if err != nil {
		t.Fatal(err)
	}
	notStarted := doJSONRequest(t, handler, http.MethodPost, "/actions/stop", `{"runId":"`+accepted.RunID+`"}`)
	if notStarted.Code != http.StatusConflict || envelopeErrorCode(t, notStarted) != "AGENT_RUN_NOT_STARTED" {
		t.Fatalf("accepted run stop = %d, body = %s", notStarted.Code, notStarted.Body.String())
	}
}

func TestRecognitionParsesExistingLogWithoutMAA(t *testing.T) {
	root := t.TempDir()
	marker := filepath.Join(root, "maa-called")
	script := filepath.Join(root, "maa")
	writeTestFile(t, script, "#!/bin/sh\ntouch \""+marker+"\"\nexit 0\n")
	if err := os.Chmod(script, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := config.Paths{
		DataDir:      filepath.Join(root, "data"),
		MaaConfigDir: filepath.Join(root, "maa-config"),
		MaaDataDir:   filepath.Join(root, "maa-data"),
		MaaStateDir:  filepath.Join(root, "maa-state"),
	}
	writeTestFile(t, filepath.Join(paths.MaaDataDir, "resource", "item_index.json"), `{
		"2001": {"name":"龙门币","icon":"2001.png","classifyType":"MATERIAL","sortId":12},
		"30011": {"name":"固源岩","icon":"30011.png","classifyType":"MATERIAL","sortId":2}
	}`)
	writeTestFile(t, filepath.Join(paths.MaaDataDir, "resource", "gamedata", "excel", "item_table.json"), `{
		"items": {"2001": {"iconId":"2001","name":"龙门币"},"30011": {"iconId":"30011"}}
	}`)
	logLine := `[2026-10-31 12:00:00.000][INF][Px1][Tx1] Assistant::append_callback | SubTaskExtraInfo {"what":"DepotInfo","class":"asst::DepotRecognitionTask","details":{"done":true,"data":"{\"2001\":12000,\"30011\":5}"}}`
	writeTestFile(t, filepath.Join(paths.MaaStateDir, "debug", "asst.log"), logLine+"\n")
	_, handler := newActionApp(t, paths, script)

	rec := doJSONRequest(t, handler, http.MethodPost, "/actions/depot-recognition", `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("recognition started MAA")
	}
	data := envelopeData(t, rec)
	if data["itemCount"] != float64(2) || data["complete"] != true {
		t.Fatalf("recognition data is not merged: %#v", data)
	}
	if data["runId"] == "" || data["state"] != "succeeded" {
		t.Fatalf("recognition run missing: %#v", data)
	}
}

func TestTestConnectionUsesSavedProfile(t *testing.T) {
	root := t.TempDir()
	argsFile := filepath.Join(root, "adb-args.txt")
	adbPath := filepath.Join(root, "adb")
	writeTestFile(t, adbPath, "#!/bin/sh\necho \"$@\" >> \""+argsFile+"\"\nif [ \"$1\" = devices ]; then echo \"List of devices attached\"; printf '10.0.0.2:5555\\tdevice\\n'; fi\nexit 0\n")
	if err := os.Chmod(adbPath, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := config.Paths{DataDir: filepath.Join(root, "data"), MaaConfigDir: filepath.Join(root, "maa-config")}
	application, handler := newActionApp(t, paths, filepath.Join(root, "missing-maa"))
	if err := application.Profiles.Save(appconfig.DefaultProfileName, map[string]any{
		"connection": map[string]any{"adb_path": adbPath, "address": "10.0.0.2:5555"},
	}); err != nil {
		t.Fatal(err)
	}

	rec := doJSONRequest(t, handler, http.MethodPost, "/actions/test-connection", `{"profileId":"default"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	data := envelopeData(t, rec)
	if data["adbPath"] != adbPath || data["address"] != "10.0.0.2:5555" || data["connected"] != true {
		t.Fatalf("connection response = %#v", data)
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "devices -l") {
		t.Fatalf("adb args = %q", string(args))
	}
}

func TestStartGameAction(t *testing.T) {
	root := t.TempDir()
	script := filepath.Join(root, "maa")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho startup\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAA_CLI_PATH", script)
	if err := os.MkdirAll(filepath.Join(root, "maa-config"), 0o700); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Paths: config.Paths{DataDir: filepath.Join(root, "data"), MaaConfigDir: filepath.Join(root, "maa-config")}}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	application, err := app.New(cfg, logger)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = application.Close(t.Context()) })
	handler := New(application, logger)

	req := httptest.NewRequest(http.MethodPost, "/actions/start-game", strings.NewReader(`{"waitForCompletion":true}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	data := envelopeData(t, rec)
	if data["state"] != "succeeded" {
		t.Fatalf("unexpected data: %#v", data)
	}
	if rec.Header().Get("X-La-Pluma-Run-Id") == "" {
		t.Fatal("missing run header")
	}
}
