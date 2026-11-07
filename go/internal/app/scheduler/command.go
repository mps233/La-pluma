package scheduler

import (
	"fmt"
	"strconv"
	"strings"
)

// NormalizedFightStage is a stage/times pair after normalization. Times keeps
// the string form used by dynamic fight documents; TimesRaw preserves the
// original value so the static stage list matches JavaScript truthiness
// (numeric 0 is falsy, the string "0" is truthy).
type NormalizedFightStage struct {
	Stage    string
	Times    string
	TimesRaw any
}

// taskFlowSlice converts the two representable task-flow shapes. The boolean is
// false when the top-level value is not an array; element validation is done by
// ValidateScheduledTaskFlow.
func taskFlowSlice(value any) ([]map[string]any, bool) {
	switch typed := value.(type) {
	case []map[string]any:
		return typed, true
	case []any:
		tasks := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			record, ok := item.(map[string]any)
			if !ok {
				return nil, true
			}
			tasks = append(tasks, record)
		}
		return tasks, true
	default:
		return nil, false
	}
}

func taskFlowIsArray(value any) bool {
	switch value.(type) {
	case []map[string]any, []any:
		return true
	default:
		return false
	}
}

func taskID(task map[string]any) string {
	if value, ok := task["id"].(string); ok {
		return value
	}
	return jsString(task["id"])
}

func taskName(task map[string]any) string {
	if name := stringField(task, "name"); name != "" {
		return name
	}
	return taskID(task)
}

func taskCommandID(task map[string]any) string {
	if commandID := stringField(task, "commandId"); commandID != "" {
		return commandID
	}
	id := taskID(task)
	if index := strings.Index(id, "-"); index >= 0 {
		return id[:index]
	}
	return id
}

func taskParams(task map[string]any) map[string]any {
	return mapField(task, "params")
}

// normalizeFightStageEntries mirrors normalizeFightStageEntries.
func normalizeFightStageEntries(task map[string]any) []NormalizedFightStage {
	params := taskParams(task)
	var configured []any
	if stages, ok := params["stages"].([]any); ok {
		configured = stages
	} else if stages, ok := params["stages"].([]string); ok {
		configured = make([]any, 0, len(stages))
		for _, stage := range stages {
			configured = append(configured, stage)
		}
	} else {
		configured = []any{map[string]any{
			"stage": params["stage"],
			"times": params["times"],
		}}
	}

	stages := make([]NormalizedFightStage, 0, len(configured))
	for _, value := range configured {
		var stage string
		var times string
		var timesRaw any
		switch typed := value.(type) {
		case string:
			stage = strings.TrimSpace(typed)
		case map[string]any:
			stageValue, ok := typed["stage"].(string)
			if !ok {
				continue
			}
			stage = strings.TrimSpace(stageValue)
			timesValue := typed["times"]
			timesRaw = timesValue
			if timesValue != nil && jsString(timesValue) != "" {
				times = strings.TrimSpace(jsString(timesValue))
			}
		default:
			continue
		}
		if stage == "" {
			continue
		}
		stages = append(stages, NormalizedFightStage{Stage: stage, Times: times, TimesRaw: timesRaw})
	}
	return stages
}

func fightStageList(task map[string]any) string {
	stages := normalizeFightStageEntries(task)
	parts := make([]string, 0, len(stages))
	for _, stage := range stages {
		if truthy(stage.TimesRaw) {
			parts = append(parts, stage.Stage+":"+jsString(stage.TimesRaw))
		} else {
			parts = append(parts, stage.Stage)
		}
	}
	return strings.Join(parts, ",")
}

