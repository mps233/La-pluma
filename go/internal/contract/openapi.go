package contract

import (
	"sort"
	"strings"
)

// OpenAPI returns the OpenAPI 3.1 document without runtime connection defaults.
func OpenAPI() map[string]any {
	return OpenAPIWithDefaults(RuntimeDefaults{})
}

// OpenAPIWithDefaults builds the OpenAPI 3.1 document, substituting connection
// defaults into schema properties that declare a runtime default marker.
func OpenAPIWithDefaults(defaults RuntimeDefaults) map[string]any {
	normalized := normalizeDefaults(defaults)
	paths := map[string]any{}
	for _, item := range Operations() {
		pathItem, _ := paths[item.Path].(map[string]any)
		if pathItem == nil {
			pathItem = map[string]any{}
			paths[item.Path] = pathItem
		}
		pathItem[strings.ToLower(item.Method)] = openAPIOperation(item, normalized)
	}

	return map[string]any{
		"openapi": "3.1.0",
		"info": map[string]any{
			"title":       "La Pluma Agent API",
			"version":     APIVersion,
			"description": "AI-friendly action and status surface for La Pluma / maa-cli automation.",
		},
		"servers":  []any{map[string]any{"url": "/"}},
		"security": securityRequirements(),
		"tags": []any{
			map[string]any{"name": "Discovery"},
			map[string]any{"name": "Status"},
			map[string]any{"name": "Connection"},
			map[string]any{"name": "Activity"},
			map[string]any{"name": "Execution"},
			map[string]any{"name": "Logs"},
			map[string]any{"name": "Preview"},
		},
		"paths": paths,
		"components": map[string]any{
			"parameters":      componentParameters(),
			"securitySchemes": componentSecuritySchemes(),
			"schemas":         componentSchemas(),
			"responses":       componentResponses(),
		},
	}
}

func securityRequirements() []any {
	return []any{
		map[string]any{"bearerAuth": []any{}},
		map[string]any{"laPlumaToken": []any{}},
		map[string]any{},
	}
}

func openAPIOperation(item Operation, defaults map[string]string) map[string]any {
	runHeaders := runHeadersValue()

	okResponse := map[string]any{
		"description": successDescription(item.ResponseKind),
		"content": map[string]any{
			"application/json": map[string]any{
				"schema": successSchema(item.ResponseKind),
			},
		},
	}
	if item.Execution.ProducesRun {
		okResponse["headers"] = runHeaders
	}

	responses := map[string]any{"200": okResponse}
	for status, response := range standardErrorResponses() {
		responses[status] = response
	}
	if item.Execution.ProducesRun {
		acceptedHeaders := map[string]any{
			"Location": map[string]any{
				"description": "Relative URL of the accepted run.",
				"schema":      map[string]any{"type": "string", "format": "uri-reference"},
			},
		}
		for name, header := range runHeaders {
			acceptedHeaders[name] = header
		}
		responses["202"] = map[string]any{
			"description": "The execution was accepted and can be polled by run id.",
			"headers":     acceptedHeaders,
			"content": map[string]any{
				"application/json": map[string]any{
					"schema": schemaRef("SuccessResponse"),
				},
			},
		}
	}

	result := map[string]any{
		"operationId":          item.ID,
		"tags":                 append([]string{}, item.Tags...),
		"summary":              item.Description,
		"description":          item.Description,
		"security":             securityRequirements(),
		"x-la-pluma-safety":    safetyValue(item.Safety),
		"x-la-pluma-execution": executionValue(item.Execution),
		"responses":            responses,
	}

	parameters := make([]any, 0, 8)
	if item.PathSchema != nil {
		parameters = append(parameters, pathParameters(item.PathSchema, defaults)...)
	}
	if item.QuerySchema != nil {
		parameters = append(parameters, queryParameters(item.QuerySchema, defaults)...)
	}
	if idempotencySupported(item.Execution) {
		parameters = append(parameters, map[string]any{"$ref": "#/components/parameters/IdempotencyKey"})
	}
	if len(parameters) != 0 {
		result["parameters"] = parameters
	}

	if item.Method != "GET" && item.BodySchema != nil {
		result["requestBody"] = map[string]any{
			"required": len(requiredNames(item.BodySchema)) != 0,
			"content": map[string]any{
				"application/json": map[string]any{
					"schema": materializeSchema(item.BodySchema, defaults),
				},
			},
		}
	}

	return result
}

func successDescription(responseKind string) string {
	if responseKind == "openapi" {
		return "OpenAPI 3.1 document"
	}
	return "Successful La Pluma API response"
}

func successSchema(responseKind string) map[string]any {
	switch responseKind {
	case "openapi":
		return schemaRef("OpenApiDocument")
	case "run":
		return schemaRef("RunResponse")
	default:
		return schemaRef("SuccessResponse")
	}
}

func schemaRef(name string) map[string]any {
	return map[string]any{"$ref": "#/components/schemas/" + name}
}

func responseRef(name string) map[string]any {
	return map[string]any{"$ref": "#/components/responses/" + name}
}

