package webrtc

import (
	"io"
	"log/slog"
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
