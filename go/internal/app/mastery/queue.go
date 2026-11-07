package mastery

import (
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const queueSchemaVersion = 1

var defaultQueueSettings = QueueSettings{
	ProbeIntervalMinutes: 60,
	OnItemBlocked:        "skip",
	AutoStartGame:        true,
	NotifyOnComplete:     true,
	NotifyOnBlocked:      true,
}

var actionPhases = map[string]bool{
	PhaseQueued: true, PhaseTraining: true, PhaseStarting: true, PhaseRunning: true, PhaseVerifying: true,
}

var executingPhases = map[string]bool{
	PhaseStarting: true, PhaseRunning: true, PhaseVerifying: true,
}

var pendingPhases = map[string]bool{
	PhaseQueued: true, PhaseStarting: true, PhaseRunning: true, PhaseTraining: true, PhaseVerifying: true,
}

// QueueOptions configures the queue service.
type QueueOptions struct {
	Paths  config.Paths
	Logger *slog.Logger
	Now    func() time.Time
}

// QueueService owns the persisted mastery queue and the campaign state
// machine. Every mutation is serialized by one mutex, mirroring the Node
// mutationTail.
type QueueService struct {
	paths  config.Paths
	logger *slog.Logger
	now    func() time.Time

	mu     sync.Mutex
	state  *MasteryQueueData
	loaded bool
}

// NewQueueService returns a queue service for Paths.DataDir/user-configs.
func NewQueueService(options QueueOptions) *QueueService {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	now := options.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &QueueService{paths: options.Paths, logger: logger, now: now}
}

// QueuePath is the persisted queue file path.
func (s *QueueService) QueuePath() string {
	return filepath.Join(s.paths.DataDir, userConfigDir, "operator-mastery-queue.json")
}

func (s *QueueService) nowISO() string {
	return formatISO(s.now())
}

// CampaignContext carries the resolved connection context.
type CampaignContext struct {
	ClientType      *string
	ClientProfileID *string
}

func defaultQueueData(now string) *MasteryQueueData {
	return &MasteryQueueData{
		SchemaVersion: queueSchemaVersion,
		Campaign: MasteryCampaign{
			Status:    CampaignIdle,
			Settings:  defaultQueueSettings,
			UpdatedAt: now,
		},
		Items:     []MasteryQueueItem{},
		UpdatedAt: now,
	}
}

func normalizeSettings(value any) QueueSettings {
	record, _ := asRecord(value)
	settings := defaultQueueSettings
	interval, ok := integerValue(record["probeIntervalMinutes"])
	if ok && (interval == 120 || interval == 360) {
		settings.ProbeIntervalMinutes = interval
	}
	if record["onItemBlocked"] == "pause" {
		settings.OnItemBlocked = "pause"
	}
	settings.AutoStartGame = boolNotFalse(record["autoStartGame"])
	settings.NotifyOnComplete = boolNotFalse(record["notifyOnComplete"])
	settings.NotifyOnBlocked = boolNotFalse(record["notifyOnBlocked"])
	return settings
}

func (s *QueueService) normalizeItem(raw any) (MasteryQueueItem, bool) {
	record, ok := asRecord(raw)
	if !ok {
		return MasteryQueueItem{}, false
	}
	operatorID, _ := record["operatorId"].(string)
	skillIndex, skillOK := integerValue(record["skillIndex"])
	targetLevel, targetOK := integerValue(record["targetLevel"])
	if operatorID == "" || !skillOK || skillIndex < 1 || skillIndex > 3 {
		return MasteryQueueItem{}, false
	}
	if !targetOK || targetLevel < 1 || targetLevel > 3 {
		return MasteryQueueItem{}, false
	}

	now := s.nowISO()
	phase := PhaseQueued
	if value, ok := record["phase"].(string); ok {
		phase = value
	}
	confirmedLevel := 0
	if value, ok := integerValue(record["confirmedLevel"]); ok {
		confirmedLevel = value
	}
	declaredLevel := confirmedLevel
	if value, ok := integerValue(record["declaredLevel"]); ok {
		declaredLevel = value
	}
	operatorName, hasOperatorName := record["operatorName"].(string)
	if !hasOperatorName {
		operatorName = operatorID
	}
	item := MasteryQueueItem{
		ID:                  fmt.Sprintf("%s:%d", operatorID, skillIndex),
		OperatorID:          operatorID,
		OperatorName:        operatorName,
		SkillIndex:          skillIndex,
		SkillName:           fmt.Sprintf("技能 %d", skillIndex),
		TargetLevel:         targetLevel,
		DeclaredLevel:       clamp(declaredLevel, 0, 3),
		ConfirmedLevel:      clamp(confirmedLevel, 0, 3),
		LevelVerified:       boolTrue(record["levelVerified"]),
		Phase:               phase,
		Enabled:             boolNotFalse(record["enabled"]),
		Order:               int(numberOr(record["order"], 0)),
		VerifyCount:         int(numberOr(record["verifyCount"], 0)),
		Attempts:            int(numberOr(record["attempts"], 0)),
		ConsecutiveFailures: int(numberOr(record["consecutiveFailures"], 0)),
		ProbeBackoffIndex:   int(numberOr(record["probeBackoffIndex"], 0)),
		AddedAt:             now,
		UpdatedAt:           now,
	}
	if value, ok := record["role"].(string); ok {
		item.Role = &value
	}
	if value, ok := record["skillId"].(string); ok {
		item.SkillID = &value
	}
	if value, ok := record["skillName"].(string); ok {
		item.SkillName = value
	}
	if value, ok := integerValue(record["startedLevel"]); ok {
		item.StartedLevel = &value
	}
	if value, ok := record["lastErrorCode"].(string); ok {
		item.LastErrorCode = &value
	}
	if value, ok := record["trainingStartedAt"].(string); ok {
		item.TrainingStartedAt = &value
	}
	if value, ok := record["nextProbeAt"].(string); ok {
		item.NextProbeAt = &value
	}
	if value, ok := record["activeRunId"].(string); ok {
		item.ActiveRunID = &value
	}
	if value, ok := record["lastRunId"].(string); ok {
		item.LastRunID = &value
	}
	if value, ok := record["addedAt"].(string); ok {
		item.AddedAt = value
	}
	if value, ok := record["updatedAt"].(string); ok {
		item.UpdatedAt = value
	}
	if value, ok := record["completedAt"].(string); ok {
		item.CompletedAt = &value
	}
	if value, ok := record["skippedAt"].(string); ok {
		item.SkippedAt = &value
	}

	if blocked, ok := asRecord(record["blocked"]); ok {
		entry := &MasteryBlocked{
			Code:      "MASTERY_ITEM_BLOCKED",
			Message:   "专精目标受阻",
			Detail:    blocked["detail"],
			Retryable: boolNotFalse(blocked["retryable"]),
			At:        now,
		}
		if value, ok := blocked["code"].(string); ok {
			entry.Code = value
		}
		if value, ok := blocked["message"].(string); ok {
			entry.Message = value
		}
		if value, ok := blocked["at"].(string); ok {
			entry.At = value
		}
		item.Blocked = entry
	}
	if outcome, ok := asRecord(record["lastOutcome"]); ok {
		entry := &MasteryItemOutcome{SkillMastery: flexNumbers(outcome["skillMastery"])}
		if value, ok := outcome["result"].(string); ok {
			entry.Result = &value
		}
		if value, ok := outcome["resultDetail"].(string); ok {
			entry.ResultDetail = &value
		}
		if value, ok := outcome["runId"].(string); ok {
			entry.RunID = &value
		}
		if value, ok := outcome["at"].(string); ok {
			entry.At = &value
		}
		entry.LogCheckpointPresent = boolTrue(outcome["logCheckpointPresent"])
		item.LastOutcome = entry
	}
	if recovery, ok := asRecord(record["recovery"]); ok {
		entry := &MasteryRecovery{PreviousPhase: PhaseQueued, DetectedAt: now}
		if value, ok := recovery["previousPhase"].(string); ok {
			entry.PreviousPhase = value
		}
		if value, ok := recovery["previousRunId"].(string); ok {
			entry.PreviousRunID = &value
		}
		if value, ok := recovery["detectedAt"].(string); ok {
			entry.DetectedAt = value
		}
		item.Recovery = entry
	}
	return item, true
}

func (s *QueueService) normalizeQueueData(raw any) *MasteryQueueData {
	record, _ := asRecord(raw)
	now := s.nowISO()
	base := defaultQueueData(now)
	campaignRecord, _ := asRecord(record["campaign"])
	campaign := MasteryCampaign{
		Status:    CampaignIdle,
		Settings:  normalizeSettings(campaignRecord["settings"]),
		UpdatedAt: base.Campaign.UpdatedAt,
	}
	if value, ok := campaignRecord["status"].(string); ok {
		campaign.Status = value
	}
	if value, ok := campaignRecord["activeItemId"].(string); ok {
		campaign.ActiveItemID = &value
	}
	if value, ok := campaignRecord["activeStepRunId"].(string); ok {
		campaign.ActiveStepRunID = &value
	}
	if value, ok := campaignRecord["clientProfileId"].(string); ok {
		campaign.ClientProfileID = &value
	}
	if value, ok := campaignRecord["clientType"].(string); ok {
		campaign.ClientType = &value
	}
	if value, ok := campaignRecord["startedAt"].(string); ok {
		campaign.StartedAt = &value
	}
	if value, ok := campaignRecord["pausedReason"].(string); ok {
		campaign.PausedReason = &value
	}
	if value, ok := campaignRecord["updatedAt"].(string); ok {
		campaign.UpdatedAt = value
	}

	items := make([]MasteryQueueItem, 0)
	for _, rawItem := range arrayItems(record["items"]) {
		if item, ok := s.normalizeItem(rawItem); ok {
			items = append(items, item)
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].Order < items[j].Order })

	updatedAt := base.UpdatedAt
	if value, ok := record["updatedAt"].(string); ok {
		updatedAt = value
	}
	return &MasteryQueueData{
		SchemaVersion: queueSchemaVersion,
		Campaign:      campaign,
		Items:         items,
		UpdatedAt:     updatedAt,
	}
}

