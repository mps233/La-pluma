package training

// JSON contracts mirror server/services/operatorTrainingService.ts and the
// client types in client/src/types/components.ts. Field names are part of the
// existing API; unknown extra properties on stored records are intentionally
// not echoed back unless noted.

// TrainingSettings is the persisted settings object. It is a map because the
// Go port, like the Node service, must preserve unknown settings keys written
// by older clients (e.g. autoAddRecognizedSixStars) and arbitrary overrides.
type TrainingSettings map[string]any

// OperatorFilters is the request filter accepted by GetOperatorList. The HTTP
// route parses rarity as a positive integer and owned as a boolean.
type OperatorFilters struct {
	Rarity      *int   `json:"rarity,omitempty"`
	Profession  string `json:"profession,omitempty"`
	Owned       *bool  `json:"owned,omitempty"`
	NeedsElite2 bool   `json:"needsElite2,omitempty"`
	Status      string `json:"status,omitempty"`
}

// OperatorCounts is the badge-count response.
type OperatorCounts struct {
	Trainable int `json:"trainable"`
	Owned     int `json:"owned"`
	All       int `json:"all"`
}

// MaterialRequirement is one entry in operator-materials.json.
type MaterialRequirement struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Count float64 `json:"count"`
}

// EliteMaterials is one promotion phase in operator-materials.json. Pointer
// slices distinguish an absent key (omitted, matching JSON.stringify of
// undefined) from an explicitly empty array.
type EliteMaterials struct {
	LMD       *float64               `json:"lmd,omitempty"`
	Materials *[]MaterialRequirement `json:"materials,omitempty"`
	Chips     *[]MaterialRequirement `json:"chips,omitempty"`
}

// OperatorMaterialsBundle is the materials object returned by the operator
// list. A nil bundle is serialized as null.
type OperatorMaterialsBundle struct {
	Elite1 *EliteMaterials `json:"elite1,omitempty"`
	Elite2 *EliteMaterials `json:"elite2,omitempty"`
}

// TrainingOperator is one row of GET /api/agent/training/operators.
type TrainingOperator struct {
	ID              string                   `json:"id"`
	Name            string                   `json:"name"`
	Rarity          float64                  `json:"rarity"`
	Profession      string                   `json:"profession"`
	Position        *string                  `json:"position,omitempty"`
	CurrentElite    float64                  `json:"currentElite"`
	CurrentLevel    float64                  `json:"currentLevel"`
	TargetElite     float64                  `json:"targetElite"`
	Owned           bool                     `json:"owned"`
	Potential       float64                  `json:"potential"`
	HasMaterialData bool                     `json:"hasMaterialData"`
	Materials       *OperatorMaterialsBundle `json:"materials"`
	CanTrain        bool                     `json:"canTrain"`
	DisabledReason  *string                  `json:"disabledReason"`
	TrainingStatus  string                   `json:"trainingStatus"`
}

// QueueItem is a stored training queue entry. CurrentElite and friends are
// "any" because the Node service persists whatever the client sent and only
// normalizes while calculating.
type QueueItem struct {
	OperatorID   string `json:"operatorId"`
	CurrentElite any    `json:"currentElite,omitempty"`
	TargetElite  any    `json:"targetElite,omitempty"`
	Priority     any    `json:"priority,omitempty"`
	Status       any    `json:"status,omitempty"`
	AddedAt      any    `json:"addedAt,omitempty"`
}

// QueueOperator is the summary embedded in enriched queue items.
type QueueOperator struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Rarity     float64 `json:"rarity"`
	Profession *string `json:"profession,omitempty"`
}

// CalculatedMaterial is one aggregated material requirement.
type CalculatedMaterial struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Needed      float64 `json:"needed"`
	Have        float64 `json:"have"`
	StillNeeded float64 `json:"stillNeeded"`
}

// LMDRequirement is the LMD portion of a calculation.
type LMDRequirement struct {
	Needed      float64 `json:"needed"`
	Have        float64 `json:"have"`
	StillNeeded float64 `json:"stillNeeded"`
}

// EnrichedQueueItem is one row of GET /api/agent/training/queue.
type EnrichedQueueItem struct {
	QueueItem
	Operator   QueueOperator        `json:"operator"`
	Materials  []CalculatedMaterial `json:"materials"`
	LMD        LMDRequirement       `json:"lmd"`
	IsComplete bool                 `json:"isComplete"`
	Progress   int                  `json:"progress"`
}

// TrainingQueueResult is the GET /api/agent/training/queue response.
type TrainingQueueResult struct {
	Queue       []EnrichedQueueItem `json:"queue"`
	Settings    TrainingSettings    `json:"settings"`
	LastUpdated string              `json:"lastUpdated"`
}

// AddToQueueOptions carries the optional elite overrides from the request.
// nil means "not provided" (JavaScript null/undefined).
type AddToQueueOptions struct {
	CurrentElite any `json:"currentElite,omitempty"`
	TargetElite  any `json:"targetElite,omitempty"`
}

// AddToQueueRequest mirrors POST /api/agent/training/queue.
type AddToQueueRequest struct {
	OperatorID   string `json:"operatorId"`
	CurrentElite any    `json:"currentElite,omitempty"`
	TargetElite  any    `json:"targetElite,omitempty"`
}

