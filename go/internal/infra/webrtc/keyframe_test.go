package webrtc

import (
	"strings"
	"testing"

	"github.com/pion/rtcp"
)

func TestKeyframeRequestCoalescesBursts(t *testing.T) {
	p := &Publisher{}
	if !p.beginKeyframeRequest() {
		t.Fatal("first request should be admitted")
	}
	if p.beginKeyframeRequest() {
		t.Fatal("second request should be coalesced")
	}
	p.endKeyframeRequest()
	if !p.beginKeyframeRequest() {
		t.Fatal("request after completion should be admitted")
	}
	p.endKeyframeRequest()
}

func TestRTCPWantsKeyframe(t *testing.T) {
	cases := []struct {
		name   string
		packet rtcp.Packet
		want   bool
	}{
		{"pli", &rtcp.PictureLossIndication{MediaSSRC: 1}, true},
		{"fir", &rtcp.FullIntraRequest{MediaSSRC: 1}, true},
		{"receiver report", &rtcp.ReceiverReport{}, false},
		{"sender report", &rtcp.SenderReport{}, false},
	}
	for _, tc := range cases {
		if got := rtcpWantsKeyframe([]rtcp.Packet{tc.packet}); got != tc.want {
			t.Fatalf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
	if rtcpWantsKeyframe(nil) {
		t.Fatal("empty packet list should not request a keyframe")
	}
}

func TestApplyProfileLevelReplacesAnyLevel(t *testing.T) {
	p := &Publisher{profileLevel: "42c029"}
	sdp := "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f\r\n"
	got := p.applyProfileLevel(sdp)
	if !strings.Contains(got, "profile-level-id=42c029") {
		t.Fatalf("profile level not applied: %s", got)
	}
	if strings.Contains(got, "42001f") {
		t.Fatalf("stale level left in SDP: %s", got)
	}

	empty := &Publisher{}
	if got := empty.applyProfileLevel(sdp); got != sdp {
		t.Fatalf("empty profile should leave SDP untouched")
	}
}
