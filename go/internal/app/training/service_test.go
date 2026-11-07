package training

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func fixedNow() time.Time {
	// Monday 2026-11-09 12:00 UTC; the +8 game zone and 04:00 boundary keep it
	// Monday, which makes resource-stage assertions deterministic.
	value, _ := time.Parse(time.RFC3339, "2026-11-09T12:00:00Z")
	return value
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	return NewWithOptions(Options{
		Paths: config.Paths{
			DataDir:     t.TempDir(),
			MaaDataDir:  t.TempDir(),
			MaaCacheDir: t.TempDir(),
		},
		Logger: testLogger(),
		Now:    fixedNow,
	})
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	if err := jsonstore.Write(path, value, true); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func fixtureResourceDir(t *testing.T, service *Service) string {
	return filepath.Join(service.paths.MaaDataDir, "resource")
}

func writeTrainingFixtures(t *testing.T, service *Service) {
	t.Helper()
	dataDir := service.paths.DataDir
	resourceDir := fixtureResourceDir(t, service)

	writeJSON(t, filepath.Join(dataDir, "operator-materials.json"), map[string]any{
		"operators": map[string]any{
			"char_alpha": map[string]any{
				"id":         "char_alpha",
				"name":       "测试干员",
				"rarity":     6,
				"profession": "术师",
				"elite1": map[string]any{
					"lmd": 0,
					"materials": []any{
						map[string]any{"id": "30012", "name": "固源岩", "count": 2},
					},
				},
				"elite2": map[string]any{
					"lmd": 0,
					"materials": []any{
						map[string]any{"id": "30013", "name": "固源岩组", "count": 3},
					},
					"chips": []any{
						map[string]any{"id": "3251", "name": "术师芯片", "count": 4},
					},
				},
			},
		},
		"metadata": map[string]any{"source": "test"},
	})

	writeJSON(t, filepath.Join(resourceDir, "item_index.json"), map[string]any{
		"30011": map[string]any{
			"name": "源岩",
			"bestStages": []any{
				map[string]any{"stage": "1-7", "efficiency": 1},
			},
		},
		"30012": map[string]any{
			"name":    "固源岩",
			"formula": map[string]any{"30011": 2},
		},
		"30013": map[string]any{
			"name":    "固源岩组",
			"formula": map[string]any{"30012": 3},
		},
		"3251": map[string]any{
			"name": "术师芯片",
		},
		"3252": map[string]any{
			"name":    "术师芯片组",
			"formula": map[string]any{"3251": 2},
		},
	})

	writeJSON(t, filepath.Join(resourceDir, "battle_data.json"), map[string]any{
		"chars": map[string]any{
			"char_alpha": map[string]any{
				"name": "测试干员", "rarity": 6, "profession": "术师", "position": "远程",
			},
			"char_beta": map[string]any{
				"name": "贝塔", "rarity": 4, "profession": "近卫",
			},
			"char_501_reserve": map[string]any{
				"name": "预备干员", "rarity": 1, "profession": "近卫",
			},
		},
	})

	writeJSON(t, filepath.Join(dataDir, "operbox.json"), map[string]any{
		"data": []any{
			map[string]any{
				"id": "char_alpha", "name": "测试干员", "rarity": 6, "profession": "术师",
				"elite": 0, "level": 50, "potential": 3, "own": true,
			},
		},
		"allOpers": []any{
			map[string]any{"id": "char_alpha", "name": "测试干员", "rarity": 6, "own": true},
			map[string]any{"id": "char_gamma", "name": "伽马", "rarity": 5, "own": true},
			map[string]any{"id": "char_beta", "name": "贝塔", "rarity": 4, "own": false},
		},
	})

	writeJSON(t, filepath.Join(dataDir, "depot.json"), map[string]any{
		"items": []any{
			map[string]any{"id": "30011", "count": 5},
			map[string]any{"id": "4001", "count": 100},
		},
		"timestamp": "2026-11-07T02:43:00.810Z",
	})

	writeJSON(t, filepath.Join(dataDir, "user-configs", "training-queue.json"), map[string]any{
		"queue": []any{
			map[string]any{
				"operatorId": "char_alpha", "currentElite": 0, "targetElite": 2,
				"priority": 1, "status": "pending", "addedAt": "2026-10-27T12:07:14.195Z",
			},
		},
		"settings": map[string]any{
			"autoSwitch": true, "autoAddRecognizedSixStars": true,
			"notifyOnComplete": false, "useMedicine": 2, "useStone": 1,
		},
		"lastUpdated": "2026-10-27T12:07:14.195Z",
	})

	writeJSON(t, filepath.Join(dataDir, "user-configs", "automation-tasks.json"), map[string]any{
		"taskFlow": []any{
			map[string]any{"id": "startup-1", "commandId": "startup", "params": map[string]any{}},
			map[string]any{
				"id": "fight-1", "name": "理智作战", "commandId": "fight", "enabled": true,
				"params": map[string]any{
					"stage": "1-7",
					"stages": []any{
						map[string]any{"stage": "PINNED", "times": "1", "pinned": true},
						map[string]any{"stage": "SMART-OLD", "times": "5", "smart": true},
						map[string]any{"stage": "NORMAL", "times": "2"},
					},
					"medicine": 0, "expiringMedicine": 0, "stone": 0, "series": "3", "server": "",
				},
			},
		},
		"schedule":   map[string]any{"enabled": false, "times": []any{}},
		"customRoot": "keep",
	})
}

func decodeJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	value, err := jsonstore.Read(path, nil)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s is not an object", path)
	}
	return record
}

