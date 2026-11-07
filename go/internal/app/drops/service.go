// Package drops ports the daily drop-record service. Business dates follow the
// configured server time zone (Asia/Shanghai by default) so late-night runs do
// not land on the previous UTC date.
package drops

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const (
	// MaxDays bounds drop statistics ranges.
	MaxDays         = 365
	defaultStatsTTL = 30 * time.Second
	defaultTimeZone = "Asia/Shanghai"
)

// DropRecordItem keeps every field from MaaCore's drop item so unknown
// properties survive a read-modify-write cycle, like the Node spread.
type DropRecordItem map[string]any

func (item DropRecordItem) Name() string {
	if value, ok := item["name"].(string); ok {
		return value
	}
	return ""
}

func (item DropRecordItem) Count() float64 {
	return numberOrZero(item["count"])
}

type DropRecordEntry struct {
	Timestamp string           `json:"timestamp"`
	Stage     string           `json:"stage"`
	Times     float64          `json:"times"`
	Sanity    float64          `json:"sanity"`
	Medicine  float64          `json:"medicine"`
	Stone     float64          `json:"stone"`
	Items     []DropRecordItem `json:"items"`
	Source    string           `json:"source"`
	Mode      string           `json:"mode"`
}

type DropSummary struct {
	TotalSanity   float64            `json:"totalSanity"`
	TotalMedicine float64            `json:"totalMedicine"`
	TotalStone    float64            `json:"totalStone"`
	TotalBattles  float64            `json:"totalBattles"`
	ItemsSummary  map[string]float64 `json:"itemsSummary"`
}

type DropRecordFile struct {
	Date    string            `json:"date"`
	Records []DropRecordEntry `json:"records"`
	Summary DropSummary       `json:"summary"`
}

type DropStatisticItem struct {
	Count  float64            `json:"count"`
	Stages map[string]float64 `json:"stages"`
	IconID any                `json:"iconId"`
	Rarity any                `json:"rarity"`
}

type DropStatisticStage struct {
	Battles float64            `json:"battles"`
	Sanity  float64            `json:"sanity"`
	Items   map[string]float64 `json:"items"`
}

type DailyDropTrend struct {
	Date     string             `json:"date"`
	Sanity   float64            `json:"sanity"`
	Medicine float64            `json:"medicine"`
	Stone    float64            `json:"stone"`
	Battles  float64            `json:"battles"`
	Items    map[string]float64 `json:"items"`
}

type DropDateRange struct {
	Start *string `json:"start"`
	End   *string `json:"end"`
	Days  int     `json:"days"`
}

type DropTotals struct {
	Sanity   float64 `json:"sanity"`
	Medicine float64 `json:"medicine"`
	Stone    float64 `json:"stone"`
	Battles  float64 `json:"battles"`
}

type DropStatistics struct {
	DateRange  DropDateRange                  `json:"dateRange"`
	Total      DropTotals                     `json:"total"`
	Items      map[string]*DropStatisticItem  `json:"items"`
	Stages     map[string]*DropStatisticStage `json:"stages"`
	DailyTrend []DailyDropTrend               `json:"dailyTrend"`
}

// MaterialInfo is the small slice of the MAA material database used by drop
// statistics.
type MaterialInfo struct {
	Name   string
	IconID any
	Rarity any
}

type Options struct {
	// TimeZone defaults to TZ or Asia/Shanghai.
	TimeZone string
	// StatsTTL overrides the statistics cache TTL. Zero uses the environment
	// default (LA_PLUMA_DROP_STATS_TTL_MS or 30s); a negative value disables
	// caching.
	StatsTTL time.Duration
	Now      func() time.Time
	// Materials supplies the MAA material map. A nil provider yields empty
	// material metadata, matching the Node fallback when the resource database
	// is unavailable.
	Materials func() (map[string]MaterialInfo, error)
}

type statsCacheEntry struct {
	expiresAt time.Time
	value     DropStatistics
}

type Service struct {
	recordsDir string
	timeZone   string
	statsTTL   time.Duration
	now        func() time.Time
	materials  func() (map[string]MaterialInfo, error)

	mutateMu sync.Mutex

	statsMu    sync.Mutex
	statsCache map[int]statsCacheEntry
}

func New(paths config.Paths) *Service {
	return NewWithOptions(paths, Options{})
}

func NewWithOptions(paths config.Paths, options Options) *Service {
	service := &Service{
		recordsDir: filepath.Join(paths.DataDir, "drop-records"),
		timeZone:   options.TimeZone,
		statsTTL:   options.StatsTTL,
		now:        options.Now,
		materials:  options.Materials,
		statsCache: make(map[int]statsCacheEntry),
	}
	if service.now == nil {
		service.now = time.Now
	}
	if service.statsTTL == 0 {
		service.statsTTL = statsTTLFromEnv()
	}
	return service
}

