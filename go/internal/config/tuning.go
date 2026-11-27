package config

import (
	"math"
	"strconv"
	"strings"
	"time"
)

// Tuning holds optional runtime knobs that were previously read from the
// environment inside feature services. Parsing and defaults live here; services
// receive the resolved values through their options.
type Tuning struct {
	BattleOCRDisabled    bool
	BattleOCRInterval    time.Duration
	MasteryTick          time.Duration
	DropStatsTTL         time.Duration
	TimeZone             string
	AssetWebPDisabled    bool
	AssetWebPConcurrency int
	ScrcpyServerPath     string
	ScrcpyServerVersion  string
	WebRTCDeviceID       string
}

const (
	defaultBattleOCRInterval = 5 * time.Second
	minBattleOCRInterval     = 2 * time.Second
	maxBattleOCRInterval     = 60 * time.Second
	defaultMasteryTick       = 60 * time.Second
	defaultDropStatsTTL      = 30 * time.Second
	defaultTimeZone          = "Asia/Shanghai"
	defaultWebPConcurrency   = 4
	maxWebPConcurrency       = 16
	defaultScrcpyVersion     = "5.0.1"
	defaultWebRTCDeviceID    = "mumu-la-pluma"
)

// DefaultTuning is the zero-environment configuration.
func DefaultTuning() Tuning {
	return Tuning{
		BattleOCRInterval:    defaultBattleOCRInterval,
		MasteryTick:          defaultMasteryTick,
		DropStatsTTL:         defaultDropStatsTTL,
		TimeZone:             defaultTimeZone,
		AssetWebPConcurrency: defaultWebPConcurrency,
		ScrcpyServerVersion:  defaultScrcpyVersion,
		WebRTCDeviceID:       defaultWebRTCDeviceID,
	}
}

// LoadTuning resolves the optional knobs. Invalid values fall back to the
// defaults; battle OCR and mastery intervals are clamped like the Node service.
func LoadTuning(getenv Getenv) Tuning {
	tuning := DefaultTuning()
	if getenv == nil {
		return tuning
	}
	read := func(key string) string {
		return strings.TrimSpace(getenv(key))
	}

	switch strings.ToLower(read("LA_PLUMA_BATTLE_OCR")) {
	case "0", "false", "off":
		tuning.BattleOCRDisabled = true
	}
	if raw := read("LA_PLUMA_BATTLE_OCR_INTERVAL_MS"); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil {
			interval := time.Duration(value) * time.Millisecond
			if interval < minBattleOCRInterval {
				interval = minBattleOCRInterval
			}
			if interval > maxBattleOCRInterval {
				interval = maxBattleOCRInterval
			}
			tuning.BattleOCRInterval = interval
		}
	}

	if raw := read("LA_PLUMA_MASTERY_TICK_MS"); raw != "" {
		if value, err := strconv.ParseFloat(raw, 64); err == nil && !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 1000 {
			tuning.MasteryTick = time.Duration(int64(value)) * time.Millisecond
		}
	}

	if raw := read("LA_PLUMA_DROP_STATS_TTL_MS"); raw != "" {
		if value, err := strconv.ParseFloat(raw, 64); err == nil && !math.IsNaN(value) && value >= 0 {
			tuning.DropStatsTTL = time.Duration(math.Trunc(value)) * time.Millisecond
		}
	}

	if value := read("TZ"); value != "" {
		tuning.TimeZone = value
	}

	tuning.AssetWebPDisabled = read("LA_PLUMA_ASSET_WEBP_GO") == "0"
	if raw := read("LA_PLUMA_ASSET_WEBP_CONCURRENCY"); raw != "" {
		if value, err := strconv.ParseFloat(raw, 64); err == nil && !math.IsNaN(value) && !math.IsInf(value, 0) && value > 0 {
			concurrency := int(math.Trunc(value))
			if concurrency < 1 {
				concurrency = 1
			}
			if concurrency > maxWebPConcurrency {
				concurrency = maxWebPConcurrency
			}
			tuning.AssetWebPConcurrency = concurrency
		}
	}

	if value := read("LA_PLUMA_SCRCPY_SERVER_PATH"); value != "" {
		tuning.ScrcpyServerPath = value
	}
	if value := read("LA_PLUMA_SCRCPY_SERVER_VERSION"); value != "" {
		tuning.ScrcpyServerVersion = value
	}
	if value := read("LA_PLUMA_WEBRTC_DEVICE_ID"); value != "" {
		tuning.WebRTCDeviceID = value
	}
	return tuning
}
