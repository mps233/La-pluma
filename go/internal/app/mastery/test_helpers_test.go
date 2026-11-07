package mastery

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const masteryFixture = `{
  "operators": {
    "char_test": {
      "id": "char_test",
      "name": "测试干员",
      "rarity": 6,
      "profession": "术师",
      "professionId": "CASTER",
      "skills": [
        {
          "index": 1,
          "skillId": "skchr_test_1",
          "name": "测试技能一",
          "iconId": null,
          "mastery": [
            {"level": 1, "materials": [{"id": "3303", "name": "技巧概要·卷3", "count": 2}], "unlock": {"phase": "PHASE_2", "level": 1}},
            {"level": 2, "materials": [{"id": "3303", "name": "技巧概要·卷3", "count": 4}]},
            {"level": 3, "materials": [{"id": "3303", "name": "技巧概要·卷3", "count": 6}]}
          ]
        },
        {
          "index": 2,
          "skillId": "skchr_test_2",
          "name": "测试技能二",
          "iconId": null,
          "mastery": [
            {"level": 1, "materials": [{"id": "30012", "name": "固源岩", "count": 1}]}
          ]
        }
      ]
    },
    "char_other": {
      "id": "char_other",
      "name": "另一位干员",
      "rarity": 5,
      "profession": "近卫",
      "professionId": "WARRIOR",
      "skills": [
        {
          "index": 1,
          "skillId": "skchr_other_1",
          "name": "另一个技能",
          "iconId": null,
          "mastery": [
            {"level": 1, "materials": [{"id": "3303", "name": "技巧概要·卷3", "count": 2}]}
          ]
        }
      ]
    }
  },
  "metadata": {"lastUpdated": "2026-11-07", "totalOperators": 2, "totalSkills": 3}
}`

const operBoxFixture = `{
  "timestamp": "2026-11-01T00:00:00.000Z",
  "data": [
    {"id": "char_test", "name": "测试干员", "rarity": 6, "profession": "术师", "elite": 2, "level": 60},
    {"id": "char_other", "name": "另一位干员", "rarity": 5, "profession": "近卫", "elite": 1, "level": 50}
  ],
  "allOpers": [
    {"id": "char_test", "own": true},
    {"id": "char_other", "own": true}
  ]
}`

const depotFixture = `{
  "timestamp": "2026-11-02T00:00:00.000Z",
  "items": [
    {"id": "3303", "count": 1},
    {"id": "30012", "count": 5}
  ]
}`

const battleDataFixture = `{
  "chars": {
    "char_test": {"name": "测试干员", "name_en": "Test Op", "name_jp": "テスト", "name_kr": "테스트", "name_tw": "測試"},
    "char_other": {"name": "另一位干员", "name_en": "Other Op"}
  }
}`

const itemIndexFixture = `{
  "3303": {"name": "技巧概要·卷3"},
  "30012": {"name": "固源岩"}
}`

const itemTableFixture = `{
  "items": {
    "3303": {"name": "技巧概要·卷3", "iconId": "MTL_SKILL3"},
    "30012": {"name": "固源岩", "iconId": "MTL_ROCK"}
  }
}`

const completedCallback = `Assistant::append_callback | SubTaskExtraInfo {"what":"OperProgressDetail","taskchain":"OperProgress","details":{"role":"Caster","name":"测试干员","result":"Success","result_detail":"Completed","skill_mastery":[0,0,2]}}`

type fakeClock struct {
	mu      sync.Mutex
	current time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{current: time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.current
}

func (c *fakeClock) Advance(duration time.Duration) {
	c.mu.Lock()
	c.current = c.current.Add(duration)
	c.mu.Unlock()
}

type fakeExecutor struct {
	mu       sync.Mutex
	handler  func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error)
	calls    []map[string]any
	stopHits int
}

func (e *fakeExecutor) RunTask(ctx context.Context, taskConfig map[string]any, wait bool) (domainrun.DTO, error) {
	e.mu.Lock()
	e.calls = append(e.calls, taskConfig)
	handler := e.handler
	e.mu.Unlock()
	if !wait {
		return domainrun.DTO{}, errors.New("fake executor requires wait=true")
	}
	if handler != nil {
		return handler(ctx, taskConfig)
	}
	return domainrun.DTO{RunID: "run_fake"}, nil
}

