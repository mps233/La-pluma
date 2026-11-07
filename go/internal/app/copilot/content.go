package copilot

import (
	"regexp"
	"strings"
)

// Content is a parsed PRTS copilot JSON body. PRTS returns it either as an
// object or as a JSON-encoded string inside the `content` field.
type Content = map[string]any

var (
	presetFormationPattern = regexp.MustCompile(`(?i)_s\d+$`)
	navigationStagePattern = regexp.MustCompile(`(?i)\b(?:[A-Z]{1,5}|\d{1,2})-(?:(?:EX|S|MO|TR)-)?\d+\b`)
)

// ParseCopilotContent mirrors parseCopilotContent in copilotPlanService.ts.
// `data` is the already-unwrapped `/copilot/get` data object.
func ParseCopilotContent(data any) Content {
	record := asRecord(data)
	if record == nil {
		return Content{}
	}
	switch content := record["content"].(type) {
	case string:
		var parsed any
		if err := decodeJSON([]byte(content), &parsed); err != nil {
			return Content{}
		}
		if value, ok := parsed.(map[string]any); ok {
			return normalizeContent(value)
		}
		return Content{}
	case map[string]any:
		return normalizeContent(content)
	default:
		return Content{}
	}
}

// ParseEmbeddedContent is used by discovery, where the item itself carries a
// `content` field that may be a string or an object. Unlike plan parsing it
// does not normalize the shape because fallback fields are read elsewhere.
func ParseEmbeddedContent(item any) Content {
	record := asRecord(item)
	if record == nil {
		return Content{}
	}
	switch content := record["content"].(type) {
	case string:
		var parsed any
		if err := decodeJSON([]byte(content), &parsed); err != nil {
			return Content{}
		}
		if value, ok := parsed.(map[string]any); ok {
			return value
		}
		return Content{}
	case map[string]any:
		return content
	default:
		return Content{}
	}
}

// normalizeContent mirrors normalizeCopilotContent: unknown fields are kept,
// while known fields are deleted when they have the wrong JSON type.
func normalizeContent(value map[string]any) Content {
	result := copyRecord(value)

	if rawDoc, exists := value["doc"]; exists {
		if doc, ok := rawDoc.(map[string]any); ok && doc != nil {
			normalizedDoc := copyRecord(doc)
			if title, ok := doc["title"].(string); ok {
				normalizedDoc["title"] = title
			} else {
				delete(normalizedDoc, "title")
			}
			result["doc"] = normalizedDoc
		} else {
			delete(result, "doc")
		}
	}

	if stageName, ok := value["stage_name"].(string); ok {
		result["stage_name"] = stageName
	} else {
		delete(result, "stage_name")
	}

	if opers, ok := value["opers"].([]any); ok {
		result["opers"] = opers
	} else {
		delete(result, "opers")
	}

	if groups, ok := value["groups"].([]any); ok {
		result["groups"] = groups
	} else {
		delete(result, "groups")
	}

	return result
}

// ContentStageName returns stage_name or "" (the Node `content.stage_name || ”`
// pattern used by plan building and preset detection).
func ContentStageName(content Content) string {
	return jsStringTruthyOrEmpty(content["stage_name"])
}

// ContentDocTitle returns the doc title when it is a string.
func ContentDocTitle(content Content) string {
	doc := asRecord(content["doc"])
	if doc == nil {
		return ""
	}
	return asString(doc["title"])
}

func ContentOpers(content Content) []any {
	return asArray(content["opers"])
}

func ContentGroups(content Content) []any {
	return asArray(content["groups"])
}

// IsPresetFormationCopilot mirrors isPresetFormationCopilot.
func IsPresetFormationCopilot(content Content) bool {
	if content == nil {
		return false
	}
	stageName := ContentStageName(content)
	return len(ContentOpers(content)) == 0 &&
		len(ContentGroups(content)) == 0 &&
		presetFormationPattern.MatchString(stageName)
}

// GetNavigationStage mirrors getNavigationStage: prefer the visible stage
// code in the document title, then the title, then the internal stage id.
func GetNavigationStage(content Content) string {
	if content == nil {
		return ""
	}
	title := ""
	if doc := asRecord(content["doc"]); doc != nil {
		if raw, exists := doc["title"]; exists && raw != nil {
			title = strings.TrimSpace(jsString(raw))
		}
	}
	if match := navigationStagePattern.FindString(title); match != "" {
		return match
	}
	if title != "" {
		return title
	}
	return ContentStageName(content)
}
