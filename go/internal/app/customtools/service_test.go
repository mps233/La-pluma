package customtools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

type fakeExecutor struct {
	calls      int
	taskConfig map[string]any
	wait       bool
	result     domainrun.DTO
	err        error
}

func (f *fakeExecutor) RunTask(_ context.Context, taskConfig map[string]any, wait bool) (domainrun.DTO, error) {
	f.calls++
	f.taskConfig = taskConfig
	f.wait = wait
	return f.result, f.err
}

func newTestService(t *testing.T, executor Executor) (*Service, string) {
	t.Helper()
	dataDir := t.TempDir()
	return New(config.Paths{DataDir: dataDir}, executor), dataDir
}

func writeToolFile(t *testing.T, dataDir, name, content string) {
	t.Helper()
	dir := filepath.Join(dataDir, customToolsDir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func errorDetails(t *testing.T, err error) *apperrors.Error {
	t.Helper()
	appError, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("expected structured error, got %v", err)
	}
	return appError
}

func decodeJSON(t *testing.T, value any) any {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return decoded
}

func TestListToolsReturnsBuiltinDefinitions(t *testing.T) {
	service, _ := newTestService(t, nil)

	tools, err := service.ListTools()
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(tools) != 5 {
		t.Fatalf("expected 5 tools, got %d", len(tools))
	}
	if tools[0].ID != "pixel-paint" || tools[0].Name != "像素画填色" {
		t.Fatalf("unexpected first tool: %+v", tools[0])
	}
	if !tools[0].RequiresParams || tools[0].ParamsKey == nil || *tools[0].ParamsKey != "pixel_paint" {
		t.Fatalf("pixel-paint params metadata wrong: %+v", tools[0])
	}
	if tools[2].ID != "material-synthesis" || tools[2].RequiresParams || tools[2].ParamsKey != nil {
		t.Fatalf("material-synthesis params metadata wrong: %+v", tools[2])
	}

	// The client relies on paramsKey being present and null, not omitted.
	decoded, ok := decodeJSON(t, tools).([]any)
	if !ok || len(decoded) != 5 {
		t.Fatalf("unexpected tool list JSON: %#v", decoded)
	}
	entry, ok := decoded[2].(map[string]any)
	if !ok {
		t.Fatalf("unexpected tool entry: %#v", decoded[2])
	}
	if value, present := entry["paramsKey"]; !present || value != nil {
		t.Fatalf("expected paramsKey:null, got %#v (present=%v)", value, present)
	}
	if _, present := entry["requiresParams"]; !present {
		t.Fatalf("requiresParams missing from tool JSON: %#v", entry)
	}
}

func TestListToolsMergesDirectoryDefinitions(t *testing.T) {
	service, dataDir := newTestService(t, nil)
	writeToolFile(t, dataDir, "a-extra.json", `{
		"id": "extra-tool",
		"name": "Extra Tool",
		"description": "Extra description",
		"taskNames": ["MiniGame@Extra@Begin"],
		"paramsKey": "extra"
	}`)
	writeToolFile(t, dataDir, "pixel-paint.json", `{
		"id": "pixel-paint",
		"name": "Pixel Override",
		"description": "Overridden",
		"taskNames": ["MiniGame@PixelPaint@Custom"]
	}`)
	writeToolFile(t, dataDir, "notes.txt", `ignored`)
	writeToolFile(t, dataDir, ".hidden.json", `not json`)

	tools, err := service.ListTools()
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(tools) != 6 {
		t.Fatalf("expected 6 tools, got %d: %+v", len(tools), tools)
	}
	if tools[0].ID != "pixel-paint" || tools[0].Name != "Pixel Override" || tools[0].Description != "Overridden" {
		t.Fatalf("override not applied: %+v", tools[0])
	}
	if tools[5].ID != "extra-tool" || tools[5].ParamsKey == nil || *tools[5].ParamsKey != "extra" {
		t.Fatalf("extra tool not appended: %+v", tools[5])
	}
}

func TestListToolsDerivesIDFromFileName(t *testing.T) {
	service, dataDir := newTestService(t, nil)
	writeToolFile(t, dataDir, "file-tool.json", `{
		"name": "File Tool",
		"taskNames": ["MiniGame@File@Begin"]
	}`)

	tools, err := service.ListTools()
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(tools) != 6 || tools[5].ID != "file-tool" || tools[5].Name != "File Tool" {
		t.Fatalf("file name fallback missing: %+v", tools)
	}
}

func TestListToolsAcceptsToolsArray(t *testing.T) {
	service, dataDir := newTestService(t, nil)
	writeToolFile(t, dataDir, "bundle.json", `{
		"tools": [
			{"id": "one", "name": "One", "taskNames": ["A@One@Begin"]},
			{"id": "two", "name": "Two", "taskNames": ["A@Two@Begin"], "paramsKey": "two_params"}
		]
	}`)

	tools, err := service.ListTools()
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(tools) != 7 || tools[5].ID != "one" || tools[6].ID != "two" || !tools[6].RequiresParams {
		t.Fatalf("tools bundle not loaded: %+v", tools)
	}
}

func TestListToolsRejectsInvalidDefinitions(t *testing.T) {
	cases := []struct {
		name    string
		content string
	}{
		{name: "malformed", content: `{"id":`},
		{name: "no-task-names", content: `{"id": "broken", "taskNames": []}`},
		{name: "bad-task-name", content: `{"id": "broken", "taskNames": [1]}`},
		{name: "bad-params-key", content: `{"id": "broken", "taskNames": ["A@B@Begin"], "paramsKey": 3}`},
		{name: "non-object", content: `[1]`},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			service, dataDir := newTestService(t, nil)
			writeToolFile(t, dataDir, "broken.json", testCase.content)

			_, err := service.ListTools()
			appError := errorDetails(t, err)
			if appError.Code != "AGENT_CUSTOM_TOOL_DEFINITION_INVALID" {
				t.Fatalf("unexpected code: %s", appError.Code)
			}
			if appError.StatusCode != 500 || appError.Retryable {
				t.Fatalf("unexpected status/retryable: %d/%v", appError.StatusCode, appError.Retryable)
			}
			if appError.Details["file"] != "broken.json" {
				t.Fatalf("missing file detail: %#v", appError.Details)
			}
		})
	}
}

