package copilot

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const (
	defaultPlanTTL = 30 * time.Minute
	progressFile   = "copilot-progress.json"
)

// PlanItem is one copilot inside a PRTS set.
type PlanItem struct {
	ID              int      `json:"id"`
	StageID         string   `json:"stageId"`
	Stage           string   `json:"stage"`
	APCost          *float64 `json:"apCost"`
	PresetFormation bool     `json:"presetFormation"`
	SupportsRaid    bool     `json:"supportsRaid"`
	Operators       []any    `json:"operators"`
	Groups          []any    `json:"groups"`
}

// PlanEntry is the execution projection of a plan item for one raid mode.
type PlanEntry struct {
	Key             string   `json:"key"`
	ItemIndex       int      `json:"itemIndex"`
	CopilotID       int      `json:"copilotId"`
	StageID         string   `json:"stageId"`
	DisplayStage    string   `json:"displayStage"`
	APCost          *float64 `json:"apCost"`
	Mode            string   `json:"mode"`
	PresetFormation bool     `json:"presetFormation"`
	// Completed is nil for the cached plan and set to true/false by BuildPlan.
	Completed *bool `json:"completed,omitempty"`
}

// Plan is the JSON-compatible copilot set plan.
type Plan struct {
	SetID   string      `json:"setId"`
	Name    string      `json:"name"`
	Items   []PlanItem  `json:"items"`
	Entries []PlanEntry `json:"entries"`
}

// PlanBuilder builds a plan for a set id and raid mode.
type PlanBuilder func(ctx context.Context, setId, raid string) (*Plan, error)

type planBuildCall struct {
	done chan struct{}
	plan *Plan
	err  error
}

type planCacheEntry struct {
	expiresAt time.Time
	value     *Plan
}

// ServiceOptions configures the copilot plan, discovery and manual services.
type ServiceOptions struct {
	Paths          config.Paths
	PRTS           *PRTSClient
	PlanTTL        time.Duration
	Now            func() time.Time
	Logger         *slog.Logger
	BattleSampler  BattleProgressSampler
	ManualExecutor StepExecutor
}

// Service owns the PRTS plan cache, progress persistence and stage index.
type Service struct {
	paths    config.Paths
	prts     *PRTSClient
	resource *ResourceIndex
	now      func() time.Time
	planTTL  time.Duration
	logger   *slog.Logger

	battleSampler  BattleProgressSampler
	manualExecutor StepExecutor

	planMu       sync.Mutex
	planCache    map[string]planCacheEntry
	planInFlight map[string]*planBuildCall

	progressMu sync.Mutex

	manualOnce sync.Once
	manual     *ManualManager
}

// New returns a Service with default PRTS client, clock and caches.
func New(paths config.Paths) *Service {
	return NewWithOptions(ServiceOptions{Paths: paths})
}

// NewWithOptions returns a fully configurable Service. Tests inject an
// httptest-backed PRTS client and a fake clock; production uses defaults.
func NewWithOptions(options ServiceOptions) *Service {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	ttl := options.PlanTTL
	if ttl <= 0 {
		ttl = defaultPlanTTL
	}
	prts := options.PRTS
	if prts == nil {
		prts = NewPRTSClient(PRTSClientOptions{})
	}
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	service := &Service{
		paths:         options.Paths,
		prts:          prts,
		resource:      NewResourceIndex(options.Paths),
		now:           now,
		planTTL:       ttl,
		logger:        logger,
		battleSampler: options.BattleSampler,
		planCache:     map[string]planCacheEntry{},
		planInFlight:  map[string]*planBuildCall{},
	}
	service.manual = NewManualManagerWithOptions(
		service.BuildPlan,
		options.ManualExecutor,
		ManualOptions{Now: now},
	)
	return service
}

func (s *Service) PRTS() *PRTSClient        { return s.prts }
func (s *Service) Resource() *ResourceIndex { return s.resource }
func (s *Service) Paths() config.Paths      { return s.paths }
func (s *Service) Manual() *ManualManager   { return s.manual }
func (s *Service) ProgressPath() string     { return filepath.Join(s.paths.DataDir, progressFile) }

