package config

import (
	"testing"
	"time"
)

func TestLoadTuningDefaults(t *testing.T) {
	tuning := LoadTuning(func(string) string { return "" })
	want := DefaultTuning()
	if tuning != want {
		t.Fatalf("tuning = %#v, want %#v", tuning, want)
	}
}

func TestLoadTuningValues(t *testing.T) {
	env := map[string]string{
		"LA_PLUMA_BATTLE_OCR":             "off",
		"LA_PLUMA_BATTLE_OCR_INTERVAL_MS": "500",
		"LA_PLUMA_MASTERY_TICK_MS":        "1500",
		"LA_PLUMA_DROP_STATS_TTL_MS":      "0",
		"TZ":                              "UTC",
		"LA_PLUMA_ASSET_WEBP_GO":          "0",
		"LA_PLUMA_ASSET_WEBP_CONCURRENCY": "99",
		"LA_PLUMA_SCRCPY_SERVER_PATH":     "/tmp/scrcpy",
		"LA_PLUMA_SCRCPY_SERVER_VERSION":  "6.0.0",
		"LA_PLUMA_WEBRTC_DEVICE_ID":       "device-1",
	}
	tuning := LoadTuning(func(key string) string { return env[key] })

	if !tuning.BattleOCRDisabled {
		t.Fatal("battle OCR not disabled")
	}
	if tuning.BattleOCRInterval != minBattleOCRInterval {
		t.Fatalf("battle interval = %v", tuning.BattleOCRInterval)
	}
	if tuning.MasteryTick != 1500*time.Millisecond {
		t.Fatalf("mastery tick = %v", tuning.MasteryTick)
	}
	if tuning.DropStatsTTL != 0 {
		t.Fatalf("drop TTL = %v", tuning.DropStatsTTL)
	}
	if tuning.TimeZone != "UTC" {
		t.Fatalf("timezone = %q", tuning.TimeZone)
	}
	if !tuning.AssetWebPDisabled || tuning.AssetWebPConcurrency != maxWebPConcurrency {
		t.Fatalf("webp = %#v", tuning)
	}
	if tuning.ScrcpyServerPath != "/tmp/scrcpy" || tuning.ScrcpyServerVersion != "6.0.0" || tuning.WebRTCDeviceID != "device-1" {
		t.Fatalf("scrcpy/device = %#v", tuning)
	}
}

func TestLoadTuningRejectsInvalidNumbers(t *testing.T) {
	env := map[string]string{
		"LA_PLUMA_BATTLE_OCR_INTERVAL_MS": "fast",
		"LA_PLUMA_MASTERY_TICK_MS":        "10",
		"LA_PLUMA_DROP_STATS_TTL_MS":      "-5",
		"LA_PLUMA_ASSET_WEBP_CONCURRENCY": "0",
	}
	tuning := LoadTuning(func(key string) string { return env[key] })
	want := DefaultTuning()
	if tuning != want {
		t.Fatalf("tuning = %#v, want %#v", tuning, want)
	}
}
