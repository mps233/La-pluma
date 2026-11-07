package contract

import (
	"bytes"
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"testing"
)

var expectedAdvertisedIDs = []string{
	"get_status",
	"test_connection",
	"discover_devices",
	"activity_run_preflight",
	"activity_copilot_candidates",
	"run_current_activity_copilots",
	"start_game",
	"fight",
	"run_task",
	"stop_task",
	"get_current_run",
	"get_run",
	"stop_run",
	"get_screenshot",
	"run_daily_flow",
	"recent_logs",
	"maa_callback_summary",
	"webrtc_status",
	"webrtc_devices",
	"webrtc_snapshot",
	"webrtc_start",
	"webrtc_stop",
	"preview_orientation",
	"get_current_activity",
	"list_custom_tools",
	"run_custom_tool",
	"get_mastery_preflight",
	"list_mastery_candidates",
	"get_mastery_operator",
	"get_mastery_status",
	"add_mastery_targets",
	"update_mastery_target",
	"remove_mastery_target",
	"reorder_mastery_targets",
	"update_mastery_settings",
	"start_mastery_campaign",
	"pause_mastery_campaign",
	"resume_mastery_campaign",
	"stop_mastery_campaign",
	"retry_mastery_target",
}

var expectedNonAdvertisedIDs = []string{
	"get_manifest",
	"get_openapi",
	"update_core",
	"hot_update_resources",
	"depot_recognition",
	"operbox_recognition",
}

var expectedRunActionIDs = []string{
	"run_current_activity_copilots",
	"start_game",
	"fight",
	"run_task",
	"run_daily_flow",
	"run_custom_tool",
}

func requireMap(t *testing.T, value any, label string) map[string]any {
	t.Helper()
	result, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s: expected map[string]any, got %T", label, value)
	}
	return result
}

func requireSlice(t *testing.T, value any, label string) []any {
	t.Helper()
	result, ok := value.([]any)
	if !ok {
		t.Fatalf("%s: expected []any, got %T", label, value)
	}
	return result
}

func requireStrings(t *testing.T, value any, label string) []string {
	t.Helper()
	result, ok := value.([]string)
	if !ok {
		t.Fatalf("%s: expected []string, got %T", label, value)
	}
	return result
}

func requireString(t *testing.T, value any, label string) string {
	t.Helper()
	result, ok := value.(string)
	if !ok {
		t.Fatalf("%s: expected string, got %T", label, value)
	}
	return result
}

func requireBool(t *testing.T, value any, label string, want bool) {
	t.Helper()
	result, ok := value.(bool)
	if !ok {
		t.Fatalf("%s: expected bool, got %T", label, value)
	}
	if result != want {
		t.Fatalf("%s: got %v, want %v", label, result, want)
	}
}

func requireInt(t *testing.T, value any, label string, want int) {
	t.Helper()
	result, ok := value.(int)
	if !ok {
		t.Fatalf("%s: expected int, got %T", label, value)
	}
	if result != want {
		t.Fatalf("%s: got %d, want %d", label, result, want)
	}
}

func operationByID(t *testing.T, id string) Operation {
	t.Helper()
	for _, item := range Operations() {
		if item.ID == id {
			return item
		}
	}
	t.Fatalf("missing operation %s", id)
	return Operation{}
}

func manifestActionByID(t *testing.T, id string) map[string]any {
	t.Helper()
	for _, raw := range requireSlice(t, Manifest()["actions"], "manifest.actions") {
		action := requireMap(t, raw, "manifest action")
		if action["id"] == id {
			return action
		}
	}
	t.Fatalf("missing manifest action %s", id)
	return nil
}

func openAPIOperationAt(t *testing.T, spec map[string]any, path, method string) map[string]any {
	t.Helper()
	paths := requireMap(t, spec["paths"], "spec.paths")
	pathItem := requireMap(t, paths[path], "spec.paths["+path+"]")
	operation := requireMap(t, pathItem[strings.ToLower(method)], "spec operation "+method+" "+path)
	return operation
}

func TestRegistryCountsAndUniqueness(t *testing.T) {
	operations := Operations()
	if len(operations) != 46 {
		t.Fatalf("operation count = %d, want 46", len(operations))
	}

	ids := map[string]bool{}
	pairs := map[string]bool{}
	advertised := 0
	hidden := make([]string, 0, 6)
	for _, item := range operations {
		if ids[item.ID] {
			t.Fatalf("duplicate operation id %s", item.ID)
		}
		ids[item.ID] = true

		pair := item.Method + " " + item.Path
		if pairs[pair] {
			t.Fatalf("duplicate method/path pair %s", pair)
		}
		pairs[pair] = true

		if item.Advertised {
			advertised++
		} else {
			hidden = append(hidden, item.ID)
		}
	}

	if advertised != 40 {
		t.Fatalf("advertised count = %d, want 40", advertised)
	}
	if !reflect.DeepEqual(hidden, expectedNonAdvertisedIDs) {
		t.Fatalf("hidden ids = %v, want %v", hidden, expectedNonAdvertisedIDs)
	}

	for _, id := range append(append([]string{}, expectedAdvertisedIDs...), expectedNonAdvertisedIDs...) {
		if !ids[id] {
			t.Fatalf("missing operation %s", id)
		}
	}
}

