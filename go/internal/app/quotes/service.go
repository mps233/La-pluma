// Package quotes ports the operator quote service and its HTTP routes.
//
// Quotes are stored as a single JSON array in Paths.DataDir/operatorQuotes.json.
// An absent or damaged file falls back to the built-in quotes, matching the
// Node service.
package quotes

import (
	"encoding/json"
	"log/slog"
	"math"
	"math/rand/v2"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const dataFileName = "operatorQuotes.json"

// OperatorQuote is the public JSON shape used by the client.
type OperatorQuote struct {
	OperatorID string `json:"operatorId"`
	Operator   string `json:"operator"`
	Quote      string `json:"quote"`
}

// OperatorIDs maps a display name to the character avatar id. Entries added by
// a user without an id keep an empty operatorId, exactly like the Node route.
var OperatorIDs = map[string]string{
	"阿米娅":  "char_002_amiya",
	"凯尔希":  "char_003_kalts",
	"陈":    "char_010_chen",
	"煌":    "char_017_huang",
	"德克萨斯": "char_102_texas",
	"能天使":  "char_103_angel",
	"推进之王": "char_112_siege",
	"W":    "char_113_cqbw",
	"星熊":   "char_136_hsguma",
	"拉普兰德": "char_140_whitew",
	"银灰":   "char_172_svrash",
	"艾雅法拉": "char_180_amgoat",
	"塞雷娅":  "char_202_demkni",
	"令":    "char_2023_ling",
	"棘刺":   "char_293_thorns",
	"史尔特尔": "char_350_surtr",
	"澄闪":   "char_377_gdglow",
}

// DefaultQuotes mirrors the built-in fallback list in operatorQuotesService.ts.
var DefaultQuotes = []OperatorQuote{
	{OperatorID: OperatorIDs["阿米娅"], Operator: "阿米娅", Quote: "今天也请多指教"},
	{OperatorID: OperatorIDs["凯尔希"], Operator: "凯尔希", Quote: "作战记录已归档"},
	{OperatorID: OperatorIDs["陈"], Operator: "陈", Quote: "任务简报已经确认"},
	{OperatorID: OperatorIDs["煌"], Operator: "煌", Quote: "队伍状态不错"},
	{OperatorID: OperatorIDs["能天使"], Operator: "能天使", Quote: "补给检查完成"},
	{OperatorID: OperatorIDs["银灰"], Operator: "银灰", Quote: "战术安排已就绪"},
	{OperatorID: OperatorIDs["艾雅法拉"], Operator: "艾雅法拉", Quote: "数据采集稳定"},
	{OperatorID: OperatorIDs["塞雷娅"], Operator: "塞雷娅", Quote: "防护流程正常"},
	{OperatorID: OperatorIDs["星熊"], Operator: "星熊", Quote: "防线已经架好"},
	{OperatorID: OperatorIDs["推进之王"], Operator: "推进之王", Quote: "行动前先确认队形"},
	{OperatorID: OperatorIDs["德克萨斯"], Operator: "德克萨斯", Quote: "通讯频道保持畅通"},
	{OperatorID: OperatorIDs["拉普兰德"], Operator: "拉普兰德", Quote: "这次行动会很有趣"},
	{OperatorID: OperatorIDs["令"], Operator: "令", Quote: "今日也宜从容落子"},
	{OperatorID: OperatorIDs["棘刺"], Operator: "棘刺", Quote: "药剂和装备都已备齐"},
	{OperatorID: OperatorIDs["史尔特尔"], Operator: "史尔特尔", Quote: "别让目标等太久"},
	{OperatorID: OperatorIDs["W"], Operator: "W", Quote: "装置都在正确位置"},
	{OperatorID: OperatorIDs["澄闪"], Operator: "澄闪", Quote: "信号稳定，可以开始"},
}

// Options configures a Service. Zero values fall back to slog.Default,
// time.Now and math/rand/v2.
type Options struct {
	Paths  config.Paths
	Logger *slog.Logger
	Now    func() time.Time
	// Random must return an int in [0, n). It is injectable for tests.
	Random func(n int) int
}

// Service owns the quotes file. Mutations are serialized so concurrent
// read-modify-write requests cannot lose entries.
type Service struct {
	path   string
	logger *slog.Logger
	now    func() time.Time
	random func(n int) int

	mutateMu sync.Mutex
}

// New returns a Service using the default clock and random source.
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
		now = time.Now
	}
	random := options.Random
	if random == nil {
		random = rand.IntN
	}
	return &Service{
		path:   filepath.Join(options.Paths.DataDir, dataFileName),
		logger: logger,
		now:    now,
		random: random,
	}
}

// DataPath is the absolute quotes JSON path.
func (s *Service) DataPath() string { return s.path }

// Load reads and normalizes the quotes file. A missing, empty, corrupt or
// fully invalid file yields a copy of DefaultQuotes.
func (s *Service) Load() []OperatorQuote {
	value, err := jsonstore.Read(s.path, nil)
	if err != nil {
		s.logger.Error("读取干员台词数据失败", "error", err)
		return cloneQuotes(DefaultQuotes)
	}
	quotes := NormalizeQuotes(value)
	if len(quotes) > 0 {
		return quotes
	}
	return cloneQuotes(DefaultQuotes)
}

