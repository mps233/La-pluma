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

func TestDecodeOperBox(t *testing.T) {
	raw := map[string]any{
		"timestamp":      "2026-11-28T02:00:00.000Z",
		"operCount":      json.Number("1"),
		"totalOperCount": json.Number("2"),
		"data":           []any{map[string]any{"id": "char_002_amiya", "rarity": json.Number("5")}},
		"allOpers":       []any{map[string]any{"id": "char_002_amiya", "name": "Amiya", "rarity": json.Number("5"), "own": true}},
		"operators":      []any{map[string]any{"id": "legacy"}},
	}
	document, err := DecodeOperBox(raw)
	if err != nil {
		t.Fatal(err)
	}
	if document.OperCount != 1 || document.TotalOperCount != 2 {
		t.Fatalf("counts = %+v", document)
	}
	if len(document.Data) != 1 || len(document.Operators) != 1 {
		t.Fatalf("data/operators = %+v", document)
	}
	if len(document.AllOpers) != 1 || document.AllOpers[0].Rarity != 5 || !document.AllOpers[0].Own {
		t.Fatalf("allOpers = %+v", document.AllOpers)
	}
}

func TestDecodeDepotKeepsNumberText(t *testing.T) {
	raw := map[string]any{
		"timestamp": "2026-11-28T02:00:00.000Z",
		"itemCount": json.Number("1"),
		"complete":  true,
		"items": []any{map[string]any{
			"id": "30012", "count": json.Number("3"), "iconId": json.Number("30012"), "sortId": json.Number("6"),
		}},
	}
	document, err := DecodeDepot(raw)
	if err != nil {
		t.Fatal(err)
	}
	if document.ItemCount != 1 || !document.Complete {
		t.Fatalf("document = %+v", document)
	}
	if len(document.Items) != 1 {
		t.Fatalf("items = %+v", document.Items)
	}
	item := document.Items[0]
	if item.Count != json.Number("3") || item.SortID != 6 {
		t.Fatalf("item = %+v", item)
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