// BuildPlan returns the cached plan with per-entry completion flags refreshed
// from copilot-progress.json. Completion is never stored inside the cache, so
// a long TTL cannot replay a finished manual step.
func (s *Service) BuildPlan(ctx context.Context, setId, raid string) (*Plan, error) {
	plan, err := s.cachedPlan(ctx, setId, raid)
	if err != nil {
		return nil, err
	}
	progress := s.LoadProgress()
	completed := map[string]struct{}{}
	for _, key := range progress[plan.SetID] {
		completed[key] = struct{}{}
	}
	result := &Plan{
		SetID:   plan.SetID,
		Name:    plan.Name,
		Items:   plan.Items,
		Entries: make([]PlanEntry, len(plan.Entries)),
	}
	for index, entry := range plan.Entries {
		_, done := completed[entry.Key]
		value := done
		entry.Completed = &value
		result.Entries[index] = entry
	}
	return result, nil
}

func (s *Service) cachedPlan(ctx context.Context, setId, raid string) (*Plan, error) {
	if raid == "" {
		raid = "normal"
	}
	key := setId + "\x00" + raid

	s.planMu.Lock()
	if cached, ok := s.planCache[key]; ok && cached.expiresAt.After(s.now()) {
		plan := cached.value
		s.planMu.Unlock()
		return plan, nil
	}
	if call, ok := s.planInFlight[key]; ok {
		s.planMu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-call.done:
			return call.plan, call.err
		}
	}
	call := &planBuildCall{done: make(chan struct{})}
	s.planInFlight[key] = call
	s.planMu.Unlock()

	plan, err := s.BuildPlanUncached(ctx, setId, raid)

	s.planMu.Lock()
	if err == nil {
		s.planCache[key] = planCacheEntry{expiresAt: s.now().Add(s.planTTL), value: plan}
	}
	call.plan = plan
	call.err = err
	delete(s.planInFlight, key)
	s.planMu.Unlock()
	close(call.done)
	return plan, err
}

// BuildPlanUncached rebuilds the plan from PRTS without touching the cache.
func (s *Service) BuildPlanUncached(ctx context.Context, setId, raid string) (*Plan, error) {
	if raid == "" {
		raid = "normal"
	}
	set, err := s.prts.GetSet(ctx, setId)
	if err != nil {
		return nil, err
	}
	setRecord := asRecord(set)
	if setRecord == nil {
		setRecord = map[string]any{}
	}
	ids := asArray(setRecord["copilot_ids"])

	type copilotContent struct {
		id      int
		content Content
	}
	contents := make([]copilotContent, 0, len(ids))
	stageNames := make([]string, 0, len(ids))
	for _, idValue := range ids {
		data, err := s.prts.GetCopilot(ctx, jsString(idValue))
		if err != nil {
			return nil, err
		}
		copilotID, _ := integerValue(idValue)
		content := ParseCopilotContent(data)
		contents = append(contents, copilotContent{id: copilotID, content: content})
		stageNames = append(stageNames, ContentStageName(content))
	}

	stageCodes := s.resource.StageCodeMap(ctx, stageNames, s.prts.StageStats)

	items := make([]PlanItem, 0, len(contents))
	for _, entry := range contents {
		stageName := ContentStageName(entry.content)
		stageInfo, exists := stageCodes[stageName]
		apCost := 0.0
		if exists {
			apCost = stageInfo.APCost
		}
		displayStage := ""
		if exists {
			displayStage = stageInfo.Code
		}
		if displayStage == "" {
			displayStage = GetNavigationStage(entry.content)
		}
		if displayStage == "" {
			displayStage = "prts://" + jsString(entry.id)
		}
		presetFormation := IsPresetFormationCopilot(entry.content)
		opers := ContentOpers(entry.content)
		if opers == nil {
			opers = []any{}
		}
		groups := ContentGroups(entry.content)
		if groups == nil {
			groups = []any{}
		}
		var apCostPointer *float64
		if apCost > 0 {
			value := apCost
			apCostPointer = &value
		}
		items = append(items, PlanItem{
			ID:              entry.id,
			StageID:         stageName,
			Stage:           displayStage,
			APCost:          apCostPointer,
			PresetFormation: presetFormation,
			SupportsRaid:    !presetFormation,
			Operators:       opers,
			Groups:          groups,
		})
	}

	requestedModes := []string{"normal"}
	switch raid {
	case "both":
		requestedModes = []string{"normal", "raid"}
	case "raid":
		requestedModes = []string{"raid"}
	}

	entries := make([]PlanEntry, 0, len(items)*len(requestedModes))
	for itemIndex, item := range items {
		for _, mode := range requestedModes {
			if mode == "raid" && !item.SupportsRaid {
				continue
			}
			entries = append(entries, PlanEntry{
				Key:             fmt.Sprintf("%d:%d:%s", itemIndex, item.ID, mode),
				ItemIndex:       itemIndex,
				CopilotID:       item.ID,
				StageID:         item.StageID,
				DisplayStage:    item.Stage,
				APCost:          item.APCost,
				Mode:            mode,
				PresetFormation: item.PresetFormation,
			})
		}
	}

	name := asString(setRecord["name"])
	if name == "" {
		name = "作业集 " + setId
	}
	return &Plan{SetID: setId, Name: name, Items: items, Entries: entries}, nil
}