// SaveQuotes atomically writes the quotes array.
func (s *Service) SaveQuotes(quotes []OperatorQuote) error {
	if err := jsonstore.Write(s.path, quotes, true); err != nil {
		return apperrors.WithStatus(
			"OPERATOR_QUOTES_SAVE_FAILED",
			"保存干员台词数据失败",
			http.StatusInternalServerError,
			false,
			map[string]any{"path": s.path, "error": err.Error()},
		)
	}
	return nil
}

// GetAllQuotes returns the current list.
func (s *Service) GetAllQuotes() []OperatorQuote {
	return s.Load()
}

// GetDailyQuote picks the quote for the local day-of-year, like the Node
// implementation. The fallback list is never empty, so division is safe.
func (s *Service) GetDailyQuote() OperatorQuote {
	quotes := s.Load()
	now := s.now()
	start := time.Date(now.Year(), time.January, 0, 0, 0, 0, 0, now.Location())
	dayOfYear := int(math.Floor(now.Sub(start).Hours() / 24))
	if dayOfYear < 0 {
		dayOfYear = 0
	}
	return quotes[dayOfYear%len(quotes)]
}

// GetRandomQuote returns a random quote.
func (s *Service) GetRandomQuote() OperatorQuote {
	quotes := s.Load()
	index := s.random(len(quotes))
	if index < 0 || index >= len(quotes) {
		index = 0
	}
	return quotes[index]
}

// GetQuoteByOperator finds the first quote for an exact operator name.
func (s *Service) GetQuoteByOperator(operator string) (OperatorQuote, bool) {
	for _, quote := range s.Load() {
		if quote.Operator == operator {
			return quote, true
		}
	}
	return OperatorQuote{}, false
}

// AddQuote appends a quote. The route always passes an empty operatorId, but
// callers may supply one.
func (s *Service) AddQuote(quote OperatorQuote) ([]OperatorQuote, error) {
	s.mutateMu.Lock()
	defer s.mutateMu.Unlock()

	quotes := append(s.Load(), quote)
	if err := s.SaveQuotes(quotes); err != nil {
		return nil, err
	}
	return quotes, nil
}

// UpdateQuote replaces the quote text of the first matching operator.
func (s *Service) UpdateQuote(operator, newQuote string) (OperatorQuote, bool, error) {
	s.mutateMu.Lock()
	defer s.mutateMu.Unlock()

	quotes := s.Load()
	for index := range quotes {
		if quotes[index].Operator == operator {
			quotes[index].Quote = newQuote
			if err := s.SaveQuotes(quotes); err != nil {
				return OperatorQuote{}, false, err
			}
			return quotes[index], true, nil
		}
	}
	return OperatorQuote{}, false, nil
}

// DeleteQuote removes every quote of the given operator.
func (s *Service) DeleteQuote(operator string) ([]OperatorQuote, error) {
	s.mutateMu.Lock()
	defer s.mutateMu.Unlock()

	quotes := s.Load()
	filtered := make([]OperatorQuote, 0, len(quotes))
	for _, quote := range quotes {
		if quote.Operator != operator {
			filtered = append(filtered, quote)
		}
	}
	if err := s.SaveQuotes(filtered); err != nil {
		return nil, err
	}
	return filtered, nil
}

// NormalizeQuotes mirrors normalizeQuotes in the Node service: non-object
// entries are dropped, fields are coerced to trimmed strings, known operator
// names gain their avatar id, and entries without an operator or quote are
// dropped.
func NormalizeQuotes(value any) []OperatorQuote {
	items, ok := value.([]any)
	if !ok {
		return []OperatorQuote{}
	}
	quotes := make([]OperatorQuote, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		operator := strings.TrimSpace(jsString(orDefault(record["operator"], "")))
		operatorID := strings.TrimSpace(jsString(orDefault(record["operatorId"], OperatorIDs[operator])))
		quote := strings.TrimSpace(jsString(orDefault(record["quote"], "")))
		if operator == "" || quote == "" {
			continue
		}
		quotes = append(quotes, OperatorQuote{
			OperatorID: operatorID,
			Operator:   operator,
			Quote:      quote,
		})
	}
	return quotes
}

func cloneQuotes(quotes []OperatorQuote) []OperatorQuote {
	return append([]OperatorQuote(nil), quotes...)
}

// orDefault applies JavaScript `value || fallback` truthiness.
func orDefault(value, fallback any) any {
	if truthy(value) {
		return value
	}
	return fallback
}

func truthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case json.Number:
		parsed, err := typed.Float64()
		return err == nil && parsed != 0 && !math.IsNaN(parsed)
	case float64:
		return typed != 0 && !math.IsNaN(typed)
	case float32:
		return typed != 0 && !math.IsNaN(float64(typed))
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case uint64:
		return typed != 0
	default:
		// Objects and arrays are truthy in JavaScript, even when empty.
		return true
	}
}

// jsString approximates JavaScript String(value) for the JSON value types
// produced by encoding/json.
func jsString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case json.Number:
		if parsed, err := typed.Float64(); err == nil {
			return strconv.FormatFloat(parsed, 'g', -1, 64)
		}
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'g', -1, 64)
	case map[string]any:
		return "[object Object]"
	case []any:
		parts := make([]string, len(typed))
		for index, item := range typed {
			parts[index] = jsString(item)
		}
		return strings.Join(parts, ",")
	default:
		return ""
	}
}
