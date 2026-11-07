package activity

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/mps233/la-pluma/go/internal/config"
)

const navigationLogMaxBytes = 2 * 1024 * 1024

var activityCodePattern = regexp.MustCompile(`^[A-Z0-9]{2,8}$`)

// AssessActivityNavigation mirrors assessActivityNavigation: a complete
// <CODE>-OpenOpt / <CODE>-Open chain and a stage task that references it are
// required before Copilot may run.
func AssessActivityNavigation(activity any, tasks any) NavigationResult {
	activityRecord := asRecord(activity)
	if activityRecord == nil {
		activityRecord = map[string]any{}
	}
	code := strings.ToUpper(strings.TrimSpace(jsStringOrEmpty(activityRecord["code"])))
	if code == "" {
		return blockedNavigation(activity, "activity-unavailable", "无法确认当前活动，未准备活动作业。")
	}
	if !activityCodePattern.MatchString(code) {
		return blockedNavigation(activity, "activity-code-invalid", "当前活动代号格式异常，未准备活动作业。")
	}

	taskMap := asRecord(tasks)
	if tasks == nil || taskMap == nil {
		return blockedNavigation(activity, "navigation-resource-unavailable", fmt.Sprintf("未找到 %s 的活动导航资源。", code))
	}

	openOptionKey := code + "-OpenOpt"
	openOption := asRecord(taskMap[openOptionKey])
	openKeys := []string{code + "-OpenOcr", code + "-Open"}
	openKey := ""
	for _, key := range openKeys {
		if truthy(taskMap[key]) {
			openKey = key
			break
		}
	}
	stagePattern := regexp.MustCompile(`(?i)^` + regexp.QuoteMeta(code) + `-(?:\d+|EX-\d+|S-\d+|MO-\d+|TR-\d+)$`)
	type stageEntry struct {
		key  string
		task map[string]any
	}
	stageEntries := make([]stageEntry, 0)
	for key, rawTask := range taskMap {
		if !stagePattern.MatchString(key) {
			continue
		}
		task := asRecord(rawTask)
		if task == nil {
			continue
		}
		stageEntries = append(stageEntries, stageEntry{key: key, task: task})
	}

	openSequenceTask := map[string]any(nil)
	if openKey != "" {
		openSequenceTask = asRecord(taskMap[openKey])
	}
	hasOpenSequence := false
	if openOption != nil && openKey != "" && openSequenceTask != nil {
		referencesOpen := false
		for _, next := range toArrayValues(openOption["next"]) {
			for _, key := range openKeys {
				if referencesTask([]any{next}, key) {
					referencesOpen = true
					break
				}
			}
			if referencesOpen {
				break
			}
		}
		hasOpenSequence = referencesOpen && len(toArrayValues(openSequenceTask["next"])) > 0
	}
	hasStageEntry := false
	for _, entry := range stageEntries {
		if referencesTask(entry.task["sub"], openOptionKey) && len(toArrayValues(entry.task["next"])) > 0 {
			hasStageEntry = true
			break
		}
	}

	if !hasOpenSequence || !hasStageEntry {
		return blockedNavigation(
			activity,
			"navigation-incomplete",
			fmt.Sprintf("%s 的资源未包含从主页进入活动关卡的完整导航链，未准备活动作业。", code),
		)
	}

	name := code
	if value, ok := activityRecord["name"].(string); ok && value != "" {
		name = value
	}
	var source *string
	if value, ok := activityRecord["source"].(string); ok {
		source = stringPtr(value)
	}
	return NavigationResult{
		State:      "ready",
		CanPrepare: true,
		CanRun:     false,
		ReasonCode: nil,
		Reason:     "已确认当前活动和从主页进入活动关卡的导航资源；此接口不会启动作业。",
		Activity: NavigationActivity{
			Code:   stringPtr(code),
			Name:   stringPtr(name),
			Source: source,
			Stages: stagesFromAny(activityRecord["stages"]),
		},
		Navigation: &NavigationInfo{
			Source:     "maa-resource",
			StageFile:  fmt.Sprintf("tasks/Stages/%s.json", code),
			StageCount: len(stageEntries),
			EntryTask:  openOptionKey,
		},
	}
}

func blockedNavigation(activity any, reasonCode, reason string) NavigationResult {
	record := asRecord(activity)
	if record == nil {
		record = map[string]any{}
	}
	code := optionalStringFromRecord(record, "code")
	name := optionalStringFromRecord(record, "name")
	source := optionalStringFromRecord(record, "source")
	return NavigationResult{
		State:      "blocked",
		CanPrepare: false,
		CanRun:     false,
		ReasonCode: stringPtr(reasonCode),
		Reason:     reason,
		Activity: NavigationActivity{
			Code:   code,
			Name:   name,
			Source: source,
			Stages: stagesFromAny(record["stages"]),
		},
		Navigation: nil,
	}
}

func optionalStringFromRecord(record map[string]any, key string) *string {
	if value, ok := record[key].(string); ok {
		return stringPtr(value)
	}
	return nil
}

func stagesFromAny(value any) []string {
	result := strictStringSlice(value)
	if result == nil {
		return []string{}
	}
	return result
}

func toArrayValues(value any) []any {
	if array, ok := value.([]any); ok {
		return array
	}
	if truthy(value) {
		return []any{value}
	}
	return nil
}

