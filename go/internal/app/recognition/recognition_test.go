package recognition

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func tempPaths(t *testing.T) config.Paths {
	t.Helper()
	root := t.TempDir()
	return config.Paths{
		DataDir:      filepath.Join(root, "data"),
		MaaDataDir:   filepath.Join(root, "maa"),
		MaaStateDir:  filepath.Join(root, "state"),
		MaaConfigDir: filepath.Join(root, "config"),
	}
}

func writeFixture(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeDepotResource(t *testing.T, paths config.Paths) {
	t.Helper()
	writeFixture(t, filepath.Join(paths.MaaDataDir, "resource", "item_index.json"), `{
		"2001": {"name":"龙门币","icon":"2001.png","classifyType":"MATERIAL","sortId":12},
		"30011": {"name":"固源岩","icon":"30011.png","classifyType":"MATERIAL","sortId":2},
		"30012": {"icon":"30012.png","classifyType":"MATERIAL","sortId":3}
	}`)
	writeFixture(t, filepath.Join(paths.MaaDataDir, "resource", "gamedata", "excel", "item_table.json"), `{
		"items": {
			"2001": {"iconId":"2001","name":"龙门币","classifyType":"MATERIAL","sortId":12},
			"30011": {"iconId":"30011"},
			"30012": {"iconId":"30012","name":"固源岩组","classifyType":"MATERIAL","sortId":3}
		}
	}`)
}

func callbackLine(t *testing.T, payload any) string {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return "[2026-10-31 12:00:00.000][INF][Px1][Tx1] Assistant::append_callback | SubTaskExtraInfo " + string(encoded)
}

func contentPointer(value string) *string {
	return &value
}

func requireAgentError(t *testing.T, err error, code string, status int, retryable bool) *apperrors.Error {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %s", code)
	}
	appErr, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("error %v is not an agent error", err)
	}
	if appErr.Code != code || appErr.StatusCode != status || appErr.Retryable != retryable {
		t.Fatalf("error = %+v, want code=%s status=%d retryable=%v", appErr, code, status, retryable)
	}
	return appErr
}

func readRecord(t *testing.T, path string) map[string]any {
	t.Helper()
	value, err := jsonstore.Read(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s is not an object: %#v", path, value)
	}
	return record
}

func numberText(value any) string {
	switch typed := value.(type) {
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	}
	return ""
}

func TestExtractCallbackPayloads(t *testing.T) {
	ordered := `[2026-10-31 12:00:00.000][INF][Px1][Tx1] Assistant::append_callback | SubTaskExtraInfo {"class":"asst::DepotRecognitionTask","details":{"data":"{\"2001\":12000}","done":true},"what":"DepotInfo"}`
	reversed := `[2026-10-31 12:00:00.000][INF][Px1][Tx1] Assistant::append_callback | SubTaskExtraInfo {"what":"DepotInfo","details":{"done":true,"data":"{\"30011\":5}"},"class":"asst::DepotRecognitionTask"}`
	other := callbackLine(t, map[string]any{"what": "OperBoxInfo", "details": map[string]any{}})
	truncated := `Assistant::append_callback | SubTaskExtraInfo {"what":"DepotInfo","details":`

	both := strings.Join([]string{ordered, other, reversed}, "\n")
	payloads := ExtractCallbackPayloads(both, "DepotInfo")
	if len(payloads) != 2 {
		t.Fatalf("payloads = %d, want 2", len(payloads))
	}
	if details := payloadDetails(payloads[0]); details["done"] != true {
		t.Fatalf("details = %#v", details)
	}

	if got := ExtractCallbackPayloads(other, "DepotInfo"); len(got) != 0 {
		t.Fatalf("unrelated payload extracted: %#v", got)
	}
	if got := ExtractCallbackPayloads(truncated, "DepotInfo"); len(got) != 0 {
		t.Fatalf("truncated payload extracted: %#v", got)
	}
	if got := ExtractCallbackPayloads("not a callback\n", "DepotInfo"); len(got) != 0 {
		t.Fatalf("garbage payload extracted: %#v", got)
	}
}

