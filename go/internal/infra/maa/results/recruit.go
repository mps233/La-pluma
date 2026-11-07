package results

import (
	"encoding/json"
	"strings"
)

type RecruitExecutionAction struct {
	Task                         string   `json:"task"`
	Action                       string   `json:"action"`
	Status                       string   `json:"status"`
	StartedCount                 int      `json:"startedCount"`
	CollectedCount               int      `json:"collectedCount"`
	ExpeditedCount               int      `json:"expeditedCount"`
	RefreshCount                 int      `json:"refreshCount"`
	HighestLevel                 float64  `json:"highestLevel"`
	DetectedTags                 []string `json:"detectedTags"`
	FinalTags                    []string `json:"finalTags"`
	PreservedTags                []string `json:"preservedTags"`
	PermitReserved               bool     `json:"permitReserved"`
	PermitReservedCount          any      `json:"permitReservedCount"`
	PermitCountRecognitionFailed bool     `json:"permitCountRecognitionFailed"`
	RefreshLimit                 *float64 `json:"refreshLimit"`
	NoRefresh                    bool     `json:"noRefresh"`
	Message                      string   `json:"message"`

	// partial matches the Node idle return, which only carries task/action/
	// status/message.
	partial bool
}

// MarshalJSON omits the operation counters for the idle no-callback result.
func (action RecruitExecutionAction) MarshalJSON() ([]byte, error) {
	if action.partial {
		return json.Marshal(struct {
			Task    string `json:"task"`
			Action  string `json:"action"`
			Status  string `json:"status"`
			Message string `json:"message"`
		}{
			Task:    action.Task,
			Action:  action.Action,
			Status:  action.Status,
			Message: action.Message,
		})
	}
	type fullAction RecruitExecutionAction
	return json.Marshal(fullAction(action))
}

func normalizePreserveTags(value any) []string {
	if values, ok := asAnySlice(value); ok {
		result := make([]string, 0, len(values))
		for _, item := range values {
			tag := strings.TrimSpace(stringValue(item))
			if tag != "" {
				result = append(result, tag)
			}
		}
		return result
	}

	text := truthyString(value)
	parts := strings.Split(text, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		tag := strings.TrimSpace(part)
		if tag != "" {
			result = append(result, tag)
		}
	}
	return result
}

func eventTags(events []CallbackPayload) []any {
	values := make([]any, 0)
	for _, event := range events {
		tags, ok := asAnySlice(asRecord(event.Details)["tags"])
		if !ok {
			continue
		}
		values = append(values, tags...)
	}
	return values
}