func errorCode(err error) string {
	if appErr, ok := apperrors.As(err); ok {
		return appErr.Code
	}
	return ""
}

func TestGetTrainingQueueEmpty(t *testing.T) {
	service := newTestService(t)
	result, err := service.GetTrainingQueue()
	if err != nil {
		t.Fatal(err)
	}
	if result.Queue == nil || len(result.Queue) != 0 {
		t.Fatalf("expected empty queue slice, got %#v", result.Queue)
	}
	if result.Settings["autoSwitch"] != true || result.Settings["notifyOnComplete"] != true {
		t.Fatalf("unexpected default settings: %#v", result.Settings)
	}
	medicine, ok := toFiniteNumber(result.Settings["useMedicine"])
	if !ok || medicine != 0 {
		t.Fatalf("unexpected useMedicine: %#v", result.Settings["useMedicine"])
	}
	if result.LastUpdated == "" {
		t.Fatal("expected lastUpdated")
	}

	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatal(err)
	}
	if queue, ok := payload["queue"].([]any); !ok || len(queue) != 0 {
		t.Fatalf("queue must serialize as [], got %s", encoded)
	}
}

func TestGetTrainingQueueEnrichesItems(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)

	result, err := service.GetTrainingQueue()
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Queue) != 1 {
		t.Fatalf("expected one enriched item, got %d", len(result.Queue))
	}
	item := result.Queue[0]
	if item.Operator.ID != "char_alpha" || item.Operator.Name != "测试干员" {
		t.Fatalf("unexpected operator summary: %+v", item.Operator)
	}
	if item.Operator.Profession == nil || *item.Operator.Profession != "术师" {
		t.Fatalf("unexpected profession: %+v", item.Operator.Profession)
	}
	if len(item.Materials) != 3 {
		t.Fatalf("expected three materials, got %+v", item.Materials)
	}
	if item.Materials[0].ID != "30012" || item.Materials[0].Needed != 2 || item.Materials[0].StillNeeded != 2 {
		t.Fatalf("unexpected first material: %+v", item.Materials[0])
	}
	if item.Materials[2].ID != "3251" || item.Materials[2].Needed != 4 {
		t.Fatalf("unexpected last material: %+v", item.Materials[2])
	}
	if item.LMD.Needed != 260000 || item.LMD.Have != 100 || item.LMD.StillNeeded != 259900 {
		t.Fatalf("unexpected LMD: %+v", item.LMD)
	}
	if item.IsComplete || item.Progress != 0 {
		t.Fatalf("expected incomplete progress 0, got complete=%v progress=%d", item.IsComplete, item.Progress)
	}
	if result.LastUpdated != "2026-10-27T12:07:14.195Z" {
		t.Fatalf("queue should not be rewritten, got lastUpdated %s", result.LastUpdated)
	}
	if result.Settings["autoAddRecognizedSixStars"] != true {
		t.Fatalf("unknown settings key was lost: %#v", result.Settings)
	}
}