func (s *QueueService) loadLocked() (*MasteryQueueData, error) {
	if s.loaded {
		return s.state, nil
	}
	path := s.QueuePath()
	raw, err := jsonstore.Read(path, nil)
	if err != nil {
		return nil, apperrors.WithStatus(
			"AGENT_MASTERY_QUEUE_CORRUPT",
			"专精队列读取失败："+err.Error(),
			http.StatusServiceUnavailable,
			false,
			map[string]any{"path": path},
		)
	}
	if raw == nil {
		s.state = defaultQueueData(s.nowISO())
	} else {
		s.state = s.normalizeQueueData(raw)
	}
	s.loaded = true
	return s.state, nil
}

func (s *QueueService) saveLocked(data *MasteryQueueData) error {
	data.UpdatedAt = s.nowISO()
	data.Campaign.UpdatedAt = data.UpdatedAt
	if err := jsonstore.Write(s.QueuePath(), data, true); err != nil {
		return apperrors.WithStatus(
			"AGENT_MASTERY_QUEUE_WRITE_FAILED",
			"专精队列写入失败："+err.Error(),
			http.StatusInternalServerError,
			true,
			map[string]any{"path": s.QueuePath()},
		)
	}
	s.state = data
	return nil
}

func countsFor(items []MasteryQueueItem) MasteryQueueCounts {
	counts := MasteryQueueCounts{Total: len(items)}
	for _, item := range items {
		switch item.Phase {
		case PhaseQueued, PhaseStarting, PhaseRunning, PhaseVerifying:
			counts.Queued++
		case PhaseTraining:
			counts.Training++
		case PhaseBlocked:
			counts.Blocked++
		case PhaseCompleted:
			counts.Completed++
		}
	}
	return counts
}

