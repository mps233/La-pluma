package training

import (
	"context"
	"log/slog"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const (
	trainingQueueFile  = "training-queue.json"
	automationTaskFile = "automation-tasks.json"
	userConfigDir      = "user-configs"
)

var materialFetchScripts = []string{
	"fetch-all-materials.ts",
	"fetch-material-formulas.ts",
	"merge-formulas.ts",
	"fetch-operator-materials.ts",
}

// MaterialFetcher is the optional Go implementation of the four Node scripts
// that refresh and merge material data. When it is nil the action fails with
// the stable TRAINING_MATERIAL_FETCH_UNSUPPORTED error instead of spawning
// Node.
type MaterialFetcher interface {
	FetchOperatorMaterials(ctx context.Context) (FetchMaterialsResponse, error)
}

// Options configures a Service. Zero values fall back to slog.Default,
// time.Now and the unconfigured material fetcher.
type Options struct {
	Paths   config.Paths
	Logger  *slog.Logger
	Now     func() time.Time
	Fetcher MaterialFetcher
}

// Service owns the training queue and automation-task integration. All
// filesystem roots come from config.Paths so tests can isolate them.
type Service struct {
	paths   config.Paths
	logger  *slog.Logger
	now     func() time.Time
	fetcher MaterialFetcher

	mu     sync.Mutex
	nameMu sync.RWMutex

	materialNames map[string]string
}

// New returns a Service with the default clock and no material fetcher.
func New(paths config.Paths, logger *slog.Logger) *Service {
	return NewWithOptions(Options{Paths: paths, Logger: logger})
}

// NewWithOptions returns a fully configurable Service.
func NewWithOptions(options Options) *Service {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	now := options.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		paths:         options.Paths,
		logger:        logger,
		now:           now,
		fetcher:       options.Fetcher,
		materialNames: map[string]string{},
	}
}

func (s *Service) queuePath() string {
	return filepath.Join(s.paths.DataDir, userConfigDir, trainingQueueFile)
}

func (s *Service) automationTaskPath() string {
	return filepath.Join(s.paths.DataDir, userConfigDir, automationTaskFile)
}

func (s *Service) nowISO() string {
	return formatISO(s.now())
}

type queueFile struct {
	Queue       []QueueItem      `json:"queue"`
	Settings    TrainingSettings `json:"settings"`
	LastUpdated string           `json:"lastUpdated"`
}

func (s *Service) loadTrainingQueue() (*queueFile, error) {
	fallback := map[string]any{
		"queue":       []any{},
		"settings":    map[string]any{},
		"lastUpdated": s.nowISO(),
	}
	value, err := jsonstore.Read(s.queuePath(), fallback)
	if err != nil {
		return nil, apperrors.WithStatus(
			"AGENT_TRAINING_QUEUE_READ_FAILED",
			"读取养成队列失败",
			http.StatusInternalServerError,
			false,
			map[string]any{"path": s.queuePath(), "error": err.Error()},
		)
	}
	record, _ := asRecord(value)
	if record == nil {
		record = map[string]any{}
	}

	result := &queueFile{
		Queue:       []QueueItem{},
		Settings:    defaultTrainingSettings(),
		LastUpdated: s.nowISO(),
	}
	if array, ok := asArray(record["queue"]); ok {
		for _, raw := range array {
			if item, ok := normalizeQueueItem(raw); ok {
				result.Queue = append(result.Queue, item)
			}
		}
	}
	result.Settings = normalizeTrainingSettings(record["settings"])
	if lastUpdated, ok := record["lastUpdated"].(string); ok {
		result.LastUpdated = lastUpdated
	}
	return result, nil
}

func normalizeQueueItem(value any) (QueueItem, bool) {
	record, ok := asRecord(value)
	if !ok {
		return QueueItem{}, false
	}
	operatorID := normalizeID(record["operatorId"])
	if operatorID == "" {
		return QueueItem{}, false
	}
	item := QueueItem{OperatorID: operatorID}
	if value, ok := record["currentElite"]; ok {
		item.CurrentElite = value
	}
	if value, ok := record["targetElite"]; ok {
		item.TargetElite = value
	}
	if value, ok := record["priority"]; ok {
		item.Priority = value
	}
	if value, ok := record["status"]; ok {
		item.Status = value
	}
	if value, ok := record["addedAt"]; ok {
		item.AddedAt = value
	}
	return item, true
}

