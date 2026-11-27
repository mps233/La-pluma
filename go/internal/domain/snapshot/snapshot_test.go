package snapshot

import (
	"encoding/json"
	"testing"
)

func TestOperBoxOutputJSONShape(t *testing.T) {
	document := OperBoxOutput{
		Timestamp:      "2026-11-28T02:00:00.000Z",
		OperCount:      1,
		TotalOperCount: 2,
		Data:           []any{map[string]any{"id": "char_002_amiya"}},
		AllOpers:       []OperBoxRecord{{ID: "char_002_amiya", Name: "阿米娅", Rarity: 5, Own: true}},
	}
	data, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"timestamp", "operCount", "totalOperCount", "data", "allOpers"} {
		if _, ok := decoded[key]; !ok {
			t.Fatalf("missing key %q in %s", key, data)
		}
	}
}

func TestDepotOutputJSONShape(t *testing.T) {
	document := DepotOutput{
		Timestamp: "2026-11-28T02:00:00.000Z",
		ItemCount: 1,
		Items: []DepotItem{{
			ID:           "30012",
			Name:         "源岩",
			Count:        json.Number("3"),
			Icon:         "30012",
			IconID:       json.Number("30012"),
			ClassifyType: "MATERIAL",
			SortID:       6,
		}},
		Complete: true,
	}
	data, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"timestamp", "itemCount", "items", "complete"} {
		if _, ok := decoded[key]; !ok {
			t.Fatalf("missing key %q in %s", key, data)
		}
	}
}
