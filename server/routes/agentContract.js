import { AGENT_TASK_COMMANDS } from '../services/agentActionService.js';

export const API_VERSION = '2026-07-12';

const runtimeDefault = (key) => ({ 'x-la-pluma-runtime-default': key });

const profileIdProperty = {
  type: 'string',
  minLength: 1,
  maxLength: 64,
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$',
  default: 'default',
  description: 'Saved connection profile id. Explicit connection fields override values loaded from this profile.'
};

const runIdProperty = {
  type: 'string',
  format: 'uuid',
  description: 'Server-generated id for one Agent API execution.'
};

const idempotencyKeyProperty = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$',
  description: 'Client-generated key that identifies one logical execution request.'
};

const idempotencyPolicy = (appliesWhen = null) => ({
  supported: true,
  required: false,
  header: 'Idempotency-Key',
  scope: 'local-instance',
  namespace: 'operationId',
  survivesRestart: true,
  restartBehavior: 'active-runs-become-interrupted',
  retentionSeconds: 24 * 60 * 60,
  retentionMode: 'up-to',
  maxTerminalRuns: 500,
  ...(appliesWhen ? { appliesWhen } : {})
});

const safety = (level, options = {}) => ({
  level,
  riskLevel: level,
  readOnly: options.readOnly ?? level === 'read-only',
  idempotent: options.idempotent ?? level === 'read-only',
  mutatesDevice: options.mutatesDevice ?? level === 'consequential',
  destructive: options.destructive ?? false,
  confirmationRequired: options.confirmationRequired ?? level === 'consequential',
  confirmationRecommended: options.confirmationRecommended ?? false,
  sideEffects: options.sideEffects || []
});

const execution = ({
  mode = 'request-response',
  dryRun = false,
  waitForCompletion = false,
  pollAction = null,
  stopAction = null,
  preflightAction = null,
  conflictsWith = [],
  producesRun = false,
  idempotency = null
} = {}) => ({
  mode,
  supportsDryRun: dryRun,
  dryRun: {
    supported: dryRun,
    ...(dryRun ? { parameter: 'dryRun' } : {})
  },
  supportsWaitForCompletion: waitForCompletion,
  waitForCompletion: {
    supported: waitForCompletion,
    ...(waitForCompletion ? { parameter: 'waitForCompletion', default: true } : {})
  },
  ...(pollAction ? { pollAction } : {}),
  ...(stopAction ? { stopAction } : {}),
  ...(preflightAction ? { preflightAction } : {}),
  ...(conflictsWith.length ? { conflictsWith } : {}),
  ...(producesRun ? { producesRun: true, runLookupAction: 'get_run' } : {}),
  ...(idempotency ? { idempotency } : {})
});

const readOnly = safety('read-only');
const lowRiskWrite = (sideEffects = [], options = {}) => safety('low-risk-write', { sideEffects, ...options });
const consequential = (sideEffects = [], options = {}) => safety('consequential', {
  confirmationRequired: true,
  confirmationRecommended: true,
  mutatesDevice: true,
  sideEffects,
  ...options
});

const operation = (definition) => ({
  advertised: true,
  tags: ['Agent'],
  safety: readOnly,
  execution: execution(),
  ...definition
});