func TestListToolsReportsDirectoryReadFailure(t *testing.T) {
	service, dataDir := newTestService(t, nil)
	if err := os.WriteFile(filepath.Join(dataDir, customToolsDir), []byte("not a directory"), 0o600); err != nil {
		t.Fatalf("write blocker: %v", err)
	}

	_, err := service.ListTools()
	appError := errorDetails(t, err)
	if appError.Code != "AGENT_CUSTOM_TOOL_DEFINITIONS_FAILED" {
		t.Fatalf("unexpected code: %s", appError.Code)
	}
	if appError.StatusCode != 500 || !appError.Retryable {
		t.Fatalf("unexpected status/retryable: %d/%v", appError.StatusCode, appError.Retryable)
	}
}

func TestBuildTaskConfigPixelPaint(t *testing.T) {
	service, _ := newTestService(t, nil)
	configValue, err := service.BuildTaskConfig("pixel-paint", map[string]any{
		"groups": []any{
			map[string]any{"color": 7, "points": []any{[]int{0, 1}, []any{3, 4}}},
		},
		"swipe":      false,
		"grid_delay": 20,
	})
	if err != nil {
		t.Fatalf("BuildTaskConfig: %v", err)
	}

	if configValue["name"] != "像素画填色" || configValue["type"] != "Custom" {
		t.Fatalf("unexpected config: %#v", configValue)
	}
	params, ok := configValue["params"].(map[string]any)
	if !ok {
		t.Fatalf("params is not a map: %#v", configValue["params"])
	}
	if !reflect.DeepEqual(params["task_names"], []string{"MiniGame@PixelPaint@Begin"}) {
		t.Fatalf("unexpected task_names: %#v", params["task_names"])
	}

	expected := decodeJSON(t, map[string]any{
		"groups": []any{
			map[string]any{"color": 7, "points": []any{[]any{0, 1}, []any{3, 4}}},
		},
		"swipe":      false,
		"grid_delay": 20,
	})
	if !reflect.DeepEqual(decodeJSON(t, params["pixel_paint"]), expected) {
		t.Fatalf("pixel_paint shape mismatch:\n got: %#v\nwant: %#v", params["pixel_paint"], expected)
	}
}

