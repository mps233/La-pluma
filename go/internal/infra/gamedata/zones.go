package gamedata

import "strings"

// ParseZoneNames returns the display name of each zone from zone_table.json.
// Activity zones put the chapter title in zoneNameSecond; older layouts use
// zoneNameFirst or zoneNameThird.
func ParseZoneNames(zoneTable any) map[string]string {
	root := asRecord(zoneTable)
	zones := asRecord(root["zones"])
	names := map[string]string{}
	for zoneID, raw := range zones {
		zone := asRecord(raw)
		if zone == nil {
			continue
		}
		name := ""
		for _, key := range []string{"zoneNameSecond", "zoneNameFirst", "zoneNameThird"} {
			if value, ok := stringValue(zone[key]); ok && strings.TrimSpace(value) != "" {
				name = strings.TrimSpace(value)
				break
			}
		}
		if name != "" {
			names[jsString(zoneID)] = name
		}
	}
	return names
}
