package training

import (
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

// battleDataCharPattern excludes reserve operators (char_5xx / char_6xx) from
// the training catalog, exactly like dataParserService.getAllOperators.
var battleDataCharPattern = regexp.MustCompile(`^char_[56]\d{2}_`)

var stageActivityTimePattern = regexp.MustCompile(`^(\d{4})/(\d{2})/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$`)

type operatorMaterialData struct {
	ID         string
	Name       string
	Rarity     float64
	Profession *string
	Elite1     *EliteMaterials
	Elite2     *EliteMaterials
}

type operatorMaterialsFile struct {
	Operators map[string]*operatorMaterialData
}

type baseOperator struct {
	ID         string
	Name       string
	Rarity     float64
	Profession string
	Position   *string
}

type operBoxOperator struct {
	ID         string
	Name       string
	Rarity     *float64
	Profession *string
	Elite      *float64
	Level      *float64
	Potential  *float64
	Own        bool
}

type operBoxCatalogOperator struct {
	ID     string
	Name   string
	Rarity *float64
	Own    bool
}

type operBoxData struct {
	Data         []operBoxOperator
	HasData      bool
	Operators    []operBoxOperator
	HasOperators bool
	AllOpers     []operBoxCatalogOperator
}

func (self operBoxData) ownedOperators() []operBoxOperator {
	if self.HasData {
		return self.Data
	}
	if self.HasOperators {
		return self.Operators
	}
	return nil
}

type depotData struct {
	Items     map[string]float64
	Timestamp *string
}

type materialStageCandidate struct {
	Stage *string
}

type materialInfo struct {
	ID         string
	Name       string
	IconID     string
	BestStage  *string
	BestStages []materialStageCandidate
}

type materialRecipe struct {
	Materials map[string]float64
	Order     []string
}

type materialDatabase struct {
	Materials map[string]*materialInfo
	Recipes   map[string]*materialRecipe
}

func emptyMaterialsFile() operatorMaterialsFile {
	return operatorMaterialsFile{Operators: map[string]*operatorMaterialData{}}
}

func emptyMaterialDatabase() *materialDatabase {
	return &materialDatabase{Materials: map[string]*materialInfo{}, Recipes: map[string]*materialRecipe{}}
}

// loadOperatorMaterials mirrors the Node loader: malformed or unreadable data
// is logged and replaced with an empty catalog instead of failing the request.
func (s *Service) loadOperatorMaterials() operatorMaterialsFile {
	value, err := jsonstore.Read(filepath.Join(s.paths.DataDir, "operator-materials.json"), map[string]any{})
	if err != nil {
		s.logger.Error("加载干员材料数据失败", "error", err)
		return emptyMaterialsFile()
	}
	record, ok := asRecord(value)
	if !ok {
		return emptyMaterialsFile()
	}
	operatorsValue, ok := asRecord(record["operators"])
	if !ok {
		return emptyMaterialsFile()
	}
	operators := make(map[string]*operatorMaterialData, len(operatorsValue))
	for id, raw := range operatorsValue {
		entry, ok := asRecord(raw)
		if !ok {
			continue
		}
		operators[id] = normalizeOperatorMaterialData(id, entry)
	}
	return operatorMaterialsFile{Operators: operators}
}

func normalizeOperatorMaterialData(id string, entry map[string]any) *operatorMaterialData {
	data := &operatorMaterialData{
		ID:     id,
		Name:   "",
		Rarity: 0,
	}
	if name, ok := entry["name"].(string); ok {
		data.Name = name
	}
	if rarity, ok := toFiniteNumber(entry["rarity"]); ok {
		data.Rarity = rarity
	}
	if profession, ok := entry["profession"].(string); ok {
		data.Profession = &profession
	}
	data.Elite1 = normalizeEliteMaterials(entry["elite1"])
	data.Elite2 = normalizeEliteMaterials(entry["elite2"])
	return data
}

func normalizeEliteMaterials(value any) *EliteMaterials {
	record, ok := asRecord(value)
	if !ok {
		return nil
	}
	result := &EliteMaterials{}
	if lmd, ok := toFiniteNumber(record["lmd"]); ok {
		result.LMD = &lmd
	}
	result.Materials = normalizeMaterialRequirements(record["materials"])
	result.Chips = normalizeMaterialRequirements(record["chips"])
	return result
}

func normalizeMaterialRequirements(value any) *[]MaterialRequirement {
	array, ok := asArray(value)
	if !ok {
		return nil
	}
	normalized := make([]MaterialRequirement, 0, len(array))
	for _, raw := range array {
		record, ok := asRecord(raw)
		if !ok {
			continue
		}
		id := normalizeID(record["id"])
		if id == "" {
			continue
		}
		name := ""
		if typed, ok := record["name"].(string); ok {
			name = typed
		}
		count, _ := toFiniteNumber(record["count"])
		normalized = append(normalized, MaterialRequirement{ID: id, Name: name, Count: count})
	}
	return &normalized
}

func normalizeID(value any) string {
	if typed, ok := value.(string); ok {
		return typed
	}
	if value == nil {
		return ""
	}
	return jsStringApprox(value)
}

func (s *Service) loadOperBox() operBoxData {
	value, err := jsonstore.Read(filepath.Join(s.paths.DataDir, "operbox.json"), map[string]any{"operators": []any{}})
	if err != nil {
		s.logger.Error("加载 OperBox 数据失败", "error", err)
		return operBoxData{Operators: []operBoxOperator{}, AllOpers: []operBoxCatalogOperator{}}
	}
	record, ok := asRecord(value)
	if !ok {
		return operBoxData{Operators: []operBoxOperator{}, AllOpers: []operBoxCatalogOperator{}}
	}

	result := operBoxData{AllOpers: []operBoxCatalogOperator{}}
	if array, ok := asArray(record["data"]); ok {
		result.HasData = true
		result.Data = normalizeOperBoxOperators(array)
	}
	if array, ok := asArray(record["operators"]); ok {
		result.HasOperators = true
		result.Operators = normalizeOperBoxOperators(array)
	}
	if array, ok := asArray(record["allOpers"]); ok {
		for _, raw := range array {
			entry, ok := asRecord(raw)
			if !ok {
				continue
			}
			id := normalizeID(entry["id"])
			if id == "" {
				continue
			}
			catalog := operBoxCatalogOperator{ID: id}
			if name, ok := entry["name"].(string); ok {
				catalog.Name = name
			}
			if rarity, ok := toFiniteNumber(entry["rarity"]); ok {
				catalog.Rarity = &rarity
			}
			catalog.Own = entry["own"] == true
			result.AllOpers = append(result.AllOpers, catalog)
		}
	}
	return result
}

func normalizeOperBoxOperators(array []any) []operBoxOperator {
	operators := make([]operBoxOperator, 0, len(array))
	for _, raw := range array {
		entry, ok := asRecord(raw)
		if !ok {
			continue
		}
		id := normalizeID(entry["id"])
		if id == "" {
			continue
		}
		operator := operBoxOperator{ID: id}
		if name, ok := entry["name"].(string); ok {
			operator.Name = name
		}
		if rarity, ok := toFiniteNumber(entry["rarity"]); ok {
			operator.Rarity = &rarity
		}
		if profession, ok := entry["profession"].(string); ok {
			operator.Profession = &profession
		}
		if elite, ok := toFiniteNumber(entry["elite"]); ok {
			operator.Elite = &elite
		}
		if level, ok := toFiniteNumber(entry["level"]); ok {
			operator.Level = &level
		}
		if potential, ok := toFiniteNumber(entry["potential"]); ok {
			operator.Potential = &potential
		}
		operator.Own = entry["own"] == true
		operators = append(operators, operator)
	}
	return operators
}

func (s *Service) loadDepot() depotData {
	result := depotData{Items: map[string]float64{}, Timestamp: nil}
	value, err := jsonstore.Read(filepath.Join(s.paths.DataDir, "depot.json"), map[string]any{"items": []any{}, "timestamp": nil})
	if err != nil {
		s.logger.Error("加载仓库数据失败", "error", err)
		return result
	}
	record, ok := asRecord(value)
	if !ok {
		return result
	}
	if array, ok := asArray(record["items"]); ok {
		for _, raw := range array {
			entry, ok := asRecord(raw)
			if !ok {
				continue
			}
			id := normalizeID(entry["id"])
			if id == "" {
				continue
			}
			count, _ := toFiniteNumber(entry["count"])
			result.Items[id] = count
		}
	}
	if timestamp, ok := record["timestamp"].(string); ok {
		result.Timestamp = &timestamp
	}
	return result
}

// loadAllOperators reads MaaResource battle_data.json. The caller falls back
// to the OperBox catalog when this reports an error, matching dataParserService.
func (s *Service) loadAllOperators() ([]baseOperator, error) {
	resourceDir := filepath.Join(s.paths.MaaDataDir, "resource")
	value, err := jsonstore.Read(filepath.Join(resourceDir, "battle_data.json"), map[string]any{})
	if err != nil {
		return nil, err
	}
	record, ok := asRecord(value)
	if !ok {
		return nil, errBattleDataUnavailable
	}
	chars, ok := asRecord(record["chars"])
	if !ok {
		return nil, errBattleDataUnavailable
	}

	operators := make([]baseOperator, 0, len(chars))
	for id, raw := range chars {
		if !strings.HasPrefix(id, "char_") || battleDataCharPattern.MatchString(id) {
			continue
		}
		entry, _ := asRecord(raw)
		operator := baseOperator{ID: id, Name: id, Rarity: 0, Profession: "未知"}
		if entry != nil {
			if name, ok := entry["name"].(string); ok && name != "" {
				operator.Name = name
			}
			operator.Rarity = numberOr(entry["rarity"], 0)
			if profession, ok := entry["profession"].(string); ok {
				operator.Profession = profession
			}
			if position, ok := entry["position"].(string); ok {
				operator.Position = &position
			}
		}
		operators = append(operators, operator)
	}

	collator := collate.New(language.Chinese)
	sort.SliceStable(operators, func(i, j int) bool {
		if operators[i].Rarity != operators[j].Rarity {
			return operators[i].Rarity > operators[j].Rarity
		}
		return collator.CompareString(operators[i].Name, operators[j].Name) < 0
	})
	return operators, nil
}

func (s *Service) loadMaterialsDatabase() *materialDatabase {
	resourceDir := filepath.Join(s.paths.MaaDataDir, "resource")
	itemIndexValue, indexErr := jsonstore.Read(filepath.Join(resourceDir, "item_index.json"), map[string]any{})
	itemTableValue, tableErr := jsonstore.Read(filepath.Join(resourceDir, "gamedata", "excel", "item_table.json"), map[string]any{})
	if indexErr != nil {
		s.logger.Error("加载 MaaResource 材料数据库失败", "error", indexErr)
		return emptyMaterialDatabase()
	}
	if tableErr != nil {
		// A missing item table is fine; a malformed one makes the whole
		// MaaResource load fail in the Node service.
		s.logger.Error("加载 MaaResource 材料数据库失败", "error", tableErr)
		return emptyMaterialDatabase()
	}
	itemIndex, _ := asRecord(itemIndexValue)
	itemTable, _ := asRecord(itemTableValue)

	tableItems := map[string]any{}
	if itemTable != nil {
		tableItems, _ = asRecord(itemTable["items"])
	}

	database := emptyMaterialDatabase()
	names := make(map[string]string, len(itemIndex))
	for id, raw := range itemIndex {
		item, _ := asRecord(raw)
		tableItem, _ := asRecord(tableItems[id])

		info := &materialInfo{ID: id, Name: "物品_" + id, IconID: id}
		if item != nil {
			if name, ok := item["name"].(string); ok && name != "" {
				info.Name = name
			}
			if icon, ok := item["icon"].(string); ok {
				_ = icon
			}
			if bestStage, ok := item["bestStage"].(string); ok {
				info.BestStage = &bestStage
			}
			if array, ok := asArray(item["bestStages"]); ok {
				stages := make([]materialStageCandidate, 0, len(array))
				for _, candidateRaw := range array {
					candidate, ok := asRecord(candidateRaw)
					if !ok {
						continue
					}
					normalized := materialStageCandidate{}
					if stage, ok := candidate["stage"].(string); ok {
						normalized.Stage = &stage
					}
					stages = append(stages, normalized)
				}
				info.BestStages = stages
			}
		}
		if info.Name == "物品_"+id && tableItem != nil {
			if name, ok := tableItem["name"].(string); ok && name != "" {
				info.Name = name
			}
		}
		if tableItem != nil {
			if iconID, ok := tableItem["iconId"].(string); ok && iconID != "" {
				info.IconID = iconID
			}
		}
		database.Materials[id] = info
		names[id] = info.Name

		if item != nil {
			if formula, ok := asRecord(item["formula"]); ok && len(formula) > 0 {
				recipe := &materialRecipe{Materials: make(map[string]float64, len(formula))}
				for subID, rawCount := range formula {
					count, _ := toFiniteNumber(rawCount)
					recipe.Materials[subID] = count
					recipe.Order = append(recipe.Order, subID)
				}
				// JSON object order is not preserved by encoding/json; sort the
				// children so plan output stays deterministic.
				sort.Strings(recipe.Order)
				database.Recipes[id] = recipe
			}
		}
	}

	s.nameMu.Lock()
	s.materialNames = names
	s.nameMu.Unlock()
	return database
}

func (s *Service) materialName(id string) (string, bool) {
	s.nameMu.RLock()
	defer s.nameMu.RUnlock()
	name, ok := s.materialNames[id]
	return name, ok
}

// isResourceCollectionOpen mirrors activityDataService.isResourceCollectionOpenNow
// against Paths.MaaCacheDir/StageActivityV2.json. Read failures mean "closed".
func (s *Service) isResourceCollectionOpen(clientType string, now time.Time) bool {
	path := filepath.Join(s.paths.MaaCacheDir, "StageActivityV2.json")
	value, err := jsonstore.Read(path, map[string]any{})
	if err != nil {
		return false
	}
	root, ok := asRecord(value)
	if !ok {
		return false
	}
	clientKey := normalizeActivityClientType(clientType)
	clientValue := root[clientKey]
	if !isTruthy(clientValue) {
		clientValue = root["Official"]
	}
	clientData, ok := asRecord(clientValue)
	if !ok {
		return false
	}
	resource, ok := asRecord(clientData["resourceCollection"])
	if !ok || resource["IsResourceCollection"] != true {
		return false
	}
	startTime, startOK := parseStageActivityTime(resource["UtcStartTime"], resource["TimeZone"])
	if !startOK {
		return false
	}
	nowMs := now.UnixMilli()
	if startTime > nowMs {
		return false
	}
	if endTime, endOK := parseStageActivityTime(resource["UtcExpireTime"], resource["TimeZone"]); endOK {
		if endTime <= nowMs {
			return false
		}
	}
	return true
}

func normalizeActivityClientType(clientType string) string {
	switch strings.ToLower(strings.TrimSpace(clientType)) {
	case "bilibili":
		return "Official"
	case "txwy":
		return "txwy"
	case "yostaren":
		return "YostarEN"
	case "yostarjp":
		return "YostarJP"
	case "yostarkr":
		return "YostarKR"
	default:
		return "Official"
	}
}

func parseStageActivityTime(value any, timeZone any) (int64, bool) {
	text, ok := value.(string)
	if !ok {
		return 0, false
	}
	match := stageActivityTimePattern.FindStringSubmatch(text)
	if match == nil {
		return 0, false
	}
	offsetHours := 8.0
	if parsed, ok := toFiniteNumber(timeZone); ok {
		offsetHours = parsed
	}
	year := mustInt(match[1])
	month := mustInt(match[2])
	day := mustInt(match[3])
	hour := mustInt(match[4])
	minute := mustInt(match[5])
	second := mustInt(match[6])
	utc := time.Date(year, time.Month(month), day, hour, minute, second, 0, time.UTC)
	return utc.UnixMilli() - int64(offsetHours*float64(time.Hour/time.Millisecond)), true
}

func mustInt(value string) int {
	number := 0
	for _, char := range value {
		number = number*10 + int(char-'0')
	}
	return number
}

// gameDay mirrors gameCalendar.getGameDay: a fixed UTC offset shifted by the
// 04:00 game-day boundary.
func gameDay(now time.Time, clientType string) (string, int) {
	offset := 8
	switch strings.ToLower(strings.TrimSpace(clientType)) {
	case "yostaren":
		offset = -7
	case "yostarjp":
		offset = 9
	case "yostarkr":
		offset = 9
	}
	shifted := now.UTC().Add(time.Duration(offset-4) * time.Hour)
	return shifted.Format("2006-01-02"), int(shifted.Weekday())
}

var errBattleDataUnavailable = &battleDataError{}

type battleDataError struct{}

func (e *battleDataError) Error() string { return "无法读取干员数据" }
