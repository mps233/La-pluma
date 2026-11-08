package signaling

import (
	"testing"

	scwebrtc "github.com/mps233/la-pluma/go/internal/infra/webrtc"
)

func TestSetICEServers(t *testing.T) {
	server := New(func() *scwebrtc.Publisher { return nil }, nil)
	if servers := server.iceServers(); len(servers) != 0 {
		t.Fatalf("default ice servers = %#v", servers)
	}
	server.SetICEServers(func() []any {
		return []any{map[string]any{"urls": []string{"stun:127.0.0.1:3478"}}}
	})
	servers := server.iceServers()
	if len(servers) != 1 {
		t.Fatalf("ice servers = %#v", servers)
	}
}
