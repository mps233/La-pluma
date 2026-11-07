package contract

// Agent task commands accepted by the run_task operation. The order matches
// AGENT_TASK_COMMANDS in the Node oracle and is user-visible through the
// command enum.
var agentTaskCommands = []string{
	"startup",
	"closedown",
	"fight",
	"infrast",
	"recruit",
	"mall",
	"award",
	"copilot",
	"ssscopilot",
	"paradoxcopilot",
	"roguelike",
	"reclamation",
	"depot",
	"operbox",
	"activity",
	"run",
	"list",
}

func runtimeDefaultString(key string) map[string]any {
	return map[string]any{
		"type":                       "string",
		"x-la-pluma-runtime-default": key,
	}
}

func profileIDProperty() map[string]any {
	return map[string]any{
		"type":        "string",
		"minLength":   1,
		"maxLength":   64,
		"pattern":     "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$",
		"default":     "default",
		"description": "Saved connection profile id. Explicit connection fields override values loaded from this profile.",
	}
}

func runIDProperty() map[string]any {
	return map[string]any{
		"type":        "string",
		"format":      "uuid",
		"description": "Server-generated id for one Agent API execution.",
	}
}

func idempotencyKeyProperty() map[string]any {
	return map[string]any{
		"type":        "string",
		"minLength":   1,
		"maxLength":   128,
		"pattern":     "^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$",
		"description": "Client-generated key that identifies one logical execution request.",
	}
}

func objectSchema(properties map[string]any) map[string]any {
	return map[string]any{
		"type":       "object",
		"properties": properties,
	}
}

func requiredObjectSchema(properties map[string]any, required ...string) map[string]any {
	return map[string]any{
		"type":       "object",
		"required":   required,
		"properties": properties,
	}
}

func stringEnum(values ...string) []string {
	return append([]string{}, values...)
}
