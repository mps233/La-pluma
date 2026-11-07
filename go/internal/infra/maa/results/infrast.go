package results

import (
	"encoding/json"
	"regexp"
	"strings"
)

type InfrastProduct struct {
	Facility any `json:"facility"`
	Index    any `json:"index"`
	Product  any `json:"product"`
}

type InfrastRoomIssue struct {
	Facility any `json:"facility"`
	Index    any `json:"index"`
	Reason   any `json:"reason"`
}

type InfrastRoomNotice struct {
	Facility any `json:"facility"`
	Index    any `json:"index"`
}

type InfrastExecutionAction struct {
	Task                 string              `json:"task"`
	Action               string              `json:"action"`
	Status               string              `json:"status"`
	ConfiguredFacilities []string            `json:"configuredFacilities"`
	ObservedFacilities   []string            `json:"observedFacilities"`
	RewardCollected      bool                `json:"rewardCollected"`
	RotationApplied      bool                `json:"rotationApplied"`
	DroneUsed            bool                `json:"droneUsed"`
	CluesReceived        int                 `json:"cluesReceived"`
	CluesSent            int                 `json:"cluesSent"`
	ClueExchange         bool                `json:"clueExchange"`
	TrainingContinued    bool                `json:"trainingContinued"`
	TrainingCompleted    bool                `json:"trainingCompleted"`
	TrainingProcessing   bool                `json:"trainingProcessing"`
	Products             []InfrastProduct    `json:"products"`
	KeptUnchanged        []InfrastRoomIssue  `json:"keptUnchanged"`
	NotEnoughStaff       []InfrastRoomNotice `json:"notEnoughStaff"`
	Message              string              `json:"message"`

	// partial matches the Node early returns, which omit operation fields
	// when nothing was observed.
	partial bool
}

// MarshalJSON keeps skipped/early results to the Node key set while success
// and failure results carry the full operation shape.
func (action InfrastExecutionAction) MarshalJSON() ([]byte, error) {
	if action.partial {
		return json.Marshal(struct {
			Task                 string   `json:"task"`
			Action               string   `json:"action"`
			Status               string   `json:"status"`
			ConfiguredFacilities []string `json:"configuredFacilities"`
			ObservedFacilities   []string `json:"observedFacilities"`
			Message              string   `json:"message"`
		}{
			Task:                 action.Task,
			Action:               action.Action,
			Status:               action.Status,
			ConfiguredFacilities: action.ConfiguredFacilities,
			ObservedFacilities:   action.ObservedFacilities,
			Message:              action.Message,
		})
	}
	type fullAction InfrastExecutionAction
	return json.Marshal(fullAction(action))
}

var facilityLabels = map[string]string{
	"Mfg":        "制造站",
	"Trade":      "贸易站",
	"Power":      "发电站",
	"Control":    "控制中枢",
	"Reception":  "会客室",
	"Office":     "办公室",
	"Dorm":       "宿舍",
	"Processing": "加工站",
	"Training":   "训练室",
}

// facilityClasses is ordered because the Node code picks the first matching
// class name via Object.keys insertion order.
var facilityClasses = []struct {
	Class string
	Code  string
}{
	{Class: "InfrastMfgTask", Code: "Mfg"},
	{Class: "InfrastTradeTask", Code: "Trade"},
	{Class: "InfrastPowerTask", Code: "Power"},
	{Class: "InfrastControlTask", Code: "Control"},
	{Class: "InfrastReceptionTask", Code: "Reception"},
	{Class: "InfrastOfficeTask", Code: "Office"},
	{Class: "InfrastDormTask", Code: "Dorm"},
	{Class: "InfrastProcessingTask", Code: "Processing"},
	{Class: "InfrastTrainingTask", Code: "Training"},
}

var (
	clueGiveTaskPattern     = regexp.MustCompile(`^ClueGiveTo\d+(?:st|nd|rd|th)Confirm$`)
	trainingContinuePattern = regexp.MustCompile(`^InfrastTrainingContinue\d+$`)
)

var relevantRoomIssues = []string{
	"CustomInfrastRoomKeptUnchanged",
	"CustomInfrastRoomsNotConfigured",
	"CustomInfrastTraineeNotFound",
	"CustomInfrastAssistantNotFound",
	"CustomInfrastRoomGroupsMatchFailed",
}