func TestManifestAdvertisesExpectedActions(t *testing.T) {
	manifest := Manifest()
	if manifest["version"] != APIVersion {
		t.Fatalf("manifest version = %v, want %s", manifest["version"], APIVersion)
	}
	if manifest["id"] != "la-pluma-agent-api" {
		t.Fatalf("manifest id = %v", manifest["id"])
	}
	defaults := requireMap(t, manifest["defaults"], "manifest.defaults")
	if len(defaults) != 0 {
		t.Fatalf("manifest.defaults = %v, want empty", defaults)
	}
	links := requireMap(t, manifest["links"], "manifest.links")
	if links["openapi"] != "/api/agent/openapi.json" {
		t.Fatalf("manifest.links.openapi = %v", links["openapi"])
	}
	if links["run"] != "/api/agent/runs/{runId}" {
		t.Fatalf("manifest.links.run = %v", links["run"])
	}

	actions := requireSlice(t, manifest["actions"], "manifest.actions")
	if len(actions) != 40 {
		t.Fatalf("manifest action count = %d, want 40", len(actions))
	}
	gotIDs := make([]string, 0, len(actions))
	for _, raw := range actions {
		gotIDs = append(gotIDs, requireString(t, requireMap(t, raw, "action")["id"], "action.id"))
	}
	if !reflect.DeepEqual(gotIDs, expectedAdvertisedIDs) {
		t.Fatalf("manifest action ids = %v, want %v", gotIDs, expectedAdvertisedIDs)
	}
	for _, id := range []string{"get_manifest", "get_openapi"} {
		for _, actionID := range gotIDs {
			if actionID == id {
				t.Fatalf("manifest unexpectedly advertises %s", id)
			}
		}
	}
}

func TestManifestDefaultsMaterialization(t *testing.T) {
	defaults := RuntimeDefaults{
		ADBPath:    "/custom/platform-tools/adb",
		ADBAddress: "127.0.0.1:7555",
		ClientType: "Bilibili",
	}
	manifest := ManifestWithDefaults(defaults)
	resolved := requireMap(t, manifest["defaults"], "manifest.defaults")
	wantDefaults := map[string]any{
		"adbPath":    "/custom/platform-tools/adb",
		"adbAddress": "127.0.0.1:7555",
		"clientType": "Bilibili",
	}
	if !reflect.DeepEqual(resolved, wantDefaults) {
		t.Fatalf("manifest.defaults = %v, want %v", resolved, wantDefaults)
	}

	testConnection := manifestActionByIDFrom(t, manifest, "test_connection")
	body := requireMap(t, testConnection["body_schema"], "test_connection.body_schema")
	bodyProperties := requireMap(t, body["properties"], "test_connection.body_schema.properties")
	adbPath := requireMap(t, bodyProperties["adbPath"], "adbPath")
	if adbPath["default"] != defaults.ADBPath {
		t.Fatalf("adbPath default = %v", adbPath["default"])
	}
	address := requireMap(t, bodyProperties["address"], "address")
	if address["default"] != defaults.ADBAddress {
		t.Fatalf("address default = %v", address["default"])
	}

	startGame := manifestActionByIDFrom(t, manifest, "start_game")
	startBody := requireMap(t, startGame["body_schema"], "start_game.body_schema")
	startProperties := requireMap(t, startBody["properties"], "start_game properties")
	clientType := requireMap(t, startProperties["clientType"], "clientType")
	if clientType["default"] != defaults.ClientType {
		t.Fatalf("clientType default = %v", clientType["default"])
	}
	startAddress := requireMap(t, startProperties["address"], "start_game address")
	if startAddress["default"] != defaults.ADBAddress {
		t.Fatalf("start_game address default = %v", startAddress["default"])
	}

	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if strings.Contains(string(raw), "x-la-pluma-runtime-default") {
		t.Fatalf("manifest leaked runtime default marker: %s", raw)
	}
}

func manifestActionByIDFrom(t *testing.T, manifest map[string]any, id string) map[string]any {
	t.Helper()
	for _, raw := range requireSlice(t, manifest["actions"], "manifest.actions") {
		action := requireMap(t, raw, "manifest action")
		if action["id"] == id {
			return action
		}
	}
	t.Fatalf("missing manifest action %s", id)
	return nil
}

func TestManifestDocumentsProfileAndConnectionFields(t *testing.T) {
	testConnection := manifestActionByID(t, "test_connection")
	body := requireMap(t, testConnection["body_schema"], "test_connection.body_schema")
	properties := requireMap(t, body["properties"], "test_connection properties")
	if _, ok := properties["profileId"]; !ok {
		t.Fatal("test_connection is missing profileId")
	}
	profileID := requireMap(t, properties["profileId"], "profileId")
	requireInt(t, profileID["maxLength"], "profileId.maxLength", 64)
	if profileID["pattern"] != "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" {
		t.Fatalf("profileId.pattern = %v", profileID["pattern"])
	}

	discover := manifestActionByID(t, "discover_devices")
	query := requireMap(t, discover["query_schema"], "discover_devices.query_schema")
	queryProperties := requireMap(t, query["properties"], "discover_devices properties")
	if _, ok := queryProperties["profileId"]; !ok {
		t.Fatal("discover_devices is missing profileId")
	}
	if _, ok := queryProperties["adbPath"]; !ok {
		t.Fatal("discover_devices is missing adbPath")
	}

	screenshot := manifestActionByID(t, "get_screenshot")
	screenshotBody := requireMap(t, screenshot["body_schema"], "get_screenshot.body_schema")
	screenshotProperties := requireMap(t, screenshotBody["properties"], "get_screenshot properties")
	for _, name := range []string{"profileId", "adbPath", "address"} {
		if _, ok := screenshotProperties[name]; !ok {
			t.Fatalf("get_screenshot is missing %s", name)
		}
	}

	webrtcStart := manifestActionByID(t, "webrtc_start")
	webrtcBody := requireMap(t, webrtcStart["body_schema"], "webrtc_start.body_schema")
	if _, ok := requireMap(t, webrtcBody["properties"], "webrtc_start properties")["profileId"]; !ok {
		t.Fatal("webrtc_start is missing profileId")
	}

	orientation := manifestActionByID(t, "preview_orientation")
	orientationBody := requireMap(t, orientation["body_schema"], "preview_orientation.body_schema")
	if _, ok := requireMap(t, orientationBody["properties"], "preview_orientation properties")["profileId"]; !ok {
		t.Fatal("preview_orientation is missing profileId")
	}
}