func TestGetTrainingQueueRewritesStaleElite(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)
	queuePath := filepath.Join(service.paths.DataDir, "user-configs", "training-queue.json")
	writeJSON(t, queuePath, map[string]any{
		"queue": []any{
			map[string]any{"operatorId": "char_alpha", "currentElite": "2", "targetElite": 2},
		},
		"settings":    map[string]any{},
		"lastUpdated": "2026-01-01T00:00:00.000Z",
	})

	result, err := service.GetTrainingQueue()
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Queue) != 1 || result.Queue[0].CurrentElite != float64(0) {
		t.Fatalf("expected elite normalized to owned 0, got %+v", result.Queue)
	}
	if result.LastUpdated != formatISO(fixedNow()) {
		t.Fatalf("expected queue rewrite timestamp, got %s", result.LastUpdated)
	}
	persisted := decodeJSON(t, queuePath)
	queue := persisted["queue"].([]any)
	item := queue[0].(map[string]any)
	if number, ok := item["currentElite"].(json.Number); !ok || number.String() != "0" {
		t.Fatalf("expected persisted numeric 0, got %#v", item["currentElite"])
	}
}

func TestGetOperatorListAndCounts(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)

	operators, err := service.GetOperatorList(OperatorFilters{})
	if err != nil {
		t.Fatal(err)
	}
	if len(operators) != 3 {
		t.Fatalf("expected 3 catalog operators, got %d: %+v", len(operators), operators)
	}
	if operators[0].ID != "char_alpha" || !operators[0].CanTrain {
		t.Fatalf("expected trainable alpha first, got %+v", operators[0])
	}
	if operators[0].Position == nil || *operators[0].Position != "远程" {
		t.Fatalf("expected position from battle data, got %+v", operators[0].Position)
	}
	if operators[1].ID != "char_gamma" || !operators[1].Owned || operators[1].TrainingStatus != "missing_material_data" {
		t.Fatalf("expected owned gamma second, got %+v", operators[1])
	}
	if operators[2].ID != "char_beta" || operators[2].Owned {
		t.Fatalf("expected unowned beta last, got %+v", operators[2])
	}
	for _, operator := range operators {
		if operator.ID == "char_501_reserve" {
			t.Fatal("reserve operator must be filtered")
		}
	}

	trainable, err := service.GetOperatorList(OperatorFilters{Status: "trainable"})
	if err != nil {
		t.Fatal(err)
	}
	if len(trainable) != 1 || trainable[0].ID != "char_alpha" {
		t.Fatalf("unexpected trainable filter: %+v", trainable)
	}
	rarity := 4
	byRarity, err := service.GetOperatorList(OperatorFilters{Status: "all", Rarity: &rarity})
	if err != nil {
		t.Fatal(err)
	}
	if len(byRarity) != 1 || byRarity[0].ID != "char_beta" {
		t.Fatalf("unexpected rarity filter: %+v", byRarity)
	}

	counts, err := service.GetOperatorCounts(nil)
	if err != nil {
		t.Fatal(err)
	}
	if counts.All != 3 || counts.Owned != 2 || counts.Trainable != 1 {
		t.Fatalf("unexpected counts: %+v", counts)
	}

	rarityFive := 5
	counts, err = service.GetOperatorCounts(&rarityFive)
	if err != nil {
		t.Fatal(err)
	}
	if counts.All != 1 || counts.Owned != 1 || counts.Trainable != 0 {
		t.Fatalf("unexpected rarity counts: %+v", counts)
	}
}

