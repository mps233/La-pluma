package copilot

// NormalizeCopilotContentForMAA repairs operator requirement blocks that
// MaaCore rejects even though its own inference already implies the higher
// elite level. A PRTS plan that equips a module (or asks for skill mastery)
// while declaring a lower elite is self-contradictory; MaaCore aborts the
// whole copilot list instead of using the derived requirement. Raising the
// declared elite to MaaCore's own derived value is semantically neutral for
// the parse check and lets formation apply the plan (or its group fallbacks).
//
// The content is mutated in place and returned for chaining.
func NormalizeCopilotContentForMAA(content Content) Content {
	if content == nil {
		return content
	}
	normalizeOperList(ContentOpers(content))
	for _, rawGroup := range ContentGroups(content) {
		group := asRecord(rawGroup)
		if group == nil {
			continue
		}
		normalizeOperList(asArray(group["opers"]))
	}
	return content
}

func normalizeOperList(entries []any) {
	for _, raw := range entries {
		oper := asRecord(raw)
		if oper == nil {
			continue
		}
		requirements := asRecord(oper["requirements"])
		if requirements == nil {
			continue
		}
		declared, ok := integerValue(requirements["elite"])
		if !ok {
			continue
		}
		if required := derivedEliteRequirement(oper, requirements); required > declared {
			requirements["elite"] = required
		}
	}
}

// derivedEliteRequirement mirrors MaaCore CopilotConfig::parse_oper_usage:
// a skill index implies elite (skill 2 -> E1, skill 3 -> E2), skill mastery
// raises the floor, and any module requires E2.
func derivedEliteRequirement(oper, requirements map[string]any) int {
	skill, ok := integerValue(oper["skill"])
	if !ok || skill < 1 {
		skill = 1
	}
	required := skill - 1
	if required < 0 {
		required = 0
	}
	if skillLevel, ok := integerValue(requirements["skill_level"]); ok {
		if skillLevel > 7 {
			required = max(required, 2)
		} else if skillLevel > 4 {
			required = max(required, 1)
		}
	}
	if module, ok := integerValue(requirements["module"]); ok && module > 0 {
		required = max(required, 2)
	}
	return required
}
