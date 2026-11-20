package assets

import (
	"fmt"
	"image/png"
	"os"
	"path/filepath"
	"strings"

	webp "github.com/SeriousBug/webp-go-pure/std"
)

// PureGoWebPEncoder is a CGO-free WebP encoder for the /api/maa-assets
// endpoints. It is enabled by default; real-asset measurements live in the
// opt-in PoC report test.
//
// Item icons are flat graphics with alpha, so lossless is the safe default for
// them. Avatar thumbnails use lossy color at Q90 while keeping their alpha
// channel.
type PureGoWebPEncoder struct {
	ItemLossless   bool
	ItemQuality    int
	ItemEffort     int
	AvatarLossless bool
	AvatarQuality  int
	AvatarEffort   int
}

// NewPureGoWebPEncoder returns the default encoder configuration.
func NewPureGoWebPEncoder() *PureGoWebPEncoder {
	return &PureGoWebPEncoder{
		ItemLossless:   true,
		ItemQuality:    90,
		ItemEffort:     0,
		AvatarLossless: false,
		AvatarQuality:  90,
		AvatarEffort:   0,
	}
}

// Encode implements WebPEncoder.
func (e *PureGoWebPEncoder) Encode(sourcePath string) ([]byte, error) {
	source, err := os.Open(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("open PNG for WebP encoding: %w", err)
	}
	defer source.Close()

	image, err := png.Decode(source)
	if err != nil {
		return nil, fmt.Errorf("decode PNG for WebP encoding: %w", err)
	}

	data, err := webp.EncodeBytes(image, e.optionsFor(sourcePath))
	if err != nil {
		return nil, fmt.Errorf("encode WebP: %w", err)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("encode WebP: empty output")
	}
	return data, nil
}

func (e *PureGoWebPEncoder) optionsFor(sourcePath string) *webp.Options {
	if strings.Contains(filepath.ToSlash(sourcePath), "/avatar/") {
		return &webp.Options{
			Quality:  e.AvatarQuality,
			Effort:   e.AvatarEffort,
			Lossless: e.AvatarLossless,
		}
	}
	return &webp.Options{
		Quality:  e.ItemQuality,
		Effort:   e.ItemEffort,
		Lossless: e.ItemLossless,
	}
}