func TestManifestRecentLogsQuerySchema(t *testing.T) {
	action := manifestActionByID(t, "recent_logs")
	if action["path"] != "/api/agent/logs/recent" {
		t.Fatalf("path = %v", action["path"])
	}
	query := requireMap(t, action["query_schema"], "recent_logs.query_schema")
	lines := requireMap(t, requireMap(t, query["properties"], "properties")["lines"], "lines")
	if lines["type"] != "integer" {
		t.Fatalf("lines.type = %v", lines["type"])
	}
	requireInt(t, lines["default"], "lines.default", 80)
	requireInt(t, lines["minimum"], "lines.minimum", 1)
	requireInt(t, lines["maximum"], "lines.maximum", 500)
}

func TestManifestRunTaskSchema(t *testing.T) {
	action := manifestActionByID(t, "run_task")
	body := requireMap(t, action["body_schema"], "run_task.body_schema")
	properties := requireMap(t, body["properties"], "run_task properties")

	command := requireMap(t, properties["command"], "command")
	commandEnum := requireStrings(t, command["enum"], "command.enum")
	hasRun, hasList := false, false
	for _, value := range commandEnum {
		if value == "run" {
			hasRun = true
		}
		if value == "list" {
			hasList = true
		}
	}
	if !hasRun || !hasList {
		t.Fatalf("command enum missing run/list: %v", commandEnum)
	}

	taskConfig := requireMap(t, properties["taskConfig"], "taskConfig")
	oneOf := requireSlice(t, taskConfig["oneOf"], "taskConfig.oneOf")
	objectConfig := requireMap(t, oneOf[0], "taskConfig object")
	if !reflect.DeepEqual(requireStrings(t, objectConfig["required"], "taskConfig.required"), []string{"name", "type"}) {
		t.Fatalf("taskConfig required = %v", objectConfig["required"])
	}
	objectProperties := requireMap(t, objectConfig["properties"], "taskConfig properties")
	params := requireMap(t, objectProperties["params"], "taskConfig.params")
	if params["type"] != "object" {
		t.Fatalf("taskConfig.params.type = %v", params["type"])
	}

	taskName := requireMap(t, properties["taskName"], "taskName")
	if taskName["type"] != "string" {
		t.Fatalf("taskName.type = %v", taskName["type"])
	}
	taskType := requireMap(t, properties["taskType"], "taskType")
	if taskType["type"] != "string" {
		t.Fatalf("taskType.type = %v", taskType["type"])
	}
	userResource := requireMap(t, properties["userResource"], "userResource")
	if userResource["type"] != "boolean" {
		t.Fatalf("userResource.type = %v", userResource["type"])
	}
}

func TestManifestRetainedRunLookup(t *testing.T) {
	getRun := manifestActionByID(t, "get_run")
	if getRun["path"] != "/api/agent/runs/{runId}" {
		t.Fatalf("get_run path = %v", getRun["path"])
	}
	pathSchema := requireMap(t, getRun["path_schema"], "get_run.path_schema")
	if !reflect.DeepEqual(requireStrings(t, pathSchema["required"], "path required"), []string{"runId"}) {
		t.Fatalf("path required = %v", pathSchema["required"])
	}
	runID := requireMap(t, requireMap(t, pathSchema["properties"], "path properties")["runId"], "runId")
	if runID["format"] != "uuid" {
		t.Fatalf("runId.format = %v", runID["format"])
	}

	stopTask := manifestActionByID(t, "stop_task")
	stopBody := requireMap(t, stopTask["body_schema"], "stop_task.body_schema")
	stopProperties := requireMap(t, stopBody["properties"], "stop_task properties")
	guardedRunID := requireMap(t, stopProperties["runId"], "stop_task runId")
	if guardedRunID["format"] != "uuid" {
		t.Fatalf("stop_task runId.format = %v", guardedRunID["format"])
	}
}

var expectedMasteryOperations = []struct {
	id     string
	method string
	path   string
}{
	{"get_mastery_preflight", "GET", "/api/agent/operator-mastery/preflight"},
	{"list_mastery_candidates", "GET", "/api/agent/operator-mastery/catalog"},
	{"get_mastery_operator", "GET", "/api/agent/operator-mastery/operators/{operatorId}"},
	{"get_mastery_status", "GET", "/api/agent/operator-mastery/status"},
	{"add_mastery_targets", "POST", "/api/agent/operator-mastery/items"},
	{"update_mastery_target", "PATCH", "/api/agent/operator-mastery/items/{id}"},
	{"remove_mastery_target", "DELETE", "/api/agent/operator-mastery/items/{id}"},
	{"reorder_mastery_targets", "PUT", "/api/agent/operator-mastery/items/order"},
	{"update_mastery_settings", "PUT", "/api/agent/operator-mastery/settings"},
	{"start_mastery_campaign", "POST", "/api/agent/operator-mastery/start"},
	{"pause_mastery_campaign", "POST", "/api/agent/operator-mastery/pause"},
	{"resume_mastery_campaign", "POST", "/api/agent/operator-mastery/resume"},
	{"stop_mastery_campaign", "POST", "/api/agent/operator-mastery/stop"},
	{"retry_mastery_target", "POST", "/api/agent/operator-mastery/items/{id}/retry"},
}

func TestMasteryOperationsInManifestAndOpenAPI(t *testing.T) {
	spec := OpenAPI()
	for _, want := range expectedMasteryOperations {
		item := operationByID(t, want.id)
		if item.Method != want.method || item.Path != want.path {
			t.Fatalf("%s = %s %s, want %s %s", want.id, item.Method, item.Path, want.method, want.path)
		}
		if !item.Advertised {
			t.Fatalf("%s is not advertised", want.id)
		}
		if !reflect.DeepEqual(item.Tags, []string{"Training"}) {
			t.Fatalf("%s tags = %v", want.id, item.Tags)
		}

		action := manifestActionByID(t, want.id)
		if action["method"] != want.method || action["path"] != want.path {
			t.Fatalf("%s manifest method/path drifted", want.id)
		}
		openAPIOperationAt(t, spec, want.path, want.method)
	}
}

