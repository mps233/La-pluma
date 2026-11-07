package assets

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type fakeEncoder struct {
	mu        sync.Mutex
	calls     int
	active    int
	maxActive int
	data      []byte
	err       error
	delay     time.Duration
}

func (e *fakeEncoder) Encode(string) ([]byte, error) {
	e.mu.Lock()
	e.calls++
	e.active++
	if e.active > e.maxActive {
		e.maxActive = e.active
	}
	e.mu.Unlock()

	if e.delay > 0 {
		time.Sleep(e.delay)
	}

	e.mu.Lock()
	e.active--
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

func (e *fakeEncoder) peakConcurrency() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.maxActive
}

func writeFixtureFile(t *testing.T, root, name string) string {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.WriteFile(path, tinyPNG, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestHandlerWebPConversionAndCache(t *testing.T) {
	root := createResourceFixture(t)
	encoder := &fakeEncoder{data: []byte("fake-webp-bytes")}
	handler := mountedHandler(root, Config{
		WebPEncoder: encoder,
		LoadItemAssetMap: func(string) (map[string]string, error) {
			return map[string]string{}, nil
		},
	})

	webp := getAsset(t, handler, "/api/maa-assets/item/30012", map[string]string{
		"Accept": "image/avif,image/webp,*/*",
	})
	if webp.Code != http.StatusOK {
		t.Fatalf("webp status = %d", webp.Code)
	}
	if webp.Header().Get("Content-Type") != "image/webp" {
		t.Fatalf("content type = %q", webp.Header().Get("Content-Type"))
	}
	if webp.Body.String() != "fake-webp-bytes" {
		t.Fatalf("body = %q", webp.Body.String())
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
	handler := mountedHandler(root, Config{
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

func TestWebPCacheEviction(t *testing.T) {
	root := t.TempDir()
	fileA := writeFixtureFile(t, root, "a.png")
	fileB := writeFixtureFile(t, root, "b.png")
	infoA, err := os.Stat(fileA)
	if err != nil {
		t.Fatal(err)
	}
	infoB, err := os.Stat(fileB)
	if err != nil {
		t.Fatal(err)
	}

	encoder := &fakeEncoder{data: []byte("1234")}
	cache := newWebPCache(encoder, 1, 1024, 1)
	if data, err := cache.variant(fileA, infoA); err != nil || string(data) != "1234" {
		t.Fatalf("first variant = %q, %v", data, err)
	}
	if _, err := cache.variant(fileB, infoB); err != nil {
		t.Fatal(err)
	}
	if calls := encoder.callCount(); calls != 2 {
		t.Fatalf("calls after two files = %d", calls)
	}

	// Entry A was evicted by the entry limit, so it converts again.
	if _, err := cache.variant(fileA, infoA); err != nil {
		t.Fatal(err)
	}
	if calls := encoder.callCount(); calls != 3 {
		t.Fatalf("calls after re-request = %d, want 3", calls)
	}

	// A variant larger than the byte budget is returned but never cached.
	tight := newWebPCache(&fakeEncoder{data: []byte("12345")}, 10, 2, 1)
	if _, err := tight.variant(fileA, infoA); err != nil {
		t.Fatal(err)
	}
	if _, err := tight.variant(fileA, infoA); err != nil {
		t.Fatal(err)
	}
	if calls := tight.encoder.(*fakeEncoder).callCount(); calls != 2 {
		t.Fatalf("oversized variant cached, calls = %d", calls)
	}
}

func TestWebPCacheSingleFlightAndConcurrency(t *testing.T) {
	root := t.TempDir()
	encoder := &fakeEncoder{data: []byte("webp"), delay: 10 * time.Millisecond}
	cache := newWebPCache(encoder, 64, 1<<20, 2)

	file := writeFixtureFile(t, root, "same.png")
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}

	var waitGroup sync.WaitGroup
	for index := 0; index < 8; index++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			if _, err := cache.variant(file, info); err != nil {
				t.Errorf("variant: %v", err)
			}
		}()
	}
	waitGroup.Wait()
	if calls := encoder.callCount(); calls != 1 {
		t.Fatalf("single-flight calls = %d, want 1", calls)
	}

	var files []string
	var infos []os.FileInfo
	for index := 0; index < 8; index++ {
		path := writeFixtureFile(t, root, "unique-"+string(rune('a'+index))+".png")
		fileInfo, statErr := os.Stat(path)
		if statErr != nil {
			t.Fatal(statErr)
		}
		files = append(files, path)
		infos = append(infos, fileInfo)
	}

	encoder.mu.Lock()
	encoder.calls = 0
	encoder.maxActive = 0
	encoder.delay = 20 * time.Millisecond
	encoder.mu.Unlock()

	for index := range files {
		waitGroup.Add(1)
		go func(index int) {
			defer waitGroup.Done()
			if _, err := cache.variant(files[index], infos[index]); err != nil {
				t.Errorf("variant: %v", err)
			}
		}(index)
	}
	waitGroup.Wait()

	if peak := encoder.peakConcurrency(); peak > 2 {
		t.Fatalf("peak concurrency = %d, want <= 2", peak)
	}
	if calls := encoder.callCount(); calls != 8 {
		t.Fatalf("unique conversion calls = %d, want 8", calls)
	}
}