func TestBuildTaskConfigPixelPaintDefaults(t *testing.T) {
	service, _ := newTestService(t, nil)
	configValue, err := service.BuildTaskConfig("pixel-paint", map[string]any{
		"groups": []any{map[string]any{"color": 0, "points": []any{[]any{23, 23}}}},
	})
	if err != nil {
		t.Fatalf("BuildTaskConfig: %v", err)
	}
	pixel := configValue["params"].(map[string]any)["pixel_paint"].(map[string]any)
	if _, present := pixel["swipe"]; present {
		t.Fatalf("swipe should be omitted when absent: %#v", pixel)
	}
	if _, present := pixel["grid_delay"]; present {
		t.Fatalf("grid_delay should be omitted when absent: %#v", pixel)
	}
}

func TestBuildTaskConfigPixelPaintValidation(t *testing.T) {
	cases := []struct {
		name  string
		input map[string]any
	}{
		{name: "missing groups", input: map[string]any{}},
		{name: "empty groups", input: map[string]any{"groups": []any{}}},
		{name: "color high", input: map[string]any{"groups": []any{map[string]any{"color": 40, "points": []any{[]any{0, 0}}}}}},
		{name: "color negative", input: map[string]any{"groups": []any{map[string]any{"color": -1, "points": []any{[]any{0, 0}}}}}},
		{name: "color missing", input: map[string]any{"groups": []any{map[string]any{"points": []any{[]any{0, 0}}}}}},
		{name: "points empty", input: map[string]any{"groups": []any{map[string]any{"color": 1, "points": []any{}}}}},
		{name: "point short", input: map[string]any{"groups": []any{map[string]any{"color": 1, "points": []any{[]any{1}}}}}},
		{name: "x high", input: map[string]any{"groups": []any{map[string]any{"color": 1, "points": []any{[]any{24, 0}}}}}},
		{name: "y negative", input: map[string]any{"groups": []any{map[string]any{"color": 1, "points": []any{[]any{0, -1}}}}}},
		{name: "grid delay high", input: map[string]any{"groups": []any{map[string]any{"color": 1, "points": []any{[]any{0, 0}}}}, "grid_delay": 1001}},
		{name: "grid delay fractional", input: map[string]any{"groups": []any{map[string]any{"color": 1, "points": []any{[]any{0, 0}}}}, "grid_delay": 1.5}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			service, _ := newTestService(t, nil)
			_, err := service.BuildTaskConfig("pixel-paint", testCase.input)
			appError := errorDetails(t, err)
			if appError.Code != "AGENT_CUSTOM_TOOL_PARAMS_INVALID" {
				t.Fatalf("unexpected code: %s", appError.Code)
			}
			if appError.StatusCode != 400 || appError.Retryable {
				t.Fatalf("unexpected status/retryable: %d/%v", appError.StatusCode, appError.Retryable)
			}
			if appError.Details["toolId"] != "pixel-paint" {
				t.Fatalf("missing toolId detail: %#v", appError.Details)
			}
		})
	}
}

func TestBuildTaskConfigAutoRaisePotential(t *testing.T) {
	service, _ := newTestService(t, nil)

	configValue, err := service.BuildTaskConfig("auto-raise-potential", map[string]any{"use_normal_token": true})
	if err != nil {
		t.Fatalf("BuildTaskConfig: %v", err)
	}
	params := configValue["params"].(map[string]any)
	if !reflect.DeepEqual(params["task_names"], []string{"MiniGame@AutoRaisePotential@Begin"}) {
		t.Fatalf("unexpected task_names: %#v", params["task_names"])
	}
	if !reflect.DeepEqual(decodeJSON(t, params["auto_raise_potential"]), map[string]any{"use_normal_token": true}) {
		t.Fatalf("unexpected auto_raise_potential: %#v", params["auto_raise_potential"])
	}

	configValue, err = service.BuildTaskConfig("auto-raise-potential", nil)
	if err != nil {
		t.Fatalf("BuildTaskConfig: %v", err)
	}
	params = configValue["params"].(map[string]any)
	if !reflect.DeepEqual(decodeJSON(t, params["auto_raise_potential"]), map[string]any{"use_normal_token": false}) {
		t.Fatalf("default should be false: %#v", params["auto_raise_potential"])
	}
}

