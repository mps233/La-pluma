package webrtc

import (
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