// saveTrainingQueue mirrors the Node helper: failures are logged and reported
// as false; callers follow the Node behavior and do not abort the operation.
func (s *Service) saveTrainingQueue(queue *queueFile) bool {
	queue.LastUpdated = s.nowISO()
	if err := jsonstore.Write(s.queuePath(), queue, true); err != nil {
		s.logger.Error("保存养成队列失败", "error", err)
		return false
	}
	return true
}

// GetOperatorList returns the training catalog filtered and sorted like the
// Node service. Battle-data load failures fall back to Owned OperBox rows.
func (s *Service) GetOperatorList(filters OperatorFilters) ([]TrainingOperator, error) {
	materialsData := s.loadOperatorMaterials()
	operBox := s.loadOperBox()

	owned := operBox.ownedOperators()
	ownedMap := make(map[string]operBoxOperator, len(owned))
	for _, operator := range owned {
		ownedMap[operator.ID] = operator
	}
	catalogOwnIDs := make(map[string]bool)
	for _, operator := range operBox.AllOpers {
		if operator.Own {
			catalogOwnIDs[operator.ID] = true
		}
	}

	baseOperators, err := s.loadAllOperators()
	if err != nil {
		s.logger.Warn("加载全量干员失败，降级为仅显示已识别干员", "error", err)
		baseOperators = make([]baseOperator, 0, len(owned))
		for _, operator := range owned {
			name := operator.Name
			if name == "" {
				name = operator.ID
			}
			profession := ""
			if operator.Profession != nil {
				profession = *operator.Profession
			}
			if profession == "" {
				profession = "未知"
			}
			rarity := 0.0
			if operator.Rarity != nil {
				rarity = *operator.Rarity
			}
			baseOperators = append(baseOperators, baseOperator{
				ID:         operator.ID,
				Name:       name,
				Rarity:     rarity,
				Profession: profession,
			})
		}
	}

	known := make(map[string]bool, len(baseOperators))
	for _, operator := range baseOperators {
		known[operator.ID] = true
	}
	for _, catalog := range operBox.AllOpers {
		if catalog.ID == "" || known[catalog.ID] {
			continue
		}
		profession := "未知"
		if data := materialsData.Operators[catalog.ID]; data != nil && data.Profession != nil && *data.Profession != "" {
			profession = *data.Profession
		}
		rarity := 0.0
		if catalog.Rarity != nil {
			rarity = *catalog.Rarity
		}
		name := catalog.Name
		if name == "" {
			name = catalog.ID
		}
		baseOperators = append(baseOperators, baseOperator{
			ID:         catalog.ID,
			Name:       name,
			Rarity:     rarity,
			Profession: profession,
		})
		known[catalog.ID] = true
	}

	operators := make([]TrainingOperator, 0, len(baseOperators))
	for _, base := range baseOperators {
		ownedOperator, isOwnedRow := ownedMap[base.ID]
		data := materialsData.Operators[base.ID]
		ownedFlag := isOwnedRow || catalogOwnIDs[base.ID]

		name := base.Name
		if isOwnedRow && ownedOperator.Name != "" {
			name = ownedOperator.Name
		}
		rarity := base.Rarity
		if isOwnedRow && ownedOperator.Rarity != nil {
			rarity = *ownedOperator.Rarity
		}
		profession := "未知"
		if data != nil && data.Profession != nil && *data.Profession != "" {
			profession = *data.Profession
		} else if base.Profession != "" {
			profession = base.Profession
		} else if isOwnedRow && ownedOperator.Profession != nil && *ownedOperator.Profession != "" {
			profession = *ownedOperator.Profession
		}

		currentElite := 0.0
		if ownedFlag {
			if isOwnedRow && ownedOperator.Elite != nil {
				currentElite = *ownedOperator.Elite
			}
		}
		currentLevel := 0.0
		if ownedFlag {
			currentLevel = 1
			if isOwnedRow && ownedOperator.Level != nil && *ownedOperator.Level != 0 {
				currentLevel = *ownedOperator.Level
			}
		}
		potential := 0.0
		if ownedFlag {
			potential = 1
			if isOwnedRow && ownedOperator.Potential != nil && *ownedOperator.Potential != 0 {
				potential = *ownedOperator.Potential
			}
		}

		operator := TrainingOperator{
			ID:              base.ID,
			Name:            name,
			Rarity:          rarity,
			Profession:      profession,
			Position:        base.Position,
			CurrentElite:    currentElite,
			CurrentLevel:    currentLevel,
			TargetElite:     2,
			Owned:           ownedFlag,
			Potential:       potential,
			HasMaterialData: data != nil,
			CanTrain:        false,
			DisabledReason:  nil,
			TrainingStatus:  "",
		}
		if data != nil {
			operator.Materials = &OperatorMaterialsBundle{Elite1: data.Elite1, Elite2: data.Elite2}
		}
		reason := trainingDisabledReason(operator)
		operator.CanTrain = reason == nil
		operator.DisabledReason = reason
		switch {
		case reason == nil:
			operator.TrainingStatus = "trainable"
		case ownedFlag:
			operator.TrainingStatus = *reason
		default:
			operator.TrainingStatus = "unowned"
		}
		operators = append(operators, operator)
	}

	filtered := make([]TrainingOperator, 0, len(operators))
	for _, operator := range operators {
		if filters.Rarity != nil && *filters.Rarity != 0 && operator.Rarity != float64(*filters.Rarity) {
			continue
		}
		if filters.Profession != "" && operator.Profession != filters.Profession {
			continue
		}
		if filters.Owned != nil && operator.Owned != *filters.Owned {
			continue
		}
		if filters.NeedsElite2 && operator.Owned && operator.CurrentElite >= 2 {
			continue
		}
		switch filters.Status {
		case "trainable":
			if !operator.CanTrain {
				continue
			}
		case "owned":
			if !operator.Owned {
				continue
			}
		}
		filtered = append(filtered, operator)
	}

	collator := collate.New(language.Chinese)
	sortTrainingOperators(filtered, collator)
	return filtered, nil
}