func (s *QueueService) findLocked(data *MasteryQueueData, id string) (*MasteryQueueItem, int) {
	for index := range data.Items {
		if data.Items[index].ID == id {
			return &data.Items[index], index
		}
	}
	return nil, -1
}

func (s *QueueService) activeItemLocked(data *MasteryQueueData) *MasteryQueueItem {
	if data.Campaign.ActiveItemID == nil {
		return nil
	}
	item, _ := s.findLocked(data, *data.Campaign.ActiveItemID)
	return item
}

func firstActionable(items []MasteryQueueItem, campaign *MasteryCampaign) *MasteryQueueItem {
	var active *MasteryQueueItem
	if campaign.ActiveItemID != nil {
		for index := range items {
			if items[index].ID == *campaign.ActiveItemID {
				active = &items[index]
				break
			}
		}
	}
	if active != nil && actionPhases[active.Phase] {
		return active
	}
	indices := make([]int, 0, len(items))
	for index := range items {
		item := &items[index]
		if item.Enabled && (item.Phase == PhaseQueued || item.Phase == PhaseTraining) {
			indices = append(indices, index)
		}
	}
	sort.SliceStable(indices, func(i, j int) bool { return items[indices[i]].Order < items[indices[j]].Order })
	if len(indices) == 0 {
		return nil
	}
	return &items[indices[0]]
}

func (s *QueueService) statusLocked(data *MasteryQueueData) MasteryQueueStatus {
	items := append([]MasteryQueueItem{}, data.Items...)
	status := MasteryQueueStatus{
		Campaign: data.Campaign,
		Items:    items,
		Counts:   countsFor(data.Items),
	}
	status.ActiveItem = s.activeItemLocked(data)
	status.NextActionableItem = firstActionable(data.Items, &data.Campaign)
	return status
}

// Status returns the campaign, items, counts and the next actionable target.
func (s *QueueService) Status() (MasteryQueueStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return MasteryQueueStatus{}, err
	}
	return s.statusLocked(data), nil
}

// AddItemInput is one target requested by /items.
type AddItemInput struct {
	OperatorID    string
	SkillIndex    int
	TargetLevel   int
	DeclaredLevel int
}

// AddItemsResult reports what was appended.
type AddItemsResult struct {
	Items []MasteryQueueItem `json:"items"`
	Added int                `json:"added"`
}

