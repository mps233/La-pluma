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
)

type CallbackPayload struct {
	What      string         `json:"what,omitempty"`
	Taskchain string         `json:"taskchain,omitempty"`
	Class     string         `json:"class,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
	Callback  string         `json:"callback,omitempty"`
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

// LatestSanityState returns the newest SanityBeforeStage reading in a log window, in log order.
