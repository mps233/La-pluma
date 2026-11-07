package activity

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
)

const (
	maxDiscoveryStages = 12
	candidatesPerStage = 3
	setCandidateLimit  = 8
)

var (
	contentJSONPattern = regexp.MustCompile(`(?i)_s\d+$`)
	stageNumberPattern = regexp.MustCompile(`-(\d+)$`)
)

// DiscoveryOptions configures activity copilot discovery.
type DiscoveryOptions struct {
	AllowCurrentMap bool
	Selection       *SelectionContext
	Preflight       *NavigationResult
}

type copilotRecord struct {
	ID              int
	Content         map[string]any
	RatingLevel     float64
	RatingRatio     float64
	NotEnoughRating bool
}

func parseContent(item map[string]any) map[string]any {
	if item == nil {
		return map[string]any{}
	}
	content := item["content"]
	if text, ok := content.(string); ok {
		value, err := parseJSONValue([]byte(text))
		if err != nil {
			return map[string]any{}
		}
		if record := asRecord(value); record != nil {
			return record
		}
		return map[string]any{}
	}
	if record := asRecord(content); record != nil {
		return record
	}
	return map[string]any{}
}

func contentStageName(content map[string]any) string {
	return jsStringOrEmpty(content["stage_name"])
}

func contentTitle(content map[string]any) string {
	doc := asRecord(content["doc"])
	if doc == nil || !truthy(doc["title"]) {
		return ""
	}
	return jsString(doc["title"])
}

func contentOpers(content map[string]any) []any  { return asArray(content["opers"]) }
func contentGroups(content map[string]any) []any { return asArray(content["groups"]) }

func isPresetFormation(content map[string]any) bool {
	opers := contentOpers(content)
	groups := contentGroups(content)
	return len(opers) == 0 && len(groups) == 0 && contentJSONPattern.MatchString(contentStageName(content))
}

func escapeRegExp(value string) string { return regexp.QuoteMeta(value) }

func stageTitleMatches(title any, stage any) bool {
	pattern := `(?i)(?:^|[\s\-_【（(】])` + escapeRegExp(jsStringOrEmpty(stage)) + `(?:\s|$|[-_:：,【（(])`
	return regexp.MustCompile(pattern).MatchString(jsStringOrEmpty(title))
}

func findKnownStage(title any, stages []string) string {
	for _, stage := range stages {
		if stageTitleMatches(title, stage) {
			return stage
		}
	}
	return ""
}

func activityStageTitleMatches(title any, code any) bool {
	pattern := `(?i)(?:^|[\s\-_【（(】])` + escapeRegExp(jsStringOrEmpty(code)) + `-(?:\d+|EX-\d+|S-\d+|MO-\d+|TR-\d+)(?:\s|$|[-_:：,【（(])`
	return regexp.MustCompile(pattern).MatchString(jsStringOrEmpty(title))
}

// CoversActivityStages reports whether a set covers every main stage and
// contains no unrelated activity stage.
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

