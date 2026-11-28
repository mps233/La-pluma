package mastery

import (
	"encoding/json"
	"math"
	"strings"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsval"
	"github.com/mps233/la-pluma/go/internal/util/timefmt"
)

const (
	defaultClientType = "Official"

	// The values are part of the Agent API contract used by preflight.
	minimumCLIVersion  = "0.7.8"
	minimumCoreVersion = "6.21.4"
)

var clientTypeNames = map[string]string{
	"official": "Official",
	"bilibili": "Bilibili",
	"txwy":     "txwy",
	"yostaren": "YostarEN",
	"yostarjp": "YostarJP",
	"yostarkr": "YostarKR",
}

var roleNames = map[string]string{
	"PIONEER": "Pioneer",
	"WARRIOR": "Warrior",
	"SNIPER":  "Sniper",
	"TANK":    "Tank",
	"MEDIC":   "Medic",
	"SUPPORT": "Support",
	"CASTER":  "Caster",
	"SPECIAL": "Special",
}

// normalizeClientType mirrors maaService.normalizeClientType. Unknown values
// are rejected with the same stable error instead of being silently mapped.
func normalizeClientType(value string) (string, error) {
	key := strings.ToLower(strings.TrimSpace(value))
	if key == "" {
		return defaultClientType, nil
	}
	normalized, ok := clientTypeNames[key]
	if !ok {
		return "", apperrors.WithStatus(
			"MAA_CLIENT_TYPE_INVALID",
			"不支持的客户端类型: "+value,
			400,
			false,
			map[string]any{"clientType": value},
		)
	}
	return normalized, nil
}

func roleFromProfession(professionID string) *string {
	role, ok := roleNames[strings.ToUpper(professionID)]
	if !ok {
		return nil
	}
	return &role
}

func firstString(values ...*string) *string {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func formatISO(value time.Time) string {
	return timefmt.FormatMillis(value)
}

// ageDays mirrors Date.parse + Math.round against the current clock.
func ageDays(timestamp *string, now time.Time) *int {
	if timestamp == nil || *timestamp == "" {
		return nil
	}
	parsed, ok := parseTimestamp(*timestamp)
	if !ok {
		return nil
	}
	days := now.Sub(parsed).Hours() / 24
	value := int(math.Round(days))
	if value < 0 {
		value = 0
	}
	return &value
}

func parseTimestamp(value string) (time.Time, bool) {
	layouts := []string{
		time.RFC3339Nano,
		timefmt.DateLayout,
		"2006-01-02 15:04:05",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

func asRecord(value any) (map[string]any, bool) {
	record := jsval.Record(value)
	return record, record != nil
}

func asArray(value any) ([]any, bool) {
	array := jsval.Array(value)
	return array, array != nil
}

func numberOr(value any, fallback float64) float64 {
	parsed, ok := jsval.FiniteNumberOrNull(value)
	if !ok {
		return fallback
	}
	return parsed
}

// integerValue mirrors Number.isInteger. It accepts JSON numbers, strings and
// float64 values that carry no fractional part.
func integerValue(value any) (int, bool) {
	parsed, ok := jsval.FiniteNumberOrNull(value)
	if !ok || parsed != math.Trunc(parsed) {
		return 0, false
	}
	if parsed > math.MaxInt32 || parsed < math.MinInt32 {
		return 0, false
	}
	return int(parsed), true
}

// stringify follows String(value) for material ids. JSON numbers keep their
// textual representation rather than producing float formatting artifacts.
func boolNotFalse(value any) bool {
	typed, ok := value.(bool)
	return !ok || typed
}

func boolTrue(value any) bool {
	typed, ok := value.(bool)
	return ok && typed
}

func clamp(value, minimum, maximum int) int {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

// flexNumbers converts a JSON array with Array.prototype.map(Number)
// semantics. Invalid entries are kept as null, like JSON.jsval.StringOrNullish(NaN).
func flexNumbers(value any) []*float64 {
	array, ok := asArray(value)
	if !ok {
		return nil
	}
	result := make([]*float64, 0, len(array))
	for _, raw := range array {
		parsed, valid := jsval.FiniteNumberOrNull(raw)
		if !valid {
			result = append(result, nil)
			continue
		}
		copy := parsed
		result = append(result, &copy)
	}
	return result
}

func integerFromFloat(value *float64) (int, bool) {
	if value == nil || *value != math.Trunc(*value) {
		return 0, false
	}
	return int(*value), true
}

// toAnyMap converts a typed struct into a map through JSON so spread-style
// merges preserve every persisted field.
func toAnyMap(value any) map[string]any {
	data, err := json.Marshal(value)
	if err != nil {
		return map[string]any{}
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.UseNumber()
	var result any
	if err := decoder.Decode(&result); err != nil {
		return map[string]any{}
	}
	record, _ := result.(map[string]any)
	if record == nil {
		return map[string]any{}
	}
	return record
}
