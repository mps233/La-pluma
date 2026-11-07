package quotes

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
)

func TestDefaultQuotesHaveAvatarIDs(t *testing.T) {
	if len(DefaultQuotes) == 0 {
		t.Fatal("expected built-in quotes")
	}
	for _, quote := range DefaultQuotes {
		if !strings.HasPrefix(quote.OperatorID, "char_") {
			t.Fatalf("operator %q has no character id: %#v", quote.Operator, quote)
		}
		if quote.Operator == "" || quote.Quote == "" {
			t.Fatalf("incomplete default quote: %#v", quote)
		}
	}
	if DefaultQuotes[0].Operator == "博士" {
		t.Fatal("the built-in list must not impersonate the doctor fallback")
	}
}

func TestNormalizeQuotes(t *testing.T) {
	got := NormalizeQuotes([]any{
		map[string]any{"operator": "银灰", "quote": "战术安排已就绪"},
		map[string]any{"operator": "自定义干员", "quote": "自定义台词"},
		map[string]any{"operator": "  ", "quote": "空操作员"},
		map[string]any{"operator": "缺台词", "quote": "   "},
		"not an object",
	})
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2: %#v", len(got), got)
	}
	if got[0].OperatorID != "char_172_svrash" || got[0].Operator != "银灰" || got[0].Quote != "战术安排已就绪" {
		t.Fatalf("known operator = %#v", got[0])
	}
	if got[1].OperatorID != "" || got[1].Operator != "自定义干员" || got[1].Quote != "自定义台词" {
		t.Fatalf("custom operator = %#v", got[1])
	}
	if got := NormalizeQuotes("bad"); len(got) != 0 {
		t.Fatalf("non-array should normalize to empty, got %#v", got)
	}
}

func TestLoadFallsBackToDefaults(t *testing.T) {
	dataDir := t.TempDir()
	service := New(config.Paths{DataDir: dataDir}, nil)

	if got := service.Load(); len(got) != len(DefaultQuotes) {
		t.Fatalf("missing file len = %d, want %d", len(got), len(DefaultQuotes))
	}

	// Returned slices must not mutate the shared fallback.
	quotes := service.Load()
	quotes[0].Quote = "changed"
	if DefaultQuotes[0].Quote == "changed" {
		t.Fatal("Load returned the shared default slice")
	}

	path := filepath.Join(dataDir, dataFileName)
	if err := os.WriteFile(path, []byte(`{"not":"an array"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := service.Load(); len(got) != len(DefaultQuotes) {
		t.Fatalf("non-array file len = %d", len(got))
	}

	if err := os.WriteFile(path, []byte(`[]`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := service.Load(); len(got) != len(DefaultQuotes) {
		t.Fatalf("empty array len = %d", len(got))
	}

	if err := os.WriteFile(path, []byte(`{broken`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := service.Load(); len(got) != len(DefaultQuotes) {
		t.Fatalf("corrupt file len = %d", len(got))
	}
}

func TestLoadReadsAndNormalizesFile(t *testing.T) {
	dataDir := t.TempDir()
	path := filepath.Join(dataDir, dataFileName)
	payload := `[{"operator":"银灰","quote":" 战术安排已就绪 "}]`
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}

	service := New(config.Paths{DataDir: dataDir}, nil)
	quotes := service.Load()
	if len(quotes) != 1 {
		t.Fatalf("len = %d", len(quotes))
	}
	want := OperatorQuote{OperatorID: "char_172_svrash", Operator: "银灰", Quote: "战术安排已就绪"}
	if quotes[0] != want {
		t.Fatalf("quote = %#v, want %#v", quotes[0], want)
	}
}

func TestQuoteCRUDPersists(t *testing.T) {
	dataDir := t.TempDir()
	service := New(config.Paths{DataDir: dataDir}, nil)

	added, err := service.AddQuote(OperatorQuote{OperatorID: "", Operator: "自定义干员", Quote: "第一条"})
	if err != nil {
		t.Fatal(err)
	}
	if len(added) != len(DefaultQuotes)+1 {
		t.Fatalf("after add len = %d", len(added))
	}
	if added[len(added)-1].OperatorID != "" {
		t.Fatalf("added operatorId = %q", added[len(added)-1].OperatorID)
	}

	quote, ok := service.GetQuoteByOperator("自定义干员")
	if !ok || quote.Quote != "第一条" {
		t.Fatalf("get = %#v, %v", quote, ok)
	}

	updated, found, err := service.UpdateQuote("自定义干员", "第二条")
	if err != nil || !found {
		t.Fatalf("update = %#v, %v, %v", updated, found, err)
	}
	if updated.Quote != "第二条" {
		t.Fatalf("updated quote = %#v", updated)
	}
	if _, found, err := service.UpdateQuote("不存在", "x"); err != nil || found {
		t.Fatalf("missing update found=%v err=%v", found, err)
	}

	remaining, err := service.DeleteQuote("自定义干员")
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != len(DefaultQuotes) {
		t.Fatalf("after delete len = %d", len(remaining))
	}

	raw, err := os.ReadFile(filepath.Join(dataDir, dataFileName))
	if err != nil {
		t.Fatal(err)
	}
	var persisted []OperatorQuote
	if err := json.Unmarshal(raw, &persisted); err != nil {
		t.Fatalf("persisted JSON: %v", err)
	}
	if len(persisted) != len(DefaultQuotes) {
		t.Fatalf("persisted len = %d", len(persisted))
	}
}

func TestDailyAndRandomQuotes(t *testing.T) {
	current := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	service := NewWithOptions(Options{
		Paths:  config.Paths{DataDir: t.TempDir()},
		Now:    func() time.Time { return current },
		Random: func(n int) int { return n - 1 },
	})

	daily := service.GetDailyQuote()
	if daily != DefaultQuotes[1] {
		t.Fatalf("Jan 1 daily = %#v, want %#v", daily, DefaultQuotes[1])
	}

	random := service.GetRandomQuote()
	if random != DefaultQuotes[len(DefaultQuotes)-1] {
		t.Fatalf("random = %#v", random)
	}
}