func (e *fakeExecutor) Stop(ctx context.Context) error {
	e.mu.Lock()
	e.stopHits++
	e.mu.Unlock()
	return nil
}

func (e *fakeExecutor) stopCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.stopHits
}

func (e *fakeExecutor) callCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.calls)
}

func (e *fakeExecutor) lastCall() map[string]any {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.calls) == 0 {
		return nil
	}
	return e.calls[len(e.calls)-1]
}

type fakeVersions struct {
	cli  string
	core string
	err  error
}

func (v fakeVersions) MAAVersion(ctx context.Context) (string, string, error) {
	return v.cli, v.core, v.err
}

type fakeNotifier struct {
	mu            sync.Mutex
	notifications []fakeNotification
}

type fakeNotification struct {
	Title   string
	Content string
	Level   string
}

func (n *fakeNotifier) Notify(ctx context.Context, title, content, level string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.notifications = append(n.notifications, fakeNotification{Title: title, Content: content, Level: level})
	return nil
}

func (n *fakeNotifier) snapshot() []fakeNotification {
	n.mu.Lock()
	defer n.mu.Unlock()
	return append([]fakeNotification{}, n.notifications...)
}

type fakeProbe struct {
	busy bool
}

func (p fakeProbe) ExternalExecutionActive(ctx context.Context) bool { return p.busy }

type testFixture struct {
	paths    config.Paths
	clock    *fakeClock
	executor *fakeExecutor
	versions *fakeVersions
	notifier *fakeNotifier
	probe    *fakeProbe
	service  *Service
}

func newTestFixture(t *testing.T, handler func(ctx context.Context, taskConfig map[string]any) (domainrun.DTO, error)) *testFixture {
	t.Helper()
	root := t.TempDir()
	paths := config.Paths{
		DataDir:    filepath.Join(root, "data"),
		MaaDataDir: filepath.Join(root, "maa"),
	}
	writeFixtureFile(t, filepath.Join(paths.DataDir, "operator-mastery.json"), masteryFixture)
	writeFixtureFile(t, filepath.Join(paths.DataDir, "operbox.json"), operBoxFixture)
	writeFixtureFile(t, filepath.Join(paths.DataDir, "depot.json"), depotFixture)
	writeFixtureFile(t, filepath.Join(paths.MaaDataDir, "resource", "battle_data.json"), battleDataFixture)
	writeFixtureFile(t, filepath.Join(paths.MaaDataDir, "resource", "item_index.json"), itemIndexFixture)
	writeFixtureFile(t, filepath.Join(paths.MaaDataDir, "resource", "gamedata", "excel", "item_table.json"), itemTableFixture)

	clock := newFakeClock()
	executor := &fakeExecutor{handler: handler}
	versions := &fakeVersions{cli: "0.7.8", core: "6.21.4"}
	notifier := &fakeNotifier{}
	probe := &fakeProbe{}
	service := NewService(ServiceOptions{
		Paths:             paths,
		Now:               clock.Now,
		Executor:          executor,
		Versions:          versions,
		Notifier:          notifier,
		ExternalExecution: probe,
		TickInterval:      60 * time.Second,
		StepTimeout:       2 * time.Second,
	})
	return &testFixture{
		paths:    paths,
		clock:    clock,
		executor: executor,
		versions: versions,
		notifier: notifier,
		probe:    probe,
		service:  service,
	}
}

func writeFixtureFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("mkdir fixture: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
}

func decodeFixtureJSON(t *testing.T, content string) any {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(content))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	return value
}

func asAppError(err error) (*apperrors.Error, bool) {
	return apperrors.As(err)
}

func addDefaultItem(t *testing.T, service *Service, operatorID string, skillIndex int, targetLevel int, declaredLevel int) AddItemsResult {
	t.Helper()
	result, err := service.AddItems([]AddItemInput{{
		OperatorID:    operatorID,
		SkillIndex:    skillIndex,
		TargetLevel:   targetLevel,
		DeclaredLevel: declaredLevel,
	}}, CampaignContext{})
	if err != nil {
		t.Fatalf("add item: %v", err)
	}
	return result
}