func TestMasteryOperationMetadata(t *testing.T) {
	preflight := manifestActionByID(t, "get_mastery_preflight")
	preflightQuery := requireMap(t, preflight["query_schema"], "preflight query")
	preflightProperties := requireMap(t, preflightQuery["properties"], "preflight properties")
	for _, name := range []string{"profileId", "clientType"} {
		if _, ok := preflightProperties[name]; !ok {
			t.Fatalf("get_mastery_preflight is missing %s", name)
		}
	}

	catalog := manifestActionByID(t, "list_mastery_candidates")
	catalogQuery := requireMap(t, catalog["query_schema"], "catalog query")
	catalogProperties := requireMap(t, catalogQuery["properties"], "catalog properties")
	status := requireMap(t, catalogProperties["status"], "catalog status")
	if !reflect.DeepEqual(requireStrings(t, status["enum"], "status.enum"), []string{"eligible", "owned", "all"}) {
		t.Fatalf("status.enum = %v", status["enum"])
	}
	limit := requireMap(t, catalogProperties["limit"], "catalog limit")
	requireInt(t, limit["minimum"], "limit.minimum", 1)
	requireInt(t, limit["maximum"], "limit.maximum", 1000)
	requireInt(t, limit["default"], "limit.default", 500)

	operator := operationByID(t, "get_mastery_operator")
	if !reflect.DeepEqual(operator.PathSchema["required"], []string{"operatorId"}) {
		t.Fatalf("get_mastery_operator required = %v", operator.PathSchema["required"])
	}

	add := manifestActionByID(t, "add_mastery_targets")
	if requireMap(t, add["safety"], "add safety")["level"] != "low-risk-write" {
		t.Fatalf("add_mastery_targets safety = %v", add["safety"])
	}
	if !reflect.DeepEqual(requireStrings(t, requireMap(t, add["safety"], "add safety")["sideEffects"], "add sideEffects"), []string{"write_mastery_queue"}) {
		t.Fatalf("add_mastery_targets sideEffects = %v", add["safety"])
	}
	addBody := requireMap(t, add["body_schema"], "add body")
	if !reflect.DeepEqual(requireStrings(t, addBody["required"], "add required"), []string{"items"}) {
		t.Fatalf("add_mastery_targets body required = %v", addBody["required"])
	}
	itemSchema := requireMap(t, requireMap(t, addBody["properties"], "add properties")["items"], "items")
	itemObject := requireMap(t, itemSchema["items"], "item object")
	if !reflect.DeepEqual(requireStrings(t, itemObject["required"], "item required"), []string{"operatorId", "skillIndex", "targetLevel"}) {
		t.Fatalf("mastery item required = %v", itemObject["required"])
	}

	settings := requireMap(t, manifestActionByID(t, "update_mastery_settings")["body_schema"], "settings body")
	settingsProperties := requireMap(t, settings["properties"], "settings properties")
	interval := requireMap(t, settingsProperties["probeIntervalMinutes"], "probeIntervalMinutes")
	if !reflect.DeepEqual(interval["enum"], []int{60, 120, 360}) {
		t.Fatalf("probeIntervalMinutes.enum = %v", interval["enum"])
	}

	start := manifestActionByID(t, "start_mastery_campaign")
	startSafety := requireMap(t, start["safety"], "start safety")
	if startSafety["level"] != "consequential" {
		t.Fatalf("start_mastery_campaign safety = %v", startSafety["level"])
	}
	if !reflect.DeepEqual(
		requireStrings(t, startSafety["sideEffects"], "start sideEffects"),
		[]string{"start_training_room_training", "consume_mastery_materials"},
	) {
		t.Fatalf("start_mastery_campaign sideEffects = %v", startSafety["sideEffects"])
	}
	startExecution := requireMap(t, start["execution"], "start execution")
	if startExecution["mode"] != "sync-or-background" {
		t.Fatalf("start_mastery_campaign mode = %v", startExecution["mode"])
	}
	if startExecution["pollAction"] != "get_mastery_status" {
		t.Fatalf("start_mastery_campaign pollAction = %v", startExecution["pollAction"])
	}
	if startExecution["stopAction"] != "stop_mastery_campaign" {
		t.Fatalf("start_mastery_campaign stopAction = %v", startExecution["stopAction"])
	}
	if !reflect.DeepEqual(requireStrings(t, startExecution["conflictsWith"], "start conflicts"), []string{"maa-execution"}) {
		t.Fatalf("start_mastery_campaign conflictsWith = %v", startExecution["conflictsWith"])
	}

	stop := operationByID(t, "stop_mastery_campaign")
	if stop.Execution.StopAction != nil {
		t.Fatalf("stop_mastery_campaign stopAction = %v", stop.Execution.StopAction)
	}
	if !reflect.DeepEqual(stop.Safety.SideEffects, []string{"stop_mastery_campaign"}) {
		t.Fatalf("stop_mastery_campaign sideEffects = %v", stop.Safety.SideEffects)
	}

	retry := operationByID(t, "retry_mastery_target")
	if !reflect.DeepEqual(retry.PathSchema["required"], []string{"id"}) {
		t.Fatalf("retry_mastery_target required = %v", retry.PathSchema["required"])
	}
}