// AddItems validates and appends targets after loading live operator detail.
func (s *QueueService) AddItems(inputs []AddItemInput, dataService *DataService, context CampaignContext) (AddItemsResult, error) {
	if len(inputs) == 0 {
		return AddItemsResult{}, apperrors.WithStatus("AGENT_MASTERY_TARGET_INVALID", "至少需要一个专精目标", http.StatusBadRequest, false, nil)
	}
	if len(inputs) > 30 {
		return AddItemsResult{}, apperrors.WithStatus("AGENT_MASTERY_TARGET_INVALID", "一次最多添加 30 个专精目标", http.StatusBadRequest, false, nil)
	}
	if dataService == nil {
		return AddItemsResult{}, apperrors.WithStatus("AGENT_MASTERY_DATA_UNAVAILABLE", "专精数据服务不可用", http.StatusServiceUnavailable, true, nil)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return AddItemsResult{}, err
	}
	existing := make(map[string]bool, len(data.Items))
	for _, item := range data.Items {
		existing[item.ID] = true
	}
	nextOrder := 1
	for _, item := range data.Items {
		if item.Order >= nextOrder {
			nextOrder = item.Order + 1
		}
	}
	created := make([]MasteryQueueItem, 0, len(inputs))

	for _, input := range inputs {
		operatorID := strings.TrimSpace(input.OperatorID)
		skillIndex := input.SkillIndex
		targetLevel := input.TargetLevel
		declaredLevel := input.DeclaredLevel
		if operatorID == "" || skillIndex < 1 || skillIndex > 3 {
			return AddItemsResult{}, apperrors.WithStatus(
				"AGENT_MASTERY_TARGET_INVALID",
				"干员或技能槽无效",
				http.StatusBadRequest,
				false,
				map[string]any{"operatorId": operatorID, "skillIndex": skillIndex},
			)
		}
		if targetLevel < 1 || targetLevel > 3 {
			return AddItemsResult{}, apperrors.WithStatus(
				"AGENT_MASTERY_TARGET_INVALID",
				"目标专精等级必须是 M1-M3",
				http.StatusBadRequest,
				false,
				map[string]any{"targetLevel": targetLevel},
			)
		}
		if declaredLevel < 0 || declaredLevel > 2 || targetLevel <= declaredLevel {
			return AddItemsResult{}, apperrors.WithStatus(
				"AGENT_MASTERY_TARGET_INVALID",
				"目标等级必须高于当前专精等级",
				http.StatusBadRequest,
				false,
				map[string]any{"declaredLevel": declaredLevel, "targetLevel": targetLevel},
			)
		}
		id := fmt.Sprintf("%s:%d", operatorID, skillIndex)
		if existing[id] {
			return AddItemsResult{}, apperrors.WithStatus(
				"AGENT_MASTERY_DUPLICATE",
				"该干员技能已经在专精队列中",
				http.StatusConflict,
				false,
				map[string]any{"id": id},
			)
		}

		detail, detailErr := dataService.GetOperatorDetail(operatorID, OperatorDetailOptions{
			ClientType:    derefString(context.ClientType),
			DeclaredLevel: declaredLevel,
		})
		if detailErr != nil {
			return AddItemsResult{}, detailErr
		}
		if !detail.Owned || !detail.OwnedStateKnown || detail.CurrentElite < 2 {
			return AddItemsResult{}, apperrors.WithStatus(
				"AGENT_MASTERY_OPERATOR_NOT_ELIGIBLE",
				"该干员未拥有、状态未识别或尚未精二",
				422,
				false,
				map[string]any{
					"operatorId":      operatorID,
					"owned":           detail.Owned,
					"ownedStateKnown": detail.OwnedStateKnown,
					"currentElite":    detail.CurrentElite,
				},
			)
		}
		var skill *MasterySkillDetail
		for index := range detail.Skills {
			if detail.Skills[index].Index == float64(skillIndex) {
				skill = &detail.Skills[index]
				break
			}
		}
		if skill == nil {
			return AddItemsResult{}, apperrors.WithStatus(
				"AGENT_MASTERY_SKILL_NOT_FOUND",
				"该干员没有对应的技能槽",
				http.StatusNotFound,
				false,
				map[string]any{"operatorId": operatorID, "skillIndex": skillIndex},
			)
		}
		hasTarget := false
		for _, level := range skill.Mastery {
			if level.Level == float64(targetLevel) {
				hasTarget = true
				break
			}
		}
		if !hasTarget {
			return AddItemsResult{}, apperrors.WithStatus(
				"AGENT_MASTERY_TARGET_INVALID",
				"该技能没有对应的专精等级数据",
				http.StatusBadRequest,
				false,
				map[string]any{"operatorId": operatorID, "skillIndex": skillIndex, "targetLevel": targetLevel},
			)
		}

		now := s.nowISO()
		skillID := skill.SkillID
		item := MasteryQueueItem{
			ID:             id,
			OperatorID:     operatorID,
			OperatorName:   detail.Name,
			Role:           detail.Role,
			SkillIndex:     skillIndex,
			SkillID:        &skillID,
			SkillName:      skill.Name,
			TargetLevel:    targetLevel,
			DeclaredLevel:  declaredLevel,
			ConfirmedLevel: declaredLevel,
			Phase:          PhaseQueued,
			Enabled:        true,
			Order:          nextOrder,
			AddedAt:        now,
			UpdatedAt:      now,
		}
		nextOrder++
		existing[id] = true
		data.Items = append(data.Items, item)
		created = append(created, copyItem(item))
	}

	if context.ClientType != nil && *context.ClientType != "" {
		value := *context.ClientType
		data.Campaign.ClientType = &value
	}
	if context.ClientProfileID != nil && *context.ClientProfileID != "" {
		value := *context.ClientProfileID
		data.Campaign.ClientProfileID = &value
	}
	if err := s.saveLocked(data); err != nil {
		return AddItemsResult{}, err
	}
	return AddItemsResult{Items: created, Added: len(created)}, nil
}

// ItemPatch updates a queued target. Nil fields are left unchanged.
type ItemPatch struct {
	TargetLevel *int
	Enabled     *bool
}

// UpdateItem applies target-level or enabled changes.
func (s *QueueService) UpdateItem(id string, patch ItemPatch) (MasteryQueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return MasteryQueueItem{}, err
	}
	item, _ := s.findLocked(data, id)
	if item == nil {
		return MasteryQueueItem{}, itemNotFound(id)
	}
	if executingPhases[item.Phase] {
		return MasteryQueueItem{}, apperrors.WithStatus(
			"AGENT_MASTERY_STATE_INVALID",
			"当前目标正在执行，暂时不能修改",
			http.StatusConflict,
			true,
			map[string]any{"id": id, "phase": item.Phase},
		)
	}
	if patch.TargetLevel != nil {
		targetLevel := *patch.TargetLevel
		if targetLevel < 1 || targetLevel > 3 {
			return MasteryQueueItem{}, apperrors.WithStatus(
				"AGENT_MASTERY_TARGET_INVALID",
				"目标专精等级必须是 M1-M3",
				http.StatusBadRequest,
				false,
				map[string]any{"id": id, "targetLevel": targetLevel},
			)
		}
		if targetLevel <= item.ConfirmedLevel {
			return MasteryQueueItem{}, apperrors.WithStatus(
				"AGENT_MASTERY_TARGET_INVALID",
				"目标等级必须高于已确认等级",
				http.StatusBadRequest,
				false,
				map[string]any{"id": id, "confirmedLevel": item.ConfirmedLevel, "targetLevel": targetLevel},
			)
		}
		item.TargetLevel = targetLevel
	}
	if patch.Enabled != nil {
		item.Enabled = *patch.Enabled
	}
	if item.Phase == PhaseCompleted {
		item.Phase = PhaseQueued
	}
	item.UpdatedAt = s.nowISO()
	if err := s.saveLocked(data); err != nil {
		return MasteryQueueItem{}, err
	}
	return copyItem(*item), nil
}