func referencesTask(values any, taskName string) bool {
	for _, value := range toArrayValues(values) {
		if text, ok := value.(string); ok && text == taskName {
			return true
		}
		if strings.HasSuffix(jsString(value), "@"+taskName) {
			return true
		}
	}
	return false
}

// Check implements Preflight.
func (s *Service) Check(ctx context.Context, clientType string) (NavigationResult, error) {
	var info *Info
	var err error
	if s.currentSource != nil {
		info, err = s.currentSource.CurrentActivity(ctx, clientType)
	} else {
		info, err = s.CurrentActivity(ctx, clientType)
	}
	if err != nil {
		return NavigationResult{}, err
	}
	if info == nil || info.Code == nil || *info.Code == "" {
		return AssessActivityNavigation(activityRecordFromInfo(info), nil), nil
	}

	code := strings.ToUpper(*info.Code)
	resourceDir, err := s.ResourceDir(ctx)
	if err != nil {
		return blockedNavigation(activityRecordFromInfo(info), "navigation-resource-unavailable", fmt.Sprintf("未找到 %s 的活动导航资源，未准备活动作业。", *info.Code)), nil
	}
	tasks, err := loadActivityStageTasks(resourceDir, code)
	if err != nil {
		return blockedNavigation(activityRecordFromInfo(info), "navigation-resource-unavailable", fmt.Sprintf("未找到 %s 的活动导航资源，未准备活动作业。", *info.Code)), nil
	}
	return AssessActivityNavigation(activityRecordFromInfo(info), tasks), nil
}

// GetActivityRunPreflight is the Node-name alias for Check.
func (s *Service) GetActivityRunPreflight(ctx context.Context, clientType string) (NavigationResult, error) {
	return s.Check(ctx, clientType)
}

func activityRecordFromInfo(info *Info) map[string]any {
	if info == nil {
		return map[string]any{}
	}
	record := map[string]any{"stages": info.Stages}
	if info.Code != nil {
		record["code"] = *info.Code
	}
	if info.Name != nil {
		record["name"] = *info.Name
	}
	if info.Source != nil {
		record["source"] = *info.Source
	}
	return record
}

func loadActivityStageTasks(resourceDir, code string) (any, error) {
	stageFile := filepath.Join(resourceDir, "tasks", "Stages", code+".json")
	return readJSONFile(stageFile)
}

// ResourceDir resolves the MAA resource directory. It prefers the explicit
// provider, then `maa dir resource`, then Paths.MaaDataDir/resource.
func (s *Service) ResourceDir(ctx context.Context) (string, error) {
	if s.resourceDir != nil {
		return s.resourceDir.ResourceDir(ctx)
	}
	if s.executor != nil {
		run, err := s.executor.RunCommand(ctx, "dir", []string{"resource"}, "", "", true)
		if err != nil {
			return "", err
		}
		resourceDir := strings.TrimSpace(commandStdout(run))
		if resourceDir == "" {
			return "", fmt.Errorf("无法读取 MAA 资源目录")
		}
		return resourceDir, nil
	}
	return s.resource.ResourceDir(), nil
}

type navigationLogToken struct {
	LogPath string `json:"logPath"`
	Size    int64  `json:"size"`
}

// defaultNavigationLog reads the appended bytes of MAA's asst.log, mirroring
// createMaaLogCheckpoint / readMaaLogSince. Failures yield an empty checkpoint
// and empty text, so navigation verification fails closed.
type defaultNavigationLog struct {
	executor Executor
}

func newDefaultNavigationLog(_ config.Paths, executor Executor) NavigationLog {
	return &defaultNavigationLog{executor: executor}
}

func (l *defaultNavigationLog) Checkpoint(ctx context.Context) string {
	logPath, err := l.logDir(ctx)
	if err != nil {
		return ""
	}
	path := filepath.Join(logPath, "asst.log")
	info, err := os.Stat(path)
	if err != nil {
		return ""
	}
	token, err := json.Marshal(navigationLogToken{LogPath: path, Size: info.Size()})
	if err != nil {
		return ""
	}
	return string(token)
}

func (l *defaultNavigationLog) ReadSince(ctx context.Context, checkpoint string) string {
	if checkpoint == "" {
		return ""
	}
	var token navigationLogToken
	if err := json.Unmarshal([]byte(checkpoint), &token); err != nil || token.LogPath == "" {
		return ""
	}
	info, err := os.Stat(token.LogPath)
	if err != nil || info.Size() <= token.Size {
		return ""
	}
	available := info.Size() - token.Size
	bytesToRead := available
	if bytesToRead > navigationLogMaxBytes {
		bytesToRead = navigationLogMaxBytes
	}
	start := info.Size() - bytesToRead
	file, err := os.Open(token.LogPath)
	if err != nil {
		return ""
	}
	defer file.Close()
	buffer := make([]byte, bytesToRead)
	read, err := file.ReadAt(buffer, start)
	if err != nil && err != io.EOF {
		return ""
	}
	return string(buffer[:read])
}

func (l *defaultNavigationLog) logDir(ctx context.Context) (string, error) {
	if l.executor == nil {
		return "", fmt.Errorf("MAA 日志目录不可用")
	}
	run, err := l.executor.RunCommand(ctx, "dir", []string{"log"}, "", "", true)
	if err != nil {
		return "", err
	}
	dir := strings.TrimSpace(commandStdout(run))
	if dir == "" {
		return "", fmt.Errorf("无法读取 MAA 日志目录")
	}
	return dir, nil
}
