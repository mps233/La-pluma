package archguard

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

const modulePrefix = "github.com/mps233/la-pluma/go/"

// allowedInternalDeps maps a layer to the internal package prefixes it may
// import. Dependencies only point downward: transport -> app -> infra/domain
// -> util/config. A layer not listed here may import anything (cmd, main).
var allowedInternalDeps = map[string][]string{
	"internal/archguard": nil,
	"internal/domain":    nil,
	"internal/config":    nil,
	"internal/contract":  nil,
	"internal/util":      {"internal/util"},
	"internal/infra":     {"internal/infra", "internal/util", "internal/config", "internal/domain"},
	"internal/app":       {"internal/app", "internal/config", "internal/domain", "internal/infra", "internal/util"},
	"internal/transport": {"internal"},
}

func moduleRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("go.mod not found above the test directory")
		}
		dir = parent
	}
}

func layerOf(pkg string) (layer, rest string) {
	parts := strings.Split(strings.TrimPrefix(pkg, "internal/"), "/")
	if len(parts) == 0 {
		return "", ""
	}
	return "internal/" + parts[0], strings.Join(parts[1:], "/")
}

func allowed(layer, dependency string) bool {
	prefixes, restricted := allowedInternalDeps[layer]
	if !restricted {
		return true
	}
	for _, prefix := range prefixes {
		if dependency == prefix || strings.HasPrefix(dependency, prefix+"/") {
			return true
		}
	}
	return false
}

func TestInternalDependenciesPointDownward(t *testing.T) {
	root := moduleRoot(t)
	var violations []string

	for _, top := range []string{"internal", "cmd"} {
		base := filepath.Join(root, top)
		if _, err := os.Stat(base); err != nil {
			continue
		}
		err := filepath.WalkDir(base, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				if entry.Name() == "testdata" || entry.Name() == "vendor" {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			rel = filepath.ToSlash(rel)
			pkgDir := filepath.ToSlash(filepath.Dir(rel))
			layer, _ := layerOf(pkgDir)
			if layer == "" || layer == "cmd" {
				return nil
			}
			file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
			if err != nil {
				return err
			}
			for _, spec := range file.Imports {
				importPath, err := strconv.Unquote(spec.Path.Value)
				if err != nil || !strings.HasPrefix(importPath, modulePrefix) {
					continue
				}
				dependency := strings.TrimPrefix(importPath, modulePrefix)
				if !strings.HasPrefix(dependency, "internal/") {
					continue
				}
				if !allowed(layer, dependency) {
					violations = append(violations, rel+" imports "+dependency+" (layer "+layer+" may not)")
				}
				// The composition root imports every app package, so an app
				// subpackage importing the root would create a cycle in intent
				// even when the compiler happens to allow a particular edge.
				if layer == "internal/app" && pkgDir != "internal/app" && dependency == "internal/app" {
					violations = append(violations, rel+" imports the app composition root")
				}
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", base, err)
		}
	}

	if len(violations) > 0 {
		t.Fatalf("architecture violations:\n  %s", strings.Join(violations, "\n  "))
	}
}

func TestLayersAreKnown(t *testing.T) {
	root := moduleRoot(t)
	entries, err := os.ReadDir(filepath.Join(root, "internal"))
	if err != nil {
		t.Fatalf("read internal: %v", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		layer := "internal/" + entry.Name()
		if _, ok := allowedInternalDeps[layer]; !ok {
			t.Fatalf("internal/%s is not assigned a dependency rule; add it to allowedInternalDeps", entry.Name())
		}
	}
}