func TestGenerateTrainingPlanCurrent(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)

	plan, err := service.GenerateTrainingPlan("current", "Official")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Operators) != 1 || plan.Operators[0].ID != "char_alpha" {
		t.Fatalf("unexpected operators: %+v", plan.Operators)
	}
	if len(plan.MaterialHierarchy) != 2 {
		t.Fatalf("expected expanded hierarchy of 2, got %+v", plan.MaterialHierarchy)
	}
	if plan.MaterialHierarchy[0].ID != "30011" || plan.MaterialHierarchy[0].Needed != 13 ||
		plan.MaterialHierarchy[0].Have != 5 || plan.MaterialHierarchy[0].StillNeeded != 13 {
		t.Fatalf("unexpected hierarchy node: %+v", plan.MaterialHierarchy[0])
	}
	if plan.MaterialHierarchy[1].ID != "3251" || plan.MaterialHierarchy[1].Needed != 4 {
		t.Fatalf("unexpected chip node: %+v", plan.MaterialHierarchy[1])
	}
	if len(plan.Stages) != 2 {
		t.Fatalf("expected two stages, got %+v", plan.Stages)
	}
	stage := plan.Stages[0]
	if stage.Stage != "1-7" || stage.TotalTimes == nil || *stage.TotalTimes != 26 || stage.Sanity != 468 {
		t.Fatalf("unexpected 1-7 stage: %+v", stage)
	}
	chipStage := plan.Stages[1]
	if chipStage.Stage != "PR-B-1" || chipStage.TotalTimes == nil || *chipStage.TotalTimes != 8 || chipStage.Sanity != 144 {
		t.Fatalf("unexpected chip stage: %+v", chipStage)
	}
	if plan.TotalSanity != 612 {
		t.Fatalf("unexpected total sanity: %d", plan.TotalSanity)
	}
	if plan.EstimatedTime == nil || *plan.EstimatedTime != 153 {
		t.Fatalf("unexpected estimated time: %+v", plan.EstimatedTime)
	}
	if plan.Mode != "current" || plan.FocusOperator == nil || plan.FocusOperator.ID != "char_alpha" {
		t.Fatalf("unexpected plan metadata: mode=%q focus=%+v", plan.Mode, plan.FocusOperator)
	}
	if plan.OpenStages == nil || len(*plan.OpenStages) != 2 || plan.ClosedStages == nil || len(*plan.ClosedStages) != 0 {
		t.Fatalf("unexpected open/closed stages: open=%+v closed=%+v", plan.OpenStages, plan.ClosedStages)
	}
	if plan.Summary == nil || plan.Summary.OpenStageCount != 2 || plan.Summary.ClosedStageCount != 0 ||
		plan.Summary.BacklogCount != 0 {
		t.Fatalf("unexpected summary: %+v", plan.Summary)
	}
	if len(plan.Summary.TodayOpenResourceStages) != 5 || len(plan.Summary.TodayClosedResourceStages) != 4 {
		t.Fatalf("unexpected resource stage summary: open=%+v closed=%+v",
			plan.Summary.TodayOpenResourceStages, plan.Summary.TodayClosedResourceStages)
	}
	if plan.Warnings == nil || len(plan.Warnings) != 0 {
		t.Fatalf("expected empty warning list, got %#v", plan.Warnings)
	}
}

func TestGenerateTrainingPlanEmptyQueue(t *testing.T) {
	service := newTestService(t)
	_, err := service.GenerateTrainingPlan("current", "Official")
	if err == nil {
		t.Fatal("expected empty-queue error")
	}
	if code := errorCode(err); code != "AGENT_TRAINING_QUEUE_EMPTY" {
		t.Fatalf("unexpected error code: %s", code)
	}
	if appErr, ok := apperrors.As(err); !ok || appErr.StatusCode != 400 {
		t.Fatalf("expected 400 validation error, got %+v", err)
	}
}