func sortTrainingOperators(operators []TrainingOperator, collator *collate.Collator) {
	// Stable insertion sort keeps the port dependency-free and mirrors the
	// stable Array.prototype.sort used by Node.
	for i := 1; i < len(operators); i++ {
		for j := i; j > 0; j-- {
			if !trainingOperatorLess(operators[j], operators[j-1], collator) {
				break
			}
			operators[j], operators[j-1] = operators[j-1], operators[j]
		}
	}
}

func trainingOperatorLess(left, right TrainingOperator, collator *collate.Collator) bool {
	if left.CanTrain != right.CanTrain {
		return left.CanTrain
	}
	if left.Owned != right.Owned {
		return left.Owned
	}
	if left.Rarity != right.Rarity {
		return left.Rarity > right.Rarity
	}
	if left.CurrentElite != right.CurrentElite {
		return left.CurrentElite < right.CurrentElite
	}
	return collator.CompareString(left.Name, right.Name) < 0
}

func trainingDisabledReason(operator TrainingOperator) *string {
	if !operator.Owned {
		reason := "unowned"
		return &reason
	}
	if !operator.HasMaterialData {
		reason := "missing_material_data"
		return &reason
	}
	if operator.CurrentElite >= operator.TargetElite {
		reason := "already_elite2"
		return &reason
	}
	return nil
}

// GetOperatorCounts reuses one full catalog pass for all three badges.
func (s *Service) GetOperatorCounts(rarity *int) (OperatorCounts, error) {
	operators, err := s.GetOperatorList(OperatorFilters{Status: "all", Rarity: rarity})
	if err != nil {
		return OperatorCounts{}, err
	}
	counts := OperatorCounts{All: len(operators)}
	for _, operator := range operators {
		if operator.CanTrain {
			counts.Trainable++
		}
		if operator.Owned {
			counts.Owned++
		}
	}
	return counts, nil
}