func TestSelectRecognitionPayload(t *testing.T) {
	hasData := func(payload Payload) bool {
		details := payloadDetails(payload)
		_, ok := details["data"].(string)
		return ok
	}

	payloads := []Payload{
		{"details": map[string]any{"done": true, "data": `{"2001":1}`}},
		{"details": map[string]any{"done": false, "data": `{"2001":2}`}},
	}
	selected := SelectRecognitionPayload(payloads, hasData)
	if selected == nil || !selected.Complete {
		t.Fatalf("selected = %#v", selected)
	}
	if payloadDetails(selected.Payload)["data"] != `{"2001":1}` {
		t.Fatalf("selected payload = %#v", selected.Payload)
	}

	selected = SelectRecognitionPayload(payloads[1:], hasData)
	if selected == nil || selected.Complete {
		t.Fatalf("incomplete selection = %#v", selected)
	}

	if selected := SelectRecognitionPayload([]Payload{{"details": map[string]any{}}}, hasData); selected != nil {
		t.Fatalf("unexpected selection = %#v", selected)
	}
}

func TestParseDepotPayloadData(t *testing.T) {
	value, err := ParseDepotPayloadData(map[string]any{"data": `{"2001":12000}`})
	if err != nil {
		t.Fatal(err)
	}
	record, ok := value.(map[string]any)
	if !ok || numberText(record["2001"]) != "12000" {
		t.Fatalf("parsed string data = %#v", value)
	}

	value, err = ParseDepotPayloadData(map[string]any{"data": map[string]any{"2001": json.Number("12000")}})
	if err != nil {
		t.Fatal(err)
	}
	record, ok = value.(map[string]any)
	if !ok || numberText(record["2001"]) != "12000" {
		t.Fatalf("parsed object data = %#v", value)
	}

	value, err = ParseDepotPayloadData(map[string]any{"data": `[1,2]`})
	if err != nil {
		t.Fatal(err)
	}
	if array, ok := value.([]any); !ok || len(array) != 2 {
		t.Fatalf("parsed array data = %#v", value)
	}

	if _, err := ParseDepotPayloadData(map[string]any{"data": `{bad json`}); err == nil {
		t.Fatal("expected a JSON parse error")
	}
	if value, err := ParseDepotPayloadData(map[string]any{}); err != nil || value != nil {
		t.Fatalf("missing data = %#v, %v", value, err)
	}
	if value, err := ParseDepotPayloadData("not a record"); err != nil || value != nil {
		t.Fatalf("non-record details = %#v, %v", value, err)
	}
}

func TestRecognizeDepotWritesEnrichedSnapshot(t *testing.T) {
	paths := tempPaths(t)
	writeDepotResource(t, paths)
	now := time.Date(2026, 11, 8, 12, 34, 56, 789_000_000, time.UTC)
	service := New(Options{Paths: paths, Logger: discardLogger(), Now: func() time.Time { return now }})

	payload := map[string]any{
		"what":    "DepotInfo",
		"class":   "asst::DepotRecognitionTask",
		"details": map[string]any{"done": true, "data": `{"2001":12000,"30011":5,"30012":7,"9999":1}`},
	}
	content := callbackLine(t, payload)
	result, err := service.RecognizeDepotRequest(context.Background(), Request{LogContent: contentPointer(content)})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Written {
		t.Fatal("expected a written result")
	}
	if result.Data.ItemCount != 4 || result.Data.Complete != true {
		t.Fatalf("data = %#v", result.Data)
	}
	wantPath := filepath.Join(paths.DataDir, "depot.json")
	if result.Data.Path != wantPath {
		t.Fatalf("path = %s, want %s", result.Data.Path, wantPath)
	}
	if result.Output.Timestamp != "2026-11-08T12:34:56.789Z" {
		t.Fatalf("timestamp = %s", result.Output.Timestamp)
	}

	wantOrder := []string{"30011", "30012", "2001", "9999"}
	if len(result.Data.Items) != len(wantOrder) {
		t.Fatalf("items = %#v", result.Data.Items)
	}
	for index, id := range wantOrder {
		if result.Data.Items[index].ID != id {
			t.Fatalf("items[%d] = %s, want %s", index, result.Data.Items[index].ID, id)
		}
	}

	first := result.Data.Items[0]
	if first.Name != "固源岩" || first.Icon != "30011.png" || first.IconID != "30011" || first.SortID != 2 {
		t.Fatalf("固源岩 item = %#v", first)
	}
	if numberText(first.Count) != "5" {
		t.Fatalf("count = %#v", first.Count)
	}
	if result.Data.Items[1].Name != "固源岩组" {
		t.Fatalf("table name fallback = %#v", result.Data.Items[1])
	}
	unknown := result.Data.Items[3]
	if unknown.Name != "未知物品 (9999)" || unknown.Icon != nil || unknown.IconID != "9999" || unknown.ClassifyType != "UNKNOWN" || unknown.SortID != 999999 {
		t.Fatalf("unknown item = %#v", unknown)
	}

	saved := readRecord(t, wantPath)
	if numberText(saved["itemCount"]) != "4" || saved["complete"] != true {
		t.Fatalf("saved = %#v", saved)
	}
	if _, err := time.Parse(time.RFC3339, saved["timestamp"].(string)); err != nil {
		t.Fatalf("timestamp = %#v: %v", saved["timestamp"], err)
	}
	savedItems, ok := saved["items"].([]any)
	if !ok || len(savedItems) != 4 {
		t.Fatalf("saved items = %#v", saved["items"])
	}
}

