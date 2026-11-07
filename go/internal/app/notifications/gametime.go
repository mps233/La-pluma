package notifications

import (
	"strings"
	"time"
)

// gameDayStartHour is the in-game daily reset hour. "Today" is measured in the
// client service zone at 04:00, matching server/services/gameCalendar.ts.
const gameDayStartHour = 4

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

// GameDay is the game date and weekday (0 = Sunday) for an instant.
type GameDay struct {
	Date    string
	Weekday int
}

// GetGameDay computes the game day for now using a fixed offset and the 04:00
// reset, without consulting the host process time zone.
func GetGameDay(now time.Time, clientType string) GameDay {
	zone := ResolveGameZone(clientType)
	shifted := now.UTC().Add(time.Duration(zone.UTCOffsetHours-gameDayStartHour) * time.Hour)
	return GameDay{
		Date:    shifted.Format("2006-01-02"),
		Weekday: int(shifted.Weekday()),
	}
}
