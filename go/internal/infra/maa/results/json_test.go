package results

import (
	"encoding/json"
	"testing"
)

func marshalRecord(t *testing.T, value any) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return decoded
}

func assertKeys(t *testing.T, record map[string]any, keys ...string) {
	t.Helper()
	for _, key := range keys {
		if _, ok := record[key]; !ok {
			t.Fatalf("missing key %q in %v", key, record)
		}
	}
}

func TestResultJSONFieldNames(t *testing.T) {
	partialInfrast := marshalRecord(t, ParseInfrastExecutionAction("基建换班", map[string]any{"facility": []any{}}, ""))
	if len(partialInfrast) != 6 {
		t.Fatalf("partial infrast keys = %v", partialInfrast)
	}
	assertKeys(t, partialInfrast,
		"task", "action", "status", "configuredFacilities", "observedFacilities", "message")

	infrastLog := callbackLine(t, "Infrast", "TaskChainCompleted", map[string]any{"details": map[string]any{}})
	infrast := marshalRecord(t, ParseInfrastExecutionAction("基建换班", map[string]any{"facility": []any{"Mfg"}}, infrastLog))
	assertKeys(t, infrast,
		"task", "action", "status", "configuredFacilities", "observedFacilities",
		"rewardCollected", "rotationApplied", "droneUsed", "cluesReceived", "cluesSent",
		"clueExchange", "trainingContinued", "trainingCompleted", "trainingProcessing",
		"products", "keptUnchanged", "notEnoughStaff", "message")

	partialRecruit := marshalRecord(t, ParseRecruitExecutionAction("自动公招", nil, ""))
	if len(partialRecruit) != 4 {
		t.Fatalf("partial recruit keys = %v", partialRecruit)
	}
	assertKeys(t, partialRecruit, "task", "action", "status", "message")

	recruitLog := callbackLine(t, "Recruit", "TaskChainCompleted", map[string]any{"details": map[string]any{}})
	recruit := marshalRecord(t, ParseRecruitExecutionAction("自动公招", nil, recruitLog))
	assertKeys(t, recruit,
		"task", "action", "status", "startedCount", "collectedCount", "expeditedCount",
		"refreshCount", "highestLevel", "detectedTags", "finalTags", "preservedTags",
		"permitReserved", "permitReservedCount", "permitCountRecognitionFailed",
		"refreshLimit", "noRefresh", "message")
	if value, ok := recruit["refreshLimit"]; !ok || value != nil {
		t.Fatalf("refreshLimit should be null, got %#v", value)
	}
	if value, ok := recruit["permitReservedCount"]; !ok || value != nil {
		t.Fatalf("permitReservedCount should be null, got %#v", value)
	}

	mall := marshalRecord(t, ParseMallExecutionAction("信用收支", nil, ""))
	assertKeys(t, mall,
		"task", "action", "status", "visitedCount", "creditCollected", "purchasedCount",
		"noMoney", "visitLimited", "noFriends", "message")

	fight := marshalRecord(t, CreateFightExecutionAction("理智作战", "1-7", FightExecutionOptions{}))
	assertKeys(t, fight,
		"task", "action", "status", "stage", "times", "dropCount", "drops",
		"medicine", "stone", "sanity", "duration", "sanityDepleted", "message")

	award := marshalRecord(t, ParseAwardExecutionActions("领取奖励", nil, "")[0])
	assertKeys(t, award, "task", "action", "status", "message")

	aux := marshalRecord(t, SummarizeAuxiliaryCallbacks(""))
	assertKeys(t, aux,
		"blackflowStartRun", "blackflowScrapTradeAborted", "copilotPrecheckFile",
		"stageInfo", "stageInfoErrors", "unsupportedLevels", "recruitSpecialTags",
		"recruitSelectedTags", "connectionEvents")
	if aux["connectionEvents"] == nil || aux["recruitSelectedTags"] == nil {
		t.Fatalf("array fields should not be null: %v", aux)
	}
}