func TestIdempotencyMetadataForRunActions(t *testing.T) {
	actions := requireSlice(t, Manifest()["actions"], "manifest.actions")
	gotIDs := make([]string, 0)
	for _, raw := range actions {
		action := requireMap(t, raw, "action")
		execution := requireMap(t, action["execution"], "action.execution")
		if execution["producesRun"] == true {
			gotIDs = append(gotIDs, requireString(t, action["id"], "action.id"))
		}
	}
	if !reflect.DeepEqual(gotIDs, expectedRunActionIDs) {
		t.Fatalf("producesRun actions = %v, want %v", gotIDs, expectedRunActionIDs)
	}

	for _, id := range expectedRunActionIDs {
		action := manifestActionByID(t, id)
		execution := requireMap(t, action["execution"], id+".execution")
		if execution["runLookupAction"] != "get_run" {
			t.Fatalf("%s runLookupAction = %v", id, execution["runLookupAction"])
		}
		idempotency := requireMap(t, execution["idempotency"], id+".idempotency")
		requireBool(t, idempotency["supported"], id+".idempotency.supported", true)
		requireBool(t, idempotency["required"], id+".idempotency.required", false)
		if idempotency["header"] != "Idempotency-Key" {
			t.Fatalf("%s idempotency.header = %v", id, idempotency["header"])
		}
		if idempotency["scope"] != "local-instance" {
			t.Fatalf("%s idempotency.scope = %v", id, idempotency["scope"])
		}
		if idempotency["namespace"] != "operationId" {
			t.Fatalf("%s idempotency.namespace = %v", id, idempotency["namespace"])
		}
		requireBool(t, idempotency["survivesRestart"], id+".idempotency.survivesRestart", true)
		if idempotency["restartBehavior"] != "active-runs-become-interrupted" {
			t.Fatalf("%s idempotency.restartBehavior = %v", id, idempotency["restartBehavior"])
		}
		requireInt(t, idempotency["retentionSeconds"], id+".idempotency.retentionSeconds", 86400)
		if idempotency["retentionMode"] != "up-to" {
			t.Fatalf("%s idempotency.retentionMode = %v", id, idempotency["retentionMode"])
		}
		requireInt(t, idempotency["maxTerminalRuns"], id+".idempotency.maxTerminalRuns", 500)

		headerSchema := requireMap(t, action["header_schema"], id+".header_schema")
		headerProperties := requireMap(t, headerSchema["properties"], id+".header_schema.properties")
		headerKey := requireMap(t, headerProperties["Idempotency-Key"], id+".header_schema key")
		requireInt(t, headerKey["maxLength"], id+".header_schema key maxLength", 128)
	}

	fight := requireMap(t, requireMap(t, manifestActionByID(t, "fight")["execution"], "fight execution")["idempotency"], "fight idempotency")
	if !reflect.DeepEqual(fight["appliesWhen"], map[string]any{"dryRun": false}) {
		t.Fatalf("fight appliesWhen = %v", fight["appliesWhen"])
	}
	dailyFlow := requireMap(t, requireMap(t, manifestActionByID(t, "run_daily_flow")["execution"], "daily execution")["idempotency"], "daily idempotency")
	if !reflect.DeepEqual(dailyFlow["appliesWhen"], map[string]any{"dryRun": false}) {
		t.Fatalf("run_daily_flow appliesWhen = %v", dailyFlow["appliesWhen"])
	}
}

func TestOpenAPIDerivesFromRegistry(t *testing.T) {
	spec := OpenAPI()
	if spec["openapi"] != "3.1.0" {
		t.Fatalf("openapi = %v", spec["openapi"])
	}
	info := requireMap(t, spec["info"], "spec.info")
	if info["version"] != APIVersion {
		t.Fatalf("info.version = %v", info["version"])
	}
	paths := requireMap(t, spec["paths"], "spec.paths")

	operations := Operations()
	operationCount := 0
	for _, item := range operations {
		generated := openAPIOperationAt(t, spec, item.Path, item.Method)
		operationCount++
		if generated["operationId"] != item.ID {
			t.Fatalf("%s operationId = %v", item.ID, generated["operationId"])
		}
		if !reflect.DeepEqual(generated["tags"], item.Tags) {
			t.Fatalf("%s tags = %v, want %v", item.ID, generated["tags"], item.Tags)
		}
		if !reflect.DeepEqual(generated["x-la-pluma-safety"], safetyValue(item.Safety)) {
			t.Fatalf("%s safety drifted from registry", item.ID)
		}
		if !reflect.DeepEqual(generated["x-la-pluma-execution"], executionValue(item.Execution)) {
			t.Fatalf("%s execution drifted from registry", item.ID)
		}
	}
	if operationCount != len(operations) {
		t.Fatalf("OpenAPI operation count = %d, want %d", operationCount, len(operations))
	}

	advertisedPaths := map[string]bool{}
	for _, item := range operations {
		if item.Advertised {
			advertisedPaths[item.Path] = true
		}
	}
	for path := range advertisedPaths {
		if _, ok := paths[path]; !ok {
			t.Fatalf("OpenAPI missing advertised path %s", path)
		}
	}

	// update_mastery_target and remove_mastery_target share one path with
	// different methods, so the OpenAPI path count matches the unique path
	// count rather than the operation count.
	uniquePaths := map[string]bool{}
	for _, item := range operations {
		uniquePaths[item.Path] = true
	}
	if len(paths) != len(uniquePaths) {
		t.Fatalf("OpenAPI path count = %d, want %d", len(paths), len(uniquePaths))
	}
}

func TestOpenAPIGetOperationsHaveNoRequestBody(t *testing.T) {
	spec := OpenAPI()
	for _, item := range Operations() {
		if item.Method != "GET" {
			continue
		}
		generated := openAPIOperationAt(t, spec, item.Path, item.Method)
		if _, ok := generated["requestBody"]; ok {
			t.Fatalf("%s unexpectedly has a request body", item.ID)
		}
	}

	discover := openAPIOperationAt(t, spec, "/api/agent/actions/discover-devices", "GET")
	parameters := requireSlice(t, discover["parameters"], "discover parameters")
	byName := map[string]map[string]any{}
	for _, raw := range parameters {
		parameter := requireMap(t, raw, "parameter")
		if name, ok := parameter["name"].(string); ok {
			byName[name] = parameter
		}
	}
	if byName["profileId"]["in"] != "query" {
		t.Fatalf("profileId.in = %v", byName["profileId"]["in"])
	}
	if _, ok := requireMap(t, byName["adbPath"]["schema"], "adbPath schema")["default"]; ok {
		t.Fatalf("adbPath should have no default without runtime defaults")
	}
}