func TestRecognizeDepotIncompleteStillWrites(t *testing.T) {
	paths := tempPaths(t)
	writeDepotResource(t, paths)
	service := New(Options{Paths: paths, Logger: discardLogger()})

	content := callbackLine(t, map[string]any{
		"what":    "DepotInfo",
		"details": map[string]any{"done": false, "data": `{"2001":1}`},
	})
	result, err := service.RecognizeDepotRequest(context.Background(), Request{LogContent: contentPointer(content)})
	if err != nil {
		t.Fatal(err)
	}
	if result.Data.Complete || result.Output.Complete {
		t.Fatalf("result = %#v", result)
	}
	saved := readRecord(t, filepath.Join(paths.DataDir, "depot.json"))
	if saved["complete"] != false {
		t.Fatalf("saved = %#v", saved)
	}
}

func TestRecognizeDepotErrors(t *testing.T) {
	t.Run("unreadable log", func(t *testing.T) {
		paths := tempPaths(t)
		service := New(Options{Paths: paths, Logger: discardLogger()})
		_, err := service.RecognizeDepot(context.Background())
		appErr := requireAgentError(t, err, "AGENT_DEPOT_LOG_UNAVAILABLE", 500, true)
		if appErr.Details["logPath"] != filepath.Join(paths.MaaStateDir, "debug", "asst.log") {
			t.Fatalf("details = %#v", appErr.Details)
		}
	})

	t.Run("no depot callback", func(t *testing.T) {
		paths := tempPaths(t)
		service := New(Options{Paths: paths, Logger: discardLogger()})
		content := callbackLine(t, map[string]any{"what": "OperBoxInfo", "details": map[string]any{}})
		_, err := service.RecognizeDepotRequest(context.Background(), Request{LogContent: contentPointer(content)})
		requireAgentError(t, err, "AGENT_DEPOT_NOT_FOUND", 404, true)
	})

	t.Run("malformed data", func(t *testing.T) {
		paths := tempPaths(t)
		service := New(Options{Paths: paths, Logger: discardLogger()})
		content := callbackLine(t, map[string]any{
			"what":    "DepotInfo",
			"details": map[string]any{"done": true, "data": `{bad json`},
		})
		_, err := service.RecognizeDepotRequest(context.Background(), Request{LogContent: contentPointer(content)})
		requireAgentError(t, err, "AGENT_DEPOT_PARSE_FAILED", 500, true)
	})

	t.Run("empty data", func(t *testing.T) {
		paths := tempPaths(t)
		service := New(Options{Paths: paths, Logger: discardLogger()})
		content := callbackLine(t, map[string]any{
			"what":    "DepotInfo",
			"details": map[string]any{"done": true, "data": `{}`},
		})
		_, err := service.RecognizeDepotRequest(context.Background(), Request{LogContent: contentPointer(content)})
		requireAgentError(t, err, "AGENT_DEPOT_DATA_EMPTY", 422, true)
	})
}

