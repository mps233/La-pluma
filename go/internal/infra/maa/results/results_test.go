package results

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func callbackLine(t *testing.T, taskchain, callbackType string, payload map[string]any) string {
	t.Helper()
	payload["taskchain"] = taskchain
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal callback payload: %v", err)
	}
	return "[INF] Assistant::append_callback | " + callbackType + " " + string(encoded)
}

func TestParseMaaCallbackEvents(t *testing.T) {
	log := strings.Join([]string{
		"[INF] Assistant::append_callback | SubTaskStart { \"taskchain\": \"Recruit\", \"details\": { \"task\": \"RecruitConfirm\" } }",
		`[INF] Assistant::append_callback | TaskChainCompleted {"taskchain":"Recruit","details":{}}`,
	}, "\n")

	events := ParseMaaCallbackEvents(log, "Recruit")
	if len(events) != 2 {
		t.Fatalf("events = %d, want 2", len(events))
	}
	if events[0].Callback != "SubTaskStart" || events[0].Taskchain != "Recruit" {
		t.Fatalf("unexpected first event: %+v", events[0])
	}
	if events[0].Details["task"] != "RecruitConfirm" {
		t.Fatalf("details.task = %v", events[0].Details["task"])
	}
	if events[1].Callback != "TaskChainCompleted" {
		t.Fatalf("second callback = %q", events[1].Callback)
	}

	filtered := ParseMaaCallbackEvents(strings.Join([]string{
		"[INF] ordinary log line",
		callbackLine(t, "Mall", "SubTaskStart", map[string]any{"details": map[string]any{}}),
		callbackLine(t, "Recruit", "SubTaskStart", map[string]any{"details": map[string]any{}}),
	}, "\n"), "Recruit")
	if len(filtered) != 1 || filtered[0].Taskchain != "Recruit" {
		t.Fatalf("filtered events: %+v", filtered)
	}
}

func TestParseMaaCallbackEventsSkipsIncompleteLines(t *testing.T) {
	log := strings.Join([]string{
		`[INF] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit"`,
		"[INF] Assistant::append_callback | SubTaskStart not-json",
		`[INF] Assistant::append_callback | TaskChainCompleted {"taskchain":"Recruit"}`,
	}, "\n")

	events := ParseMaaCallbackEvents(log, "Recruit")
	if len(events) != 1 || events[0].Callback != "TaskChainCompleted" {
		t.Fatalf("events = %+v", events)
	}
}

