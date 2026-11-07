package recognition

import (
	"bytes"
	"encoding/json"
	"io"

	"github.com/mps233/la-pluma/go/internal/infra/maa/results"
)

// ExtractCallbackPayloads returns every structured callback in the log whose
// "what" equals the requested task. Field order inside the callback object is
// irrelevant because parsing happens after the marker, matching the Node
// implementation. Truncated or unrelated lines are ignored.
func ExtractCallbackPayloads(logContent, what string) []Payload {
	payloads := make([]Payload, 0)
	for _, event := range results.ParseMaaCallbackPayloads(logContent) {
		if event.What != what {
			continue
		}
		details := event.Details
		if details == nil {
			details = map[string]any{}
		}
		payloads = append(payloads, Payload{
			"what":      event.What,
			"class":     event.Class,
			"taskchain": event.Taskchain,
			"details":   details,
		})
	}
	return payloads
}

// RecognitionPayloadSelection is the callback chosen for parsing.
type RecognitionPayloadSelection struct {
	Payload Payload
	// Complete reports whether the callback's details.done was true.
	Complete bool
}

// SelectRecognitionPayload prefers the last completed callback that carries
// usable data, then falls back to the last usable callback even when MaaCore
// has not marked it done. It returns nil when no callback carries data.
func SelectRecognitionPayload(payloads []Payload, hasPayload func(Payload) bool) *RecognitionPayloadSelection {
	for index := len(payloads) - 1; index >= 0; index -= 1 {
		payload := payloads[index]
		if details := payloadDetails(payload); details["done"] == true && hasPayload(payload) {
			return &RecognitionPayloadSelection{Payload: payload, Complete: true}
		}
	}

	for index := len(payloads) - 1; index >= 0; index -= 1 {
		if hasPayload(payloads[index]) {
			return &RecognitionPayloadSelection{Payload: payloads[index], Complete: false}
		}
	}
	return nil
}

// ParseDepotPayloadData accepts the DepotInfo details object and returns its
// data value as either a JSON object or array. A nil result without an error
// means the details carried no usable data. A string payload that is not valid
// JSON returns the decode error so the caller can surface a stable parse
// failure.
func ParseDepotPayloadData(details any) (any, error) {
	record, ok := details.(map[string]any)
	if !ok {
		return nil, nil
	}
	data := record["data"]
	switch value := data.(type) {
	case string:
		parsed, err := decodeJSONStrict(value)
		if err != nil {
			return nil, err
		}
		switch parsed.(type) {
		case map[string]any, []any:
			return parsed, nil
		default:
			return nil, nil
		}
	case map[string]any:
		return value, nil
	default:
		return nil, nil
	}
}

func payloadDetails(payload Payload) map[string]any {
	if details, ok := payload["details"].(map[string]any); ok {
		return details
	}
	return map[string]any{}
}

// decodeJSONStrict mirrors JSON.parse: one complete value, optionally
// surrounded by whitespace, and no trailing tokens.
func decodeJSONStrict(text string) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader([]byte(text)))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return nil, io.ErrUnexpectedEOF
		}
		return nil, err
	}
	return value, nil
}