func TestRecognizeOperBoxPersistsAllOpers(t *testing.T) {
	paths := tempPaths(t)
	service := New(Options{Paths: paths, Logger: discardLogger()})

	allOpers := []any{
		map[string]any{"id": "char_002_amiya", "name": "阿米娅", "rarity": 5, "own": true},
		map[string]any{"id": "char_1001_amiya2", "name": "阿米娅", "rarity": 5, "own": false},
		map[string]any{"id": "char_1037_amiya3", "name": "阿米娅", "rarity": 5, "own": false},
	}
	ownOpers := []any{
		map[string]any{"id": "char_002_amiya", "name": "阿米娅", "own": true, "elite": 2, "level": 80, "potential": 5, "rarity": 5},
	}
	content := callbackLine(t, map[string]any{
		"what":    "OperBoxInfo",
		"details": map[string]any{"done": true, "all_opers": allOpers, "own_opers": ownOpers},
	})

	result, err := service.RecognizeOperBoxRequest(context.Background(), Request{LogContent: contentPointer(content)})
	if err != nil {
		t.Fatal(err)
	}
	if result.Data.OperCount != 1 || result.Data.TotalOperCount != 3 {
		t.Fatalf("data = %#v", result.Data)
	}
	if len(result.Data.AllOpers) != 3 || result.Data.AllOpers[1].Own || result.Data.AllOpers[2].Own {
		t.Fatalf("allOpers = %#v", result.Data.AllOpers)
	}
	if result.Data.AllOpers[0].Name != "阿米娅" || result.Data.AllOpers[0].Rarity != 5 {
		t.Fatalf("allOpers[0] = %#v", result.Data.AllOpers[0])
	}

	saved := readRecord(t, filepath.Join(paths.DataDir, "operbox.json"))
	if numberText(saved["operCount"]) != "1" || numberText(saved["totalOperCount"]) != "3" {
		t.Fatalf("saved = %#v", saved)
	}
	savedData, ok := saved["data"].([]any)
	if !ok || len(savedData) != 1 {
		t.Fatalf("saved data = %#v", saved["data"])
	}
	own := savedData[0].(map[string]any)
	if own["elite"] == nil || own["level"] == nil || own["potential"] == nil {
		t.Fatalf("raw own_opers fields dropped: %#v", own)
	}
	savedAll, ok := saved["allOpers"].([]any)
	if !ok || len(savedAll) != 3 {
		t.Fatalf("saved allOpers = %#v", saved["allOpers"])
	}
	unowned := 0
	for _, raw := range savedAll {
		if raw.(map[string]any)["own"] == false {
			unowned++
		}
	}
	if unowned != 2 {
		t.Fatalf("unowned = %d, saved = %#v", unowned, savedAll)
	}
}

func TestRecognizeOperBoxFallsBackToOwnOpers(t *testing.T) {
	paths := tempPaths(t)
	service := New(Options{Paths: paths, Logger: discardLogger()})
	content := callbackLine(t, map[string]any{
		"what": "OperBoxInfo",
		"details": map[string]any{
			"done":      true,
			"own_opers": []any{map[string]any{"id": "char_002_amiya", "name": "阿米娅", "rarity": 5}},
		},
	})
	result, err := service.RecognizeOperBoxRequest(context.Background(), Request{LogContent: contentPointer(content)})
	if err != nil {
		t.Fatal(err)
	}
	if result.Data.TotalOperCount != 1 || !result.Data.AllOpers[0].Own {
		t.Fatalf("data = %#v", result.Data)
	}
}

func TestRecognizeOperBoxErrors(t *testing.T) {
	t.Run("no operbox callback", func(t *testing.T) {
		paths := tempPaths(t)
		service := New(Options{Paths: paths, Logger: discardLogger()})
		content := callbackLine(t, map[string]any{"what": "DepotInfo", "details": map[string]any{}})
		_, err := service.RecognizeOperBoxRequest(context.Background(), Request{LogContent: contentPointer(content)})
		requireAgentError(t, err, "AGENT_OPERBOX_NOT_FOUND", 404, true)
	})

	t.Run("payload without own_opers", func(t *testing.T) {
		paths := tempPaths(t)
		service := New(Options{Paths: paths, Logger: discardLogger()})
		content := callbackLine(t, map[string]any{"what": "OperBoxInfo", "details": map[string]any{"done": true}})
		_, err := service.RecognizeOperBoxRequest(context.Background(), Request{LogContent: contentPointer(content)})
		requireAgentError(t, err, "AGENT_OPERBOX_DATA_EMPTY", 422, true)
	})

	t.Run("incomplete does not overwrite", func(t *testing.T) {
		paths := tempPaths(t)
		service := New(Options{Paths: paths, Logger: discardLogger()})
		content := callbackLine(t, map[string]any{
			"what": "OperBoxInfo",
			"details": map[string]any{
				"done":      false,
				"own_opers": []any{map[string]any{"id": "char_002_amiya"}},
			},
		})
		_, err := service.RecognizeOperBoxRequest(context.Background(), Request{LogContent: contentPointer(content)})
		requireAgentError(t, err, "AGENT_OPERBOX_RECOGNITION_INCOMPLETE", 409, true)
		if jsonstore.Exists(filepath.Join(paths.DataDir, "operbox.json")) {
			t.Fatal("incomplete recognition overwrote operbox.json")
		}
	})

	t.Run("unreadable log", func(t *testing.T) {
		paths := tempPaths(t)
		service := New(Options{Paths: paths, Logger: discardLogger()})
		_, err := service.RecognizeOperBox(context.Background())
		requireAgentError(t, err, "AGENT_OPERBOX_LOG_UNAVAILABLE", 500, true)
	})
}

