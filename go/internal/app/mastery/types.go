package mastery

// MasteryMaterial is one material requirement inside a mastery level.
type MasteryMaterial struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Count float64 `json:"count"`
}

// MasteryUnlock is the optional phase/level gate stored on a mastery level.
type MasteryUnlock struct {
	Phase *string  `json:"phase,omitempty"`
	Level *float64 `json:"level,omitempty"`
}

// MasteryLevel matches the generated operator-mastery.json level records.
type MasteryLevel struct {
	Level     float64           `json:"level"`
	Materials []MasteryMaterial `json:"materials"`
	Unlock    *MasteryUnlock    `json:"unlock,omitempty"`
}

// OperatorSkill is one skill slot from operator-mastery.json.
type OperatorSkill struct {
	Index   float64        `json:"index"`
	SkillID string         `json:"skillId"`
	Name    string         `json:"name"`
	IconID  *string        `json:"iconId"`
	Mastery []MasteryLevel `json:"mastery"`
}

// OperatorMastery is one operator record from operator-mastery.json.
type OperatorMastery struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Rarity       float64         `json:"rarity"`
	Profession   string          `json:"profession"`
	ProfessionID string          `json:"professionId"`
	Skills       []OperatorSkill `json:"skills"`
}

// MasteryDataFile is the normalized operator-mastery.json root.
type MasteryDataFile struct {
	Operators map[string]OperatorMastery
	Metadata  map[string]any
}

// MasteryCandidateStatus is the catalog status filter.
type MasteryCandidateStatus string

const (
	CandidateStatusEligible MasteryCandidateStatus = "eligible"
	CandidateStatusOwned    MasteryCandidateStatus = "owned"
	CandidateStatusAll      MasteryCandidateStatus = "all"
)

// MasteryCandidate is one row of the /catalog response.
type MasteryCandidate struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Rarity          float64 `json:"rarity"`
	Profession      string  `json:"profession"`
	ProfessionID    string  `json:"professionId"`
	CurrentElite    float64 `json:"currentElite"`
	CurrentLevel    float64 `json:"currentLevel"`
	Owned           bool    `json:"owned"`
	OwnedStateKnown bool    `json:"ownedStateKnown"`
	SkillCount      int     `json:"skillCount"`
	Eligible        bool    `json:"eligible"`
	DisabledReason  *string `json:"disabledReason"`
}

// MasteryMaterialNode is an advisory depot comparison for one material.
type MasteryMaterialNode struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	IconID      string  `json:"iconId"`
	Count       float64 `json:"count"`
	Have        float64 `json:"have"`
	Needed      float64 `json:"needed"`
	StillNeeded float64 `json:"stillNeeded"`
}

// MasteryLevelDetail adds material nodes to a mastery level.
type MasteryLevelDetail struct {
	Level         float64               `json:"level"`
	Materials     []MasteryMaterial     `json:"materials"`
	Unlock        *MasteryUnlock        `json:"unlock,omitempty"`
	MaterialNodes []MasteryMaterialNode `json:"materialNodes"`
}

// MasterySkillDetail is the operator detail skill view. It keeps the raw
// "mastery" array as well as the enriched "levels" array, matching Node.
type MasterySkillDetail struct {
	Index             float64               `json:"index"`
	SkillID           string                `json:"skillId"`
	Name              string                `json:"name"`
	IconID            *string               `json:"iconId"`
	Mastery           []MasteryLevel        `json:"mastery"`
	Levels            []MasteryLevelDetail  `json:"levels"`
	NextLevel         *MasteryLevelDetail   `json:"nextLevel"`
	NextMaterialNodes []MasteryMaterialNode `json:"nextMaterialNodes"`
}

// FreshnessEntry describes an input-data timestamp and its age.
type FreshnessEntry struct {
	Timestamp *string `json:"timestamp"`
	AgeDays   *int    `json:"ageDays"`
}

// MasteryFreshness describes the generated mastery data timestamp.
type MasteryFreshness struct {
	LastUpdated *string `json:"lastUpdated"`
}

// CandidateFreshness is the catalog dataFreshness payload.
type CandidateFreshness struct {
	Operbox FreshnessEntry   `json:"operbox"`
	Mastery MasteryFreshness `json:"mastery"`
}

// DetailFreshness is the operator dataFreshness payload.
type DetailFreshness struct {
	Operbox FreshnessEntry   `json:"operbox"`
	Depot   FreshnessEntry   `json:"depot"`
	Mastery MasteryFreshness `json:"mastery"`
}

