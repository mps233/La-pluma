package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/app/activity"
	"github.com/mps233/la-pluma/go/internal/config"
)

func TestReplaceActivityCodeUsesCurrentActivityPrefix(t *testing.T) {
	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "StageActivityV2.json")
	data, err := json.Marshal(map[string]any{
		"Official": map[string]any{
			"sideStoryStage": map[string]any{
				"act_test": map[string]any{
					"Activity": map[string]any{
						"StageName":     "测试活动",
						"UtcStartTime":  "2026/11/08 00:00:00",
						"UtcExpireTime": "2026/11/09 00:00:00",
						"TimeZone":      float64(0),
					},
					"Stages": []any{map[string]any{"Value": "ACT-1"}, map[string]any{"Value": "ACT-2"}},
				},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	service := activity.NewWithOptions(activity.Options{
		Paths:             config.Paths{MaaCacheDir: filepath.Dir(path)},
		StageActivityPath: path,
		Now:               func() time.Time { return now },
	})
	if got := replaceActivityCode(service, "HD-7", "Official"); got != "ACT-7" {
		t.Fatalf("resolved stage = %q", got)
	}
	if got := replaceActivityCode(service, "1-7", "Official"); got != "1-7" {
		t.Fatalf("plain stage = %q", got)
	}
}