// RemoveItem deletes a target unless a step is in flight.
func (s *QueueService) RemoveItem(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return err
	}
	item, _ := s.findLocked(data, id)
	if item == nil {
		return itemNotFound(id)
	}
	if executingPhases[item.Phase] {
		return apperrors.WithStatus(
			"AGENT_MASTERY_STATE_INVALID",
			"当前目标正在执行，请先暂停或停止队列",
			http.StatusConflict,
			true,
			map[string]any{"id": id, "phase": item.Phase},
		)
	}
	filtered := make([]MasteryQueueItem, 0, len(data.Items)-1)
	for _, candidate := range data.Items {
		if candidate.ID != id {
			filtered = append(filtered, candidate)
		}
	}
	data.Items = filtered
	if data.Campaign.ActiveItemID != nil && *data.Campaign.ActiveItemID == id {
		data.Campaign.ActiveItemID = nil
		data.Campaign.ActiveStepRunID = nil
	}
	return s.saveLocked(data)
}

// Reorder reassigns order numbers and sorts the queue.
func (s *QueueService) Reorder(order []string) ([]MasteryQueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	active := s.activeItemLocked(data)
	ids := make([]string, 0, len(data.Items))
	known := make(map[string]bool, len(data.Items))
	for _, item := range data.Items {
		ids = append(ids, item.ID)
		known[item.ID] = true
	}
	if len(order) != len(ids) || hasDuplicates(order) {
		return nil, apperrors.WithStatus(
			"AGENT_MASTERY_ORDER_INVALID",
			"排序列表必须包含队列中的全部目标且不能重复",
			http.StatusBadRequest,
			false,
			nil,
		)
	}
	for _, id := range order {
		if !known[id] {
			return nil, apperrors.WithStatus(
				"AGENT_MASTERY_ORDER_INVALID",
				"排序列表包含未知目标："+id,
				http.StatusBadRequest,
				false,
				map[string]any{"id": id},
			)
		}
	}
	if active != nil && (active.Phase == PhaseStarting || active.Phase == PhaseRunning || active.Phase == PhaseTraining || active.Phase == PhaseVerifying) {
		return nil, apperrors.WithStatus(
			"AGENT_MASTERY_STATE_INVALID",
			"活动目标运行中不能调整顺序",
			http.StatusConflict,
			false,
			map[string]any{"activeId": active.ID},
		)
	}
	orderMap := make(map[string]int, len(order))
	for index, id := range order {
		orderMap[id] = index + 1
	}
	now := s.nowISO()
	for index := range data.Items {
		if value, ok := orderMap[data.Items[index].ID]; ok {
			data.Items[index].Order = value
		}
		data.Items[index].UpdatedAt = now
	}
	sort.SliceStable(data.Items, func(i, j int) bool { return data.Items[i].Order < data.Items[j].Order })
	if err := s.saveLocked(data); err != nil {
		return nil, err
	}
	return append([]MasteryQueueItem{}, data.Items...), nil
}

func hasDuplicates(values []string) bool {
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		if seen[value] {
			return true
		}
		seen[value] = true
	}
	return false
}

// UpdateSettings merges arbitrary overrides over the campaign settings.
func (s *QueueService) UpdateSettings(patch map[string]any) (QueueSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return QueueSettings{}, err
	}
	merged := toAnyMap(data.Campaign.Settings)
	for key, value := range patch {
		merged[key] = value
	}
	data.Campaign.Settings = normalizeSettings(merged)
	if err := s.saveLocked(data); err != nil {
		return QueueSettings{}, err
	}
	return data.Campaign.Settings, nil
}

// StartCampaign arms the queue and selects the first actionable target.
func (s *QueueService) StartCampaign(context CampaignContext) (MasteryQueueStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return MasteryQueueStatus{}, err
	}
	actionable := firstActionable(data.Items, &data.Campaign)
	if actionable == nil {
		return MasteryQueueStatus{}, queueEmpty()
	}
	data.Campaign.Status = CampaignRunning
	data.Campaign.ActiveItemID = &actionable.ID
	data.Campaign.ActiveStepRunID = nil
	data.Campaign.PausedReason = nil
	if data.Campaign.StartedAt == nil {
		value := s.nowISO()
		data.Campaign.StartedAt = &value
	}
	if context.ClientType != nil && *context.ClientType != "" {
		value := *context.ClientType
		data.Campaign.ClientType = &value
	}
	if context.ClientProfileID != nil && *context.ClientProfileID != "" {
		value := *context.ClientProfileID
		data.Campaign.ClientProfileID = &value
	}
	if actionable.Phase == PhaseBlocked {
		actionable.Phase = PhaseQueued
	}
	if err := s.saveLocked(data); err != nil {
		return MasteryQueueStatus{}, err
	}
	status := s.statusLocked(data)
	status.ActiveItem = actionable
	status.NextActionableItem = actionable
	return status, nil
}

// PauseCampaign stops starting new steps.
func (s *QueueService) PauseCampaign(reason *string) (MasteryQueueStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return MasteryQueueStatus{}, err
	}
	if data.Campaign.Status == CampaignRunning {
		data.Campaign.Status = CampaignPaused
		message := "用户暂停"
		if reason != nil && *reason != "" {
			message = *reason
		}
		data.Campaign.PausedReason = &message
	}
	if err := s.saveLocked(data); err != nil {
		return MasteryQueueStatus{}, err
	}
	return s.statusLocked(data), nil
}