// RecordsDir is the directory holding one JSON file per business date.
func (s *Service) RecordsDir() string { return s.recordsDir }

func statsTTLFromEnv() time.Duration {
	raw := strings.TrimSpace(os.Getenv("LA_PLUMA_DROP_STATS_TTL_MS"))
	if raw == "" {
		return defaultStatsTTL
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(value) || value < 0 {
		return defaultStatsTTL
	}
	return time.Duration(math.Trunc(value)) * time.Millisecond
}

// NormalizeDropDays clamps a requested range to 1..365. A nil value mirrors an
// omitted query parameter and returns the fallback.
func NormalizeDropDays(value any, fallback int) int {
	if value == nil {
		return fallback
	}
	parsed, ok := numberValue(value)
	if !ok {
		return fallback
	}
	days := int(math.Trunc(parsed))
	if days < 1 {
		return 1
	}
	if days > MaxDays {
		return MaxDays
	}
	return days
}

// GetLocalDateString formats the instant in the requested IANA time zone. An
// empty timeZone uses TZ from the environment, then Asia/Shanghai.
func GetLocalDateString(at time.Time, timeZone string) (string, error) {
	location, err := loadLocation(timeZone)
	if err != nil {
		return "", err
	}
	return at.In(location).Format("2006-01-02"), nil
}

func loadLocation(timeZone string) (*time.Location, error) {
	zone := strings.TrimSpace(timeZone)
	if zone == "" {
		zone = strings.TrimSpace(os.Getenv("TZ"))
	}
	if zone == "" {
		zone = defaultTimeZone
	}
	location, err := time.LoadLocation(zone)
	if err != nil {
		return nil, fmt.Errorf("invalid time zone %q: %w", zone, err)
	}
	return location, nil
}

func (s *Service) location() (*time.Location, error) {
	return loadLocation(s.timeZone)
}

func (s *Service) statsTTLValue() time.Duration {
	if s.statsTTL < 0 {
		return 0
	}
	return s.statsTTL
}

func createEmptyRecord(businessDate string) DropRecordFile {
	return DropRecordFile{
		Date:    businessDate,
		Records: []DropRecordEntry{},
		Summary: DropSummary{
			ItemsSummary: map[string]float64{},
		},
	}
}

func (s *Service) recordPath(businessDate string) string {
	return filepath.Join(s.recordsDir, businessDate+".json")
}

func (s *Service) todayPath() (string, string, error) {
	businessDate, err := GetLocalDateString(s.now(), s.timeZone)
	if err != nil {
		return "", "", err
	}
	return s.recordPath(businessDate), businessDate, nil
}

// RecordDrops appends one battle record to the current business date file and
// updates its running summary.
func (s *Service) RecordDrops(dropData any) (DropRecordFile, error) {
	recordPath, businessDate, err := s.todayPath()
	if err != nil {
		return DropRecordFile{}, dropError("DROP_RECORD_SAVE_FAILED", "记录掉落失败", err)
	}
	if err := jsonstore.EnsureDir(s.recordsDir); err != nil {
		return DropRecordFile{}, dropError("DROP_RECORD_SAVE_FAILED", "记录掉落失败", err)
	}

	s.mutateMu.Lock()
	defer s.mutateMu.Unlock()

	record, err := readRecordFile(recordPath)
	if err != nil {
		return DropRecordFile{}, dropError("DROP_RECORD_SAVE_FAILED", "记录掉落失败", err)
	}
	if record == nil {
		empty := createEmptyRecord(businessDate)
		record = &empty
	}
	normalizeRecord(record)

	input := asRecord(dropData)
	entry := DropRecordEntry{
		Timestamp: s.now().UTC().Format("2006-01-02T15:04:05.000Z"),
		Stage:     stringOrEmpty(coalesceValue(input, "stage")),
		Times:     numberOrZero(coalesceValue(input, "times")),
		Sanity:    numberOrZero(coalesceValue(input, "sanity")),
		Medicine:  numberOrZero(coalesceValue(input, "medicine")),
		Stone:     numberOrZero(coalesceValue(input, "stone")),
		Items:     normalizeDropItems(coalesceValue(input, "items")),
		Source:    "fight",
		Mode:      "normal",
	}
	if entry.Times == 0 {
		entry.Times = 1
	}
	if source, ok := input["source"].(string); ok && source != "" {
		entry.Source = source
	}
	if mode, ok := input["mode"].(string); ok && mode != "" {
		entry.Mode = mode
	}

	record.Records = append(record.Records, entry)
	record.Summary.TotalSanity += entry.Sanity
	record.Summary.TotalMedicine += entry.Medicine
	record.Summary.TotalStone += entry.Stone
	record.Summary.TotalBattles += entry.Times
	for _, item := range entry.Items {
		record.Summary.ItemsSummary[item.Name()] += item.Count()
	}

	if err := jsonstore.Write(recordPath, record, true); err != nil {
		return DropRecordFile{}, dropError("DROP_RECORD_SAVE_FAILED", "记录掉落失败", err)
	}

	s.statsMu.Lock()
	s.statsCache = make(map[int]statsCacheEntry)
	s.statsMu.Unlock()

	return *record, nil
}

// GetTodayDrops returns the current business-date file, or an empty record.
func (s *Service) GetTodayDrops() (DropRecordFile, error) {
	if err := jsonstore.EnsureDir(s.recordsDir); err != nil {
		return DropRecordFile{}, dropError("DROP_RECORD_TODAY_READ_FAILED", "获取今日记录失败", err)
	}
	recordPath, businessDate, err := s.todayPath()
	if err != nil {
		return DropRecordFile{}, dropError("DROP_RECORD_TODAY_READ_FAILED", "获取今日记录失败", err)
	}
	record, err := readRecordFile(recordPath)
	if err != nil {
		return DropRecordFile{}, dropError("DROP_RECORD_TODAY_READ_FAILED", "获取今日记录失败", err)
	}
	if record == nil {
		return createEmptyRecord(businessDate), nil
	}
	normalizeRecord(record)
	return *record, nil
}

// GetRecentDrops returns existing record files for the last days, newest
// first. Missing dates are skipped.
func (s *Service) GetRecentDrops(days int) ([]DropRecordFile, error) {
	if err := jsonstore.EnsureDir(s.recordsDir); err != nil {
		return nil, dropError("DROP_RECORD_RECENT_READ_FAILED", "获取历史记录失败", err)
	}

	normalizedDays := NormalizeDropDays(days, 7)
	location, err := s.location()
	if err != nil {
		return nil, dropError("DROP_RECORD_RECENT_READ_FAILED", "获取历史记录失败", err)
	}
	now := s.now().In(location)
	base := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, location)

	records := make([]DropRecordFile, 0, normalizedDays)
	for index := 0; index < normalizedDays; index++ {
		businessDate := base.AddDate(0, 0, -index).Format("2006-01-02")
		record, err := readRecordFile(s.recordPath(businessDate))
		if err != nil {
			return nil, dropError("DROP_RECORD_RECENT_READ_FAILED", "获取历史记录失败", err)
		}
		if record == nil {
			continue
		}
		normalizeRecord(record)
		records = append(records, *record)
	}
	return records, nil
}