func TestBuildTaskConfigEventShopBlacklist(t *testing.T) {
	service, _ := newTestService(t, nil)
	configValue, err := service.BuildTaskConfig("event-shop-blacklist", map[string]any{
		"blacklist": []any{" 固源岩 ", "固源岩", ""},
	})
	if err != nil {
		t.Fatalf("BuildTaskConfig: %v", err)
	}
	params := configValue["params"].(map[string]any)
	if !reflect.DeepEqual(params["event_shop"], map[string]any{"blacklist": []string{"固源岩"}}) {
		t.Fatalf("unexpected event_shop: %#v", params["event_shop"])
	}

	_, err = service.BuildTaskConfig("event-shop-blacklist", map[string]any{"blacklist": []any{"ok", 1}})
	appError := errorDetails(t, err)
	if appError.Code != "AGENT_CUSTOM_TOOL_PARAMS_INVALID" {
		t.Fatalf("unexpected code: %s", appError.Code)
	}

	items := make([]any, 0, 105)
	for index := 0; index < 105; index++ {
		items = append(items, "item-"+itoa(index))
	}
	configValue, err = service.BuildTaskConfig("event-shop-blacklist", map[string]any{"blacklist": items})
	if err != nil {
		t.Fatalf("BuildTaskConfig: %v", err)
	}
	blacklist := configValue["params"].(map[string]any)["event_shop"].(map[string]any)["blacklist"].([]string)
	if len(blacklist) != 100 || blacklist[0] != "item-0" || blacklist[99] != "item-99" {
		t.Fatalf("unexpected truncation: len=%d first=%q last=%q", len(blacklist), blacklist[0], blacklist[len(blacklist)-1])
	}
}

func TestBuildTaskConfigParameterlessTools(t *testing.T) {
	service, _ := newTestService(t, nil)
	for _, toolID := range []string{"material-synthesis", "cursed-relic"} {
		configValue, err := service.BuildTaskConfig(toolID, map[string]any{"ignored": true})
		if err != nil {
			t.Fatalf("%s: %v", toolID, err)
		}
		params := configValue["params"].(map[string]any)
		if len(params) != 1 {
			t.Fatalf("%s should only contain task_names: %#v", toolID, params)
		}
	}
}

func TestBuildTaskConfigCustomDefinition(t *testing.T) {
	service, dataDir := newTestService(t, nil)
	writeToolFile(t, dataDir, "custom.json", `{
		"id": "custom",
		"name": "Custom",
		"taskNames": ["MiniGame@Custom@Begin"],
		"paramsKey": "custom_params"
	}`)

	configValue, err := service.BuildTaskConfig("custom", map[string]any{"value": json.Number("3")})
	if err != nil {
		t.Fatalf("BuildTaskConfig: %v", err)
	}
	params := configValue["params"].(map[string]any)
	if !reflect.DeepEqual(params["task_names"], []string{"MiniGame@Custom@Begin"}) {
		t.Fatalf("unexpected task_names: %#v", params["task_names"])
	}
	if !reflect.DeepEqual(params["custom_params"], map[string]any{"value": json.Number("3")}) {
		t.Fatalf("unexpected custom_params: %#v", params["custom_params"])
	}
}

func TestBuildTaskConfigUnknownTool(t *testing.T) {
	service, _ := newTestService(t, nil)
	_, err := service.BuildTaskConfig("missing-tool", nil)
	appError := errorDetails(t, err)
	if appError.Code != "AGENT_CUSTOM_TOOL_NOT_FOUND" {
		t.Fatalf("unexpected code: %s", appError.Code)
	}
	if appError.StatusCode != 404 || appError.Retryable {
		t.Fatalf("unexpected status/retryable: %d/%v", appError.StatusCode, appError.Retryable)
	}
	allowed, ok := appError.Details["allowed"].([]string)
	if !ok || len(allowed) != 5 || allowed[0] != "pixel-paint" {
		t.Fatalf("unexpected allowed list: %#v", appError.Details["allowed"])
	}
}

