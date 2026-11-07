package scheduler

import (
	"reflect"
	"testing"
)

func TestValidateScheduledTaskFlow(t *testing.T) {
	if result := ValidateScheduledTaskFlow(nil); result.Success || result.Message != "任务流程格式无效" {
		t.Fatalf("nil flow = %+v", result)
	}
	nonObject := ValidateScheduledTaskFlow([]any{"bad"})
	if nonObject.Success || nonObject.Message != "任务流程中的每一项都必须是对象" {
		t.Fatalf("non object = %+v", nonObject)
	}
	if nonObject.Details["index"] != 0 {
		t.Fatalf("non object details = %+v", nonObject.Details)
	}

	customInfrast := ValidateScheduledTaskFlow([]any{
		map[string]any{
			"id":       "infrast-1",
			"enabled":  true,
			"taskType": "Infrast",
			"params":   map[string]any{"mode": float64(10000), "filename": ""},
		},
	})
	if customInfrast.Success || customInfrast.Message != "自定义换班需要填写排班文件路径" {
		t.Fatalf("custom infrast = %+v", customInfrast)
	}

	badDrops := ValidateScheduledTaskFlow([]any{
		map[string]any{
			"id":        "fight-1",
			"commandId": "fight",
			"enabled":   true,
			"params":    map[string]any{"drops": "item-without-count"},
		},
	})
	if badDrops.Success || badDrops.Message != "掉落目标格式应为物品 ID=数量，多个目标用逗号分隔" {
		t.Fatalf("bad drops = %+v", badDrops)
	}

	valid := ValidateScheduledTaskFlow([]any{
		map[string]any{
			"id":        "fight-1",
			"commandId": "fight",
			"enabled":   true,
			"params":    map[string]any{"drops": "30012=5,30011=2"},
		},
	})
	if !valid.Success {
		t.Fatalf("valid flow = %+v", valid)
	}

	// Disabled invalid tasks do not block a valid schedule.
	disabled := ValidateScheduledTaskFlow([]any{
		map[string]any{
			"id":       "infrast-1",
			"enabled":  false,
			"taskType": "Infrast",
			"params":   map[string]any{"mode": float64(10000)},
		},
	})
	if !disabled.Success {
		t.Fatalf("disabled invalid task = %+v", disabled)
	}
}

func TestBuildScheduledTaskFlowPlan(t *testing.T) {
	flow := []any{
		map[string]any{
			"id":        "startup-1",
			"commandId": "startup",
			"name":      "启动游戏",
			"enabled":   true,
			"params":    map[string]any{"clientType": "Bilibili"},
		},
		map[string]any{
			"id":        "fight-1",
			"commandId": "fight",
			"name":      "理智作战",
			"enabled":   true,
			"params": map[string]any{
				"stages":   []any{map[string]any{"stage": "CE-6", "times": "3"}, map[string]any{"stage": "LS-6"}},
				"medicine": "1",
				"series":   "2",
				"drops":    "30012=5",
			},
		},
		map[string]any{
			"id":        "mall-1",
			"commandId": "mall",
			"enabled":   false,
			"params":    map[string]any{},
		},
		map[string]any{
			"id":        "closedown-1",
			"commandId": "closedown",
			"name":      "关闭游戏",
			"enabled":   true,
			"params":    map[string]any{"recognizeDepotBeforeClose": true},
		},
	}

	plan := BuildScheduledTaskFlowPlan(flow, ConnectionDefaults{Address: "127.0.0.1:5555"})
	if !plan.Success {
		t.Fatalf("plan failed: %+v", plan)
	}
	if plan.TotalSteps != 3 || len(plan.Steps) != 3 {
		t.Fatalf("plan steps = %+v", plan)
	}

	startup := plan.Steps[0]
	if startup.Command != "startup" || !reflect.DeepEqual(startup.Args, []string{"-a", "127.0.0.1:5555", "Bilibili"}) {
		t.Fatalf("startup step = %+v", startup)
	}

	fight := plan.Steps[1]
	wantFightArgs := []string{"CE-6:3,LS-6", "-m", "1", "--series=2", "-D30012=5"}
	if fight.Command != "fight" || !reflect.DeepEqual(fight.Args, wantFightArgs) {
		t.Fatalf("fight step = %+v", fight)
	}

	closedown := plan.Steps[2]
	if closedown.Command != "closedown" || len(closedown.PreActions) != 1 || closedown.PreActions[0].Action != "depot-recognition" {
		t.Fatalf("closedown step = %+v", closedown)
	}
}

