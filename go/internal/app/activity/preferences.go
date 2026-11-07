package activity

import (
	"context"
	"encoding/json"
	"strings"
)

// NormalizeRaid mirrors normalizeRaid. Only the exact strings "raid"/"1" and
// "both"/"2" are accepted, matching JavaScript strict equality.
func NormalizeRaid(value any) string {
	if text, ok := value.(string); ok {
		switch text {
		case "raid", "1":
			return "raid"
		case "both", "2":
			return "both"
		}
	}
	return "normal"
}

// GetCombatCopilotPreferences mirrors getCombatCopilotPreferences.
func GetCombatCopilotPreferences(combatTasks any) CombatCopilotPreferences {
	tasks := asRecord(combatTasks)
	if tasks == nil {
		tasks = map[string]any{}
	}
	advancedParams := asRecord(tasks["advancedParams"])
	if advancedParams == nil {
		advancedParams = map[string]any{}
	}
	preferences := asRecord(advancedParams["copilot"])
	if preferences == nil {
		preferences = map[string]any{}
	}
	autoFormation := asRecord(tasks["autoFormation"])
	if autoFormation == nil {
		autoFormation = map[string]any{}
	}

	return CombatCopilotPreferences{
		Raid:                    NormalizeRaid(preferences["raid"]),
		LoopTimes:               normalizeLoopTimes(preferences["loopTimes"]),
		IgnoreRequirements:      boolUnlessFalse(preferences["ignoreRequirements"]),
		UseSanityPotion:         preferences["useSanityPotion"] == true,
		AddTrust:                preferences["addTrust"] == true,
		FormationIndex:          preferences["formationIndex"],
		SupportUsage:            preferences["supportUsage"],
		SupportName:             preferences["supportName"],
		AllowOneMissingOperator: boolUnlessFalse(preferences["allowOneMissingOperator"]),
		FormationMode:           formationMode(autoFormation["copilot"]),
	}
}

func normalizeLoopTimes(value any) any {
	switch value.(type) {
	case string, json.Number:
		return value
	case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return value
	default:
		return 1
	}
}

func boolUnlessFalse(value any) bool {
	if flag, ok := value.(bool); ok && !flag {
		return false
	}
	return true
}

func formationMode(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return "auto"
}

// LoadActivitySelectionContext loads the combat preferences and, when an
// OperBox is available, the owned operator names. Failure to load the OperBox
// leaves OwnedOperators nil so filtering is skipped.
func (s *Service) LoadActivitySelectionContext(ctx context.Context) SelectionContext {
	var config map[string]any
	if s.configLoader != nil {
		loaded, err := s.configLoader.Load("combat-tasks")
		if err == nil {
			config = loaded
		}
	}
	preferences := GetCombatCopilotPreferences(config)

	var owned map[string]struct{}
	if s.operBoxLoader != nil {
		box, err := s.operBoxLoader.LoadOperBox(ctx)
		if err == nil {
			owned = ownedOperatorNames(box)
		}
	}
	return SelectionContext{Preferences: preferences, OwnedOperators: owned}
}

func ownedOperatorNames(box any) map[string]struct{} {
	boxRecord := asRecord(box)
	if boxRecord == nil {
		boxRecord = map[string]any{}
	}
	allOpers := asArray(boxRecord["allOpers"])
	hasOwnFlags := false
	for _, oper := range allOpers {
		if record := asRecord(oper); record != nil {
			if _, exists := record["own"]; exists {
				hasOwnFlags = true
				break
			}
		}
	}
	var source []any
	if hasOwnFlags {
		source = allOpers
	} else {
		source = asArray(boxRecord["data"])
	}

	names := make(map[string]struct{})
	for _, oper := range source {
		record := asRecord(oper)
		if record != nil {
			if own, ok := record["own"].(bool); ok && !own {
				continue
			}
		}
		name := ""
		if record != nil {
			name = strings.TrimSpace(jsStringOrEmpty(record["name"]))
		}
		if name != "" {
			names[name] = struct{}{}
		}
	}
	if len(names) == 0 {
		return nil
	}
	return names
}
