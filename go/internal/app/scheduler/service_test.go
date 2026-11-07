package scheduler

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/mps233/la-pluma/go/internal/config"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

type fakeAutoUpdater struct {
	configs []map[string]any
}

func (u *fakeAutoUpdater) Run(_ context.Context, config map[string]any) error {
	u.configs = append(u.configs, config)
	return nil
}

func TestRegisterScheduleAndStop(t *testing.T) {
	service := newTestService(nil, Options{})
	defer service.Close()

	flow := []any{map[string]any{"id": "a-1", "commandId": "alpha", "enabled": true, "params": map[string]any{}}}
	result := service.RegisterScheduleForClient("default", []string{"08:00", "bad", "08:00", "07:30", "24:00"}, flow, "Official")
	if !result.Success || len(result.Times) != 2 || result.Times[0] != "08:00" || result.Times[1] != "07:30" {
		t.Fatalf("register = %+v", result)
	}
	states := service.ScheduleStatus()
	if len(states) != 1 || states[0].ScheduleID != "default" || states[0].Count != 2 {
		t.Fatalf("states = %+v", states)
	}

	// Invalid times must not clear the existing valid registration.
	invalid := service.RegisterScheduleForClient("default", []string{"nope"}, flow, "Official")
	if invalid.Success {
		t.Fatalf("invalid register = %+v", invalid)
	}
	if states := service.ScheduleStatus(); len(states) != 1 || states[0].Count != 2 {
		t.Fatalf("existing schedule was cleared: %+v", states)
	}

	if stopped := service.StopSchedule("default"); !stopped.Success {
		t.Fatalf("stop = %+v", stopped)
	}
	if stopped := service.StopSchedule("default"); stopped.Success || stopped.Message != "没有找到该定时任务" {
		t.Fatalf("second stop = %+v", stopped)
	}

	if failed := service.RegisterScheduleForClient("empty", nil, flow, "Official"); failed.Success || failed.Message != "没有设置执行时间" {
		t.Fatalf("empty times = %+v", failed)
	}
	if failed := service.RegisterScheduleForClient("bad-flow", []string{"08:00"}, "not-an-array", "Official"); failed.Success || failed.Message != "任务流程格式无效" {
		t.Fatalf("bad flow = %+v", failed)
	}
}

func TestRestoreFromConfig(t *testing.T) {
	source := &fakeConfigSource{configs: map[string]map[string]any{
		"automation-tasks": {
			"schedule": map[string]any{"enabled": true, "times": []any{"08:00", "20:30"}},
			"taskFlow": []any{map[string]any{"id": "a-1", "commandId": "alpha", "enabled": true, "params": map[string]any{}}},
		},
		"auto-update": {
			"enabled": true,
			"time":    "09:30",
		},
	}}
	service := newTestService(nil, Options{ConfigSource: source})
	defer service.Close()

	summary := service.RestoreFromConfig()
	if !summary.Schedule.Restored || !summary.AutoUpdate.Restored {
		t.Fatalf("restore = %+v", summary)
	}
	states := service.ScheduleStatus()
	byID := map[string]ScheduleState{}
	for _, state := range states {
		byID[state.ScheduleID] = state
	}
	if byID["default"].Count != 2 {
		t.Fatalf("default schedule = %+v", byID["default"])
	}
	if byID[AutoUpdateScheduleID].Count != 1 {
		t.Fatalf("auto update schedule = %+v", byID[AutoUpdateScheduleID])
	}
	autoStatus := service.AutoUpdateStatus()
	if !autoStatus.Enabled || autoStatus.Time == nil || *autoStatus.Time != "09:30" {
		t.Fatalf("auto update status = %+v", autoStatus)
	}
}

func TestRestoreFromMapsAndLoadError(t *testing.T) {
	service := newTestService(nil, Options{})
	defer service.Close()

	summary := service.RestoreFromMaps(map[string]any{
		"schedule": map[string]any{"enabled": true, "times": []any{"06:00"}},
		"taskFlow": []any{map[string]any{"id": "a-1", "commandId": "alpha", "enabled": true, "params": map[string]any{}}},
	}, nil)
	if !summary.Schedule.Restored {
		t.Fatalf("map restore = %+v", summary)
	}

	// A saved schedule without taskFlow restores with an empty flow, matching
	// runtimeInitializationService's Array.isArray fallback.
	emptyFlow := newTestService(nil, Options{})
	defer emptyFlow.Close()
	emptySummary := emptyFlow.RestoreFromMaps(map[string]any{
		"schedule": map[string]any{"enabled": true, "times": []any{"07:00"}},
	}, nil)
	if !emptySummary.Schedule.Restored {
		t.Fatalf("empty flow restore = %+v", emptySummary)
	}

	failing := newTestService(nil, Options{ConfigSource: &fakeConfigSource{
		errors: map[string]error{"automation-tasks": errLoad, "auto-update": errLoad},
	}})
	defer failing.Close()
	failed := failing.RestoreFromConfig()
	if failed.Schedule.Error == "" || failed.AutoUpdate.Error == "" {
		t.Fatalf("load errors = %+v", failed)
	}
}

var errLoad = &loadError{}

type loadError struct{}

func (*loadError) Error() string { return "load failed" }

func TestAutoUpdateSetupAndTrigger(t *testing.T) {
	updater := &fakeAutoUpdater{}
	service := newTestService(nil, Options{AutoUpdater: updater})
	defer service.Close()

	if disabled := service.SetupAutoUpdate(map[string]any{"enabled": false}, "Official"); disabled.Success {
		t.Fatalf("disabled = %+v", disabled)
	}
	if invalid := service.SetupAutoUpdate(map[string]any{"enabled": true, "time": "25:00"}, "Official"); invalid.Success || invalid.Message != "时间格式错误" {
		t.Fatalf("invalid time = %+v", invalid)
	}
	result := service.SetupAutoUpdate(map[string]any{"enabled": true, "time": "09:15"}, "Official")
	if !result.Success {
		t.Fatalf("setup = %+v", result)
	}
	config := map[string]any{"enabled": true, "time": "09:15", "updateCore": true}
	service.triggerAutoUpdate(config)
	if len(updater.configs) != 1 || updater.configs[0]["updateCore"] != true {
		t.Fatalf("auto update runs = %+v", updater.configs)
	}
	if status := service.AutoUpdateStatus(); !status.Enabled || status.Time == nil || *status.Time != "09:15" {
		t.Fatalf("status = %+v", status)
	}
	if stopped := service.StopSchedule(AutoUpdateScheduleID); !stopped.Success {
		t.Fatalf("stop auto update = %+v", stopped)
	}
	if status := service.AutoUpdateStatus(); status.Enabled {
		t.Fatalf("status after stop = %+v", status)
	}
}

func TestFileConfigSource(t *testing.T) {
	paths := config.Paths{DataDir: t.TempDir()}
	source := NewFileConfigSource(paths)
	path := filepath.Join(paths.DataDir, "user-configs", "automation-tasks.json")
	if err := jsonstore.Write(path, map[string]any{"schedule": map[string]any{"enabled": true}}, true); err != nil {
		t.Fatalf("write: %v", err)
	}
	loaded, err := source.Load("automation-tasks")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded == nil || loaded["schedule"] == nil {
		t.Fatalf("loaded = %+v", loaded)
	}
	missing, err := source.Load("auto-update")
	if err != nil || missing != nil {
		t.Fatalf("missing = %+v, %v", missing, err)
	}
	if _, err := source.Load("../escape"); err == nil {
		t.Fatal("invalid config type should fail")
	}
}
