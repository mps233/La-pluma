package webrtc

import (
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/infra/scrcpy"
)

func TestCreateOfferCompletes(t *testing.T) {
	publisher, err := New(&scrcpy.Session{Width: 1280, Height: 720}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	defer publisher.Close()
	type result struct {
		sdp string
		err error
	}
	done := make(chan result, 1)
	go func() {
		sdp, _, err := publisher.CreateOffer("test")
		done <- result{sdp: sdp, err: err}
	}()
	select {
	case got := <-done:
		if got.err != nil {
			t.Fatal(got.err)
		}
		if len(got.sdp) < 100 {
			t.Fatalf("offer too short: %q", got.sdp)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("CreateOffer timed out")
	}
}

func TestSPSProfileLevelID(t *testing.T) {
	config := []byte{
		0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x29, 0xaa, 0xbb,
		0, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80,
	}
	if got := spsProfileLevelID(config); got != "42c029" {
		t.Fatalf("profile-level-id = %q", got)
	}
	if got := spsProfileLevelID([]byte{0, 0, 0, 1, 0x68, 0xce}); got != "" {
		t.Fatalf("missing SPS should be empty, got %q", got)
	}
}

func TestApplyProfileLevel(t *testing.T) {
	publisher := &Publisher{profileLevel: "42c029"}
	sdp := "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f\r\n"
	got := publisher.applyProfileLevel(sdp)
	if !strings.Contains(got, "profile-level-id=42c029") {
		t.Fatalf("profile-level-id not applied: %q", got)
	}
	publisher.profileLevel = ""
	if got := publisher.applyProfileLevel(sdp); got != sdp {
		t.Fatalf("empty profile should leave SDP unchanged: %q", got)
	}
}
