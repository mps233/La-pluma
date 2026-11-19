package skland

import (
	"testing"
	"time"
)

func TestBuildSanityPrefersRecoveryCountdown(t *testing.T) {
	current := 13
	max := 210
	complete := time.Now().Add(191 * 6 * time.Minute).Unix()
	state := buildSanity(&current, &max, &complete)
	if state == nil {
		t.Fatal("missing sanity")
	}
	if state.Current < 18 || state.Current > 20 {
		t.Fatalf("stale current should fall back to countdown, got %+v", state)
	}
	if state.Max != 210 {
		t.Fatalf("max = %d", state.Max)
	}
}