func TestGenerateTrainingPlanAlreadyComplete(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)
	writeJSON(t, filepath.Join(service.paths.DataDir, "operator-materials.json"), map[string]any{
		"operators": map[string]any{"char_alpha": map[string]any{
			"id": "char_alpha", "name": "测试干员", "rarity": 6, "profession": "术师",
		}},
	})

	plan, err := service.GenerateTrainingPlan("all", "Official")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Operators) != 0 || len(plan.Stages) != 0 || plan.TotalSanity != 0 {
		t.Fatalf("expected empty plan, got %+v", plan)
	}
	if plan.Materials == nil || len(*plan.Materials) != 0 {
		t.Fatalf("expected materials: [], got %+v", plan.Materials)
	}
	if len(plan.Warnings) != 1 || plan.Warnings[0] != "所有干员的材料已集齐！" {
		t.Fatalf("unexpected warnings: %#v", plan.Warnings)
	}
	if plan.Mode != "" || plan.Summary != nil {
		t.Fatalf("completed branch must omit mode/summary, got mode=%q summary=%+v", plan.Mode, plan.Summary)
	}
	encoded, _ := json.Marshal(plan)
	var payload map[string]any
	_ = json.Unmarshal(encoded, &payload)
	if _, exists := payload["mode"]; exists {
		t.Fatalf("mode should be omitted: %s", encoded)
	}
	if _, exists := payload["summary"]; exists {
		t.Fatalf("summary should be omitted: %s", encoded)
	}
	if _, exists := payload["openStages"]; exists {
		t.Fatalf("openStages should be omitted: %s", encoded)
	}
}

func TestExpandMaterialTree(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)
	database := service.loadMaterialsDatabase()
	depot := service.loadDepot()

	farmable := map[string]float64{}
	order := make([]string, 0)
	service.expandMaterialTree("30013", 3, depot.Items, database, farmable, &order)
	if len(order) != 1 || order[0] != "30011" || farmable["30011"] != 13 {
		t.Fatalf("unexpected expansion: order=%v farmable=%v", order, farmable)
	}

	chipPacks := map[string]float64{}
	chipOrder := make([]string, 0)
	service.expandMaterialTree("3252", 2, depot.Items, database, chipPacks, &chipOrder)
	if len(chipOrder) != 1 || chipOrder[0] != "3252" || chipPacks["3252"] != 2 {
		t.Fatalf("chip pack must not expand: order=%v farmable=%v", chipOrder, chipPacks)
	}

	covered := map[string]float64{}
	coveredOrder := make([]string, 0)
	service.expandMaterialTree("3251", 0, depot.Items, database, covered, &coveredOrder)
	if len(coveredOrder) != 0 || len(covered) != 0 {
		t.Fatalf("zero need must not farm: %v", covered)
	}
}

func TestAddToQueueValidation(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)
	writeJSON(t, filepath.Join(service.paths.DataDir, "user-configs", "training-queue.json"), map[string]any{
		"queue": []any{}, "settings": map[string]any{}, "lastUpdated": "2026-01-01T00:00:00.000Z",
	})

	_, err := service.AddToQueue("char_missing", AddToQueueOptions{})
	if code := errorCode(err); code != "AGENT_TRAINING_OPERATOR_MATERIALS_MISSING" {
		t.Fatalf("unexpected missing-material code: %v", err)
	}

	item, err := service.AddToQueue("char_alpha", AddToQueueOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if item.CurrentElite != float64(0) || item.TargetElite != float64(2) || item.Priority != 1 || item.Status != "pending" {
		t.Fatalf("unexpected queue item: %+v", item)
	}

	_, err = service.AddToQueue("char_alpha", AddToQueueOptions{})
	if code := errorCode(err); code != "AGENT_TRAINING_QUEUE_DUPLICATE" {
		t.Fatalf("unexpected duplicate code: %v", err)
	}

	persisted := decodeJSON(t, filepath.Join(service.paths.DataDir, "user-configs", "training-queue.json"))
	queue := persisted["queue"].([]any)
	if len(queue) != 1 {
		t.Fatalf("expected persisted duplicate-free queue, got %v", queue)
	}

	err = service.RemoveFromQueue("char_missing")
	if code := errorCode(err); code != "AGENT_TRAINING_QUEUE_ITEM_NOT_FOUND" {
		t.Fatalf("unexpected missing-item code: %v", err)
	}
}

