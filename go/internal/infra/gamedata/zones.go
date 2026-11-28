package gamedata

import (
	"strings"

	"github.com/mps233/la-pluma/go/internal/util/jsval"
)

// ParseZoneNames returns the display name of each zone from zone_table.json.
// Activity zones put the chapter title in zoneNameSecond; older layouts use
// zoneNameFirst or zoneNameThird.
func ParseZoneNames(zoneTable any) map[string]string {
	root := jsval.Record(zoneTable)
	zones := jsval.Record(root["zones"])
	names := map[string]string{}
	for zoneID, raw := range zones {
		zone := jsval.Record(raw)
		if zone == nil {
			continue
		}
		name := ""
		for _, key := range []string{"zoneNameSecond", "zoneNameFirst", "zoneNameThird"} {
			if value, ok := jsval.TextOK(zone[key]); ok && strings.TrimSpace(value) != "" {
				name = strings.TrimSpace(value)
				break
			}
		}
		if name != "" {
			names[jsval.StringJSON(zoneID)] = name
		}
	}
	return names
}
