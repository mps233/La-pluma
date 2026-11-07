package recognition

import (
	"errors"
	"net/http"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

// provisionalOperatorPattern matches the placeholder operators (char_5xx /
// char_6xx) that are not part of the real roster.
var provisionalOperatorPattern = regexp.MustCompile(`^char_[56]\d{2}_`)

type itemInfo struct {
	name         string
	icon         any
	iconID       any
	classifyType string
	sortID       float64
}

type itemDatabase struct {
	items map[string]any
	table map[string]any
}

func (s *Service) itemIndexPath() string {
	return filepath.Join(s.paths.MaaDataDir, "resource", "item_index.json")
}

func (s *Service) itemTablePath() string {
	return filepath.Join(s.paths.MaaDataDir, "resource", "gamedata", "excel", "item_table.json")
}

func (s *Service) battleDataPath() string {
	return filepath.Join(s.paths.MaaDataDir, "resource", "battle_data.json")
}

// loadItemDatabase reads the two MaaResource files that feed item names and
// icons. Missing files behave like empty objects; other failures are returned
// to the caller, which mirrors getMaaItemInfo rejecting and falling back to
// placeholder entries for every item.
func (s *Service) loadItemDatabase() (*itemDatabase, error) {
	indexValue, err := jsonstore.Read(s.itemIndexPath(), map[string]any{})
	if err != nil {
		return nil, err
	}
	tableValue, err := jsonstore.Read(s.itemTablePath(), map[string]any{})
	if err != nil {
		return nil, err
	}

	items, _ := asRecord(indexValue)
	table, _ := asRecord(tableValue)
	tableItems, _ := asRecord(table["items"])
	return &itemDatabase{items: items, table: tableItems}, nil
}

// info resolves one item. A nil database or an unknown id produces the same
// placeholder used by dataParserService.getItemInfo.
func (database *itemDatabase) info(itemID string) itemInfo {
	fallback := itemInfo{
		name:         "未知物品 (" + itemID + ")",
		icon:         nil,
		iconID:       itemID,
		classifyType: "UNKNOWN",
		sortID:       999999,
	}
	if database == nil {
		return fallback
	}
	rawItem, found := database.items[itemID]
	if !found {
		return fallback
	}

	item, _ := asRecord(rawItem)
	tableItem, _ := asRecord(database.table[itemID])

	name, ok := nonEmptyString(item["name"])
	if !ok {
		if name, ok = nonEmptyString(tableItem["name"]); !ok {
			name = "物品_" + itemID
		}
	}

	iconID := itemID
	if value, ok := nonEmptyString(tableItem["iconId"]); ok {
		iconID = value
	}

	classifyType, ok := nonEmptyString(item["classifyType"])
	if !ok {
		if classifyType, ok = nonEmptyString(tableItem["classifyType"]); !ok {
			classifyType = "UNKNOWN"
		}
	}

	sortID, ok := jsonNumberValue(item["sortId"])
	if !ok {
		if sortID, ok = jsonNumberValue(tableItem["sortId"]); !ok {
			sortID = 999999
		}
	}

	var icon any
	if value, ok := item["icon"].(string); ok {
		icon = value
	}

	return itemInfo{
		name:         name,
		icon:         icon,
		iconID:       iconID,
		classifyType: classifyType,
		sortID:       sortID,
	}
}

func nonEmptyString(value any) (string, bool) {
	text, ok := value.(string)
	return text, ok && text != ""
}

// GetAllOperators reads battle_data.json and returns the filtered operator
// catalog sorted by rarity then Chinese display name, matching
// dataParserService.getAllOperators.
func (s *Service) GetAllOperators() ([]OperatorSummary, error) {
	path := s.battleDataPath()
	value, err := jsonstore.Read(path, nil)
	if err != nil {
		return nil, operatorCatalogError(path, err)
	}
	record, ok := asRecord(value)
	if !ok {
		return nil, operatorCatalogError(path, errors.New("无法读取干员数据"))
	}
	chars, ok := asRecord(record["chars"])
	if !ok {
		return nil, operatorCatalogError(path, errors.New("无法读取干员数据"))
	}

	operators := make([]OperatorSummary, 0, len(chars))
	for id, rawChar := range chars {
		if !strings.HasPrefix(id, "char_") || provisionalOperatorPattern.MatchString(id) {
			continue
		}
		char, _ := asRecord(rawChar)
		name, ok := nonEmptyString(char["name"])
		if !ok {
			name = id
		}
		operators = append(operators, OperatorSummary{
			ID:         id,
			Name:       name,
			Rarity:     finiteNumberOrZero(char["rarity"]),
			Profession: char["profession"],
			Position:   char["position"],
		})
	}

	collator := collate.New(language.Chinese)
	sort.SliceStable(operators, func(left, right int) bool {
		if operators[left].Rarity != operators[right].Rarity {
			return operators[left].Rarity > operators[right].Rarity
		}
		if compared := collator.CompareString(operators[left].Name, operators[right].Name); compared != 0 {
			return compared < 0
		}
		// Go maps have no object-key insertion order; keep output deterministic
		// when two operators share a name and rarity.
		return operators[left].ID < operators[right].ID
	})

	s.logger.Info("加载所有干员成功", "count", len(operators))
	return operators, nil
}

func operatorCatalogError(path string, err error) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_OPERATOR_CATALOG_UNAVAILABLE",
		"加载所有干员失败: "+err.Error(),
		http.StatusInternalServerError,
		false,
		map[string]any{"path": path},
	)
}