func TestAddToQueueDefaultsAndOrder(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)
	writeJSON(t, filepath.Join(service.paths.DataDir, "user-configs", "training-queue.json"), map[string]any{
		"queue": []any{}, "settings": map[string]any{}, "lastUpdated": "2026-01-01T00:00:00.000Z",
	})

	item, err := service.AddToQueue("char_alpha", AddToQueueOptions{TargetElite: float64(1)})
	if err != nil {
		t.Fatal(err)
	}
	if item.CurrentElite != float64(0) || item.TargetElite != float64(1) || item.Priority != 1 {
		t.Fatalf("unexpected defaults: %+v", item)
	}

	err = service.UpdateQueueOrder([]string{"char_alpha"})
	if err != nil {
		t.Fatal(err)
	}
	persisted := decodeJSON(t, filepath.Join(service.paths.DataDir, "user-configs", "training-queue.json"))
	queue := persisted["queue"].([]any)
	if len(queue) != 1 || queue[0].(map[string]any)["priority"] != json.Number("1") {
		t.Fatalf("unexpected order persistence: %v", persisted["queue"])
	}
}

func TestUpdateSettings(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)
	writeJSON(t, filepath.Join(service.paths.DataDir, "user-configs", "training-queue.json"), map[string]any{
		"queue":       []any{},
		"settings":    map[string]any{"notify": true, "autoAddRecognizedSixStars": true},
		"lastUpdated": "2026-01-01T00:00:00.000Z",
	})

	settings, err := service.UpdateSettings(map[string]any{
		"autoAddRecognizedSixStars": false,
		"useMedicine":               float64(3),
	})
	if err != nil {
		t.Fatal(err)
	}
	if settings["notifyOnComplete"] != true {
		t.Fatalf("legacy notify flag was not migrated: %#v", settings)
	}
	if _, exists := settings["notify"]; exists {
		t.Fatalf("notify should be deleted: %#v", settings)
	}
	if settings["autoAddRecognizedSixStars"] != false {
		t.Fatalf("unknown setting was not preserved: %#v", settings)
	}
	if medicine, _ := toFiniteNumber(settings["useMedicine"]); medicine != 3 {
		t.Fatalf("unexpected useMedicine: %#v", settings["useMedicine"])
	}
	if settings["autoSwitch"] != true {
		t.Fatalf("default autoSwitch was lost: %#v", settings)
	}

	persisted := decodeJSON(t, filepath.Join(service.paths.DataDir, "user-configs", "training-queue.json"))
	persistedSettings := persisted["settings"].(map[string]any)
	if _, exists := persistedSettings["notify"]; exists {
		t.Fatalf("persisted settings kept legacy notify: %v", persistedSettings)
	}
}

func TestRemoveFromQueueClearsSmartStages(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)

	if err := service.RemoveFromQueue("char_alpha"); err != nil {
		t.Fatal(err)
	}

	queue := decodeJSON(t, filepath.Join(service.paths.DataDir, "user-configs", "training-queue.json"))
	if items := queue["queue"].([]any); len(items) != 0 {
		t.Fatalf("expected empty queue, got %v", items)
	}

	config := decodeJSON(t, filepath.Join(service.paths.DataDir, "user-configs", "automation-tasks.json"))
	fight := config["taskFlow"].([]any)[1].(map[string]any)
	stages := fight["params"].(map[string]any)["stages"].([]any)
	if len(stages) != 2 {
		t.Fatalf("expected pinned + normal stages, got %v", stages)
	}
	for _, raw := range stages {
		stage := raw.(map[string]any)
		if stage["smart"] == true {
			t.Fatalf("smart stage survived: %v", stage)
		}
	}
	if config["customRoot"] != "keep" {
		t.Fatalf("unrelated config was lost: %v", config)
	}
}

