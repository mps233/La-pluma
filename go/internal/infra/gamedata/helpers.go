package gamedata

import (
	"math"
	"regexp"
	"strconv"
	"time"

	"github.com/mps233/la-pluma/go/internal/util/jsval"
	"github.com/mps233/la-pluma/go/internal/util/timefmt"
)

var leadingIntegerPattern = regexp.MustCompile(`^[\t\n\v\f\r ]*([+-]?[0-9]+)`)

// firstTruthy implements the `a || b || c` chain used by the Node scripts. It
// returns the last operand when every value is falsy, like JavaScript `||`.
func firstTruthy(values ...any) any {
	for _, value := range values {
		if jsval.Truthy(value) {
			return value
		}
	}
	if len(values) == 0 {
		return nil
	}
	return values[len(values)-1]
}

// parseIntJS parses the leading integer of String(value), falling back to 0
// like `parseInt(value, 10) || 0`.
func parseIntJS(value any) int {
	text := jsval.StringJSON(value)
	match := leadingIntegerPattern.FindStringSubmatch(text)
	if match == nil {
		return 0
	}
	parsed, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		return 0
	}
	return int(parsed)
}

// roundToFixed4 mirrors `parseFloat((value / 10000).toFixed(4))` for positive
// drop rates: the value is rounded to four decimal places.
func roundToFixed4(value float64) float64 {
	return math.Round(value*10000) / 10000
}

func dateOnly(now time.Time) string {
	return now.UTC().Format(timefmt.DateLayout)
}
