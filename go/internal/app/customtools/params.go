package customtools

import (
	"encoding/json"
	"math"
	"reflect"
	"strconv"
	"strings"
)

// normalizePixelPaint mirrors normalizePixelPaint() in the Node service. It
// returns the exact pixel_paint object written to the MAA task file.
func normalizePixelPaint(source map[string]any) (map[string]any, error) {
	const invalidToolID = "pixel-paint"

	rawGroups, ok := source["groups"]
	if !ok {
		return nil, invalidParamsError(invalidToolID, "pixel_paint.groups 必须是非空数组", nil)
	}
	groups, ok := toSlice(rawGroups)
	if !ok || len(groups) == 0 {
		return nil, invalidParamsError(invalidToolID, "pixel_paint.groups 必须是非空数组", nil)
	}

	normalizedGroups := make([]any, 0, len(groups))
	for index, rawGroup := range groups {
		group, ok := toRecord(rawGroup)
		if !ok {
			group = map[string]any{}
		}

		colorRaw, hasColor := group["color"]
		color, colorOK := integerValue(colorRaw)
		if !hasColor || !colorOK || color < 0 || color > 39 {
			return nil, invalidParamsError(invalidToolID,
				"第 "+itoa(index+1)+" 组的 color 必须是 0-39 的整数", nil)
		}

		rawPoints, hasPoints := group["points"]
		points, pointsOK := toSlice(rawPoints)
		if !hasPoints || !pointsOK || len(points) == 0 {
			return nil, invalidParamsError(invalidToolID,
				"第 "+itoa(index+1)+" 组的 points 必须是非空数组", nil)
		}

		normalizedPoints := make([]any, 0, len(points))
		for _, rawPoint := range points {
			values, ok := toSlice(rawPoint)
			if !ok || len(values) != 2 {
				return nil, invalidParamsError(invalidToolID, "points 的每一项必须是 [x, y]", nil)
			}
			x, xOK := integerValue(values[0])
			y, yOK := integerValue(values[1])
			if !xOK || !yOK || x < 0 || x > 23 || y < 0 || y > 23 {
				return nil, invalidParamsError(invalidToolID, "points 坐标必须是 0-23 的整数", nil)
			}
			normalizedPoints = append(normalizedPoints, []any{x, y})
		}

		normalizedGroups = append(normalizedGroups, map[string]any{
			"color":  color,
			"points": normalizedPoints,
		})
	}

	result := map[string]any{"groups": normalizedGroups}
	if swipe, ok := source["swipe"]; ok {
		result["swipe"] = jsTruthy(swipe)
	}
	if rawDelay, ok := source["grid_delay"]; ok {
		delay, delayOK := integerValue(rawDelay)
		if !delayOK || delay < 0 || delay > 1000 {
			return nil, invalidParamsError(invalidToolID, "grid_delay 必须是 0-1000 的整数", nil)
		}
		result["grid_delay"] = delay
	}
	return result, nil
}

// normalizeBlacklist mirrors normalizeBlacklist(): strings only, trimmed,
// empty values dropped, de-duplicated in insertion order and capped at 100.
func normalizeBlacklist(source map[string]any) (map[string]any, error) {
	raw, ok := source["blacklist"]
	if !ok {
		raw = []any{}
	}
	items, ok := toSlice(raw)
	if !ok {
		return nil, invalidParamsError("event-shop-blacklist", "event_shop.blacklist 必须是字符串数组", nil)
	}

	seen := make(map[string]struct{}, len(items))
	blacklist := make([]string, 0, len(items))
	for _, item := range items {
		name, ok := item.(string)
		if !ok {
			return nil, invalidParamsError("event-shop-blacklist", "event_shop.blacklist 必须是字符串数组", nil)
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		blacklist = append(blacklist, name)
		if len(blacklist) == 100 {
			break
		}
	}
	return map[string]any{"blacklist": blacklist}, nil
}

func cloneRecord(source map[string]any) map[string]any {
	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func toRecord(value any) (map[string]any, bool) {
	if value == nil {
		return nil, false
	}
	if record, ok := value.(map[string]any); ok {
		return record, true
	}
	reflected := reflect.ValueOf(value)
	if reflected.Kind() != reflect.Map || reflected.Type().Key().Kind() != reflect.String {
		return nil, false
	}
	record := make(map[string]any, reflected.Len())
	iterator := reflected.MapRange()
	for iterator.Next() {
		record[iterator.Key().String()] = iterator.Value().Interface()
	}
	return record, true
}

func toSlice(value any) ([]any, bool) {
	if value == nil {
		return nil, false
	}
	if items, ok := value.([]any); ok {
		return items, true
	}
	reflected := reflect.ValueOf(value)
	if reflected.Kind() != reflect.Slice && reflected.Kind() != reflect.Array {
		return nil, false
	}
	items := make([]any, 0, reflected.Len())
	for index := 0; index < reflected.Len(); index++ {
		items = append(items, reflected.Index(index).Interface())
	}
	return items, true
}

// toNumber reproduces the JavaScript Number() conversions used by the Node
// validators: numeric values, trimmed numeric strings, booleans and null.
func toNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int8:
		return float64(typed), true
	case int16:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint8:
		return float64(typed), true
	case uint16:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0, true
		}
		number, err := strconv.ParseFloat(trimmed, 64)
		if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
			return 0, false
		}
		return number, true
	case bool:
		if typed {
			return 1, true
		}
		return 0, true
	case nil:
		return 0, true
	default:
		return 0, false
	}
}

func integerValue(value any) (int, bool) {
	number, ok := toNumber(value)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number {
		return 0, false
	}
	if number < -1e15 || number > 1e15 {
		return 0, false
	}
	return int(number), true
}

// jsTruthy mirrors JavaScript Boolean() for the swipe flag. JSON
// values are usually booleans, but strings and containers keep the same
// truthiness the Node service exposes.
func jsTruthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case json.Number:
		number, err := typed.Float64()
		return err == nil && number != 0 && !math.IsNaN(number)
	case float64:
		return typed != 0 && !math.IsNaN(typed)
	case float32:
		return typed != 0 && !math.IsNaN(float64(typed))
	case int, int8, int16, int32, int64:
		return reflect.ValueOf(typed).Int() != 0
	case uint, uint8, uint16, uint32, uint64:
		return reflect.ValueOf(typed).Uint() != 0
	default:
		return true
	}
}