func TestOpenAPIPathAndQueryParameters(t *testing.T) {
	spec := OpenAPI()
	runOperation := openAPIOperationAt(t, spec, "/api/agent/runs/{runId}", "GET")
	parameters := requireSlice(t, runOperation["parameters"], "run parameters")
	var runID map[string]any
	for _, raw := range parameters {
		parameter := requireMap(t, raw, "parameter")
		if parameter["name"] == "runId" {
			runID = parameter
		}
	}
	if runID == nil {
		t.Fatal("missing runId path parameter")
	}
	if runID["in"] != "path" {
		t.Fatalf("runId.in = %v", runID["in"])
	}
	requireBool(t, runID["required"], "runId.required", true)
	if requireMap(t, runID["schema"], "runId.schema")["format"] != "uuid" {
		t.Fatalf("runId format = %v", requireMap(t, runID["schema"], "runId.schema")["format"])
	}
	okResponse := requireMap(t, requireMap(t, runOperation["responses"], "responses")["200"], "200")
	content := requireMap(t, okResponse["content"], "200 content")
	schema := requireMap(t, requireMap(t, content["application/json"], "200 json")["schema"], "200 schema")
	if schema["$ref"] != "#/components/schemas/RunResponse" {
		t.Fatalf("get_run 200 schema = %v", schema["$ref"])
	}

	logOperation := openAPIOperationAt(t, spec, "/api/agent/logs/recent", "GET")
	logParameters := requireSlice(t, logOperation["parameters"], "log parameters")
	lines := map[string]any{}
	for _, raw := range logParameters {
		parameter := requireMap(t, raw, "log parameter")
		if parameter["name"] == "lines" {
			lines = parameter
		}
	}
	if lines["in"] != "query" {
		t.Fatalf("lines.in = %v", lines["in"])
	}
	lineSchema := requireMap(t, lines["schema"], "lines.schema")
	requireInt(t, lineSchema["default"], "lines.default", 80)
	requireInt(t, lineSchema["maximum"], "lines.maximum", 500)
}

func TestOpenAPIRequestBody(t *testing.T) {
	spec := OpenAPI()
	fight := openAPIOperationAt(t, spec, "/api/agent/actions/fight", "POST")
	requestBody := requireMap(t, fight["requestBody"], "fight.requestBody")
	requireBool(t, requestBody["required"], "fight.requestBody.required", true)
	content := requireMap(t, requestBody["content"], "fight content")
	schema := requireMap(t, requireMap(t, content["application/json"], "fight json")["schema"], "fight schema")
	if !reflect.DeepEqual(requireStrings(t, schema["required"], "fight required"), []string{"stages"}) {
		t.Fatalf("fight required = %v", schema["required"])
	}
	dryRun := requireMap(t, requireMap(t, schema["properties"], "fight properties")["dryRun"], "fight dryRun")
	requireBool(t, dryRun["default"], "fight dryRun.default", false)
}

func TestOpenAPIEnvelopeSchemas(t *testing.T) {
	schemas := requireMap(t, requireMap(t, OpenAPI()["components"], "components")["schemas"], "schemas")

	success := requireMap(t, schemas["SuccessResponse"], "SuccessResponse")
	if !reflect.DeepEqual(requireStrings(t, success["required"], "SuccessResponse.required"), []string{"success", "message", "data", "meta"}) {
		t.Fatalf("SuccessResponse.required = %v", success["required"])
	}
	successProperties := requireMap(t, success["properties"], "SuccessResponse.properties")
	requireBool(t, successProperties["success"].(map[string]any)["const"], "success.const", true)
	if requireMap(t, successProperties["meta"], "meta")["$ref"] != "#/components/schemas/ResponseMeta" {
		t.Fatalf("SuccessResponse.meta = %v", successProperties["meta"])
	}

	meta := requireMap(t, schemas["ResponseMeta"], "ResponseMeta")
	if !reflect.DeepEqual(requireStrings(t, meta["required"], "ResponseMeta.required"), []string{"requestId", "dryRun"}) {
		t.Fatalf("ResponseMeta.required = %v", meta["required"])
	}

	errorResponse := requireMap(t, schemas["ErrorResponse"], "ErrorResponse")
	if !reflect.DeepEqual(requireStrings(t, errorResponse["required"], "ErrorResponse.required"), []string{"success", "message", "error", "meta"}) {
		t.Fatalf("ErrorResponse.required = %v", errorResponse["required"])
	}
	errorProperties := requireMap(t, errorResponse["properties"], "ErrorResponse.properties")
	requireBool(t, errorProperties["success"].(map[string]any)["const"], "error success.const", false)
	if requireMap(t, errorProperties["error"], "error")["$ref"] != "#/components/schemas/AgentError" {
		t.Fatalf("ErrorResponse.error = %v", errorProperties["error"])
	}

	for _, item := range Operations() {
		generated := openAPIOperationAt(t, OpenAPI(), item.Path, item.Method)
		responses := requireMap(t, generated["responses"], "responses")
		for _, status := range []string{"400", "401", "404", "409", "422", "500"} {
			if _, ok := responses[status]; !ok {
				t.Fatalf("%s missing response %s", item.ID, status)
			}
		}
		if item.ResponseKind != "openapi" && item.ResponseKind != "run" {
			okResponse := requireMap(t, responses["200"], "200 response")
			content := requireMap(t, okResponse["content"], "200 content")
			schema := requireMap(t, requireMap(t, content["application/json"], "200 json")["schema"], "200 schema")
			if schema["$ref"] != "#/components/schemas/SuccessResponse" {
				t.Fatalf("%s 200 schema = %v", item.ID, schema["$ref"])
			}
		}
	}
}

