package archguard

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
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

// TestAgentAPIFilesStaySmall keeps the transport endpoint package split by
// domain. handler.go was a 3,450-line file that every API change touched; the
// split is only useful if a new god file cannot grow back.
func TestAgentAPIFilesStaySmall(t *testing.T) {
	root := moduleRoot(t)
	limit := 800
	base := filepath.Join(root, "internal", "transport", "agentapi")
	err := filepath.WalkDir(base, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if lines := strings.Count(string(data), "\n") + 1; lines > limit {
			rel, _ := filepath.Rel(root, path)
			t.Errorf("%s has %d lines, limit is %d; split it by domain", rel, lines, limit)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk agentapi: %v", err)
	}
}

// TestHTTPHandlersStayInTransport keeps routing in transport. Application and
// infrastructure packages may build HTTP clients or use status codes, but they
// must not own routers or implement http.Handler.
func TestHTTPHandlersStayInTransport(t *testing.T) {
	root := moduleRoot(t)
	for _, layer := range []string{"app", "infra"} {
		base := filepath.Join(root, "internal", layer)
		err := filepath.WalkDir(base, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			text := string(data)
			if strings.Contains(text, "ServeHTTP") || strings.Contains(text, "http.Handler") {
				rel, _ := filepath.Rel(root, path)
				t.Errorf("%s owns an HTTP handler; move the routing to transport", rel)
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", layer, err)
		}
	}
}

// TestEnvironmentReadsStayInConfig keeps environment access in the config
// layer. Services receive resolved values through their options; entry points
// (main.go, cmd/*) may still discover paths before building a Config.
func TestEnvironmentReadsStayInConfig(t *testing.T) {
	root := moduleRoot(t)
	allowed := []string{
		filepath.Join("internal", "config"),
		filepath.Join("internal", "app", "config"),
	}
	err := filepath.WalkDir(filepath.Join(root, "internal"), func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		for _, prefix := range allowed {
			if strings.HasPrefix(rel, prefix+string(filepath.Separator)) {
				return nil
			}
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(data), "os.Getenv") || strings.Contains(string(data), "os.LookupEnv") {
			t.Errorf("%s reads the environment; resolve it in internal/config", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk internal: %v", err)
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

// TestEntriesShareTheHTTPBootstrap keeps the headless server and the desktop
// shell on the same handler mounts.
func TestEntriesShareTheHTTPBootstrap(t *testing.T) {
	root := moduleRoot(t)
	for _, entry := range []string{"main.go", filepath.Join("cmd", "server", "main.go")} {
		data, err := os.ReadFile(filepath.Join(root, entry))
		if err != nil {
			t.Fatalf("read %s: %v", entry, err)
		}
		if !strings.Contains(string(data), "bootstrap.ServerOptions(") {
			t.Errorf("%s does not mount the shared HTTP bootstrap", filepath.ToSlash(entry))
		}
	}
}

// TestHTTPClientsComeFromTheFactory keeps client construction in
// infra/httpclient so timeouts and transport defaults have one owner.
func TestHTTPClientsComeFromTheFactory(t *testing.T) {
	root := moduleRoot(t)
	allowed := filepath.Join("internal", "infra", "httpclient")
	for _, top := range []string{"internal", "cmd"} {
		base := filepath.Join(root, top)
		if _, err := os.Stat(base); err != nil {
			continue
		}
		err := filepath.WalkDir(base, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			if strings.HasPrefix(rel, allowed+string(filepath.Separator)) {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if strings.Contains(string(data), "&http.Client{") {
				t.Errorf("%s builds an http.Client directly; use internal/infra/httpclient", filepath.ToSlash(rel))
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", top, err)
		}
	}
}

// TestRunLifecycleStaysInAgentRunScope keeps one writer for run state. Services
// and transport read runs through Get/Current/List and act through
// agentrun.Scope; a second exported transition method would reopen the drift
// that G7 closed.
func TestRunLifecycleStaysInAgentRunScope(t *testing.T) {
	root := moduleRoot(t)
	mutators := regexp.MustCompile(`\.(?:Runs|runs)\.(Begin|StartForExecution|MarkWaiting|MarkStopping|SetAcceptedResult|Complete|Fail|Stop|ReleaseIdempotency|UpdateProgress|Interrupt)\(`)
	allowedPrefix := filepath.Join("internal", "app", "agentrun")
	for _, top := range []string{"internal/transport", "internal/app"} {
		base := filepath.Join(root, filepath.FromSlash(top))
		if _, err := os.Stat(base); err != nil {
			continue
		}
		err := filepath.WalkDir(base, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			if strings.HasPrefix(rel, allowedPrefix+string(filepath.Separator)) {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if match := mutators.Find(data); match != nil {
				t.Errorf("%s calls %s; delegate run transitions to agentrun.Scope", filepath.ToSlash(rel), match)
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", top, err)
		}
	}
}
