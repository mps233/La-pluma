package copilot

import (
	"context"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// DefaultClientType matches the Node connection default. The app layer may
// override it from configuration; this package never reads the environment.
const DefaultClientType = "Official"

// DiscoveryExecution describes that candidate discovery never starts a battle.
type DiscoveryExecution struct {
	Mode       string `json:"mode"`
	Executable bool   `json:"executable"`
}

// DiscoverySource identifies the PRTS endpoint and ordering.
type DiscoverySource struct {
	Provider string `json:"provider"`
	Endpoint string `json:"endpoint"`
	OrderBy  string `json:"orderBy"`
}

// ActivityCopilotCandidates is the discovery response. Field names are kept
// compatible with the Node Agent API.
type ActivityCopilotCandidates struct {
	Execution      DiscoveryExecution     `json:"execution"`
	Source         DiscoverySource        `json:"source"`
	Ranking        []string               `json:"ranking"`
	Preflight      map[string]any         `json:"preflight"`
	State          string                 `json:"state"`
	Reason         string                 `json:"reason,omitempty"`
	Stages         []StageCandidateResult `json:"stages"`
	MatchingSet    *CopilotSetMatch       `json:"matchingSet,omitempty"`
	MatchingSets   []CopilotSetMatch      `json:"matchingSets,omitempty"`
	NavigationMode string                 `json:"navigationMode,omitempty"`
}

// PreflightProvider loads the activity navigation preflight. It is injected
// because this package does not import the activity navigation service.
type PreflightProvider func(ctx context.Context, clientType string) (map[string]any, error)

// DiscoveryOptions configures activity copilot discovery.
type DiscoveryOptions struct {
	AllowCurrentMap   bool
	Selection         *DiscoverySelection
	Preflight         map[string]any
	PreflightProvider PreflightProvider
}

// FindActivityCopilotCandidates mirrors findActivityCopilotCandidates. It never
// starts a battle; it only ranks public PRTS copilots for the current activity.
func (s *Service) FindActivityCopilotCandidates(
	ctx context.Context,
	clientType string,
	options DiscoveryOptions,
) (*ActivityCopilotCandidates, error) {
	if clientType == "" {
		clientType = DefaultClientType
	}
	selection := options.Selection
	if selection == nil {
		// The Node service loads local preferences and leaves ownedOperators
		// null when OperBox is unavailable. An empty selection models that.
		selection = &DiscoverySelection{Preferences: map[string]any{}}
	}

	preflight := options.Preflight
	if preflight == nil && options.PreflightProvider != nil {
		loaded, err := options.PreflightProvider(ctx, clientType)
		if err != nil {
			return nil, err
		}
		preflight = loaded
	}
	if preflight == nil {
		return nil, apperrors.WithStatus(
			"COPILOT_PREFLIGHT_UNAVAILABLE",
			"活动预检服务未接入",
			http.StatusServiceUnavailable,
			false,
			map[string]any{"todo": "wire activity navigation preflight"},
		)
	}

	response := &ActivityCopilotCandidates{
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

	preflightState := asString(preflight["state"])
	activity := asRecord(preflight["activity"])
	if activity == nil {
		activity = map[string]any{}
	}
	currentMapFallback := options.AllowCurrentMap && CanUseCurrentMapFallback(preflight)
	if preflightState != "ready" && !currentMapFallback {
		response.State = "blocked"
		response.Reason = asString(preflight["reason"])
		return response, nil
	}

	activityCode := asString(activity["code"])
	stagePattern, patternErr := compileActivityStagePattern(activityCode)
	stageSet := map[string]struct{}{}
	stages := make([]string, 0)
	for _, raw := range asArray(activity["stages"]) {
		stage := strings.ToUpper(strings.TrimSpace(jsStringTruthyOrEmpty(raw)))
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

	results := make([]StageCandidateResult, 0, len(stages))
	for _, stage := range stages {
		result, err := s.queryStageCandidates(ctx, stage, selection)
		if err != nil {
			stageID := (*string)(nil)
			query := (*string)(nil)
			results = append(results, StageCandidateResult{
				Stage:      stage,
				StageID:    stageID,
				Query:      query,
				Candidates: []CopilotCandidate{},
				Error:      err.Error(),
			})
			continue
		}
		results = append(results, *result)
	}
	response.Stages = results

	matchingSets, err := s.findMatchingCopilotSets(ctx, activity, stages, selection)
	if err != nil {
		// Set discovery is an optimization; per-stage candidates remain valid.
		matchingSets = nil
	}
	var matchingSet *CopilotSetMatch
	candidateCount := 0
	for index := range results {
		candidateCount += len(results[index].Candidates)
	}
	if len(matchingSets) > 0 {
		copyMatch := matchingSets[0]
		matchingSet = &copyMatch
	}
	if candidateCount > 0 || matchingSet != nil {
		response.State = "candidates-ready"
		if currentMapFallback {
			response.Reason = "未找到主页自动导航资源。请先手动进入当前活动关卡地图；系统将仅尝试在该地图内识别并运行作业。"
		} else {
			response.Reason = "已按当前活动的明确关卡代号找到候选作业，请选择后再执行。"
		}
		response.MatchingSet = matchingSet
		response.MatchingSets = matchingSets
		if currentMapFallback {
			response.NavigationMode = "current-map-fallback"
		} else {
			response.NavigationMode = "home-navigation"
		}
		return response, nil
	}
	response.State = "blocked"
	response.Reason = "未找到满足可靠性条件的活动作业，未生成执行计划。"
	return response, nil
}

func (s *Service) queryStageCandidates(
	ctx context.Context,
	stage string,
	selection *DiscoverySelection,
) (*StageCandidateResult, error) {
	var stageID *string
	if stageInfo, exists, err := s.resource.StageByCode(stage); err == nil && exists {
		if value, ok := stageInfo["stageId"].(string); ok {
			copyValue := value
			stageID = &copyValue
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
		queryURL := s.prts.BaseURL() + "/copilot/query?level_keyword=" + url.QueryEscape(keyword) + "&page=1&limit=50&order_by=hot"
		query := queryURL
		lastQuery = &query
		items, err := s.prts.QueryCopilots(ctx, keyword, 1, 50, "hot")
		if err != nil {
			lastError = err
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

func (s *Service) fetchCopilotRecord(ctx context.Context, id int) (*CopilotRecord, error) {
	data, err := s.prts.GetCopilot(ctx, strconv.Itoa(id))
	if err != nil {
		return nil, err
	}
	record := asRecord(data)
	if record == nil {
		record = map[string]any{}
	}
	recordID, _ := integerValue(record["id"])
	if recordID == 0 {
		recordID = id
	}
	return &CopilotRecord{
		ID:              recordID,
		Content:         ParseEmbeddedContent(record),
		RatingLevel:     numberOrZero(record["rating_level"]),
		RatingRatio:     numberOrZero(record["rating_ratio"]),
		NotEnoughRating: record["not_enough_rating"] == true,
	}, nil
}

func (s *Service) findMatchingCopilotSets(
	ctx context.Context,
	activity map[string]any,
	stages []string,
	selection *DiscoverySelection,
) ([]CopilotSetMatch, error) {
	keyword := asString(activity["name"])
	if keyword == "" {
		keyword = asString(activity["code"])
	}
	sets, err := s.prts.QuerySets(ctx, keyword, 1, 20)
	if err != nil {
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

		records := make([]*CopilotRecord, 0, len(ids))
		failed := false
		for _, id := range ids {
			record, err := s.fetchCopilotRecord(ctx, id)
			if err != nil {
				// An unavailable member makes this set unsuitable.
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
		if !CoversActivityStages(contents, asString(activity["code"]), stages) {
			continue
		}

		members := make([]CopilotSetMember, 0, len(records))
		for _, record := range records {
			stage := findKnownStage(contentTitle(record.Content), stages)
			var stagePointer *string
			if stage != "" {
				stageCopy := stage
				stagePointer = &stageCopy
			}
			var owned map[string]struct{}
			var preferences map[string]any
			if selection != nil {
				owned = selection.OwnedOperators
				preferences = selection.Preferences
			}
			missing := FindMissingOperators(record.Content, owned)
			allowed := selection == nil || CanRunWithOperators(missing, preferences)
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
		allowedAll := true
		for _, member := range members {
			if !member.Allowed {
				allowedAll = false
				break
			}
		}
		if !allowedAll {
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
		updatedAt := nullableSetTimestamp(set)
		matches = append(matches, CopilotSetMatch{
			ID:                setID,
			Name:              name,
			Creator:           nullableString(set["creator"]),
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
		leftTime := ""
		if left.UpdatedAt != nil {
			leftTime = *left.UpdatedAt
		}
		rightTime := ""
		if right.UpdatedAt != nil {
			rightTime = *right.UpdatedAt
		}
		return strings.Compare(rightTime, leftTime) < 0
	})
	return matches, nil
}

func nullableSetTimestamp(set map[string]any) *string {
	candidate := set["update_time"]
	if !truthy(candidate) {
		candidate = set["create_time"]
	}
	if text, ok := candidate.(string); ok {
		return &text
	}
	return nil
}
