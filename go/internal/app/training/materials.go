package training

import (
	"strings"
)

// eliteLMDCosts are the standard promotion LMD costs by rarity. Current game
// data no longer carries the LMD entry in evolveCost.
var eliteLMDCosts = map[int]struct{ elite1, elite2 float64 }{
	3: {elite1: 15000, elite2: 0},
	4: {elite1: 30000, elite2: 180000},
	5: {elite1: 40000, elite2: 200000},
	6: {elite1: 50000, elite2: 210000},
}

type trainingTarget struct {
	ID           string
	Name         string
	Rarity       float64
	Profession   *string
	CurrentElite float64
	TargetElite  float64
	Materials    *OperatorMaterialsBundle
}

type materialCalculation struct {
	Materials  []CalculatedMaterial
	LMD        LMDRequirement
	IsComplete bool
}

func getEliteLMDCost(operator trainingTarget, phase string) float64 {
	if operator.Materials != nil {
		var phaseMaterials *EliteMaterials
		switch phase {
		case "elite1":
			phaseMaterials = operator.Materials.Elite1
		case "elite2":
			phaseMaterials = operator.Materials.Elite2
		}
		if phaseMaterials != nil && phaseMaterials.LMD != nil && *phaseMaterials.LMD > 0 {
			return *phaseMaterials.LMD
		}
	}
	if operator.Rarity == float64(int(operator.Rarity)) {
		if costs, ok := eliteLMDCosts[int(operator.Rarity)]; ok {
			if phase == "elite1" {
				return costs.elite1
			}
			if phase == "elite2" {
				return costs.elite2
			}
		}
	}
	return 0
}

// calculateOperatorMaterials aggregates the selected promotion phases, subtracts
// depot stock and derives the completion state.
func (s *Service) calculateOperatorMaterials(operator trainingTarget, depot map[string]float64) materialCalculation {
	result := materialCalculation{
		Materials: []CalculatedMaterial{},
		LMD:       LMDRequirement{},
	}
	targetElite := operator.TargetElite

	needElite1 := operator.CurrentElite < 1 && targetElite >= 1
	needElite2 := operator.CurrentElite < 2 && targetElite >= 2

	orderedIDs := make([]string, 0)
	needed := make(map[string]float64)
	addMaterial := func(material MaterialRequirement) {
		if _, exists := needed[material.ID]; !exists {
			orderedIDs = append(orderedIDs, material.ID)
		}
		needed[material.ID] += material.Count
	}

	if needElite1 && operator.Materials != nil && operator.Materials.Elite1 != nil {
		result.LMD.Needed += getEliteLMDCost(operator, "elite1")
		if operator.Materials.Elite1.Materials != nil {
			for _, material := range *operator.Materials.Elite1.Materials {
				addMaterial(material)
			}
		}
	}

	if needElite2 && operator.Materials != nil && operator.Materials.Elite2 != nil {
		result.LMD.Needed += getEliteLMDCost(operator, "elite2")
		if operator.Materials.Elite2.Materials != nil {
			for _, material := range *operator.Materials.Elite2.Materials {
				addMaterial(material)
			}
		}
		if operator.Materials.Elite2.Chips != nil {
			for _, material := range *operator.Materials.Elite2.Chips {
				addMaterial(material)
			}
		}
	}

	for _, id := range orderedIDs {
		count := needed[id]
		have := depot[id]
		stillNeeded := count - have
		if stillNeeded < 0 {
			stillNeeded = 0
		}
		result.Materials = append(result.Materials, CalculatedMaterial{
			ID:          id,
			Name:        s.getMaterialName(id, operator.Materials),
			Needed:      count,
			Have:        have,
			StillNeeded: stillNeeded,
		})
	}

	result.LMD.Have = depot["4001"]
	result.LMD.StillNeeded = result.LMD.Needed - result.LMD.Have
	if result.LMD.StillNeeded < 0 {
		result.LMD.StillNeeded = 0
	}

	result.IsComplete = result.LMD.StillNeeded == 0
	for _, material := range result.Materials {
		if material.StillNeeded != 0 {
			result.IsComplete = false
			break
		}
	}
	return result
}

// getMaterialName prefers the operator bundle, then the MaaResource item name
// cache and finally the Node-style placeholder.
func (s *Service) getMaterialName(id string, bundle *OperatorMaterialsBundle) string {
	find := func(materials *[]MaterialRequirement) (string, bool) {
		if materials == nil {
			return "", false
		}
		for _, material := range *materials {
			if material.ID == id {
				return material.Name, true
			}
		}
		return "", false
	}
	if bundle != nil {
		if bundle.Elite1 != nil {
			if name, ok := find(bundle.Elite1.Materials); ok {
				return name
			}
		}
		if bundle.Elite2 != nil {
			if name, ok := find(bundle.Elite2.Materials); ok {
				return name
			}
			if name, ok := find(bundle.Elite2.Chips); ok {
				return name
			}
		}
	}
	if name, ok := s.materialName(id); ok {
		return name
	}
	return "材料_" + id
}

func calculateProgress(calculation materialCalculation) int {
	totalNeeded := calculation.LMD.Needed / 1000
	totalStillNeeded := calculation.LMD.StillNeeded / 1000
	for _, material := range calculation.Materials {
		totalNeeded += material.Needed
		totalStillNeeded += material.StillNeeded
	}
	if totalNeeded == 0 {
		return 100
	}
	return roundProgress((totalNeeded - totalStillNeeded) / totalNeeded * 100)
}

// expandMaterialTree recursively subtracts depot stock, stops at chip packs
// (刷芯片组 rather than crafting) and decomposes craftable materials.
func (s *Service) expandMaterialTree(
	materialID string,
	needed float64,
	depot map[string]float64,
	database *materialDatabase,
	farmable map[string]float64,
	order *[]string,
) {
	material := database.Materials[materialID]
	if material == nil {
		s.logger.Debug("材料不存在", "materialId", materialID)
		return
	}

	have := depot[materialID]
	stillNeeded := needed - have
	if stillNeeded < 0 {
		stillNeeded = 0
	}
	if stillNeeded == 0 {
		return
	}

	// 芯片组 directly farm their PR-X-2 stage; 双芯片 (which does not contain
	// 芯片组) expands through its formula so existing chip packs are consumed.
	if strings.Contains(material.Name, "芯片组") {
		addFarmable(farmable, order, materialID, stillNeeded)
		return
	}

	recipe := database.Recipes[materialID]
	if recipe != nil && len(recipe.Materials) > 0 {
		for _, subID := range recipe.Order {
			subQuantity := recipe.Materials[subID]
			s.expandMaterialTree(subID, subQuantity*stillNeeded, depot, database, farmable, order)
		}
		return
	}

	addFarmable(farmable, order, materialID, stillNeeded)
}

func addFarmable(farmable map[string]float64, order *[]string, materialID string, quantity float64) {
	if _, exists := farmable[materialID]; !exists {
		*order = append(*order, materialID)
	}
	farmable[materialID] += quantity
}
