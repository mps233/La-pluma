package recognition

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const timestampLayout = "2006-01-02T15:04:05.000Z"

// LogReader reads the MAA debug log. Tests inject a fake reader so no MAA
// process is started and no real log location is required.
type LogReader interface {
	ReadLog(ctx context.Context, path string) (string, error)
}

// FileLogReader reads MAA logs from disk.
type FileLogReader struct{}

// ReadLog implements LogReader.
func (FileLogReader) ReadLog(ctx context.Context, path string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// Executor is the seam that supplies recognition callback payloads. The
// default LogExecutor reads the MAA log; tests and callers that already hold
// callbacks inject a static executor. The recognition service never starts
// MAA.
type Executor interface {
	Payloads(ctx context.Context, task Task, request Request) ([]Payload, error)
}

// LogExecutor extracts callbacks for one task from the MAA debug log. An
// explicit Request.LogContent wins over the reader.
type LogExecutor struct {
	Reader  LogReader
	LogPath string
}

// NewLogExecutor builds a log-backed executor. A nil reader uses
// FileLogReader.
func NewLogExecutor(reader LogReader, logPath string) *LogExecutor {
	if reader == nil {
		reader = FileLogReader{}
	}
	return &LogExecutor{Reader: reader, LogPath: logPath}
}

// Payloads implements Executor.
func (executor *LogExecutor) Payloads(ctx context.Context, task Task, request Request) ([]Payload, error) {
	logPath := request.LogPath
	if logPath == "" {
		logPath = executor.LogPath
	}
	var content string
	if request.LogContent != nil {
		content = *request.LogContent
	} else {
		reader := executor.Reader
		if reader == nil {
			reader = FileLogReader{}
		}
		value, err := reader.ReadLog(ctx, logPath)
		if err != nil {
			return nil, err
		}
		content = value
	}
	return ExtractCallbackPayloads(content, string(task)), nil
}

// Options configures the recognition service.
type Options struct {
	Paths     config.Paths
	LogReader LogReader
	Executor  Executor
	Logger    *slog.Logger
	Now       func() time.Time
}

// Service reads recognition callbacks and persists depot/OperBox snapshots.
type Service struct {
	paths          config.Paths
	executor       Executor
	logger         *slog.Logger
	now            func() time.Time
	defaultLogPath string
}

// New returns a recognition service. It performs no I/O.
func New(options Options) *Service {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	defaultLogPath := filepath.Join(options.Paths.MaaStateDir, "debug", "asst.log")
	executor := options.Executor
	if executor == nil {
		executor = NewLogExecutor(options.LogReader, defaultLogPath)
	}
	return &Service{
		paths:          options.Paths,
		executor:       executor,
		logger:         logger,
		now:            now,
		defaultLogPath: defaultLogPath,
	}
}

// RecognizeDepot parses the latest DepotInfo callback, enriches it from
// MaaResource and writes Paths.DataDir/depot.json.
func (s *Service) RecognizeDepot(ctx context.Context) (*DepotResult, error) {
	return s.RecognizeDepotRequest(ctx, Request{})
}

// RecognizeDepotRequest is RecognizeDepot with per-call overrides. The
// overrides are used by tests and by callers that captured a log window.
func (s *Service) RecognizeDepotRequest(ctx context.Context, request Request) (*DepotResult, error) {
	logPath := s.effectiveLogPath(request)
	payloads, err := s.loadPayloads(ctx, TaskDepot, request)
	if err != nil {
		return nil, depotLogUnavailable(logPath, err)
	}
	if len(payloads) == 0 {
		s.logger.Warn("未找到 DepotInfo 数据", "logPath", logPath)
		return nil, depotNotFound(logPath)
	}

	selected := SelectRecognitionPayload(payloads, hasDepotPayload)
	if selected == nil {
		return nil, depotDataEmpty(logPath)
	}
	if !selected.Complete {
		s.logger.Warn("未找到完成的 DepotInfo，使用最后一次识别结果", "logPath", logPath)
	}

	depotData, parseErr := ParseDepotPayloadData(payloadDetails(selected.Payload))
	if parseErr != nil {
		return nil, depotParseFailed(logPath, parseErr)
	}
	itemCount := depotDataLength(depotData)
	if itemCount == 0 {
		return nil, depotDataEmpty(logPath)
	}

	entries := depotEntries(depotData)
	database, databaseErr := s.loadItemDatabase()
	if databaseErr != nil {
		s.logger.Warn("加载 MaaResource 物品信息失败", "error", databaseErr)
		database = nil
	}
	items := make([]DepotItem, 0, len(entries))
	for _, entry := range entries {
		info := database.info(entry.ID)
		items = append(items, DepotItem{
			ID:           entry.ID,
			Name:         info.name,
			Count:        entry.Count,
			Icon:         info.icon,
			IconID:       info.iconID,
			ClassifyType: info.classifyType,
			SortID:       info.sortID,
		})
	}
	sort.SliceStable(items, func(left, right int) bool {
		return items[left].SortID < items[right].SortID
	})

	outputPath := filepath.Join(s.effectiveDataDir(request), "depot.json")
	output := DepotOutput{
		Timestamp: s.timestamp(),
		ItemCount: itemCount,
		Items:     items,
		Complete:  selected.Complete,
	}
	if err := jsonstore.Write(outputPath, output, true); err != nil {
		return nil, depotProcessingFailed(logPath, err)
	}
	s.logger.Info("仓库数据已保存", "path", outputPath, "itemCount", itemCount)

	return &DepotResult{
		Data: DepotData{
			Path:      outputPath,
			ItemCount: itemCount,
			Items:     items,
			Complete:  selected.Complete,
		},
		Output:  output,
		Written: true,
	}, nil
}

// RecognizeOperBox parses the latest completed OperBoxInfo callback and
// writes Paths.DataDir/operbox.json. Incomplete recognitions return a stable
// conflict and never overwrite the existing snapshot.
func (s *Service) RecognizeOperBox(ctx context.Context) (*OperBoxResult, error) {
	return s.RecognizeOperBoxRequest(ctx, Request{})
}

// RecognizeOperBoxRequest is RecognizeOperBox with per-call overrides.
func (s *Service) RecognizeOperBoxRequest(ctx context.Context, request Request) (*OperBoxResult, error) {
	logPath := s.effectiveLogPath(request)
	payloads, err := s.loadPayloads(ctx, TaskOperBox, request)
	if err != nil {
		return nil, operBoxLogUnavailable(logPath, err)
	}
	if len(payloads) == 0 {
		s.logger.Warn("未找到 OperBoxInfo 数据", "logPath", logPath)
		return nil, operBoxNotFound(logPath)
	}

	selected := SelectRecognitionPayload(payloads, hasOperBoxPayload)
	if selected == nil {
		return nil, operBoxDataEmpty(logPath)
	}
	if !selected.Complete {
		s.logger.Warn("干员识别未完成，保留已有干员数据", "logPath", logPath)
		return nil, operBoxIncomplete(logPath)
	}

	details := payloadDetails(selected.Payload)
	opers, _ := details["own_opers"].([]any)
	if opers == nil {
		opers = []any{}
	}

	allOpers := make([]OperBoxRecord, 0, len(opers))
	if allOpersValue, ok := details["all_opers"].([]any); ok {
		allOpers = make([]OperBoxRecord, 0, len(allOpersValue))
		for _, oper := range allOpersValue {
			record, _ := asRecord(oper)
			own := false
			if value, ok := record["own"].(bool); ok && value {
				own = true
			}
			if normalized, ok := toOperBoxRecord(oper, own); ok {
				allOpers = append(allOpers, normalized)
			}
		}
	} else {
		for _, oper := range opers {
			if normalized, ok := toOperBoxRecord(oper, true); ok {
				allOpers = append(allOpers, normalized)
			}
		}
	}

	outputPath := filepath.Join(s.effectiveDataDir(request), "operbox.json")
	output := OperBoxOutput{
		Timestamp:      s.timestamp(),
		OperCount:      len(opers),
		TotalOperCount: len(allOpers),
		Data:           opers,
		AllOpers:       allOpers,
	}
	if err := jsonstore.Write(outputPath, output, true); err != nil {
		return nil, operBoxProcessingFailed(logPath, err)
	}
	s.logger.Info("干员数据已保存", "path", outputPath, "operCount", len(opers), "totalOperCount", len(allOpers))

	return &OperBoxResult{
		Data: OperBoxData{
			Path:           outputPath,
			OperCount:      len(opers),
			TotalOperCount: len(allOpers),
			Data:           opers,
			AllOpers:       allOpers,
		},
		Output:  output,
		Written: true,
	}, nil
}

func (s *Service) loadPayloads(ctx context.Context, task Task, request Request) ([]Payload, error) {
	if request.Payloads != nil {
		return request.Payloads, nil
	}
	return s.executor.Payloads(ctx, task, request)
}

func (s *Service) effectiveLogPath(request Request) string {
	if request.LogPath != "" {
		return request.LogPath
	}
	return s.defaultLogPath
}

func (s *Service) effectiveDataDir(request Request) string {
	if request.DataDir != "" {
		return request.DataDir
	}
	return s.paths.DataDir
}

func (s *Service) timestamp() string {
	return s.now().UTC().Format(timestampLayout)
}

func hasDepotPayload(payload Payload) bool {
	data := payloadDetails(payload)["data"]
	if _, ok := data.(string); ok {
		return true
	}
	_, ok := data.(map[string]any)
	return ok
}

func hasOperBoxPayload(payload Payload) bool {
	_, ok := payloadDetails(payload)["own_opers"].([]any)
	return ok
}

// toOperBoxRecord mirrors dataParserService.toOperBoxRecord, including the
// strict `own === true` check.
func toOperBoxRecord(oper any, own bool) (OperBoxRecord, bool) {
	record, ok := asRecord(oper)
	if !ok {
		return OperBoxRecord{}, false
	}
	id, ok := record["id"].(string)
	if !ok || id == "" {
		return OperBoxRecord{}, false
	}
	name, ok := nonEmptyString(record["name"])
	if !ok {
		name = id
	}
	return OperBoxRecord{
		ID:     id,
		Name:   name,
		Rarity: finiteNumberOrZero(record["rarity"]),
		Own:    own,
	}, true
}

func depotLogUnavailable(logPath string, err error) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_DEPOT_LOG_UNAVAILABLE",
		"无法读取 MAA 日志: "+err.Error(),
		http.StatusInternalServerError,
		true,
		map[string]any{"logPath": logPath},
	)
}

