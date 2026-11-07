package training

import (
	"fmt"
	"math"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// GenerateTrainingPlan builds the farming plan. mode "current" processes only
// the first queue entry; any other mode processes the whole queue.
func (s *Service) GenerateTrainingPlan(mode string, clientType string) (TrainingPlan, error) {
	if mode == "" {
		mode = "current"
	}
	queue, err := s.loadTrainingQueue()
	if err != nil {
		return TrainingPlan{}, err
	}
	depot := s.loadDepot()
	resourceCollectionOpen := s.isResourceCollectionOpen(clientType, s.now())
	materialsData := s.loadOperatorMaterials()
	database := s.loadMaterialsDatabase()

	if len(queue.Queue) == 0 {
		return TrainingPlan{}, apperrors.Validation(
			"AGENT_TRAINING_QUEUE_EMPTY",
			"养成队列为空",
			map[string]any{},
		)
	}

	operatorsToProcess := queue.Queue
	if mode == "current" {
		operatorsToProcess = queue.Queue[:1]
	}

	materialNeeds := make(map[string]float64)
	needOrder := make([]string, 0)
	operators := make([]PlanOperator, 0, len(operatorsToProcess))
	for _, item := range operatorsToProcess {
		data := materialsData.Operators[item.OperatorID]
		if data == nil {
			continue
		}
		calculation := s.calculateOperatorMaterials(trainingTarget{
			ID:           data.ID,
			Name:         data.Name,
			Rarity:       data.Rarity,
			Profession:   data.Profession,
			CurrentElite: numberOr(item.CurrentElite, 0),
			TargetElite:  numberOr(item.TargetElite, 2),
			Materials:    &OperatorMaterialsBundle{Elite1: data.Elite1, Elite2: data.Elite2},
		}, depot.Items)

		if calculation.IsComplete {
			continue
		}

		remaining := make([]CalculatedMaterial, 0, len(calculation.Materials))
		for _, material := range calculation.Materials {
			if material.StillNeeded > 0 {
				remaining = append(remaining, material)
			}
		}
		operators = append(operators, PlanOperator{
			ID:           data.ID,
			Name:         data.Name,
			Rarity:       data.Rarity,
			Profession:   data.Profession,
			CurrentElite: numberOr(item.CurrentElite, 0),
			TargetElite:  numberOr(item.TargetElite, 2),
			Materials:    remaining,
		})

		for _, material := range calculation.Materials {
			if material.StillNeeded <= 0 {
				continue
			}
			if _, exists := materialNeeds[material.ID]; !exists {
				needOrder = append(needOrder, material.ID)
			}
			materialNeeds[material.ID] += material.StillNeeded
		}
	}

	if len(materialNeeds) == 0 {
		emptyMaterials := make([]CalculatedMaterial, 0)
		return TrainingPlan{
			Operators:         operators,
			Materials:         &emptyMaterials,
			MaterialHierarchy: make([]MaterialHierarchyNode, 0),
			Stages:            make([]TrainingStage, 0),
			TotalSanity:       0,
			Warnings:          []string{"所有干员的材料已集齐！"},
		}, nil
	}

	farmable := make(map[string]float64)
	farmableOrder := make([]string, 0)
	for _, materialID := range needOrder {
		s.expandMaterialTree(materialID, materialNeeds[materialID], depot.Items, database, farmable, &farmableOrder)
	}

	_, weekday := gameDay(s.now(), clientType)

	hierarchy := make([]MaterialHierarchyNode, 0, len(farmableOrder))
	stages := make([]TrainingStage, 0, len(farmableOrder))
	stageIndex := make(map[string]int)
	totalSanity := 0
	warnings := make([]string, 0)

	for _, materialID := range farmableOrder {
		needed := farmable[materialID]
		material := database.Materials[materialID]
		if material == nil {
			warnings = append(warnings, fmt.Sprintf("材料 %s 在数据库中不存在", materialID))
			continue
		}

		hierarchy = append(hierarchy, MaterialHierarchyNode{
			ID:          materialID,
			Name:        material.Name,
			IconID:      material.IconID,
			Needed:      needed,
			Have:        depot.Items[materialID],
			StillNeeded: needed,
			Children:    make([]MaterialHierarchyNode, 0),
		})

		if needed <= 0 {
			continue
		}

		var stage string
		if mapped, ok := chipStageMap[material.Name]; ok {
			stage = mapped
		} else {
			rawStage := ""
			if material.BestStage != nil && *material.BestStage != "" {
				rawStage = *material.BestStage
			} else if len(material.BestStages) > 0 && material.BestStages[0].Stage != nil {
				rawStage = *material.BestStages[0].Stage
			}
			if rawStage == "" {
				warnings = append(warnings, fmt.Sprintf("材料 %s 没有最优关卡信息", material.Name))
				continue
			}
			stage = convertStageCode(rawStage)
		}

		stagePosition, exists := stageIndex[stage]
		if !exists {
			stagePosition = len(stages)
			stageIndex[stage] = stagePosition
			stages = append(stages, TrainingStage{
				Stage:     stage,
				Materials: make([]StageMaterialNeed, 0),
				Sanity:    0,
				IsOpen:    true,
			})
		}

		entry := &stages[stagePosition]
		entry.Materials = append(entry.Materials, StageMaterialNeed{
			ID:    materialID,
			Name:  material.Name,
			Count: needed,
		})

		const dropRate = 0.5
		const sanityCost = 18
		timesNeeded := int(math.Ceil(needed / dropRate))
		totalTimes := 0.0
		if entry.TotalTimes != nil {
			totalTimes = *entry.TotalTimes
		}
		totalTimes += float64(timesNeeded)
		entry.TotalTimes = &totalTimes
		entry.Sanity += float64(timesNeeded * sanityCost)
		totalSanity += timesNeeded * sanityCost
	}

	for index := range stages {
		stages[index].IsOpen = isStageOpenToday(stages[index].Stage, weekday, resourceCollectionOpen)
	}

	openStages := make([]TrainingStage, 0, len(stages))
	closedStages := make([]TrainingStage, 0)
	for _, stage := range stages {
		if stageClosed(stage.IsOpen) {
			closedStages = append(closedStages, stage)
		} else {
			openStages = append(openStages, stage)
		}
	}

	todayOpen := getTodayOpenStages(s.now(), clientType, resourceCollectionOpen)
	var focusOperator *PlanOperator
	if len(operators) > 0 {
		focus := operators[0]
		focusOperator = &focus
	}
	estimatedTime := int(math.Ceil(float64(totalSanity) / 240 * 60))
	summary := &PlanSummary{
		BacklogCount:              maxInt(len(operators)-1, 0),
		OpenStageCount:            len(openStages),
		ClosedStageCount:          len(closedStages),
		TodayOpenResourceStages:   todayOpen.Open,
		TodayClosedResourceStages: todayOpen.Closed,
	}

	return TrainingPlan{
		Operators:         operators,
		MaterialHierarchy: hierarchy,
		Stages:            stages,
		OpenStages:        &openStages,
		ClosedStages:      &closedStages,
		FocusOperator:     focusOperator,
		TotalSanity:       totalSanity,
		EstimatedTime:     &estimatedTime,
		Warnings:          warnings,
		Mode:              mode,
		Summary:           summary,
	}, nil
}

func stageClosed(value any) bool {
	closed, ok := value.(bool)
	return ok && !closed
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

// getApplicableStages mirrors the Node helper: prefer a non-empty openStages
// list, otherwise use stages that are not explicitly closed, and ignore
// entries without a stage or positive run count.
func getApplicableStages(plan TrainingPlan) []TrainingStage {
	candidates := plan.Stages
	if plan.OpenStages != nil && len(*plan.OpenStages) > 0 {
		candidates = *plan.OpenStages
	} else {
		filtered := make([]TrainingStage, 0, len(plan.Stages))
		for _, stage := range plan.Stages {
			if stageClosed(stage.IsOpen) {
				continue
			}
			filtered = append(filtered, stage)
		}
		candidates = filtered
	}

	applicable := make([]TrainingStage, 0, len(candidates))
	for _, stage := range candidates {
		if stage.Stage == "" {
			continue
		}
		times := 0.0
		if stage.TotalTimes != nil {
			times = *stage.TotalTimes
		} else if stage.Times != nil {
			times = *stage.Times
		}
		if !(times > 0) {
			continue
		}
		applicable = append(applicable, stage)
	}
	return applicable
}
