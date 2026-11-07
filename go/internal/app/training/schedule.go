package training

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// STAGE_CODE_MAP converts database stage codes to MAA-recognisable names.
var stageCodeMap = map[string]string{
	"pro_a_1": "PR-A-1",
	"pro_a_2": "PR-A-2",
	"pro_b_1": "PR-B-1",
	"pro_b_2": "PR-B-2",
	"pro_c_1": "PR-C-1",
	"pro_c_2": "PR-C-2",
	"pro_d_1": "PR-D-1",
	"pro_d_2": "PR-D-2",

	"ca_1": "CA-1",
	"ca_2": "CA-2",
	"ca_3": "CA-3",
	"ca_4": "CA-4",
	"ca_5": "CA-5",

	"ce_1": "CE-1",
	"ce_2": "CE-2",
	"ce_3": "CE-3",
	"ce_4": "CE-4",
	"ce_5": "CE-5",
	"ce_6": "CE-6",

	"ls_1": "LS-1",
	"ls_2": "LS-2",
	"ls_3": "LS-3",
	"ls_4": "LS-4",
	"ls_5": "LS-5",
	"ls_6": "LS-6",

	"ap_1": "AP-1",
	"ap_2": "AP-2",
	"ap_3": "AP-3",
	"ap_4": "AP-4",
	"ap_5": "AP-5",

	"sk_1": "SK-1",
	"sk_2": "SK-2",
	"sk_3": "SK-3",
	"sk_4": "SK-4",
	"sk_5": "SK-5",
}

// CHIP_STAGE_MAP picks the correct chip stage for chip material names.
var chipStageMap = map[string]string{
	"医疗芯片":  "PR-A-1",
	"医疗芯片组": "PR-A-2",
	"医疗双芯片": "PR-A-2",
	"重装芯片":  "PR-A-1",
	"重装芯片组": "PR-A-2",
	"重装双芯片": "PR-A-2",

	"术师芯片":  "PR-B-1",
	"术师芯片组": "PR-B-2",
	"术师双芯片": "PR-B-2",
	"狙击芯片":  "PR-B-1",
	"狙击芯片组": "PR-B-2",
	"狙击双芯片": "PR-B-2",

	"先锋芯片":  "PR-C-1",
	"先锋芯片组": "PR-C-2",
	"先锋双芯片": "PR-C-2",
	"辅助芯片":  "PR-C-1",
	"辅助芯片组": "PR-C-2",
	"辅助双芯片": "PR-C-2",

	"近卫芯片":  "PR-D-1",
	"近卫芯片组": "PR-D-2",
	"近卫双芯片": "PR-D-2",
	"特种芯片":  "PR-D-1",
	"特种芯片组": "PR-D-2",
	"特种双芯片": "PR-D-2",
}

var (
	maStagePattern        = regexp.MustCompile(`^[A-Z]{2,3}-[A-Z0-9]-\d+$`)
	threePartStagePattern = regexp.MustCompile(`^([a-z]+)_([a-z])_(\d+)$`)
	twoPartStagePattern   = regexp.MustCompile(`^([a-z]+)_(\d+)$`)
)

// convertStageCode mirrors operatorTrainingService.convertStageCode.
func convertStageCode(stageCode any) string {
	if !isTruthy(stageCode) {
		return ""
	}
	code := jsStringApprox(stageCode)
	if maStagePattern.MatchString(code) {
		return code
	}
	lowerCode := strings.ToLower(code)
	if mapped, ok := stageCodeMap[lowerCode]; ok {
		return mapped
	}
	if match := threePartStagePattern.FindStringSubmatch(lowerCode); match != nil {
		return fmt.Sprintf("%s-%s-%s", strings.ToUpper(match[1]), strings.ToUpper(match[2]), match[3])
	}
	if match := twoPartStagePattern.FindStringSubmatch(lowerCode); match != nil {
		return fmt.Sprintf("%s-%s", strings.ToUpper(match[1]), match[2])
	}
	return code
}

type resourceStage struct {
	Name   string
	Days   []int
	Hidden bool
}

