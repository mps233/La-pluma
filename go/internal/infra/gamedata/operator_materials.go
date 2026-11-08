package gamedata

import (
	"context"
	"strings"
	"time"
)

// OperatorMaterialsFileName is the generated elite promotion material table.
const OperatorMaterialsFileName = "operator-materials.json"

var professionMap = map[string]string{
	"PIONEER": "先锋",
	"WARRIOR": "近卫",
	"SNIPER":  "狙击",
	"TANK":    "重装",
	"MEDIC":   "医疗",
	"SUPPORT": "辅助",
	"CASTER":  "术师",
	"SPECIAL": "特种",
}

// OperatorMaterial is one item count in an elite promotion cost.
type OperatorMaterial struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Count any    `json:"count"`
}

// Elite1Cost is the elite 1 requirement. It has no separate chip list.
type Elite1Cost struct {
	LMD       any                `json:"lmd"`
	Materials []OperatorMaterial `json:"materials"`
}

// Elite2Cost is the elite 2 requirement, with chips split out.
type Elite2Cost struct {
	LMD       any                `json:"lmd"`
	Materials []OperatorMaterial `json:"materials"`
	Chips     []OperatorMaterial `json:"chips"`
}

// OperatorRecord matches fetch-operator-materials.ts records.
type OperatorRecord struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Rarity     int         `json:"rarity"`
	Profession any         `json:"profession"`
	Elite1     *Elite1Cost `json:"elite1,omitempty"`
	Elite2     *Elite2Cost `json:"elite2,omitempty"`
}

// OperatorMaterialsMetadata is the generated file metadata.
type OperatorMaterialsMetadata struct {
	Version        string `json:"version"`
	LastUpdated    string `json:"lastUpdated"`
	TotalOperators int    `json:"totalOperators"`
	Source         string `json:"source"`
	Notes          string `json:"notes"`
}

// OperatorMaterialsFile is the root of operator-materials.json.
type OperatorMaterialsFile struct {
	Operators map[string]OperatorRecord `json:"operators"`
	Metadata  OperatorMaterialsMetadata `json:"metadata"`
}

// ParseOperatorMaterials builds elite promotion requirements for recruitable
// 4-star-and-above operators, mirroring parseOperatorMaterials.
func ParseOperatorMaterials(characterData any, itemTable any) map[string]OperatorRecord {
	operators := map[string]OperatorRecord{}
	itemRecords := asRecord(asRecord(itemTable)["items"])
	itemName := func(id any) any {
		item := asRecord(itemRecords[jsString(id)])
		if item == nil {
			return nil
		}
		return item["name"]
	}

	for charID, rawCharacter := range asRecord(characterData) {
		character := asRecord(rawCharacter)
		if character == nil {
			continue
		}
		phases, ok := asArrayOK(character["phases"])
		if !ok || len(phases) == 0 {
			continue
		}
		if truthy(character["isNotObtainable"]) {
			continue
		}

		rarity := operatorRarity(character["rarity"])
		if rarity < 4 {
			continue
		}

		profession := character["profession"]
		if professionID, ok := stringValue(profession); ok {
			if mapped, exists := professionMap[professionID]; exists {
				profession = mapped
			}
		}

		operator := OperatorRecord{
			ID:         charID,
			Name:       jsString(firstTruthy(character["name"], charID)),
			Rarity:     rarity,
			Profession: profession,
		}

		if len(phases) >= 2 {
			phase1 := asRecord(phases[1])
			if phase1 != nil {
				if costs, ok := asArrayOK(phase1["evolveCost"]); ok {
					operator.Elite1 = &Elite1Cost{
						LMD:       eliteLMD(costs),
						Materials: promotionMaterials(costs, itemName),
					}
				}
			}
		}

		if len(phases) >= 3 {
			phase2 := asRecord(phases[2])
			if phase2 != nil {
				if costs, ok := asArrayOK(phase2["evolveCost"]); ok {
					materials := make([]OperatorMaterial, 0, len(costs))
					chips := make([]OperatorMaterial, 0, len(costs))
					for _, rawCost := range costs {
						cost := asRecord(rawCost)
						if cost == nil {
							continue
						}
						if isLMDCost(cost) {
							continue
						}
						material := OperatorMaterial{
							ID:    jsString(cost["id"]),
							Name:  jsString(firstTruthy(itemName(cost["id"]), cost["id"])),
							Count: cost["count"],
						}
						if strings.HasPrefix(material.ID, "32") {
							chips = append(chips, material)
						} else {
							materials = append(materials, material)
						}
					}
					operator.Elite2 = &Elite2Cost{
						LMD:       eliteLMD(costs),
						Materials: materials,
						Chips:     chips,
					}
				}
			}
		}

		if operator.Elite1 != nil || operator.Elite2 != nil {
			operators[charID] = operator
		}
	}
	return operators
}

// BuildOperatorMaterialsFile adds the metadata block used by the generated
// file. now is normalized to its UTC date.
func BuildOperatorMaterialsFile(characterData any, itemTable any, now time.Time) OperatorMaterialsFile {
	operators := ParseOperatorMaterials(characterData, itemTable)
	return OperatorMaterialsFile{
		Operators: operators,
		Metadata: OperatorMaterialsMetadata{
			Version:        "2.0.0",
			LastUpdated:    dateOnly(now),
			TotalOperators: len(operators),
			Source:         SourceAttribution,
			Notes:          "自动从游戏数据生成，包含所有 4 星及以上可招募干员的精英化材料",
		},
	}
}

// FetchOperatorMaterials fetches character_table.json and item_table.json and
// builds operator-materials.json.
func (c *Client) FetchOperatorMaterials(ctx context.Context, now time.Time) (OperatorMaterialsFile, error) {
	tables, err := c.fetchTables(ctx, "character_table.json", "item_table.json")
	if err != nil {
		return OperatorMaterialsFile{}, err
	}
	return BuildOperatorMaterialsFile(tables["character_table.json"], tables["item_table.json"], now), nil
}

func operatorRarity(value any) int {
	switch typed := value.(type) {
	case string:
		if strings.HasPrefix(typed, "TIER_") {
			return parseIntJS(strings.TrimPrefix(typed, "TIER_"))
		}
		return 0
	default:
		if number, ok := numericValue(value); ok {
			return int(number) + 1
		}
		return 0
	}
}

func eliteLMD(costs []any) any {
	for _, rawCost := range costs {
		cost := asRecord(rawCost)
		if cost == nil {
			continue
		}
		if id, ok := stringValue(cost["id"]); ok && id == "4001" {
			return firstTruthy(cost["count"], 0)
		}
	}
	return 0
}

func promotionMaterials(costs []any, itemName func(any) any) []OperatorMaterial {
	materials := make([]OperatorMaterial, 0, len(costs))
	for _, rawCost := range costs {
		cost := asRecord(rawCost)
		if cost == nil || isLMDCost(cost) {
			continue
		}
		materials = append(materials, OperatorMaterial{
			ID:    jsString(cost["id"]),
			Name:  jsString(firstTruthy(itemName(cost["id"]), cost["id"])),
			Count: cost["count"],
		})
	}
	return materials
}

// isLMDCost uses strict equality; a numeric 4001 id is a material, not LMD.
func isLMDCost(cost map[string]any) bool {
	id, ok := stringValue(cost["id"])
	return ok && id == "4001"
}
