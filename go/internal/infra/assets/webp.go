package assets

import (
	"container/list"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"sync"
)

const (
	defaultWebPMaxEntries  = 256
	defaultWebPMaxBytes    = 64 << 20
	defaultWebPConcurrency = 4
	maxWebPConcurrency     = 16
)

// WebPEncoder converts a PNG on disk to WebP bytes. The Node server uses sharp;
// a pure-Go build has no lossy WebP encoder in the standard library, so the
// interface is optional and a nil encoder safely serves the original PNG.
type WebPEncoder interface {
	Encode(sourcePath string) ([]byte, error)
}

// maxWebPConcurrencyFromEnv mirrors LA_PLUMA_ASSET_WEBP_CONCURRENCY: a finite
// positive value is truncated and clamped to 16, anything else uses 4.
func maxWebPConcurrencyFromEnv() int {
	raw := strings.TrimSpace(os.Getenv("LA_PLUMA_ASSET_WEBP_CONCURRENCY"))
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
		return defaultWebPConcurrency
	}
	concurrency := int(math.Trunc(value))
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > maxWebPConcurrency {
		concurrency = maxWebPConcurrency
	}
	return concurrency
}

type webPCacheEntry struct {
	key  string
	data []byte
}

// webPCache keeps converted variants in memory with entry and byte limits. It
// also single-flights concurrent conversions of the same source version and
// bounds how many encoders run at once.
type webPCache struct {
	encoder    WebPEncoder
	maxEntries int
	maxBytes   int64

	mu      sync.Mutex
	entries map[string]*list.Element
	order   *list.List
	bytes   int64
	pending map[string]chan struct{}

	sem chan struct{}
}

func newWebPCache(encoder WebPEncoder, maxEntries int, maxBytes int64, concurrency int) *webPCache {
	if encoder == nil {
		return nil
	}
	if maxEntries <= 0 {
		maxEntries = defaultWebPMaxEntries
	}
	if maxBytes <= 0 {
		maxBytes = defaultWebPMaxBytes
	}
	if concurrency <= 0 {
		concurrency = maxWebPConcurrencyFromEnv()
	}
	if concurrency > maxWebPConcurrency {
		concurrency = maxWebPConcurrency
	}
	return &webPCache{
		encoder:    encoder,
		maxEntries: maxEntries,
		maxBytes:   maxBytes,
		entries:    make(map[string]*list.Element),
		order:      list.New(),
		pending:    make(map[string]chan struct{}),
		sem:        make(chan struct{}, concurrency),
	}
}

func (c *webPCache) variant(sourcePath string, info os.FileInfo) ([]byte, error) {
	key := webPCacheKey(sourcePath, info)

	c.mu.Lock()
	if data := c.touchLocked(key); data != nil {
		c.mu.Unlock()
		return data, nil
	}
	if wait, ok := c.pending[key]; ok {
		c.mu.Unlock()
		<-wait
		c.mu.Lock()
		data := c.touchLocked(key)
		c.mu.Unlock()
		return data, nil
	}
	done := make(chan struct{})
	c.pending[key] = done
	c.mu.Unlock()

	c.sem <- struct{}{}
	data, err := c.encoder.Encode(sourcePath)
	<-c.sem

	c.mu.Lock()
	delete(c.pending, key)
	if err == nil && len(data) > 0 {
		// Serve an oversized variant but do not let it enter the cache.
		if int64(len(data)) <= c.maxBytes {
			c.putLocked(key, data)
		}
	} else {
		data = nil
	}
	c.mu.Unlock()
	close(done)

	return data, err
}

func (c *webPCache) touchLocked(key string) []byte {
	element, ok := c.entries[key]
	if !ok {
		return nil
	}
	c.order.MoveToFront(element)
	return element.Value.(*webPCacheEntry).data
}

func (c *webPCache) putLocked(key string, data []byte) {
	if existing, ok := c.entries[key]; ok {
		entry := existing.Value.(*webPCacheEntry)
		c.bytes -= int64(len(entry.data))
		entry.data = data
		c.bytes += int64(len(data))
		c.order.MoveToFront(existing)
	} else {
		element := c.order.PushFront(&webPCacheEntry{key: key, data: data})
		c.entries[key] = element
		c.bytes += int64(len(data))
	}

	for c.order.Len() > c.maxEntries || c.bytes > c.maxBytes {
		oldest := c.order.Back()
		if oldest == nil {
			break
		}
		entry := oldest.Value.(*webPCacheEntry)
		c.order.Remove(oldest)
		delete(c.entries, entry.key)
		c.bytes -= int64(len(entry.data))
	}
}

func webPCacheKey(sourcePath string, info os.FileInfo) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf(
		"%s\x00%d\x00%d",
		sourcePath,
		info.ModTime().UnixNano(),
		info.Size(),
	)))
	return hex.EncodeToString(digest[:])
}
