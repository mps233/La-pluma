package training

import (
	"fmt"
	"net/http"
	"strings"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

// ApplyPlanToTasks copies the applicable smart stages into the fight task in
// user-configs/automation-tasks.json, preserving pinned and normal stages.
func (s *Service) ApplyPlanToTasks(plan TrainingPlan, settings map[string]any) (ApplyPlanResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	queue, err := s.loadTrainingQueue()
	if err != nil {
		return ApplyPlanResult{}, err
	}
	effectiveSettings := normalizeTrainingSettings(mergeSettings(queue.Settings, settings))
	applicableStages := getApplicableStages(plan)

	config, err := s.loadAutomationConfig()
	if err != nil {
		return ApplyPlanResult{}, err
	}
	taskFlow, _ := asArray(config["taskFlow"])
	if taskFlow == nil {
		taskFlow = make([]any, 0)
	}

	var fightTask map[string]any
	for _, raw := range taskFlow {
		task, ok := asRecord(raw)
		if !ok {
			continue
		}
		if task["commandId"] == "fight" {
			fightTask = task
			break
		}
	}

	if fightTask == nil {
		fightTask = map[string]any{
			"id":          fmt.Sprintf("fight-%d", s.now().UnixMilli()),
			"name":        "理智作战",
			"description": "自动刷关卡消耗理智",
			"commandId":   "fight",
			"enabled":     true,
			"params": map[string]any{
				"stage":            "1-7",
				"stages":           []any{},
				"medicine":         settingOrZero(effectiveSettings, "useMedicine"),
				"expiringMedicine": 0,
				"stone":            settingOrZero(effectiveSettings, "useStone"),
				"series":           0,
			},
		}
		taskFlow = append(taskFlow, fightTask)
		config["taskFlow"] = taskFlow
	}

	currentParams, ok := asRecord(fightTask["params"])
	if !ok {
		currentParams = map[string]any{}
	}
	existingStages, ok := asArray(currentParams["stages"])
	if !ok {
		existingStages = []any{}
	}

	pinnedStages := make([]any, 0)
	normalStages := make([]any, 0)
	for _, raw := range existingStages {
		record, isRecord := asRecord(raw)
		pinned := isRecord && isTruthy(record["pinned"])
		smart := isRecord && isTruthy(record["smart"])
		switch {
		case pinned:
			pinnedStages = append(pinnedStages, raw)
		case !smart:
			normalStages = append(normalStages, raw)
		}
	}

	trainingOperatorNames := make([]string, 0, len(plan.Operators))
	for _, operator := range plan.Operators {
		trainingOperatorNames = append(trainingOperatorNames, operator.Name)
	}

	smartStages := make([]any, 0, len(applicableStages)+1)
	for _, stage := range applicableStages {
		times := 0.0
		if stage.TotalTimes != nil {
			times = *stage.TotalTimes
		} else if stage.Times != nil {
			times = *stage.Times
		}
		smartStages = append(smartStages, map[string]any{
			"stage":             stage.Stage,
			"times":             jsStringApprox(times),
			"smart":             true,
			"trainingOperators": trainingOperatorNames,
		})
	}

	if fallbackStage, ok := settingString(effectiveSettings, "fallbackStage"); ok {
		if trimmed := strings.TrimSpace(fallbackStage); trimmed != "" {
			fallbackTimes := effectiveSettings["fallbackTimes"]
			if !isTruthy(fallbackTimes) {
				fallbackTimes = float64(999)
			}
			smartStages = append(smartStages, map[string]any{
				"stage":             trimmed,
				"times":             jsStringApprox(fallbackTimes),
				"smart":             true,
				"trainingOperators": trainingOperatorNames,
			})
		}
	}

	newStages := make([]any, 0, len(pinnedStages)+len(smartStages)+len(normalStages))
	newStages = append(newStages, pinnedStages...)
	newStages = append(newStages, smartStages...)
	newStages = append(newStages, normalStages...)

	nextParams := make(map[string]any, len(currentParams)+4)
	for key, value := range currentParams {
		nextParams[key] = value
	}
	nextParams["stages"] = newStages
	nextParams["medicine"] = settingOrZero(effectiveSettings, "useMedicine")
	nextParams["expiringMedicine"] = 0
	nextParams["stone"] = settingOrZero(effectiveSettings, "useStone")
	if series, exists := currentParams["series"]; exists && isTruthy(series) {
		nextParams["series"] = series
	} else {
		nextParams["series"] = 0
	}
	fightTask["params"] = nextParams
	config["taskFlow"] = taskFlow

	if err := jsonstore.Write(s.automationTaskPath(), config, true); err != nil {
		s.logger.Error("应用任务流程失败", "error", err)
		return ApplyPlanResult{}, apperrors.WithStatus(
			"AGENT_TRAINING_APPLY_FAILED",
			"应用任务流程失败",
			http.StatusInternalServerError,
			false,
			map[string]any{"path": s.automationTaskPath(), "error": err.Error()},
		)
	}

	fallbackPresent := false
	if fallbackStage, ok := settingString(effectiveSettings, "fallbackStage"); ok {
		fallbackPresent = strings.TrimSpace(fallbackStage) != ""
	}
	return ApplyPlanResult{
		Success:     true,
		StageCount:  len(smartStages),
		TotalStages: len(newStages),
		HasFallback: fallbackPresent,
	}, nil
}

// loadAutomationConfig normalizes taskFlow and schedule while preserving every
// other root property.
func (s *Service) loadAutomationConfig() (map[string]any, error) {
	value, err := jsonstore.Read(s.automationTaskPath(), nil)
	if err != nil {
		return nil, apperrors.WithStatus(
			"AGENT_TRAINING_TASKS_READ_FAILED",
			"读取任务流程配置失败",
			http.StatusInternalServerError,
			false,
			map[string]any{"path": s.automationTaskPath(), "error": err.Error()},
		)
	}
	record, ok := asRecord(value)
	if !ok {
		record = map[string]any{}
	}
	config := make(map[string]any, len(record))
	for key, item := range record {
		config[key] = item
	}

	taskFlow := make([]any, 0)
	if array, ok := asArray(config["taskFlow"]); ok {
		for _, raw := range array {
			if _, isRecord := asRecord(raw); isRecord {
				taskFlow = append(taskFlow, raw)
			}
		}
	}
	config["taskFlow"] = taskFlow
	if schedule, ok := asRecord(config["schedule"]); !ok || schedule == nil {
		config["schedule"] = map[string]any{"enabled": false, "times": []any{}}
	}
	return config, nil
}

// clearSmartTrainingStages removes every smart stage from the fight task.
func (s *Service) clearSmartTrainingStages() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	config, err := s.loadAutomationConfig()
	if err != nil {
		return err
	}
	taskFlow, _ := asArray(config["taskFlow"])
	for _, raw := range taskFlow {
		task, ok := asRecord(raw)
		if !ok || task["commandId"] != "fight" {
			continue
		}
		params, ok := asRecord(task["params"])
		if !ok {
			continue
		}
		stagesValue, exists := params["stages"]
		if !exists || !isTruthy(stagesValue) {
			continue
		}
		existing, ok := asArray(stagesValue)
		if !ok {
			existing = []any{}
		}
		remaining := make([]any, 0, len(existing))
		for _, stageRaw := range existing {
			stage, isRecord := asRecord(stageRaw)
			if isRecord && isTruthy(stage["smart"]) {
				continue
			}
			remaining = append(remaining, stageRaw)
		}
		params["stages"] = remaining
		if err := jsonstore.Write(s.automationTaskPath(), config, true); err != nil {
			return apperrors.WithStatus(
				"AGENT_TRAINING_CLEAR_STAGES_FAILED",
				"清除智能关卡失败",
				http.StatusInternalServerError,
				false,
				map[string]any{"path": s.automationTaskPath(), "error": err.Error()},
			)
		}
		return nil
	}
	return nil
}

