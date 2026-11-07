// Package scheduler ports the core of server/services/schedulerService.ts:
// daily cron registration, task-flow validation and planning, sequential MAA
// execution, stop propagation, startup retry, dynamic fight tasks, drop
// recording and the auto-update hook.
package scheduler

import (
	"regexp"
	"strings"
	"sync"
	"time"
	_ "time/tzdata" // Embed the IANA database so LoadLocation works on every host.
)

// GameDayStartHour is the in-game daily reset hour. "Today" is measured in the
// client service zone at 04:00, matching server/services/gameCalendar.ts.
const GameDayStartHour = 4

// GameZone is the fixed UTC offset and IANA time zone for a client type. The
// offsets are fixed because the game servers do not observe daylight saving.
type GameZone struct {
	UTCOffsetHours int
	TimeZone       string
}

var gameZones = map[string]GameZone{
	"official": {UTCOffsetHours: 8, TimeZone: "Asia/Shanghai"},
	"bilibili": {UTCOffsetHours: 8, TimeZone: "Asia/Shanghai"},
	"txwy":     {UTCOffsetHours: 8, TimeZone: "Asia/Shanghai"},
	"yostaren": {UTCOffsetHours: -7, TimeZone: "Etc/GMT+7"},
	"yostarjp": {UTCOffsetHours: 9, TimeZone: "Asia/Tokyo"},
	"yostarkr": {UTCOffsetHours: 9, TimeZone: "Asia/Seoul"},
}

// ResolveGameZone maps a client type to its service zone. Unknown or empty
// client types fall back to the Official zone.
func ResolveGameZone(clientType string) GameZone {
	if zone, ok := gameZones[strings.ToLower(strings.TrimSpace(clientType))]; ok {
		return zone
	}
	return gameZones["official"]
}

// GameTimeZoneForClientType returns the IANA zone used for cron registration.
func GameTimeZoneForClientType(clientType string) string {
	return ResolveGameZone(clientType).TimeZone
}

// GameDay is the game date and weekday (0 = Sunday) for an instant.
type GameDay struct {
	Date    string `json:"date"`
	Weekday int    `json:"weekday"`
}

// GetGameDay computes the game day for now using a fixed offset and the 04:00
// reset, without consulting the host process time zone.
func GetGameDay(now time.Time, clientType string) GameDay {
	zone := ResolveGameZone(clientType)
	shifted := now.UTC().Add(time.Duration(zone.UTCOffsetHours-GameDayStartHour) * time.Hour)
	return GameDay{
		Date:    shifted.Format("2006-01-02"),
		Weekday: int(shifted.Weekday()),
	}
}

var locationCache sync.Map

// gameLocation loads and caches the IANA location for a client type. The
// embedded tzdata makes this independent of the host; a fixed-offset fallback
// keeps cron registration working if a build strips the database.
func gameLocation(clientType string) *time.Location {
	zone := ResolveGameZone(clientType)
	if cached, ok := locationCache.Load(zone.TimeZone); ok {
		return cached.(*time.Location)
	}
	location, err := time.LoadLocation(zone.TimeZone)
	if err != nil {
		location = time.FixedZone(zone.TimeZone, zone.UTCOffsetHours*3600)
	}
	locationCache.Store(zone.TimeZone, location)
	return location
}

var clockPattern = regexp.MustCompile(`^(?:[01]\d|2[0-3]):[0-5]\d$`)

// ParseClock validates a strict HH:MM value and returns its hour and minute.
func ParseClock(value string) (hour, minute int, ok bool) {
	trimmed := strings.TrimSpace(value)
	if !clockPattern.MatchString(trimmed) {
		return 0, 0, false
	}
	parts := strings.SplitN(trimmed, ":", 2)
	hour = int(parts[0][0]-'0')*10 + int(parts[0][1]-'0')
	minute = int(parts[1][0]-'0')*10 + int(parts[1][1]-'0')
	return hour, minute, true
}

// NormalizeScheduleTimes keeps valid HH:MM values, preserving first-seen order
// and dropping duplicates, like setupSchedule.
func NormalizeScheduleTimes(values []string) []string {
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if !clockPattern.MatchString(trimmed) {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	return normalized
}

// nextDailyOccurrence returns the next local hour:minute occurrence after the
// given instant in the supplied location.
func nextDailyOccurrence(after time.Time, location *time.Location, hour, minute int) time.Time {
	local := after.In(location)
	next := time.Date(local.Year(), local.Month(), local.Day(), hour, minute, 0, 0, location)
	if !next.After(local) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}
