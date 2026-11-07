package mastery

import (
	"log/slog"
	"math"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

// DataOptions configures the mastery data service.
type DataOptions struct {
	Paths    config.Paths
	Logger   *slog.Logger
	Now      func() time.Time
	Material *MaterialDatabase
}

// DataService reads generated mastery data and joins it with OperBox, depot
// and battle-data fixtures. It performs no MAA or device side effects.
type DataService struct {
	paths            config.Paths
	logger           *slog.Logger
	now              func() time.Time
	materialOverride *MaterialDatabase
}

type operBoxOperator struct {
	ID          string
	Name        string
	Rarity      *float64
	Elite       *float64
	Level       *float64
	OwnTrue     bool
	OwnNotFalse bool
}

type operBoxFile struct {
	Data      []operBoxOperator
	AllOpers  []operBoxOperator
	Timestamp *string
}

type depotItem struct {
	ID    string
	Count float64
}

type depotFile struct {
	Items     map[string]float64
	Timestamp *string
}

// BattleRecord is one battle_data.json character entry.
type BattleRecord struct {
	Name   *string
	NameEN *string
	NameJP *string
	NameKR *string
	NameTW *string
}

type battleDataFile struct {
	Chars map[string]*BattleRecord
}

// MaterialItem is the subset of MaaResource item data used by mastery views.
type MaterialItem struct {
	Name   string
	IconID string
}

// MaterialDatabase is the MaaResource item index used for icon/name fallbacks.
type MaterialDatabase struct {
	Items map[string]MaterialItem
}

// NewDataService returns a data service using config.Paths.
func NewDataService(options DataOptions) *DataService {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	now := options.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &DataService{
		paths:            options.Paths,
		logger:           logger,
		now:              now,
		materialOverride: options.Material,
	}
}

// MasteryDataPath is the generated mastery data file.
func (s *DataService) MasteryDataPath() string {
	return filepath.Join(s.paths.DataDir, "operator-mastery.json")
}

// OperatorMaterialsPath matches the Node export even though mastery views do
// not read it.
func (s *DataService) OperatorMaterialsPath() string {
	return filepath.Join(s.paths.DataDir, "operator-materials.json")
}

// OperBoxPath is the OperBox snapshot file.
func (s *DataService) OperBoxPath() string {
	return filepath.Join(s.paths.DataDir, "operbox.json")
}

// DepotPath is the depot snapshot file.
func (s *DataService) DepotPath() string {
	return filepath.Join(s.paths.DataDir, "depot.json")
}

func (s *DataService) battleDataPath() string {
	return filepath.Join(s.paths.MaaDataDir, "resource", "battle_data.json")
}

func (s *DataService) itemIndexPath() string {
	return filepath.Join(s.paths.MaaDataDir, "resource", "item_index.json")
}

func (s *DataService) itemTablePath() string {
	return filepath.Join(s.paths.MaaDataDir, "resource", "gamedata", "excel", "item_table.json")
}

// NormalizeMasteryData mirrors normalizeMasteryData. It returns nil when the
// root or operators table is not an object, or when no valid skills remain.
func NormalizeMasteryData(raw any) *MasteryDataFile {
	record, ok := asRecord(raw)
	if !ok {
		return nil
	}
	operators, ok := asRecord(record["operators"])
	if !ok {
		return nil
	}

	normalized := make(map[string]OperatorMastery, len(operators))
	for id, rawOperator := range operators {
		operator, ok := asRecord(rawOperator)
		if !ok {
			continue
		}
		if _, ok := operator["id"].(string); !ok {
			continue
		}
		skills := make([]OperatorSkill, 0)
		for _, rawSkill := range arrayItems(operator["skills"]) {
			skill, ok := asRecord(rawSkill)
			if !ok {
				continue
			}
			skillID, ok := skill["skillId"].(string)
			if !ok {
				continue
			}
			index, ok := numberValue(skill["index"])
			if !ok || index < 1 {
				continue
			}
			mastery := make([]MasteryLevel, 0)
			for _, rawLevel := range arrayItems(skill["mastery"]) {
				level, ok := asRecord(rawLevel)
				if !ok {
					continue
				}
				levelNumber, ok := numberValue(level["level"])
				if !ok || levelNumber < 1 {
					continue
				}
				materials := make([]MasteryMaterial, 0)
				for _, rawMaterial := range arrayItems(level["materials"]) {
					material, ok := asRecord(rawMaterial)
					if !ok || material["id"] == nil {
						continue
					}
					count, ok := numberValue(material["count"])
					if !ok || count <= 0 {
						continue
					}
					name, ok := material["name"].(string)
					if !ok || name == "" {
						name = stringify(material["id"])
					}
					materials = append(materials, MasteryMaterial{
						ID:    stringify(material["id"]),
						Name:  name,
						Count: count,
					})
				}
				entry := MasteryLevel{Level: levelNumber, Materials: materials}
				if unlock, ok := asRecord(level["unlock"]); ok {
					normalizedUnlock := &MasteryUnlock{}
					if phase, ok := unlock["phase"].(string); ok {
						normalizedUnlock.Phase = &phase
					}
					if rawLevel, ok := numberValue(unlock["level"]); ok {
						if _, present := unlock["level"]; present {
							normalizedUnlock.Level = &rawLevel
						}
					}
					entry.Unlock = normalizedUnlock
				}
				mastery = append(mastery, entry)
			}
			if len(mastery) == 0 {
				continue
			}
			name, ok := skill["name"].(string)
			if !ok || name == "" {
				name = skillID
			}
			iconID, ok := skill["iconId"].(string)
			skills = append(skills, OperatorSkill{
				Index:   index,
				SkillID: skillID,
				Name:    name,
				IconID:  optionalString(iconID, ok),
				Mastery: mastery,
			})
		}
		if len(skills) == 0 {
			continue
		}
		name, ok := operator["name"].(string)
		if !ok || name == "" {
			name = id
		}
		profession, ok := operator["profession"].(string)
		if !ok {
			profession = "未知"
		}
		professionID, ok := operator["professionId"].(string)
		if !ok {
			professionID = "UNKNOWN"
		}
		normalized[id] = OperatorMastery{
			ID:           id,
			Name:         name,
			Rarity:       finiteNumber(operator["rarity"]),
			Profession:   profession,
			ProfessionID: professionID,
			Skills:       skills,
		}
	}

	metadata, ok := asRecord(record["metadata"])
	if !ok {
		metadata = map[string]any{}
	}
	return &MasteryDataFile{Operators: normalized, Metadata: metadata}
}

func optionalString(value string, ok bool) *string {
	if !ok {
		return nil
	}
	return &value
}

func finiteNumber(value any) float64 {
	parsed, ok := numberValue(value)
	if !ok {
		return 0
	}
	return parsed
}

func arrayItems(value any) []any {
	array, ok := asArray(value)
	if !ok {
		return nil
	}
	return array
}

// LoadMasteryData reads and normalizes operator-mastery.json. A missing or
// empty file is AGENT_MASTERY_DATA_MISSING; unreadable or malformed data is
// AGENT_MASTERY_DATA_UNAVAILABLE. Both are retryable 503 errors.
func (s *DataService) LoadMasteryData() (*MasteryDataFile, error) {
	path := s.MasteryDataPath()
	raw, err := jsonstore.Read(path, nil)
	if err != nil {
		return nil, apperrors.WithStatus(
			"AGENT_MASTERY_DATA_UNAVAILABLE",
			"专精数据读取失败："+err.Error(),
			http.StatusServiceUnavailable,
			true,
			map[string]any{"path": path},
		)
	}
	normalized := NormalizeMasteryData(raw)
	if normalized == nil {
		return nil, apperrors.WithStatus(
			"AGENT_MASTERY_DATA_MISSING",
			"专精数据尚未生成，请先运行 npm run fetch-mastery --prefix server",
			http.StatusServiceUnavailable,
			true,
			map[string]any{"path": path},
		)
	}
	return normalized, nil
}

func (s *DataService) loadOperBox() (*operBoxFile, error) {
	path := s.OperBoxPath()
	value, err := jsonstore.Read(path, map[string]any{})
	if err != nil {
		return nil, apperrors.WithStatus(
			"AGENT_MASTERY_DATA_UNAVAILABLE",
			"专精数据读取失败："+err.Error(),
			http.StatusServiceUnavailable,
			true,
			map[string]any{"path": path},
		)
	}
	record, _ := asRecord(value)
	result := &operBoxFile{}
	if record == nil {
		return result, nil
	}
	for _, raw := range arrayItems(record["data"]) {
		if operator, ok := normalizeOperBoxOperator(raw, true); ok {
			result.Data = append(result.Data, operator)
		}
	}
	for _, raw := range arrayItems(record["allOpers"]) {
		if operator, ok := normalizeOperBoxOperator(raw, false); ok {
			result.AllOpers = append(result.AllOpers, operator)
		}
	}
	if timestamp, ok := record["timestamp"].(string); ok && timestamp != "" {
		result.Timestamp = &timestamp
	}
	return result, nil
}

func normalizeOperBoxOperator(value any, allFields bool) (operBoxOperator, bool) {
	record, ok := asRecord(value)
	if !ok {
		return operBoxOperator{}, false
	}
	id, ok := record["id"].(string)
	if !ok {
		return operBoxOperator{}, false
	}
	operator := operBoxOperator{ID: id}
	if name, ok := record["name"].(string); ok {
		operator.Name = name
	}
	if rarity, ok := numberValue(record["rarity"]); ok {
		if _, present := record["rarity"]; present {
			operator.Rarity = &rarity
		}
	}
	ownRaw, hasOwn := record["own"]
	ownFalse := hasOwn && ownRaw == false
	operator.OwnTrue = hasOwn && ownRaw == true
	operator.OwnNotFalse = !ownFalse
	if !allFields {
		return operator, true
	}
	if elite, ok := numberValue(record["elite"]); ok {
		if _, present := record["elite"]; present {
			operator.Elite = &elite
		}
	}
	if level, ok := numberValue(record["level"]); ok {
		if _, present := record["level"]; present {
			operator.Level = &level
		}
	}
	return operator, true
}

func (s *DataService) loadDepot() (*depotFile, error) {
	path := s.DepotPath()
	value, err := jsonstore.Read(path, map[string]any{})
	if err != nil {
		return nil, apperrors.WithStatus(
			"AGENT_MASTERY_DATA_UNAVAILABLE",
			"专精数据读取失败："+err.Error(),
			http.StatusServiceUnavailable,
			true,
			map[string]any{"path": path},
		)
	}
	record, _ := asRecord(value)
	result := &depotFile{Items: map[string]float64{}}
	if record == nil {
		return result, nil
	}
	for _, raw := range arrayItems(record["items"]) {
		item, ok := asRecord(raw)
		if !ok || item["id"] == nil {
			continue
		}
		result.Items[stringify(item["id"])] = numberOr(item["count"], 0)
	}
	if timestamp, ok := record["timestamp"].(string); ok && timestamp != "" {
		result.Timestamp = &timestamp
	}
	return result, nil
}

func (s *DataService) loadBattleData() *battleDataFile {
	value, err := jsonstore.Read(s.battleDataPath(), map[string]any{})
	if err != nil {
		return &battleDataFile{Chars: map[string]*BattleRecord{}}
	}
	record, ok := asRecord(value)
	if !ok {
		return &battleDataFile{Chars: map[string]*BattleRecord{}}
	}
	chars, ok := asRecord(record["chars"])
	if !ok {
		return &battleDataFile{Chars: map[string]*BattleRecord{}}
	}
	result := &battleDataFile{Chars: make(map[string]*BattleRecord, len(chars))}
	for id, raw := range chars {
		entry, ok := asRecord(raw)
		if !ok {
			result.Chars[id] = &BattleRecord{}
			continue
		}
		battle := &BattleRecord{}
		battle.Name = recordString(entry, "name")
		battle.NameEN = recordString(entry, "name_en")
		battle.NameJP = recordString(entry, "name_jp")
		battle.NameKR = recordString(entry, "name_kr")
		battle.NameTW = recordString(entry, "name_tw")
		result.Chars[id] = battle
	}
	return result
}

func recordString(record map[string]any, key string) *string {
	value, ok := record[key].(string)
	if !ok {
		return nil
	}
	return &value
}

// loadMaterialDatabase mirrors buildMaaMaterialDatabase for names and icons.
func (s *DataService) loadMaterialDatabase() *MaterialDatabase {
	if s.materialOverride != nil {
		return s.materialOverride
	}
	indexValue, indexErr := jsonstore.Read(s.itemIndexPath(), map[string]any{})
	tableValue, tableErr := jsonstore.Read(s.itemTablePath(), map[string]any{})
	database := &MaterialDatabase{Items: map[string]MaterialItem{}}
	if indexErr != nil {
		return database
	}
	index, ok := asRecord(indexValue)
	if !ok {
		return database
	}
	tableItems := map[string]any{}
	if tableErr == nil {
		if table, ok := asRecord(tableValue); ok {
			if items, ok := asRecord(table["items"]); ok {
				tableItems = items
			}
		}
	}
	for id, raw := range index {
		item, _ := asRecord(raw)
		tableItem, _ := asRecord(tableItems[id])
		name := ""
		if item != nil {
			if value, ok := item["name"].(string); ok && value != "" {
				name = value
			}
		}
		if name == "" && tableItem != nil {
			if value, ok := tableItem["name"].(string); ok && value != "" {
				name = value
			}
		}
		if name == "" {
			name = "物品_" + id
		}
		iconID := id
		if tableItem != nil {
			if value, ok := tableItem["iconId"].(string); ok && value != "" {
				iconID = value
			}
		}
		database.Items[id] = MaterialItem{Name: name, IconID: iconID}
	}
	return database
}

type ownedMaps struct {
	details  map[string]operBoxOperator
	ownedIDs map[string]bool
}

func buildOwnedMaps(operBox *operBoxFile) ownedMaps {
	result := ownedMaps{
		details:  make(map[string]operBoxOperator, len(operBox.Data)),
		ownedIDs: map[string]bool{},
	}
	for _, operator := range operBox.Data {
		result.details[operator.ID] = operator
	}
	for _, operator := range operBox.AllOpers {
		if operator.OwnTrue {
			result.ownedIDs[operator.ID] = true
		}
	}
	for id, operator := range result.details {
		if operator.OwnNotFalse {
			result.ownedIDs[id] = true
		}
	}
	return result
}

func candidateFromRecord(
	operator OperatorMastery,
	owned ownedMaps,
	battleChars map[string]*BattleRecord,
	clientType string,
) MasteryCandidate {
	detail, hasDetail := owned.details[operator.ID]
	ownedFlag := owned.ownedIDs[operator.ID]
	ownedStateKnown := hasDetail || !ownedFlag
	currentElite := 0.0
	currentLevel := 0.0
	if hasDetail {
		if detail.Elite != nil {
			currentElite = finiteNumber(*detail.Elite)
		}
		if detail.Level != nil {
			currentLevel = finiteNumber(*detail.Level)
		}
	}
	nameForMaa, _ := BattleName(battleChars[operator.ID], clientType)
	name := operator.Name
	if nameForMaa != nil && *nameForMaa != "" {
		name = *nameForMaa
	} else if hasDetail && detail.Name != "" {
		name = detail.Name
	}

	var disabledReason *string
	switch {
	case !ownedFlag:
		reason := "unowned"
		disabledReason = &reason
	case !ownedStateKnown:
		reason := "state_unknown"
		disabledReason = &reason
	case currentElite < 2:
		reason := "not_elite2"
		disabledReason = &reason
	case len(operator.Skills) == 0:
		reason := "no_skills"
		disabledReason = &reason
	}

	rarity := operator.Rarity
	if hasDetail && detail.Rarity != nil && *detail.Rarity != 0 {
		rarity = finiteNumber(*detail.Rarity)
	}

	return MasteryCandidate{
		ID:              operator.ID,
		Name:            name,
		Rarity:          rarity,
		Profession:      operator.Profession,
		ProfessionID:    operator.ProfessionID,
		CurrentElite:    currentElite,
		CurrentLevel:    currentLevel,
		Owned:           ownedFlag,
		OwnedStateKnown: ownedStateKnown,
		SkillCount:      len(operator.Skills),
		Eligible:        disabledReason == nil,
		DisabledReason:  disabledReason,
	}
}

// BattleName selects the localized name for the active client.
func BattleName(record *BattleRecord, clientType string) (*string, error) {
	if record == nil {
		return nil, nil
	}
	client, err := normalizeClientType(clientType)
	if err != nil {
		return nil, err
	}
	var value *string
	switch client {
	case "Official", "Bilibili":
		value = record.Name
	case "txwy":
		value = firstString(record.NameTW, record.Name)
	case "YostarEN":
		value = firstString(record.NameEN, record.Name)
	case "YostarJP":
		value = firstString(record.NameJP, record.Name)
	case "YostarKR":
		value = firstString(record.NameKR, record.Name)
	default:
		value = record.Name
	}
	if value == nil || *value == "" {
		return nil, nil
	}
	return value, nil
}

// RoleFromProfession maps a profession id to the MaaCore role name.
func RoleFromProfession(professionID string) *string {
	return roleFromProfession(professionID)
}

// CatalogOptions is the query for GetCandidates.
type CatalogOptions struct {
	ClientType string
	Search     string
	Rarity     *int
	Status     MasteryCandidateStatus
	Limit      int
}

// GetCandidates lists operators that carry mastery data, filtered and sorted
// like the Node catalog endpoint.
func (s *DataService) GetCandidates(options CatalogOptions) (MasteryCandidateList, error) {
	masteryData, err := s.LoadMasteryData()
	if err != nil {
		return MasteryCandidateList{}, err
	}
	operBox, err := s.loadOperBox()
	if err != nil {
		return MasteryCandidateList{}, err
	}
	battleData := s.loadBattleData()
	clientType, err := normalizeClientType(options.ClientType)
	if err != nil {
		return MasteryCandidateList{}, err
	}
	owned := buildOwnedMaps(operBox)
	search := strings.ToLower(strings.TrimSpace(options.Search))
	status := options.Status
	if status == "" {
		status = CandidateStatusAll
	}
	limit := 500
	if options.Limit != 0 {
		limit = clamp(options.Limit, 1, 1000)
	}

	candidates := make([]MasteryCandidate, 0, len(masteryData.Operators))
	for _, operator := range masteryData.Operators {
		candidate := candidateFromRecord(operator, owned, battleData.Chars, clientType)
		if search != "" &&
			!strings.Contains(strings.ToLower(candidate.Name), search) &&
			!strings.Contains(strings.ToLower(candidate.ID), search) {
			continue
		}
		if options.Rarity != nil && *options.Rarity != 0 && candidate.Rarity != float64(*options.Rarity) {
			continue
		}
		switch status {
		case CandidateStatusEligible:
			if !candidate.Eligible {
				continue
			}
		case CandidateStatusOwned:
			if !candidate.Owned {
				continue
			}
		}
		candidates = append(candidates, candidate)
	}

	sortCandidates(candidates)
	total := len(candidates)
	if limit < total {
		candidates = candidates[:limit]
	}

	metadataLastUpdated := metadataString(masteryData.Metadata, "lastUpdated")
	return MasteryCandidateList{
		Operators: candidates,
		Total:     total,
		DataFreshness: CandidateFreshness{
			Operbox: FreshnessEntry{Timestamp: operBox.Timestamp, AgeDays: ageDays(operBox.Timestamp, s.now())},
			Mastery: MasteryFreshness{LastUpdated: metadataLastUpdated},
		},
	}, nil
}

func sortCandidates(candidates []MasteryCandidate) {
	collator := collate.New(language.Chinese)
	sort.SliceStable(candidates, func(i, j int) bool {
		left, right := candidates[i], candidates[j]
		if left.Eligible != right.Eligible {
			return left.Eligible
		}
		if left.Rarity != right.Rarity {
			return left.Rarity > right.Rarity
		}
		if compared := collator.CompareString(left.Name, right.Name); compared != 0 {
			return compared < 0
		}
		return left.ID < right.ID
	})
}

func metadataString(metadata map[string]any, key string) *string {
	value, ok := metadata[key].(string)
	if !ok || value == "" {
		return nil
	}
	return &value
}

// OperatorDetailOptions is the query for GetOperatorDetail.
type OperatorDetailOptions struct {
	ClientType    string
	DeclaredLevel int
}

// MaterialNodesForLevel joins one mastery level with depot counts.
func MaterialNodesForLevel(level MasteryLevel, depotItems map[string]float64, database *MaterialDatabase) []MasteryMaterialNode {
	nodes := make([]MasteryMaterialNode, 0, len(level.Materials))
	for _, material := range level.Materials {
		item := MaterialItem{}
		if database != nil {
			item = database.Items[material.ID]
		}
		name := item.Name
		if name == "" {
			name = material.Name
		}
		iconID := item.IconID
		if iconID == "" {
			iconID = material.ID
		}
		have := depotItems[material.ID]
		nodes = append(nodes, MasteryMaterialNode{
			ID:          material.ID,
			Name:        name,
			IconID:      iconID,
			Count:       material.Count,
			Have:        have,
			Needed:      material.Count,
			StillNeeded: math.Max(0, material.Count-have),
		})
	}
	return nodes
}

// GetOperatorDetail returns one operator with every mastery level and the
// advisory material gap for the declared current level.
func (s *DataService) GetOperatorDetail(operatorID string, options OperatorDetailOptions) (MasteryOperatorDetail, error) {
	masteryData, err := s.LoadMasteryData()
	if err != nil {
		return MasteryOperatorDetail{}, err
	}
	operBox, err := s.loadOperBox()
	if err != nil {
		return MasteryOperatorDetail{}, err
	}
	depot, err := s.loadDepot()
	if err != nil {
		return MasteryOperatorDetail{}, err
	}
	battleData := s.loadBattleData()
	materialDatabase := s.loadMaterialDatabase()

	operator, ok := masteryData.Operators[operatorID]
	if !ok {
		return MasteryOperatorDetail{}, apperrors.WithStatus(
			"AGENT_MASTERY_OPERATOR_NOT_FOUND",
			"未找到干员："+operatorID,
			http.StatusNotFound,
			false,
			map[string]any{"operatorId": operatorID},
		)
	}

	owned := buildOwnedMaps(operBox)
	detail, hasDetail := owned.details[operatorID]
	ownedFlag := owned.ownedIDs[operatorID]
	ownedStateKnown := hasDetail || !ownedFlag
	currentElite := 0.0
	currentLevel := 0.0
	if hasDetail {
		if detail.Elite != nil {
			currentElite = finiteNumber(*detail.Elite)
		}
		if detail.Level != nil {
			currentLevel = finiteNumber(*detail.Level)
		}
	}
	declaredLevel := clamp(options.DeclaredLevel, 0, 3)
	clientType, err := normalizeClientType(options.ClientType)
	if err != nil {
		return MasteryOperatorDetail{}, err
	}
	nameForMaa, err := BattleName(battleData.Chars[operatorID], clientType)
	if err != nil {
		return MasteryOperatorDetail{}, err
	}
	name := operator.Name
	if nameForMaa != nil && *nameForMaa != "" {
		name = *nameForMaa
	} else if hasDetail && detail.Name != "" {
		name = detail.Name
	}
	rarity := operator.Rarity
	if hasDetail && detail.Rarity != nil && *detail.Rarity != 0 {
		rarity = finiteNumber(*detail.Rarity)
	}

	skills := make([]MasterySkillDetail, 0, len(operator.Skills))
	for _, skill := range operator.Skills {
		levels := make([]MasteryLevelDetail, 0, len(skill.Mastery))
		for _, level := range skill.Mastery {
			levels = append(levels, MasteryLevelDetail{
				Level:         level.Level,
				Materials:     level.Materials,
				Unlock:        level.Unlock,
				MaterialNodes: MaterialNodesForLevel(level, depot.Items, materialDatabase),
			})
		}
		var nextLevel *MasteryLevelDetail
		for index := range levels {
			if levels[index].Level == float64(declaredLevel+1) {
				nextLevel = &levels[index]
				break
			}
		}
		nextNodes := []MasteryMaterialNode{}
		if nextLevel != nil {
			nextNodes = nextLevel.MaterialNodes
		}
		skills = append(skills, MasterySkillDetail{
			Index:             skill.Index,
			SkillID:           skill.SkillID,
			Name:              skill.Name,
			IconID:            skill.IconID,
			Mastery:           skill.Mastery,
			Levels:            levels,
			NextLevel:         nextLevel,
			NextMaterialNodes: nextNodes,
		})
	}

	return MasteryOperatorDetail{
		ID:              operator.ID,
		Name:            name,
		NameForMaa:      name,
		Role:            roleFromProfession(operator.ProfessionID),
		Rarity:          rarity,
		Profession:      operator.Profession,
		ProfessionID:    operator.ProfessionID,
		CurrentElite:    currentElite,
		CurrentLevel:    currentLevel,
		Owned:           ownedFlag,
		OwnedStateKnown: ownedStateKnown,
		Skills:          skills,
		ClientType:      clientType,
		DataFreshness: DetailFreshness{
			Operbox: FreshnessEntry{Timestamp: operBox.Timestamp, AgeDays: ageDays(operBox.Timestamp, s.now())},
			Depot:   FreshnessEntry{Timestamp: depot.Timestamp, AgeDays: ageDays(depot.Timestamp, s.now())},
			Mastery: MasteryFreshness{LastUpdated: metadataString(masteryData.Metadata, "lastUpdated")},
		},
	}, nil
}

// Preflight checks generated data and client normalization without touching a
// device.
func (s *DataService) Preflight(clientType string) (MasteryDataPreflight, error) {
	normalizedClient, err := normalizeClientType(clientType)
	if err != nil {
		return MasteryDataPreflight{}, err
	}
	var masteryError *string
	operatorCount := 0
	if data, loadErr := s.LoadMasteryData(); loadErr != nil {
		message := loadErr.Error()
		if appErr, ok := apperrors.As(loadErr); ok {
			message = appErr.Message
		}
		masteryError = &message
	} else {
		operatorCount = len(data.Operators)
	}
	return MasteryDataPreflight{
		Supported: masteryError == nil,
		MasteryData: MasteryDataPreflightDetails{
			Available:     masteryError == nil,
			OperatorCount: operatorCount,
			Error:         masteryError,
		},
		ClientType:            normalizedClient,
		MinimumMaaCliVersion:  minimumCLIVersion,
		MinimumMaaCoreVersion: minimumCoreVersion,
	}, nil
}
