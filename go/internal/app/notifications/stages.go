package notifications

import (
	"strings"
	"time"
)

type resourceStage struct {
	key    string
	name   string
	days   []int
	hidden bool
}

// resourceStages keeps the Node declaration order so open/closed lists remain
// stable and match the existing UI.
var resourceStages = []resourceStage{
	{key: "CE-6", name: "龙门币", days: []int{0, 2, 4, 6}},
	{key: "AP-5", name: "采购凭证", days: []int{0, 1, 3, 5}},
	{key: "CA-5", name: "技巧概要", days: []int{0, 2, 4, 6}},
	{key: "LS-6", name: "作战记录", days: []int{0, 1, 2, 3, 4, 5, 6}},

	{key: "PR-A", name: "重装/医疗芯片", days: []int{0, 1, 4, 5}},
	{key: "PR-A-1", name: "重装/医疗芯片", days: []int{0, 1, 4, 5}, hidden: true},
	{key: "PR-A-2", name: "重装/医疗芯片组", days: []int{0, 1, 4, 5}, hidden: true},
	{key: "PR-B", name: "狙击/术师芯片", days: []int{1, 2, 5, 6}},
	{key: "PR-B-1", name: "狙击/术师芯片", days: []int{1, 2, 5, 6}, hidden: true},
	{key: "PR-B-2", name: "狙击/术师芯片组", days: []int{1, 2, 5, 6}, hidden: true},
	{key: "PR-C", name: "先锋/辅助芯片", days: []int{0, 3, 4, 6}},
	{key: "PR-C-1", name: "先锋/辅助芯片", days: []int{0, 3, 4, 6}, hidden: true},
	{key: "PR-C-2", name: "先锋/辅助芯片组", days: []int{0, 3, 4, 6}, hidden: true},
	{key: "PR-D", name: "近卫/特种芯片", days: []int{0, 2, 3, 6}},
	{key: "PR-D-1", name: "近卫/特种芯片", days: []int{0, 2, 3, 6}, hidden: true},
	{key: "PR-D-2", name: "近卫/特种芯片组", days: []int{0, 2, 3, 6}, hidden: true},

	{key: "SK-5", name: "碳", days: []int{0, 1, 3, 5}},
}

var resourceStageIndex = func() map[string]resourceStage {
	index := make(map[string]resourceStage, len(resourceStages))
	for _, stage := range resourceStages {
		index[stage.key] = stage
	}
	return index
}()

// StageVisibility describes whether a daily resource stage is open today.
type StageVisibility struct {
	Stage  string `json:"stage"`
	Name   string `json:"name"`
	IsOpen bool   `json:"isOpen"`
}

// TodayOpenStages is the payload returned by getTodayOpenStages.
type TodayOpenStages struct {
	Weekday    int               `json:"weekday"`
	Date       string            `json:"date"`
	ClientType string            `json:"clientType"`
	Open       []StageVisibility `json:"open"`
	Closed     []StageVisibility `json:"closed"`
}

// StageOptions controls stage openness. A zero Now uses the current time.
type StageOptions struct {
	Now                    time.Time
	ClientType             string
	ResourceCollectionOpen bool
}

// GetTodayOpenStages lists visible daily resource stages split by openness.
// All resource stages are open when ResourceCollectionOpen is set.
func GetTodayOpenStages(options StageOptions) TodayOpenStages {
	now := options.Now
	if now.IsZero() {
		now = time.Now()
	}
	gameDay := GetGameDay(now, options.ClientType)
	clientType := options.ClientType
	if clientType == "" {
		clientType = "Official"
	}
	result := TodayOpenStages{
		Weekday:    gameDay.Weekday,
		Date:       gameDay.Date,
		ClientType: clientType,
		Open:       make([]StageVisibility, 0, len(resourceStages)),
		Closed:     make([]StageVisibility, 0, len(resourceStages)),
	}
	for _, stage := range resourceStages {
		if stage.hidden {
			continue
		}
		item := StageVisibility{
			Stage:  stage.key,
			Name:   stage.name,
			IsOpen: options.ResourceCollectionOpen || containsDay(stage.days, gameDay.Weekday),
		}
		if item.IsOpen {
			result.Open = append(result.Open, item)
		} else {
			result.Closed = append(result.Closed, item)
		}
	}
	return result
}

// StageOpenStatus mirrors isStageOpenToday. StageName is omitted for stages
// the game does not treat as daily resources.
type StageOpenStatus struct {
	IsOpen    bool    `json:"isOpen"`
	Reason    *string `json:"reason"`
	StageName *string `json:"stageName,omitempty"`
}

// IsStageOpenToday reports whether a resource stage is open today. Unknown
// stages are considered open because they are not daily resource stages.
func IsStageOpenToday(stage string, options StageOptions) StageOpenStatus {
	stageKey := strings.ToUpper(stage)
	info, ok := resourceStageIndex[stageKey]
	if !ok {
		return StageOpenStatus{IsOpen: true}
	}
	now := options.Now
	if now.IsZero() {
		now = time.Now()
	}
	today := GetGameDay(now, options.ClientType).Weekday
	isOpen := options.ResourceCollectionOpen || containsDay(info.days, today)
	status := StageOpenStatus{IsOpen: isOpen, StageName: stringPointer(info.name)}
	if !isOpen {
		status.Reason = stringPointer(info.name + "今日未开放")
	}
	return status
}

func containsDay(days []int, day int) bool {
	for _, value := range days {
		if value == day {
			return true
		}
	}
	return false
}

func stringPointer(value string) *string {
	return &value
}
