package drops

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

func TestGetLocalDateStringUsesConfiguredTimeZone(t *testing.T) {
	cases := []struct {
		instant time.Time
		want    string
	}{
		{time.Date(2026, 7, 10, 16, 30, 0, 0, time.UTC), "2026-07-11"},
		{time.Date(2026, 7, 10, 15, 30, 0, 0, time.UTC), "2026-07-10"},
	}
	for _, testCase := range cases {
		got, err := GetLocalDateString(testCase.instant, "Asia/Shanghai")
		if err != nil {
			t.Fatalf("GetLocalDateString: %v", err)
		}
		if got != testCase.want {
			t.Fatalf("date = %q, want %q", got, testCase.want)
		}
	}

	if _, err := GetLocalDateString(time.Now(), "Not/AZone"); err == nil {
		t.Fatal("expected invalid time zone error")
	}
}

func TestNormalizeDropDays(t *testing.T) {
	cases := []struct {
		value    any
		fallback int
		want     int
	}{
		{nil, 7, 7},
		{"abc", 7, 7},
		{0, 7, 1},
		{-5, 7, 1},
		{"30", 7, 30},
		{100000, 7, 365},
		{5.9, 7, 5},
	}
	for _, testCase := range cases {
		if got := NormalizeDropDays(testCase.value, testCase.fallback); got != testCase.want {
			t.Fatalf("NormalizeDropDays(%v, %d) = %d, want %d", testCase.value, testCase.fallback, got, testCase.want)
		}
	}
}

func TestRecordDropsAndStatistics(t *testing.T) {
	dataDir := t.TempDir()
	current := time.Date(2026, 7, 10, 16, 30, 0, 0, time.UTC)
	materials := map[string]MaterialInfo{
		"固源岩": {Name: "固源岩", IconID: "30012", Rarity: 1},
	}
	service := NewWithOptions(config.Paths{DataDir: dataDir}, Options{
		Now:      func() time.Time { return current },
		TimeZone: "Asia/Shanghai",
		StatsTTL: 48 * time.Hour,
		Materials: func() (map[string]MaterialInfo, error) {
			return materials, nil
		},
	})

	record, err := service.RecordDrops(map[string]any{
		"stage":    "1-7",
		"times":    3,
		"sanity":   18,
		"medicine": 1,
		"stone":    0,
		"items": []any{
			map[string]any{"name": "固源岩", "count": 2, "extra": "keep"},
			map[string]any{"name": "龙门币", "count": 72},
			"not-an-object",
		},
	})
	if err != nil {
		t.Fatalf("RecordDrops: %v", err)
	}
	if record.Date != "2026-07-11" {
		t.Fatalf("date = %q", record.Date)
	}
	if record.Records[0].Timestamp != "2026-07-10T16:30:00.000Z" {
		t.Fatalf("timestamp = %q", record.Records[0].Timestamp)
	}
	if record.Records[0].Source != "fight" || record.Records[0].Mode != "normal" {
		t.Fatalf("entry defaults = %+v", record.Records[0])
	}
	if record.Summary.TotalSanity != 18 || record.Summary.TotalBattles != 3 || record.Summary.TotalMedicine != 1 {
		t.Fatalf("summary = %+v", record.Summary)
	}
	if record.Summary.ItemsSummary["固源岩"] != 2 || record.Summary.ItemsSummary["龙门币"] != 72 {
		t.Fatalf("itemsSummary = %+v", record.Summary.ItemsSummary)
	}
	if len(record.Records[0].Items) != 2 {
		t.Fatalf("items = %+v", record.Records[0].Items)
	}

	recordPath := filepath.Join(dataDir, "drop-records", "2026-07-11.json")
	raw, err := jsonstore.Read(recordPath, nil)
	if err != nil {
		t.Fatalf("read persisted record: %v", err)
	}
	persisted := asRecord(raw)
	if persisted == nil {
		t.Fatalf("persisted record = %#v", raw)
	}
	for _, key := range []string{"date", "records", "summary"} {
		if _, ok := persisted[key]; !ok {
			t.Fatalf("missing top-level key %q in %v", key, persisted)
		}
	}
	records, ok := persisted["records"].([]any)
	if !ok || len(records) != 1 {
		t.Fatalf("persisted records = %#v", persisted["records"])
	}
	first := asRecord(records[0])
	persistedItems, ok := first["items"].([]any)
	if !ok || len(persistedItems) != 2 {
		t.Fatalf("persisted items = %#v", first["items"])
	}
	firstItem := asRecord(persistedItems[0])
	if firstItem["extra"] != "keep" {
		t.Fatalf("extra field not preserved: %#v", firstItem)
	}

	// Second record on the next Shanghai business day.
	current = time.Date(2026, 7, 11, 16, 30, 0, 0, time.UTC)
	second, err := service.RecordDrops(map[string]any{
		"stage":  "CE-6",
		"times":  0,
		"sanity": "30",
		"items":  []any{map[string]any{"name": "固源岩", "count": 1}},
	})
	if err != nil {
		t.Fatalf("RecordDrops second: %v", err)
	}
	if second.Date != "2026-07-12" {
		t.Fatalf("second date = %q", second.Date)
	}
	if second.Records[0].Times != 1 {
		t.Fatalf("zero times should default to 1, got %v", second.Records[0].Times)
	}

	today, err := service.GetTodayDrops()
	if err != nil {
		t.Fatalf("GetTodayDrops: %v", err)
	}
	if today.Date != "2026-07-12" || len(today.Records) != 1 {
		t.Fatalf("today = %+v", today)
	}

	recent, err := service.GetRecentDrops(3)
	if err != nil {
		t.Fatalf("GetRecentDrops: %v", err)
	}
	if len(recent) != 2 || recent[0].Date != "2026-07-12" || recent[1].Date != "2026-07-11" {
		t.Fatalf("recent = %+v", recent)
	}

	statistics, err := service.GetDropStatistics(3)
	if err != nil {
		t.Fatalf("GetDropStatistics: %v", err)
	}
	if statistics.DateRange.Days != 2 {
		t.Fatalf("dateRange = %+v", statistics.DateRange)
	}
	if statistics.DateRange.Start == nil || *statistics.DateRange.Start != "2026-07-11" {
		t.Fatalf("start = %v", statistics.DateRange.Start)
	}
	if statistics.DateRange.End == nil || *statistics.DateRange.End != "2026-07-12" {
		t.Fatalf("end = %v", statistics.DateRange.End)
	}
	if statistics.Total.Sanity != 48 || statistics.Total.Battles != 4 {
		t.Fatalf("total = %+v", statistics.Total)
	}
	if len(statistics.DailyTrend) != 2 || statistics.DailyTrend[0].Date != "2026-07-11" {
		t.Fatalf("dailyTrend = %+v", statistics.DailyTrend)
	}
	if statistics.DailyTrend[1].Date != "2026-07-12" {
		t.Fatalf("dailyTrend order = %+v", statistics.DailyTrend)
	}
	item := statistics.Items["固源岩"]
	if item == nil || item.Count != 3 || item.Stages["1-7"] != 2 || item.Stages["CE-6"] != 1 {
		t.Fatalf("item statistics = %+v", item)
	}
	if item.IconID != "30012" || item.Rarity != 1 {
		t.Fatalf("item metadata = %+v", item)
	}
	unknown := statistics.Items["龙门币"]
	if unknown == nil || unknown.IconID != nil || unknown.Rarity != nil {
		t.Fatalf("unknown item metadata = %+v", unknown)
	}
	stage := statistics.Stages["1-7"]
	if stage == nil || stage.Battles != 3 || stage.Sanity != 18 || stage.Items["固源岩"] != 2 {
		t.Fatalf("stage statistics = %+v", stage)
	}

	// Recording a new drop invalidates the cached statistics.
	current = time.Date(2026, 7, 12, 4, 0, 0, 0, time.UTC)
	if _, err := service.RecordDrops(map[string]any{
		"stage": "1-7", "times": 1, "sanity": 6,
		"items": []any{map[string]any{"name": "固源岩", "count": 1}},
	}); err != nil {
		t.Fatalf("RecordDrops third: %v", err)
	}
	refreshed, err := service.GetDropStatistics(3)
	if err != nil {
		t.Fatalf("GetDropStatistics refreshed: %v", err)
	}
	if refreshed.Total.Sanity != 54 || refreshed.Total.Battles != 5 {
		t.Fatalf("refreshed total = %+v", refreshed.Total)
	}
}