// ResumeCampaign resumes paused, blocked, interrupted or idle campaigns.
func (s *QueueService) ResumeCampaign() (MasteryQueueStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return MasteryQueueStatus{}, err
	}
	switch data.Campaign.Status {
	case CampaignPaused, CampaignBlocked, CampaignInterrupted, CampaignIdle:
		actionable := firstActionable(data.Items, &data.Campaign)
		if actionable == nil {
			return MasteryQueueStatus{}, queueEmpty()
		}
		data.Campaign.Status = CampaignRunning
		data.Campaign.ActiveItemID = &actionable.ID
		data.Campaign.PausedReason = nil
	}
	if err := s.saveLocked(data); err != nil {
		return MasteryQueueStatus{}, err
	}
	return s.statusLocked(data), nil
}

// StopCampaign returns to idle and interrupts any in-flight step.
func (s *QueueService) StopCampaign() (MasteryQueueStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return MasteryQueueStatus{}, err
	}
	active := s.activeItemLocked(data)
	data.Campaign.Status = CampaignIdle
	data.Campaign.ActiveItemID = nil
	data.Campaign.ActiveStepRunID = nil
	data.Campaign.PausedReason = nil
	if active != nil && executingPhases[active.Phase] {
		now := s.nowISO()
		active.Recovery = &MasteryRecovery{
			PreviousPhase: active.Phase,
			PreviousRunID: active.ActiveRunID,
			DetectedAt:    now,
		}
		active.Phase = PhaseInterrupted
		active.ActiveRunID = nil
		active.UpdatedAt = now
	}
	if err := s.saveLocked(data); err != nil {
		return MasteryQueueStatus{}, err
	}
	return s.statusLocked(data), nil
}

// MarkStartingInput records the run reserved for one step.
type MarkStartingInput struct {
	StepTarget int
	RunID      string
	Attempt    int
}

// MarkItemStarting persists the step-start transition.
func (s *QueueService) MarkItemStarting(id string, input MarkStartingInput) (MasteryQueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return MasteryQueueItem{}, err
	}
	item, _ := s.findLocked(data, id)
	if item == nil {
		return MasteryQueueItem{}, itemNotFound(id)
	}
	now := s.nowISO()
	runID := input.RunID
	item.Phase = PhaseStarting
	item.ActiveRunID = &runID
	item.LastRunID = &runID
	item.Attempts = input.Attempt
	item.UpdatedAt = now
	data.Campaign.ActiveItemID = &item.ID
	data.Campaign.ActiveStepRunID = &runID
	if err := s.saveLocked(data); err != nil {
		return MasteryQueueItem{}, err
	}
	return copyItem(*item), nil
}

// MarkItemStepRunning promotes starting to running.
func (s *QueueService) MarkItemStepRunning(id string, runID string) (MasteryQueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return MasteryQueueItem{}, err
	}
	item, _ := s.findLocked(data, id)
	if item == nil {
		return MasteryQueueItem{}, itemNotFound(id)
	}
	if item.Phase == PhaseStarting {
		item.Phase = PhaseRunning
	}
	value := runID
	item.ActiveRunID = &value
	item.UpdatedAt = s.nowISO()
	data.Campaign.ActiveStepRunID = &value
	if err := s.saveLocked(data); err != nil {
		return MasteryQueueItem{}, err
	}
	return copyItem(*item), nil
}