export const AGENT_OPERATIONS = Object.freeze([
  operation({
    id: 'get_manifest',
    method: 'GET',
    path: '/api/agent/manifest',
    description: 'Discover AI-readable capabilities and action contracts.',
    advertised: false,
    discovery: true,
    tags: ['Discovery']
  }),
  operation({
    id: 'get_openapi',
    method: 'GET',
    path: '/api/agent/openapi.json',
    description: 'Return the OpenAPI 3.1 contract for the Agent API.',
    advertised: false,
    discovery: true,
    responseKind: 'openapi',
    tags: ['Discovery']
  }),
  operation({
    id: 'get_status',
    method: 'GET',
    path: '/api/agent/status',
    description: 'Return a compact, AI-readable summary of La Pluma, MAA, ADB, WebRTC, and recent logs.',
    tags: ['Status'],
    safety: lowRiskWrite(['adb_connect'], { idempotent: true }),
    query_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        adbPath: { type: 'string', ...runtimeDefault('adbPath') },
        address: { type: 'string', ...runtimeDefault('adbAddress') }
      }
    }
  }),
  operation({
    id: 'test_connection',
    method: 'POST',
    path: '/api/agent/actions/test-connection',
    description: 'Check ADB availability and emulator connectivity.',
    tags: ['Connection'],
    safety: lowRiskWrite(['adb_connect']),
    body_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        adbPath: { type: 'string', ...runtimeDefault('adbPath') },
        address: { type: 'string', ...runtimeDefault('adbAddress') }
      }
    }
  }),
  operation({
    id: 'discover_devices',
    method: 'GET',
    path: '/api/agent/actions/discover-devices',
    description: 'List ADB-visible devices and reachable common local emulator ports.',
    tags: ['Connection'],
    safety: lowRiskWrite(['probe_local_adb_ports']),
    query_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        adbPath: { type: 'string', ...runtimeDefault('adbPath') }
      }
    }
  }),
  operation({
    id: 'activity_run_preflight',
    method: 'GET',
    path: '/api/agent/activity/preflight',
    description: 'Check the current activity and whether MAA has reliable home-screen navigation. This never starts a copilot.',
    tags: ['Activity'],
    query_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        clientType: { type: 'string', ...runtimeDefault('clientType') }
      }
    }
  }),
  operation({
    id: 'activity_copilot_candidates',
    method: 'GET',
    path: '/api/agent/activity/copilot-candidates',
    description: 'Find manual-selection copilot candidates for the current activity. This never starts a copilot.',
    tags: ['Activity'],
    query_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        clientType: { type: 'string', ...runtimeDefault('clientType') }
      }
    }
  }),
  operation({
    id: 'run_current_activity_copilots',
    method: 'POST',
    path: '/api/agent/activity/run',
    description: 'Run the server-built current-activity copilot plan. It blocks when navigation or a reliable candidate is unavailable.',
    tags: ['Activity'],
    safety: consequential(['start_game_automation', 'consume_in_game_resources']),
    execution: execution({
      mode: 'long-running',
      pollAction: 'get_current_run',
      stopAction: 'stop_task',
      preflightAction: 'activity_run_preflight',
      conflictsWith: ['maa-execution'],
      producesRun: true,
      idempotency: idempotencyPolicy()
    }),
    body_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        clientType: { type: 'string', ...runtimeDefault('clientType') }
      }
    }
  }),
  operation({
    id: 'start_game',
    method: 'POST',
    path: '/api/agent/actions/start-game',
    description: 'Run maa startup for the selected client. Default is Official.',
    tags: ['Execution'],
    safety: consequential(['launch_game']),
    execution: execution({
      mode: 'sync-or-background',
      waitForCompletion: true,
      pollAction: 'get_current_run',
      stopAction: 'stop_task',
      conflictsWith: ['maa-execution'],
      producesRun: true,
      idempotency: idempotencyPolicy()
    }),
    body_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        clientType: { type: 'string', ...runtimeDefault('clientType') },
        address: { type: 'string', ...runtimeDefault('adbAddress') },
        waitForCompletion: { type: 'boolean', default: true }
      }
    }
  }),
  operation({
    id: 'fight',
    method: 'POST',
    path: '/api/agent/actions/fight',
    description: 'Semantic action for 理智作战. Agents can pass stages/medicine/stone/series without knowing maa-cli flags.',
    tags: ['Execution'],
    safety: consequential(['start_game_automation', 'consume_sanity', 'optionally_consume_medicine_or_originium']),
    execution: execution({
      mode: 'sync-or-background',
      dryRun: true,
      waitForCompletion: true,
      pollAction: 'get_current_run',
      stopAction: 'stop_task',
      conflictsWith: ['maa-execution'],
      producesRun: true,
      idempotency: idempotencyPolicy({ dryRun: false })
    }),
    body_schema: {
      type: 'object',
      required: ['stages'],
      properties: {
        stages: {
          type: 'array',
          minItems: 1,
          items: {
            oneOf: [
              { type: 'string', examples: ['1-7'] },
              {
                type: 'object',
                required: ['stage'],
                properties: {
                  stage: { type: 'string', examples: ['CE-6'] },
                  times: { type: ['integer', 'string'], description: 'Optional per-stage run count.' }
                }
              }
            ]
          },
          examples: [['HD-7', 'CE-6', 'AP-5']]
        },
        medicine: { type: ['integer', 'string'], default: 0, description: 'Normal sanity medicine count for -m.' },
        expiringMedicine: { type: ['integer', 'string'], default: 0, description: 'Expiring sanity medicine count.' },
        stone: { type: ['integer', 'string'], default: 0, description: 'Originium stone count.' },
        series: { type: ['integer', 'string'], default: 0, description: 'MAA --series value; omit or set 1 to use maa-cli default.' },
        dryRun: { type: 'boolean', default: false },
        waitForCompletion: { type: 'boolean', default: true }
      }
    }
  }),
  operation({
    id: 'run_task',
    method: 'POST',
    path: '/api/agent/actions/run-task',
    description: 'Run one whitelisted maa-cli task with explicit args. Prefer semantic actions when available.',
    tags: ['Execution'],
    safety: consequential(['run_maa_command']),
    execution: execution({
      mode: 'sync-or-background',
      waitForCompletion: true,
      pollAction: 'get_current_run',
      stopAction: 'stop_task',
      conflictsWith: ['maa-execution'],
      producesRun: true,
      idempotency: idempotencyPolicy()
    }),
    body_schema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string', enum: [...AGENT_TASK_COMMANDS] },
        args: { type: 'array', items: { type: 'string' }, default: [] },
        taskConfig: {
          oneOf: [
            {
              type: 'object',
              required: ['name', 'type'],
              properties: {
                name: { type: 'string', minLength: 1 },
                type: { type: 'string', minLength: 1 },
                params: { type: 'object', additionalProperties: true }
              },
              additionalProperties: true
            },
            { type: 'string', description: 'A JSON-encoded task configuration object.' }
          ],
          description: 'When supplied, La Pluma writes a validated temporary MAA task and executes it.'
        },
        taskName: { type: 'string', maxLength: 160, description: 'Human-readable task name exposed through task status.' },
        taskType: { type: 'string', maxLength: 64, description: 'Caller-defined task category exposed through task status.' },
        userResource: { type: 'boolean', default: false },
        waitForCompletion: { type: 'boolean', default: true }
      }
    }
  }),
  operation({
    id: 'stop_task',
    method: 'POST',
    path: '/api/agent/actions/stop',
    description: 'Stop the currently running MAA task if any.',
    tags: ['Execution'],
    safety: safety('low-risk-write', {
      idempotent: true,
      mutatesDevice: true,
      destructive: true,
      sideEffects: ['interrupt_running_automation']
    }),
    body_schema: {
      type: 'object',
      properties: {
        runId: {
          ...runIdProperty,
          description: 'Optional guard: only stop the current execution when its run id matches.'
        }
      }
    }
  }),
  operation({
    id: 'get_current_run',
    method: 'GET',
    path: '/api/agent/runs/current',
    description: 'Return current MAA task, schedule execution state, and recent logs for polling.',
    tags: ['Status'],
    query_schema: {
      type: 'object',
      properties: {
        lines: { type: 'integer', minimum: 1, maximum: 500, default: 80, description: 'Maximum number of recent log lines to include.' }
      }
    }
  }),
  operation({
    id: 'get_run',
    method: 'GET',
    path: '/api/agent/runs/{runId}',
    description: 'Return the retained state and outcome of one Agent API execution.',
    tags: ['Status'],
    responseKind: 'run',
    path_schema: {
      type: 'object',
      required: ['runId'],
      properties: { runId: runIdProperty }
    }
  }),
  operation({
    id: 'get_screenshot',
    method: 'POST',
    path: '/api/agent/screen/screenshot',
    description: 'Capture the emulator screen as base64 PNG with timestamp and dimensions.',
    tags: ['Preview'],
    safety: lowRiskWrite(['adb_connect', 'capture_screenshot']),
    body_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        adbPath: { type: 'string', ...runtimeDefault('adbPath') },
        address: { type: 'string', ...runtimeDefault('adbAddress') }
      }
    }
  }),
  operation({
    id: 'run_daily_flow',
    method: 'POST',
    path: '/api/agent/actions/run-daily-flow',
    description: 'Run the saved enabled automation task flow. Use dryRun=true first to inspect the command plan.',
    tags: ['Execution'],
    safety: consequential(['run_saved_automation_flow']),
    execution: execution({
      mode: 'long-running',
      dryRun: true,
      pollAction: 'get_current_run',
      stopAction: 'stop_task',
      conflictsWith: ['maa-execution'],
      producesRun: true,
      idempotency: idempotencyPolicy({ dryRun: false })
    }),
    body_schema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', default: false },
        scheduleId: { type: 'string', minLength: 1, maxLength: 128, default: 'agent-daily-flow' },
        taskFlow: { type: 'array', items: { type: 'object' }, description: 'Optional task flow override; defaults to saved automation-tasks config.' }
      }
    }
  }),
  operation({
    id: 'recent_logs',
    method: 'GET',
    path: '/api/agent/logs/recent',
    description: 'Return recent in-memory MAA logs with optional line count.',
    tags: ['Logs'],
    query_schema: {
      type: 'object',
      properties: {
        lines: { type: 'integer', minimum: 1, maximum: 500, default: 80, description: 'Maximum number of log lines to return.' }
      }
    }
  }),
  operation({
    id: 'webrtc_status',
    method: 'GET',
    path: '/api/agent/webrtc/status',
    description: 'Return lightweight WebRTC endpoint hints for the browser preview.',
    tags: ['Preview'],
    query_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        adbPath: { type: 'string', ...runtimeDefault('adbPath') },
        address: { type: 'string', ...runtimeDefault('adbAddress') }
      }
    }
  }),
  operation({
    id: 'webrtc_devices',
    method: 'GET',
    path: '/api/agent/webrtc/devices',
    description: 'Return online ScrcpyOverWebRTC device ids in an AI-readable shape.',
    tags: ['Preview']
  }),
  operation({
    id: 'webrtc_start',
    method: 'POST',
    path: '/api/agent/webrtc/start',
    description: 'Start signaling/TURN and MuMu agent, then return signaling URL, ICE servers, and device id.',
    tags: ['Preview'],
    safety: lowRiskWrite(['start_local_webrtc_services'], { mutatesDevice: true }),
    execution: execution({ mode: 'long-running' }),
    body_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        adbPath: { type: 'string', ...runtimeDefault('adbPath') },
        address: { type: 'string', ...runtimeDefault('adbAddress') },
        deviceId: { type: 'string', default: 'mumu-la-pluma' }
      }
    }
  }),
  operation({
    id: 'webrtc_stop',
    method: 'POST',
    path: '/api/agent/webrtc/stop',
    description: 'Stop MuMu agent and signaling/TURN managed by La Pluma.',
    tags: ['Preview'],
    safety: lowRiskWrite(['stop_local_webrtc_services'], { mutatesDevice: true, idempotent: true }),
    body_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        adbPath: { type: 'string', ...runtimeDefault('adbPath') },
        address: { type: 'string', ...runtimeDefault('adbAddress') }
      }
    }
  }),
  operation({
    id: 'preview_orientation',
    method: 'POST',
    path: '/api/agent/preview/orientation',
    description: 'Set Android emulator orientation for the live preview/device. Uses ADB settings + keyevent fallback and returns observed display state.',
    tags: ['Preview'],
    safety: lowRiskWrite(['change_device_orientation'], { mutatesDevice: true }),
    execution: execution({ dryRun: true }),
    body_schema: {
      type: 'object',
      required: ['orientation'],
      properties: {
        orientation: { type: 'string', enum: ['portrait', 'landscape', 'auto'] },
        profileId: profileIdProperty,
        adbPath: { type: 'string', ...runtimeDefault('adbPath') },
        address: { type: 'string', ...runtimeDefault('adbAddress') },
        dryRun: { type: 'boolean', default: false }
      }
    }
  }),
  operation({
    id: 'get_current_activity',
    method: 'GET',
    path: '/api/agent/activity',
    description: 'Return the current event, available stages, source metadata, and completion state.',
    tags: ['Activity'],
    query_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        clientType: { type: 'string', ...runtimeDefault('clientType') }
      }
    }
  })
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeDefaults(defaults = {}) {
  const values = {
    adbPath: defaults.adbPath,
    adbAddress: defaults.adbAddress ?? defaults.address,
    clientType: defaults.clientType
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function materializeRuntimeDefaults(value, defaults) {
  if (Array.isArray(value)) {
    return value.map(item => materializeRuntimeDefaults(item, defaults));
  }
  if (!value || typeof value !== 'object') return value;

  const result = {};
  const defaultKey = value['x-la-pluma-runtime-default'];
  for (const [key, child] of Object.entries(value)) {
    if (key === 'x-la-pluma-runtime-default') continue;
    result[key] = materializeRuntimeDefaults(child, defaults);
  }
  if (defaultKey && defaults[defaultKey] !== undefined) {
    result.default = defaults[defaultKey];
  }
  return result;
}

function materializeOperation(definition, defaults = {}) {
  return materializeRuntimeDefaults(clone(definition), normalizeDefaults(defaults));
}

function manifestAction(definition, defaults) {
  const item = materializeOperation(definition, defaults);
  const action = {
    id: item.id,
    method: item.method,
    path: item.path,
    description: item.description
  };
  if (item.body_schema) action.body_schema = item.body_schema;
  if (item.query_schema) action.query_schema = item.query_schema;
  if (item.path_schema) action.path_schema = item.path_schema;
  if (item.execution.idempotency?.supported) {
    action.header_schema = {
      type: 'object',
      properties: {
        'Idempotency-Key': clone(idempotencyKeyProperty)
      }
    };
  }
  action.safety = item.safety;
  action.execution = item.execution;
  return action;
}

export function buildAgentManifest(defaults = {}) {
  const resolvedDefaults = normalizeDefaults(defaults);
  return {
    name: 'La Pluma Agent API',
    id: 'la-pluma-agent-api',
    version: API_VERSION,
    description: 'AI-readable control surface for MAA / Arknights automation through La Pluma.',
    auth: {
      type: 'optional-bearer-or-x-la-pluma-token',
      requiredWhen: 'LA_PLUMA_TOKEN is set on the backend',
      schemes: [
        { type: 'http-bearer', header: 'Authorization', format: 'Bearer <LA_PLUMA_TOKEN>' },
        { type: 'api-key', header: 'X-La-Pluma-Token' }
      ],
      note: 'Either token form is accepted. Authentication is disabled when LA_PLUMA_TOKEN is unset.'
    },
    defaults: resolvedDefaults,
    links: {
      status: '/api/agent/status',
      openapi: '/api/agent/openapi.json',
      currentRun: '/api/agent/runs/current',
      run: '/api/agent/runs/{runId}',
      screenshot: '/api/agent/screen/screenshot',
      recentLogs: '/api/agent/logs/recent?lines=80'
    },
    actions: AGENT_OPERATIONS
      .filter(item => item.advertised)
      .map(item => manifestAction(item, resolvedDefaults))
  };
}

function queryParameters(schema = {}) {
  const required = new Set(schema.required || []);
  return Object.entries(schema.properties || {}).map(([name, property]) => ({
    name,
    in: 'query',
    required: required.has(name),
    ...(property.description ? { description: property.description } : {}),
    schema: property
  }));
}

function pathParameters(schema = {}) {
  return Object.entries(schema.properties || {}).map(([name, property]) => ({
    name,
    in: 'path',
    required: true,
    ...(property.description ? { description: property.description } : {}),
    schema: property
  }));
}

const standardErrorResponses = {
  400: { $ref: '#/components/responses/BadRequest' },
  401: { $ref: '#/components/responses/Unauthorized' },
  404: { $ref: '#/components/responses/NotFound' },
  409: { $ref: '#/components/responses/Conflict' },
  422: { $ref: '#/components/responses/UnprocessableEntity' },
  500: { $ref: '#/components/responses/InternalServerError' },
  503: { $ref: '#/components/responses/ServiceUnavailable' }
};

function openApiOperation(definition, defaults) {
  const item = materializeOperation(definition, defaults);
  const successSchema = item.responseKind === 'openapi'
    ? { $ref: '#/components/schemas/OpenApiDocument' }
    : item.responseKind === 'run'
      ? { $ref: '#/components/schemas/RunResponse' }
      : { $ref: '#/components/schemas/SuccessResponse' };
  const runHeaders = item.execution.producesRun
    ? {
        'X-La-Pluma-Run-Id': {
          description: 'Server-generated run id for this execution.',
          schema: runIdProperty
        },
        'Idempotency-Replayed': {
          description: 'True when this response reuses an earlier request with the same idempotency key.',
          schema: { type: 'boolean', default: false }
        }
      }
    : null;
  const result = {
    operationId: item.id,
    tags: item.tags,
    summary: item.description,
    description: item.description,
    security: [
      { bearerAuth: [] },
      { laPlumaToken: [] },
      {}
    ],
    'x-la-pluma-safety': item.safety,
    'x-la-pluma-execution': item.execution,
    responses: {
      200: {
        description: item.responseKind === 'openapi' ? 'OpenAPI 3.1 document' : 'Successful La Pluma API response',
        ...(runHeaders ? { headers: runHeaders } : {}),
        content: {
          'application/json': { schema: successSchema }
        }
      },
      ...standardErrorResponses
    }
  };

  const parameters = [
    ...(item.path_schema ? pathParameters(item.path_schema) : []),
    ...(item.query_schema ? queryParameters(item.query_schema) : []),
    ...(item.execution.idempotency?.supported
      ? [{ $ref: '#/components/parameters/IdempotencyKey' }]
      : [])
  ];
  if (parameters.length) result.parameters = parameters;
  if (item.execution.producesRun) {
    result.responses[202] = {
      description: 'The execution was accepted and can be polled by run id.',
      headers: {
        Location: {
          description: 'Relative URL of the accepted run.',
          schema: { type: 'string', format: 'uri-reference' }
        },
        ...runHeaders
      },
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/SuccessResponse' }
        }
      }
    };
  }
  if (item.method !== 'GET' && item.body_schema) {
    result.requestBody = {
      required: Boolean(item.body_schema.required?.length),
      content: {
        'application/json': { schema: item.body_schema }
      }
    };
  }
  return result;
}

