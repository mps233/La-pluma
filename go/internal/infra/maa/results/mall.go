package results

import "strings"

type MallExecutionAction struct {
	Task            string `json:"task"`
	Action          string `json:"action"`
	Status          string `json:"status"`
	VisitedCount    int    `json:"visitedCount"`
	CreditCollected bool   `json:"creditCollected"`
	PurchasedCount  int    `json:"purchasedCount"`
	NoMoney         bool   `json:"noMoney"`
	VisitLimited    bool   `json:"visitLimited"`
	NoFriends       bool   `json:"noFriends"`
	Message         string `json:"message"`
}

func isMallDisabled(params any) bool {
	record := asRecord(params)
	return isFalse(record["visit_friends"]) &&
		isFalse(record["shopping"]) &&
		isFalse(record["credit_fight"])
}

func isFalse(value any) bool {
	boolean, ok := value.(bool)
	return ok && !boolean
}

func eventTaskValues(events []CallbackPayload) []any {
	values := make([]any, 0)
	for _, event := range events {
		details := asRecord(event.Details)
		if value, ok := details["task"]; ok && truthy(value) {
			values = append(values, value)
		}
		if recognized, ok := asAnySlice(details["to_be_recognized"]); ok {
			for _, value := range recognized {
				if truthy(value) {
					values = append(values, value)
				}
			}
		}
	}
	return values
}

func eventTaskValueListContains(values []any, target string) bool {
	for _, value := range values {
		if text, ok := value.(string); ok && text == target {
			return true
		}
	}
	return false
}

// ParseMallExecutionAction summarizes friend visits, credit collection and
// purchases from the Mall task chain.
func ParseMallExecutionAction(taskName string, params any, logOutput any) MallExecutionAction {
	if isMallDisabled(params) {
		return MallExecutionAction{
			Task:    taskName,
			Action:  "mall",
			Status:  "skipped",
			Message: "未启用好友访问、信用购物或信用作战，已跳过",
		}
	}

	events := ParseMaaCallbackEvents(logOutput, "Mall")
	if len(events) == 0 {
		return MallExecutionAction{
			Task:    taskName,
			Action:  "mall",
			Status:  "success",
			Message: "信用收支流程已完成",
		}
	}

	startEvents := make([]CallbackPayload, 0)
	taskNames := make([]string, 0)
	for _, event := range events {
		if event.Callback == "SubTaskStart" {
			startEvents = append(startEvents, event)
			if task, ok := asRecord(event.Details)["task"].(string); ok && task != "" {
				taskNames = append(taskNames, task)
			}
		}
	}
	eventTaskNames := eventTaskValues(events)

	visitedNext := 0
	visitedOCR := 0
	for _, task := range taskNames {
		switch task {
		case "VisitNext":
			visitedNext++
		case "VisitNextOcr":
			visitedOCR++
		}
	}
	// A single friend visit may emit both VisitNext and VisitNextOcr; take the
	// maximum instead of summing.
	visitedCount := visitedNext
	if visitedOCR > visitedNext {
		visitedCount = visitedOCR
	}
	creditCollected := eventTaskValueListContains(eventTaskNames, "CollectCredit")

	boughtEvents := 0
	buyItEvents := 0
	for _, event := range startEvents {
		details := asRecord(event.Details)
		task, _ := details["task"].(string)
		switch task {
		case "CreditShop-Bought":
			execTimes, present := details["exec_times"]
			if !present || numberEquals(execTimes, 1) {
				boughtEvents++
			}
		case "CreditShop-BuyIt":
			if action, ok := details["action"].(string); ok && action == "ClickSelf" {
				buyItEvents++
			}
		}
	}
	purchasedCount := boughtEvents
	if buyItEvents > 0 {
		purchasedCount = buyItEvents
	}
	noMoney := eventTaskValueListContains(eventTaskNames, "CreditShop-NoMoney")
	visitLimited := eventTaskValueListContains(eventTaskNames, "VisitLimited")
	noFriends := eventTaskValueListContains(eventTaskNames, "NoFriends")

	failed := false
	entered := false
	for _, event := range events {
		if event.Callback == "TaskChainError" {
			failed = true
		}
	}
	enteredTasks := []string{
		"MallBegin",
		"FriendsList",
		"StartToVisit",
		"Mall",
		"CreditStoreOcr",
		"CollectCredit",
		"CreditShop-BuyIt",
		"CreditShop-Bought",
	}
	for _, task := range eventTaskNames {
		if containsString(enteredTasks, stringValue(task)) {
			entered = true
			break
		}
	}

	action := MallExecutionAction{
		Task:            taskName,
		Action:          "mall",
		VisitedCount:    visitedCount,
		CreditCollected: creditCollected,
		PurchasedCount:  purchasedCount,
		NoMoney:         noMoney,
		VisitLimited:    visitLimited,
		NoFriends:       noFriends,
	}

	if failed {
		action.Status = "failed"
		if entered {
			action.Message = "信用收支处理过程中失败"
		} else {
			action.Message = "未能进入或识别好友或信用商店界面"
		}
		return action
	}

	details := make([]string, 0)
	if visitedCount > 0 {
		details = append(details, "访问 "+itoa(visitedCount)+" 位好友")
	}
	if creditCollected {
		details = append(details, "已领取信用")
	}
	if purchasedCount > 0 {
		details = append(details, "购买 "+itoa(purchasedCount)+" 件商品")
	}
	if noMoney {
		details = append(details, "信用不足")
	}
	if visitLimited {
		details = append(details, "好友访问已达上限")
	}
	if noFriends {
		details = append(details, "暂无可访问好友")
	}

	action.Status = "success"
	if len(details) > 0 {
		action.Message = "信用收支完成：" + strings.Join(details, "；")
	} else {
		action.Message = "信用收支流程已完成"
	}
	return action
}

func numberEquals(value any, expected float64) bool {
	number, ok := numberValue(value)
	return ok && number == expected
}
