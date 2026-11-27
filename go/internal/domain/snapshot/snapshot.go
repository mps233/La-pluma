// Package snapshot owns the persisted recognition document shapes. The
// recognition service writes operbox.json and depot.json; training, mastery,
// and the Agent API read them, so the schema must not live inside one of the
// readers.
package snapshot

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
// MAA operator payload; AllOpers is the normalized catalog.
type OperBoxOutput struct {
	Timestamp      string          `json:"timestamp"`
	OperCount      int             `json:"operCount"`
	TotalOperCount int             `json:"totalOperCount"`
	Data           []any           `json:"data"`
	AllOpers       []OperBoxRecord `json:"allOpers"`
}
