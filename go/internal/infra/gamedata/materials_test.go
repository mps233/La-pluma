package gamedata

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

func TestParseMaterials(t *testing.T) {
	itemTable := map[string]any{
		"items": map[string]any{
			"30012": map[string]any{
				"name":         "固源岩",
				"rarity":       json.Number("1"),
				"itemType":     "MATERIAL",
				"classifyType": "MATERIAL",
				"stageDropList": []any{
					map[string]any{"stageId": "1-7", "occPer": json.Number("1234")},
					map[string]any{"stageId": "1-8", "occPer": json.Number("0")},
					"not-a-record",
					map[string]any{"stageId": "1-9", "occPer": json.Number("9999")},
				},
			},
			"30013": map[string]any{
				"name":         "固源岩组",
				"rarity":       json.Number("2"),
				"itemType":     "MATERIAL",
				"classifyType": "MATERIAL",
				"stageDropList": []any{
					map[string]any{"stageId": "S3-1", "occPer": json.Number("99")},
					map[string]any{"stageId": "", "occPer": json.Number("100")},
					map[string]any{"stageId": "S3-2", "occPer": json.Number("50")},
					map[string]any{"stageId": "S3-3", "occPer": json.Number("100")},
				},
			},
			"4001": map[string]any{
				"name":         "龙门币",
				"itemType":     "MATERIAL",
				"classifyType": "MATERIAL",
			},
			"char_1": map[string]any{
				"name":         "干员",
				"itemType":     "CHARACTER",
				"classifyType": "MATERIAL",
			},
			"bad_type": "not-a-record",
		},
	}

	materials := ParseMaterials(itemTable)
	if len(materials) != 3 {
		t.Fatalf("materials = %d, want 3", len(materials))
	}

	rock := materials["30012"]
	if rock.ID != "30012" || rock.Name != "固源岩" || rock.Rarity != 1 {
		t.Fatalf("rock = %#v", rock)
	}
	if len(rock.BestStages) != 1 {
		t.Fatalf("rock bestStages = %#v", rock.BestStages)
	}
	if rock.BestStages[0].Stage != "1-7" || rock.BestStages[0].Efficiency != 1 || rock.BestStages[0].DropRate != 0.1234 {
		t.Fatalf("rock stage = %#v", rock.BestStages[0])
	}

	group := materials["30013"]
	if group.Rarity != 2 || len(group.BestStages) != 2 {
		t.Fatalf("group = %#v", group)
	}
	if group.BestStages[0].Stage != "S3-1" || group.BestStages[0].DropRate != 0.0099 {
		t.Fatalf("group first = %#v", group.BestStages[0])
	}
	if group.BestStages[1].Stage != "S3-2" || group.BestStages[1].DropRate != 0.005 {
		t.Fatalf("group second = %#v", group.BestStages[1])
	}

	lmd := materials["4001"]
	if len(lmd.BestStages) != 0 {
		t.Fatalf("lmd stages = %#v", lmd.BestStages)
	}
}

func TestBuildMaterialsFilePreservesSections(t *testing.T) {
	existing := map[string]any{
		"materials":     map[string]any{"old": "value"},
		"recipes":       map[string]any{"30135": map[string]any{"id": "old"}},
		"stageSchedule": map[string]any{"mon": []any{"1-7"}},
		"ignored":       "outside the generated shape",
	}
	materials := map[string]Material{"30012": {ID: "30012", Name: "固源岩", Rarity: 1}}
	file := BuildMaterialsFile(existing, materials)

	if _, ok := file.Materials["old"]; ok {
		t.Fatal("materials must be replaced, not merged")
	}
	if file.Materials["30012"].Name != "固源岩" {
		t.Fatalf("materials = %#v", file.Materials)
	}
	if file.Recipes["30135"].(map[string]any)["id"] != "old" {
		t.Fatalf("recipes = %#v", file.Recipes)
	}
	if len(file.StageSchedule) != 1 {
		t.Fatalf("stageSchedule = %#v", file.StageSchedule)
	}

	empty := BuildMaterialsFile(nil, nil)
	if empty.Materials == nil || empty.Recipes == nil || empty.StageSchedule == nil {
		t.Fatalf("empty file = %#v", empty)
	}
}

