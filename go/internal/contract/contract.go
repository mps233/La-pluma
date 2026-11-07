// Package contract owns the Agent API operation registry. The manifest and
// OpenAPI 3.1 document are derived from that single registry so advertised
// actions and generated operations cannot drift apart.
package contract

// APIVersion is the Agent API contract version.
const APIVersion = "2026-07-12"

// API_VERSION mirrors the Node oracle's exported constant name.
const API_VERSION = APIVersion

// Safety describes the side-effect profile of an operation.
type Safety struct {
	Level                   string
	RiskLevel               string
	ReadOnly                bool
	Idempotent              bool
	MutatesDevice           bool
	Destructive             bool
	ConfirmationRequired    bool
	ConfirmationRecommended bool
	SideEffects             []string
}

// Execution describes how an operation runs, how it can be polled or stopped,
// and which idempotency guarantees it provides.
type Execution struct {
	Mode                       string
	SupportsDryRun             bool
	DryRunParameter            *string
	SupportsWaitForCompletion  bool
	WaitForCompletionParameter *string
	WaitForCompletionDefault   *bool
	PollAction                 *string
	StopAction                 *string
	PreflightAction            *string
	ConflictsWith              []string
	ProducesRun                bool
	RunLookupAction            *string
	Idempotency                map[string]any
}

// Operation is one Agent API action contract.
type Operation struct {
	ID           string
	Method       string
	Path         string
	Description  string
	Advertised   bool
	Tags         []string
	Safety       Safety
	Execution    Execution
	ResponseKind string
	BodySchema   map[string]any
	QuerySchema  map[string]any
	PathSchema   map[string]any
}

type safetyOptions struct {
	readOnly                *bool
	idempotent              *bool
	mutatesDevice           *bool
	destructive             *bool
	confirmationRequired    *bool
	confirmationRecommended *bool
}

type executionOptions struct {
	mode              string
	dryRun            bool
	waitForCompletion bool
	pollAction        *string
	stopAction        *string
	preflightAction   *string
	conflictsWith     []string
	producesRun       bool
	idempotency       map[string]any
}

func boolPtr(value bool) *bool {
	return &value
}

func stringPtr(value string) *string {
	return &value
}

func resolveBool(override *bool, fallback bool) bool {
	if override != nil {
		return *override
	}
	return fallback
}

func safety(level string, options safetyOptions) Safety {
	sideEffects := []string{}
	return Safety{
		Level:                   level,
		RiskLevel:               level,
		ReadOnly:                resolveBool(options.readOnly, level == "read-only"),
		Idempotent:              resolveBool(options.idempotent, level == "read-only"),
		MutatesDevice:           resolveBool(options.mutatesDevice, level == "consequential"),
		Destructive:             resolveBool(options.destructive, false),
		ConfirmationRequired:    resolveBool(options.confirmationRequired, level == "consequential"),
		ConfirmationRecommended: resolveBool(options.confirmationRecommended, false),
		SideEffects:             sideEffects,
	}
}

func readOnlySafety() Safety {
	return safety("read-only", safetyOptions{})
}

func lowRiskWriteSafety(sideEffects []string, options safetyOptions) Safety {
	return safetyWithSideEffects("low-risk-write", sideEffects, options)
}

func safetyWithSideEffects(level string, sideEffects []string, options safetyOptions) Safety {
	result := safety(level, options)
	if sideEffects != nil {
		result.SideEffects = append([]string{}, sideEffects...)
	}
	return result
}

func consequentialSafety(sideEffects []string, options safetyOptions) Safety {
	enabled := true
	if options.confirmationRequired == nil {
		options.confirmationRequired = &enabled
	}
	if options.confirmationRecommended == nil {
		options.confirmationRecommended = &enabled
	}
	if options.mutatesDevice == nil {
		options.mutatesDevice = &enabled
	}
	return safetyWithSideEffects("consequential", sideEffects, options)
}

func defaultExecution() Execution {
	return execution(executionOptions{})
}

func execution(options executionOptions) Execution {
	if options.mode == "" {
		options.mode = "request-response"
	}
	result := Execution{
		Mode:                      options.mode,
		SupportsDryRun:            options.dryRun,
		SupportsWaitForCompletion: options.waitForCompletion,
		PollAction:                options.pollAction,
		StopAction:                options.stopAction,
		PreflightAction:           options.preflightAction,
		ProducesRun:               options.producesRun,
	}
	if options.dryRun {
		result.DryRunParameter = stringPtr("dryRun")
	}
	if options.waitForCompletion {
		result.WaitForCompletionParameter = stringPtr("waitForCompletion")
		result.WaitForCompletionDefault = boolPtr(true)
	}
	if len(options.conflictsWith) != 0 {
		result.ConflictsWith = append([]string{}, options.conflictsWith...)
	}
	if options.producesRun {
		result.RunLookupAction = stringPtr("get_run")
	}
	if options.idempotency != nil {
		result.Idempotency = options.idempotency
	}
	return result
}

func idempotencyPolicy(appliesWhen map[string]any) map[string]any {
	policy := map[string]any{
		"supported":        true,
		"required":         false,
		"header":           "Idempotency-Key",
		"scope":            "local-instance",
		"namespace":        "operationId",
		"survivesRestart":  true,
		"restartBehavior":  "active-runs-become-interrupted",
		"retentionSeconds": 24 * 60 * 60,
		"retentionMode":    "up-to",
		"maxTerminalRuns":  500,
	}
	if appliesWhen != nil {
		policy["appliesWhen"] = cloneValue(appliesWhen)
	}
	return policy
}

