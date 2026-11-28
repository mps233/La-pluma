package assets

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	webp "github.com/SeriousBug/webp-go-pure/std"
)

func writePoCPNG(t *testing.T, dir, name string, width, height int) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			alpha := uint8(0xff)
			if (x+y)%7 == 0 {
				alpha = 0x80
			}
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8(x * 5),
				G: uint8(y * 5),
				B: uint8((x ^ y) * 3),
				A: alpha,
			})
		}
	}
	path := filepath.Join(dir, name)
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(file, img); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestPureGoWebPEncoderProducesDecodableWebP(t *testing.T) {
	encoder := NewPureGoWebPEncoder()
	itemPath := writePoCPNG(t, filepath.Join(t.TempDir(), "template", "items"), "30012.png", 48, 48)
	data, err := encoder.Encode(itemPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		t.Fatalf("output is not a WebP container: %q", data[:min(len(data), 16)])
	}
	decoded, err := webp.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := decoded.Bounds().Dx(), 48; got != want {
		t.Fatalf("decoded width = %d, want %d", got, want)
	}
	if got, want := decoded.Bounds().Dy(), 48; got != want {
		t.Fatalf("decoded height = %d, want %d", got, want)
	}

	avatarPath := writePoCPNG(t, filepath.Join(t.TempDir(), "template", "avatar"), "char_test.png", 32, 32)
	avatarData, err := encoder.Encode(avatarPath)
	if err != nil {
		t.Fatal(err)
	}
	avatar, err := webp.Decode(bytes.NewReader(avatarData))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := avatar.Bounds().Dx(), 32; got != want {
		t.Fatalf("avatar width = %d, want %d", got, want)
	}
	_, _, _, alpha := avatar.At(0, 0).RGBA()
	if alpha == 0 {
		t.Fatal("lossy alpha channel was dropped")
	}
}

func TestPureGoWebPEncoderOptionsFollowPath(t *testing.T) {
	encoder := NewPureGoWebPEncoder()
	itemOptions := encoder.optionsFor("/tmp/template/items/30012.png")
	if !itemOptions.Lossless {
		t.Fatal("item icons should use lossless WebP by default")
	}
	avatarOptions := encoder.optionsFor("/tmp/template/avatar/char_002_amiya.png")
	if avatarOptions.Lossless || avatarOptions.Quality != 90 {
		t.Fatalf("avatar options = %+v, want lossy quality 90", avatarOptions)
	}
}

func TestPureGoWebPEncoderRejectsInvalidPNG(t *testing.T) {
	path := filepath.Join(t.TempDir(), "broken.png")
	if err := os.WriteFile(path, []byte("not a png"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewPureGoWebPEncoder().Encode(path); err == nil {
		t.Fatal("expected an error for an invalid PNG")
	}
}
