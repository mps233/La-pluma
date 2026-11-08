package gamedata

import (
	"context"
	"net/http"
	"path/filepath"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const (
	// MaterialsFileName is the merged material table and formula store.
	MaterialsFileName = "materials.json"
	// MaterialFormulasFileName is the intermediate formula export.
	MaterialFormulasFileName = "material-formulas.json"
)

// BestStage is a recommended farming stage for a material.
type BestStage struct {
	Stage      string  `json:"stage"`
	Efficiency float64 `json:"efficiency"`
	DropRate   float64 `json:"dropRate"`
}

// Material matches the material records from fetch-all-materials.ts.
type Material struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Rarity     int         `json:"rarity"`
	BestStages []BestStage `json:"bestStages,omitempty"`
}

// MaterialsFile is the root of materials.json. Recipes and stageSchedule are
// preserved from the existing file when the item table is refreshed.
type MaterialsFile struct {
	Materials     map[string]Material `json:"materials"`
	Recipes       map[string]any      `json:"recipes"`
	StageSchedule map[string]any      `json:"stageSchedule"`
}

// Recipe matches the records produced by fetch-material-formulas.ts.
type Recipe struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Type      string         `json:"type"`
	Materials map[string]any `json:"materials"`
}

// MaterialsBundle is the result of the item_table + building_data pass.
type MaterialsBundle struct {
	Materials MaterialsFile
	Formulas  map[string]Recipe
}

// ParseMaterials extracts MATERIAL-classified items and up to three drop
// stages from item_table.json, mirroring fetch-all-materials.ts.
func ParseMaterials(itemTable any) map[string]Material {
	materials := map[string]Material{}
	items := asRecord(asRecord(itemTable)["items"])

	for itemID, rawItem := range items {
		item := asRecord(rawItem)
		if item == nil {
			continue
		}
		itemType, _ := stringValue(item["itemType"])
		classifyType, _ := stringValue(item["classifyType"])
		if itemType != "MATERIAL" || classifyType != "MATERIAL" {
			continue
		}

		bestStages := make([]BestStage, 0, 3)
		stageDropList := asArray(item["stageDropList"])
		limit := len(stageDropList)
		if limit > 3 {
			limit = 3
		}
		for index := 0; index < limit; index++ {
			drop := asRecord(stageDropList[index])
			if drop == nil {
				continue
			}
			stageID, ok := stringValue(drop["stageId"])
			if !ok || stageID == "" {
				continue
			}
			occPer, ok := numericValue(drop["occPer"])
			if !ok || occPer == 0 {
				continue
			}
			bestStages = append(bestStages, BestStage{
				Stage:      stageID,
				Efficiency: 1.0,
				DropRate:   roundToFixed4(occPer / 10000),
			})
		}

		materials[itemID] = Material{
			ID:         itemID,
			Name:       jsString(firstTruthy(item["name"], "")),
			Rarity:     parseIntJS(firstTruthy(item["rarity"], "")),
			BestStages: bestStages,
		}
	}
	return materials
}

// BuildMaterialsFile combines a fresh material map with recipes and
// stageSchedule from the previous materials.json. A missing or non-object
// previous root behaves like `{ materials: {}, recipes: {}, stageSchedule: {} }`.
func BuildMaterialsFile(existing any, materials map[string]Material) MaterialsFile {
	if materials == nil {
		materials = map[string]Material{}
	}
	root := asRecord(existing)
	recipes := map[string]any{}
	stageSchedule := map[string]any{}
	if root != nil {
		if previous := asRecord(root["recipes"]); previous != nil {
			recipes = previous
		}
		if previous := asRecord(root["stageSchedule"]); previous != nil {
			stageSchedule = previous
		}
	}
	return MaterialsFile{Materials: materials, Recipes: recipes, StageSchedule: stageSchedule}
}

// BuildFormulas joins building_data.json formulas with item_table.json
// buildingProductList, mirroring fetch-material-formulas.ts.
func BuildFormulas(buildingData any, itemTable any) map[string]Recipe {
	formulaCosts := map[string][]any{}
	building := asRecord(buildingData)
	for _, group := range []struct {
		field    string
		roomType string
	}{
		{field: "workshopFormulas", roomType: "WORKSHOP"},
		{field: "manufactFormulas", roomType: "MANUFACTURE"},
	} {
		for formulaID, rawFormula := range asRecord(building[group.field]) {
			formula := asRecord(rawFormula)
			if formula == nil {
				continue
			}
			if costs, ok := asArrayOK(formula["costs"]); ok {
				formulaCosts[group.roomType+"_"+formulaID] = costs
			}
		}
	}

	recipes := map[string]Recipe{}
	items := asRecord(asRecord(itemTable)["items"])
	for itemID, rawItem := range items {
		item := asRecord(rawItem)
		if item == nil {
			continue
		}
		productList, ok := asArrayOK(item["buildingProductList"])
		if !ok || len(productList) == 0 {
			continue
		}
		productInfo := asRecord(productList[0])
		if productInfo == nil {
			continue
		}
		roomType, ok := stringValue(productInfo["roomType"])
		if !ok || roomType == "" {
			continue
		}
		formulaID, ok := stringValue(productInfo["formulaId"])
		if !ok || formulaID == "" {
			continue
		}
		costs, ok := formulaCosts[roomType+"_"+formulaID]
		if !ok || len(costs) == 0 {
			continue
		}

		materials := map[string]any{}
		for _, rawCost := range costs {
			cost := asRecord(rawCost)
			if cost == nil {
				continue
			}
			materialID, ok := stringValue(cost["id"])
			if !ok || materialID == "" {
				continue
			}
			if truthy(cost["count"]) {
				materials[materialID] = cost["count"]
			}
		}
		if len(materials) == 0 {
			continue
		}

		recipeType := "manufacture"
		if roomType == "WORKSHOP" {
			recipeType = "craft"
		}
		recipes[itemID] = Recipe{
			ID:        itemID,
			Name:      jsString(firstTruthy(item["name"], "")),
			Type:      recipeType,
			Materials: materials,
		}
	}
	return recipes
}

