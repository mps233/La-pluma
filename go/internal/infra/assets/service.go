package assets

import (
	"log/slog"
	"os"
	"path/filepath"

	"github.com/mps233/la-pluma/go/internal/config"
)

const (
	itemNamespaceDir   = "template"
	itemAssetsSubdir   = "items"
	avatarAssetsSubdir = "avatar"
)

// ItemAssetMapLoader resolves iconId aliases from a resource directory.
type ItemAssetMapLoader func(resourceDir string) (map[string]string, error)

// Config configures a Service. Zero values use Paths.MaaDataDir/resource, the
// standard MaaResource loader, slog.Default and PNG-only responses.
type Config struct {
	// ResourceDir overrides the MaaResource root. ResourceDirFunc takes
	// precedence when both are set.
	ResourceDir      string
	ResourceDirFunc  func() (string, error)
	LoadItemAssetMap ItemAssetMapLoader
	Logger           *slog.Logger

	// WebPEncoder is optional. A nil encoder always serves the original PNG.
	WebPEncoder WebPEncoder
	// WebP cache limits. Zero uses 256 entries, 64 MiB and 4 encoders.
	WebPMaxEntries  int
	WebPMaxBytes    int64
	WebPConcurrency int
}

// Service resolves validated item and avatar keys to MaaResource PNG files and
// produces cached WebP variants. HTTP routing and response writing belong to
// transport/assetsapi.
type Service struct {
	logger           *slog.Logger
	resourceDir      string
	resourceDirFunc  func() (string, error)
	loadItemAssetMap ItemAssetMapLoader
	cache            *webPCache
}

// NewService builds the asset resolver for the configured paths.
func NewService(paths config.Paths, cfg Config) *Service {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	resourceDir := cfg.ResourceDir
	if resourceDir == "" {
		resourceDir = filepath.Join(paths.MaaDataDir, "resource")
	}
	loader := cfg.LoadItemAssetMap
	if loader == nil {
		loader = LoadItemAssetMap
	}
	return &Service{
		logger:           logger,
		resourceDir:      resourceDir,
		resourceDirFunc:  cfg.ResourceDirFunc,
		loadItemAssetMap: loader,
		cache:            newWebPCache(cfg.WebPEncoder, cfg.WebPMaxEntries, cfg.WebPMaxBytes, cfg.WebPConcurrency),
	}
}

// ItemFile resolves one already-normalized item key to a PNG path. found is
// false for a missing asset; the error is reserved for an unavailable
// MaaResource root, while an unreadable alias map is logged and treated as a
// missing asset.
func (s *Service) ItemFile(key string) (file string, found bool, err error) {
	root, err := s.resolveRoot()
	if err != nil {
		return "", false, err
	}
	itemsDir, ok := safeJoin(root, itemNamespaceDir, itemAssetsSubdir)
	if !ok {
		return "", false, nil
	}
	file, ok = safeJoin(itemsDir, key+".png")
	if !ok {
		return "", false, nil
	}
	if isFile(file) {
		return file, true, nil
	}

	assetMap, err := s.loadItemAssetMap(root)
	if err != nil {
		s.logger.Warn("解析 MaaResource 物品图标失败", "key", key, "error", err)
		return "", false, nil
	}
	itemID := SelectItemAssetID(key, assetMap)
	if itemID == "" {
		return "", false, nil
	}
	file, ok = safeJoin(itemsDir, itemID+".png")
	if !ok || !isFile(file) {
		return "", false, nil
	}
	return file, true, nil
}

// AvatarFile resolves one already-normalized operator id to a PNG path.
func (s *Service) AvatarFile(id string) (file string, found bool, err error) {
	root, err := s.resolveRoot()
	if err != nil {
		return "", false, err
	}
	avatarDir, ok := safeJoin(root, itemNamespaceDir, avatarAssetsSubdir)
	if !ok {
		return "", false, nil
	}
	file, ok = safeJoin(avatarDir, id+".png")
	if !ok || !isFile(file) {
		return "", false, nil
	}
	return file, true, nil
}

// WebPVariant returns a WebP encoding of the PNG when the client accepts WebP
// and the variant is smaller than the source. A nil result means "serve the
// PNG"; conversion failures are returned so the caller can log them.
func (s *Service) WebPVariant(file string, info os.FileInfo, acceptsWebP bool) ([]byte, error) {
	if s.cache == nil || !acceptsWebP {
		return nil, nil
	}
	data, err := s.cache.variant(file, info)
	if err != nil {
		return nil, err
	}
	// Never make a client download more bytes than the original PNG.
	if data == nil || int64(len(data)) >= info.Size() {
		return nil, nil
	}
	return data, nil
}

func (s *Service) resolveRoot() (string, error) {
	if s.resourceDirFunc == nil {
		return s.resourceDir, nil
	}
	return s.resourceDirFunc()
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
