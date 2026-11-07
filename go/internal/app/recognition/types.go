// Package recognition ports the depot and OperBox recognition parsers from
// the Node dataParserService. It reads MAA callbacks from the debug log and
// enriches them with MaaResource data, then writes the same depot.json and
// operbox.json shapes as the Node server. It never starts MAA or touches a
// device.
package recognition

// Payload is one parsed MAA callback object. Recognition only depends on the
// "what" and "details" fields, but keeping the full object avoids re-parsing.
type Payload map[string]any

// Task identifies a recognition callback type in the MAA log.
type Task string

const (
	// TaskDepot matches the DepotInfo callback emitted by the Depot task.
	TaskDepot Task = "DepotInfo"
	// TaskOperBox matches the OperBoxInfo callback emitted by the OperBox task.
	TaskOperBox Task = "OperBoxInfo"
)

// Request overrides the per-call inputs used by a recognition run. The zero
// value reads the configured MAA log and writes to Paths.DataDir.
type Request struct {
	// LogPath overrides the MAA debug log path.
	LogPath string
	// LogContent bypasses the log reader entirely. A pointer distinguishes an
	// intentionally empty log from an omitted override.
	LogContent *string
	// DataDir overrides Paths.DataDir for the persisted JSON snapshots.
	DataDir string
	// Payloads bypasses the executor with already-parsed callbacks. Tests and
	// callers that captured callbacks can use this instead of a real log.
	Payloads []Payload
}

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

// DepotData is the route-facing data payload for a depot recognition.
type DepotData struct {
	Path      string      `json:"path"`
	ItemCount int         `json:"itemCount"`
	Items     []DepotItem `json:"items"`
	Complete  bool        `json:"complete"`
}

// DepotResult couples the route data with the persisted document.
type DepotResult struct {
	Data    DepotData
	Output  DepotOutput
	Written bool
}

// OperBoxRecord is the normalized operator entry retained for the OperBox UI.
type OperBoxRecord struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Rarity float64 `json:"rarity"`
	Own    bool    `json:"own"`
}

// OperBoxOutput is the exact operbox.json document shape.
type OperBoxOutput struct {
	Timestamp      string          `json:"timestamp"`
	OperCount      int             `json:"operCount"`
	TotalOperCount int             `json:"totalOperCount"`
	Data           []any           `json:"data"`
	AllOpers       []OperBoxRecord `json:"allOpers"`
}

// OperBoxData is the route-facing data payload for an OperBox recognition.
type OperBoxData struct {
	Path           string          `json:"path"`
	OperCount      int             `json:"operCount"`
	TotalOperCount int             `json:"totalOperCount"`
	Data           []any           `json:"data"`
	AllOpers       []OperBoxRecord `json:"allOpers"`
}

// OperBoxResult couples the route data with the persisted document.
type OperBoxResult struct {
	Data    OperBoxData
	Output  OperBoxOutput
	Written bool
}

// OperatorSummary is one entry of the battle_data.json operator catalog.
type OperatorSummary struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Rarity     float64 `json:"rarity"`
	Profession any     `json:"profession"`
	Position   any     `json:"position"`
}