// ParseInfrastExecutionAction summarizes only operations observed in the
// Infrast task chain callbacks; it never infers unobserved facility work.
func ParseInfrastExecutionAction(taskName string, params any, logOutput any) InfrastExecutionAction {
	paramsRecord := asRecord(params)
	configuredFacilities := []string{}
	if values, ok := asAnySlice(paramsRecord["facility"]); ok {
		mapped := make([]string, len(values))
		for index, value := range values {
			mapped[index] = stringValue(value)
		}
		configuredFacilities = uniqueStrings(mapped)
	}

	events := ParseMaaCallbackEvents(logOutput, "Infrast")

	if len(configuredFacilities) == 0 {
		return InfrastExecutionAction{
			Task:                 taskName,
			Action:               "infrast",
			Status:               "skipped",
			ConfiguredFacilities: []string{},
			ObservedFacilities:   []string{},
			Products:             []InfrastProduct{},
			KeptUnchanged:        []InfrastRoomIssue{},
			NotEnoughStaff:       []InfrastRoomNotice{},
			Message:              "未选择任何基建设施，已跳过",
			partial:              true,
		}
	}

	if len(events) == 0 {
		return InfrastExecutionAction{
			Task:                 taskName,
			Action:               "infrast",
			Status:               "success",
			ConfiguredFacilities: configuredFacilities,
			ObservedFacilities:   []string{},
			Products:             []InfrastProduct{},
			KeptUnchanged:        []InfrastRoomIssue{},
			NotEnoughStaff:       []InfrastRoomNotice{},
			Message:              "基建流程已完成，按配置处理 " + itoa(len(configuredFacilities)) + " 类设施",
			partial:              true,
		}
	}

	startEvents := make([]CallbackPayload, 0)
	taskNames := make([]string, 0)
	structuredFacilities := make([]string, 0)
	for _, event := range events {
		if event.Callback == "SubTaskStart" {
			startEvents = append(startEvents, event)
			if task, ok := asRecord(event.Details)["task"].(string); ok {
				taskNames = append(taskNames, task)
			}
		}
		if event.What == "EnterFacility" {
			if facility := trimTruthyString(event.Details["facility"]); facility != "" {
				structuredFacilities = append(structuredFacilities, facility)
			}
		}
	}

	observed := make([]string, 0)
	for _, event := range startEvents {
		className := truthyString(event.Class)
		for _, candidate := range facilityClasses {
			if strings.Contains(className, candidate.Class) {
				observed = append(observed, candidate.Code)
				break
			}
		}
	}
	observed = append(observed, structuredFacilities...)
	observedFacilities := uniqueStrings(observed)

	products := make([]InfrastProduct, 0)
	keptUnchanged := make([]InfrastRoomIssue, 0)
	notEnoughStaff := make([]InfrastRoomNotice, 0)
	for _, event := range events {
		details := event.Details
		switch event.What {
		case "ProductOfFacility":
			product := firstTruthy(details["product"])
			if product == nil {
				continue
			}
			products = append(products, InfrastProduct{
				Facility: firstTruthy(details["facility"]),
				Index:    indexOrNil(details["index"]),
				Product:  product,
			})
		case "NotEnoughStaff":
			notEnoughStaff = append(notEnoughStaff, InfrastRoomNotice{
				Facility: firstTruthy(details["facility"]),
				Index:    indexOrNil(details["index"]),
			})
		default:
			if containsString(relevantRoomIssues, event.What) {
				reason := firstTruthy(details["reason"])
				if reason == nil {
					reason = event.What
				}
				keptUnchanged = append(keptUnchanged, InfrastRoomIssue{
					Facility: firstTruthy(details["facility"]),
					Index:    indexOrNil(details["index"]),
					Reason:   reason,
				})
			}
		}
	}

	failed := false
	for _, event := range events {
		if event.Callback == "TaskChainError" {
			failed = true
			break
		}
	}
	entered := containsString(taskNames, "InfrastEnteredFlag") ||
		containsString(taskNames, "InfrastNotification") ||
		len(observedFacilities) > 0
	rewardCollected := containsString(taskNames, "InfrastReward")
	rotationApplied := containsString(taskNames, "InfrastRotationClick") ||
		containsString(taskNames, "InfrastConfirmButton") ||
		containsString(taskNames, "InfrastDormConfirmButton")
	droneUsed := containsString(taskNames, "DroneConfirm")
	cluesReceived := countTasks(taskNames, []string{
		"GetSelfClue",
		"GetFriendClue",
		"InfrastReceptionMessageBoard-Received",
	})
	cluesSent := countMatchingTasks(taskNames, clueGiveTaskPattern)
	clueExchange := containsString(taskNames, "InfrastClueQuickInsertConfirm") ||
		containsString(taskNames, "UnlockClues") ||
		containsString(taskNames, "EndOfClueExchange")
	trainingContinued := countMatchingTasks(taskNames, trainingContinuePattern) > 0
	trainingCompleted := containsString(taskNames, "InfrastTrainingCompleted")
	trainingProcessing := containsString(taskNames, "InfrastTrainingProcessing")

	action := InfrastExecutionAction{
		Task:                 taskName,
		Action:               "infrast",
		ConfiguredFacilities: configuredFacilities,
		ObservedFacilities:   observedFacilities,
		RewardCollected:      rewardCollected,
		RotationApplied:      rotationApplied,
		DroneUsed:            droneUsed,
		CluesReceived:        cluesReceived,
		CluesSent:            cluesSent,
		ClueExchange:         clueExchange,
		TrainingContinued:    trainingContinued,
		TrainingCompleted:    trainingCompleted,
		TrainingProcessing:   trainingProcessing,
		Products:             products,
		KeptUnchanged:        keptUnchanged,
		NotEnoughStaff:       notEnoughStaff,
	}

	if failed {
		action.Status = "failed"
		if entered {
			action.Message = "基建处理过程中失败"
		} else {
			action.Message = "未能进入或识别基建界面"
		}
		return action
	}

	details := make([]string, 0)
	if rewardCollected {
		details = append(details, "已收取产物")
	}
	if rotationApplied {
		details = append(details, "已执行换班")
	}
	if droneUsed {
		details = append(details, "已使用无人机")
	}
	if cluesReceived > 0 {
		details = append(details, "收取 "+itoa(cluesReceived)+" 次线索")
	}
	if cluesSent > 0 {
		details = append(details, "赠送 "+itoa(cluesSent)+" 次线索")
	}
	if clueExchange {
		details = append(details, "已处理线索交流")
	}
	if trainingContinued {
		details = append(details, "已继续专精训练")
	} else if trainingCompleted {
		details = append(details, "专精训练已完成")
	} else if trainingProcessing {
		details = append(details, "专精训练进行中")
	}
	if len(products) > 0 {
		details = append(details, "已识别 "+itoa(len(products))+" 个设施产物")
	}
	if len(keptUnchanged) > 0 {
		details = append(details, itoa(len(keptUnchanged))+" 个房间保持原样")
	}
	if len(notEnoughStaff) > 0 {
		details = append(details, itoa(len(notEnoughStaff))+" 个设施可用干员不足")
	}
	if len(observedFacilities) > 0 {
		labels := make([]string, len(observedFacilities))
		for index, facility := range observedFacilities {
			if label := facilityLabels[facility]; label != "" {
				labels[index] = label
			} else {
				labels[index] = facility
			}
		}
		details = append(details, "已处理："+strings.Join(labels, "、"))
	}

	action.Status = "success"
	if len(details) > 0 {
		action.Message = "基建流程完成：" + strings.Join(details, "；")
	} else {
		action.Message = "基建流程已完成，按配置处理 " + itoa(len(configuredFacilities)) + " 类设施"
	}
	return action
}

func countTasks(taskNames, candidates []string) int {
	count := 0
	for _, task := range taskNames {
		if containsString(candidates, task) {
			count++
		}
	}
	return count
}

func countMatchingTasks(taskNames []string, pattern *regexp.Regexp) int {
	count := 0
	for _, task := range taskNames {
		if pattern.MatchString(task) {
			count++
		}
	}
	return count
}