func TestOpenAPISecuritySchemes(t *testing.T) {
	spec := OpenAPI()
	components := requireMap(t, spec["components"], "components")
	schemes := requireMap(t, components["securitySchemes"], "securitySchemes")
	bearer := requireMap(t, schemes["bearerAuth"], "bearerAuth")
	if bearer["type"] != "http" || bearer["scheme"] != "bearer" {
		t.Fatalf("bearerAuth = %v", bearer)
	}
	token := requireMap(t, schemes["laPlumaToken"], "laPlumaToken")
	if token["type"] != "apiKey" || token["in"] != "header" || token["name"] != "X-La-Pluma-Token" {
		t.Fatalf("laPlumaToken = %v", token)
	}

	requirements := requireSlice(t, spec["security"], "security")
	hasAnonymous := false
	for _, raw := range requirements {
		if len(requireMap(t, raw, "security requirement")) == 0 {
			hasAnonymous = true
		}
	}
	if !hasAnonymous {
		t.Fatal("security is missing the anonymous requirement")
	}
}

func TestOpenAPIIdempotencyAndAcceptedRuns(t *testing.T) {
	spec := OpenAPI()
	components := requireMap(t, spec["components"], "components")
	header := requireMap(t, requireMap(t, components["parameters"], "parameters")["IdempotencyKey"], "IdempotencyKey")
	if header["name"] != "Idempotency-Key" || header["in"] != "header" {
		t.Fatalf("IdempotencyKey = %v", header)
	}
	requireBool(t, header["required"], "IdempotencyKey.required", false)
	requireInt(t, requireMap(t, header["schema"], "IdempotencyKey.schema")["maxLength"], "IdempotencyKey maxLength", 128)
	description := requireString(t, header["description"], "IdempotencyKey.description")
	for _, fragment := range []string{
		"across normal process restarts",
		"within the same operation",
		"up to 24 hours",
		"500-terminal-run cap",
		"are not resumed",
	} {
		if !strings.Contains(description, fragment) {
			t.Fatalf("IdempotencyKey description missing %q", fragment)
		}
	}

	for _, item := range Operations() {
		if !item.Execution.ProducesRun {
			continue
		}
		generated := openAPIOperationAt(t, spec, item.Path, item.Method)
		hasRef := false
		for _, raw := range requireSlice(t, generated["parameters"], "parameters") {
			if requireMap(t, raw, "parameter")["$ref"] == "#/components/parameters/IdempotencyKey" {
				hasRef = true
			}
		}
		if !hasRef {
			t.Fatalf("%s missing Idempotency-Key parameter", item.ID)
		}

		responses := requireMap(t, generated["responses"], "responses")
		accepted := requireMap(t, responses["202"], "202")
		acceptedContent := requireMap(t, accepted["content"], "202 content")
		acceptedSchema := requireMap(t, requireMap(t, acceptedContent["application/json"], "202 json")["schema"], "202 schema")
		if acceptedSchema["$ref"] != "#/components/schemas/SuccessResponse" {
			t.Fatalf("%s 202 schema = %v", item.ID, acceptedSchema["$ref"])
		}
		headers := requireMap(t, accepted["headers"], "202 headers")
		location := requireMap(t, headers["Location"], "Location")
		if requireMap(t, location["schema"], "Location.schema")["format"] != "uri-reference" {
			t.Fatalf("%s Location format", item.ID)
		}
		runHeader := requireMap(t, headers["X-La-Pluma-Run-Id"], "X-La-Pluma-Run-Id")
		if requireMap(t, runHeader["schema"], "run id schema")["format"] != "uuid" {
			t.Fatalf("%s run id header format", item.ID)
		}
		replayed := requireMap(t, headers["Idempotency-Replayed"], "Idempotency-Replayed")
		if requireMap(t, replayed["schema"], "replayed schema")["type"] != "boolean" {
			t.Fatalf("%s replayed header type", item.ID)
		}

		serviceUnavailable := requireMap(t, responses["503"], "503")
		if serviceUnavailable["$ref"] != "#/components/responses/ServiceUnavailable" {
			t.Fatalf("%s 503 = %v", item.ID, serviceUnavailable["$ref"])
		}
	}

	serviceUnavailable := requireMap(t, requireMap(t, components["responses"], "responses")["ServiceUnavailable"], "ServiceUnavailable")
	content := requireMap(t, serviceUnavailable["content"], "ServiceUnavailable content")
	schema := requireMap(t, requireMap(t, content["application/json"], "content json")["schema"], "content schema")
	if schema["$ref"] != "#/components/schemas/ErrorResponse" {
		t.Fatalf("ServiceUnavailable schema = %v", schema["$ref"])
	}
}

