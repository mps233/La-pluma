package scheduler

import "strings"

// ValidateScheduledTaskFlow mirrors validateScheduledTaskFlow.
func ValidateScheduledTaskFlow(taskFlow any) ValidationResult {
	if !taskFlowIsArray(taskFlow) {
		return ValidationResult{Success: false, Message: "任务流程格式无效"}
	}
	if raw, ok := taskFlow.([]any); ok {
		for index, item := range raw {
			if _, isRecord := item.(map[string]any); !isRecord {
				return ValidationResult{
					Success: false,
					Message: "任务流程中的每一项都必须是对象",
					Details: map[string]any{"index": index},
				}
			}
		}
	}

	tasks, _ := taskFlowSlice(taskFlow)
	for index, task := range tasks {
		if task == nil {
			return ValidationResult{
				Success: false,
				Message: "任务流程中的每一项都必须是对象",
				Details: map[string]any{"index": index},
			}
		}
	}

	for _, task := range tasks {
		if explicitlyDisabled(task) {
			continue
		}
		if stringField(task, "taskType") == "Infrast" {
			params := taskParams(task)
			if mode, _ := numberField(params, "mode"); mode == 10000 {
				if strings.TrimSpace(stringField(params, "filename")) == "" {
					return ValidationResult{Success: false, Message: "自定义换班需要填写排班文件路径"}
				}
			}
		}
	}

	for _, task := range tasks {
		if explicitlyDisabled(task) {
			continue
		}
		commandID := taskCommandID(task)
		if commandID != "fight" {
			continue
		}
		if _, valid := parseDropTargetEntries(taskParams(task)["drops"]); !valid {
			return ValidationResult{Success: false, Message: "掉落目标格式应为物品 ID=数量，多个目标用逗号分隔"}
		}
	}

	return ValidationResult{Success: true}
}

// BuildScheduledTaskFlowPlan mirrors buildScheduledTaskFlowPlan.
func BuildScheduledTaskFlowPlan(taskFlow any, defaults ConnectionDefaults) PlanResult {
	validation := ValidateScheduledTaskFlow(taskFlow)
	if !validation.Success {
		return PlanResult{Success: false, Message: validation.Message, Details: validation.Details}
	}

	tasks, _ := taskFlowSlice(taskFlow)
	steps := make([]PlanStep, 0, len(tasks))
	for _, task := range tasks {
		if !taskEnabled(task) {
			continue
		}
		spec, err := BuildScheduledTaskCommand(task, defaults)
		if err != nil {
			return PlanResult{Success: false, Message: err.Error()}
		}
		name := stringField(task, "name")
		if name == "" {
			name = stringField(task, "commandId")
		}
		if name == "" {
			name = taskID(task)
		}
		step := PlanStep{
			Index:       len(steps) + 1,
			ID:          taskID(task),
			Name:        name,
			Command:     spec.Command,
			Args:        spec.Args,
			DynamicTask: spec.TaskConfig != nil,
		}
		if spec.TaskConfig != nil {
			step.TaskConfig = spec.TaskConfig
		}
		if spec.Command == "closedown" && boolField(taskParams(task), "recognizeDepotBeforeClose") {
			step.PreActions = []PlanPreAction{{Action: "depot-recognition"}}
		}
		steps = append(steps, step)
	}

	return PlanResult{Success: true, TotalSteps: len(steps), Steps: steps}
}

// needsConnection reports whether the flow contains an enabled startup or
// closedown task, matching getScheduledTaskFlowPlan.
func needsConnection(taskFlow any) bool {
	tasks, isArray := taskFlowSlice(taskFlow)
	if !isArray {
		return false
	}
	for _, task := range tasks {
		if !taskEnabled(task) {
			continue
		}
		commandID := taskCommandID(task)
		if commandID == "startup" || commandID == "closedown" {
			return true
		}
	}
	return false
}