// MergeFormulas shallow-merges formulas into the root's recipes, with new
// formulas overriding old ones, mirroring merge-formulas.ts.
func MergeFormulas(materialsRoot any, formulas map[string]Recipe) (map[string]any, error) {
	root := asRecord(materialsRoot)
	if root == nil {
		normalized, err := jsonstore.Normalize(materialsRoot)
		if err != nil {
			return nil, apperrors.WithStatus(
				"GAMEDATA_INVALID_MATERIALS",
				"材料数据格式无效",
				http.StatusInternalServerError,
				false,
				map[string]any{"cause": err.Error()},
			)
		}
		root = asRecord(normalized)
	}
	if root == nil {
		return nil, apperrors.WithStatus(
			"GAMEDATA_INVALID_MATERIALS",
			"材料数据必须是 JSON 对象",
			http.StatusInternalServerError,
			false,
			nil,
		)
	}

	mergedRecipes := map[string]any{}
	if existing := asRecord(root["recipes"]); existing != nil {
		for key, value := range existing {
			mergedRecipes[key] = value
		}
	}
	for key, value := range formulas {
		mergedRecipes[key] = value
	}

	result := make(map[string]any, len(root))
	for key, value := range root {
		result[key] = value
	}
	result["recipes"] = mergedRecipes
	return result, nil
}

// ReadMaterialsFile loads the previous materials.json. Missing, unreadable or
// malformed files behave like the Node try/catch fallback and yield nil.
func ReadMaterialsFile(path string) any {
	value, err := jsonstore.Read(path, nil)
	if err != nil {
		return nil
	}
	return value
}

// MaterialsRefreshResult reports the files and counts produced by
// RefreshMaterials.
type MaterialsRefreshResult struct {
	MaterialsPath string
	FormulasPath  string
	MaterialCount int
	RecipeCount   int
	MergedCount   int
}

// RefreshMaterials runs the three-script materials pipeline: refresh
// materials.json from item_table.json while preserving recipes and
// stageSchedule, export material-formulas.json, then merge the new formulas
// into materials.json.
func RefreshMaterials(ctx context.Context, client *Client, outDir string) (MaterialsRefreshResult, error) {
	if client == nil {
		client = NewClient(ClientOptions{})
	}
	materialsPath := filepath.Join(outDir, MaterialsFileName)
	formulasPath := filepath.Join(outDir, MaterialFormulasFileName)

	existing := ReadMaterialsFile(materialsPath)
	bundle, err := client.FetchMaterialsBundle(ctx, existing)
	if err != nil {
		return MaterialsRefreshResult{}, err
	}
	if err := writeGenerated(materialsPath, bundle.Materials); err != nil {
		return MaterialsRefreshResult{}, err
	}
	if err := writeGenerated(formulasPath, bundle.Formulas); err != nil {
		return MaterialsRefreshResult{}, err
	}
	merged, err := MergeFormulas(bundle.Materials, bundle.Formulas)
	if err != nil {
		return MaterialsRefreshResult{}, err
	}
	if err := writeGenerated(materialsPath, merged); err != nil {
		return MaterialsRefreshResult{}, err
	}

	return MaterialsRefreshResult{
		MaterialsPath: materialsPath,
		FormulasPath:  formulasPath,
		MaterialCount: len(bundle.Materials.Materials),
		RecipeCount:   len(bundle.Formulas),
		MergedCount:   len(asRecord(merged["recipes"])),
	}, nil
}

// FetchMaterialsBundle fetches item_table.json and building_data.json once and
// builds both materials.json content and material-formulas.json content.
func (c *Client) FetchMaterialsBundle(ctx context.Context, existing any) (MaterialsBundle, error) {
	tables, err := c.fetchTables(ctx, "item_table.json", "building_data.json")
	if err != nil {
		return MaterialsBundle{}, err
	}
	itemTable := tables["item_table.json"]
	return MaterialsBundle{
		Materials: BuildMaterialsFile(existing, ParseMaterials(itemTable)),
		Formulas:  BuildFormulas(tables["building_data.json"], itemTable),
	}, nil
}