func TestApplyPlanToTasks(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)
	plan, err := service.GenerateTrainingPlan("current", "Official")
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.ApplyPlanToTasks(plan, map[string]any{
		"useMedicine":   float64(2),
		"useStone":      float64(1),
		"fallbackStage": "CE-6",
		"fallbackTimes": float64(5),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.StageCount != 3 || result.TotalStages != 5 || !result.HasFallback {
		t.Fatalf("unexpected result: %+v", result)
	}

	config := decodeJSON(t, filepath.Join(service.paths.DataDir, "user-configs", "automation-tasks.json"))
	if config["customRoot"] != "keep" {
		t.Fatalf("unrelated root key lost: %v", config)
	}
	fight := config["taskFlow"].([]any)[1].(map[string]any)
	params := fight["params"].(map[string]any)
	stages := params["stages"].([]any)
	if len(stages) != 5 {
		t.Fatalf("expected five stages, got %v", stages)
	}
	expectedStages := []string{"PINNED", "1-7", "PR-B-1", "CE-6", "NORMAL"}
	for index, expected := range expectedStages {
		stage := stages[index].(map[string]any)
		if stage["stage"] != expected {
			t.Fatalf("stage %d: expected %s, got %v", index, expected, stage["stage"])
		}
	}
	if times := stages[1].(map[string]any)["times"]; times != "26" {
		t.Fatalf("unexpected smart times: %v", times)
	}
	if times := stages[2].(map[string]any)["times"]; times != "8" {
		t.Fatalf("unexpected chip times: %v", times)
	}
	if times := stages[3].(map[string]any)["times"]; times != "5" {
		t.Fatalf("unexpected fallback times: %v", times)
	}
	operators := stages[1].(map[string]any)["trainingOperators"].([]any)
	if len(operators) != 1 || operators[0] != "测试干员" {
		t.Fatalf("unexpected trainingOperators: %v", operators)
	}
	if params["medicine"] != json.Number("2") && params["medicine"] != float64(2) {
		t.Fatalf("unexpected medicine: %#v", params["medicine"])
	}
	if params["expiringMedicine"] != json.Number("0") && params["expiringMedicine"] != float64(0) {
		t.Fatalf("unexpected expiringMedicine: %#v", params["expiringMedicine"])
	}
	if params["series"] != "3" {
		t.Fatalf("series should be preserved: %#v", params["series"])
	}
	if params["server"] != "" {
		t.Fatalf("unknown params should be preserved: %#v", params["server"])
	}
}

func TestApplyPlanToTasksFiltersStages(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)
	zero := 0.0
	three := 3.0
	four := 4.0
	two := 2.0
	plan := TrainingPlan{
		Stages: []TrainingStage{
			{Stage: "A", TotalTimes: &three, IsOpen: true},
			{Stage: "B", TotalTimes: &zero, IsOpen: true},
			{Stage: "C", TotalTimes: &two, IsOpen: false},
			{Stage: "D", Times: &four},
			{Stage: "", TotalTimes: &three},
		},
	}

	result, err := service.ApplyPlanToTasks(plan, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if result.StageCount != 2 {
		t.Fatalf("expected two applicable stages, got %+v", result)
	}
	config := decodeJSON(t, filepath.Join(service.paths.DataDir, "user-configs", "automation-tasks.json"))
	fight := config["taskFlow"].([]any)[1].(map[string]any)
	stages := fight["params"].(map[string]any)["stages"].([]any)
	var smart []map[string]any
	for _, raw := range stages {
		stage := raw.(map[string]any)
		if stage["smart"] == true {
			smart = append(smart, stage)
		}
	}
	if len(smart) != 2 || smart[0]["stage"] != "A" || smart[1]["stage"] != "D" {
		t.Fatalf("unexpected smart stages: %v", smart)
	}
}

func TestApplyPlanCreatesFightTask(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)
	writeJSON(t, filepath.Join(service.paths.DataDir, "user-configs", "automation-tasks.json"), map[string]any{
		"taskFlow": []any{
			map[string]any{"id": "startup-1", "commandId": "startup"},
		},
	})

	two := 2.0
	plan := TrainingPlan{Stages: []TrainingStage{{Stage: "1-7", TotalTimes: &two}}}
	result, err := service.ApplyPlanToTasks(plan, map[string]any{"useMedicine": float64(1)})
	if err != nil {
		t.Fatal(err)
	}
	if result.TotalStages != 1 || result.StageCount != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	config := decodeJSON(t, filepath.Join(service.paths.DataDir, "user-configs", "automation-tasks.json"))
	taskFlow := config["taskFlow"].([]any)
	if len(taskFlow) != 2 {
		t.Fatalf("expected a new fight task, got %v", taskFlow)
	}
	fight := taskFlow[1].(map[string]any)
	if fight["commandId"] != "fight" || fight["name"] != "理智作战" || fight["enabled"] != true {
		t.Fatalf("unexpected fight task: %v", fight)
	}
	params := fight["params"].(map[string]any)
	if medicine, _ := toFiniteNumber(params["medicine"]); medicine != 1 {
		t.Fatalf("unexpected medicine: %v", params["medicine"])
	}
	if params["stage"] != "1-7" {
		t.Fatalf("unexpected default stage: %v", params["stage"])
	}
}