func TestRunExecutesThroughExecutor(t *testing.T) {
	executor := &fakeExecutor{
		result: domainrun.DTO{RunID: "run-1", OperationID: "run_custom_tool", State: domainrun.StatusAccepted},
	}
	service, _ := newTestService(t, executor)

	run, err := service.Run(context.Background(), "event-shop-blacklist", map[string]any{
		"blacklist": []any{"固源岩"},
	}, false)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if run.RunID != "run-1" {
		t.Fatalf("unexpected DTO: %+v", run)
	}
	if executor.calls != 1 || executor.wait {
		t.Fatalf("executor call mismatch: calls=%d wait=%v", executor.calls, executor.wait)
	}
	if executor.taskConfig["name"] != "活动商店兑换" || executor.taskConfig["type"] != "Custom" {
		t.Fatalf("unexpected task config: %#v", executor.taskConfig)
	}
	params := executor.taskConfig["params"].(map[string]any)
	if !reflect.DeepEqual(params["event_shop"], map[string]any{"blacklist": []string{"固源岩"}}) {
		t.Fatalf("unexpected params: %#v", params)
	}
}

func TestRunPassesWaitFlag(t *testing.T) {
	executor := &fakeExecutor{}
	service, _ := newTestService(t, executor)
	if _, err := service.Run(context.Background(), "material-synthesis", nil, true); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !executor.wait {
		t.Fatalf("expected wait=true")
	}
}

func TestRunValidationDoesNotCallExecutor(t *testing.T) {
	executor := &fakeExecutor{}
	service, _ := newTestService(t, executor)

	_, err := service.Run(context.Background(), "pixel-paint", map[string]any{"groups": []any{}}, true)
	appError := errorDetails(t, err)
	if appError.Code != "AGENT_CUSTOM_TOOL_PARAMS_INVALID" {
		t.Fatalf("unexpected code: %s", appError.Code)
	}
	if executor.calls != 0 {
		t.Fatalf("executor must not be called for invalid params")
	}

	_, err = service.Run(context.Background(), "missing-tool", nil, true)
	appError = errorDetails(t, err)
	if appError.Code != "AGENT_CUSTOM_TOOL_NOT_FOUND" {
		t.Fatalf("unexpected code: %s", appError.Code)
	}
	if executor.calls != 0 {
		t.Fatalf("executor must not be called for unknown tools")
	}
}

func TestRunPropagatesExecutorError(t *testing.T) {
	executorError := apperrors.WithStatus("MAA_FAILED", "设备不可用", 422, true, map[string]any{"device": "mumu"})
	service, _ := newTestService(t, &fakeExecutor{err: executorError})

	_, err := service.Run(context.Background(), "material-synthesis", nil, true)
	if !errors.Is(err, executorError) {
		t.Fatalf("expected executor error, got %v", err)
	}
	appError := errorDetails(t, err)
	if appError.Code != "MAA_FAILED" || appError.StatusCode != 422 {
		t.Fatalf("unexpected error: %+v", appError)
	}
}

func TestRunWithoutExecutorFailsClosed(t *testing.T) {
	service, _ := newTestService(t, nil)
	_, err := service.Run(context.Background(), "material-synthesis", nil, true)
	appError := errorDetails(t, err)
	if appError.Code != "AGENT_CUSTOM_TOOL_EXECUTOR_UNAVAILABLE" {
		t.Fatalf("unexpected code: %s", appError.Code)
	}
	if appError.StatusCode != 503 || !appError.Retryable {
		t.Fatalf("unexpected status/retryable: %d/%v", appError.StatusCode, appError.Retryable)
	}
}

func TestPlanMirrorsRouteShape(t *testing.T) {
	service, _ := newTestService(t, nil)
	plan, err := service.Plan(" pixel-paint ", map[string]any{
		"groups": []any{map[string]any{"color": 1, "points": []any{[]any{0, 0}}}},
	})
	if err != nil {
		t.Fatalf("Plan: %v", err)
	}
	if plan["action"] != "run-custom-tool" || plan["toolId"] != " pixel-paint " {
		t.Fatalf("unexpected plan: %#v", plan)
	}
	taskConfig, ok := plan["taskConfig"].(map[string]any)
	if !ok || taskConfig["type"] != "Custom" {
		t.Fatalf("unexpected taskConfig: %#v", plan["taskConfig"])
	}
	if !strings.Contains(taskConfig["name"].(string), "像素画") {
		t.Fatalf("unexpected task name: %#v", taskConfig["name"])
	}
}

func TestCloneRecordIsShallowCopy(t *testing.T) {
	source := map[string]any{"value": "original"}
	cloned := cloneRecord(source)
	cloned["value"] = "changed"
	if source["value"] != "original" {
		t.Fatalf("cloneRecord mutated source: %#v", source)
	}
}
