package copilot

import (
	"regexp"
	"sort"
	"strings"
)

const (
	maxDiscoveryStages        = 12
	candidatesPerStage        = 3
	setCandidateLimit         = 8
	discoverySupportUsageOnly = 1
)

// MissingOperatorInfo describes operator requirements that the user's OperBox
// cannot satisfy.
type MissingOperatorInfo struct {
	Names         []string `json:"names"`
	Count         int      `json:"count"`
	MissingGroups int      `json:"missingGroups"`
	Unknown       bool     `json:"unknown,omitempty"`
}

// DiscoverySelection carries the local OperBox names and copilot preferences.
// A nil OwnedOperators map means "unknown", so filtering is skipped like the
// Node service when OperBox has not been recognized.
type DiscoverySelection struct {
	OwnedOperators map[string]struct{}
	Preferences    map[string]any
}

// CopilotRecord is one PRTS copilot with rating metadata.
type CopilotRecord struct {
	ID              int
	Content         Content
	RatingLevel     float64
	RatingRatio     float64
	NotEnoughRating bool
}

// CopilotSetMember is one member of a matched PRTS set.
type CopilotSetMember struct {
	ID                   int      `json:"id"`
	Stage                *string  `json:"stage"`
	RatingLevel          float64  `json:"ratingLevel"`
	RatingRatio          float64  `json:"ratingRatio"`
	NotEnoughRating      bool     `json:"notEnoughRating"`
	MissingOperators     []string `json:"missingOperators"`
	MissingOperatorCount int      `json:"missingOperatorCount"`
	RequiresSupport      bool     `json:"requiresSupport"`
	Allowed              bool     `json:"allowed"`
}

// CopilotSetScore is the average rating projection of a set.
type CopilotSetScore struct {
	RatingScore       float64 `json:"ratingScore"`
	RatingRatio       float64 `json:"ratingRatio"`
	UnratedMainStages int     `json:"unratedMainStages"`
}

// CopilotSetMatch is a complete public PRTS set that covers the activity.
type CopilotSetMatch struct {
	ID                string             `json:"id"`
	Name              string             `json:"name"`
	Creator           *string            `json:"creator"`
	UpdatedAt         *string            `json:"updatedAt"`
	Stages            []string           `json:"stages"`
	Members           []CopilotSetMember `json:"members"`
	RatingScore       float64            `json:"ratingScore"`
	RatingRatio       float64            `json:"ratingRatio"`
	UnratedMainStages int                `json:"unratedMainStages"`
	Source            string             `json:"source"`
}

// CopilotCandidate is one ranked copilot for a stage.
type CopilotCandidate struct {
	ID                   int      `json:"id"`
	URI                  string   `json:"uri"`
	Stage                string   `json:"stage"`
	Title                string   `json:"title"`
	StageName            string   `json:"stageName"`
	PresetFormation      bool     `json:"presetFormation"`
	Uploader             *string  `json:"uploader"`
	UploadTime           *string  `json:"uploadTime"`
	RatingLevel          float64  `json:"ratingLevel"`
	RatingRatio          float64  `json:"ratingRatio"`
	NotEnoughRating      bool     `json:"notEnoughRating"`
	HotScore             float64  `json:"hotScore"`
	Views                float64  `json:"views"`
	MissingOperators     []string `json:"missingOperators"`
	MissingOperatorCount int      `json:"missingOperatorCount"`
	RequiresSupport      bool     `json:"requiresSupport"`
	Allowed              bool     `json:"allowed"`
}

// StageCandidateResult is the ranked candidate list for one stage.
type StageCandidateResult struct {
	Stage      string             `json:"stage"`
	StageID    *string            `json:"stageId"`
	Query      *string            `json:"query"`
	Candidates []CopilotCandidate `json:"candidates"`
	Error      string             `json:"error,omitempty"`
}

