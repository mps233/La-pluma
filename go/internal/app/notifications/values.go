package notifications

import (
	"errors"
	"time"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsval"
)

// itemTask extracts the task name used to deduplicate legacy skip/error
// entries against structured actions. ok is false when the item has no string
// task field at all, which keeps it in the legacy section.
func itemTask(value any) (task string, ok bool) {
	if text, isString := value.(string); isString {
		return text, true
	}
	record := jsval.Record(value)
	if record == nil {
		return "", false
	}
	task, isString := record["task"].(string)
	return task, isString
}

func errMessage(err error) string {
	if err == nil {
		return ""
	}
	var appErr *apperrors.Error
	if errors.As(err, &appErr) && appErr.Message != "" {
		return appErr.Message
	}
	return err.Error()
}

var shanghaiZone = time.FixedZone("Asia/Shanghai", 8*60*60)

// formatTelegramTime renders the Node zh-CN localized string in Asia/Shanghai
// without relying on host tzdata.
func formatTelegramTime(now time.Time) string {
	return now.In(shanghaiZone).Format("2006/1/2 15:04:05")
}
