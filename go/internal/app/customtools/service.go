package customtools

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/mps233/la-pluma/go/internal/config"
	domainrun "github.com/mps233/la-pluma/go/internal/domain/agentrun"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// Executor is the single external dependency of the package. The MAA service
// satisfies it; tests inject a fake. wait is forwarded unchanged to the
// tracked Run lifecycle.
type Executor interface {
	RunTask(ctx context.Context, taskConfig map[string]any, wait bool) (domainrun.DTO, error)
}

// Options configures a Service. A missing Executor is allowed for read-only
// listing and task-config validation; Run then returns a stable error.
type Options struct {
	Paths    config.Paths
	Executor Executor
}

// Service owns custom tool definitions and turns validated client parameters
// into MAA Custom task configs.
type Service struct {
	paths    config.Paths
	executor Executor
}

// New returns a Service for the given paths and executor. Either argument may
// be zero when only listing or validation is needed.
func New(paths config.Paths, executor Executor) *Service {
	return NewWithOptions(Options{Paths: paths, Executor: executor})
}

// NewWithOptions returns a fully configurable Service.
func NewWithOptions(options Options) *Service {
	return &Service{paths: options.Paths, executor: options.Executor}
}

// ListTools returns the client-facing tool list: built-in definitions merged
// with JSON definitions from Paths.DataDir/custom-tools.
func (s *Service) ListTools() ([]Tool, error) {
	definitions, err := s.definitions()
	if err != nil {
		return nil, err
	}
	tools := make([]Tool, 0, len(definitions))
	for _, definition := range definitions {
		tools = append(tools, toolFromDefinition(definition))
	}
	return tools, nil
}

// BuildTaskConfig validates toolId and its parameters and returns the JSON
// shape written to the MAA dynamic task file:
//
//	{"name": ..., "type": "Custom", "params": {...}}
func (s *Service) BuildTaskConfig(toolID string, input any) (map[string]any, error) {
	definitions, err := s.definitions()
	if err != nil {
		return nil, err
	}

	trimmedID := strings.TrimSpace(toolID)
	var definition *Definition
	allowed := make([]string, 0, len(definitions))
	for index := range definitions {
		allowed = append(allowed, definitions[index].ID)
		if definition == nil && definitions[index].ID == trimmedID {
			definition = &definitions[index]
		}
	}
	if definition == nil {
		return nil, notFoundError(toolID, allowed)
	}

	source := map[string]any{}
	if record, ok := toRecord(input); ok {
		source = record
	}

	params := map[string]any{
		"task_names": append([]string(nil), definition.TaskNames...),
	}
	switch definition.ID {
	case "pixel-paint":
		normalized, err := normalizePixelPaint(source)
		if err != nil {
			return nil, err
		}
		params["pixel_paint"] = normalized
	case "auto-raise-potential":
		params["auto_raise_potential"] = map[string]any{
			"use_normal_token": jsTruthy(source["use_normal_token"]),
		}
	case "event-shop-blacklist":
		normalized, err := normalizeBlacklist(source)
		if err != nil {
			return nil, err
		}
		params["event_shop"] = normalized
	default:
		if definition.ParamsKey != "" {
			params[definition.ParamsKey] = cloneRecord(source)
		}
	}

	return map[string]any{
		"name":   definition.Name,
		"type":   "Custom",
		"params": params,
	}, nil
}

// Plan builds the dry-run plan used by /actions/run-custom-tool. toolId is
// echoed as supplied, matching the Node route.
func (s *Service) Plan(toolID string, params any) (map[string]any, error) {
	taskConfig, err := s.BuildTaskConfig(toolID, params)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"action":     "run-custom-tool",
		"toolId":     toolID,
		"taskConfig": taskConfig,
	}, nil
}

// Run validates the request and executes it through the injected Executor.
// The returned Run DTO is the same object the Agent API returns as `data`.
func (s *Service) Run(ctx context.Context, toolID string, params any, wait bool) (domainrun.DTO, error) {
	taskConfig, err := s.BuildTaskConfig(toolID, params)
	if err != nil {
		return domainrun.DTO{}, err
	}
	if s.executor == nil {
		return domainrun.DTO{}, apperrors.WithStatus(
			"AGENT_CUSTOM_TOOL_EXECUTOR_UNAVAILABLE",
			"自定义工具执行器不可用",
			http.StatusServiceUnavailable,
			true,
			map[string]any{"toolId": strings.TrimSpace(toolID)},
		)
	}
	return s.executor.RunTask(ctx, taskConfig, wait)
}

func notFoundError(toolID string, allowed []string) *apperrors.Error {
	return apperrors.WithStatus(
		"AGENT_CUSTOM_TOOL_NOT_FOUND",
		"未找到自定义工具: "+toolID,
		http.StatusNotFound,
		false,
		map[string]any{"toolId": toolID, "allowed": allowed},
	)
}

func invalidParamsError(toolID, reason string, extra map[string]any) *apperrors.Error {
	details := map[string]any{"toolId": toolID, "reason": reason}
	for key, value := range extra {
		details[key] = value
	}
	return apperrors.WithStatus(
		"AGENT_CUSTOM_TOOL_PARAMS_INVALID",
		"工具参数不合法: "+reason,
		http.StatusBadRequest,
		false,
		details,
	)
}

func itoa(value int) string {
	return strconv.Itoa(value)
}