func compareActivityStageCodes(left, right string) int {
	leftMatch := stageNumberPattern.FindStringSubmatch(left)
	rightMatch := stageNumberPattern.FindStringSubmatch(right)
	if leftMatch != nil && rightMatch != nil {
		leftNumber := mustAtoi(leftMatch[1])
		rightNumber := mustAtoi(rightMatch[1])
		if leftNumber != rightNumber {
			if leftNumber < rightNumber {
				return -1
			}
			return 1
		}
	}
	return strings.Compare(left, right)
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
	levelSum := 0.0
	ratioSum := 0.0
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

func (s *Service) fetchCopilotRecord(ctx context.Context, id int) (*copilotRecord, error) {
	data, err := s.prts.GetCopilotWithRetry(ctx, id)
	if err != nil {
		return nil, err
	}
	recordID := int(jsNumber(data["id"]))
	if recordID == 0 {
		recordID = id
	}
	return &copilotRecord{
		ID:              recordID,
		Content:         parseContent(data),
		RatingLevel:     jsNumber(data["rating_level"]),
		RatingRatio:     jsNumber(data["rating_ratio"]),
		NotEnoughRating: data["not_enough_rating"] == true,
	}, nil
}

func selectionPreferences(selection *SelectionContext) map[string]any {
	if selection == nil {
		return map[string]any{}
	}
	return selection.Preferences.Map()
}

func selectionOperators(selection *SelectionContext) map[string]struct{} {
	if selection == nil {
		return nil
	}
	return selection.OwnedOperators
}

func (s *Service) findMatchingCopilotSets(
	ctx context.Context,
	activity NavigationActivity,
	stages []string,
	selection *SelectionContext,
) ([]CopilotSetMatch, error) {
	keyword := ""
	if activity.Name != nil {
		keyword = *activity.Name
	}
	if keyword == "" && activity.Code != nil {
		keyword = *activity.Code
	}
	sets, err := s.prts.QuerySets(ctx, keyword, 1, 20)
	if err != nil {
		if status, ok := err.(*httpStatusError); ok {
			return nil, fmt.Errorf("作业集查询失败: HTTP %d", status.status)
		}
		return nil, err
	}

	matches := make([]CopilotSetMatch, 0)
	considered := 0
	for _, rawSet := range sets {
		set := asRecord(rawSet)
		if set == nil || asString(set["status"]) != "PUBLIC" {
			continue
		}
		if considered >= setCandidateLimit {
			break
		}
		considered++

		ids := make([]int, 0)
		for _, rawID := range asArray(set["copilot_ids"]) {
			if id, ok := integerValue(rawID); ok {
				ids = append(ids, id)
			}
		}
		if len(ids) < len(stages) {
			continue
		}

		records := make([]*copilotRecord, 0, len(ids))
		failed := false
		for _, id := range ids {
			record, err := s.fetchCopilotRecord(ctx, id)
			if err != nil {
				failed = true
				break
			}
			records = append(records, record)
		}
		if failed {
			continue
		}

		contents := make([]any, 0, len(records))
		for _, record := range records {
			contents = append(contents, record.Content)
		}
		activityCode := ""
		if activity.Code != nil {
			activityCode = *activity.Code
		}
		if !CoversActivityStages(contents, activityCode, stages) {
			continue
		}

		members := make([]CopilotSetMember, 0, len(records))
		for _, record := range records {
			stage := findKnownStage(contentTitle(record.Content), stages)
			var stagePointer *string
			if stage != "" {
				stagePointer = stringPtr(stage)
			}
			missing := FindMissingOperators(record.Content, selectionOperators(selection))
			allowed := selection == nil || CanRunWithOperators(&missing, selectionPreferences(selection))
			members = append(members, CopilotSetMember{
				ID:                   record.ID,
				Stage:                stagePointer,
				RatingLevel:          record.RatingLevel,
				RatingRatio:          record.RatingRatio,
				NotEnoughRating:      record.NotEnoughRating,
				MissingOperators:     missing.Names,
				MissingOperatorCount: missing.Count,
				RequiresSupport:      missing.Count > 0 && allowed,
				Allowed:              allowed,
			})
		}
		allAllowed := true
		for _, member := range members {
			if !member.Allowed {
				allAllowed = false
				break
			}
		}
		if !allAllowed {
			continue
		}

		score := ScoreCopilotSetMembers(members)
		matchStages := make([]string, 0, len(members))
		for _, member := range members {
			if member.Stage != nil {
				matchStages = append(matchStages, *member.Stage)
			}
		}
		setID := jsString(set["id"])
		name := asString(set["name"])
		if name == "" {
			name = "作业集 " + setID
		}
		var creator *string
		if value, ok := set["creator"].(string); ok {
			creator = stringPtr(value)
		}
		var updatedAt *string
		timestampValue := set["update_time"]
		if !truthy(timestampValue) {
			timestampValue = set["create_time"]
		}
		if value, ok := timestampValue.(string); ok {
			updatedAt = stringPtr(value)
		}
		matches = append(matches, CopilotSetMatch{
			ID:                setID,
			Name:              name,
			Creator:           creator,
			UpdatedAt:         updatedAt,
			Stages:            matchStages,
			Members:           members,
			RatingScore:       score.RatingScore,
			RatingRatio:       score.RatingRatio,
			UnratedMainStages: score.UnratedMainStages,
			Source:            "prts-set-query",
		})
	}

	sort.SliceStable(matches, func(i, j int) bool {
		left, right := matches[i], matches[j]
		if left.RatingScore != right.RatingScore {
			return left.RatingScore > right.RatingScore
		}
		if left.RatingRatio != right.RatingRatio {
			return left.RatingRatio > right.RatingRatio
		}
		if left.UnratedMainStages != right.UnratedMainStages {
			return left.UnratedMainStages > right.UnratedMainStages
		}
		leftUpdated, rightUpdated := "", ""
		if left.UpdatedAt != nil {
			leftUpdated = *left.UpdatedAt
		}
		if right.UpdatedAt != nil {
			rightUpdated = *right.UpdatedAt
		}
		if leftUpdated != rightUpdated {
			return leftUpdated > rightUpdated
		}
		return false
	})
	return matches, nil
}

// RankActivityCopilots mirrors rankActivityCopilots.
func RankActivityCopilots(items []any, stage string, selection *SelectionContext) []CopilotCandidate {
	candidates := make([]CopilotCandidate, 0)
	for _, rawItem := range items {
		item := asRecord(rawItem)
		if item == nil {
			continue
		}
		content := parseContent(item)
		missing := FindMissingOperators(content, selectionOperators(selection))
		allowed := selection == nil || CanRunWithOperators(&missing, selectionPreferences(selection))

		titleValue := any(nil)
		if doc := asRecord(content["doc"]); doc != nil {
			titleValue = doc["title"]
		}
		if !truthy(titleValue) {
			if doc := asRecord(item["doc"]); doc != nil {
				titleValue = doc["title"]
			}
		}
		title := ""
		if truthy(titleValue) {
			title = strings.TrimSpace(jsString(titleValue))
		}

		var uploader *string
		if value, ok := item["uploader"].(string); ok {
			uploader = stringPtr(value)
		} else if value, ok := item["uploader_id"].(string); ok {
			uploader = stringPtr(value)
		}
		var uploadTime *string
		if value, ok := item["upload_time"].(string); ok {
			uploadTime = stringPtr(value)
		}
		id, idOK := integerValue(item["id"])
		if !idOK || id <= 0 {
			continue
		}
		if !allowed || !stageTitleMatches(title, stage) {
			continue
		}
		candidates = append(candidates, CopilotCandidate{
			ID:                   id,
			URI:                  fmt.Sprintf("prts://%d", id),
			Stage:                stage,
			Title:                title,
			StageName:            strings.TrimSpace(contentStageName(content)),
			PresetFormation:      isPresetFormation(content),
			Uploader:             uploader,
			UploadTime:           uploadTime,
			RatingLevel:          jsNumber(item["rating_level"]),
			RatingRatio:          jsNumber(item["rating_ratio"]),
			NotEnoughRating:      item["not_enough_rating"] == true,
			HotScore:             jsNumber(item["hot_score"]),
			Views:                jsNumber(item["views"]),
			MissingOperators:     missing.Names,
			MissingOperatorCount: missing.Count,
			RequiresSupport:      missing.Count > 0 && allowed,
			Allowed:              allowed,
		})
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		left, right := candidates[i], candidates[j]
		if left.RatingLevel != right.RatingLevel {
			return left.RatingLevel > right.RatingLevel
		}
		if left.RatingRatio != right.RatingRatio {
			return left.RatingRatio > right.RatingRatio
		}
		leftUpload, rightUpload := "", ""
		if left.UploadTime != nil {
			leftUpload = *left.UploadTime
		}
		if right.UploadTime != nil {
			rightUpload = *right.UploadTime
		}
		if leftUpload != rightUpload {
			return leftUpload > rightUpload
		}
		if left.HotScore != right.HotScore {
			return left.HotScore > right.HotScore
		}
		if left.Views != right.Views {
			return left.Views > right.Views
		}
		return false
	})
	if len(candidates) > candidatesPerStage {
		candidates = candidates[:candidatesPerStage]
	}
	return candidates
}

