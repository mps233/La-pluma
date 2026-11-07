package activity

import (
	"context"

	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
)

// StageActivity is the current side-story activity selected from
// StageActivityV2.json.
type StageActivity struct {
	Code            string   `json:"code"`
	Name            string   `json:"name"`
	Source          string   `json:"source"`
	StartTime       int64    `json:"startTime"`
	EndTime         *int64   `json:"endTime"`
	Stages          []string `json:"stages"`
	MinimumRequired any      `json:"minimumRequired"`
}

// PenguinActivity is the penguin-stats fallback activity shape.
type PenguinActivity struct {
	Code      string   `json:"code"`
	Name      string   `json:"name"`
	Source    string   `json:"source"`
	StartTime int64    `json:"startTime"`
	EndTime   *int64   `json:"endTime"`
	Stages    []string `json:"stages"`
}

// Failure describes why current activity detection failed.
type Failure struct {
	Source  string `json:"source"`
	Message string `json:"message"`
}

// Info mirrors maaService's ActivityInfo. Code/name/source stay pointers so
// the JSON envelope keeps explicit nulls for unavailable activity data.
type Info struct {
	Code          *string  `json:"code"`
	Name          *string  `json:"name"`
	Source        *string  `json:"source"`
	StartTime     any      `json:"startTime,omitempty"`
	EndTime       any      `json:"endTime,omitempty"`
	Stages        []string `json:"stages"`
	Timestamp     *int64   `json:"timestamp,omitempty"`
	TTL           *int64   `json:"ttl,omitempty"`
	Status        string   `json:"status,omitempty"`
	DataUpdatedAt *int64   `json:"dataUpdatedAt,omitempty"`
	LastSuccessAt *int64   `json:"lastSuccessAt,omitempty"`
	Failure       *Failure `json:"failure,omitempty"`
}

// NavigationActivity is the compact activity object embedded in preflight
// and discovery responses.
type NavigationActivity struct {
	Code   *string  `json:"code"`
	Name   *string  `json:"name"`
	Source *string  `json:"source"`
	Stages []string `json:"stages"`
}

// NavigationInfo describes the verified MAA stage resource chain.
type NavigationInfo struct {
	Source     string `json:"source"`
	StageFile  string `json:"stageFile"`
	StageCount int    `json:"stageCount"`
	EntryTask  string `json:"entryTask"`
}

// NavigationResult mirrors getActivityRunPreflight / assessActivityNavigation.
type NavigationResult struct {
	State      string             `json:"state"`
	CanPrepare bool               `json:"canPrepare"`
	CanRun     bool               `json:"canRun"`
	ReasonCode *string            `json:"reasonCode"`
	Reason     string             `json:"reason"`
	Activity   NavigationActivity `json:"activity"`
	Navigation *NavigationInfo    `json:"navigation"`
}

// MissingOperatorInfo describes operator requirements the local OperBox cannot
// satisfy.
type MissingOperatorInfo struct {
	Names         []string `json:"names"`
	Count         int      `json:"count"`
	MissingGroups int      `json:"missingGroups"`
	Unknown       bool     `json:"unknown,omitempty"`
}

// CombatCopilotPreferences mirrors getCombatCopilotPreferences. LoopTimes and
// the formation/support values stay any because the user config is untyped.
type CombatCopilotPreferences struct {
	Raid                    string `json:"raid"`
	LoopTimes               any    `json:"loopTimes"`
	IgnoreRequirements      bool   `json:"ignoreRequirements"`
	UseSanityPotion         bool   `json:"useSanityPotion"`
	AddTrust                bool   `json:"addTrust"`
	FormationIndex          any    `json:"formationIndex"`
	SupportUsage            any    `json:"supportUsage"`
	SupportName             any    `json:"supportName"`
	AllowOneMissingOperator bool   `json:"allowOneMissingOperator"`
	FormationMode           string `json:"formationMode"`
}

// SelectionContext is the local context used to filter activity copilots.
type SelectionContext struct {
	Preferences    CombatCopilotPreferences
	OwnedOperators map[string]struct{}
}