// ClearPlanCache drops cached plans; tests use it to model TTL expiry.
func (s *Service) ClearPlanCache() {
	s.planMu.Lock()
	s.planCache = map[string]planCacheEntry{}
	s.planMu.Unlock()
}

// LoadProgress reads copilot-progress.json. Read errors and malformed shapes
// degrade to an empty map, matching the Node service.
func (s *Service) LoadProgress() map[string][]string {
	value, err := jsonstore.Read(s.ProgressPath(), map[string]any{})
	if err != nil {
		return map[string][]string{}
	}
	return normalizeProgress(value)
}

// MarkCompleted merges completed entry keys into a set without duplicates.
func (s *Service) MarkCompleted(setId string, keys []string) error {
	s.progressMu.Lock()
	defer s.progressMu.Unlock()
	progress := s.LoadProgress()
	existing := progress[setId]
	if existing == nil {
		existing = []string{}
	}
	seen := map[string]struct{}{}
	for _, key := range existing {
		seen[key] = struct{}{}
	}
	for _, key := range keys {
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		existing = append(existing, key)
	}
	progress[setId] = existing
	return s.saveProgressLocked(progress)
}

// ResetProgress removes one set from copilot-progress.json. The set id is
// stringified like the Node service's String(setId).
func (s *Service) ResetProgress(setId any) error {
	s.progressMu.Lock()
	defer s.progressMu.Unlock()
	progress := s.LoadProgress()
	delete(progress, jsString(setId))
	return s.saveProgressLocked(progress)
}

func (s *Service) saveProgressLocked(progress map[string][]string) error {
	if progress == nil {
		progress = map[string][]string{}
	}
	if err := jsonstore.Write(s.ProgressPath(), progress, true); err != nil {
		return apperrors.WithStatus(
			"COPILOT_PROGRESS_WRITE_FAILED",
			"保存作业集进度失败",
			http.StatusInternalServerError,
			false,
			map[string]any{"path": s.ProgressPath(), "error": err.Error()},
		)
	}
	return nil
}

func normalizeProgress(value any) map[string][]string {
	record := asRecord(value)
	if record == nil {
		return map[string][]string{}
	}
	progress := make(map[string][]string, len(record))
	for setId, raw := range record {
		array, ok := raw.([]any)
		if !ok {
			continue
		}
		keys := make([]string, 0, len(array))
		for _, entry := range array {
			if key, ok := entry.(string); ok {
				keys = append(keys, key)
			}
		}
		progress[setId] = keys
	}
	return progress
}
