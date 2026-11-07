package results

import "strings"

type AwardItem struct {
	Key          string   `json:"key"`
	Label        string   `json:"label"`
	BeginTask    string   `json:"beginTask"`
	ClaimedTasks []string `json:"claimedTasks"`
}

type AwardExecutionAction struct {
	Task    string `json:"task"`
	Action  string `json:"action"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

var awardItems = []AwardItem{
	{Key: "award", Label: "日常与周常奖励", BeginTask: "AwardBegin", ClaimedTasks: []string{"ReceiveAward"}},
	{Key: "mail", Label: "邮件奖励", BeginTask: "MailBegin", ClaimedTasks: []string{"ReceiveMail"}},
	{Key: "recruit", Label: "限定寻访奖励", BeginTask: "RecruitingActivitiesBegin", ClaimedTasks: []string{"RecruitingActivitiesConfirm", "RecruitingActivitiesRecruit"}},
	{Key: "orundum", Label: "合成玉活动奖励", BeginTask: "OrundumActivitiesBegin", ClaimedTasks: []string{"OrundumActivitiesChoose", "OrundumActivitiesConfirm"}},
	{Key: "mining", Label: "采矿活动奖励", BeginTask: "MiningActivitiesBegin", ClaimedTasks: []string{"MiningActivities", "MiningActivitiesConfirm"}},
	{Key: "specialaccess", Label: "特别登录奖励", BeginTask: "SpecialAccessActivitiesBegin", ClaimedTasks: []string{"SpecialAccessActivitiesConfirm"}},
	{Key: "signinevent", Label: "限时签到奖励", BeginTask: "SignInEvent", ClaimedTasks: []string{"SignInEventAllClaimed"}},
}

// GetEnabledAwardItems keeps the configured switches that are strictly true,
// matching the scheduler's `record[key] === true` check.
func GetEnabledAwardItems(params any) []AwardItem {
	record := asRecord(params)
	enabled := make([]AwardItem, 0, len(awardItems))
	for _, item := range awardItems {
		if value, ok := record[item.Key].(bool); ok && value {
			enabled = append(enabled, item)
		}
	}
	return enabled
}

func hasTaskEvent(logSegment, taskName string) bool {
	return strings.Contains(logSegment, `"task":"`+taskName+`"`) ||
		strings.Contains(logSegment, `"what":"`+taskName+`"`)
}

func getTaskSegment(logOutput string, item AwardItem, next *AwardItem) (string, bool) {
	startMarker := `"first":["` + item.BeginTask + `"]`
	start := strings.Index(logOutput, startMarker)
	startLength := len(startMarker)
	if start == -1 {
		// Newer interface tasks (for example SignInEvent) do not always appear
		// as the first task of the Award chain. Fall back to the task name.
		start = strings.Index(logOutput, item.BeginTask)
		startLength = len(item.BeginTask)
	}
	if start == -1 {
		return "", false
	}

	if next == nil {
		return logOutput[start:], true
	}
	nextMarker := `"first":["` + next.BeginTask + `"]`
	end := strings.Index(logOutput[start+startLength:], nextMarker)
	if end == -1 {
		relative := strings.Index(logOutput[start+startLength:], next.BeginTask)
		if relative == -1 {
			return logOutput[start:], true
		}
		end = relative
	}
	end += start + startLength
	return logOutput[start:end], true
}

// ParseAwardExecutionActions reports per-item claim outcomes from the Award
// task chain log window.
func ParseAwardExecutionActions(taskName string, params any, logOutput string) []AwardExecutionAction {
	enabledItems := GetEnabledAwardItems(params)
	if len(enabledItems) == 0 {
		return []AwardExecutionAction{{
			Task:    taskName,
			Action:  "award",
			Status:  "skipped",
			Message: "未启用任何领取项目，已跳过",
		}}
	}

	actions := make([]AwardExecutionAction, 0)
	parsedItemCount := 0

	for _, item := range enabledItems {
		itemIndex := -1
		for index, candidate := range awardItems {
			if candidate.Key == item.Key {
				itemIndex = index
				break
			}
		}
		var next *AwardItem
		if itemIndex >= 0 && itemIndex+1 < len(awardItems) {
			nextItem := awardItems[itemIndex+1]
			next = &nextItem
		}

		segment, found := getTaskSegment(logOutput, item, next)
		if !found {
			if item.Key == "signinevent" {
				actions = append(actions, AwardExecutionAction{
					Task:    taskName,
					Action:  "award",
					Status:  "skipped",
					Message: "未检测到可领取的限时签到活动，已跳过",
				})
			}
			continue
		}
		parsedItemCount++

		if item.Key == "signinevent" {
			allClaimed := hasTaskEvent(segment, "SignInEventAllClaimed")
			processed := hasTaskEvent(segment, "SignInEvent")
			status := "skipped"
			message := "未检测到可领取的限时签到奖励，已跳过"
			if allClaimed {
				status = "success"
				message = "限时签到奖励已领取"
			} else if processed {
				status = "success"
				message = "已处理限时签到活动"
			}
			actions = append(actions, AwardExecutionAction{
				Task:    taskName,
				Action:  "award",
				Status:  status,
				Message: message,
			})
			continue
		}

		claimed := false
		for _, claimedTask := range item.ClaimedTasks {
			if hasTaskEvent(segment, claimedTask) {
				claimed = true
				break
			}
		}
		status := "skipped"
		message := item.Label + "无可领取内容或当前未开放，已跳过"
		if claimed {
			status = "success"
			message = item.Label + "已领取"
		}
		actions = append(actions, AwardExecutionAction{
			Task:    taskName,
			Action:  "award",
			Status:  status,
			Message: message,
		})
	}

	if parsedItemCount == 0 && len(actions) == 0 {
		return []AwardExecutionAction{{
			Task:    taskName,
			Action:  "award",
			Status:  "success",
			Message: "领取奖励流程已完成，共检查 " + itoa(len(enabledItems)) + " 项",
		}}
	}

	return actions
}