// ApplyStepOutcome updates an item after one OperProgress execution.
func (s *QueueService) ApplyStepOutcome(id string, outcome StepOutcome, settings QueueSettings) (MasteryQueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return MasteryQueueItem{}, err
	}
	item, _ := s.findLocked(data, id)
	if item == nil {
		return MasteryQueueItem{}, itemNotFound(id)
	}

	now := s.nowISO()
	detail := outcome.ResultDetail
	stepTarget := item.ConfirmedLevel + 1
	if item.StartedLevel != nil {
		stepTarget = *item.StartedLevel
	}
	skillMastery := outcome.SkillMastery
	reportedStartedLevel := 0
	if skillMastery != nil && item.SkillIndex-1 >= 0 && item.SkillIndex-1 < len(skillMastery) {
		if value, ok := integerFromFloat(skillMastery[item.SkillIndex-1]); ok {
			reportedStartedLevel = value
		}
	}

	lastOutcome := &MasteryItemOutcome{
		Result:               outcome.Result,
		SkillMastery:         skillMastery,
		RunID:                outcome.RunID,
		At:                   &now,
		LogCheckpointPresent: outcome.LogCheckpointPresent,
	}
	if detail != "" {
		lastOutcome.ResultDetail = &detail
	}
	item.LastOutcome = lastOutcome
	item.ActiveRunID = nil
	data.Campaign.ActiveStepRunID = nil

	switch {
	case detail == "AlreadySatisfied":
		if stepTarget > item.ConfirmedLevel {
			item.ConfirmedLevel = stepTarget
		}
		item.LevelVerified = true
		item.VerifyCount++
		item.LastErrorCode = nil
		item.Blocked = nil
		if item.ConfirmedLevel >= item.TargetLevel {
			item.Phase = PhaseCompleted
			item.CompletedAt = &now
			item.NextProbeAt = nil
		} else {
			item.Phase = PhaseQueued
			item.StartedLevel = nil
			item.NextProbeAt = nil
		}
	case detail == "Completed" || detail == "PrerequisiteTraining":
		startedLevel := stepTarget
		if reportedStartedLevel > 0 {
			startedLevel = reportedStartedLevel
		}
		item.StartedLevel = &startedLevel
		item.ConfirmedLevel = maxInt(0, minInt(item.ConfirmedLevel, startedLevel-1))
		item.LevelVerified = item.ConfirmedLevel > 0
		item.Phase = PhaseTraining
		item.TrainingStartedAt = &now
		next := formatISO(s.now().Add(time.Duration(settings.ProbeIntervalMinutes) * time.Minute))
		item.NextProbeAt = &next
		item.LastErrorCode = nil
		item.Blocked = nil
		item.ConsecutiveFailures = 0
	case detail == "TrainingRoomBusy":
		if item.TrainingStartedAt != nil {
			item.Phase = PhaseTraining
			next := formatISO(s.now().Add(time.Duration(settings.ProbeIntervalMinutes) * time.Minute))
			item.NextProbeAt = &next
		} else {
			item.Phase = PhaseBlocked
			item.NextProbeAt = nil
			item.Blocked = &MasteryBlocked{
				Code:      "AGENT_MASTERY_TRAINING_ROOM_BUSY",
				Message:   "训练室正在被其他训练占用",
				Retryable: true,
				At:        now,
			}
		}
	case detail == "ResourceInsufficient" || detail == "FormulaLocked" || detail == "ChipNotCraftable" ||
		detail == "PrerequisiteNotMet" || detail == "Unsupported" || detail == "OperatorNotFound":
		item.Phase = PhaseBlocked
		code := "AGENT_MASTERY_" + upperSnake(detail)
		item.Blocked = &MasteryBlocked{
			Code:      code,
			Message:   masteryBlockedMessage(detail),
			Retryable: detail != "Unsupported",
			At:        now,
		}
		item.LastErrorCode = &code
		item.NextProbeAt = nil
	case detail == "RecognitionFailed" || detail == "Interrupt" || detail == "Unknown" || detail == "":
		item.ConsecutiveFailures++
		code := "AGENT_MASTERY_UNKNOWN_RESULT"
		if detail != "" {
			code = "AGENT_MASTERY_" + strings.ToUpper(detail)
		}
		item.LastErrorCode = &code
		if item.ConsecutiveFailures >= 2 {
			message := "专精结果无法确认，需要人工复核"
			if outcome.Message != nil && *outcome.Message != "" {
				message = *outcome.Message
			}
			item.Phase = PhaseFailed
			item.Blocked = &MasteryBlocked{
				Code:      code,
				Message:   message,
				Retryable: true,
				At:        now,
			}
			item.NextProbeAt = nil
			data.Campaign.Status = CampaignBlocked
			data.Campaign.PausedReason = &message
		} else {
			item.Phase = PhaseQueued
			if item.TrainingStartedAt != nil {
				item.Phase = PhaseTraining
			}
			next := formatISO(s.now().Add(5 * time.Minute))
			item.NextProbeAt = &next
		}
	default:
		item.Phase = PhaseTraining
		next := formatISO(s.now().Add(time.Duration(settings.ProbeIntervalMinutes) * time.Minute))
		item.NextProbeAt = &next
	}

	item.UpdatedAt = now
	if err := s.saveLocked(data); err != nil {
		return MasteryQueueItem{}, err
	}
	return copyItem(*item), nil
}

func upperSnake(value string) string {
	var builder strings.Builder
	for index := 0; index < len(value); index++ {
		char := value[index]
		if index > 0 && char >= 'A' && char <= 'Z' && value[index-1] >= 'a' && value[index-1] <= 'z' {
			builder.WriteByte('_')
		}
		builder.WriteByte(char)
	}
	return strings.ToUpper(builder.String())
}

func masteryBlockedMessage(detail string) string {
	switch detail {
	case "ResourceInsufficient":
		return "专精材料不足，且无法从仓库继续合成"
	case "FormulaLocked":
		return "缺少专精材料合成配方"
	case "ChipNotCraftable":
		return "所需芯片无法通过加工站合成"
	case "PrerequisiteNotMet":
		return "干员未精二或技能未达到 7 级"
	case "OperatorNotFound":
		return "在游戏干员列表中未找到目标干员"
	case "Unsupported":
		return "当前 MAA 版本不支持该专精操作"
	default:
		return "专精步骤受阻"
	}
}

// MarkCampaignBlocked pauses the campaign with a reason.
func (s *QueueService) MarkCampaignBlocked(reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return err
	}
	data.Campaign.Status = CampaignBlocked
	data.Campaign.PausedReason = &reason
	return s.saveLocked(data)
}

// MarkCampaignCompleted finishes the campaign.
func (s *QueueService) MarkCampaignCompleted() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return err
	}
	data.Campaign.Status = CampaignCompleted
	data.Campaign.ActiveItemID = nil
	data.Campaign.ActiveStepRunID = nil
	return s.saveLocked(data)
}

// TransientReset is the input for ResetItemAfterTransientError.
type TransientReset struct {
	Code      string
	Message   string
	RetryAt   string
	Retryable *bool
}

// ResetItemAfterTransientError returns an item to the queue with a retryAt.
func (s *QueueService) ResetItemAfterTransientError(id string, input TransientReset) (MasteryQueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return MasteryQueueItem{}, err
	}
	item, _ := s.findLocked(data, id)
	if item == nil {
		return MasteryQueueItem{}, itemNotFound(id)
	}
	now := s.nowISO()
	retryable := true
	if input.Retryable != nil {
		retryable = *input.Retryable
	}
	code := input.Code
	item.ActiveRunID = nil
	item.LastErrorCode = &code
	item.ConsecutiveFailures++
	item.NextProbeAt = &input.RetryAt
	item.Phase = PhaseQueued
	if item.TrainingStartedAt != nil {
		item.Phase = PhaseTraining
	}
	item.Blocked = &MasteryBlocked{
		Code:      code,
		Message:   input.Message,
		Retryable: retryable,
		At:        now,
	}
	item.UpdatedAt = now
	data.Campaign.ActiveStepRunID = nil
	if err := s.saveLocked(data); err != nil {
		return MasteryQueueItem{}, err
	}
	return copyItem(*item), nil
}

