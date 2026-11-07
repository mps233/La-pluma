package activity

import (
	"strings"
)

// FindMissingOperators mirrors activityCopilotSelectionService.
func FindMissingOperators(content any, ownedOperators map[string]struct{}) MissingOperatorInfo {
	if len(ownedOperators) == 0 {
		return MissingOperatorInfo{Names: []string{}, Unknown: true}
	}
	source := asRecord(content)
	if source == nil {
		source = map[string]any{}
	}
	requiredNames := readOperatorNames(source["opers"])
	missingNames := make([]string, 0, len(requiredNames))
	for _, name := range requiredNames {
		if _, owned := ownedOperators[name]; !owned {
			missingNames = append(missingNames, name)
		}
	}
	missingGroups := 0
	for _, rawGroup := range asArray(source["groups"]) {
		group := asRecord(rawGroup)
		if group == nil {
			continue
		}
		groupNames := readOperatorNames(group["opers"])
		if len(groupNames) == 0 {
			continue
		}
		satisfied := false
		for _, name := range groupNames {
			if _, owned := ownedOperators[name]; owned {
				satisfied = true
				break
			}
		}
		if !satisfied {
			missingGroups++
		}
	}
	return MissingOperatorInfo{
		Names:         missingNames,
		Count:         len(missingNames) + missingGroups,
		MissingGroups: missingGroups,
	}
}

func readOperatorNames(value any) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0)
	for _, raw := range asArray(value) {
		record := asRecord(raw)
		if record == nil {
			continue
		}
		name := strings.TrimSpace(jsStringOrEmpty(record["name"]))
		if name == "" {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		result = append(result, name)
	}
	return result
}

// CanRunWithOperators allows zero missing operators, or one missing operator
// only when the configured support slot can fill it.
func CanRunWithOperators(missing *MissingOperatorInfo, preferences any) bool {
	if missing == nil || missing.Count == 0 || missing.Unknown {
		return true
	}
	if missing.Count != 1 {
		return false
	}
	source := asRecord(preferences)
	if source == nil {
		source = map[string]any{}
	}
	if allow, ok := source["allowOneMissingOperator"].(bool); ok && !allow {
		return false
	}
	supportUsage := 0.0
	if truthy(source["supportUsage"]) {
		supportUsage = jsNumber(source["supportUsage"])
	}
	if supportUsage == 1 {
		return true
	}
	if supportUsage == 2 {
		supportName := strings.TrimSpace(jsStringOrEmpty(source["supportName"]))
		if supportName == "" {
			return false
		}
		for _, name := range missing.Names {
			if name == supportName {
				return true
			}
		}
	}
	return false
}

// AverageRatingLevel averages ratingLevel over the given records (0 for an
// empty list).
func AverageRatingLevel(items []any) float64 {
	if len(items) == 0 {
		return 0
	}
	total := 0.0
	for _, item := range items {
		record := asRecord(item)
		if record == nil {
			continue
		}
		total += jsNumber(record["ratingLevel"])
	}
	return total / float64(len(items))
}

func averageRunPlanRating(entries []RunPlanEntry) float64 {
	if len(entries) == 0 {
		return 0
	}
	total := 0.0
	for _, entry := range entries {
		total += entry.RatingLevel
	}
	return total / float64(len(entries))
}
