// Package results ports the MaaCore callback and task-result parsers used by
// the Node scheduler. Parsers are pure: they never start MAA or touch a
// device, and they tolerate the incomplete lines produced by incremental log
// checkpoints.
package results

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
)

const (
	// CallbackMarker prefixes structured MaaCore callback lines.
	CallbackMarker = "Assistant::append_callback | "
	// connectionEventLimit caps the auxiliary callback windows.
	connectionEventLimit = 20
)

type CallbackPayload struct {
	What      string         `json:"what,omitempty"`
	Taskchain string         `json:"taskchain,omitempty"`
	Class     string         `json:"class,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
	Callback  string         `json:"callback,omitempty"`
}

type DropItem struct {
	ItemID string  `json:"itemId"`
	Name   string  `json:"name"`
	Count  float64 `json:"count"`
}

type BlackFlowStartRun struct {
	Status  string   `json:"status"`
	Rewards []string `json:"rewards"`
}

type BlackFlowScrapTradeAborted struct {
	Reason string `json:"reason"`
	Item   string `json:"item"`
}

type CopilotPrecheckFile struct {
	NavName  string `json:"navName"`
	Filename string `json:"filename"`
}

type StageInfo struct {
	Name  string `json:"name"`
	Stage string `json:"stage"`
}

type ConnectionEvent struct {
	What    string         `json:"what"`
	Details map[string]any `json:"details"`
}

type AuxiliaryCallbacks struct {
	BlackflowStartRun          []BlackFlowStartRun          `json:"blackflowStartRun"`
	BlackflowScrapTradeAborted []BlackFlowScrapTradeAborted `json:"blackflowScrapTradeAborted"`
	CopilotPrecheckFile        []CopilotPrecheckFile        `json:"copilotPrecheckFile"`
	StageInfo                  []StageInfo                  `json:"stageInfo"`
	StageInfoErrors            int                          `json:"stageInfoErrors"`
	UnsupportedLevels          []string                     `json:"unsupportedLevels"`
	RecruitSpecialTags         []string                     `json:"recruitSpecialTags"`
	RecruitSelectedTags        [][]string                   `json:"recruitSelectedTags"`
	ConnectionEvents           []ConnectionEvent            `json:"connectionEvents"`
}

type FightCallbackSummary struct {
	Stage        *string    `json:"stage"`
	Items        []DropItem `json:"items"`
	SanityUsed   float64    `json:"sanityUsed"`
	SanityBefore *float64   `json:"sanityBefore"`
	SanityAfter  *float64   `json:"sanityAfter"`
}

// ParseMaaCallbackPayloads parses every structured callback line in a log
// window. Incomplete final lines are ignored.
func ParseMaaCallbackPayloads(logOutput any) []CallbackPayload {
	events := make([]CallbackPayload, 0)
	for _, line := range strings.Split(truthyString(logOutput), "\n") {
		markerIndex := strings.Index(line, CallbackMarker)
		if markerIndex == -1 {
			continue
		}

		callback := line[markerIndex+len(CallbackMarker):]
		jsonIndex := strings.Index(callback, "{")
		if jsonIndex == -1 {
			continue
		}

		var parsed any
		if err := decodeCallbackJSON([]byte(callback[jsonIndex:]), &parsed); err != nil {
			continue
		}
		record := asRecord(parsed)
		if record == nil {
			continue
		}

		payload := CallbackPayload{Callback: strings.TrimSpace(callback[:jsonIndex])}
		if value, ok := record["what"].(string); ok {
			payload.What = value
		}
		if value, ok := record["taskchain"].(string); ok {
			payload.Taskchain = value
		}
		if value, ok := record["class"].(string); ok {
			payload.Class = value
		}
		if value, ok := record["details"].(map[string]any); ok {
			payload.Details = value
		}
		events = append(events, payload)
	}
	return events
}

func decodeCallbackJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return io.ErrUnexpectedEOF
		}
		return err
	}
	return nil
}

// ParseMaaCallbackEvents keeps only payloads for one task chain.
func ParseMaaCallbackEvents(logOutput any, taskchain string) []CallbackPayload {
	payloads := ParseMaaCallbackPayloads(logOutput)
	events := make([]CallbackPayload, 0, len(payloads))
	for _, payload := range payloads {
		if payload.Taskchain == taskchain {
			events = append(events, payload)
		}
	}
	return events
}

// SummarizeAuxiliaryCallbacks collects the non-Fight callbacks exposed by the
// Agent and UI surfaces.
func SummarizeAuxiliaryCallbacks(logOutput any) AuxiliaryCallbacks {
	result := AuxiliaryCallbacks{
		BlackflowStartRun:          []BlackFlowStartRun{},
		BlackflowScrapTradeAborted: []BlackFlowScrapTradeAborted{},
		CopilotPrecheckFile:        []CopilotPrecheckFile{},
		StageInfo:                  []StageInfo{},
		UnsupportedLevels:          []string{},
		RecruitSpecialTags:         []string{},
		RecruitSelectedTags:        [][]string{},
		ConnectionEvents:           []ConnectionEvent{},
	}

	for _, payload := range ParseMaaCallbackPayloads(logOutput) {
		details := asRecord(payload.Details)
		switch payload.What {
		case "BlackFlowStartRun":
			rewards := stringSlice(details["rewards"])
			if rewards == nil {
				rewards = []string{}
			}
			result.BlackflowStartRun = pushCapped(result.BlackflowStartRun, BlackFlowStartRun{
				Status:  truthyString(details["status"]),
				Rewards: rewards,
			}, connectionEventLimit)
		case "BlackFlowScrapTradeAborted":
			result.BlackflowScrapTradeAborted = pushCapped(result.BlackflowScrapTradeAborted, BlackFlowScrapTradeAborted{
				Reason: truthyString(details["reason"]),
				Item:   truthyString(details["item"]),
			}, connectionEventLimit)
		case "CopilotPrecheckFile":
			navName := truthyString(firstTruthy(details["nav_name"], details["navName"]))
			result.CopilotPrecheckFile = pushCapped(result.CopilotPrecheckFile, CopilotPrecheckFile{
				NavName:  navName,
				Filename: truthyString(details["filename"]),
			}, connectionEventLimit)
		case "StageInfo":
			result.StageInfo = pushCapped(result.StageInfo, StageInfo{
				Name:  truthyString(firstTruthy(details["name"], details["stage"])),
				Stage: truthyString(details["stage"]),
			}, connectionEventLimit)
		case "StageInfoError":
			result.StageInfoErrors++
		case "UnsupportedLevel":
			result.UnsupportedLevels = pushCapped(result.UnsupportedLevels, truthyString(details["level"]), connectionEventLimit)
		case "RecruitSpecialTag":
			result.RecruitSpecialTags = pushCapped(result.RecruitSpecialTags, truthyString(details["tag"]), connectionEventLimit)
		case "RecruitTagsSelected":
			tags := stringSlice(details["tags"])
			if tags == nil {
				tags = []string{}
			}
			result.RecruitSelectedTags = pushCapped(result.RecruitSelectedTags, tags, connectionEventLimit)
		case "ConnectFailed",
			"Connected",
			"Reconnecting",
			"Reconnected",
			"Disconnect",
			"ScreencapFailed",
			"TouchModeNotAvailable",
			"MuMuExtrasInputStatus",
			"ResolutionChanged",
			"ScreencapCost",
			"EmulatorFPS":
			eventDetails := details
			if eventDetails == nil {
				eventDetails = map[string]any{}
			}
			result.ConnectionEvents = pushCapped(result.ConnectionEvents, ConnectionEvent{
				What:    payload.What,
				Details: eventDetails,
			}, connectionEventLimit)
		}
	}

	return result
}

// SanityReading is the newest current/max sanity MaaCore reported.
type SanityReading struct {
	Current  float64 `json:"current"`
	Max      float64 `json:"max"`
	ReportAt string  `json:"reportAt"`
}

// LatestSanityState returns the newest SanityBeforeStage reading in a log window, in log order.
// Only fight callbacks report it; a log with no fight in the window has none.
func LatestSanityState(logOutput any) (SanityReading, bool) {
	var latest SanityReading
	found := false
	for _, payload := range ParseMaaCallbackPayloads(logOutput) {
		if payload.What != "SanityBeforeStage" {
			continue
		}
		details := asRecord(payload.Details)
		current, okCurrent := lookupNumber(details, "current_sanity")
		max, okMax := lookupNumber(details, "max_sanity")
		if !okCurrent || !okMax || max <= 0 {
			continue
		}
		latest = SanityReading{
			Current:  current,
			Max:      max,
			ReportAt: truthyString(details["report_time"]),
		}
		found = true
	}
	return latest, found
}

// SummarizeFightCallbacks collapses Fight callback events into one result.
// StageDrops.stats[].addQuantity is the per-run delta, FightTimes.sanity_cost
// is per fight, and SanityBeforeStage is the fallback sanity source.
func SummarizeFightCallbacks(logOutput any) FightCallbackSummary {
	items := []DropItem{}
	var stage *string
	sanityCost := 0.0
	var sanityBefore *float64
	var sanityAfter *float64

	for _, payload := range ParseMaaCallbackPayloads(logOutput) {
		details := asRecord(payload.Details)

		switch payload.What {
		case "StageDrops":
			if stageDetails := asRecord(details["stage"]); stageDetails != nil {
				if stageCode, ok := stageDetails["stageCode"].(string); ok {
					code := stageCode
					stage = &code
				}
			}
			stats, ok := asAnySlice(details["stats"])
			if !ok {
				stats = nil
			}
			drops := stats
			if len(stats) == 0 {
				if fromDetails, ok := asAnySlice(details["drops"]); ok {
					drops = fromDetails
				}
			}
			for _, item := range drops {
				items = addDropItem(items, item)
			}
		case "FightTimes":
			if cost, ok := lookupNumber(details, "sanity_cost"); ok && cost > 0 {
				sanityCost += cost
			}
		case "SanityBeforeStage":
			if current, ok := lookupNumber(details, "current_sanity"); ok {
				if sanityBefore == nil {
					value := current
					sanityBefore = &value
				}
				value := current
				sanityAfter = &value
			}
		}
	}

	sanityUsed := 0.0
	if sanityCost > 0 {
		sanityUsed = sanityCost
	} else if sanityBefore != nil && sanityAfter != nil && *sanityBefore > *sanityAfter {
		sanityUsed = *sanityBefore - *sanityAfter
	}

	return FightCallbackSummary{
		Stage:        stage,
		Items:        items,
		SanityUsed:   sanityUsed,
		SanityBefore: sanityBefore,
		SanityAfter:  sanityAfter,
	}
}

func addDropItem(items []DropItem, rawItem any) []DropItem {
	item := asRecord(rawItem)
	count, ok := numberValue(itemValueOrZero(item, "addQuantity", "quantity"))
	if !ok || count <= 0 {
		return items
	}

	itemID := stringValue(coalesceValue(item, "itemId", "id"))
	if coalesceValue(item, "itemId", "id") == nil {
		itemID = ""
	}
	name := stringValue(coalesceValue(item, "itemName", "name"))
	if coalesceValue(item, "itemName", "name") == nil {
		name = itemID
	}

	for index := range items {
		if items[index].ItemID == itemID && items[index].Name == name {
			items[index].Count += count
			return items
		}
	}
	items = append(items, DropItem{ItemID: itemID, Name: name, Count: count})
	return items
}

func itemValueOrZero(item map[string]any, keys ...string) any {
	if value := coalesceValue(item, keys...); value != nil {
		return value
	}
	return float64(0)
}
