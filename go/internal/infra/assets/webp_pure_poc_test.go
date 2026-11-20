package assets

import (
	"bytes"
	"image"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"testing"
	"time"

	webp "github.com/SeriousBug/webp-go-pure/std"
)

// TestPureGoWebPPoCReport is an opt-in measurement over real MaaResource
// assets. It is skipped in normal runs; set both directories to produce the
// size/time table used to decide whether the encoder is worth adopting.
func TestPureGoWebPPoCReport(t *testing.T) {
	itemsDir := os.Getenv("LA_PLUMA_WEBP_ITEMS_DIR")
	avatarsDir := os.Getenv("LA_PLUMA_WEBP_AVATARS_DIR")
	if itemsDir == "" && avatarsDir == "" {
		t.Skip("set LA_PLUMA_WEBP_ITEMS_DIR and/or LA_PLUMA_WEBP_AVATARS_DIR")
	}
	limit := 100
	if raw := os.Getenv("LA_PLUMA_WEBP_SAMPLE_LIMIT"); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			limit = value
		}
	}

	if itemsDir != "" {
		reportPureGoWebPSamples(t, "items/lossless-e6", itemsDir, limit, &webp.Options{Lossless: true, Effort: 6})
		reportPureGoWebPSamples(t, "items/lossy-q90", itemsDir, limit, &webp.Options{Quality: 90, Effort: webp.EffortFastest})
		reportPureGoWebPSamples(t, "items/lossy-q95", itemsDir, limit, &webp.Options{Quality: 95, Effort: webp.EffortFastest})
	}
	if avatarsDir != "" {
		reportPureGoWebPSamples(t, "avatars/lossy-q80", avatarsDir, limit, &webp.Options{Quality: 80, Effort: webp.EffortFastest})
		reportPureGoWebPSamples(t, "avatars/lossy-q90", avatarsDir, limit, &webp.Options{Quality: 90, Effort: webp.EffortFastest})
		reportPureGoWebPSamples(t, "avatars/lossy-q95", avatarsDir, limit, &webp.Options{Quality: 95, Effort: webp.EffortFastest})
		reportPureGoWebPSamples(t, "avatars/lossless-e6", avatarsDir, limit, &webp.Options{Lossless: true, Effort: 6})
	}
}

func reportPureGoWebPSamples(t *testing.T, label, dir string, limit int, options *webp.Options) {
	t.Helper()
	files, err := listPNGs(dir, limit)
	if err != nil {
		t.Errorf("%s: list %s: %v", label, dir, err)
		return
	}
	if len(files) == 0 {
		t.Logf("%s: no PNG files under %s", label, dir)
		return
	}

	var pngBytes, webpBytes int64
	var durations []time.Duration
	var psnrTotal float64
	psnrCount := 0
	var alphaMismatches int64
	failures := 0
	for _, path := range files {
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			failures++
			continue
		}
		img, decodeErr := png.Decode(bytes.NewReader(raw))
		if decodeErr != nil {
			failures++
			continue
		}
		start := time.Now()
		data, encodeErr := webp.EncodeBytes(img, options)
		durations = append(durations, time.Since(start))
		if encodeErr != nil || len(data) == 0 {
			failures++
			continue
		}
		pngBytes += int64(len(raw))
		webpBytes += int64(len(data))
		if !options.Lossless {
			decoded, decodeErr := webp.Decode(bytes.NewReader(data))
			if decodeErr == nil {
				mse, alphaDiff, compared := rgbaMSE(toNRGBA(img), toNRGBA(decoded))
				if compared > 0 {
					alphaMismatches += alphaDiff
					if mse == 0 {
						psnrTotal += 99
					} else {
						psnrTotal += 10 * math.Log10(255*255/mse)
					}
					psnrCount++
				}
			}
		}
	}

	if len(durations) == 0 {
		t.Logf("%s: all %d samples failed", label, failures)
		return
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	median := durations[len(durations)/2]
	p95 := durations[(len(durations)-1)*95/100]
	maxDuration := durations[len(durations)-1]
	ratio := float64(webpBytes) / float64(pngBytes) * 100
	t.Logf("%s: n=%d failures=%d png=%.2f MiB webp=%.2f MiB ratio=%.2f%% median=%s p95=%s max=%s",
		label, len(files), failures,
		float64(pngBytes)/(1<<20), float64(webpBytes)/(1<<20), ratio,
		median.Round(time.Microsecond), p95.Round(time.Microsecond), maxDuration.Round(time.Microsecond),
	)
	if psnrCount > 0 {
		t.Logf("%s: psnr=%.2f dB alphaMismatches=%d", label, psnrTotal/float64(psnrCount), alphaMismatches)
	}
}

func toNRGBA(img image.Image) *image.NRGBA {
	bounds := img.Bounds()
	converted := image.NewNRGBA(bounds)
	draw.Draw(converted, bounds, img, bounds.Min, draw.Src)
	return converted
}

func rgbaMSE(a, b *image.NRGBA) (mse float64, alphaDiff int64, compared int64) {
	bounds := a.Bounds().Intersect(b.Bounds())
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			ai := a.PixOffset(x, y)
			bi := b.PixOffset(x, y)
			if a.Pix[ai+3] != b.Pix[bi+3] {
				alphaDiff++
			}
			// Compare color only where the source is visible. RGB values under
			// fully transparent pixels are not meaningful and would dominate
			// the error without being visible.
			if a.Pix[ai+3] == 0 {
				continue
			}
			for channel := 0; channel < 3; channel++ {
				diff := float64(a.Pix[ai+channel]) - float64(b.Pix[bi+channel])
				mse += diff * diff
			}
			compared++
		}
	}
	if compared > 0 {
		mse /= float64(compared * 3)
	}
	return mse, alphaDiff, compared
}

func listPNGs(dir string, limit int) ([]string, error) {
	var files []string
	err := filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".png" {
			return nil
		}
		files = append(files, path)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	if limit > 0 && len(files) > limit {
		files = files[:limit]
	}
	return files, nil
}
