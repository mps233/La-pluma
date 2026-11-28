package activity

import (
	"context"
	"log/slog"
	"path/filepath"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	"github.com/mps233/la-pluma/go/internal/infra/httpclient"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const (
	defaultPRTSBaseURL             = "https://prts.maa.plus"
	defaultResourceRefreshInterval = 6 * time.Hour
)

// Options configures the activity service. Zero values are safe: filesystem
// roots come from Paths, clocks use wall time and HTTP uses public endpoints.
type Options struct {
	Paths  config.Paths
	Logger *slog.Logger
	Now    func() time.Time

	HTTPClient      HTTPClient
	PRTSBaseURL     string
	PenguinBaseURL  string
	PRTSTimeout     time.Duration
	PRTSMaxAttempts int
	PRTSSleep       func(ctx context.Context, duration time.Duration) error
	FallbackTTL     time.Duration
	FallbackTimeout time.Duration

	ConfigLoader  ConfigLoader
	OperBoxLoader OperBoxLoader
	ActivityCache ActivityCacheStore
	StageResolver StageResolver
	ResourceDir   ResourceDirProvider
	NavigationLog NavigationLog

	Executor           Executor
	PlanProvider       PlanProvider
	PlanExecutor       PlanExecutor
	LeaseRunner        LeaseRunner
	ResourceUpdater    ResourceUpdater
	CurrentMapPreparer CurrentMapPreparer
	ActivityProvider   ActivityProvider

	ResourceRefreshInterval time.Duration
	StageActivityPath       string
}

// Service owns activity data, penguin fallback, navigation preflight,
// discovery, local progress and current-activity run orchestration.
type Service struct {
	paths  config.Paths
	logger *slog.Logger
	now    func() time.Time
	http   HTTPClient

	stageActivityPath string
	fallback          *FallbackService
	resource          *ResourceIndex
	prts              *prtsClient

	configLoader  ConfigLoader
	operBoxLoader OperBoxLoader
	activityCache ActivityCacheStore
	stageResolver StageResolver
	resourceDir   ResourceDirProvider
	navigationLog NavigationLog
	currentSource ActivityProvider

	executor           Executor
	planProvider       PlanProvider
	planExecutor       PlanExecutor
	lease              LeaseRunner
	resourceUpdater    ResourceUpdater
	currentMapPreparer CurrentMapPreparer

	refreshInterval time.Duration

	cacheMu                 sync.Mutex
	memoryCache             map[string]Info
	resourceCollectionMu    sync.Mutex
	resourceCollectionCache map[string]resourceCollectionCacheEntry

	refreshMu               sync.Mutex
	resourceRefreshAttempts map[string]time.Time

	zoneMu    sync.Mutex
	zoneCache *stageZoneCache
}

// New returns a Service with default dependencies.

// NewWithOptions builds the activity service. Tests inject httptest URLs,
// fake clocks, temp Paths and fake executors/leases.
func NewWithOptions(options Options) *Service {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = httpclient.Default()
	}

	stageActivityPath := options.StageActivityPath
	if stageActivityPath == "" {
		stageActivityPath = filepath.Join(options.Paths.MaaCacheDir, "StageActivityV2.json")
	}

	resource := NewResourceIndexWithNow(options.Paths, now)
	fallback := NewFallbackService(FallbackOptions{
		BaseURL:    options.PenguinBaseURL,
		HTTPClient: httpClient,
		Timeout:    options.FallbackTimeout,
		CacheTTL:   options.FallbackTTL,
		Now:        now,
		Logger:     logger,
	})
	prts := NewPRTSClient(PRTSOptions{
		BaseURL:     options.PRTSBaseURL,
		HTTPClient:  httpClient,
		Timeout:     options.PRTSTimeout,
		MaxAttempts: options.PRTSMaxAttempts,
		Sleep:       options.PRTSSleep,
	})

	service := &Service{
		paths:                   options.Paths,
		logger:                  logger,
		now:                     now,
		http:                    httpClient,
		stageActivityPath:       stageActivityPath,
		fallback:                fallback,
		resource:                resource,
		prts:                    prts,
		configLoader:            options.ConfigLoader,
		operBoxLoader:           options.OperBoxLoader,
		activityCache:           options.ActivityCache,
		stageResolver:           options.StageResolver,
		resourceDir:             options.ResourceDir,
		navigationLog:           options.NavigationLog,
		currentSource:           options.ActivityProvider,
		executor:                options.Executor,
		planProvider:            options.PlanProvider,
		planExecutor:            options.PlanExecutor,
		lease:                   options.LeaseRunner,
		resourceUpdater:         options.ResourceUpdater,
		currentMapPreparer:      options.CurrentMapPreparer,
		refreshInterval:         options.ResourceRefreshInterval,
		memoryCache:             map[string]Info{},
		resourceCollectionCache: map[string]resourceCollectionCacheEntry{},
		resourceRefreshAttempts: map[string]time.Time{},
	}
	if service.configLoader == nil {
		service.configLoader = &fileConfigLoader{dir: options.Paths.UserConfigDir()}
	}
	if service.operBoxLoader == nil {
		service.operBoxLoader = &fileOperBoxLoader{path: options.Paths.OperBoxPath()}
	}
	if service.activityCache == nil {
		service.activityCache = &fileActivityCacheStore{
			path: options.Paths.UserConfigPath("activity-cache.json"),
		}
	}
	if service.stageResolver == nil {
		service.stageResolver = resource
	}
	if service.refreshInterval <= 0 {
		service.refreshInterval = defaultResourceRefreshInterval
	}
	if service.navigationLog == nil {
		service.navigationLog = newDefaultNavigationLog(options.Paths, options.Executor)
	}
	return service
}

// Now returns the service clock. Scheduler adapters use it so activity-stage
// resolution follows the same injected clock as activity selection.
func (s *Service) Now() time.Time {
	if s == nil || s.now == nil {
		return time.Now()
	}
	return s.now()
}

// ProgressPath is activity-copilot-progress.json under Paths.DataDir.
func (s *Service) ProgressPath() string {
	return filepath.Join(s.paths.DataDir, "activity-copilot-progress.json")
}

// fileConfigLoader reads <DataDir>/user-configs/<type>.json.
type fileConfigLoader struct {
	dir string
}

func (l *fileConfigLoader) Load(configType string) (map[string]any, error) {
	value, err := jsonstore.Read(filepath.Join(l.dir, configType+".json"), nil)
	if err != nil {
		return nil, err
	}
	if value == nil {
		return nil, nil
	}
	record, ok := value.(map[string]any)
	if !ok {
		return nil, nil
	}
	return record, nil
}

// fileOperBoxLoader reads operbox.json, the local OperBox projection.
type fileOperBoxLoader struct {
	path string
}

func (l *fileOperBoxLoader) LoadOperBox(_ context.Context) (any, error) {
	return jsonstore.Read(l.path, map[string]any{})
}

type fileActivityCacheStore struct {
	path string
}

func (s *fileActivityCacheStore) Load(_ context.Context) (map[string]any, error) {
	value, err := jsonstore.Read(s.path, map[string]any{})
	if err != nil {
		return map[string]any{}, err
	}
	record, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}, nil
	}
	return record, nil
}

func (s *fileActivityCacheStore) Save(_ context.Context, value map[string]any) error {
	return jsonstore.Write(s.path, value, true)
}
