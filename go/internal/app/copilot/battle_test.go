package copilot

import (
	"testing"
	"time"
)

func TestBattleProgressEnabled(t *testing.T) {
	t.Setenv("LA_PLUMA_BATTLE_OCR", "")
	if !BattleProgressEnabled() {
		t.Fatal("battle progress must be enabled by default")
	}
	for _, value := range []string{"0", "false", "off", "OFF"} {
		t.Setenv("LA_PLUMA_BATTLE_OCR", value)
		if BattleProgressEnabled() {
			t.Fatalf("value %q must disable battle progress", value)
		}
	}
	t.Setenv("LA_PLUMA_BATTLE_OCR", "1")
	if !BattleProgressEnabled() {
		t.Fatal("value 1 must enable battle progress")
	}
}

func TestBattleProgressIntervalClampsEnvironment(t *testing.T) {
	cases := []struct {
		value string
		want  time.Duration
	}{
		{"", 5 * time.Second},
		{"1000", 2 * time.Second},
		{"5000", 5 * time.Second},
		{"999999", 60 * time.Second},
		{"not-a-number", 5 * time.Second},
	}
	for _, testCase := range cases {
		t.Setenv("LA_PLUMA_BATTLE_OCR_INTERVAL_MS", testCase.value)
		if got := BattleProgressInterval(); got != testCase.want {
			t.Fatalf("interval for %q = %s, want %s", testCase.value, got, testCase.want)
		}
	}
}
