package assetsapi

import (
	"bytes"
	"errors"
	"net/http"
	"sync"
	"testing"

	webp "github.com/SeriousBug/webp-go-pure/std"

	"github.com/mps233/la-pluma/go/internal/infra/assets"
)

type fakeEncoder struct {
	mu    sync.Mutex
	calls int
	data  []byte
	err   error
}

func (e *fakeEncoder) Encode(string) ([]byte, error) {
	e.mu.Lock()
	e.calls++
	e.mu.Unlock()
	if e.err != nil {
		return nil, e.err
	}
	return e.data, nil
}

func (e *fakeEncoder) callCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.calls
}

func TestHandlerWebPConversionAndCache(t *testing.T) {
	root := createResourceFixture(t)
	encoder := &fakeEncoder{data: []byte("fake-webp-bytes")}
	handler := mountedHandler(root, assets.Config{
		WebPEncoder: encoder,
		LoadItemAssetMap: func(string) (map[string]string, error) {
			return map[string]string{}, nil
		},
	})

	webpResponse := getAsset(t, handler, "/api/maa-assets/item/30012", map[string]string{
		"Accept": "image/avif,image/webp,*/*",
	})
	if webpResponse.Code != http.StatusOK {
		t.Fatalf("webp status = %d", webpResponse.Code)
	}
	if webpResponse.Header().Get("Content-Type") != "image/webp" {
		t.Fatalf("content type = %q", webpResponse.Header().Get("Content-Type"))
	}
	if webpResponse.Body.String() != "fake-webp-bytes" {
		t.Fatalf("body = %q", webpResponse.Body.String())
	}

	second := getAsset(t, handler, "/api/maa-assets/item/30012", map[string]string{"Accept": "image/webp"})
	if second.Code != http.StatusOK || second.Body.String() != "fake-webp-bytes" {
		t.Fatalf("cached response = %d %q", second.Code, second.Body.String())
	}
	if calls := encoder.callCount(); calls != 1 {
		t.Fatalf("encoder calls = %d, want 1", calls)
	}

	png := getAsset(t, handler, "/api/maa-assets/item/30012", nil)
	if png.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("png content type = %q", png.Header().Get("Content-Type"))
	}
	if png.Body.Len() != len(tinyPNG) {
		t.Fatalf("png body length = %d", png.Body.Len())
	}
	if calls := encoder.callCount(); calls != 1 {
		t.Fatalf("PNG request should not encode, calls = %d", calls)
	}
}

func TestHandlerWebPFailureFallsBackToPNG(t *testing.T) {
	root := createResourceFixture(t)
	encoder := &fakeEncoder{err: errors.New("no encoder")}
	handler := mountedHandler(root, assets.Config{
		WebPEncoder: encoder,
		LoadItemAssetMap: func(string) (map[string]string, error) {
			return map[string]string{}, nil
		},
	})

	recorder := getAsset(t, handler, "/api/maa-assets/avatar/char_002_amiya", map[string]string{"Accept": "image/webp"})
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if recorder.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("content type = %q", recorder.Header().Get("Content-Type"))
	}
	if recorder.Body.Len() != len(tinyPNG) {
		t.Fatalf("body length = %d", recorder.Body.Len())
	}
	if encoder.callCount() != 1 {
		t.Fatalf("encoder calls = %d", encoder.callCount())
	}
}

func TestHandlerServesPureGoWebP(t *testing.T) {
	root := createResourceFixture(t)
	handler := mountedHandler(root, assets.Config{
		WebPEncoder: assets.NewPureGoWebPEncoder(),
		LoadItemAssetMap: func(string) (map[string]string, error) {
			return map[string]string{}, nil
		},
	})

	response := getAsset(t, handler, "/api/maa-assets/item/30012", map[string]string{
		"Accept": "image/webp",
	})
	if response.Code != 200 {
		t.Fatalf("status = %d", response.Code)
	}
	if response.Header().Get("Content-Type") != "image/webp" {
		t.Fatalf("content type = %q", response.Header().Get("Content-Type"))
	}
	if response.Body.Len() < 12 || string(response.Body.Bytes()[8:12]) != "WEBP" {
		t.Fatalf("handler body is not WebP: %q", response.Body.Bytes()[:min(response.Body.Len(), 16)])
	}
	if _, err := webp.Decode(bytes.NewReader(response.Body.Bytes())); err != nil {
		t.Fatalf("handler returned an undecodable WebP: %v", err)
	}
}

func TestHandlerSkipsWebPWhenLargerThanPNG(t *testing.T) {
	root := createResourceFixture(t)
	encoder := &fakeEncoder{data: bytes.Repeat([]byte("x"), len(tinyPNG)+64)}
	handler := mountedHandler(root, assets.Config{
		WebPEncoder: encoder,
		LoadItemAssetMap: func(string) (map[string]string, error) {
			return map[string]string{}, nil
		},
	})

	response := getAsset(t, handler, "/api/maa-assets/item/30012", map[string]string{
		"Accept": "image/webp",
	})
	if response.Code != 200 {
		t.Fatalf("status = %d", response.Code)
	}
	if got := response.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("content type = %q, want image/png", got)
	}
	if response.Body.Len() != len(tinyPNG) {
		t.Fatalf("body length = %d, want %d", response.Body.Len(), len(tinyPNG))
	}
}