// resourceStages mirrors notificationService.RESOURCE_STAGES in display order.
var resourceStages = []struct {
	Key   string
	Stage resourceStage
}{
	{"CE-6", resourceStage{Name: "龙门币", Days: []int{0, 2, 4, 6}}},
	{"AP-5", resourceStage{Name: "采购凭证", Days: []int{0, 1, 3, 5}}},
	{"CA-5", resourceStage{Name: "技巧概要", Days: []int{0, 2, 4, 6}}},
	{"LS-6", resourceStage{Name: "作战记录", Days: []int{0, 1, 2, 3, 4, 5, 6}}},

	{"PR-A", resourceStage{Name: "重装/医疗芯片", Days: []int{0, 1, 4, 5}}},
	{"PR-A-1", resourceStage{Name: "重装/医疗芯片", Days: []int{0, 1, 4, 5}, Hidden: true}},
	{"PR-A-2", resourceStage{Name: "重装/医疗芯片组", Days: []int{0, 1, 4, 5}, Hidden: true}},
	{"PR-B", resourceStage{Name: "狙击/术师芯片", Days: []int{1, 2, 5, 6}}},
	{"PR-B-1", resourceStage{Name: "狙击/术师芯片", Days: []int{1, 2, 5, 6}, Hidden: true}},
	{"PR-B-2", resourceStage{Name: "狙击/术师芯片组", Days: []int{1, 2, 5, 6}, Hidden: true}},
	{"PR-C", resourceStage{Name: "先锋/辅助芯片", Days: []int{0, 3, 4, 6}}},
	{"PR-C-1", resourceStage{Name: "先锋/辅助芯片", Days: []int{0, 3, 4, 6}, Hidden: true}},
	{"PR-C-2", resourceStage{Name: "先锋/辅助芯片组", Days: []int{0, 3, 4, 6}, Hidden: true}},
	{"PR-D", resourceStage{Name: "近卫/特种芯片", Days: []int{0, 2, 3, 6}}},
	{"PR-D-1", resourceStage{Name: "近卫/特种芯片", Days: []int{0, 2, 3, 6}, Hidden: true}},
	{"PR-D-2", resourceStage{Name: "近卫/特种芯片组", Days: []int{0, 2, 3, 6}, Hidden: true}},

	{"SK-5", resourceStage{Name: "碳", Days: []int{0, 1, 3, 5}}},
}

var resourceStageIndex = func() map[string]resourceStage {
	index := make(map[string]resourceStage, len(resourceStages))
	for _, entry := range resourceStages {
		index[entry.Key] = entry.Stage
	}
	return index
}()

func resourceStageOpen(stage resourceStage, weekday int, allOpen bool) bool {
	if allOpen {
		return true
	}
	for _, day := range stage.Days {
		if day == weekday {
			return true
		}
	}
	return false
}

func getTodayOpenStages(now time.Time, clientType string, resourceCollectionOpen bool) TodayOpenStages {
	date, weekday := gameDay(now, clientType)
	result := TodayOpenStages{
		Weekday:    weekday,
		Date:       date,
		ClientType: clientType,
		Open:       make([]ResourceStageStatus, 0, len(resourceStages)),
		Closed:     make([]ResourceStageStatus, 0, len(resourceStages)),
	}
	if result.ClientType == "" {
		result.ClientType = "Official"
	}
	for _, entry := range resourceStages {
		if entry.Stage.Hidden {
			continue
		}
		status := ResourceStageStatus{
			Stage:  entry.Key,
			Name:   entry.Stage.Name,
			IsOpen: resourceStageOpen(entry.Stage, weekday, resourceCollectionOpen),
		}
		if status.IsOpen {
			result.Open = append(result.Open, status)
		} else {
			result.Closed = append(result.Closed, status)
		}
	}
	return result
}

func isStageOpenToday(stage string, weekday int, resourceCollectionOpen bool) StageOpenInfo {
	stageKey := strings.ToUpper(stage)
	info, ok := resourceStageIndex[stageKey]
	if !ok {
		return StageOpenInfo{IsOpen: true, Reason: nil}
	}
	open := resourceStageOpen(info, weekday, resourceCollectionOpen)
	result := StageOpenInfo{IsOpen: open, StageName: info.Name}
	if !open {
		reason := info.Name + "今日未开放"
		result.Reason = &reason
	}
	return result
}