// FindMissingOperators mirrors activityCopilotSelectionService. It always
// returns a non-nil info value.
func FindMissingOperators(content any, ownedOperators map[string]struct{}) *MissingOperatorInfo {
	info := &MissingOperatorInfo{Names: []string{}}
	if len(ownedOperators) == 0 {
		info.Unknown = true
		return info
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
	info.Names = missingNames
	info.Count = len(missingNames) + missingGroups
	info.MissingGroups = missingGroups
	return info
}

func readOperatorNames(value any) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0)
	for _, raw := range asArray(value) {
		record := asRecord(raw)
		if record == nil {
			continue
		}
		name := strings.TrimSpace(jsStringTruthyOrEmpty(record["name"]))
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
func CanRunWithOperators(missing *MissingOperatorInfo, preferences map[string]any) bool {
	if missing == nil || missing.Count == 0 || missing.Unknown {
		return true
	}
	if missing.Count != 1 {
		return false
	}
	if allow, ok := preferences["allowOneMissingOperator"].(bool); ok && !allow {
		return false
	}
	supportUsage := numberOrZero(preferences["supportUsage"])
	if supportUsage == discoverySupportUsageOnly {
		return true
	}
	if supportUsage == 2 {
		supportName := strings.TrimSpace(asString(preferences["supportName"]))
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

// ScoreCopilotSetMembers averages ratings over main stages only.
func ScoreCopilotSetMembers(members []CopilotSetMember) CopilotSetScore {
	main := make([]CopilotSetMember, 0, len(members))
	for _, member := range members {
		if member.Stage != nil {
			main = append(main, member)
		}
	}
	if len(main) == 0 {
		return CopilotSetScore{}
	}
	var levelSum, ratioSum float64
	unrated := 0
	for _, member := range main {
		levelSum += member.RatingLevel
		ratioSum += member.RatingRatio
		if member.RatingLevel <= 0 && member.RatingRatio <= 0 {
			unrated++
		}
	}
	total := float64(len(main))
	return CopilotSetScore{
		RatingScore:       levelSum / total,
		RatingRatio:       ratioSum / total,
		UnratedMainStages: unrated,
	}
}

// CoversActivityStages reports whether a set covers every main stage and
// contains no stage from another event.
func CoversActivityStages(contents []any, activityCode string, stages []string) bool {
	if len(contents) == 0 || len(stages) == 0 {
		return false
	}
	expected := map[string]struct{}{}
	for _, stage := range stages {
		expected[stage] = struct{}{}
	}
	for _, raw := range contents {
		content := asRecord(raw)
		title := ""
		if content != nil {
			title = contentTitle(content)
		}
		if !activityStageTitleMatches(title, activityCode) {
			return false
		}
	}
	actual := map[string]struct{}{}
	for _, raw := range contents {
		content := asRecord(raw)
		title := ""
		if content != nil {
			title = contentTitle(content)
		}
		if stage := findKnownStage(title, stages); stage != "" {
			actual[stage] = struct{}{}
		}
	}
	for stage := range expected {
		if _, ok := actual[stage]; !ok {
			return false
		}
	}
	return true
}

// CanUseCurrentMapFallback requires the activity navigation preflight to be
// blocked specifically because no home-navigation resource is available.
func CanUseCurrentMapFallback(preflight any) bool {
	record := asRecord(preflight)
	if record == nil {
		return false
	}
	activity := asRecord(record["activity"])
	if activity == nil {
		return false
	}
	return asString(record["state"]) == "blocked" &&
		asString(record["reasonCode"]) == "navigation-resource-unavailable" &&
		truthy(activity["code"]) &&
		len(asArray(activity["stages"])) > 0
}

// RankActivityCopilots filters and sorts candidates for one exact stage.
func RankActivityCopilots(items []any, stage string, selection *DiscoverySelection) []CopilotCandidate {
	candidates := make([]CopilotCandidate, 0, len(items))
	for _, raw := range items {
		item := asRecord(raw)
		if item == nil {
			continue
		}
		content := ParseEmbeddedContent(item)
		var owned map[string]struct{}
		var preferences map[string]any
		if selection != nil {
			owned = selection.OwnedOperators
			preferences = selection.Preferences
		}
		missing := FindMissingOperators(content, owned)
		allowed := selection == nil || CanRunWithOperators(missing, preferences)
		copilotID, isInteger := integerValue(item["id"])
		title := strings.TrimSpace(contentTitle(content))
		if title == "" {
			if doc := asRecord(item["doc"]); doc != nil {
				if rawTitle, exists := doc["title"]; exists && truthy(rawTitle) {
					title = strings.TrimSpace(jsString(rawTitle))
				}
			}
		}
		candidate := CopilotCandidate{
			ID:                   copilotID,
			URI:                  "prts://" + jsString(item["id"]),
			Stage:                stage,
			Title:                title,
			StageName:            strings.TrimSpace(jsStringTruthyOrEmpty(content["stage_name"])),
			PresetFormation:      IsPresetFormationCopilot(content),
			Uploader:             firstNullableString(item["uploader"], item["uploader_id"]),
			UploadTime:           nullableString(item["upload_time"]),
			RatingLevel:          numberOrZero(item["rating_level"]),
			RatingRatio:          numberOrZero(item["rating_ratio"]),
			NotEnoughRating:      item["not_enough_rating"] == true,
			HotScore:             numberOrZero(item["hot_score"]),
			Views:                numberOrZero(item["views"]),
			MissingOperators:     missing.Names,
			MissingOperatorCount: missing.Count,
			RequiresSupport:      missing.Count > 0 && allowed,
			Allowed:              allowed,
		}
		if !allowed || !isInteger || copilotID <= 0 || !stageTitleMatches(title, stage) {
			continue
		}
		candidates = append(candidates, candidate)
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		left, right := candidates[i], candidates[j]
		if left.RatingLevel != right.RatingLevel {
			return left.RatingLevel > right.RatingLevel
		}
		if left.RatingRatio != right.RatingRatio {
			return left.RatingRatio > right.RatingRatio
		}
		leftTime := ""
		if left.UploadTime != nil {
			leftTime = *left.UploadTime
		}
		rightTime := ""
		if right.UploadTime != nil {
			rightTime = *right.UploadTime
		}
		if comparison := strings.Compare(rightTime, leftTime); comparison != 0 {
			return comparison < 0
		}
		if left.HotScore != right.HotScore {
			return left.HotScore > right.HotScore
		}
		return left.Views > right.Views
	})
	if len(candidates) > candidatesPerStage {
		candidates = candidates[:candidatesPerStage]
	}
	return candidates
}

func nullableString(value any) *string {
	text, ok := value.(string)
	if !ok {
		return nil
	}
	return &text
}

func firstNullableString(values ...any) *string {
	for _, value := range values {
		if text, ok := value.(string); ok {
			return &text
		}
	}
	return nil
}

func contentTitle(content Content) string {
	doc := asRecord(content["doc"])
	if doc == nil {
		return ""
	}
	rawTitle, exists := doc["title"]
	if !exists || !truthy(rawTitle) {
		return ""
	}
	return jsString(rawTitle)
}

func stageTitleMatches(title, stage string) bool {
	pattern, err := compileStageTitlePattern(stage)
	if err != nil {
		return false
	}
	return pattern.MatchString(title)
}

func compileStageTitlePattern(stage string) (*regexp.Regexp, error) {
	return regexp.Compile(`(?i)(?:^|[\s\-_【（(】])` + escapeRegExp(stage) + `(?:\s|$|[-_:：,【（(])`)
}

func activityStageTitleMatches(title, code string) bool {
	pattern, err := compileActivityStagePattern(code)
	if err != nil {
		return false
	}
	return pattern.MatchString(title)
}

func compileActivityStagePattern(code string) (*regexp.Regexp, error) {
	return regexp.Compile(`(?i)(?:^|[\s\-_【（(】])` + escapeRegExp(code) +
		`-(?:\d+|EX-\d+|S-\d+|MO-\d+|TR-\d+)(?:\s|$|[-_:：,【（(])`)
}

func findKnownStage(title string, stages []string) string {
	for _, stage := range stages {
		if stageTitleMatches(title, stage) {
			return stage
		}
	}
	return ""
}

func escapeRegExp(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if strings.ContainsRune(`.*+?^${}()|[]\`, char) {
			builder.WriteByte('\\')
		}
		builder.WriteRune(char)
	}
	return builder.String()
}

func compareActivityStageCodes(left, right string) int {
	leftMatch := trailingStageNumber(left)
	rightMatch := trailingStageNumber(right)
	if leftMatch != nil && rightMatch != nil {
		if delta := *leftMatch - *rightMatch; delta != 0 {
			return delta
		}
	}
	return strings.Compare(left, right)
}

func trailingStageNumber(value string) *int {
	index := strings.LastIndex(value, "-")
	if index < 0 || index == len(value)-1 {
		return nil
	}
	number, ok := integerValue(value[index+1:])
	if !ok {
		return nil
	}
	return &number
}