// Map returns the preference projection consumed by plan/run helpers.
func (p CombatCopilotPreferences) Map() map[string]any {
	return map[string]any{
		"raid":                    p.Raid,
		"loopTimes":               p.LoopTimes,
		"ignoreRequirements":      p.IgnoreRequirements,
		"useSanityPotion":         p.UseSanityPotion,
		"addTrust":                p.AddTrust,
		"formationIndex":          p.FormationIndex,
		"supportUsage":            p.SupportUsage,
		"supportName":             p.SupportName,
		"allowOneMissingOperator": p.AllowOneMissingOperator,
		"formationMode":           p.FormationMode,
	}
}

// CopilotCandidate is one ranked public PRTS copilot for a stage.
type CopilotCandidate struct {
	ID                   int      `json:"id"`
	URI                  string   `json:"uri"`
	Stage                string   `json:"stage"`
	Title                string   `json:"title"`
	StageName            string   `json:"stageName"`
	PresetFormation      bool     `json:"presetFormation"`
	Uploader             *string  `json:"uploader"`
	UploadTime           *string  `json:"uploadTime"`
	RatingLevel          float64  `json:"ratingLevel"`
	RatingRatio          float64  `json:"ratingRatio"`
	NotEnoughRating      bool     `json:"notEnoughRating"`
	HotScore             float64  `json:"hotScore"`
	Views                float64  `json:"views"`
	MissingOperators     []string `json:"missingOperators"`
	MissingOperatorCount int      `json:"missingOperatorCount"`
	RequiresSupport      bool     `json:"requiresSupport"`
	Allowed              bool     `json:"allowed"`
}

// CopilotSetMember is one member of a matched PRTS set.
type CopilotSetMember struct {
	ID                   int      `json:"id"`
	Stage                *string  `json:"stage"`
	RatingLevel          float64  `json:"ratingLevel"`
	RatingRatio          float64  `json:"ratingRatio"`
	NotEnoughRating      bool     `json:"notEnoughRating"`
	MissingOperators     []string `json:"missingOperators"`
	MissingOperatorCount int      `json:"missingOperatorCount"`
	RequiresSupport      bool     `json:"requiresSupport"`
	Allowed              bool     `json:"allowed"`
}

// CopilotSetScore is the average rating projection of a set.
type CopilotSetScore struct {
	RatingScore       float64 `json:"ratingScore"`
	RatingRatio       float64 `json:"ratingRatio"`
	UnratedMainStages int     `json:"unratedMainStages"`
}

// CopilotSetMatch is a complete public PRTS set covering the activity.
type CopilotSetMatch struct {
	ID                string             `json:"id"`
	Name              string             `json:"name"`
	Creator           *string            `json:"creator"`
	UpdatedAt         *string            `json:"updatedAt"`
	Stages            []string           `json:"stages"`
	Members           []CopilotSetMember `json:"members"`
	RatingScore       float64            `json:"ratingScore"`
	RatingRatio       float64            `json:"ratingRatio"`
	UnratedMainStages int                `json:"unratedMainStages"`
	Source            string             `json:"source"`
}

// StageCandidateResult is the ranked candidate list for one stage.
type StageCandidateResult struct {
	Stage      string             `json:"stage"`
	StageID    *string            `json:"stageId"`
	Query      *string            `json:"query"`
	Candidates []CopilotCandidate `json:"candidates"`
	Error      string             `json:"error,omitempty"`
}

// DiscoveryExecution states that discovery never starts a battle.
type DiscoveryExecution struct {
	Mode       string `json:"mode"`
	Executable bool   `json:"executable"`
}

// DiscoverySource identifies the PRTS endpoint and ordering.
type DiscoverySource struct {
	Provider string `json:"provider"`
	Endpoint string `json:"endpoint"`
	OrderBy  string `json:"orderBy"`
}