func TestOpenAPIRunSchemas(t *testing.T) {
	schemas := requireMap(t, requireMap(t, OpenAPI()["components"], "components")["schemas"], "schemas")
	run := requireMap(t, schemas["Run"], "Run")
	if !reflect.DeepEqual(
		requireStrings(t, run["required"], "Run.required"),
		[]string{"runId", "operationId", "state", "acceptedAt", "links"},
	) {
		t.Fatalf("Run.required = %v", run["required"])
	}
	properties := requireMap(t, run["properties"], "Run.properties")
	if requireMap(t, properties["runId"], "runId")["format"] != "uuid" {
		t.Fatalf("Run.runId = %v", properties["runId"])
	}
	if !reflect.DeepEqual(
		requireStrings(t, requireMap(t, properties["state"], "state")["enum"], "state.enum"),
		[]string{"accepted", "waiting", "running", "succeeded", "failed", "stopping", "stopped", "interrupted"},
	) {
		t.Fatalf("Run.state.enum = %v", requireMap(t, properties["state"], "state")["enum"])
	}
	if requireMap(t, properties["progress"], "progress")["$ref"] != "#/components/schemas/RunProgress" {
		t.Fatalf("Run.progress = %v", properties["progress"])
	}
	requireInt(t, requireMap(t, properties["durationMs"], "durationMs")["minimum"], "durationMs.minimum", 0)
	if requireMap(t, properties["error"], "error")["$ref"] != "#/components/schemas/RunError" {
		t.Fatalf("Run.error = %v", properties["error"])
	}

	runError := requireMap(t, schemas["RunError"], "RunError")
	if !reflect.DeepEqual(
		requireStrings(t, runError["required"], "RunError.required"),
		[]string{"code", "message", "details", "retryable", "statusCode"},
	) {
		t.Fatalf("RunError.required = %v", runError["required"])
	}
	requireBool(t, runError["additionalProperties"], "RunError.additionalProperties", false)

	runResponse := requireMap(t, schemas["RunResponse"], "RunResponse")
	allOf := requireSlice(t, runResponse["allOf"], "RunResponse.allOf")
	second := requireMap(t, allOf[1], "RunResponse.allOf[1]")
	data := requireMap(t, requireMap(t, second["properties"], "RunResponse properties")["data"], "RunResponse data")
	if data["$ref"] != "#/components/schemas/Run" {
		t.Fatalf("RunResponse data = %v", data["$ref"])
	}
}

func TestSafetyAndExecutionFlags(t *testing.T) {
	recentLogs := operationByID(t, "recent_logs")
	requireBool(t, recentLogs.Safety.ReadOnly, "recent_logs readOnly", true)
	maaCallbacks := operationByID(t, "maa_callback_summary")
	requireBool(t, maaCallbacks.Safety.ReadOnly, "maa_callback_summary readOnly", true)

	getStatus := operationByID(t, "get_status")
	requireBool(t, getStatus.Safety.ReadOnly, "get_status readOnly", false)
	if !reflect.DeepEqual(getStatus.Safety.SideEffects, []string{"adb_connect"}) {
		t.Fatalf("get_status sideEffects = %v", getStatus.Safety.SideEffects)
	}
	getScreenshot := operationByID(t, "get_screenshot")
	requireBool(t, getScreenshot.Safety.ReadOnly, "get_screenshot readOnly", false)
	fight := operationByID(t, "fight")
	requireBool(t, fight.Safety.ReadOnly, "fight readOnly", false)
	requireBool(t, fight.Execution.SupportsDryRun, "fight supportsDryRun", true)
	dailyFlow := operationByID(t, "run_daily_flow")
	requireBool(t, dailyFlow.Execution.SupportsDryRun, "run_daily_flow supportsDryRun", true)
	orientation := operationByID(t, "preview_orientation")
	requireBool(t, orientation.Execution.SupportsDryRun, "preview_orientation supportsDryRun", true)
	runTask := operationByID(t, "run_task")
	requireBool(t, runTask.Execution.SupportsDryRun, "run_task supportsDryRun", false)
	if runTask.Execution.PollAction == nil || *runTask.Execution.PollAction != "get_current_run" {
		t.Fatalf("run_task pollAction = %v", runTask.Execution.PollAction)
	}
	if !reflect.DeepEqual(runTask.Execution.ConflictsWith, []string{"maa-execution"}) {
		t.Fatalf("run_task conflictsWith = %v", runTask.Execution.ConflictsWith)
	}

	stopTask := operationByID(t, "stop_task")
	requireBool(t, stopTask.Safety.Idempotent, "stop_task idempotent", true)
	requireBool(t, stopTask.Safety.Destructive, "stop_task destructive", true)
	for _, id := range []string{"webrtc_start", "webrtc_stop", "preview_orientation"} {
		requireBool(t, operationByID(t, id).Safety.MutatesDevice, id+" mutatesDevice", true)
	}
}

func TestJSONOutputIsDeterministic(t *testing.T) {
	for name, document := range map[string]map[string]any{
		"manifest": Manifest(),
		"openapi":  OpenAPI(),
	} {
		first, err := json.Marshal(document)
		if err != nil {
			t.Fatalf("%s marshal: %v", name, err)
		}
		for index := 0; index < 3; index++ {
			next, err := json.Marshal(document)
			if err != nil {
				t.Fatalf("%s marshal: %v", name, err)
			}
			if !bytes.Equal(first, next) {
				t.Fatalf("%s JSON is not deterministic", name)
			}
		}
	}

	raw, err := json.Marshal(OpenAPI())
	if err != nil {
		t.Fatalf("marshal openapi: %v", err)
	}
	if strings.Contains(string(raw), "x-la-pluma-runtime-default") {
		t.Fatal("OpenAPI leaked runtime default marker")
	}
}

func TestOutputsAreIndependentCopies(t *testing.T) {
	first := Manifest()
	actions := requireSlice(t, first["actions"], "actions")
	requireMap(t, actions[0], "first action")["id"] = "mutated"

	second := Manifest()
	secondActions := requireSlice(t, second["actions"], "actions")
	if requireMap(t, secondActions[0], "second action")["id"] == "mutated" {
		t.Fatal("Manifest shares mutable state across calls")
	}

	operations := Operations()
	operations[0].Tags[0] = "mutated"
	if Operations()[0].Tags[0] == "mutated" {
		t.Fatal("Operations shares mutable state across calls")
	}
}

func TestSortedParameterNames(t *testing.T) {
	spec := OpenAPI()
	operation := openAPIOperationAt(t, spec, "/api/agent/logs/recent", "GET")
	names := make([]string, 0)
	for _, raw := range requireSlice(t, operation["parameters"], "parameters") {
		names = append(names, requireString(t, requireMap(t, raw, "parameter")["name"], "parameter.name"))
	}
	if !sort.StringsAreSorted(names) {
		t.Fatalf("parameter order is not deterministic: %v", names)
	}
}
