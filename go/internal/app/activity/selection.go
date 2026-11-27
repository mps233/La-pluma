package activity

import (
	"github.com/mps233/la-pluma/go/internal/util/jsval"
	"strings"
)

// FindMissingOperators mirrors activityCopilotSelectionService.
func FindMissingOperators(content any, ownedOperators map[string]struct{}) MissingOperatorInfo {
	if len(ownedOperators) == 0 {
		return MissingOperatorInfo{Names: []string{}, Unknown: true}
	}
	source := jsval.Record(content)
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
	for _, rawGroup := range jsval.Array(source["groups"]) {
		group := jsval.Record(rawGroup)
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
	for _, raw := range jsval.Array(value) {
		record := jsval.Record(raw)
		if record == nil {
			continue
		}
		name := strings.TrimSpace(jsval.StringOrEmpty(record["name"]))
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
	source := jsval.Record(preferences)
	if source == nil {
		source = map[string]any{}
	}
	if allow, ok := source["allowOneMissingOperator"].(bool); ok && !allow {
		return false
	}
	supportUsage := 0.0
	if jsval.Truthy(source["supportUsage"]) {
		supportUsage = jsval.NumberOrZero(source["supportUsage"])
	}
	if supportUsage == 1 {
		return true
	}
	if supportUsage == 2 {
		supportName := strings.TrimSpace(jsval.StringOrEmpty(source["supportName"]))
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