func TestBuildFormulasAndMerge(t *testing.T) {
	building := map[string]any{
		"workshopFormulas": map[string]any{
			"F1": map[string]any{"costs": []any{
				map[string]any{"id": "30012", "count": json.Number("3")},
				map[string]any{"id": "", "count": json.Number("1")},
				map[string]any{"id": "30013", "count": json.Number("0")},
				"not-a-record",
			}},
			"F_EMPTY": map[string]any{"costs": []any{}},
		},
		"manufactFormulas": map[string]any{
			"F2": map[string]any{"costs": []any{
				map[string]any{"id": "30064", "count": json.Number("2")},
			}},
		},
	}
	itemTable := map[string]any{
		"items": map[string]any{
			"30135": map[string]any{
				"name":                "D32钢",
				"buildingProductList": []any{map[string]any{"roomType": "WORKSHOP", "formulaId": "F1"}},
			},
			"30064": map[string]any{
				"name":                "改量装置",
				"buildingProductList": []any{map[string]any{"roomType": "MANUFACTURE", "formulaId": "F2"}},
			},
			"empty": map[string]any{
				"name":                "空配方",
				"buildingProductList": []any{map[string]any{"roomType": "WORKSHOP", "formulaId": "F_EMPTY"}},
			},
			"missing": map[string]any{
				"name":                "缺失",
				"buildingProductList": []any{map[string]any{"roomType": "WORKSHOP", "formulaId": "NOPE"}},
			},
			"no-room": map[string]any{
				"name":                "无房间",
				"buildingProductList": []any{map[string]any{"roomType": "", "formulaId": "F1"}},
			},
			"no-list": map[string]any{
				"name":                "无产物",
				"buildingProductList": []any{},
			},
			"bad-list": "not-a-list",
		},
	}

	recipes := BuildFormulas(building, itemTable)
	if len(recipes) != 2 {
		t.Fatalf("recipes = %#v", recipes)
	}
	steel := recipes["30135"]
	if steel.ID != "30135" || steel.Name != "D32钢" || steel.Type != "craft" {
		t.Fatalf("steel = %#v", steel)
	}
	if len(steel.Materials) != 1 {
		t.Fatalf("steel materials = %#v", steel.Materials)
	}
	if number, _ := jsNumber(steel.Materials["30012"]); number != 3 {
		t.Fatalf("steel material count = %#v", steel.Materials["30012"])
	}
	device := recipes["30064"]
	if device.Type != "manufacture" || device.Materials["30064"] == nil {
		t.Fatalf("device = %#v", device)
	}

	root := map[string]any{
		"materials":     map[string]any{"keep": true},
		"recipes":       map[string]any{"old": map[string]any{"id": "old"}, "30135": map[string]any{"id": "stale"}},
		"stageSchedule": map[string]any{"mon": "1-7"},
	}
	merged, err := MergeFormulas(root, recipes)
	if err != nil {
		t.Fatal(err)
	}
	mergedRecipes := mustRecord(t, merged["recipes"], "recipes")
	if _, ok := mergedRecipes["old"]; !ok {
		t.Fatal("existing recipe must be preserved")
	}
	newSteel, ok := mergedRecipes["30135"].(Recipe)
	if !ok || newSteel.Type != "craft" {
		t.Fatalf("formula must override stale recipe: %#v", mergedRecipes["30135"])
	}
	if rootRecipes := mustRecord(t, root["recipes"], "root recipes"); rootRecipes["30135"].(map[string]any)["id"] != "stale" {
		t.Fatal("MergeFormulas must not mutate the input root")
	}
	if merged["stageSchedule"].(map[string]any)["mon"] != "1-7" {
		t.Fatalf("stageSchedule = %#v", merged["stageSchedule"])
	}
}