func TestSummarizeFightCallbacks(t *testing.T) {
	stageDrops, err := json.Marshal(map[string]any{
		"what":      "StageDrops",
		"taskchain": "Fight",
		"details": map[string]any{
			"stage": map[string]any{"stageCode": "1-7", "stageId": "main_01-07"},
			"stats": []any{
				map[string]any{"addQuantity": 2, "itemId": "30012", "itemName": "合成玉", "quantity": 2},
				map[string]any{"addQuantity": 1, "itemId": "30041", "itemName": "合成玉", "quantity": 1},
				map[string]any{"addQuantity": 72, "itemId": "4001", "itemName": "合成玉", "quantity": 72},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	fightTimes, _ := json.Marshal(map[string]any{
		"what":      "FightTimes",
		"taskchain": "Fight",
		"details":   map[string]any{"sanity_cost": 6, "series": 1, "times_finished": 0},
	})
	log := "[INF] Assistant::append_callback | SubTaskExtraInfo " + string(stageDrops) +
		"\n[INF] Assistant::append_callback | SubTaskExtraInfo " + string(fightTimes)

	summary := SummarizeFightCallbacks(log)
	if summary.Stage == nil || *summary.Stage != "1-7" {
		t.Fatalf("stage = %v", summary.Stage)
	}
	if summary.SanityUsed != 6 {
		t.Fatalf("sanityUsed = %v", summary.SanityUsed)
	}
	if len(summary.Items) != 3 {
		t.Fatalf("items = %+v", summary.Items)
	}
	if summary.Items[0].ItemID != "30012" || summary.Items[0].Count != 2 {
		t.Fatalf("first item = %+v", summary.Items[0])
	}
	if summary.Items[2].ItemID != "4001" || summary.Items[2].Count != 72 {
		t.Fatalf("third item = %+v", summary.Items[2])
	}
}

func TestSummarizeFightCallbacksFallsBackToSanityBeforeStage(t *testing.T) {
	log := callbackLine(t, "Fight", "SubTaskExtraInfo", map[string]any{
		"what":    "SanityBeforeStage",
		"details": map[string]any{"current_sanity": 45, "max_sanity": 210},
	}) + "\n" + callbackLine(t, "Fight", "SubTaskExtraInfo", map[string]any{
		"what":    "SanityBeforeStage",
		"details": map[string]any{"current_sanity": 39, "max_sanity": 210},
	})

	summary := SummarizeFightCallbacks(log)
	if summary.SanityUsed != 6 {
		t.Fatalf("sanityUsed = %v", summary.SanityUsed)
	}
	if summary.SanityBefore == nil || *summary.SanityBefore != 45 {
		t.Fatalf("sanityBefore = %v", summary.SanityBefore)
	}
	if summary.SanityAfter == nil || *summary.SanityAfter != 39 {
		t.Fatalf("sanityAfter = %v", summary.SanityAfter)
	}
}

func TestSummarizeAuxiliaryCallbacks(t *testing.T) {
	log := strings.Join([]string{
		callbackLine(t, "Custom", "SubTaskExtraInfo", map[string]any{"what": "BlackFlowStartRun", "details": map[string]any{"status": "preparing"}}),
		callbackLine(t, "Custom", "SubTaskExtraInfo", map[string]any{"what": "BlackFlowStartRun", "details": map[string]any{"status": "completed", "rewards": []any{"合成玉"}}}),
		callbackLine(t, "Custom", "SubTaskExtraInfo", map[string]any{"what": "BlackFlowScrapTradeAborted", "details": map[string]any{"reason": "not_enough_currency", "item": "合成玉"}}),
		callbackLine(t, "Custom", "SubTaskExtraInfo", map[string]any{"what": "CopilotPrecheckFile", "details": map[string]any{"nav_name": "CE-6", "filename": "/tmp/ce6.json"}}),
		callbackLine(t, "Custom", "SubTaskExtraInfo", map[string]any{"what": "StageInfoError", "details": map[string]any{}}),
		callbackLine(t, "Custom", "SubTaskExtraInfo", map[string]any{"what": "UnsupportedLevel", "details": map[string]any{"level": "XX-99"}}),
		callbackLine(t, "Custom", "SubTaskExtraInfo", map[string]any{"what": "RecruitSpecialTag", "details": map[string]any{"tag": "高级资深干员"}}),
		callbackLine(t, "Custom", "SubTaskExtraInfo", map[string]any{"what": "RecruitTagsSelected", "details": map[string]any{"tags": []any{"高级资深干员", "远程位"}}}),
	}, "\n")

	aux := SummarizeAuxiliaryCallbacks(log)
	if len(aux.BlackflowStartRun) != 2 {
		t.Fatalf("blackflowStartRun = %+v", aux.BlackflowStartRun)
	}
	if len(aux.BlackflowStartRun[0].Rewards) != 0 || len(aux.BlackflowStartRun[1].Rewards) != 1 {
		t.Fatalf("rewards = %+v", aux.BlackflowStartRun)
	}
	if len(aux.BlackflowScrapTradeAborted) != 1 || aux.BlackflowScrapTradeAborted[0].Reason != "not_enough_currency" {
		t.Fatalf("aborted = %+v", aux.BlackflowScrapTradeAborted)
	}
	if len(aux.CopilotPrecheckFile) != 1 || aux.CopilotPrecheckFile[0].NavName != "CE-6" {
		t.Fatalf("precheck = %+v", aux.CopilotPrecheckFile)
	}
	if len(aux.StageInfo) != 0 || aux.StageInfoErrors != 1 {
		t.Fatalf("stageInfo = %+v errors=%d", aux.StageInfo, aux.StageInfoErrors)
	}
	if len(aux.UnsupportedLevels) != 1 || aux.UnsupportedLevels[0] != "XX-99" {
		t.Fatalf("unsupported = %+v", aux.UnsupportedLevels)
	}
	if len(aux.RecruitSpecialTags) != 1 || aux.RecruitSpecialTags[0] != "高级资深干员" {
		t.Fatalf("special tags = %+v", aux.RecruitSpecialTags)
	}
	if len(aux.RecruitSelectedTags) != 1 || len(aux.RecruitSelectedTags[0]) != 2 {
		t.Fatalf("selected tags = %+v", aux.RecruitSelectedTags)
	}
	if len(aux.ConnectionEvents) != 0 {
		t.Fatalf("connection events = %+v", aux.ConnectionEvents)
	}
}

func TestInfrastExecutionResults(t *testing.T) {
	t.Run("summarizes observed operations", func(t *testing.T) {
		log := strings.Join([]string{
			callbackLine(t, "Infrast", "SubTaskStart", map[string]any{"class": "asst::InfrastMfgTask", "details": map[string]any{}}),
			callbackLine(t, "Infrast", "SubTaskStart", map[string]any{"details": map[string]any{"task": "InfrastReward"}}),
			callbackLine(t, "Infrast", "SubTaskStart", map[string]any{"details": map[string]any{"task": "InfrastConfirmButton"}}),
			callbackLine(t, "Infrast", "SubTaskStart", map[string]any{"details": map[string]any{"task": "DroneConfirm"}}),
			callbackLine(t, "Infrast", "TaskChainCompleted", map[string]any{"details": map[string]any{}}),
		}, "\n")

		action := ParseInfrastExecutionAction("基建换班", map[string]any{"facility": []any{"Mfg", "Trade"}}, log)
		if action.Status != "success" {
			t.Fatalf("status = %q", action.Status)
		}
		if len(action.ObservedFacilities) != 1 || action.ObservedFacilities[0] != "Mfg" {
			t.Fatalf("observed = %+v", action.ObservedFacilities)
		}
		if !action.RewardCollected || !action.RotationApplied || !action.DroneUsed {
			t.Fatalf("flags = %+v", action)
		}
		if !strings.Contains(action.Message, "已收取产物") {
			t.Fatalf("message = %q", action.Message)
		}
	})

	t.Run("uses structured room events", func(t *testing.T) {
		log := strings.Join([]string{
			callbackLine(t, "Infrast", "SubTaskExtraInfo", map[string]any{"what": "EnterFacility", "details": map[string]any{"facility": "Recycle", "index": 1}}),
			callbackLine(t, "Infrast", "SubTaskExtraInfo", map[string]any{"what": "ProductOfFacility", "details": map[string]any{"facility": "Mfg", "index": 2, "product": "Battle Record"}}),
			callbackLine(t, "Infrast", "SubTaskExtraInfo", map[string]any{"what": "CustomInfrastRoomKeptUnchanged", "details": map[string]any{"facility": "Training", "index": 1, "reason": "candidates_low_mood"}}),
			callbackLine(t, "Infrast", "SubTaskExtraInfo", map[string]any{"what": "NotEnoughStaff", "details": map[string]any{"facility": "Trade", "index": 1}}),
			callbackLine(t, "Infrast", "TaskChainCompleted", map[string]any{"details": map[string]any{}}),
		}, "\n")

		action := ParseInfrastExecutionAction("基建换班", map[string]any{"facility": []any{"Recycle", "Mfg"}}, log)
		if len(action.ObservedFacilities) != 1 || action.ObservedFacilities[0] != "Recycle" {
			t.Fatalf("observed = %+v", action.ObservedFacilities)
		}
		if len(action.Products) != 1 || action.Products[0].Product != "Battle Record" {
			t.Fatalf("products = %+v", action.Products)
		}
		if action.Products[0].Index != float64(2) {
			t.Fatalf("index = %#v", action.Products[0].Index)
		}
		if len(action.KeptUnchanged) != 1 || action.KeptUnchanged[0].Reason != "candidates_low_mood" {
			t.Fatalf("keptUnchanged = %+v", action.KeptUnchanged)
		}
		if len(action.NotEnoughStaff) != 1 {
			t.Fatalf("notEnoughStaff = %+v", action.NotEnoughStaff)
		}
		if !strings.Contains(action.Message, "保持原样") {
			t.Fatalf("message = %q", action.Message)
		}
	})

	t.Run("does not invent facility details", func(t *testing.T) {
		log := callbackLine(t, "Infrast", "TaskChainCompleted", map[string]any{"details": map[string]any{}})
		action := ParseInfrastExecutionAction("基建换班", map[string]any{"facility": []any{"Mfg", "Trade"}}, log)
		if action.Status != "success" || len(action.ObservedFacilities) != 0 {
			t.Fatalf("action = %+v", action)
		}
		if !strings.Contains(action.Message, "按配置处理 2 类设施") {
			t.Fatalf("message = %q", action.Message)
		}
	})

	t.Run("reports entry recognition failure", func(t *testing.T) {
		log := strings.Join([]string{
			callbackLine(t, "Infrast", "SubTaskStart", map[string]any{"details": map[string]any{"task": "InfrastBegin"}}),
			callbackLine(t, "Infrast", "SubTaskError", map[string]any{"details": map[string]any{}}),
			callbackLine(t, "Infrast", "TaskChainError", map[string]any{"details": map[string]any{}}),
		}, "\n")
		action := ParseInfrastExecutionAction("基建换班", map[string]any{"facility": []any{"Mfg"}}, log)
		if action.Status != "failed" || !strings.Contains(action.Message, "未能进入或识别") {
			t.Fatalf("action = %+v", action)
		}
	})

	t.Run("skips empty selection", func(t *testing.T) {
		action := ParseInfrastExecutionAction("基建换班", map[string]any{"facility": []any{}}, "")
		if action.Status != "skipped" {
			t.Fatalf("status = %q", action.Status)
		}
	})
}

func TestRecruitExecutionResults(t *testing.T) {
	t.Run("summarizes refreshes and starts", func(t *testing.T) {
		log := strings.Join([]string{
			callbackLine(t, "Recruit", "SubTaskExtraInfo", map[string]any{"what": "RecruitTagsDetected", "details": map[string]any{"tags": []any{"近卫干员", "输出"}}}),
			callbackLine(t, "Recruit", "SubTaskExtraInfo", map[string]any{"what": "RecruitTagsRefreshed", "details": map[string]any{}}),
			callbackLine(t, "Recruit", "SubTaskExtraInfo", map[string]any{"what": "RecruitTagsDetected", "details": map[string]any{"tags": []any{"先锋干员", "费用回复"}}}),
			callbackLine(t, "Recruit", "SubTaskExtraInfo", map[string]any{"what": "RecruitResult", "details": map[string]any{"level": 4, "tags": []any{"先锋干员", "费用回复"}}}),
			callbackLine(t, "Recruit", "SubTaskStart", map[string]any{"details": map[string]any{"task": "RecruitConfirm"}}),
			callbackLine(t, "Recruit", "TaskChainCompleted", map[string]any{"details": map[string]any{}}),
		}, "\n")

		action := ParseRecruitExecutionAction("自动公招", map[string]any{}, log)
		if action.Status != "success" || action.StartedCount != 1 || action.RefreshCount != 1 || action.HighestLevel != 4 {
			t.Fatalf("action = %+v", action)
		}
		if len(action.FinalTags) != 2 || action.FinalTags[0] != "先锋干员" {
			t.Fatalf("finalTags = %+v", action.FinalTags)
		}
		if !strings.Contains(action.Message, "开始 1 次招募") {
			t.Fatalf("message = %q", action.Message)
		}
	})

	t.Run("reports preserved tags", func(t *testing.T) {
		log := strings.Join([]string{
			callbackLine(t, "Recruit", "SubTaskExtraInfo", map[string]any{"what": "RecruitTagsDetected", "details": map[string]any{"tags": []any{"支援机械", "先锋干员"}}}),
			callbackLine(t, "Recruit", "SubTaskExtraInfo", map[string]any{"what": "RecruitPreservedTag", "details": map[string]any{"tags": []any{"支援机械", "先锋干员"}}}),
			callbackLine(t, "Recruit", "TaskChainCompleted", map[string]any{"details": map[string]any{}}),
		}, "\n")

		action := ParseRecruitExecutionAction("自动公招", map[string]any{"preserve_tags": []any{"支援机械"}}, log)
		if action.Status != "skipped" || len(action.PreservedTags) != 1 || action.PreservedTags[0] != "支援机械" {
			t.Fatalf("action = %+v", action)
		}
		if !strings.Contains(action.Message, "已保留该槽位") {
			t.Fatalf("message = %q", action.Message)
		}
	})

	t.Run("handles permit and refresh error events", func(t *testing.T) {
		preserved := ParseRecruitExecutionAction("自动公招", map[string]any{"preserve_tags": []any{"支援机械"}}, strings.Join([]string{
			callbackLine(t, "Recruit", "SubTaskExtraInfo", map[string]any{"what": "RecruitTagsDetected", "details": map[string]any{"tags": []any{"支援机械", "先锋干员"}}}),
			callbackLine(t, "Recruit", "SubTaskExtraInfo", map[string]any{"what": "RecruitPreservedTag", "details": map[string]any{"tag": "支援机械"}}),
			callbackLine(t, "Recruit", "TaskChainCompleted", map[string]any{"details": map[string]any{}}),
		}, "\n"))
		if preserved.Status != "skipped" || len(preserved.PreservedTags) != 1 {
			t.Fatalf("preserved = %+v", preserved)
		}

		noPermit := ParseRecruitExecutionAction("自动公招", map[string]any{}, strings.Join([]string{
			callbackLine(t, "Recruit", "SubTaskExtraInfo", map[string]any{"what": "RecruitNoPermit", "details": map[string]any{"continue": false}}),
			callbackLine(t, "Recruit", "TaskChainCompleted", map[string]any{"details": map[string]any{}}),
		}, "\n"))
		if noPermit.Status != "skipped" || !strings.Contains(noPermit.Message, "招聘许可不足") {
			t.Fatalf("noPermit = %+v", noPermit)
		}

		reserved := ParseRecruitExecutionAction("自动公招", map[string]any{}, strings.Join([]string{
			callbackLine(t, "Recruit", "SubTaskExtraInfo", map[string]any{"what": "RecruitPermitReserved", "details": map[string]any{"current": 2}}),
			callbackLine(t, "Recruit", "TaskChainCompleted", map[string]any{"details": map[string]any{}}),
		}, "\n"))
		if !reserved.PermitReserved || reserved.PermitReservedCount != float64(2) {
			t.Fatalf("reserved = %+v", reserved)
		}
		if !strings.Contains(reserved.Message, "招聘许可已保留") {
			t.Fatalf("message = %q", reserved.Message)
		}

		failedRecognition := ParseRecruitExecutionAction("自动公招", map[string]any{}, strings.Join([]string{
			callbackLine(t, "Recruit", "SubTaskExtraInfo", map[string]any{"what": "RecruitPermitCountRecognitionFailed", "details": map[string]any{}}),
			callbackLine(t, "Recruit", "TaskChainCompleted", map[string]any{"details": map[string]any{}}),
		}, "\n"))
		if !failedRecognition.PermitCountRecognitionFailed || !strings.Contains(failedRecognition.Message, "识别失败") {
			t.Fatalf("failedRecognition = %+v", failedRecognition)
		}
	})

	t.Run("reports refresh limit", func(t *testing.T) {
		log := strings.Join([]string{
			callbackLine(t, "Recruit", "SubTaskExtraInfo", map[string]any{"what": "RecruitError", "details": map[string]any{"refresh_limit": 3}}),
			callbackLine(t, "Recruit", "TaskChainCompleted", map[string]any{"details": map[string]any{}}),
		}, "\n")
		action := ParseRecruitExecutionAction("自动公招", map[string]any{}, log)
		if action.Status != "skipped" || action.RefreshLimit == nil || *action.RefreshLimit != 3 {
			t.Fatalf("action = %+v", action)
		}
		if !strings.Contains(action.Message, "刷新次数已达上限") {
			t.Fatalf("message = %q", action.Message)
		}
	})

	t.Run("turns task-chain errors into failure", func(t *testing.T) {
		log := strings.Join([]string{
			callbackLine(t, "Recruit", "SubTaskError", map[string]any{"details": map[string]any{}, "subtask": "AutoRecruitTask"}),
			callbackLine(t, "Recruit", "TaskChainError", map[string]any{"details": map[string]any{}}),
		}, "\n")
		action := ParseRecruitExecutionAction("自动公招", map[string]any{}, log)
		if action.Status != "failed" || !strings.Contains(action.Message, "未能进入或识别") {
			t.Fatalf("action = %+v", action)
		}
	})

	t.Run("marks idle completion as skipped", func(t *testing.T) {
		log := callbackLine(t, "Recruit", "TaskChainCompleted", map[string]any{"details": map[string]any{}})
		action := ParseRecruitExecutionAction("自动公招", map[string]any{}, log)
		if action.Status != "skipped" || !strings.Contains(action.Message, "没有可处理") {
			t.Fatalf("action = %+v", action)
		}
	})
}

func TestMallExecutionResults(t *testing.T) {
	t.Run("summarizes visits and purchases", func(t *testing.T) {
		log := strings.Join([]string{
			callbackLine(t, "Mall", "SubTaskStart", map[string]any{"details": map[string]any{"task": "StartToVisit"}}),
			callbackLine(t, "Mall", "SubTaskStart", map[string]any{"details": map[string]any{"task": "VisitNext"}}),
			callbackLine(t, "Mall", "SubTaskStart", map[string]any{"details": map[string]any{"task": "VisitNextOcr"}}),
			callbackLine(t, "Mall", "SubTaskStart", map[string]any{"details": map[string]any{"task": "CollectCredit"}}),
			callbackLine(t, "Mall", "SubTaskStart", map[string]any{"details": map[string]any{"task": "CreditShop-Bought", "exec_times": 1}}),
			callbackLine(t, "Mall", "SubTaskStart", map[string]any{"details": map[string]any{"task": "CreditShop-Bought", "exec_times": 2}}),
			callbackLine(t, "Mall", "TaskChainCompleted", map[string]any{"details": map[string]any{}}),
		}, "\n")

		action := ParseMallExecutionAction("信用收支", map[string]any{}, log)
		if action.Status != "success" || action.VisitedCount != 1 || !action.CreditCollected || action.PurchasedCount != 1 {
			t.Fatalf("action = %+v", action)
		}
		if !strings.Contains(action.Message, "访问 1 位好友") || !strings.Contains(action.Message, "购买 1 件商品") {
			t.Fatalf("message = %q", action.Message)
		}
	})

	t.Run("counts buy clicks when bought is absent", func(t *testing.T) {
		log := strings.Join([]string{
			callbackLine(t, "Mall", "SubTaskStart", map[string]any{"details": map[string]any{"task": "CreditShop-BuyIt", "action": "ClickSelf", "exec_times": 1}}),
			callbackLine(t, "Mall", "SubTaskStart", map[string]any{"details": map[string]any{"task": "CreditShop-BuyIt", "action": "ClickSelf", "exec_times": 1}}),
			callbackLine(t, "Mall", "TaskChainCompleted", map[string]any{"details": map[string]any{}}),
		}, "\n")
		action := ParseMallExecutionAction("信用收支", map[string]any{}, log)
		if action.PurchasedCount != 2 {
			t.Fatalf("purchased = %d", action.PurchasedCount)
		}
	})

	t.Run("treats insufficient credit as completed", func(t *testing.T) {
		log := strings.Join([]string{
			callbackLine(t, "Mall", "SubTaskStart", map[string]any{"class": "asst::CreditShoppingTask", "details": map[string]any{}}),
			callbackLine(t, "Mall", "SubTaskError", map[string]any{"class": "asst::CreditShoppingTask", "details": map[string]any{}}),
			callbackLine(t, "Mall", "SubTaskStart", map[string]any{"details": map[string]any{"task": "CreditShop-NoMoney"}}),
			callbackLine(t, "Mall", "TaskChainCompleted", map[string]any{"details": map[string]any{}}),
		}, "\n")
		action := ParseMallExecutionAction("信用收支", map[string]any{}, log)
		if action.Status != "success" || !action.NoMoney || !strings.Contains(action.Message, "信用不足") {
			t.Fatalf("action = %+v", action)
		}
	})

	t.Run("fails only on task-chain error", func(t *testing.T) {
		log := strings.Join([]string{
			callbackLine(t, "Mall", "SubTaskStart", map[string]any{"details": map[string]any{"task": "Mall"}}),
			callbackLine(t, "Mall", "SubTaskError", map[string]any{"details": map[string]any{}}),
			callbackLine(t, "Mall", "TaskChainError", map[string]any{"details": map[string]any{}}),
		}, "\n")
		action := ParseMallExecutionAction("信用收支", map[string]any{}, log)
		if action.Status != "failed" || !strings.Contains(action.Message, "处理过程中失败") {
			t.Fatalf("action = %+v", action)
		}
	})

	t.Run("skips disabled configuration", func(t *testing.T) {
		action := ParseMallExecutionAction("信用收支", map[string]any{
			"visit_friends": false,
			"shopping":      false,
			"credit_fight":  false,
		}, "")
		if action.Status != "skipped" || !strings.Contains(action.Message, "已跳过") {
			t.Fatalf("action = %+v", action)
		}
	})
}

func TestFightExecutionResults(t *testing.T) {
	t.Run("summarizes completed runs", func(t *testing.T) {
		action := CreateFightExecutionAction("理智作战", "1-7", FightExecutionOptions{
			Summary: &FightSummary{
				Stage:     "1-7",
				Times:     "3",
				Drops:     "固源岩 × 3, 龙门币 × 360",
				DropItems: []any{map[string]any{"name": "固源岩", "count": 3}, map[string]any{"name": "龙门币", "count": 360}},
			},
			Output: "Fight 1-7 3 times",
		})
		if action.Status != "success" || action.Times != 3 || action.DropCount != 2 {
			t.Fatalf("action = %+v", action)
		}
		if !strings.Contains(action.Message, "1-7 × 3") {
			t.Fatalf("message = %q", action.Message)
		}
	})

	t.Run("marks zero-run completion as depleted", func(t *testing.T) {
		output := "[Fight] Completed\nSummary\nFight 1-7 0 times"
		action := CreateFightExecutionAction("理智作战", "1-7", FightExecutionOptions{Output: output})
		if !IsFightSanityDepleted(output, "1-7") {
			t.Fatal("expected depleted sanity")
		}
		if action.Status != "skipped" || !action.SanityDepleted {
			t.Fatalf("action = %+v", action)
		}
	})

	t.Run("keeps completed runs successful after sanity runs out", func(t *testing.T) {
		action := CreateFightExecutionAction("理智作战", "1-7", FightExecutionOptions{
			Summary: &FightSummary{Stage: "1-7", Times: "2"},
			Output:  "Fight 1-7 2 times\nsanity is not enough",
		})
		if action.Status != "success" || !action.SanityDepleted {
			t.Fatalf("action = %+v", action)
		}
	})

	t.Run("distinguishes unavailable stages from failures", func(t *testing.T) {
		skipped := CreateFightExecutionAction("理智作战", "PR-A-1", FightExecutionOptions{Error: errors.New("stage not open")})
		if skipped.Status != "skipped" {
			t.Fatalf("skipped = %+v", skipped)
		}
		failed := CreateFightExecutionAction("理智作战", "1-7", FightExecutionOptions{Error: errors.New("ADB connection lost")})
		if failed.Status != "failed" {
			t.Fatalf("failed = %+v", failed)
		}
	})
}

func TestAwardExecutionResults(t *testing.T) {
	params := map[string]any{
		"award": true, "mail": true, "recruit": true,
		"orundum": true, "mining": true, "specialaccess": true,
	}
	items := GetEnabledAwardItems(params)
	wantKeys := []string{"award", "mail", "recruit", "orundum", "mining", "specialaccess"}
	if len(items) != len(wantKeys) {
		t.Fatalf("items = %+v", items)
	}
	for index, key := range wantKeys {
		if items[index].Key != key {
			t.Fatalf("item %d = %q, want %q", index, items[index].Key, key)
		}
	}

	log := strings.Join([]string{
		`run subtask 1 / 6 {"first":["AwardBegin"],"taskchain":"Award"}`,
		`SubTaskStart {"details":{"task":"ReceiveAward"},"first":["AwardBegin"]}`,
		`run subtask 2 / 6 {"first":["MailBegin"],"taskchain":"Award"}`,
		`SubTaskStart {"details":{"task":"MailWithoutAward"},"first":["MailBegin"]}`,
		`run subtask 3 / 6 {"first":["RecruitingActivitiesBegin"],"taskchain":"Award"}`,
	}, "\n")
	actions := ParseAwardExecutionActions("领取奖励", map[string]any{"award": true, "mail": true}, log)
	if len(actions) != 2 || actions[0].Status != "success" || actions[1].Status != "skipped" {
		t.Fatalf("actions = %+v", actions)
	}
	if !strings.Contains(actions[0].Message, "已领取") || !strings.Contains(actions[1].Message, "已跳过") {
		t.Fatalf("messages = %+v", actions)
	}

	if len(GetEnabledAwardItems(map[string]any{"signinevent": true})) != 1 {
		t.Fatal("signinevent switch not read")
	}
	claimed := ParseAwardExecutionActions("领取奖励", map[string]any{"signinevent": true}, strings.Join([]string{
		`SubTaskStart {"details":{"task":"SignInEvent"},"first":["SignInEvent"]}`,
		`SubTaskStart {"details":{"task":"SignInEventAllClaimed"},"first":["SignInEvent"]}`,
	}, "\n"))
	if claimed[0].Status != "success" || !strings.Contains(claimed[0].Message, "限时签到奖励已领取") {
		t.Fatalf("claimed = %+v", claimed)
	}
	missing := ParseAwardExecutionActions("领取奖励", map[string]any{"signinevent": true}, "")
	if missing[0].Status != "skipped" || !strings.Contains(missing[0].Message, "未检测到") {
		t.Fatalf("missing = %+v", missing)
	}

	fallback := ParseAwardExecutionActions("领取奖励", map[string]any{"award": true, "mail": true}, "")
	if len(fallback) != 1 || fallback[0].Status != "success" || !strings.Contains(fallback[0].Message, "共检查 2 项") {
		t.Fatalf("fallback = %+v", fallback)
	}

	disabled := ParseAwardExecutionActions("领取奖励", map[string]any{}, "")
	if disabled[0].Status != "skipped" {
		t.Fatalf("disabled = %+v", disabled)
	}
}