// MasteryCandidateList is the /catalog response.
type MasteryCandidateList struct {
	Operators     []MasteryCandidate `json:"operators"`
	Total         int                `json:"total"`
	DataFreshness CandidateFreshness `json:"dataFreshness"`
}

// MasteryOperatorDetail is the /operators/:id response.
type MasteryOperatorDetail struct {
	ID              string               `json:"id"`
	Name            string               `json:"name"`
	NameForMaa      string               `json:"nameForMaa"`
	Role            *string              `json:"role"`
	Rarity          float64              `json:"rarity"`
	Profession      string               `json:"profession"`
	ProfessionID    string               `json:"professionId"`
	CurrentElite    float64              `json:"currentElite"`
	CurrentLevel    float64              `json:"currentLevel"`
	Owned           bool                 `json:"owned"`
	OwnedStateKnown bool                 `json:"ownedStateKnown"`
	Skills          []MasterySkillDetail `json:"skills"`
	ClientType      string               `json:"clientType"`
	DataFreshness   DetailFreshness      `json:"dataFreshness"`
}

// MasteryDataPreflight is the data portion of /preflight.
type MasteryDataPreflight struct {
	Supported             bool                        `json:"supported"`
	MasteryData           MasteryDataPreflightDetails `json:"masteryData"`
	ClientType            string                      `json:"clientType"`
	MinimumMaaCliVersion  string                      `json:"minimumMaaCliVersion"`
	MinimumMaaCoreVersion string                      `json:"minimumMaaCoreVersion"`
}

// MasteryDataPreflightDetails reports whether generated mastery data exists.
type MasteryDataPreflightDetails struct {
	Available     bool    `json:"available"`
	OperatorCount int     `json:"operatorCount"`
	Error         *string `json:"error"`
}

// RuntimeSupport is the MAA version portion of /preflight.
type RuntimeSupport struct {
	Supported   bool    `json:"supported"`
	CLI         string  `json:"cli"`
	Core        string  `json:"core"`
	MinimumCLI  string  `json:"minimumCli"`
	MinimumCore string  `json:"minimumCore"`
	Reason      *string `json:"reason"`
}

// PreflightResponse combines both preflight halves like the route response.
type PreflightResponse struct {
	MasteryDataPreflight
	Runtime RuntimeSupport `json:"runtime"`
}

// QueueSettings is the campaign settings block.
type QueueSettings struct {
	ProbeIntervalMinutes int    `json:"probeIntervalMinutes"`
	OnItemBlocked        string `json:"onItemBlocked"`
	AutoStartGame        bool   `json:"autoStartGame"`
	NotifyOnComplete     bool   `json:"notifyOnComplete"`
	NotifyOnBlocked      bool   `json:"notifyOnBlocked"`
}

// MasteryItemOutcome is the last terminal outcome recorded for an item.
type MasteryItemOutcome struct {
	Result               *string    `json:"result"`
	ResultDetail         *string    `json:"resultDetail"`
	SkillMastery         []*float64 `json:"skillMastery"`
	RunID                *string    `json:"runId"`
	At                   *string    `json:"at"`
	LogCheckpointPresent bool       `json:"logCheckpointPresent"`
}

// MasteryBlocked is the structured blocked reason on a queue item.
type MasteryBlocked struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Detail    any    `json:"detail"`
	Retryable bool   `json:"retryable"`
	At        string `json:"at"`
}

// MasteryRecovery records the pre-restart phase of an interrupted item.
type MasteryRecovery struct {
	PreviousPhase string  `json:"previousPhase"`
	PreviousRunID *string `json:"previousRunId"`
	DetectedAt    string  `json:"detectedAt"`
}

// MasteryQueueItem is one persisted mastery target. JSON field names match the
// Node implementation exactly; nullable fields stay present as null.
type MasteryQueueItem struct {
	ID                  string              `json:"id"`
	OperatorID          string              `json:"operatorId"`
	OperatorName        string              `json:"operatorName"`
	Role                *string             `json:"role"`
	SkillIndex          int                 `json:"skillIndex"`
	SkillID             *string             `json:"skillId"`
	SkillName           string              `json:"skillName"`
	TargetLevel         int                 `json:"targetLevel"`
	DeclaredLevel       int                 `json:"declaredLevel"`
	ConfirmedLevel      int                 `json:"confirmedLevel"`
	LevelVerified       bool                `json:"levelVerified"`
	StartedLevel        *int                `json:"startedLevel"`
	Phase               string              `json:"phase"`
	Enabled             bool                `json:"enabled"`
	Order               int                 `json:"order"`
	VerifyCount         int                 `json:"verifyCount"`
	Attempts            int                 `json:"attempts"`
	ConsecutiveFailures int                 `json:"consecutiveFailures"`
	LastErrorCode       *string             `json:"lastErrorCode"`
	LastOutcome         *MasteryItemOutcome `json:"lastOutcome"`
	TrainingStartedAt   *string             `json:"trainingStartedAt"`
	NextProbeAt         *string             `json:"nextProbeAt"`
	ProbeBackoffIndex   int                 `json:"probeBackoffIndex"`
	Blocked             *MasteryBlocked     `json:"blocked"`
	ActiveRunID         *string             `json:"activeRunId"`
	LastRunID           *string             `json:"lastRunId"`
	Recovery            *MasteryRecovery    `json:"recovery"`
	AddedAt             string              `json:"addedAt"`
	UpdatedAt           string              `json:"updatedAt"`
	CompletedAt         *string             `json:"completedAt"`
	SkippedAt           *string             `json:"skippedAt"`
}