func operation(id, method, path, description string) Operation {
	return Operation{
		ID:          id,
		Method:      method,
		Path:        path,
		Description: description,
		Advertised:  true,
		Tags:        []string{"Agent"},
		Safety:      readOnlySafety(),
		Execution:   defaultExecution(),
	}
}

func (o Operation) withTags(tags ...string) Operation {
	o.Tags = tags
	return o
}

func (o Operation) hidden() Operation {
	o.Advertised = false
	return o
}

func (o Operation) withSafety(value Safety) Operation {
	o.Safety = value
	return o
}

func (o Operation) withExecution(value Execution) Operation {
	o.Execution = value
	return o
}

func (o Operation) withResponseKind(value string) Operation {
	o.ResponseKind = value
	return o
}

func (o Operation) withBodySchema(value map[string]any) Operation {
	o.BodySchema = value
	return o
}

func (o Operation) withQuerySchema(value map[string]any) Operation {
	o.QuerySchema = value
	return o
}

func (o Operation) withPathSchema(value map[string]any) Operation {
	o.PathSchema = value
	return o
}

func cloneValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			result[key] = cloneValue(item)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			result[index] = cloneValue(item)
		}
		return result
	case []string:
		return append([]string{}, typed...)
	case map[string]string:
		result := make(map[string]string, len(typed))
		for key, item := range typed {
			result[key] = item
		}
		return result
	default:
		return value
	}
}

func cloneMap(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	result := make(map[string]any, len(value))
	for key, item := range value {
		result[key] = cloneValue(item)
	}
	return result
}

func cloneStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	return stringPtr(*value)
}

func cloneBoolPtr(value *bool) *bool {
	if value == nil {
		return nil
	}
	return boolPtr(*value)
}

func cloneOperation(source Operation) Operation {
	result := source
	result.Tags = append([]string{}, source.Tags...)
	result.Safety.SideEffects = append([]string{}, source.Safety.SideEffects...)
	result.Execution.ConflictsWith = append([]string(nil), source.Execution.ConflictsWith...)
	result.Execution.DryRunParameter = cloneStringPtr(source.Execution.DryRunParameter)
	result.Execution.WaitForCompletionParameter = cloneStringPtr(source.Execution.WaitForCompletionParameter)
	result.Execution.WaitForCompletionDefault = cloneBoolPtr(source.Execution.WaitForCompletionDefault)
	result.Execution.PollAction = cloneStringPtr(source.Execution.PollAction)
	result.Execution.StopAction = cloneStringPtr(source.Execution.StopAction)
	result.Execution.PreflightAction = cloneStringPtr(source.Execution.PreflightAction)
	result.Execution.RunLookupAction = cloneStringPtr(source.Execution.RunLookupAction)
	result.Execution.Idempotency = cloneMap(source.Execution.Idempotency)
	result.BodySchema = cloneMap(source.BodySchema)
	result.QuerySchema = cloneMap(source.QuerySchema)
	result.PathSchema = cloneMap(source.PathSchema)
	return result
}

func safetyValue(source Safety) map[string]any {
	sideEffects := source.SideEffects
	if sideEffects == nil {
		sideEffects = []string{}
	}
	return map[string]any{
		"level":                   source.Level,
		"riskLevel":               source.RiskLevel,
		"readOnly":                source.ReadOnly,
		"idempotent":              source.Idempotent,
		"mutatesDevice":           source.MutatesDevice,
		"destructive":             source.Destructive,
		"confirmationRequired":    source.ConfirmationRequired,
		"confirmationRecommended": source.ConfirmationRecommended,
		"sideEffects":             append([]string{}, sideEffects...),
	}
}

func executionValue(source Execution) map[string]any {
	dryRun := map[string]any{"supported": source.SupportsDryRun}
	if source.DryRunParameter != nil {
		dryRun["parameter"] = *source.DryRunParameter
	}
	waitForCompletion := map[string]any{"supported": source.SupportsWaitForCompletion}
	if source.WaitForCompletionParameter != nil {
		waitForCompletion["parameter"] = *source.WaitForCompletionParameter
	}
	if source.WaitForCompletionDefault != nil {
		waitForCompletion["default"] = *source.WaitForCompletionDefault
	}

	result := map[string]any{
		"mode":                      source.Mode,
		"supportsDryRun":            source.SupportsDryRun,
		"dryRun":                    dryRun,
		"supportsWaitForCompletion": source.SupportsWaitForCompletion,
		"waitForCompletion":         waitForCompletion,
	}
	if source.PollAction != nil {
		result["pollAction"] = *source.PollAction
	}
	if source.StopAction != nil {
		result["stopAction"] = *source.StopAction
	}
	if source.PreflightAction != nil {
		result["preflightAction"] = *source.PreflightAction
	}
	if len(source.ConflictsWith) != 0 {
		result["conflictsWith"] = append([]string{}, source.ConflictsWith...)
	}
	if source.ProducesRun {
		result["producesRun"] = true
		if source.RunLookupAction != nil {
			result["runLookupAction"] = *source.RunLookupAction
		} else {
			result["runLookupAction"] = "get_run"
		}
	}
	if source.Idempotency != nil {
		result["idempotency"] = cloneMap(source.Idempotency)
	}
	return result
}

func idempotencySupported(source Execution) bool {
	if source.Idempotency == nil {
		return false
	}
	supported, _ := source.Idempotency["supported"].(bool)
	return supported
}