function reusableErrorResponse(description) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' }
      }
    }
  };
}

export function buildOpenApiSpec(defaults = {}) {
  const paths = {};
  for (const definition of AGENT_OPERATIONS) {
    const method = definition.method.toLowerCase();
    paths[definition.path] = {
      ...(paths[definition.path] || {}),
      [method]: openApiOperation(definition, defaults)
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'La Pluma Agent API',
      version: API_VERSION,
      description: 'AI-friendly action and status surface for La Pluma / maa-cli automation.'
    },
    servers: [{ url: '/' }],
    security: [
      { bearerAuth: [] },
      { laPlumaToken: [] },
      {}
    ],
    tags: [
      { name: 'Discovery' },
      { name: 'Status' },
      { name: 'Connection' },
      { name: 'Activity' },
      { name: 'Execution' },
      { name: 'Logs' },
      { name: 'Preview' }
    ],
    paths,
    components: {
      parameters: {
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description: 'Deduplicates one logical execution within the same operation on this local La Pluma instance across normal process restarts. Records are retained for up to 24 hours and may be evicted sooner when the 500-terminal-run cap is exceeded. Active runs restored after a restart become interrupted and are not resumed.',
          schema: idempotencyKeyProperty
        }
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'LA_PLUMA_TOKEN',
          description: 'Optional LA_PLUMA_TOKEN sent through the Authorization header.'
        },
        laPlumaToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-La-Pluma-Token',
          description: 'Optional LA_PLUMA_TOKEN sent through the X-La-Pluma-Token header.'
        }
      },
      schemas: {
        ResponseMeta: {
          type: 'object',
          required: ['requestId', 'dryRun'],
          properties: {
            requestId: { type: ['string', 'null'] },
            dryRun: { type: 'boolean', default: false }
          },
          additionalProperties: true
        },
        SuccessResponse: {
          type: 'object',
          required: ['success', 'message', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', const: true },
            message: { type: 'string' },
            data: {},
            meta: { $ref: '#/components/schemas/ResponseMeta' }
          },
          additionalProperties: false
        },
        AgentError: {
          type: 'object',
          required: ['code', 'details', 'retryable'],
          properties: {
            code: { type: 'string' },
            details: { type: 'object', additionalProperties: true },
            retryable: { type: 'boolean' }
          },
          additionalProperties: false
        },
        RunProgress: {
          type: 'object',
          properties: {
            currentStep: { type: ['integer', 'null'], minimum: -1 },
            totalSteps: { type: ['integer', 'null'], minimum: 0 },
            currentTask: {},
            message: { type: ['string', 'null'] }
          },
          additionalProperties: true
        },
        RunLinks: {
          type: 'object',
          required: ['self'],
          properties: {
            self: { type: 'string', format: 'uri-reference' },
            stop: { type: 'string', format: 'uri-reference' }
          },
          additionalProperties: false
        },
        RunError: {
          type: 'object',
          required: ['code', 'message', 'details', 'retryable', 'statusCode'],
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            details: { type: 'object', additionalProperties: true },
            retryable: { type: 'boolean' },
            statusCode: { type: 'integer', minimum: 400, maximum: 599 }
          },
          additionalProperties: false
        },
        Run: {
          type: 'object',
          required: ['runId', 'operationId', 'state', 'acceptedAt', 'links'],
          properties: {
            runId: runIdProperty,
            operationId: { type: 'string' },
            state: {
              type: 'string',
              enum: ['accepted', 'running', 'succeeded', 'failed', 'stopping', 'stopped', 'interrupted']
            },
            acceptedAt: { type: 'string', format: 'date-time' },
            startedAt: { type: ['string', 'null'], format: 'date-time' },
            finishedAt: { type: ['string', 'null'], format: 'date-time' },
            durationMs: { type: ['integer', 'null'], minimum: 0 },
            progress: { $ref: '#/components/schemas/RunProgress' },
            result: {},
            error: { $ref: '#/components/schemas/RunError' },
            links: { $ref: '#/components/schemas/RunLinks' }
          },
          additionalProperties: false
        },
        RunResponse: {
          allOf: [
            { $ref: '#/components/schemas/SuccessResponse' },
            {
              type: 'object',
              properties: {
                data: { $ref: '#/components/schemas/Run' }
              }
            }
          ]
        },
        ErrorResponse: {
          type: 'object',
          required: ['success', 'message', 'error', 'meta'],
          properties: {
            success: { type: 'boolean', const: false },
            message: { type: 'string' },
            error: { $ref: '#/components/schemas/AgentError' },
            meta: { $ref: '#/components/schemas/ResponseMeta' }
          },
          additionalProperties: false
        },
        ApiResponse: {
          oneOf: [
            { $ref: '#/components/schemas/SuccessResponse' },
            { $ref: '#/components/schemas/ErrorResponse' }
          ]
        },
        OpenApiDocument: {
          type: 'object',
          required: ['openapi', 'info', 'paths'],
          properties: {
            openapi: { type: 'string' },
            info: { type: 'object' },
            paths: { type: 'object' }
          },
          additionalProperties: true
        }
      },
      responses: {
        BadRequest: reusableErrorResponse('The request failed validation.'),
        Unauthorized: reusableErrorResponse('A configured LA_PLUMA_TOKEN was missing or invalid.'),
        NotFound: reusableErrorResponse('The requested resource was not found.'),
        Conflict: reusableErrorResponse('The operation conflicts with the current execution state.'),
        UnprocessableEntity: reusableErrorResponse('The request was valid but the requested automation could not be completed.'),
        InternalServerError: reusableErrorResponse('The operation failed unexpectedly.'),
        ServiceUnavailable: reusableErrorResponse('The service cannot safely accept the operation until its required runtime state is available.')
      }
    }
  };
}
