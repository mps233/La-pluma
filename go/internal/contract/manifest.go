package contract

// RuntimeDefaults are optional connection values substituted into schemas that
// carry an x-la-pluma-runtime-default marker. They are never read from the
// environment by this package.
type RuntimeDefaults struct {
	ADBPath    string
	ADBAddress string
	Address    string
	ClientType string
}

func normalizeDefaults(defaults RuntimeDefaults) map[string]string {
	values := map[string]string{}
	if defaults.ADBPath != "" {
		values["adbPath"] = defaults.ADBPath
	}
	address := defaults.ADBAddress
	if address == "" {
		address = defaults.Address
	}
	if address != "" {
		values["adbAddress"] = address
	}
	if defaults.ClientType != "" {
		values["clientType"] = defaults.ClientType
	}
	return values
}

func defaultsValue(defaults map[string]string) map[string]any {
	result := make(map[string]any, len(defaults))
	for key, value := range defaults {
		result[key] = value
	}
	return result
}

func materializeValue(value any, defaults map[string]string) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		defaultKey, _ := typed["x-la-pluma-runtime-default"].(string)
		for key, child := range typed {
			if key == "x-la-pluma-runtime-default" {
				continue
			}
			result[key] = materializeValue(child, defaults)
		}
		if defaultKey != "" {
			if resolved, ok := defaults[defaultKey]; ok {
				result["default"] = resolved
			}
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, child := range typed {
			result[index] = materializeValue(child, defaults)
		}
		return result
	case []string:
		return append([]string{}, typed...)
	default:
		return value
	}
}

func materializeSchema(schema map[string]any, defaults map[string]string) map[string]any {
	if schema == nil {
		return nil
	}
	result, _ := materializeValue(schema, defaults).(map[string]any)
	return result
}

// Manifest returns the AI-readable manifest without runtime connection
// defaults and with all 26 advertised actions.
func Manifest() map[string]any {
	return ManifestWithDefaults(RuntimeDefaults{})
}

// ManifestWithDefaults builds the manifest, substituting connection defaults
// into schema properties that declare a runtime default marker.
func ManifestWithDefaults(defaults RuntimeDefaults) map[string]any {
	normalized := normalizeDefaults(defaults)
	operations := Operations()
	actions := make([]any, 0, len(operations))
	for _, item := range operations {
		if !item.Advertised {
			continue
		}
		actions = append(actions, manifestAction(item, normalized))
	}

	return map[string]any{
		"name":        "La Pluma Agent API",
		"id":          "la-pluma-agent-api",
		"version":     APIVersion,
		"description": "AI-readable control surface for MAA / Arknights automation through La Pluma.",
		"auth": map[string]any{
			"type":         "optional-bearer-or-x-la-pluma-token",
			"requiredWhen": "LA_PLUMA_TOKEN is set on the backend",
			"schemes": []any{
				map[string]any{"type": "http-bearer", "header": "Authorization", "format": "Bearer <LA_PLUMA_TOKEN>"},
				map[string]any{"type": "api-key", "header": "X-La-Pluma-Token"},
			},
			"note": "Either token form is accepted. Authentication is disabled when LA_PLUMA_TOKEN is unset.",
		},
		"defaults": defaultsValue(normalized),
		"links": map[string]any{
			"status":     "/api/agent/status",
			"openapi":    "/api/agent/openapi.json",
			"currentRun": "/api/agent/runs/current",
			"run":        "/api/agent/runs/{runId}",
			"stopRun":    "/api/agent/runs/{runId}/stop",
			"screenshot": "/api/agent/screen/screenshot",
			"recentLogs": "/api/agent/logs/recent?lines=80",
		},
		"actions": actions,
	}
}

func manifestAction(item Operation, defaults map[string]string) map[string]any {
	action := map[string]any{
		"id":          item.ID,
		"method":      item.Method,
		"path":        item.Path,
		"description": item.Description,
	}
	if item.BodySchema != nil {
		action["body_schema"] = materializeValue(item.BodySchema, defaults)
	}
	if item.QuerySchema != nil {
		action["query_schema"] = materializeValue(item.QuerySchema, defaults)
	}
	if item.PathSchema != nil {
		action["path_schema"] = materializeValue(item.PathSchema, defaults)
	}
	if idempotencySupported(item.Execution) {
		action["header_schema"] = map[string]any{
			"type": "object",
			"properties": map[string]any{
				"Idempotency-Key": materializeValue(idempotencyKeyProperty(), defaults),
			},
		}
	}
	action["safety"] = safetyValue(item.Safety)
	action["execution"] = executionValue(item.Execution)
	return action
}
