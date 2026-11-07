package contract

var registry = buildRegistry()

func buildRegistry() []Operation {
	operations := make([]Operation, 0, 32)

	operations = append(operations,
		operation(
			"get_manifest",
			"GET",
			"/api/agent/manifest",
			"Discover AI-readable capabilities and action contracts.",
		).hidden().withTags("Discovery"),

		operation(
			"get_openapi",
			"GET",
			"/api/agent/openapi.json",
			"Return the OpenAPI 3.1 contract for the Agent API.",
		).hidden().withResponseKind("openapi").withTags("Discovery"),

		operation(
			"get_status",
			"GET",
			"/api/agent/status",
			"Return a compact, AI-readable summary of La Pluma, MAA, ADB, WebRTC, and recent logs.",
		).withTags("Status").
			withSafety(lowRiskWriteSafety([]string{"adb_connect"}, safetyOptions{idempotent: boolPtr(true)})).
			withQuerySchema(objectSchema(map[string]any{
				"profileId": profileIDProperty(),
				"adbPath":   runtimeDefaultString("adbPath"),
				"address":   runtimeDefaultString("adbAddress"),
				"slim": map[string]any{
					"type":        "boolean",
					"default":     false,
					"description": "Return only api version, MAA version and current task status; skips ADB/WebRTC/display probes.",
				},
			})),

		operation(
			"test_connection",
			"POST",
			"/api/agent/actions/test-connection",
			"Check ADB availability and emulator connectivity.",
		).withTags("Connection").
			withSafety(lowRiskWriteSafety([]string{"adb_connect"}, safetyOptions{})).
			withBodySchema(objectSchema(map[string]any{
				"profileId": profileIDProperty(),
				"adbPath":   runtimeDefaultString("adbPath"),
				"address":   runtimeDefaultString("adbAddress"),
			})),

		operation(
			"discover_devices",
			"GET",
			"/api/agent/actions/discover-devices",
			"List ADB-visible devices and reachable common local emulator ports.",
		).withTags("Connection").
			withSafety(lowRiskWriteSafety([]string{"probe_local_adb_ports"}, safetyOptions{})).
			withQuerySchema(objectSchema(map[string]any{
				"profileId": profileIDProperty(),
				"adbPath":   runtimeDefaultString("adbPath"),
			})),

		operation(
			"activity_run_preflight",
			"GET",
			"/api/agent/activity/preflight",
			"Check the current activity and whether MAA has reliable home-screen navigation. This never starts a copilot.",
		).withTags("Activity").
			withQuerySchema(objectSchema(map[string]any{
				"profileId":  profileIDProperty(),
				"clientType": runtimeDefaultString("clientType"),
			})),

		operation(
			"activity_copilot_candidates",
			"GET",
			"/api/agent/activity/copilot-candidates",
			"Find manual-selection copilot candidates for the current activity. This never starts a copilot.",
		).withTags("Activity").
			withQuerySchema(objectSchema(map[string]any{
				"profileId":  profileIDProperty(),
				"clientType": runtimeDefaultString("clientType"),
			})),

		operation(
			"run_current_activity_copilots",
			"POST",
			"/api/agent/activity/run",
			"Run the server-built current-activity copilot plan. It restarts the game, navigates to the activity stage, and blocks when navigation or a reliable candidate is unavailable.",
		).withTags("Activity").
			withSafety(consequentialSafety(
				[]string{"start_game_automation", "close_game_automation", "consume_in_game_resources"},
				safetyOptions{},
			)).
			withExecution(execution(executionOptions{
				mode:            "long-running",
				pollAction:      stringPtr("get_current_run"),
				stopAction:      stringPtr("stop_task"),
				preflightAction: stringPtr("activity_run_preflight"),
				conflictsWith:   []string{"maa-execution"},
				producesRun:     true,
				idempotency:     idempotencyPolicy(nil),
			})).
			withBodySchema(objectSchema(map[string]any{
				"profileId":  profileIDProperty(),
				"clientType": runtimeDefaultString("clientType"),
			})),

		operation(
			"start_game",
			"POST",
			"/api/agent/actions/start-game",
			"Run maa startup for the selected client. Default is Official.",
		).withTags("Execution").
			withSafety(consequentialSafety([]string{"launch_game"}, safetyOptions{})).
			withExecution(execution(executionOptions{
				mode:              "sync-or-background",
				waitForCompletion: true,
				pollAction:        stringPtr("get_current_run"),
				stopAction:        stringPtr("stop_task"),
				conflictsWith:     []string{"maa-execution"},
				producesRun:       true,
				idempotency:       idempotencyPolicy(nil),
			})).
			withBodySchema(objectSchema(map[string]any{
				"profileId":         profileIDProperty(),
				"clientType":        runtimeDefaultString("clientType"),
				"address":           runtimeDefaultString("adbAddress"),
				"accountName":       map[string]any{"type": "string", "description": "Optional account name fragment to switch to after launch."},
				"startGameEnabled":  map[string]any{"type": "boolean", "default": true, "description": "Set false to initialize MAA without launching the game client."},
				"waitForCompletion": map[string]any{"type": "boolean", "default": true},
			})),

		operation(
			"fight",
			"POST",
			"/api/agent/actions/fight",
			"Semantic action for 理智作战. Agents can pass stages/medicine/stone/series without knowing maa-cli flags.",
		).withTags("Execution").
			withSafety(consequentialSafety(
				[]string{"start_game_automation", "consume_sanity", "optionally_consume_medicine_or_originium"},
				safetyOptions{},
			)).
			withExecution(execution(executionOptions{
				mode:              "sync-or-background",
				dryRun:            true,
				waitForCompletion: true,
				pollAction:        stringPtr("get_current_run"),
				stopAction:        stringPtr("stop_task"),
				conflictsWith:     []string{"maa-execution"},
				producesRun:       true,
				idempotency:       idempotencyPolicy(map[string]any{"dryRun": false}),
			})).
			withBodySchema(requiredObjectSchema(map[string]any{
				"stages": map[string]any{
					"type":     "array",
					"minItems": 1,
					"items": map[string]any{
						"oneOf": []any{
							map[string]any{"type": "string", "examples": []string{"1-7"}},
							map[string]any{
								"type":     "object",
								"required": []string{"stage"},
								"properties": map[string]any{
									"stage": map[string]any{"type": "string", "examples": []string{"CE-6"}},
									"times": map[string]any{"type": []string{"integer", "string"}, "description": "Optional per-stage run count."},
								},
							},
						},
					},
					"examples": []any{[]string{"HD-7", "CE-6", "AP-5"}},
				},
				"medicine":           map[string]any{"type": []string{"integer", "string"}, "default": 0, "description": "Normal sanity medicine count for -m."},
				"medicineExpireDays": map[string]any{"type": []string{"integer", "string"}, "default": 0, "description": "Use sanity medicine expiring within N days; requires a dynamic Fight task."},
				"expiringMedicine":   map[string]any{"type": []string{"integer", "string"}, "default": 0, "description": "Expiring sanity medicine count (deprecated by MAA in favor of medicineExpireDays)."},
				"stone":              map[string]any{"type": []string{"integer", "string"}, "default": 0, "description": "Originium stone count."},
				"series":             map[string]any{"type": []string{"integer", "string"}, "default": 0, "description": "MAA series value; 7–10 require a dynamic Fight task."},
				"server":             map[string]any{"type": "string", "enum": stringEnum("CN", "US", "JP", "KR"), "description": "Drop recognition/upload server; requires a dynamic Fight task."},
				"drops": map[string]any{
					"oneOf": []any{
						map[string]any{
							"type":                 "object",
							"additionalProperties": map[string]any{"type": []string{"integer", "string"}},
							"examples":             []any{map[string]any{"30011": 10, "30062": 5}},
						},
						map[string]any{"type": "string", "examples": []string{"30011=10,30062=5"}},
					},
					"description": "Stop when any drop target is reached; requires a dynamic Fight task.",
				},
				"reportToPenguin":   map[string]any{"type": "boolean", "default": false},
				"penguinId":         map[string]any{"type": "string"},
				"reportToYituliu":   map[string]any{"type": "boolean", "default": false},
				"yituliuId":         map[string]any{"type": "string"},
				"DrGrandet":         map[string]any{"type": "boolean", "default": false},
				"clientType":        runtimeDefaultString("clientType"),
				"dryRun":            map[string]any{"type": "boolean", "default": false},
				"waitForCompletion": map[string]any{"type": "boolean", "default": true},
			}, "stages")),

		operation(
			"run_task",
			"POST",
			"/api/agent/actions/run-task",
			"Run one whitelisted maa-cli task with explicit args. Prefer semantic actions when available.",
		).withTags("Execution").
			withSafety(consequentialSafety([]string{"run_maa_command"}, safetyOptions{})).
			withExecution(execution(executionOptions{
				mode:              "sync-or-background",
				waitForCompletion: true,
				pollAction:        stringPtr("get_current_run"),
				stopAction:        stringPtr("stop_task"),
				conflictsWith:     []string{"maa-execution"},
				producesRun:       true,
				idempotency:       idempotencyPolicy(nil),
			})).
			withBodySchema(requiredObjectSchema(map[string]any{
				"command": map[string]any{"type": "string", "enum": agentTaskCommands},
				"args":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "default": []string{}},
				"taskConfig": map[string]any{
					"oneOf": []any{
						map[string]any{
							"type":     "object",
							"required": []string{"name", "type"},
							"properties": map[string]any{
								"name":   map[string]any{"type": "string", "minLength": 1},
								"type":   map[string]any{"type": "string", "minLength": 1},
								"params": map[string]any{"type": "object", "additionalProperties": true},
							},
							"additionalProperties": true,
						},
						map[string]any{"type": "string", "description": "A JSON-encoded task configuration object."},
					},
					"description": "When supplied, La Pluma writes a validated temporary MAA task and executes it.",
				},
				"taskName":          map[string]any{"type": "string", "maxLength": 160, "description": "Human-readable task name exposed through task status."},
				"taskType":          map[string]any{"type": "string", "maxLength": 64, "description": "Caller-defined task category exposed through task status."},
				"userResource":      map[string]any{"type": "boolean", "default": false},
				"waitForCompletion": map[string]any{"type": "boolean", "default": true},
			}, "command")),

		operation(
			"stop_task",
			"POST",
			"/api/agent/actions/stop",
			"Stop the currently running MAA task if any.",
		).withTags("Execution").
			withSafety(lowRiskWriteSafety([]string{"interrupt_running_automation"}, safetyOptions{
				idempotent:    boolPtr(true),
				mutatesDevice: boolPtr(true),
				destructive:   boolPtr(true),
			})).
			withBodySchema(objectSchema(map[string]any{
				"runId": runIDPropertyWithDescription("Optional guard: only stop the current execution when its run id matches."),
			})),

		operation(
			"get_current_run",
			"GET",
			"/api/agent/runs/current",
			"Return a compact current MAA task status, schedule execution state, and a short recent log tail for polling.",
		).withTags("Status").
			withQuerySchema(objectSchema(map[string]any{
				"lines": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"maximum":     500,
					"default":     80,
					"description": "Maximum number of recent log lines to include in recentLogs.",
				},
			})),

		operation(
			"get_run",
			"GET",
			"/api/agent/runs/{runId}",
			"Return the retained state and outcome of one Agent API execution.",
		).withTags("Status").
			withResponseKind("run").
			withPathSchema(requiredObjectSchema(map[string]any{
				"runId": runIDProperty(),
			}, "runId")),

		operation(
			"stop_run",
			"POST",
			"/api/agent/runs/{runId}/stop",
			"Stop one retained Agent run by id. Accepted runs are canceled without touching the device; running runs are stopped only when they are current.",
		).withTags("Execution").
			withSafety(lowRiskWriteSafety([]string{"interrupt_running_automation"}, safetyOptions{
				idempotent:    boolPtr(true),
				mutatesDevice: boolPtr(true),
				destructive:   boolPtr(true),
			})).
			withPathSchema(requiredObjectSchema(map[string]any{
				"runId": runIDProperty(),
			}, "runId")).
			withBodySchema(objectSchema(map[string]any{})),

		operation(
			"get_screenshot",
			"POST",
			"/api/agent/screen/screenshot",
			"Capture the emulator screen as base64 PNG with timestamp and dimensions.",
		).withTags("Preview").
			withSafety(lowRiskWriteSafety([]string{"adb_connect", "capture_screenshot"}, safetyOptions{})).
			withBodySchema(objectSchema(map[string]any{
				"profileId": profileIDProperty(),
				"adbPath":   runtimeDefaultString("adbPath"),
				"address":   runtimeDefaultString("adbAddress"),
			})),

		operation(
			"run_daily_flow",
			"POST",
			"/api/agent/actions/run-daily-flow",
			"Run the saved enabled automation task flow. Use dryRun=true first to inspect the command plan.",
		).withTags("Execution").
			withSafety(consequentialSafety([]string{"run_saved_automation_flow"}, safetyOptions{})).
			withExecution(execution(executionOptions{
				mode:          "long-running",
				dryRun:        true,
				pollAction:    stringPtr("get_current_run"),
				stopAction:    stringPtr("stop_task"),
				conflictsWith: []string{"maa-execution"},
				producesRun:   true,
				idempotency:   idempotencyPolicy(map[string]any{"dryRun": false}),
			})).
			withBodySchema(objectSchema(map[string]any{
				"dryRun":     map[string]any{"type": "boolean", "default": false},
				"scheduleId": map[string]any{"type": "string", "minLength": 1, "maxLength": 128, "default": "agent-daily-flow"},
				"taskFlow":   map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "Optional task flow override; defaults to saved automation-tasks config."},
			})),

		operation(
			"recent_logs",
			"GET",
			"/api/agent/logs/recent",
			"Return recent in-memory MAA logs with optional line count and an incremental sequence cursor.",
		).withTags("Logs").
			withQuerySchema(objectSchema(map[string]any{
				"lines": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"maximum":     500,
					"default":     80,
					"description": "Maximum number of log lines to return.",
				},
				"afterSequence": map[string]any{
					"type":        "integer",
					"minimum":     0,
					"default":     0,
					"description": "Return only entries newer than this sequence number; 0 returns the trailing window.",
				},
			})),

		operation(
			"maa_callback_summary",
			"GET",
			"/api/agent/logs/maa-callbacks",
			"Summarize BlackFlow, copilot precheck, stage navigation and public recruit callbacks from recent MAA logs.",
		).withTags("Logs").
			withQuerySchema(objectSchema(map[string]any{
				"lines": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"maximum":     5000,
					"default":     2000,
					"description": "Number of trailing MAA log lines to scan.",
				},
			})),

		operation(
			"webrtc_status",
			"GET",
			"/api/agent/webrtc/status",
			"Return WebRTC endpoint hints, the installed server version, and device-agent version status. Agents older than v0.4.3 are reported as outdated.",
		).withTags("Preview").
			withQuerySchema(objectSchema(map[string]any{
				"profileId": profileIDProperty(),
				"adbPath":   runtimeDefaultString("adbPath"),
				"address":   runtimeDefaultString("adbAddress"),
				"deviceId": map[string]any{
					"type":        "string",
					"default":     "mumu-la-pluma",
					"description": "ScrcpyOverWebRTC device id whose agent version should be inspected.",
				},
			})),

		operation(
			"webrtc_devices",
			"GET",
			"/api/agent/webrtc/devices",
			"Return online ScrcpyOverWebRTC device ids in an AI-readable shape. Retained offline records are excluded.",
		).withTags("Preview"),

		operation(
			"webrtc_snapshot",
			"GET",
			"/api/agent/webrtc/snapshot",
			"Return the latest ScrcpyOverWebRTC device snapshot as a base64 JPEG for dashboard fallback previews.",
		).withTags("Preview").
			withQuerySchema(objectSchema(map[string]any{
				"deviceId": map[string]any{
					"type":        "string",
					"default":     "mumu-la-pluma",
					"description": "ScrcpyOverWebRTC device id whose latest snapshot should be returned.",
				},
			})),

		operation(
			"webrtc_start",
			"POST",
			"/api/agent/webrtc/start",
			"Start signaling/TURN and MuMu agent, then return the same-origin signaling path, ICE servers, and device id.",
		).withTags("Preview").
			withSafety(lowRiskWriteSafety([]string{"start_local_webrtc_services"}, safetyOptions{mutatesDevice: boolPtr(true)})).
			withExecution(execution(executionOptions{mode: "long-running"})).
			withBodySchema(objectSchema(map[string]any{
				"profileId": profileIDProperty(),
				"adbPath":   runtimeDefaultString("adbPath"),
				"address":   runtimeDefaultString("adbAddress"),
				"deviceId":  map[string]any{"type": "string", "default": "mumu-la-pluma"},
			})),

		operation(
			"webrtc_stop",
			"POST",
			"/api/agent/webrtc/stop",
			"Stop MuMu agent and signaling/TURN managed by La Pluma.",
		).withTags("Preview").
			withSafety(lowRiskWriteSafety([]string{"stop_local_webrtc_services"}, safetyOptions{
				mutatesDevice: boolPtr(true),
				idempotent:    boolPtr(true),
			})).
			withBodySchema(objectSchema(map[string]any{
				"profileId": profileIDProperty(),
				"adbPath":   runtimeDefaultString("adbPath"),
				"address":   runtimeDefaultString("adbAddress"),
			})),

		operation(
			"preview_orientation",
			"POST",
			"/api/agent/preview/orientation",
			"Set Android emulator orientation for the live preview/device. Uses ADB settings + keyevent fallback and returns observed display state.",
		).withTags("Preview").
			withSafety(lowRiskWriteSafety([]string{"change_device_orientation"}, safetyOptions{mutatesDevice: boolPtr(true)})).
			withExecution(execution(executionOptions{dryRun: true})).
			withBodySchema(requiredObjectSchema(map[string]any{
				"orientation": map[string]any{"type": "string", "enum": stringEnum("portrait", "landscape", "auto")},
				"profileId":   profileIDProperty(),
				"adbPath":     runtimeDefaultString("adbPath"),
				"address":     runtimeDefaultString("adbAddress"),
				"dryRun":      map[string]any{"type": "boolean", "default": false},
			}, "orientation")),

		operation(
			"update_core",
			"POST",
			"/api/agent/actions/update-core",
			"Update MaaCore and its resources, optionally switching the stable/beta channel.",
		).hidden().withTags("Maintenance").
			withSafety(lowRiskWriteSafety([]string{"update_maa_core"}, safetyOptions{mutatesDevice: boolPtr(false)})).
			withExecution(maintenanceExecution()).
			withBodySchema(objectSchema(map[string]any{
				"version": map[string]any{"type": "string", "enum": stringEnum("stable", "beta")},
				"dryRun":  map[string]any{"type": "boolean", "default": false},
			})),

		operation(
			"hot_update_resources",
			"POST",
			"/api/agent/actions/hot-update-resources",
			"Run maa hot-update to refresh the configured resource source and hot-fix cache.",
		).hidden().withTags("Maintenance").
			withSafety(lowRiskWriteSafety([]string{"update_maa_resources"}, safetyOptions{mutatesDevice: boolPtr(false)})).
			withExecution(maintenanceExecution()).
			withBodySchema(objectSchema(map[string]any{
				"dryRun": map[string]any{"type": "boolean", "default": false},
			})),

		operation(
			"depot_recognition",
			"POST",
			"/api/agent/actions/depot-recognition",
			"Parse the latest DepotInfo callback from the MAA log and update the local depot cache.",
		).hidden().withTags("Data").
			withSafety(lowRiskWriteSafety([]string{"parse_maa_logs", "update_local_depot_cache"}, safetyOptions{mutatesDevice: boolPtr(false)})).
			withExecution(maintenanceExecution()).
			withBodySchema(objectSchema(map[string]any{
				"dryRun": map[string]any{"type": "boolean", "default": false},
			})),

		operation(
			"operbox_recognition",
			"POST",
			"/api/agent/actions/operbox-recognition",
			"Parse the latest OperBoxInfo callback from the MAA log and update the local operator cache.",
		).hidden().withTags("Data").
			withSafety(lowRiskWriteSafety([]string{"parse_maa_logs", "update_local_operbox_cache"}, safetyOptions{mutatesDevice: boolPtr(false)})).
			withExecution(maintenanceExecution()).
			withBodySchema(objectSchema(map[string]any{
				"dryRun": map[string]any{"type": "boolean", "default": false},
			})),

		operation(
			"get_current_activity",
			"GET",
			"/api/agent/activity",
			"Return the current event, available stages, source metadata, and completion state.",
		).withTags("Activity").
			withQuerySchema(objectSchema(map[string]any{
				"profileId":  profileIDProperty(),
				"clientType": runtimeDefaultString("clientType"),
			})),

		operation(
			"list_custom_tools",
			"GET",
			"/api/agent/custom-tools",
			"List whitelisted Custom tools and their parameter requirements.",
		).withTags("Tools"),

		operation(
			"run_custom_tool",
			"POST",
			"/api/agent/actions/run-custom-tool",
			"Run a whitelisted MaaCore Custom tool, such as pixel paint or material synthesis.",
		).withTags("Tools").
			withSafety(consequentialSafety([]string{"run_maa_command"}, safetyOptions{})).
			withExecution(execution(executionOptions{
				mode:              "sync-or-background",
				dryRun:            true,
				waitForCompletion: true,
				pollAction:        stringPtr("get_current_run"),
				stopAction:        stringPtr("stop_task"),
				conflictsWith:     []string{"maa-execution"},
				producesRun:       true,
				idempotency:       idempotencyPolicy(nil),
			})).
			withBodySchema(requiredObjectSchema(map[string]any{
				"toolId": map[string]any{
					"type": "string",
					"enum": stringEnum(
						"pixel-paint",
						"auto-raise-potential",
						"material-synthesis",
						"cursed-relic",
						"event-shop-blacklist",
					),
				},
				"params":            map[string]any{"type": "object", "additionalProperties": true, "default": map[string]any{}},
				"dryRun":            map[string]any{"type": "boolean", "default": false},
				"waitForCompletion": map[string]any{"type": "boolean", "default": true},
				"profileId":         profileIDProperty(),
			}, "toolId")),
	)

	return operations
}

func runIDPropertyWithDescription(description string) map[string]any {
	property := runIDProperty()
	property["description"] = description
	return property
}

func maintenanceExecution() Execution {
	return execution(executionOptions{
		dryRun:      true,
		producesRun: true,
		pollAction:  stringPtr("get_current_run"),
		stopAction:  stringPtr("stop_task"),
		idempotency: idempotencyPolicy(nil),
	})
}

// Operations returns a defensive copy of the registry in contract order.
func Operations() []Operation {
	result := make([]Operation, len(registry))
	for index, item := range registry {
		result[index] = cloneOperation(item)
	}
	return result
}