func TestMergeFormulasRejectsNonObject(t *testing.T) {
	_, err := MergeFormulas([]any{map[string]any{"id": "x"}}, map[string]Recipe{})
	if err == nil {
		t.Fatal("expected error")
	}
	applicationError, ok := apperrors.As(err)
	if !ok || applicationError.Code != "GAMEDATA_INVALID_MATERIALS" {
		t.Fatalf("error = %#v", err)
	}
}

func TestRefreshMaterialsFixtureAndIdempotence(t *testing.T) {
	files := map[string]any{
		"/excel/item_table.json": map[string]any{
			"items": map[string]any{
				"30012": map[string]any{
					"name":         "固源岩",
					"rarity":       json.Number("1"),
					"itemType":     "MATERIAL",
					"classifyType": "MATERIAL",
					"stageDropList": []any{
						map[string]any{"stageId": "1-7", "occPer": json.Number("1234")},
					},
				},
				"30135": map[string]any{
					"name":                "D32钢",
					"buildingProductList": []any{map[string]any{"roomType": "WORKSHOP", "formulaId": "F1"}},
				},
			},
		},
		"/excel/building_data.json": map[string]any{
			"workshopFormulas": map[string]any{
				"F1": map[string]any{"costs": []any{map[string]any{"id": "30012", "count": json.Number("3")}}},
			},
			"manufactFormulas": map[string]any{},
		},
	}
	server, requests := fixtureServer(t, files)
	outDir := t.TempDir()
	existingPath := filepath.Join(outDir, MaterialsFileName)
	if err := jsonstore.Write(existingPath, map[string]any{
		"materials":     map[string]any{},
		"recipes":       map[string]any{"legacy": map[string]any{"id": "legacy"}},
		"stageSchedule": map[string]any{"mon": "1-7"},
	}, true); err != nil {
		t.Fatal(err)
	}

	client := NewClient(ClientOptions{HTTPClient: server.Client(), BaseURL: server.URL, Timeout: 5 * time.Second})
	result, err := RefreshMaterials(context.Background(), client, outDir)
	if err != nil {
		t.Fatal(err)
	}
	if result.MaterialCount != 1 || result.RecipeCount != 1 || result.MergedCount != 2 {
		t.Fatalf("result = %#v", result)
	}
	firstMaterials := readFileBytes(t, filepath.Join(outDir, MaterialsFileName))
	firstFormulas := readFileBytes(t, filepath.Join(outDir, MaterialFormulasFileName))
	if requests.Load() != 2 {
		t.Fatalf("requests = %d, want 2", requests.Load())
	}

	if _, err := RefreshMaterials(context.Background(), client, outDir); err != nil {
		t.Fatal(err)
	}
	if second := readFileBytes(t, filepath.Join(outDir, MaterialsFileName)); string(second) != string(firstMaterials) {
		t.Fatal("materials.json is not idempotent")
	}
	if second := readFileBytes(t, filepath.Join(outDir, MaterialFormulasFileName)); string(second) != string(firstFormulas) {
		t.Fatal("material-formulas.json is not idempotent")
	}

	root := mustRecord(t, decodeFile(t, filepath.Join(outDir, MaterialsFileName)), "materials root")
	recipes := mustRecord(t, root["recipes"], "recipes")
	if _, ok := recipes["legacy"]; !ok {
		t.Fatal("legacy recipe missing")
	}
	steel := mustRecord(t, recipes["30135"], "steel recipe")
	if steel["type"] != "craft" {
		t.Fatalf("steel = %#v", steel)
	}
	if mustRecord(t, root["stageSchedule"], "stageSchedule")["mon"] != "1-7" {
		t.Fatalf("stageSchedule = %#v", root["stageSchedule"])
	}
}