// GetDropStatistics aggregates records over the requested day window. Results
// are cached for the configured TTL; recording a new drop invalidates it.
func (s *Service) GetDropStatistics(days int) (DropStatistics, error) {
	normalizedDays := NormalizeDropDays(days, 7)
	now := s.now()

	s.statsMu.Lock()
	if cached, ok := s.statsCache[normalizedDays]; ok && now.Before(cached.expiresAt) {
		s.statsMu.Unlock()
		return cached.value, nil
	}
	s.statsMu.Unlock()

	records, err := s.GetRecentDrops(normalizedDays)
	if err != nil {
		return DropStatistics{}, err
	}

	statistics := DropStatistics{
		DateRange:  DropDateRange{Days: len(records)},
		Items:      map[string]*DropStatisticItem{},
		Stages:     map[string]*DropStatisticStage{},
		DailyTrend: make([]DailyDropTrend, 0, len(records)),
	}
	if len(records) > 0 {
		start := records[len(records)-1].Date
		end := records[0].Date
		statistics.DateRange.Start = &start
		statistics.DateRange.End = &end
	}

	materialsMap := s.loadMaterialsMap()

	for _, dayRecord := range records {
		statistics.DailyTrend = append(statistics.DailyTrend, DailyDropTrend{
			Date:     dayRecord.Date,
			Sanity:   dayRecord.Summary.TotalSanity,
			Medicine: dayRecord.Summary.TotalMedicine,
			Stone:    dayRecord.Summary.TotalStone,
			Battles:  dayRecord.Summary.TotalBattles,
			Items:    dayRecord.Summary.ItemsSummary,
		})

		statistics.Total.Sanity += dayRecord.Summary.TotalSanity
		statistics.Total.Medicine += dayRecord.Summary.TotalMedicine
		statistics.Total.Stone += dayRecord.Summary.TotalStone
		statistics.Total.Battles += dayRecord.Summary.TotalBattles

		for _, record := range dayRecord.Records {
			processRecordForStatistics(record, &statistics, materialsMap)
		}
	}

	// dailyTrend is collected newest-first; expose it chronologically.
	for left, right := 0, len(statistics.DailyTrend)-1; left < right; left, right = left+1, right-1 {
		statistics.DailyTrend[left], statistics.DailyTrend[right] =
			statistics.DailyTrend[right], statistics.DailyTrend[left]
	}

	ttl := s.statsTTLValue()
	if ttl > 0 {
		s.statsMu.Lock()
		s.statsCache[normalizedDays] = statsCacheEntry{
			expiresAt: s.now().Add(ttl),
			value:     statistics,
		}
		s.statsMu.Unlock()
	}
	return statistics, nil
}