// Candidates is the activity copilot discovery response.
type Candidates struct {
	Execution      DiscoveryExecution     `json:"execution"`
	Source         DiscoverySource        `json:"source"`
	Ranking        []string               `json:"ranking"`
	Preflight      NavigationResult       `json:"preflight"`
	State          string                 `json:"state"`
	Reason         string                 `json:"reason,omitempty"`
	Stages         []StageCandidateResult `json:"stages"`
	MatchingSet    *CopilotSetMatch       `json:"matchingSet,omitempty"`
	MatchingSets   []CopilotSetMatch      `json:"matchingSets,omitempty"`
	NavigationMode string                 `json:"navigationMode,omitempty"`
}

// PreparationTask is one dynamic MAA task used to navigate to the activity.
type PreparationTask struct {
	Name   string         `json:"name"`
	Type   string         `json:"type"`
	Params map[string]any `json:"params"`
}

// RunPlanEntry is one executable copilot projected for the activity run.
type RunPlanEntry struct {
	CopilotID        int      `json:"copilotId"`
	URI              string   `json:"uri"`
	DisplayStage     string   `json:"displayStage"`
	Mode             string   `json:"mode"`
	PresetFormation  bool     `json:"presetFormation"`
	Title            string   `json:"title"`
	RatingLevel      float64  `json:"ratingLevel"`
	RatingRatio      float64  `json:"ratingRatio"`
	MissingOperators []string `json:"missingOperators"`
	RequiresSupport  bool     `json:"requiresSupport"`
}

// RunPlan is buildActivityCopilotRunPlan's result.
type RunPlan struct {
	State                     string              `json:"state"`
	Reason                    string              `json:"reason,omitempty"`
	Activity                  *NavigationActivity `json:"activity,omitempty"`
	Entries                   []RunPlanEntry      `json:"entries"`
	NavigationMode            string              `json:"navigationMode,omitempty"`
	RequiresUserOnActivityMap bool                `json:"requiresUserOnActivityMap,omitempty"`
	CurrentMapResource        any                 `json:"currentMapResource,omitempty"`
}

// CompletionEntry is the subset of an execution result used for local
// activity progress.
type CompletionEntry struct {
	DisplayStage string `json:"displayStage,omitempty"`
	Stage        string `json:"stage,omitempty"`
	Success      *bool  `json:"success,omitempty"`
}

// ProgressSummary is summarizeActivityCompletion's output.
type ProgressSummary struct {
	Known           bool     `json:"known"`
	Complete        bool     `json:"complete"`
	CompletedStages []string `json:"completedStages"`
	TotalStages     int      `json:"totalStages"`
	Source          string   `json:"source"`
}

// ActivityProgressEntry is one activity's completed stage list.
type ActivityProgressEntry struct {
	Stages    []string `json:"stages"`
	UpdatedAt string   `json:"updatedAt,omitempty"`
}

// ActivityProgress maps activity code to local progress.
type ActivityProgress map[string]ActivityProgressEntry

// PlanItem is one copilot inside a PRTS set. Only the fields the activity run
// needs are projected.
type PlanItem struct {
	ID              int    `json:"id"`
	StageID         string `json:"stageId"`
	Stage           string `json:"stage"`
	PresetFormation bool   `json:"presetFormation"`
	SupportsRaid    bool   `json:"supportsRaid"`
}

// PlanEntry is one execution projection of a plan item.
type PlanEntry struct {
	Key             string `json:"key,omitempty"`
	ItemIndex       int    `json:"itemIndex"`
	CopilotID       int    `json:"copilotId"`
	StageID         string `json:"stageId,omitempty"`
	DisplayStage    string `json:"displayStage"`
	Mode            string `json:"mode,omitempty"`
	PresetFormation bool   `json:"presetFormation,omitempty"`
}

// Plan is the minimal copilot plan contract the activity package consumes.
type Plan struct {
	SetID   string      `json:"setId"`
	Name    string      `json:"name"`
	Items   []PlanItem  `json:"items,omitempty"`
	Entries []PlanEntry `json:"entries"`
}

// ExecutionResult is returned by PlanExecutor. Results feed completion
// persistence; Data is merged into the run response for transport parity.
type ExecutionResult struct {
	Results []CompletionEntry `json:"results"`
	Data    map[string]any    `json:"-"`
}

