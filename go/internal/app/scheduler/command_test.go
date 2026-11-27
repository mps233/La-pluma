package scheduler

import "testing"

func TestBuildScheduledTaskCommandInfersTaskTypeFromCommandID(t *testing.T) {
	cases := []struct {
		commandID string
		taskType  string
	}{
		{"infrast", "Infrast"},
		{"recruit", "Recruit"},
		{"mall", "Mall"},
		{"award", "Award"},
		{"depot", "Depot"},
	}

	for _, tc := range cases {
		t.Run(tc.commandID, func(t *testing.T) {
			task := map[string]any{
				"id":        tc.commandID + "-1",
				"commandId": tc.commandID,
				"name":      tc.commandID,
				"enabled":   true,
				"params":    map[string]any{"clientType": "Official"},
			}
			spec, err := BuildScheduledTaskCommand(task, ConnectionDefaults{})
			if err != nil {
				t.Fatalf("build: %v", err)
			}
			// Without a task type this used to become "maa infrast", which
			// maa-cli rejects with a usage error (exit code 2).
			if spec.Command != "run" || spec.TaskConfig == nil {
				t.Fatalf("spec = %+v", spec)
			}
			if spec.TaskConfig["type"] != tc.taskType {
				t.Fatalf("task type = %+v, want %s", spec.TaskConfig["type"], tc.taskType)
			}
		})
	}
}

func TestBuildScheduledTaskCommandInfersTaskTypeFromTaskID(t *testing.T) {
	task := map[string]any{
		"id":      "recruit-1794107218042",
		"enabled": true,
		"params":  map[string]any{},
	}
	spec, err := BuildScheduledTaskCommand(task, ConnectionDefaults{})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if spec.Command != "run" || spec.TaskConfig == nil || spec.TaskConfig["type"] != "Recruit" {
		t.Fatalf("spec = %+v", spec)
	}
}

func TestBuildScheduledTaskCommandPrefersExplicitTaskType(t *testing.T) {
	task := map[string]any{
		"id":        "custom-1",
		"commandId": "infrast",
		"taskType":  "Custom",
		"enabled":   true,
		"params":    map[string]any{},
	}
	spec, err := BuildScheduledTaskCommand(task, ConnectionDefaults{})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if spec.TaskConfig == nil || spec.TaskConfig["type"] != "Custom" {
		t.Fatalf("spec = %+v", spec)
	}
}
