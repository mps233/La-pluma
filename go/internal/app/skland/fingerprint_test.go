package skland

import "testing"

func TestSensebotPublicKeyParses(t *testing.T) {
	key, err := parseSensebotPublicKey()
	if err != nil {
		t.Fatalf("parse sensebot key: %v", err)
	}
	if key == nil || key.N == nil || key.N.BitLen() < 512 {
		t.Fatalf("unexpected sensebot public key")
	}
}

func TestSensebotTargetIsOrderedAndSignable(t *testing.T) {
	target := buildSensebotTarget("00000000-0000-4000-8000-000000000000")
	if len(target) < 20 {
		t.Fatalf("target too short: %d", len(target))
	}
	if target[len(target)-1].Key != "tn" {
		t.Fatalf("tn must be last, got %s", target[len(target)-1].Key)
	}
	if got := sensebotTN(target[:len(target)-1]); got == "" {
		t.Fatal("empty tn")
	}
}