func (s *Service) queryStageCandidates(ctx context.Context, stage string, selection *SelectionContext) (*StageCandidateResult, error) {
	var stageID *string
	if s.stageResolver != nil {
		if value, ok := s.stageResolver.StageID(ctx, stage); ok && value != "" {
			stageID = stringPtr(value)
		}
	}
	keywords := make([]string, 0, 2)
	seen := map[string]struct{}{}
	if stageID != nil && *stageID != "" {
		keywords = append(keywords, *stageID)
		seen[*stageID] = struct{}{}
	}
	if stage != "" {
		if _, exists := seen[stage]; !exists {
			keywords = append(keywords, stage)
		}
	}

	var lastQuery *string
	var lastError error
	succeeded := false
	for _, keyword := range keywords {
		queryURL := fmt.Sprintf("%s/copilot/query?level_keyword=%s&page=1&limit=50&order_by=hot",
			s.prts.BaseURL(), url.QueryEscape(keyword))
		query := queryURL
		lastQuery = &query
		items, err := s.prts.QueryCopilots(ctx, keyword, 1, 50, "hot")
		if err != nil {
			if status, ok := err.(*httpStatusError); ok {
				lastError = fmt.Errorf("作业站请求失败: HTTP %d", status.status)
			} else {
				lastError = err
			}
			continue
		}
		succeeded = true
		reliable := make([]any, 0, len(items))
		for _, raw := range items {
			record := asRecord(raw)
			if record == nil {
				continue
			}
			if available, ok := record["available"].(bool); ok && !available {
				continue
			}
			if asString(record["status"]) != "PUBLIC" {
				continue
			}
			if record["not_enough_rating"] == true {
				continue
			}
			reliable = append(reliable, raw)
		}
		candidates := RankActivityCopilots(reliable, stage, selection)
		if len(candidates) > 0 {
			return &StageCandidateResult{
				Stage:      stage,
				StageID:    stageID,
				Query:      lastQuery,
				Candidates: candidates,
			}, nil
		}
	}
	if !succeeded && lastError != nil {
		return nil, lastError
	}
	return &StageCandidateResult{
		Stage:      stage,
		StageID:    stageID,
		Query:      lastQuery,
		Candidates: []CopilotCandidate{},
	}, nil
}