// GetTrainingQueue enriches each stored queue entry with live materials and
// progress. Entries without material data are omitted from the response but
// remain on disk, matching the Node service.
func (s *Service) GetTrainingQueue() (TrainingQueueResult, error) {
	queue, err := s.loadTrainingQueue()
	if err != nil {
		return TrainingQueueResult{}, err
	}
	depot := s.loadDepot()
	materialsData := s.loadOperatorMaterials()
	operBox := s.loadOperBox()
	ownedMap := make(map[string]operBoxOperator)
	for _, operator := range operBox.ownedOperators() {
		ownedMap[operator.ID] = operator
	}

	changed := false
	enriched := make([]EnrichedQueueItem, 0, len(queue.Queue))
	for index := range queue.Queue {
		item := &queue.Queue[index]
		data := materialsData.Operators[item.OperatorID]
		if data == nil {
			continue
		}
		ownedOperator, isOwned := ownedMap[item.OperatorID]

		currentElite := 0.0
		if isOwned {
			if ownedOperator.Elite != nil {
				currentElite = *ownedOperator.Elite
			}
		} else {
			if value, ok := toFiniteNumber(item.CurrentElite); ok && value > 0 {
				currentElite = value
			}
		}
		if currentElite < 0 {
			currentElite = 0
		}
		if value, numeric := jsonNumberValue(item.CurrentElite); !numeric || value != currentElite {
			item.CurrentElite = currentElite
			changed = true
		}

		profession := data.Profession
		calculation := s.calculateOperatorMaterials(trainingTarget{
			ID:           data.ID,
			Name:         data.Name,
			Rarity:       data.Rarity,
			Profession:   profession,
			CurrentElite: currentElite,
			TargetElite:  numberOr(item.TargetElite, 2),
			Materials:    &OperatorMaterialsBundle{Elite1: data.Elite1, Elite2: data.Elite2},
		}, depot.Items)

		enriched = append(enriched, EnrichedQueueItem{
			QueueItem: *item,
			Operator: QueueOperator{
				ID:         data.ID,
				Name:       data.Name,
				Rarity:     data.Rarity,
				Profession: data.Profession,
			},
			Materials:  calculation.Materials,
			LMD:        calculation.LMD,
			IsComplete: calculation.IsComplete,
			Progress:   calculateProgress(calculation),
		})
	}

	if changed {
		s.saveTrainingQueue(queue)
	}

	return TrainingQueueResult{
		Queue:       enriched,
		Settings:    queue.Settings,
		LastUpdated: queue.LastUpdated,
	}, nil
}

// AddToQueue appends one operator and returns the stored queue item.
func (s *Service) AddToQueue(operatorID string, options AddToQueueOptions) (QueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	queue, err := s.loadTrainingQueue()
	if err != nil {
		return QueueItem{}, err
	}
	materialsData := s.loadOperatorMaterials()
	operBox := s.loadOperBox()

	data := materialsData.Operators[operatorID]
	if data == nil {
		return QueueItem{}, apperrors.WithStatus(
			"AGENT_TRAINING_OPERATOR_MATERIALS_MISSING",
			"干员材料数据不存在，暂不支持该干员",
			http.StatusNotFound,
			false,
			map[string]any{"operatorId": operatorID},
		)
	}

	var ownedCandidate *operBoxOperator
	for index := range operBox.Data {
		if operBox.Data[index].ID == operatorID {
			ownedCandidate = &operBox.Data[index]
			break
		}
	}
	operatorName := data.Name
	if ownedCandidate != nil && ownedCandidate.Name != "" {
		operatorName = ownedCandidate.Name
	}

	for _, item := range queue.Queue {
		if item.OperatorID == operatorID {
			return QueueItem{}, apperrors.WithStatus(
				"AGENT_TRAINING_QUEUE_DUPLICATE",
				"干员 "+operatorName+" 已在养成队列中",
				http.StatusConflict,
				false,
				map[string]any{"operatorId": operatorID},
			)
		}
	}

	currentElite := any(float64(0))
	if options.CurrentElite != nil {
		currentElite = options.CurrentElite
	} else if ownedCandidate != nil && ownedCandidate.Elite != nil {
		currentElite = *ownedCandidate.Elite
	}
	targetElite := any(float64(2))
	if options.TargetElite != nil {
		targetElite = options.TargetElite
	}

	item := QueueItem{
		OperatorID:   operatorID,
		CurrentElite: currentElite,
		TargetElite:  targetElite,
		Priority:     len(queue.Queue) + 1,
		Status:       "pending",
		AddedAt:      s.nowISO(),
	}
	queue.Queue = append(queue.Queue, item)
	s.saveTrainingQueue(queue)
	return item, nil
}