// ParseRecruitExecutionAction summarizes the Recruit task chain from MaaCore
// callbacks and configured preserve tags.
func ParseRecruitExecutionAction(taskName string, params any, logOutput any) RecruitExecutionAction {
	events := ParseMaaCallbackEvents(logOutput, "Recruit")
	if len(events) == 0 {
		return RecruitExecutionAction{
			Task:          taskName,
			Action:        "recruit",
			Status:        "success",
			DetectedTags:  []string{},
			FinalTags:     []string{},
			PreservedTags: []string{},
			Message:       "自动公招流程已完成",
			partial:       true,
		}
	}

	taskNames := make([]string, 0)
	detectedEvents := make([]CallbackPayload, 0)
	resultEvents := make([]CallbackPayload, 0)
	preservedEvents := make([]CallbackPayload, 0)
	permitReservedEvents := make([]CallbackPayload, 0)
	permitRecognitionFailedEvents := make([]CallbackPayload, 0)
	recruitErrorEvents := make([]CallbackPayload, 0)
	refreshCount := 0
	startedCount := 0
	collectedCount := 0
	expeditedCount := 0
	noPermit := false
	for _, event := range events {
		switch event.What {
		case "RecruitTagsDetected":
			detectedEvents = append(detectedEvents, event)
		case "RecruitResult":
			resultEvents = append(resultEvents, event)
		case "RecruitPreservedTag":
			preservedEvents = append(preservedEvents, event)
		case "RecruitPermitReserved":
			permitReservedEvents = append(permitReservedEvents, event)
		case "RecruitPermitCountRecognitionFailed":
			permitRecognitionFailedEvents = append(permitRecognitionFailedEvents, event)
		case "RecruitError":
			recruitErrorEvents = append(recruitErrorEvents, event)
		case "RecruitTagsRefreshed":
			refreshCount++
		case "RecruitNoPermit":
			noPermit = true
		}

		if event.Callback == "SubTaskStart" {
			if task, ok := asRecord(event.Details)["task"].(string); ok {
				taskNames = append(taskNames, task)
				switch task {
				case "RecruitConfirm":
					startedCount++
				case "RecruitFinish":
					collectedCount++
				case "RecruitNowConfirm":
					expeditedCount++
				}
			}
		}
	}
	noPermit = noPermit || containsString(taskNames, "RecruitNoPermit")
	noRefresh := containsString(taskNames, "RecruitNoRefresh")
	failed := false
	completed := false
	for _, event := range events {
		if event.Callback == "TaskChainError" {
			failed = true
		}
		if event.Callback == "TaskChainCompleted" {
			completed = true
		}
	}

	detectedTags := uniqueNonEmptyStrings(eventTags(detectedEvents))
	finalTags := []string{}
	if len(detectedEvents) > 0 {
		lastDetails := asRecord(detectedEvents[len(detectedEvents)-1].Details)
		if tags, ok := asAnySlice(lastDetails["tags"]); ok {
			finalTags = uniqueNonEmptyStrings(tags)
		}
	}

	highestLevel := 0.0
	for _, event := range resultEvents {
		level, ok := lookupNumber(asRecord(event.Details), "level")
		if !ok {
			level = 0
		}
		if level > highestLevel {
			highestLevel = level
		}
	}

	paramsRecord := asRecord(params)
	configuredPreserveTags := normalizePreserveTags(paramsRecord["preserve_tags"])
	preservedDetectedValues := make([]any, 0)
	for _, event := range preservedEvents {
		details := asRecord(event.Details)
		if tag, ok := details["tag"].(string); ok {
			preservedDetectedValues = append(preservedDetectedValues, tag)
			continue
		}
		if tags, ok := asAnySlice(details["tags"]); ok {
			preservedDetectedValues = append(preservedDetectedValues, tags...)
		}
	}
	preservedDetectedTags := uniqueNonEmptyStrings(preservedDetectedValues)
	preservedTags := make([]string, 0)
	for _, tag := range configuredPreserveTags {
		if containsString(preservedDetectedTags, tag) {
			preservedTags = append(preservedTags, tag)
		}
	}
	effectivePreservedTags := preservedTags
	if len(effectivePreservedTags) == 0 {
		effectivePreservedTags = preservedDetectedTags
	}

	var refreshLimit *float64
	for _, event := range recruitErrorEvents {
		limit, ok := lookupNumber(asRecord(event.Details), "refresh_limit")
		if !ok {
			continue
		}
		if limit != 0 {
			value := limit
			refreshLimit = &value
		}
		break
	}

	permitReservedCount := any(nil)
	if len(permitReservedEvents) > 0 {
		permitReservedCount = nativeNumber(coalesceValue(asRecord(permitReservedEvents[0].Details), "current"))
	}

	action := RecruitExecutionAction{
		Task:                         taskName,
		Action:                       "recruit",
		StartedCount:                 startedCount,
		CollectedCount:               collectedCount,
		ExpeditedCount:               expeditedCount,
		RefreshCount:                 refreshCount,
		HighestLevel:                 highestLevel,
		DetectedTags:                 detectedTags,
		FinalTags:                    finalTags,
		PreservedTags:                effectivePreservedTags,
		PermitReserved:               len(permitReservedEvents) > 0,
		PermitReservedCount:          permitReservedCount,
		PermitCountRecognitionFailed: len(permitRecognitionFailedEvents) > 0,
		RefreshLimit:                 refreshLimit,
		NoRefresh:                    noRefresh,
	}

	if failed {
		action.Status = "failed"
		if len(detectedEvents) > 0 {
			action.Message = "自动公招在标签处理过程中失败"
		} else {
			action.Message = "自动公招未能进入或识别公招界面"
		}
		return action
	}

	if action.PermitReserved {
		count := "未知"
		if action.PermitReservedCount != nil {
			count = stringValue(action.PermitReservedCount)
		}
		action.Status = "skipped"
		action.Message = "招聘许可已保留（当前 " + count + "），未开始新的公招"
		return action
	}

	if action.PermitCountRecognitionFailed {
		action.Status = "skipped"
		action.Message = "招聘许可数量识别失败，已跳过 3 星招募"
		return action
	}

	if action.RefreshLimit != nil {
		action.Status = "skipped"
		action.Message = "公招槽位刷新次数已达上限（" + stringValue(*action.RefreshLimit) + " 次）"
		return action
	}

	if startedCount > 0 || collectedCount > 0 || expeditedCount > 0 {
		operations := make([]string, 0)
		if startedCount > 0 {
			operations = append(operations, "开始 "+itoa(startedCount)+" 次招募")
		}
		if collectedCount > 0 {
			operations = append(operations, "收取 "+itoa(collectedCount)+" 次结果")
		}
		if expeditedCount > 0 {
			operations = append(operations, "加急 "+itoa(expeditedCount)+" 次")
		}
		if refreshCount > 0 {
			operations = append(operations, "刷新 "+itoa(refreshCount)+" 次")
		}
		if highestLevel > 0 {
			operations = append(operations, "最高 "+stringValue(highestLevel)+" 星组合")
		}
		if len(finalTags) > 0 {
			operations = append(operations, "最终标签："+strings.Join(finalTags, "、"))
		}

		action.Status = "success"
		action.Message = "公招处理完成：" + strings.Join(operations, "；")
		return action
	}

	if len(preservedEvents) > 0 {
		labels := strings.Join(effectivePreservedTags, "、")
		if labels == "" {
			labels = "高价值标签"
		}
		action.Status = "skipped"
		action.Message = "发现保留标签 " + labels + "，已保留该槽位"
		return action
	}

	if noPermit {
		action.Status = "skipped"
		action.Message = "招聘许可不足，未开始新的公招"
		return action
	}

	if len(detectedEvents) > 0 {
		action.Status = "skipped"
		if noRefresh {
			action.Message = "标签已识别，但没有可用刷新次数或未匹配自动确认条件"
		} else {
			action.Message = "标签已识别，但未匹配自动确认条件，已保留槽位"
		}
		return action
	}

	action.Status = "success"
	if completed {
		action.Status = "skipped"
		action.Message = "没有可处理的公招槽位，已跳过"
	} else {
		action.Message = "自动公招流程已完成"
	}
	return action
}