// UpdateQueueOrderRequest mirrors PUT /api/agent/training/queue/order.
type UpdateQueueOrderRequest struct {
	OperatorIDs []string `json:"operatorIds"`
}

// GeneratePlanRequest mirrors POST /api/agent/training/plan.
type GeneratePlanRequest struct {
	Mode       string `json:"mode,omitempty"`
	ClientType string `json:"clientType,omitempty"`
}

// ApplyPlanRequest mirrors POST /api/agent/actions/apply-training-plan.
type ApplyPlanRequest struct {
	Plan     TrainingPlan   `json:"plan"`
	Settings map[string]any `json:"settings,omitempty"`
}

// PlanOperator is one operator section of a generated plan.
type PlanOperator struct {
	ID           string               `json:"id"`
	Name         string               `json:"name"`
	Rarity       float64              `json:"rarity"`
	Profession   *string              `json:"profession,omitempty"`
	CurrentElite float64              `json:"currentElite"`
	TargetElite  float64              `json:"targetElite"`
	Materials    []CalculatedMaterial `json:"materials"`
}

// MaterialHierarchyNode is one node of the expanded material tree.
type MaterialHierarchyNode struct {
	ID          string                  `json:"id"`
	Name        string                  `json:"name"`
	IconID      string                  `json:"iconId"`
	Needed      float64                 `json:"needed"`
	Have        float64                 `json:"have"`
	StillNeeded float64                 `json:"stillNeeded"`
	Children    []MaterialHierarchyNode `json:"children"`
}

// StageMaterialNeed is one material attributed to a stage.
type StageMaterialNeed struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Count float64 `json:"count"`
}

// StageOpenInfo is the isStageOpenToday() result embedded in plan stages.
type StageOpenInfo struct {
	IsOpen    bool    `json:"isOpen"`
	Reason    *string `json:"reason"`
	StageName string  `json:"stageName,omitempty"`
}

// ResourceStageStatus is one entry of the today-open resource stage summary.
type ResourceStageStatus struct {
	Stage  string `json:"stage"`
	Name   string `json:"name"`
	IsOpen bool   `json:"isOpen"`
}

// TodayOpenStages is the getTodayOpenStages() result.
type TodayOpenStages struct {
	Weekday    int                   `json:"weekday"`
	Date       string                `json:"date"`
	ClientType string                `json:"clientType"`
	Open       []ResourceStageStatus `json:"open"`
	Closed     []ResourceStageStatus `json:"closed"`
}

// TrainingStage is one stage group in a plan. TotalTimes/Times are pointers so
// apply requests can distinguish an explicit 0 from an absent key, matching
// the Node nullish-coalescing logic.
type TrainingStage struct {
	Stage      string              `json:"stage"`
	Materials  []StageMaterialNeed `json:"materials"`
	TotalTimes *float64            `json:"totalTimes,omitempty"`
	Times      *float64            `json:"times,omitempty"`
	Sanity     float64             `json:"sanity"`
	IsOpen     any                 `json:"isOpen"`
}

// PlanSummary is the plan badge summary.
type PlanSummary struct {
	BacklogCount              int                   `json:"backlogCount"`
	OpenStageCount            int                   `json:"openStageCount"`
	ClosedStageCount          int                   `json:"closedStageCount"`
	TodayOpenResourceStages   []ResourceStageStatus `json:"todayOpenResourceStages"`
	TodayClosedResourceStages []ResourceStageStatus `json:"todayClosedResourceStages"`
}

// TrainingPlan is both the generated response and the apply-request plan.
// Pointer slices preserve the Node response shape, where the "all materials
// collected" branch omits mode/summary/openStages and the regular branch omits
// materials.
type TrainingPlan struct {
	Operators         []PlanOperator          `json:"operators"`
	Materials         *[]CalculatedMaterial   `json:"materials,omitempty"`
	MaterialHierarchy []MaterialHierarchyNode `json:"materialHierarchy"`
	Stages            []TrainingStage         `json:"stages"`
	OpenStages        *[]TrainingStage        `json:"openStages,omitempty"`
	ClosedStages      *[]TrainingStage        `json:"closedStages,omitempty"`
	FocusOperator     *PlanOperator           `json:"focusOperator,omitempty"`
	TotalSanity       int                     `json:"totalSanity"`
	EstimatedTime     *int                    `json:"estimatedTime,omitempty"`
	Warnings          []string                `json:"warnings"`
	Mode              string                  `json:"mode,omitempty"`
	Summary           *PlanSummary            `json:"summary,omitempty"`
}

// ApplyPlanResult is the apply-training-plan response.
type ApplyPlanResult struct {
	Success     bool `json:"success"`
	StageCount  int  `json:"stageCount"`
	TotalStages int  `json:"totalStages"`
	HasFallback bool `json:"hasFallback"`
}

// FetchMaterialScriptResult mirrors one successful Node script result.
type FetchMaterialScriptResult struct {
	Script string `json:"script"`
	OK     bool   `json:"ok"`
	Stdout string `json:"stdout"`
	Stderr string `json:"stderr"`
}

// FetchMaterialsResponse mirrors the Node success payload.
type FetchMaterialsResponse struct {
	Success bool                        `json:"success"`
	Scripts []FetchMaterialScriptResult `json:"scripts"`
}