func TestBuildDynamicFightTaskPlan(t *testing.T) {
	flow := []any{
		map[string]any{
			"id":        "fight-1",
			"commandId": "fight",
			"enabled":   true,
			"params": map[string]any{
				"stages":             []any{map[string]any{"stage": "CE-6", "times": "2"}},
				"medicineExpireDays": float64(3),
				"drops":              "30012=5,30011=2",
				"clientType":         "Official",
			},
		},
	}
	plan := BuildScheduledTaskFlowPlan(flow, ConnectionDefaults{})
	if !plan.Success || len(plan.Steps) != 1 {
		t.Fatalf("plan = %+v", plan)
	}
	step := plan.Steps[0]
	if step.Command != "run" || !step.DynamicTask || step.TaskConfig == nil {
		t.Fatalf("step = %+v", step)
	}
	if step.TaskConfig["type"] != "Fight" || step.TaskConfig["client_type"] != "Official" {
		t.Fatalf("task config = %+v", step.TaskConfig)
	}
	tasks, ok := step.TaskConfig["tasks"].([]any)
	if !ok || len(tasks) != 1 {
		t.Fatalf("tasks = %+v", step.TaskConfig["tasks"])
	}
	task := tasks[0].(map[string]any)
	params := task["params"].(map[string]any)
	if params["stage"] != "CE-6" || params["times"] != float64(2) || params["medicine_expire_days"] != float64(3) {
		t.Fatalf("dynamic params = %+v", params)
	}
	drops, ok := params["drops"].(map[string]any)
	if !ok || drops["30012"] != float64(5) || drops["30011"] != float64(2) {
		t.Fatalf("drops = %+v", params["drops"])
	}
}

func TestBuildTaskTypeCommandNormalizesParams(t *testing.T) {
	task := map[string]any{
		"id":       "recruit-1",
		"name":     "自动公招",
		"taskType": "Recruit",
		"params": map[string]any{
			"clientType":       "Bilibili",
			"skip_robot":       true,
			"recruitment_time": map[string]any{"3": "240"},
			"first_tags":       "高级资深干员,资深干员",
			"times":            "4",
			"confirm":          []any{"3", "4"},
			"set_time":         true,
		},
	}
	spec, err := BuildScheduledTaskCommand(task, ConnectionDefaults{})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if spec.Command != "run" || spec.TaskConfig == nil {
		t.Fatalf("spec = %+v", spec)
	}
	if spec.TaskConfig["client_type"] != "Bilibili" {
		t.Fatalf("client type = %+v", spec.TaskConfig["client_type"])
	}
	params := spec.TaskConfig["params"].(map[string]any)
	if _, exists := params["skip_robot"]; exists {
		t.Fatalf("skip_robot should be removed: %+v", params)
	}
	if !reflect.DeepEqual(params["preserve_tags"], []string{"支援机械"}) {
		t.Fatalf("preserve_tags = %+v", params["preserve_tags"])
	}
	recruitmentTime := params["recruitment_time"].(map[string]any)
	if recruitmentTime["3"] != float64(240) {
		t.Fatalf("recruitment_time = %+v", recruitmentTime)
	}
	if !reflect.DeepEqual(params["first_tags"], []string{"高级资深干员", "资深干员"}) {
		t.Fatalf("first_tags = %+v", params["first_tags"])
	}
	if params["times"] != float64(4) || params["set_time"] != true {
		t.Fatalf("params = %+v", params)
	}

	if _, err := BuildScheduledTaskCommand(map[string]any{
		"id":       "infrast-1",
		"taskType": "Infrast",
		"params":   map[string]any{"mode": float64(10000)},
	}, ConnectionDefaults{}); err == nil {
		t.Fatal("custom infrast without filename should fail")
	}
}

func TestParseDropTargetEntries(t *testing.T) {
	got, ok := parseDropTargetEntries("30012=5, 30011 = 2")
	if !ok || !reflect.DeepEqual(got, []string{"30012=5", "30011=2"}) {
		t.Fatalf("entries = %v, ok = %v", got, ok)
	}
	if _, ok := parseDropTargetEntries("30012=0"); ok {
		t.Fatal("zero count should be invalid")
	}
	if _, ok := parseDropTargetEntries(map[string]any{"30012": float64(5)}); !ok {
		t.Fatal("map drops should be valid")
	}
	empty, ok := parseDropTargetEntries(nil)
	if !ok || len(empty) != 0 {
		t.Fatalf("nil drops = %v, ok = %v", empty, ok)
	}
}
