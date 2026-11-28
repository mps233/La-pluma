// Package snapshot owns the persisted recognition document shapes. The
// recognition service writes operbox.json and depot.json; training, mastery,
// and the Agent API read them, so the schema must not live inside one of the
// readers.
package snapshot

import (
	"bytes"
	"encoding/json"
)

// DepotItem is one enriched depot entry. Count keeps the raw JSON value so a
// numeric callback count is not re-encoded through float64.
type DepotItem struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Count        any     `json:"count"`
	Icon         any     `json:"icon"`
	IconID       any     `json:"iconId"`
	ClassifyType string  `json:"classifyType"`
	SortID       float64 `json:"sortId"`
}

// DepotOutput is the exact depot.json document shape.
type DepotOutput struct {
	Timestamp string      `json:"timestamp"`
	ItemCount int         `json:"itemCount"`
	Items     []DepotItem `json:"items"`
	Complete  bool        `json:"complete"`
}

// OperBoxRecord is the normalized operator entry retained for the OperBox UI.
type OperBoxRecord struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Rarity float64 `json:"rarity"`
	Own    bool    `json:"own"`
}

// OperBoxOutput is the exact operbox.json document shape. Data keeps the raw
// MAA operator payload; AllOpers is the normalized catalog. Operators is the
// legacy pre-Data list that training still falls back to when Data is absent.
type OperBoxOutput struct {
	Timestamp      string          `json:"timestamp"`
	OperCount      int             `json:"operCount"`
	TotalOperCount int             `json:"totalOperCount"`
	Data           []any           `json:"data"`
	AllOpers       []OperBoxRecord `json:"allOpers"`
	Operators      []any           `json:"operators,omitempty"`
}

// DecodeOperBox converts a decoded operbox.json document into the typed shape.
// JSON numbers stay json.Number so raw operator payloads keep their precision.
func DecodeOperBox(raw any) (OperBoxOutput, error) {
	return decodeDocument[OperBoxOutput](raw)
}

// DecodeDepot converts a decoded depot.json document into the typed shape.
func DecodeDepot(raw any) (DepotOutput, error) {
	return decodeDocument[DepotOutput](raw)
}

func decodeDocument[T any](raw any) (T, error) {
	var document T
	data, err := json.Marshal(raw)
	if err != nil {
		return document, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&document); err != nil {
		return document, err
	}
	return document, nil
}
