package webrtc

import (
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestStatusReportsScrcpyServerAvailability(t *testing.T) {
	missing := &Service{serverPath: filepath.Join(t.TempDir(), "missing-scrcpy-server")}
	if status := missing.Status(); status["installed"] != false || status["built"] != false {
		t.Fatalf("missing component status = %#v", status)
	}

	path := filepath.Join(t.TempDir(), "scrcpy-server")
	if err := os.WriteFile(path, []byte("jar"), 0o600); err != nil {
		t.Fatal(err)
	}
	present := &Service{serverPath: path}
	if status := present.Status(); status["installed"] != true || status["built"] != true {
		t.Fatalf("present component status = %#v", status)
	}
}

func TestICEServersEmptyBeforeTURNStarts(t *testing.T) {
	service := &Service{}
	if servers := service.ICEServers(); len(servers) != 0 {
		t.Fatalf("ice servers = %#v", servers)
	}
}

func TestEmbeddedTURNServesCredentials(t *testing.T) {
	probe, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := probe.LocalAddr().(*net.UDPAddr).Port
	_ = probe.Close()
	t.Setenv("LA_PLUMA_WEBRTC_TURN_PORT", strconv.Itoa(port))
	t.Setenv("LA_PLUMA_WEBRTC_TURN_PUBLIC_IP", "127.0.0.1")

	service := &Service{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	service.ensureTURN()
	t.Cleanup(service.stopTURN)
	servers := service.ICEServers()
	if len(servers) != 1 {
		t.Fatalf("ice servers = %#v", servers)
	}
	entry, _ := servers[0].(map[string]any)
	urls, _ := entry["urls"].([]string)
	if len(urls) != 2 || entry["username"] == "" || entry["credential"] == "" {
		t.Fatalf("ice entry = %#v", entry)
	}
}
