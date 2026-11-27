package config

import (
	"math"
	"os"
	"runtime"
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
	ADBPath              string
	ADBAddress           string
	MAAClientType        string
	IsDocker             bool
	TurnDisabled         bool
	TurnPort             int
	TurnUsername         string
	TurnPassword         string
	TurnPublicIP         string
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
	defaultADBAddress        = "127.0.0.1:16384"
	defaultMAAClientType     = "Official"
	defaultTURNPort          = 3478
	defaultTURNUsername      = "la-pluma"
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
		ADBPath:              platformADBPath(),
		ADBAddress:           defaultADBAddress,
		MAAClientType:        defaultMAAClientType,
		TurnPort:             defaultTURNPort,
		TurnUsername:         defaultTURNUsername,
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
	if value := read("ADB_PATH"); value != "" {
		tuning.ADBPath = value
	}
	if value := read("ADB_ADDRESS"); value != "" {
		tuning.ADBAddress = value
	}
	if value := read("MAA_CLIENT_TYPE"); value != "" {
		tuning.MAAClientType = value
	}
	tuning.IsDocker = DetectDocker(getenv)
	if read("LA_PLUMA_WEBRTC_TURN_DISABLED") == "1" {
		tuning.TurnDisabled = true
	}
	if raw := read("LA_PLUMA_WEBRTC_TURN_PORT"); raw != "" {
		if port, err := strconv.Atoi(raw); err == nil && port > 0 && port < 65536 {
			tuning.TurnPort = port
		}
	}
	if value := read("LA_PLUMA_WEBRTC_TURN_USERNAME"); value != "" {
		tuning.TurnUsername = value
	}
	if value := read("LA_PLUMA_WEBRTC_TURN_PASSWORD"); value != "" {
		tuning.TurnPassword = value
	}
	if value := read("LA_PLUMA_WEBRTC_TURN_PUBLIC_IP"); value != "" {
		tuning.TurnPublicIP = value
	}
	return tuning
}

// DetectDocker reports whether the process runs inside a container. Docker
// writes /.dockerenv; DOCKER_ENV is an explicit override for compatible
// runtimes that do not.
func DetectDocker(getenv Getenv) bool {
	if getenv != nil && strings.TrimSpace(getenv("DOCKER_ENV")) != "" {
		return true
	}
	_, err := os.Stat("/.dockerenv")
	return err == nil
}

func platformADBPath() string {
	if runtime.GOOS == "darwin" {
		return "/opt/homebrew/bin/adb"
	}
	return "adb"
}