func depotNotFound(logPath string) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_DEPOT_NOT_FOUND",
		"MAA 日志中未找到仓库识别结果，请先运行仓库识别任务",
		http.StatusNotFound,
		true,
		map[string]any{"logPath": logPath},
	)
}

func depotDataEmpty(logPath string) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_DEPOT_DATA_EMPTY",
		"仓库识别结果为空，请重新运行仓库识别任务",
		http.StatusUnprocessableEntity,
		true,
		map[string]any{"logPath": logPath},
	)
}

func depotParseFailed(logPath string, err error) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_DEPOT_PARSE_FAILED",
		"仓库识别数据解析失败: "+err.Error(),
		http.StatusInternalServerError,
		true,
		map[string]any{"logPath": logPath},
	)
}

func depotProcessingFailed(logPath string, err error) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_DEPOT_PROCESSING_FAILED",
		"解析仓库数据失败: "+err.Error(),
		http.StatusInternalServerError,
		true,
		map[string]any{"logPath": logPath},
	)
}

func operBoxLogUnavailable(logPath string, err error) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_OPERBOX_LOG_UNAVAILABLE",
		"无法读取 MAA 日志: "+err.Error(),
		http.StatusInternalServerError,
		true,
		map[string]any{"logPath": logPath},
	)
}

func operBoxNotFound(logPath string) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_OPERBOX_NOT_FOUND",
		"MAA 日志中未找到干员识别结果，请先运行干员识别任务",
		http.StatusNotFound,
		true,
		map[string]any{"logPath": logPath},
	)
}

func operBoxDataEmpty(logPath string) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_OPERBOX_DATA_EMPTY",
		"干员识别结果为空，请重新运行干员识别任务",
		http.StatusUnprocessableEntity,
		true,
		map[string]any{"logPath": logPath},
	)
}

func operBoxIncomplete(logPath string) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_OPERBOX_RECOGNITION_INCOMPLETE",
		"干员识别未完成，未覆盖已有数据，请重试",
		http.StatusConflict,
		true,
		map[string]any{"logPath": logPath},
	)
}

func operBoxProcessingFailed(logPath string, err error) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_OPERBOX_PROCESSING_FAILED",
		"解析干员数据失败: "+err.Error(),
		http.StatusInternalServerError,
		true,
		map[string]any{"logPath": logPath},
	)
}
