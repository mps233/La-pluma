package webrtc

import (
	"io"
	"log/slog"
	"net"
	"os"

	"github.com/pion/turn/v5"
	"path/filepath"
	"strconv"
	"testing"
	"time"
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

func TestEmbeddedTURNAllocatesRelay(t *testing.T) {
	probe, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := probe.LocalAddr().(*net.UDPAddr).Port
	_ = probe.Close()
	t.Setenv("LA_PLUMA_WEBRTC_TURN_PORT", strconv.Itoa(port))
	t.Setenv("LA_PLUMA_WEBRTC_TURN_PUBLIC_IP", "127.0.0.1")
	t.Setenv("LA_PLUMA_WEBRTC_TURN_USERNAME", "test-user")
	t.Setenv("LA_PLUMA_WEBRTC_TURN_PASSWORD", "test-pass")

	service := &Service{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	service.ensureTURN()
	t.Cleanup(service.stopTURN)
	credentials := service.turnCredentials
	if credentials == nil {
		t.Fatal("TURN did not start")
	}

	echo, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer echo.Close()
	go func() {
		buffer := make([]byte, 64)
		n, address, readErr := echo.ReadFrom(buffer)
		if readErr == nil {
			_, _ = echo.WriteTo(append([]byte("echo:"), buffer[:n]...), address)
		}
	}()

	conn, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	client, err := turn.NewClient(&turn.ClientConfig{
		STUNServerAddr: net.JoinHostPort("127.0.0.1", strconv.Itoa(port)),
		TURNServerAddr: net.JoinHostPort("127.0.0.1", strconv.Itoa(port)),
		Username:       credentials.username,
		Password:       credentials.password,
		Realm:          turnRealm,
		Conn:           conn,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if err := client.Listen(); err != nil {
		t.Fatal(err)
	}
	relay, err := client.Allocate()
	if err != nil {
		t.Fatal(err)
	}
	defer relay.Close()

	if _, err := relay.WriteTo([]byte("ping"), echo.LocalAddr()); err != nil {
		t.Fatal(err)
	}
	_ = relay.SetReadDeadline(time.Now().Add(5 * time.Second))
	buffer := make([]byte, 64)
	n, _, err := relay.ReadFrom(buffer)
	if err != nil {
		t.Fatal(err)
	}
	if string(buffer[:n]) != "echo:ping" {
		t.Fatalf("reply = %q", buffer[:n])
	}
}