// buildDynamicFightTaskConfig mirrors buildDynamicFightTaskConfig. A nil result
// means the task does not need a dynamic Fight document.
func buildDynamicFightTaskConfig(task map[string]any, defaults ConnectionDefaults) (map[string]any, error) {
	if taskCommandID(task) != "fight" || stringField(task, "taskType") != "" {
		return nil, nil
	}
	params := taskParams(task)
	medicineExpireDays, _ := numberField(params, "medicineExpireDays")
	if medicineExpireDays == 0 {
		medicineExpireDays, _ = numberField(params, "medicine_expire_days")
	}
	server := strings.TrimSpace(jsString(params["server"]))
	series, hasSeries := numberValue(params["series"])
	if !hasSeries {
		series = 1
	}
	if !(medicineExpireDays > 0) && server == "" && !(series > 6) {
		return nil, nil
	}

	stages := normalizeFightStageEntries(task)
	if len(stages) == 0 {
		return nil, nil
	}

	dropEntries, validDrops := parseDropTargetEntries(params["drops"])
	if !validDrops {
		return nil, fmt.Errorf("掉落目标格式应为物品 ID=数量，多个目标用逗号分隔")
	}
	drops := dropTargetMap(dropEntries)

	clientType := firstNonEmptyString(params["clientType"], params["client_type"], defaults.ClientType)
	if clientType == "" {
		clientType = DefaultClientType
	}

	commonParams := map[string]any{}
	if value := params["medicine"]; value != nil && jsString(value) != "" {
		if number, ok := numberValue(value); ok {
			commonParams["medicine"] = number
		}
	}
	if value := params["expiringMedicine"]; value != nil && jsString(value) != "" && !(medicineExpireDays > 0) {
		if number, ok := numberValue(value); ok {
			commonParams["expiring_medicine"] = number
		}
	}
	if medicineExpireDays > 0 {
		commonParams["medicine_expire_days"] = medicineExpireDays
	}
	if value := params["stone"]; value != nil && jsString(value) != "" {
		if number, ok := numberValue(value); ok {
			commonParams["stone"] = number
		}
	}
	if value := params["series"]; value != nil && jsString(value) != "" {
		if number, ok := numberValue(value); ok {
			commonParams["series"] = number
		}
	}
	if drops != nil {
		commonParams["drops"] = drops
	}
	if server != "" {
		commonParams["server"] = server
	}
	if value, ok := params["DrGrandet"].(bool); ok {
		commonParams["DrGrandet"] = value
	}
	if value, ok := params["report_to_penguin"].(bool); ok {
		commonParams["report_to_penguin"] = value
	}
	if id := strings.TrimSpace(stringField(params, "penguin_id")); id != "" {
		commonParams["penguin_id"] = id
	}
	if value, ok := params["report_to_yituliu"].(bool); ok {
		commonParams["report_to_yituliu"] = value
	}
	if id := strings.TrimSpace(stringField(params, "yituliu_id")); id != "" {
		commonParams["yituliu_id"] = id
	}

	tasks := make([]any, 0, len(stages))
	fightName := stringField(task, "name")
	if fightName == "" {
		fightName = "理智作战"
	}
	for _, stage := range stages {
		stageParams := copyMap(commonParams)
		stageParams["stage"] = stage.Stage
		if stage.Times != "" {
			if number, ok := numberValue(stage.Times); ok {
				stageParams["times"] = number
			}
		}
		tasks = append(tasks, map[string]any{
			"name":   fmt.Sprintf("%s (%s)", fightName, stage.Stage),
			"type":   "Fight",
			"params": stageParams,
		})
	}

	return map[string]any{
		"name":        fightName,
		"type":        "Fight",
		"client_type": clientType,
		"tasks":       tasks,
	}, nil
}

