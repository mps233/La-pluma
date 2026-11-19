package activity

import (
	"context"
	"path/filepath"
	"testing"
)

func TestResolvePreparationStageUsesEntryTaskForEXStage(t *testing.T) {
	paths := testPaths(t)
	writeReadyStageTasks(t, paths)
	service := NewWithOptions(Options{Paths: paths, Now: testNow})

	if stage := service.resolvePreparationStage("EA-EX-8", "EA"); stage != "" {
		t.Fatalf("EX stage = %q, want empty entry-task fallback", stage)
	}
	if stage := service.resolvePreparationStage("EA-6", "EA"); stage != "EA-6" {
		t.Fatalf("exact stage = %q", stage)
	}
	if stage := service.resolvePreparationStage("EA-8", "EA"); stage != "EA-7" {
		t.Fatalf("numeric fallback = %q, want nearest EA-7", stage)
	}
}

func TestResourceDirPrefersStaticResourceWithoutMAACommand(t *testing.T) {
	paths := testPaths(t)
	writeReadyStageTasks(t, paths)
	executor := &fakeExecutor{}
	service := NewWithOptions(Options{Paths: paths, Executor: executor, Now: testNow})

	dir, err := service.ResourceDir(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(paths.MaaDataDir, "resource"); dir != want {
		t.Fatalf("dir = %q, want %q", dir, want)
	}
	if len(executor.commandArgs) != 0 {
		t.Fatalf("resource dir must not spawn maa: %#v", executor.commandArgs)
	}
}
