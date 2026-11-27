package activity

import (
	"path/filepath"
	"strings"
	"time"

	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
	"github.com/mps233/la-pluma/go/internal/util/jsval"
)

const stageZoneCacheTTL = 5 * time.Minute

type stageZoneCache struct {
	expiresAt time.Time
	byCode    map[string]string
}

// StageZoneName returns the chapter/zone display name for a stage code. The
// game-data seed writes this into data/stages.json; the training-material
// refresh action regenerates that file.
func (s *Service) StageZoneName(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return ""
	}
	return s.loadStageZones()[code]
}

// supportsSpecialStageNavigation reports whether refreshed game data can
// resolve a chapter for at least one EX/S/MO/TR stage of the activity.
func (s *Service) supportsSpecialStageNavigation(activityCode string) bool {
	prefix := strings.ToUpper(strings.TrimSpace(activityCode)) + "-"
	if prefix == "-" {
		return false
	}
	for code, name := range s.loadStageZones() {
		if name == "" || !strings.HasPrefix(code, prefix) {
			continue
		}
		if !autoNavigableStagePattern.MatchString(code) {
			return true
		}
	}
	return false
}

func (s *Service) loadStageZones() map[string]string {
	s.zoneMu.Lock()
	if cached := s.zoneCache; cached != nil && cached.expiresAt.After(s.now()) {
		byCode := cached.byCode
		s.zoneMu.Unlock()
		return byCode
	}
	s.zoneMu.Unlock()

	byCode := map[string]string{}
	value, err := jsonstore.Read(filepath.Join(s.paths.DataDir, "stages.json"), nil)
	if err == nil {
		switch typed := value.(type) {
		case map[string]any:
			for code, raw := range typed {
				record := jsval.Record(raw)
				name := strings.TrimSpace(jsval.Text(record["zoneName"]))
				if name != "" {
					byCode[strings.ToUpper(code)] = name
				}
			}
		case []any:
			for _, raw := range typed {
				record := jsval.Record(raw)
				code := strings.ToUpper(strings.TrimSpace(jsval.Text(record["code"])))
				name := strings.TrimSpace(jsval.Text(record["zoneName"]))
				if code != "" && name != "" {
					byCode[code] = name
				}
			}
		}
	}

	s.zoneMu.Lock()
	s.zoneCache = &stageZoneCache{expiresAt: s.now().Add(stageZoneCacheTTL), byCode: byCode}
	s.zoneMu.Unlock()
	return byCode
}