type fakeLogReader struct {
	content string
	err     error
	paths   []string
}

func (reader *fakeLogReader) ReadLog(_ context.Context, path string) (string, error) {
	reader.paths = append(reader.paths, path)
	return reader.content, reader.err
}

type fakeExecutor struct {
	payloads []Payload
	err      error
	calls    int
}

func (executor *fakeExecutor) Payloads(_ context.Context, _ Task, _ Request) ([]Payload, error) {
	executor.calls++
	return executor.payloads, executor.err
}

func TestInjectedLogReaderAndExecutor(t *testing.T) {
	paths := tempPaths(t)
	content := callbackLine(t, map[string]any{
		"what":    "DepotInfo",
		"details": map[string]any{"done": true, "data": `{"2001":3}`},
	})

	reader := &fakeLogReader{content: content}
	service := New(Options{Paths: paths, LogReader: reader, Logger: discardLogger()})
	result, err := service.RecognizeDepotRequest(context.Background(), Request{LogPath: "/custom/asst.log"})
	if err != nil {
		t.Fatal(err)
	}
	if len(reader.paths) != 1 || reader.paths[0] != "/custom/asst.log" {
		t.Fatalf("read paths = %#v", reader.paths)
	}
	if result.Data.ItemCount != 1 || result.Written != true {
		t.Fatalf("result = %#v", result)
	}

	executor := &fakeExecutor{payloads: ExtractCallbackPayloads(content, string(TaskDepot))}
	executorService := New(Options{Paths: paths, Executor: executor, Logger: discardLogger()})
	if _, err := executorService.RecognizeDepot(context.Background()); err != nil {
		t.Fatal(err)
	}
	if executor.calls != 1 {
		t.Fatalf("executor calls = %d", executor.calls)
	}
	if _, err := executorService.RecognizeDepotRequest(context.Background(), Request{Payloads: ExtractCallbackPayloads(content, string(TaskDepot))}); err != nil {
		t.Fatal(err)
	}
	if executor.calls != 1 {
		t.Fatalf("direct payloads used the executor: calls = %d", executor.calls)
	}

	failing := New(Options{Paths: paths, Executor: &fakeExecutor{err: errors.New("boom")}, Logger: discardLogger()})
	_, err = failing.RecognizeDepot(context.Background())
	requireAgentError(t, err, "AGENT_DEPOT_LOG_UNAVAILABLE", 500, true)
}

func TestGetAllOperators(t *testing.T) {
	paths := tempPaths(t)
	writeFixture(t, filepath.Join(paths.MaaDataDir, "resource", "battle_data.json"), `{
		"chars": {
			"char_291_gladii": {"name":"Z","rarity":6,"profession":"PIONEER","position":"MELEE"},
			"char_002_amiya": {"name":"阿米娅","rarity":5,"profession":"CASTER","position":"RANGED"},
			"char_1037_amiya3": {"name":"阿米娅近卫","rarity":5,"profession":"WARRIOR","position":"MELEE"},
			"char_500_noirc": {"name":"预备干员","rarity":1},
			"char_600_test": {"name":"预备干员2","rarity":1},
			"token_10000": {"name":"陷阱","rarity":1},
			"char_199_empty": {"name":"","rarity":4,"profession":null}
		}
	}`)
	service := New(Options{Paths: paths, Logger: discardLogger()})

	operators, err := service.GetAllOperators()
	if err != nil {
		t.Fatal(err)
	}
	if len(operators) != 4 {
		t.Fatalf("operators = %#v", operators)
	}
	if operators[0].ID != "char_291_gladii" || operators[0].Rarity != 6 {
		t.Fatalf("operators[0] = %#v", operators[0])
	}
	for _, operator := range operators {
		if operator.ID == "char_500_noirc" || operator.ID == "char_600_test" || operator.ID == "token_10000" {
			t.Fatalf("excluded operator retained: %#v", operator)
		}
		if operator.ID == "char_199_empty" && (operator.Name != "char_199_empty" || operator.Profession != nil) {
			t.Fatalf("empty name fallback = %#v", operator)
		}
	}

	_, err = New(Options{Paths: tempPaths(t), Logger: discardLogger()}).GetAllOperators()
	requireAgentError(t, err, "AGENT_OPERATOR_CATALOG_UNAVAILABLE", 500, false)
}