// RemoveFromQueue deletes an entry, reindexes priorities and then refreshes
// the smart training stages on a best-effort basis exactly like the Node code.
func (s *Service) RemoveFromQueue(operatorID string) error {
	s.mu.Lock()
	queue, err := s.loadTrainingQueue()
	if err != nil {
		s.mu.Unlock()
		return err
	}
	index := -1
	for candidate, item := range queue.Queue {
		if item.OperatorID == operatorID {
			index = candidate
			break
		}
	}
	if index == -1 {
		s.mu.Unlock()
		return apperrors.NotFound(
			"AGENT_TRAINING_QUEUE_ITEM_NOT_FOUND",
			"干员不在养成队列中",
			map[string]any{"operatorId": operatorID},
		)
	}

	materialsData := s.loadOperatorMaterials()
	operatorName := operatorID
	if data := materialsData.Operators[operatorID]; data != nil && data.Name != "" {
		operatorName = data.Name
	}
	queue.Queue = append(queue.Queue[:index], queue.Queue[index+1:]...)
	for position := range queue.Queue {
		queue.Queue[position].Priority = position + 1
	}
	settings := cloneSettings(queue.Settings)
	s.saveTrainingQueue(queue)
	s.mu.Unlock()

	s.logger.Info("干员已从养成队列移除", "operatorName", operatorName, "remainingCount", len(queue.Queue))

	if len(queue.Queue) > 0 {
		plan, err := s.GenerateTrainingPlan("current", "")
		if err != nil {
			s.logger.Error("更新刷取计划失败", "error", err)
			return nil
		}
		if _, err := s.ApplyPlanToTasks(plan, map[string]any(settings)); err != nil {
			s.logger.Error("更新刷取计划失败", "error", err)
		}
		return nil
	}

	if err := s.clearSmartTrainingStages(); err != nil {
		s.logger.Error("更新刷取计划失败", "error", err)
	}
	return nil
}

// UpdateQueueOrder keeps only the supplied operators, in the supplied order.
func (s *Service) UpdateQueueOrder(operatorIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	queue, err := s.loadTrainingQueue()
	if err != nil {
		return err
	}
	next := make([]QueueItem, 0, len(operatorIDs))
	for index, operatorID := range operatorIDs {
		for _, item := range queue.Queue {
			if item.OperatorID == operatorID {
				item.Priority = index + 1
				next = append(next, item)
				break
			}
		}
	}
	queue.Queue = next
	s.saveTrainingQueue(queue)
	return nil
}

// UpdateSettings merges arbitrary overrides over the stored settings and
// normalizes the result (including the legacy notify flag).
func (s *Service) UpdateSettings(overrides map[string]any) (TrainingSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	queue, err := s.loadTrainingQueue()
	if err != nil {
		return nil, err
	}
	queue.Settings = normalizeTrainingSettings(mergeSettings(queue.Settings, overrides))
	s.saveTrainingQueue(queue)
	return queue.Settings, nil
}

// FetchOperatorMaterials delegates to the injected Go fetcher when available.
// The Node implementation shells out to four TypeScript scripts; this port
// deliberately refuses that path.
//
// TODO: implement the four fetch/merge steps in Go (network download, formula
// merge and operator material generation) and install a MaterialFetcher via
// Options.Fetcher.
func (s *Service) FetchOperatorMaterials(ctx context.Context) (FetchMaterialsResponse, error) {
	if s.fetcher != nil {
		return s.fetcher.FetchOperatorMaterials(ctx)
	}
	return FetchMaterialsResponse{}, apperrors.WithStatus(
		"TRAINING_MATERIAL_FETCH_UNSUPPORTED",
		"Go 后端暂不支持材料数据更新",
		http.StatusNotImplemented,
		false,
		map[string]any{
			"scripts": materialFetchScripts,
			"reason":  "node_scripts_not_executed",
			"todo":    "Port fetch-all-materials, fetch-material-formulas, merge-formulas and fetch-operator-materials to Go and install a MaterialFetcher",
		},
	)
}

// TodayOpenStages returns the game-day resource stage availability.
func (s *Service) TodayOpenStages(clientType string, resourceCollectionOpen bool) TodayOpenStages {
	return getTodayOpenStages(s.now(), clientType, resourceCollectionOpen)
}

// IsStageOpen reports resource-stage availability for the scheduler.
func (s *Service) IsStageOpen(stage, clientType string) (bool, string) {
	_, weekday := gameDay(s.now(), clientType)
	info := isStageOpenToday(stage, weekday, false)
	reason := ""
	if info.Reason != nil {
		reason = *info.Reason
	}
	return info.IsOpen, reason
}