// CanUseCurrentMapFallback reports whether discovery may run without homepage
// navigation resources.
func CanUseCurrentMapFallback(preflight NavigationResult) bool {
	return preflight.State == "blocked" &&
		preflight.ReasonCode != nil && *preflight.ReasonCode == "navigation-resource-unavailable" &&
		preflight.Activity.Code != nil && *preflight.Activity.Code != "" &&
		len(preflight.Activity.Stages) > 0
}

// FindActivityCopilotCandidates mirrors findActivityCopilotCandidates. It only
// queries PRTS; no device or game interaction happens here.
func (s *Service) FindActivityCopilotCandidates(ctx context.Context, clientType string, options DiscoveryOptions) (*Candidates, error) {
	if strings.TrimSpace(clientType) == "" {
		clientType = DefaultClientType
	}
	preflight := NavigationResult{}
	if options.Preflight != nil {
		preflight = *options.Preflight
	} else {
		loaded, err := s.Check(ctx, clientType)
		if err != nil {
			return nil, err
		}
		preflight = loaded
	}

	response := &Candidates{
		Execution: DiscoveryExecution{Mode: "manual-selection-required", Executable: false},
		Source:    DiscoverySource{Provider: "prts.maa.plus", Endpoint: "/copilot/query", OrderBy: "hot"},
		Ranking: []string{
			"仅保留公开、可用且评分充足的作业",
			"评分等级和评分比例优先",
			"同等评分按上传时间、热度和浏览量排序",
		},
		Preflight: preflight,
		Stages:    []StageCandidateResult{},
	}

	currentMapFallback := options.AllowCurrentMap && CanUseCurrentMapFallback(preflight)
	if preflight.State != "ready" && !currentMapFallback {
		response.State = "blocked"
		response.Reason = preflight.Reason
		return response, nil
	}

	activityCode := ""
	if preflight.Activity.Code != nil {
		activityCode = *preflight.Activity.Code
	}
	stagePattern, patternErr := regexp.Compile(`(?i)^` + escapeRegExp(activityCode) + `-(?:\d+|EX-\d+|S-\d+|MO-\d+|TR-\d+)$`)
	stageSet := map[string]struct{}{}
	stages := make([]string, 0)
	for _, raw := range preflight.Activity.Stages {
		stage := strings.ToUpper(strings.TrimSpace(raw))
		if stage == "" {
			continue
		}
		if patternErr == nil && !stagePattern.MatchString(stage) {
			continue
		}
		if _, exists := stageSet[stage]; exists {
			continue
		}
		stageSet[stage] = struct{}{}
		stages = append(stages, stage)
	}
	sort.SliceStable(stages, func(i, j int) bool {
		return compareActivityStageCodes(stages[i], stages[j]) < 0
	})
	if len(stages) > maxDiscoveryStages {
		stages = stages[:maxDiscoveryStages]
	}
	if len(stages) == 0 {
		response.State = "blocked"
		response.Reason = "当前活动未提供可精确匹配的关卡列表，未查询作业站。"
		return response, nil
	}

	results := make([]StageCandidateResult, len(stages))
	var wait sync.WaitGroup
	for index, stage := range stages {
		index, stage := index, stage
		wait.Add(1)
		go func() {
			defer wait.Done()
			result, err := s.queryStageCandidates(ctx, stage, options.Selection)
			if err != nil {
				results[index] = StageCandidateResult{
					Stage:      stage,
					Candidates: []CopilotCandidate{},
					Error:      err.Error(),
				}
				return
			}
			results[index] = *result
		}()
	}
	wait.Wait()

	matchingSets, err := s.findMatchingCopilotSets(ctx, preflight.Activity, stages, options.Selection)
	if err != nil {
		matchingSets = []CopilotSetMatch{}
	}
	if matchingSets == nil {
		matchingSets = []CopilotSetMatch{}
	}
	var matchingSet *CopilotSetMatch
	candidateCount := 0
	for _, result := range results {
		candidateCount += len(result.Candidates)
	}
	if len(matchingSets) > 0 {
		copyValue := matchingSets[0]
		matchingSet = &copyValue
	}

	response.Stages = results
	if candidateCount > 0 || matchingSet != nil {
		response.State = "candidates-ready"
		if currentMapFallback {
			response.Reason = "未找到主页自动导航资源。请先手动进入当前活动关卡地图；系统将仅尝试在该地图内识别并运行作业。"
			response.NavigationMode = "current-map-fallback"
		} else {
			response.Reason = "已按当前活动的明确关卡代号找到候选作业，请选择后再执行。"
			response.NavigationMode = "home-navigation"
		}
		response.MatchingSet = matchingSet
		response.MatchingSets = matchingSets
		return response, nil
	}

	response.State = "blocked"
	response.Reason = "未找到满足可靠性条件的活动作业，未生成执行计划。"
	return response, nil
}