// UpdateSmartTrainingStages regenerates smart fight stages after a scheduled
// flow. It mirrors updateSmartTrainingStages: an empty queue clears the stages,
// no open stage clears them, and autoSwitch advances to the next operator.
func (s *Service) UpdateSmartTrainingStages() error {
	config, err := s.loadAutomationConfig()
	if err != nil {
		return err
	}
	if !configHasSmartStages(config) {
		return nil
	}

	s.mu.Lock()
	queue, err := s.loadTrainingQueue()
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if len(queue.Queue) == 0 {
		return s.clearSmartTrainingStages()
	}

	plan, err := s.GenerateTrainingPlan("current", "")
	if err != nil {
		return err
	}
	if len(getApplicableStages(plan)) > 0 {
		_, err := s.ApplyPlanToTasks(plan, map[string]any{})
		return err
	}

	if settingsAutoSwitch(queue.Settings) && len(queue.Queue) > 1 {
		s.mu.Lock()
		queue, err = s.loadTrainingQueue()
		if err == nil && len(queue.Queue) > 1 {
			queue.Queue = append([]QueueItem{}, queue.Queue[1:]...)
			for index := range queue.Queue {
				queue.Queue[index].Priority = index + 1
			}
			if !s.saveTrainingQueue(queue) {
				err = apperrors.WithStatus("AGENT_TRAINING_QUEUE_SAVE_FAILED", "保存养成队列失败", http.StatusInternalServerError, false, nil)
			}
		}
		s.mu.Unlock()
		if err != nil {
			return err
		}
		if nextPlan, planErr := s.GenerateTrainingPlan("current", ""); planErr == nil {
			if len(getApplicableStages(nextPlan)) > 0 {
				_, applyErr := s.ApplyPlanToTasks(nextPlan, map[string]any{})
				return applyErr
			}
		}
	}
	return s.clearSmartTrainingStages()
}

func configHasSmartStages(config map[string]any) bool {
	taskFlow, _ := asArray(config["taskFlow"])
	for _, raw := range taskFlow {
		task, ok := asRecord(raw)
		if !ok || task["commandId"] != "fight" {
			continue
		}
		params, _ := asRecord(task["params"])
		stages, _ := asArray(params["stages"])
		for _, stageRaw := range stages {
			stage, ok := asRecord(stageRaw)
			if ok && isTruthy(stage["smart"]) {
				return true
			}
		}
	}
	return false
}

func settingsAutoSwitch(settings TrainingSettings) bool {
	if value, ok := settings["autoSwitch"].(bool); ok {
		return value
	}
	return true
}