func standardErrorResponses() map[string]any {
	return map[string]any{
		"400": responseRef("BadRequest"),
		"401": responseRef("Unauthorized"),
		"404": responseRef("NotFound"),
		"409": responseRef("Conflict"),
		"422": responseRef("UnprocessableEntity"),
		"500": responseRef("InternalServerError"),
		"503": responseRef("ServiceUnavailable"),
	}
}

func runHeadersValue() map[string]any {
	return map[string]any{
		"X-La-Pluma-Run-Id": map[string]any{
			"description": "Server-generated run id for this execution.",
			"schema":      runIDProperty(),
		},
		"Idempotency-Replayed": map[string]any{
			"description": "True when this response reuses an earlier request with the same idempotency key.",
			"schema":      map[string]any{"type": "boolean", "default": false},
		},
	}
}

func schemaProperties(schema map[string]any) map[string]any {
	properties, _ := schema["properties"].(map[string]any)
	if properties == nil {
		return map[string]any{}
	}
	return properties
}

func requiredNames(schema map[string]any) []string {
	switch required := schema["required"].(type) {
	case []string:
		return required
	case []any:
		result := make([]string, 0, len(required))
		for _, item := range required {
			if name, ok := item.(string); ok {
				result = append(result, name)
			}
		}
		return result
	default:
		return nil
	}
}

func requiredSet(schema map[string]any) map[string]bool {
	result := map[string]bool{}
	for _, name := range requiredNames(schema) {
		result[name] = true
	}
	return result
}

func parameterDescription(property map[string]any) (string, bool) {
	description, ok := property["description"].(string)
	return description, ok && description != ""
}

func pathParameters(schema map[string]any, defaults map[string]string) []any {
	materialized := materializeSchema(schema, defaults)
	properties := schemaProperties(materialized)
	names := make([]string, 0, len(properties))
	for name := range properties {
		names = append(names, name)
	}
	sort.Strings(names)

	result := make([]any, 0, len(names))
	for _, name := range names {
		property, _ := properties[name].(map[string]any)
		parameter := map[string]any{
			"name":     name,
			"in":       "path",
			"required": true,
			"schema":   property,
		}
		if description, ok := parameterDescription(property); ok {
			parameter["description"] = description
		}
		result = append(result, parameter)
	}
	return result
}

func queryParameters(schema map[string]any, defaults map[string]string) []any {
	materialized := materializeSchema(schema, defaults)
	properties := schemaProperties(materialized)
	required := requiredSet(materialized)
	names := make([]string, 0, len(properties))
	for name := range properties {
		names = append(names, name)
	}
	sort.Strings(names)

	result := make([]any, 0, len(names))
	for _, name := range names {
		property, _ := properties[name].(map[string]any)
		parameter := map[string]any{
			"name":     name,
			"in":       "query",
			"required": required[name],
			"schema":   property,
		}
		if description, ok := parameterDescription(property); ok {
			parameter["description"] = description
		}
		result = append(result, parameter)
	}
	return result
}

func componentParameters() map[string]any {
	return map[string]any{
		"IdempotencyKey": map[string]any{
			"name":        "Idempotency-Key",
			"in":          "header",
			"required":    false,
			"description": "Deduplicates one logical execution within the same operation on this local La Pluma instance across normal process restarts. Records are retained for up to 24 hours and may be evicted sooner when the 500-terminal-run cap is exceeded. Active runs restored after a restart become interrupted and are not resumed.",
			"schema":      idempotencyKeyProperty(),
		},
	}
}

func componentSecuritySchemes() map[string]any {
	return map[string]any{
		"bearerAuth": map[string]any{
			"type":         "http",
			"scheme":       "bearer",
			"bearerFormat": "LA_PLUMA_TOKEN",
			"description":  "Optional LA_PLUMA_TOKEN sent through the Authorization header.",
		},
		"laPlumaToken": map[string]any{
			"type":        "apiKey",
			"in":          "header",
			"name":        "X-La-Pluma-Token",
			"description": "Optional LA_PLUMA_TOKEN sent through the X-La-Pluma-Token header.",
		},
	}
}

func reusableErrorResponse(description string) map[string]any {
	return map[string]any{
		"description": description,
		"content": map[string]any{
			"application/json": map[string]any{
				"schema": schemaRef("ErrorResponse"),
			},
		},
	}
}

func componentResponses() map[string]any {
	return map[string]any{
		"BadRequest":          reusableErrorResponse("The request failed validation."),
		"Unauthorized":        reusableErrorResponse("A configured LA_PLUMA_TOKEN was missing or invalid."),
		"NotFound":            reusableErrorResponse("The requested resource was not found."),
		"Conflict":            reusableErrorResponse("The operation conflicts with the current execution state."),
		"UnprocessableEntity": reusableErrorResponse("The request was valid but the requested automation could not be completed."),
		"InternalServerError": reusableErrorResponse("The operation failed unexpectedly."),
		"ServiceUnavailable":  reusableErrorResponse("The service cannot safely accept the operation until its required runtime state is available."),
	}
}