// Lifecycle mirrors AgentRunLifecycle's progress hooks used by the run
// service. Callbacks may be nil.
type Lifecycle struct {
	RunID      string
	OnStarted  func()
	OnProgress func(progress any, taskResults []any) any
}

// SetExecutionOptions is the manual current-activity set request.
type SetExecutionOptions struct {
	SetID           string
	SelectedIndexes []int
	Raid            string
	Options         map[string]any
	ClientType      string
}

// LeaseRequest identifies one shared MAA execution lease.
type LeaseRequest struct {
	Source   string
	TaskName string
	Command  string
}

// PlanProvider builds a copilot plan. internal/app/copilot can be adapted to
// this interface; this package never imports it.
type PlanProvider interface {
	BuildPlan(ctx context.Context, setId, raid string) (Plan, error)
}

// PlanExecution is the executeCopilotPlan request.
type PlanExecution struct {
	SetID           string
	Raid            string
	SelectedIndexes []int
	Options         map[string]any
	Lifecycle       *Lifecycle
}

// EntriesExecution is the executeSelectedCopilotEntries request.
type EntriesExecution struct {
	PlanID    string
	Name      string
	Entries   []PlanEntry
	Options   map[string]any
	Lifecycle *Lifecycle
}

// PlanExecutor executes plans/entries. Implementations must return partial
// Results alongside an error when execution stopped midway.
type PlanExecutor interface {
	ExecutePlan(ctx context.Context, request PlanExecution) (*ExecutionResult, error)
	ExecuteSelectedEntries(ctx context.Context, request EntriesExecution) (*ExecutionResult, error)
}

// Executor is the narrow MAA process surface used by the activity run
// service. It matches the scheduler adapter shape.
type Executor interface {
	RunTask(ctx context.Context, taskConfig map[string]any, wait bool) (domainrun.DTO, error)
	RunCommand(ctx context.Context, command string, args []string, taskName, taskType string, wait bool) (domainrun.DTO, error)
	Stop(ctx context.Context) error
}

// Preflight checks whether the installed MAA resource can navigate to the
// current activity. NavigationService implements it.
type Preflight interface {
	Check(ctx context.Context, clientType string) (NavigationResult, error)
}

// LeaseRunner wraps work in the shared MAA execution lease.
type LeaseRunner interface {
	Run(ctx context.Context, request LeaseRequest, fn func(ctx context.Context) error) error
}

// ResourceUpdater refreshes MAA Core/CLI/resources.
type ResourceUpdater interface {
	Update(ctx context.Context) (map[string]any, error)
}

// CurrentMapPreparer writes the current-map fallback resource.
type CurrentMapPreparer interface {
	EnsureCurrentMapActivityResource(ctx context.Context, configDir, activityCode string, stages []string) (any, error)
}

// ActivityProvider supplies the merged current-activity view. Service
// implements it; tests may inject a fake.
type ActivityProvider interface {
	CurrentActivity(ctx context.Context, clientType string) (*Info, error)
}

// ConfigLoader loads one user config file.
type ConfigLoader interface {
	Load(configType string) (map[string]any, error)
}

// OperBoxLoader supplies the local OperBox projection. A nil loader means no
// operator filtering.
type OperBoxLoader interface {
	LoadOperBox(ctx context.Context) (any, error)
}

// ActivityCacheStore persists the per-client activity cache.
type ActivityCacheStore interface {
	Load(ctx context.Context) (map[string]any, error)
	Save(ctx context.Context, value map[string]any) error
}

// StageResolver resolves a display stage code to the MAA internal stage id.
type StageResolver interface {
	StageID(ctx context.Context, code string) (string, bool)
}

// ResourceDirProvider finds the configured MAA resource directory.
type ResourceDirProvider interface {
	ResourceDir(ctx context.Context) (string, error)
}

// NavigationLog reads the MAA asst.log increment used to verify navigation.
type NavigationLog interface {
	Checkpoint(ctx context.Context) string
	ReadSince(ctx context.Context, checkpoint string) string
}