func (s *Service) loadMaterialsMap() map[string]MaterialInfo {
	if s.materials == nil {
		return map[string]MaterialInfo{}
	}
	materials, err := s.materials()
	if err != nil {
		return map[string]MaterialInfo{}
	}
	if materials == nil {
		return map[string]MaterialInfo{}
	}
	return materials
}

// MaterialsFromDatabase adapts a decoded MAA material database (the shape
// returned by maaResourceDataService) into the map keyed by material name.
func MaterialsFromDatabase(database any) map[string]MaterialInfo {
	result := map[string]MaterialInfo{}
	databaseRecord := asRecord(database)
	if databaseRecord == nil {
		return result
	}
	materials, ok := databaseRecord["materials"].(map[string]any)
	if !ok {
		return result
	}
	for _, rawItem := range materials {
		item := asRecord(rawItem)
		if item == nil {
			continue
		}
		name, ok := item["name"].(string)
		if !ok || name == "" {
			continue
		}
		result[name] = MaterialInfo{
			Name:   name,
			IconID: item["iconId"],
			Rarity: item["rarity"],
		}
	}
	return result
}

func processRecordForStatistics(record DropRecordEntry, statistics *DropStatistics, materialsMap map[string]MaterialInfo) {
	stageName := record.Stage

	stageStatistic, ok := statistics.Stages[stageName]
	if !ok {
		stageStatistic = &DropStatisticStage{Items: map[string]float64{}}
		statistics.Stages[stageName] = stageStatistic
	}
	stageStatistic.Battles += record.Times
	stageStatistic.Sanity += record.Sanity

	for _, item := range record.Items {
		itemName := item.Name()
		itemStatistic, ok := statistics.Items[itemName]
		if !ok {
			itemStatistic = &DropStatisticItem{
				Stages: map[string]float64{},
			}
			if material, found := materialsMap[itemName]; found {
				if truthy(material.IconID) {
					itemStatistic.IconID = material.IconID
				}
				if truthy(material.Rarity) {
					itemStatistic.Rarity = material.Rarity
				}
			}
			statistics.Items[itemName] = itemStatistic
		}
		itemStatistic.Count += item.Count()
		itemStatistic.Stages[stageName] += item.Count()
		stageStatistic.Items[itemName] += item.Count()
	}
}

func readRecordFile(recordPath string) (*DropRecordFile, error) {
	raw, err := jsonstore.Read(recordPath, nil)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var record DropRecordFile
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, err
	}
	return &record, nil
}

func normalizeRecord(record *DropRecordFile) {
	if record.Records == nil {
		record.Records = []DropRecordEntry{}
	}
	if record.Summary.ItemsSummary == nil {
		record.Summary.ItemsSummary = map[string]float64{}
	}
	for index := range record.Records {
		if record.Records[index].Items == nil {
			record.Records[index].Items = []DropRecordItem{}
		}
	}
}

func normalizeDropItems(value any) []DropRecordItem {
	values, ok := asAnySlice(value)
	if !ok {
		return []DropRecordItem{}
	}
	items := make([]DropRecordItem, 0, len(values))
	for _, rawItem := range values {
		item := asRecord(rawItem)
		if item == nil {
			continue
		}
		normalized := make(DropRecordItem, len(item)+2)
		for key, value := range item {
			normalized[key] = value
		}
		if name, ok := item["name"].(string); ok {
			normalized["name"] = name
		} else {
			normalized["name"] = stringOrEmpty(coalesceValue(item, "name"))
		}
		normalized["count"] = numberOrZero(coalesceValue(item, "count"))
		items = append(items, normalized)
	}
	return items
}

func dropError(code, message string, cause error) error {
	details := map[string]any{}
	if cause != nil {
		details["error"] = cause.Error()
	}
	return apperrors.WithStatus(code, message, http.StatusInternalServerError, true, details)
}
