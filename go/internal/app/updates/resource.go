package updates

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

// StaleResourceDays is the threshold from resourceUpdateService.ts: resources
// older than two weeks are reported as stale.
const StaleResourceDays = 14

const (
	// ResourceStatusUnknown means version.json is missing or its timestamp is
	// not parseable.
	ResourceStatusUnknown = "unknown"
	// ResourceStatusStale means the resource version is older than the stale
	// threshold.
	ResourceStatusStale = "stale"
	// ResourceStatusCurrent means the resource version is recent.
	ResourceStatusCurrent = "current"
)

// MaaResourceInfo mirrors MaaResourceInfo in resourceUpdateService.ts. Nil
// pointers and nil interface values marshal to JSON null like the Node shape.
type MaaResourceInfo struct {
	LastUpdated *string `json:"lastUpdated"`
	ModifiedAt  *string `json:"modifiedAt"`
	AgeDays     *int    `json:"ageDays"`
	Status      string  `json:"status"`
	Message     string  `json:"message"`
	Activity    any     `json:"activity"`
	Gacha       any     `json:"gacha"`
}

// ResourceUpdateResult is the updateMaaResources() payload. Plan and Message
// are transport conveniences for the hot-update action; they are not part of
// the service result in the Node implementation.
type ResourceUpdateResult struct {
	Output   string          `json:"output"`
	Resource MaaResourceInfo `json:"resource"`
	Plan     HotUpdatePlan   `json:"plan"`
	Message  string          `json:"-"`
}

// BuildResourceInfo mirrors buildResourceInfo(versionData, modifiedAt, now).
// modifiedAt is the version.json file mtime; nil keeps the field null. The
// timestamp parser reproduces the Node normalization: spaces become T and a
// trailing .000 becomes Z. Zone-less timestamps are interpreted in local time,
// while date-only values are UTC, matching JavaScript Date parsing.
func BuildResourceInfo(versionData any, modifiedAt *time.Time, now time.Time) MaaResourceInfo {
	source := recordValue(versionData)
	lastUpdated := stringValue(source["last_updated"])

	var parsed time.Time
	hasValidDate := false
	if lastUpdated != nil {
		parsed, hasValidDate = parseResourceTimestamp(*lastUpdated)
	}

	var ageDays *int
	status := ResourceStatusUnknown
	if hasValidDate {
		days := int(now.Sub(parsed) / (24 * time.Hour))
		if days < 0 {
			days = 0
		}
		ageDays = &days
		status = ResourceStatusCurrent
		if days > StaleResourceDays {
			status = ResourceStatusStale
		}
	}

	message := "资源版本正常"
	switch status {
	case ResourceStatusStale:
		message = fmt.Sprintf("资源已 %d 天未更新，建议立即同步", *ageDays)
	case ResourceStatusUnknown:
		message = "无法读取资源版本，请重新同步资源"
	}

	var modified *string
	if modifiedAt != nil {
		formatted := modifiedAt.UTC().Format("2006-01-02T15:04:05.000Z07:00")
		modified = &formatted
	}

	return MaaResourceInfo{
		LastUpdated: lastUpdated,
		ModifiedAt:  modified,
		AgeDays:     ageDays,
		Status:      status,
		Message:     message,
		Activity:    coalesceValue(source["activity"]),
		Gacha:       coalesceValue(source["gacha"]),
	}
}

// GetResourceInfo mirrors getMaaResourceInfo: ask maa-cli for the resource
// directory, then read <dir>/version.json and its mtime.
func (s *Service) GetResourceInfo(ctx context.Context) (MaaResourceInfo, error) {
	var run domainrun.DTO
	var err error
	if runner, ok := s.runner.(UntrackedRunner); ok {
		// Metadata queries must not run inside the parent action's Run: the
		// parent DTO carries the action result, not the command's stdout.
		run, err = runner.RunCommandUntracked(ctx, "dir", []string{"resource"})
	} else {
		run, err = s.runMAA(ctx, "dir", []string{"resource"}, "", "")
	}
	if err != nil {
		return MaaResourceInfo{}, err
	}
	resourceDir := strings.TrimSpace(commandStdout(run))
	if resourceDir == "" {
		return MaaResourceInfo{}, fmt.Errorf("无法读取 MAA 资源目录")
	}

	versionPath := filepath.Join(resourceDir, "version.json")
	info, err := os.Stat(versionPath)
	if err != nil {
		return MaaResourceInfo{}, fmt.Errorf("读取资源版本失败: %w", err)
	}
	versionData, err := jsonstore.Read(versionPath, missingVersionFile{})
	if err != nil {
		return MaaResourceInfo{}, fmt.Errorf("解析资源版本失败: %w", err)
	}
	if _, missing := versionData.(missingVersionFile); missing {
		return MaaResourceInfo{}, fmt.Errorf("读取资源版本失败: 文件为空")
	}
	modifiedAt := info.ModTime()
	return BuildResourceInfo(versionData, &modifiedAt, s.now()), nil
}

type missingVersionFile struct{}

// HotUpdatePlan is the dry-run plan for hot-update-resources.
type HotUpdatePlan struct {
	Action  string `json:"action"`
	Command string `json:"command"`
}

// PlanHotUpdateResources returns the stable cheap-plan shape used by the
// hot-update-resources action.
func PlanHotUpdateResources() HotUpdatePlan {
	return HotUpdatePlan{Action: "hot-update-resources", Command: "hot-update"}
}

func parseResourceTimestamp(value string) (time.Time, bool) {
	normalized := strings.Replace(value, " ", "T", 1)
	if strings.HasSuffix(normalized, ".000") {
		normalized = strings.TrimSuffix(normalized, ".000") + "Z"
	}

	layouts := []struct {
		layout   string
		location *time.Location
	}{
		{time.RFC3339Nano, time.UTC},
		{"2006-01-02T15:04:05", time.Local},
		{"2006-01-02T15:04:05.999999999", time.Local},
		{"2006-01-02", time.UTC},
	}
	for _, candidate := range layouts {
		parsed, err := time.ParseInLocation(candidate.layout, normalized, candidate.location)
		if err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

func recordValue(value any) map[string]any {
	record, ok := value.(map[string]any)
	if !ok || record == nil {
		return map[string]any{}
	}
	return record
}

func stringValue(value any) *string {
	text, ok := value.(string)
	if !ok {
		return nil
	}
	return &text
}

// coalesceValue mirrors JavaScript's `value || null` for the activity and
// gacha fields: falsy scalars become null, while maps and slices stay truthy.
func coalesceValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case bool:
		if !typed {
			return nil
		}
	case string:
		if typed == "" {
			return nil
		}
	case float64:
		if typed == 0 {
			return nil
		}
	case int:
		if typed == 0 {
			return nil
		}
	case int64:
		if typed == 0 {
			return nil
		}
	case json.Number:
		if number, err := strconv.ParseFloat(typed.String(), 64); err == nil && number == 0 {
			return nil
		}
	}
	return value
}