// MasteryCampaign is the campaign control block.
type MasteryCampaign struct {
	Status          string        `json:"status"`
	ActiveItemID    *string       `json:"activeItemId"`
	ActiveStepRunID *string       `json:"activeStepRunId"`
	Settings        QueueSettings `json:"settings"`
	ClientProfileID *string       `json:"clientProfileId"`
	ClientType      *string       `json:"clientType"`
	StartedAt       *string       `json:"startedAt"`
	PausedReason    *string       `json:"pausedReason"`
	UpdatedAt       string        `json:"updatedAt"`
}

// MasteryQueueData is the persisted queue file.
type MasteryQueueData struct {
	SchemaVersion int                `json:"schemaVersion"`
	Campaign      MasteryCampaign    `json:"campaign"`
	Items         []MasteryQueueItem `json:"items"`
	UpdatedAt     string             `json:"updatedAt"`
}

// MasteryQueueCounts summarizes item phases.
type MasteryQueueCounts struct {
	Total     int `json:"total"`
	Queued    int `json:"queued"`
	Training  int `json:"training"`
	Blocked   int `json:"blocked"`
	Completed int `json:"completed"`
}

// MasteryQueueStatus is the /status response.
type MasteryQueueStatus struct {
	Campaign           MasteryCampaign    `json:"campaign"`
	Items              []MasteryQueueItem `json:"items"`
	Counts             MasteryQueueCounts `json:"counts"`
	ActiveItem         *MasteryQueueItem  `json:"activeItem"`
	NextActionableItem *MasteryQueueItem  `json:"nextActionableItem"`
}

// MasteryStatusResponse adds the scheduler state to the status payload.
type MasteryStatusResponse struct {
	MasteryQueueStatus
	Scheduler SchedulerStatus `json:"scheduler"`
}

// StepOutcome is the normalized result of one OperProgress execution.
type StepOutcome struct {
	ResultDetail         string     `json:"resultDetail"`
	Result               *string    `json:"result"`
	SkillMastery         []*float64 `json:"skillMastery"`
	RunID                *string    `json:"runId"`
	LogCheckpointPresent bool       `json:"logCheckpointPresent"`
	ErrorCode            *string    `json:"errorCode"`
	Message              *string    `json:"message"`
}

// ResultDetail is what extractResultDetail produces from MAA logs.
type ResultDetail struct {
	ResultDetail         string
	Result               *string
	SkillMastery         []*float64
	LogCheckpointPresent bool
}

// SchedulerStatus is the scheduler telemetry exposed on /status.
type SchedulerStatus struct {
	Running       bool    `json:"running"`
	TickMS        int64   `json:"tickMs"`
	LastTickAt    *string `json:"lastTickAt"`
	LastTickError *string `json:"lastTickError"`
	TickInFlight  bool    `json:"tickInFlight"`
}

// CampaignStatus values persisted in the queue file.
const (
	CampaignIdle        = "idle"
	CampaignRunning     = "running"
	CampaignPaused      = "paused"
	CampaignStopping    = "stopping"
	CampaignBlocked     = "blocked"
	CampaignCompleted   = "completed"
	CampaignInterrupted = "interrupted"
)

// Item phase values persisted in the queue file.
const (
	PhaseQueued      = "queued"
	PhaseStarting    = "starting"
	PhaseRunning     = "running"
	PhaseTraining    = "training"
	PhaseVerifying   = "verifying"
	PhaseBlocked     = "blocked"
	PhaseSkipped     = "skipped"
	PhaseCompleted   = "completed"
	PhaseFailed      = "failed"
	PhaseInterrupted = "interrupted"
)