func componentSchemas() map[string]any {
	return map[string]any{
		"ResponseMeta": map[string]any{
			"type":     "object",
			"required": []string{"requestId", "dryRun"},
			"properties": map[string]any{
				"requestId": map[string]any{"type": []string{"string", "null"}},
				"dryRun":    map[string]any{"type": "boolean", "default": false},
			},
			"additionalProperties": true,
		},
		"SuccessResponse": map[string]any{
			"type":     "object",
			"required": []string{"success", "message", "data", "meta"},
			"properties": map[string]any{
				"success": map[string]any{"type": "boolean", "const": true},
				"message": map[string]any{"type": "string"},
				"data":    map[string]any{},
				"meta":    schemaRef("ResponseMeta"),
			},
			"additionalProperties": false,
		},
		"AgentError": map[string]any{
			"type":     "object",
			"required": []string{"code", "details", "retryable"},
			"properties": map[string]any{
				"code":      map[string]any{"type": "string"},
				"details":   map[string]any{"type": "object", "additionalProperties": true},
				"retryable": map[string]any{"type": "boolean"},
			},
			"additionalProperties": false,
		},
		"RunProgress": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"currentStep": map[string]any{"type": []string{"integer", "null"}, "minimum": -1},
				"totalSteps":  map[string]any{"type": []string{"integer", "null"}, "minimum": 0},
				"currentTask": map[string]any{},
				"message":     map[string]any{"type": []string{"string", "null"}},
				"battle": map[string]any{
					"type":     "object",
					"required": []string{"kills", "total"},
					"properties": map[string]any{
						"kills": map[string]any{"type": "integer", "minimum": 0},
						"total": map[string]any{"type": "integer", "minimum": 1},
					},
					"additionalProperties": false,
				},
			},
			"additionalProperties": true,
		},
		"RunLinks": map[string]any{
			"type":     "object",
			"required": []string{"self"},
			"properties": map[string]any{
				"self":         map[string]any{"type": "string", "format": "uri-reference"},
				"stop":         map[string]any{"type": "string", "format": "uri-reference"},
				"targetedStop": map[string]any{"type": "string", "format": "uri-reference"},
			},
			"additionalProperties": false,
		},
		"RunError": map[string]any{
			"type":     "object",
			"required": []string{"code", "message", "details", "retryable", "statusCode"},
			"properties": map[string]any{
				"code":       map[string]any{"type": "string"},
				"message":    map[string]any{"type": "string"},
				"details":    map[string]any{"type": "object", "additionalProperties": true},
				"retryable":  map[string]any{"type": "boolean"},
				"statusCode": map[string]any{"type": "integer", "minimum": 400, "maximum": 599},
			},
			"additionalProperties": false,
		},
		"Run": map[string]any{
			"type":     "object",
			"required": []string{"runId", "operationId", "state", "acceptedAt", "links"},
			"properties": map[string]any{
				"runId":       runIDProperty(),
				"operationId": map[string]any{"type": "string"},
				"state": map[string]any{
					"type": "string",
					"enum": []string{"accepted", "waiting", "running", "succeeded", "failed", "stopping", "stopped", "interrupted"},
				},
				"acceptedAt":  map[string]any{"type": "string", "format": "date-time"},
				"startedAt":   map[string]any{"type": []string{"string", "null"}, "format": "date-time"},
				"finishedAt":  map[string]any{"type": []string{"string", "null"}, "format": "date-time"},
				"durationMs":  map[string]any{"type": []string{"integer", "null"}, "minimum": 0},
				"trigger":     map[string]any{"type": []string{"object", "null"}, "additionalProperties": true},
				"progress":    schemaRef("RunProgress"),
				"taskResults": map[string]any{"type": "array", "items": map[string]any{"type": "object", "additionalProperties": true}},
				"result":      map[string]any{},
				"error":       schemaRef("RunError"),
				"links":       schemaRef("RunLinks"),
			},
			"additionalProperties": false,
		},
		"RunResponse": map[string]any{
			"allOf": []any{
				schemaRef("SuccessResponse"),
				map[string]any{
					"type": "object",
					"properties": map[string]any{
						"data": schemaRef("Run"),
					},
				},
			},
		},
		"ErrorResponse": map[string]any{
			"type":     "object",
			"required": []string{"success", "message", "error", "meta"},
			"properties": map[string]any{
				"success": map[string]any{"type": "boolean", "const": false},
				"message": map[string]any{"type": "string"},
				"error":   schemaRef("AgentError"),
				"meta":    schemaRef("ResponseMeta"),
			},
			"additionalProperties": false,
		},
		"ApiResponse": map[string]any{
			"oneOf": []any{
				schemaRef("SuccessResponse"),
				schemaRef("ErrorResponse"),
			},
		},
		"OpenApiDocument": map[string]any{
			"type":     "object",
			"required": []string{"openapi", "info", "paths"},
			"properties": map[string]any{
				"openapi": map[string]any{"type": "string"},
				"info":    map[string]any{"type": "object"},
				"paths":   map[string]any{"type": "object"},
			},
			"additionalProperties": true,
		},
	}
}