func TestRecordDropsErrorsAndEmptyData(t *testing.T) {
	service := NewWithOptions(config.Paths{DataDir: t.TempDir()}, Options{
		TimeZone: "Not/AZone",
	})
	_, err := service.RecordDrops(map[string]any{"stage": "1-7"})
	if err == nil {
		t.Fatal("expected time zone error")
	}
	appError, ok := apperrors.As(err)
	if !ok || appError.Code != "DROP_RECORD_SAVE_FAILED" || appError.StatusCode != http.StatusInternalServerError {
		t.Fatalf("error = %#v", appError)
	}

	service = NewWithOptions(config.Paths{DataDir: t.TempDir()}, Options{
		Now: func() time.Time { return time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC) },
	})
	record, err := service.RecordDrops(nil)
	if err != nil {
		t.Fatalf("RecordDrops(nil): %v", err)
	}
	if record.Date != "2026-07-10" {
		t.Fatalf("date = %q", record.Date)
	}
	entry := record.Records[0]
	if entry.Stage != "" || entry.Times != 1 || len(entry.Items) != 0 {
		t.Fatalf("empty entry = %+v", entry)
	}
	if record.Summary.ItemsSummary == nil {
		t.Fatal("itemsSummary should be an empty object")
	}
}

func TestMaterialsFromDatabase(t *testing.T) {
	database := map[string]any{
		"materials": map[string]any{
			"one": map[string]any{"name": "固源岩", "iconId": "30012", "rarity": 1},
			"two": map[string]any{"name": ""},
			"bad": "not-an-object",
		},
	}
	materials := MaterialsFromDatabase(database)
	if len(materials) != 1 {
		t.Fatalf("materials = %+v", materials)
	}
	if materials["固源岩"].IconID != "30012" || materials["固源岩"].Rarity != 1 {
		t.Fatalf("material = %+v", materials["固源岩"])
	}
	if len(MaterialsFromDatabase(nil)) != 0 {
		t.Fatal("nil database should produce no materials")
	}
}

func TestDropStatisticsJSONShape(t *testing.T) {
	dataDir := t.TempDir()
	service := NewWithOptions(config.Paths{DataDir: dataDir}, Options{
		Now: func() time.Time { return time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC) },
	})
	statistics, err := service.GetDropStatistics(7)
	if err != nil {
		t.Fatalf("GetDropStatistics: %v", err)
	}
	encoded, err := json.Marshal(statistics)
	if err != nil {
		t.Fatalf("marshal statistics: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal statistics: %v", err)
	}
	if decoded["dailyTrend"] == nil {
		t.Fatalf("dailyTrend should be an array: %s", encoded)
	}
	if decoded["items"] == nil || decoded["stages"] == nil {
		t.Fatalf("items/stages should be objects: %s", encoded)
	}
	dateRange := asRecord(decoded["dateRange"])
	if dateRange["start"] != nil || dateRange["end"] != nil || dateRange["days"] != float64(0) {
		t.Fatalf("dateRange = %s", encoded)
	}
}