// BuildScheduledTaskCommand mirrors buildScheduledTaskCommand.
func BuildScheduledTaskCommand(task map[string]any, defaults ConnectionDefaults) (CommandSpec, error) {
	if taskType := stringField(task, "taskType"); taskType != "" {
		params := copyMap(taskParams(task))
		clientType := firstNonEmptyString(params["clientType"], params["client_type"], defaults.ClientType)
		if clientType == "" {
			clientType = DefaultClientType
		}
		delete(params, "clientType")
		delete(params, "client_type")

		if taskType == "Recruit" {
			if _, ok := params["preserve_tags"]; !ok && boolField(params, "skip_robot") {
				params["preserve_tags"] = []string{"支援机械"}
			}
			if recruitmentTime := mapField(params, "recruitment_time"); recruitmentTime != nil {
				converted := make(map[string]any, len(recruitmentTime))
				for level, minutes := range recruitmentTime {
					if number, ok := numberValue(minutes); ok {
						converted[level] = number
					}
				}
				params["recruitment_time"] = converted
			}
			delete(params, "skip_robot")
		}
		if taskType == "Infrast" {
			if mode, _ := numberField(params, "mode"); mode == 10000 {
				if strings.TrimSpace(stringField(params, "filename")) == "" {
					return CommandSpec{}, fmt.Errorf("自定义换班需要填写排班文件路径")
				}
				if _, ok := params["plan_index"]; !ok {
					params["plan_index"] = 0
				}
			}
		}

		config := map[string]any{
			"type":        taskType,
			"client_type": clientType,
			"params":      normalizeTaskParams(params, taskType),
		}
		if name := stringField(task, "name"); name != "" {
			config["name"] = name
		}
		if condition, ok := task["condition"]; ok && truthy(condition) {
			config["condition"] = condition
		}
		if variants, ok := task["variants"].([]any); ok {
			config["variants"] = variants
		}

		taskID := stringField(task, "commandId")
		if taskID == "" {
			taskID = taskIDValue(task)
		}
		args := []string{}
		if taskID != "" {
			args = append(args, taskID)
		}
		return CommandSpec{Command: "run", Args: args, TaskConfig: config}, nil
	}

	commandID := taskCommandID(task)
	params := taskParams(task)
	if commandID == "startup" {
		if startGameEnabled, ok := params["startGameEnabled"].(bool); ok && !startGameEnabled {
			clientType := firstNonEmptyString(params["clientType"], defaults.ClientType)
			if clientType == "" {
				clientType = DefaultClientType
			}
			configParams := map[string]any{"start_game_enabled": false}
			if accountName := strings.TrimSpace(stringField(params, "accountName")); accountName != "" {
				configParams["account_name"] = accountName
			}
			name := stringField(task, "name")
			if name == "" {
				name = "启动游戏"
			}
			return CommandSpec{
				Command: "run",
				Args:    []string{"startup"},
				TaskConfig: map[string]any{
					"name":        name,
					"type":        "StartUp",
					"client_type": clientType,
					"params":      configParams,
				},
			}, nil
		}
	}

	dynamicConfig, err := buildDynamicFightTaskConfig(task, defaults)
	if err != nil {
		return CommandSpec{}, err
	}
	if dynamicConfig != nil {
		return CommandSpec{
			Command:    "run",
			Args:       []string{commandID},
			TaskConfig: dynamicConfig,
		}, nil
	}

	args := make([]string, 0, 10)
	if commandID == "startup" || commandID == "closedown" {
		if defaults.Address != "" {
			args = append(args, "-a", defaults.Address)
		}
		if commandID == "startup" {
			if accountName := stringField(params, "accountName"); accountName != "" {
				args = append(args, "--account-name", accountName)
			}
		}
		clientType := firstNonEmptyString(params["clientType"])
		if clientType == "" {
			clientType = DefaultClientType
		}
		args = append(args, clientType)
	} else if commandID == "fight" {
		if stages := fightStageList(task); stages != "" {
			args = append(args, stages)
		}
		if value := params["medicine"]; value != nil && jsString(value) != "" {
			args = append(args, "-m", jsString(value))
		}
		if value := params["expiringMedicine"]; value != nil && jsString(value) != "" {
			args = append(args, "--expiring-medicine", jsString(value))
		}
		if value := params["stone"]; value != nil && jsString(value) != "" {
			args = append(args, "--stone", jsString(value))
		}
		if value := params["series"]; value != nil && jsString(value) != "" {
			// The Node check compares against the string '1'; numeric 1 is
			// still emitted there, so preserve that behavior.
			text, isString := value.(string)
			if !isString || text != "1" {
				args = append(args, "--series="+jsString(value))
			}
		}
		dropTargets, valid := parseDropTargetEntries(params["drops"])
		if !valid {
			return CommandSpec{}, fmt.Errorf("掉落目标格式应为物品 ID=数量，多个目标用逗号分隔")
		}
		for _, target := range dropTargets {
			args = append(args, "-D"+target)
		}
		if clientType := stringField(params, "clientType"); clientType != "" {
			args = append(args, "--client-type", clientType)
		}
		if truthy(params["DrGrandet"]) {
			args = append(args, "--dr-grandet")
		}
		if truthy(params["report_to_penguin"]) {
			args = append(args, "--report-to-penguin")
			if id := strings.TrimSpace(stringField(params, "penguin_id")); id != "" {
				args = append(args, "--penguin-id", id)
			}
		}
		if truthy(params["report_to_yituliu"]) {
			args = append(args, "--report-to-yituliu")
			if id := strings.TrimSpace(stringField(params, "yituliu_id")); id != "" {
				args = append(args, "--yituliu-id", id)
			}
		}
	}

	return CommandSpec{Command: commandID, Args: args}, nil
}

func taskIDValue(task map[string]any) string {
	return jsString(task["id"])
}

// normalizeTaskParams mirrors the per-key conversion in
// buildScheduledTaskCommand's dynamic task branch.
func normalizeTaskParams(params map[string]any, taskType string) map[string]any {
	normalized := make(map[string]any, len(params))
	for key, value := range params {
		if value == nil {
			continue
		}
		if text, ok := value.(string); ok && text == "" {
			continue
		}
		if key == "calculationOnly" {
			if enabled, ok := value.(bool); ok && enabled && taskType == "Recruit" {
				normalized["times"] = float64(0)
				normalized["confirm"] = []any{}
				normalized["set_time"] = false
			}
			continue
		}

		switch typed := value.(type) {
		case bool:
			normalized[key] = typed
		case []any:
			if len(typed) > 0 {
				normalized[key] = typed
			}
		case []string:
			if len(typed) > 0 {
				normalized[key] = typed
			}
		case string:
			trimmed := strings.TrimSpace(typed)
			if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
				normalized[key] = trimmed
				continue
			}
			_, commaKey := commaSeparatedArrayKeys[key]
			if commaKey || (strings.Contains(typed, ",") && !strings.Contains(typed, "[")) {
				parts := make([]string, 0, 4)
				for _, part := range strings.Split(typed, ",") {
					if trimmedPart := strings.TrimSpace(part); trimmedPart != "" {
						parts = append(parts, trimmedPart)
					}
				}
				normalized[key] = parts
				continue
			}
			if number, err := strconv.ParseFloat(trimmed, 64); err == nil && trimmed != "" {
				normalized[key] = number
			} else if typed != "" {
				normalized[key] = typed
			}
		default:
			if number, ok := numericValue(value); ok {
				normalized[key] = number
			} else if truthy(value) {
				normalized[key] = value
			}
		}
	}
	return normalized
}