func TestResourceCollectionOpenAllStages(t *testing.T) {
	service := newTestService(t)
	writeTrainingFixtures(t, service)
	writeJSON(t, filepath.Join(service.paths.MaaCacheDir, "StageActivityV2.json"), map[string]any{
		"Official": map[string]any{
			"resourceCollection": map[string]any{
				"IsResourceCollection": true,
				"UtcStartTime":         "2026/11/01 04:00:00",
				"UtcExpireTime":        "2026/12/01 04:00:00",
				"TimeZone":             8,
			},
		},
	})

	plan, err := service.GenerateTrainingPlan("current", "Official")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Summary == nil {
		t.Fatal("missing summary")
	}
	if len(plan.Summary.TodayOpenResourceStages) != 9 || len(plan.Summary.TodayClosedResourceStages) != 0 {
		t.Fatalf("resource collection window should open every stage: open=%d closed=%d",
			len(plan.Summary.TodayOpenResourceStages), len(plan.Summary.TodayClosedResourceStages))
	}
}

func TestFetchOperatorMaterialsUnsupported(t *testing.T) {
	service := newTestService(t)
	_, err := service.FetchOperatorMaterials(context.Background())
	appErr, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("expected application error, got %v", err)
	}
	if appErr.Code != "TRAINING_MATERIAL_FETCH_UNSUPPORTED" {
		t.Fatalf("unexpected code: %s", appErr.Code)
	}
	if appErr.StatusCode != 501 || appErr.Retryable {
		t.Fatalf("unexpected error metadata: %+v", appErr)
	}
	scripts, ok := appErr.Details["scripts"].([]string)
	if !ok || len(scripts) != 4 {
		t.Fatalf("expected four scripts in details: %#v", appErr.Details)
	}
	if appErr.Details["todo"] == "" {
		t.Fatal("expected TODO detail")
	}
}

func TestFetchOperatorMaterialsDelegates(t *testing.T) {
	fetcher := stubFetcher{response: FetchMaterialsResponse{
		Success: true,
		Scripts: []FetchMaterialScriptResult{{Script: "fetch-all-materials.ts", OK: true}},
	}}
	service := NewWithOptions(Options{
		Paths:   config.Paths{DataDir: t.TempDir()},
		Logger:  testLogger(),
		Now:     fixedNow,
		Fetcher: fetcher,
	})
	result, err := service.FetchOperatorMaterials(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || len(result.Scripts) != 1 {
		t.Fatalf("unexpected delegated result: %+v", result)
	}
}

type stubFetcher struct {
	response FetchMaterialsResponse
}

func (f stubFetcher) FetchOperatorMaterials(context.Context) (FetchMaterialsResponse, error) {
	return f.response, nil
}

func TestGetOperatorListFallsBackToOperBox(t *testing.T) {
	service := newTestService(t)
	writeJSON(t, filepath.Join(service.paths.DataDir, "operbox.json"), map[string]any{
		"data": []any{
			map[string]any{"id": "char_only", "name": "仅识别", "rarity": 4, "profession": "狙击", "elite": 1, "level": 10},
		},
	})
	operators, err := service.GetOperatorList(OperatorFilters{})
	if err != nil {
		t.Fatal(err)
	}
	if len(operators) != 1 || operators[0].ID != "char_only" {
		t.Fatalf("unexpected fallback list: %+v", operators)
	}
	if operators[0].CurrentElite != 1 || operators[0].CurrentLevel != 10 || !operators[0].Owned {
		t.Fatalf("unexpected fallback fields: %+v", operators[0])
	}
	if operators[0].TrainingStatus != "missing_material_data" {
		t.Fatalf("expected missing material status, got %s", operators[0].TrainingStatus)
	}
}