// AdvanceCampaign selects the next actionable item or finishes the campaign.
func (s *QueueService) AdvanceCampaign() (MasteryQueueStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return MasteryQueueStatus{}, err
	}
	next := firstActionable(data.Items, &data.Campaign)
	if next != nil {
		data.Campaign.ActiveItemID = &next.ID
		data.Campaign.ActiveStepRunID = nil
	} else {
		data.Campaign.ActiveItemID = nil
		data.Campaign.ActiveStepRunID = nil
		hasBlocked := false
		hasPending := false
		for _, item := range data.Items {
			if item.Phase == PhaseBlocked || item.Phase == PhaseFailed {
				hasBlocked = true
			}
			if item.Enabled && pendingPhases[item.Phase] {
				hasPending = true
			}
		}
		if hasBlocked && !hasPending {
			data.Campaign.Status = CampaignBlocked
			reason := "所有剩余专精目标都需要人工处理"
			data.Campaign.PausedReason = &reason
		} else if !hasPending {
			data.Campaign.Status = CampaignCompleted
		}
	}
	if err := s.saveLocked(data); err != nil {
		return MasteryQueueStatus{}, err
	}
	status := s.statusLocked(data)
	status.NextActionableItem = next
	return status, nil
}

// RetryItem returns a blocked/failed item to the queue.
func (s *QueueService) RetryItem(id string) (MasteryQueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return MasteryQueueItem{}, err
	}
	item, _ := s.findLocked(data, id)
	if item == nil {
		return MasteryQueueItem{}, itemNotFound(id)
	}
	if executingPhases[item.Phase] {
		return MasteryQueueItem{}, apperrors.WithStatus(
			"AGENT_MASTERY_STATE_INVALID",
			"当前目标正在执行，不能重试",
			http.StatusConflict,
			true,
			map[string]any{"id": id, "phase": item.Phase},
		)
	}
	item.Phase = PhaseQueued
	item.Blocked = nil
	item.NextProbeAt = nil
	item.ConsecutiveFailures = 0
	item.LastErrorCode = nil
	item.UpdatedAt = s.nowISO()
	if data.Campaign.ActiveItemID == nil {
		data.Campaign.ActiveItemID = &item.ID
	}
	if err := s.saveLocked(data); err != nil {
		return MasteryQueueItem{}, err
	}
	return copyItem(*item), nil
}

// SetCampaignContext updates client metadata when a field is provided.
func (s *QueueService) SetCampaignContext(context CampaignContext) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return err
	}
	if context.ClientType != nil {
		value := *context.ClientType
		data.Campaign.ClientType = &value
	}
	if context.ClientProfileID != nil {
		value := *context.ClientProfileID
		data.Campaign.ClientProfileID = &value
	}
	return s.saveLocked(data)
}

// RecoverOnStartup converts active campaign/item state to interrupted.
func (s *QueueService) RecoverOnStartup() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return err
	}
	changed := false
	if data.Campaign.Status == CampaignRunning || data.Campaign.Status == CampaignStopping {
		data.Campaign.Status = CampaignInterrupted
		reason := "服务重启，专精执行状态需要复核"
		data.Campaign.PausedReason = &reason
		data.Campaign.ActiveStepRunID = nil
		changed = true
	}
	for index := range data.Items {
		item := &data.Items[index]
		if executingPhases[item.Phase] {
			now := s.nowISO()
			item.Recovery = &MasteryRecovery{
				PreviousPhase: item.Phase,
				PreviousRunID: item.ActiveRunID,
				DetectedAt:    now,
			}
			item.Phase = PhaseInterrupted
			item.ActiveRunID = nil
			item.UpdatedAt = now
			changed = true
		}
	}
	if changed {
		return s.saveLocked(data)
	}
	return nil
}

// GetItem returns one queue item without exposing the internal slice.
func (s *QueueService) GetItem(id string) (*MasteryQueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	item, _ := s.findLocked(data, id)
	if item == nil {
		return nil, nil
	}
	copy := copyItem(*item)
	return &copy, nil
}

// Settings returns the current campaign settings.
func (s *QueueService) Settings() (QueueSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return QueueSettings{}, err
	}
	return data.Campaign.Settings, nil
}

func copyItem(item MasteryQueueItem) MasteryQueueItem {
	result := item
	if item.LastOutcome != nil {
		outcome := *item.LastOutcome
		outcome.SkillMastery = append([]*float64(nil), item.LastOutcome.SkillMastery...)
		result.LastOutcome = &outcome
	}
	if item.Blocked != nil {
		blocked := *item.Blocked
		result.Blocked = &blocked
	}
	if item.Recovery != nil {
		recovery := *item.Recovery
		result.Recovery = &recovery
	}
	return result
}

func itemNotFound(id string) error {
	return apperrors.WithStatus(
		"AGENT_MASTERY_ITEM_NOT_FOUND",
		"未找到专精目标："+id,
		http.StatusNotFound,
		false,
		map[string]any{"id": id},
	)
}

func queueEmpty() error {
	return apperrors.WithStatus("AGENT_MASTERY_QUEUE_EMPTY", "没有可执行的专精目标", http.StatusConflict, false, nil)
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
