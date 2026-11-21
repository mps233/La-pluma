import { AGENT_TASK_COMMANDS, AGENT_TASK_DYNAMIC_COMMAND } from '../services/agentActionService.ts';
import { AGENT_TASK_CONFIG_SCHEMA } from '../services/agentTaskContract.ts';
import type { JsonSchema, RuntimeDefaultKey } from '../services/agentTaskContract.ts';
import { GAME_TASK_LIMITS } from '../services/gameTaskConfigService.ts';
import { API_VERSION } from '../config/apiVersion.ts';

const FIGHT_LIMITS = GAME_TASK_LIMITS.Fight;

/**
 * 能力清单与 manifest/OpenAPI 生成器共用同一份 `AGENT_OPERATIONS`，生成器只做纯投影、
 * 不另维护第二份 schema；模块本身不读取环境变量、文件或设备状态。
 */

/** 版本常量的单一字面量来源在 config/apiVersion.ts；此处 re-export 保持既有导入路径。 */
export { API_VERSION };

export type { JsonSchema, JsonSchemaType, RuntimeDefaultKey } from '../services/agentTaskContract.ts';

/** manifest 构建输入：只声明运行配置里会被写入 schema 默认值的字段。 */
export interface AgentRuntimeDefaults {
  adbPath?: string;
  adbAddress?: string;
  /** 旧调用方使用的别名，按 adbAddress 处理。 */
  address?: string;
  clientType?: string;
}

export type AgentSafetyLevel = 'read-only' | 'low-risk-write' | 'consequential';

export interface AgentOperationSafety {
  level: AgentSafetyLevel;
  riskLevel: AgentSafetyLevel;
  readOnly: boolean;
  idempotent: boolean;
  mutatesDevice: boolean;
  destructive: boolean;
  confirmationRequired: boolean;
  confirmationRecommended: boolean;
  sideEffects: string[];
}

export interface AgentExecutionSupport {
  supported: boolean;
  parameter?: string;
  default?: boolean;
}

export interface AgentIdempotencyPolicy {
  supported: boolean;
  required: boolean;
  header: string;
  scope: string;
  namespace: string;
  survivesRestart: boolean;
  restartBehavior: string;
  retentionSeconds: number;
  retentionMode: string;
  maxTerminalRuns: number;
  appliesWhen?: { dryRun: boolean };
}

export interface AgentOperationExecution {
  mode: string;
  supportsDryRun: boolean;
  dryRun: AgentExecutionSupport;
  supportsWaitForCompletion: boolean;
  waitForCompletion: AgentExecutionSupport;
  pollAction?: string;
  stopAction?: string;
  preflightAction?: string;
  conflictsWith?: string[];
  producesRun?: boolean;
  runLookupAction?: string;
  idempotency?: AgentIdempotencyPolicy;
}

/** 清单中的一条能力定义；`advertised` 决定是否进入 manifest。 */
export interface AgentOperationDefinition {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  description: string;
  tags: string[];
  advertised?: boolean;
  discovery?: boolean;
  responseKind?: 'openapi' | 'run' | 'run-snapshot';
  safety?: AgentOperationSafety;
  execution?: AgentOperationExecution;
  query_schema?: JsonSchema;
  body_schema?: JsonSchema;
  path_schema?: JsonSchema;
}

export interface RegisteredAgentOperation extends AgentOperationDefinition {
  advertised: boolean;
  safety: AgentOperationSafety;
  execution: AgentOperationExecution;
}

export interface AgentManifestAction {
  id: string;
  method: string;
  path: string;
  description: string;
  body_schema?: JsonSchema;
  query_schema?: JsonSchema;
  path_schema?: JsonSchema;
  header_schema?: JsonSchema;
  safety: AgentOperationSafety;
  execution: AgentOperationExecution;
}

export interface AgentManifest {
  name: string;
  id: 'la-pluma-agent-api';
  version: string;
  description: string;
  auth: {
    type: string;
    requiredWhen: string;
    schemes: Array<{ type: string; header: string; format?: string }>;
    note: string;
  };
  defaults: Record<string, string>;
  links: {
    status: string;
    openapi: string;
    currentRun: string;
    run: string;
    screenshot: string;
    recentLogs: string;
  };
  actions: AgentManifestAction[];
}

export interface OpenApiMediaType {
  schema: JsonSchema;
}

export interface OpenApiHeader {
  description: string;
  schema: JsonSchema;
}

export interface OpenApiResponse {
  $ref?: string;
  description?: string;
  headers?: Record<string, OpenApiHeader>;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiParameter {
  $ref?: string;
  name?: string;
  in?: 'query' | 'path' | 'header';
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

export interface OpenApiRequestBody {
  required: boolean;
  content: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  operationId: string;
  tags: string[];
  summary: string;
  description: string;
  security: Array<Record<string, string[]>>;
  'x-la-pluma-safety': AgentOperationSafety;
  'x-la-pluma-execution': AgentOperationExecution;
  responses: Record<string, OpenApiResponse>;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
}

export interface OpenApiComponents {
  parameters: Record<string, OpenApiParameter>;
  securitySchemes: Record<string, Record<string, string>>;
  schemas: Record<string, JsonSchema>;
  responses: Record<string, OpenApiResponse>;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string }>;
  security: Array<Record<string, string[]>>;
  tags: Array<{ name: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: OpenApiComponents;
}

const runtimeDefault = (key: RuntimeDefaultKey): { 'x-la-pluma-runtime-default': RuntimeDefaultKey } => ({
  'x-la-pluma-runtime-default': key
});

const profileIdProperty: JsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 64,
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$',
  default: 'default',
  description: 'Saved connection profile id. Explicit connection fields override values loaded from this profile.'
};

const runIdProperty: JsonSchema = {
  type: 'string',
  format: 'uuid',
  description: 'Server-generated id for one Agent API execution.'
};

const idempotencyKeyProperty: JsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$',
  description: 'Client-generated key that identifies one logical execution request.'
};

const idempotencyPolicy = (appliesWhen: { dryRun: boolean } | null = null): AgentIdempotencyPolicy => ({
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

interface SafetyOptions {
  readOnly?: boolean;
  idempotent?: boolean;
  mutatesDevice?: boolean;
  destructive?: boolean;
  confirmationRequired?: boolean;
  confirmationRecommended?: boolean;
  sideEffects?: string[];
}

const safety = (level: AgentSafetyLevel, options: SafetyOptions = {}): AgentOperationSafety => ({
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

interface ExecutionOptions {
  mode?: string;
  dryRun?: boolean;
  waitForCompletion?: boolean;
  pollAction?: string | null;
  stopAction?: string | null;
  preflightAction?: string | null;
  conflictsWith?: string[];
  producesRun?: boolean;
  idempotency?: AgentIdempotencyPolicy | null;
}

const execution = (options: ExecutionOptions = {}): AgentOperationExecution => {
  const {
    mode = 'request-response',
    dryRun = false,
    waitForCompletion = false,
    pollAction = null,
    stopAction = null,
    preflightAction = null,
    conflictsWith = [],
    producesRun = false,
    idempotency = null
  } = options;

  return {
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
  };
};

const readOnly = safety('read-only');
const lowRiskWrite = (sideEffects: string[] = [], options: SafetyOptions = {}): AgentOperationSafety => (
  safety('low-risk-write', { sideEffects, ...options })
);
const consequential = (sideEffects: string[] = [], options: SafetyOptions = {}): AgentOperationSafety => safety('consequential', {
  confirmationRequired: true,
  confirmationRecommended: true,
  mutatesDevice: true,
  sideEffects,
  ...options
});

const operation = (definition: AgentOperationDefinition): RegisteredAgentOperation => {
  const {
    advertised = true,
    tags = ['Agent'],
    safety: operationSafety = readOnly,
    execution: operationExecution = execution(),
    ...rest
  } = definition;
  return {
    advertised,
    tags,
    safety: operationSafety,
    execution: operationExecution,
    ...rest
  };
};

export const AGENT_OPERATIONS: readonly RegisteredAgentOperation[] = Object.freeze([
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
    description: 'Return a compact, AI-readable summary of La Pluma Next, MAA, ADB, WebRTC, and recent logs.',
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
    id: 'get_diagnostics',
    method: 'GET',
    path: '/api/agent/diagnostics',
    description: 'Run read-only environment diagnostics: MAA CLI/MaaCore version, ADB connection, MAA resource version and directory completeness, and optional task preflight. Returns pass/warn/fail checks plus a readable conclusion. Only ADB connection is attempted; no Run is created.',
    tags: ['Diagnostics'],
    safety: lowRiskWrite(['adb_connect'], { idempotent: true }),
    query_schema: {
      type: 'object',
      properties: {
        profileId: profileIdProperty,
        adbPath: { type: 'string', ...runtimeDefault('adbPath') },
        address: { type: 'string', ...runtimeDefault('adbAddress') },
        command: {
          type: 'string',
          description: 'Optional maa-cli command to preflight. Any string is accepted; unknown values make the execution check fail with the allowed command list.'
        }
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
    description: 'Semantic action for 理智作战. Executes one maa-cli fight command per stage with --times, sequentially under one Run. Agents can pass stages/medicine/medicineExpireDays/stone/series without knowing maa-cli flags. medicineExpireDays maps to --medicine-expire-days; the legacy expiringMedicine bottle count maps to the deprecated --expiring-medicine flag.',
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
                  times: { type: ['integer', 'string'], description: 'Optional per-stage run count, passed as --times to that stage command.' }
                }
              }
            ]
          },
          examples: [['HD-7', 'CE-6', 'AP-5']]
        },
        medicine: {
          type: ['integer', 'string'],
          minimum: FIGHT_LIMITS.medicineExpireDays.minimum,
          default: 0,
          description: 'Normal sanity medicine count for -m.'
        },
        medicineExpireDays: {
          type: ['integer', 'string'],
          minimum: FIGHT_LIMITS.medicineExpireDays.minimum,
          default: 0,
          description: 'Use sanity medicine expiring within this many days (--medicine-expire-days); 0 disables it.'
        },
        expiringMedicine: {
          type: ['integer', 'string'],
          minimum: FIGHT_LIMITS.medicineExpireDays.minimum,
          description: 'Deprecated bottle count for older configurations; maps to --expiring-medicine. Prefer medicineExpireDays.'
        },
        stone: { type: ['integer', 'string'], default: 0, description: 'Originium stone count.' },
        series: {
          type: ['integer', 'string'],
          minimum: FIGHT_LIMITS.series.minimum,
          maximum: FIGHT_LIMITS.series.maximum,
          default: 0,
          description: 'MAA --series value (-1~10, older resources accept -1~6); default 0 is auto. Set 1 to omit the flag and use the maa-cli default.'
        },
        dryRun: { type: 'boolean', default: false },
        waitForCompletion: { type: 'boolean', default: true }
      }
    }
  }),
  operation({
    id: 'run_task',
    method: 'POST',
    path: '/api/agent/actions/run-task',
    description: 'Run one whitelisted maa-cli command or a dynamic Core task. taskConfig accepts the legacy single task object or {tasks:[...]} to run tasks in array order under one Run; each task may carry maa-cli strategy and variants, and per-task results are archived under result.tasks[index]. A failed task does not cancel later tasks; the Run fails with AGENT_DYNAMIC_TASKS_FAILED and keeps every task result in error.details.tasks, where each task stdout/stderr is capped at 4096 characters and flagged with stdoutTruncated/stderrTruncated when shortened, while the complete output stays under result.tasks[index]. OperProgress performs in-game operator upgrades and may consume materials or red certificates; it is separate from training material preparation. One OperProgress run starts at most one mastery training; mastery targets left without a callback are reported as deferredMastery/deferredCount on the action, while a busy training room appears as a skipped detail. SwitchTheme changes the game interface theme. Both require maa-cli 0.7.8+ and compatible Core/resources; use command=run with taskConfig. Prefer semantic actions when available.',
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
        command: {
          type: 'string',
          enum: [...AGENT_TASK_COMMANDS],
          description: 'maa-cli subcommand. Core-only task types without a CLI subcommand (Award, Depot, OperBox, Infrast, Recruit, Mall) execute through command=run plus taskConfig.'
        },
        args: { type: 'array', items: { type: 'string' }, default: [] },
        taskConfig: AGENT_TASK_CONFIG_SCHEMA,
        taskName: { type: 'string', maxLength: 160, description: 'Human-readable task name exposed through task status.' },
        taskType: { type: 'string', maxLength: 64, description: 'Caller-defined task category exposed through task status.' },
        userResource: { type: 'boolean', default: false },
        waitForCompletion: { type: 'boolean', default: true }
      },
      allOf: [
        {
          if: { required: ['taskConfig'], properties: { taskConfig: { type: ['object', 'string'] } } },
          then: {
            required: ['command'],
            properties: { command: { const: AGENT_TASK_DYNAMIC_COMMAND } }
          }
        },
        {
          if: { required: ['userResource'], properties: { userResource: { const: true } } },
          then: { required: ['taskConfig'] }
        }
      ]
    }
  }),
  operation({
    id: 'stop_task',
    method: 'POST',
    path: '/api/agent/actions/stop',
    description: 'Stop the currently running MAA task if any. Pass runId to guard the stop to one execution; accepted runs are canceled without touching the device. mode=after-combat defers a currently fighting Roguelike/Reclamation run: the response keeps run.state=running and returns pendingStop:{mode,requestedAt,deadline,combat} with deviceStopRequested=false, the run progress carries the same stopIntent, and the device stop is sent only after RoguelikeCombatEnd or the 600s cap. A repeated request returns the same pendingStop with alreadyPending=true. Every other target, including a run that is not in combat or whose combat state cannot be read from asst.log, falls back to an immediate stop.',
    tags: ['Execution'],
    safety: safety('low-risk-write', {
      idempotent: true,
      mutatesDevice: true,
      destructive: true,
      sideEffects: ['interrupt_running_automation']
    }),
    query_schema: {
      type: 'object',
      properties: {
        runId: {
          ...runIdProperty,
          description: 'Optional guard, used by Run links. The body field takes precedence when both are present.'
        }
      }
    },
    body_schema: {
      type: 'object',
      properties: {
        runId: {
          ...runIdProperty,
          description: 'Optional guard: only stop the current execution when its run id matches.'
        },
        mode: {
          type: 'string',
          enum: ['now', 'after-combat'],
          default: 'now',
          description: 'Stop timing. after-combat only defers a running, current run_task Roguelike/Reclamation execution that is observed in combat; all other cases stop immediately.'
        }
      }
    }
  }),
  operation({
    id: 'get_current_run',
    method: 'GET',
    path: '/api/agent/runs/current',
    description: 'Return the current run, all active run identities, the latest terminal run, device occupancy (run, external, pending, idle or unknown), schedule execution state, and recent logs for polling. An active Roguelike/Reclamation run_task carries a live progress snapshot in run.progress.roguelike (MaaCore mode, rounds started/ended/settled/passed, current round and action, recent events, settlement support, degraded/observed flags, and a blackflow projection with floor, current node, action points, last route, last node resolution, milestones and strategy when BlackFlow callbacks were observed); stopping runs still expose it. The final snapshot is copied into result.summary.progress or error.details.summary.progress of the terminal run; lastRun never carries progress.',
    tags: ['Status'],
    responseKind: 'run-snapshot',
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
      properties: {
        dryRun: { type: 'boolean', default: false },
        scheduleId: { type: 'string', minLength: 1, maxLength: 128, default: 'agent-daily-flow' },
        taskFlow: { type: 'array', items: { type: 'object' }, description: 'Optional task flow override; defaults to saved automation-tasks config.' },
        waitForCompletion: { type: 'boolean', default: true }
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
    description: 'Return lightweight WebRTC endpoint hints, including the same-origin browser signaling path.',
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
    description: 'Start signaling/TURN and MuMu agent, then return the same-origin signaling path, ICE servers, and device id.',
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
    description: 'Stop MuMu agent and signaling/TURN managed by La Pluma Next.',
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

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function normalizeDefaults(defaults: AgentRuntimeDefaults = {}): Record<string, string> {
  const values: Record<string, string | undefined> = {
    adbPath: defaults.adbPath,
    adbAddress: defaults.adbAddress ?? defaults.address,
    clientType: defaults.clientType
  };
  const entries = Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return Object.fromEntries(entries);
}

function materializeRuntimeDefaults(value: unknown, defaults: Record<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map(item => materializeRuntimeDefaults(item, defaults));
  }
  if (!value || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  const defaultKey = (value as { 'x-la-pluma-runtime-default'?: RuntimeDefaultKey })['x-la-pluma-runtime-default'];
  for (const [key, child] of Object.entries(value)) {
    if (key === 'x-la-pluma-runtime-default') continue;
    result[key] = materializeRuntimeDefaults(child, defaults);
  }
  if (defaultKey && defaults[defaultKey] !== undefined) {
    result.default = defaults[defaultKey];
  }
  return result;
}

function materializeOperation(
  definition: RegisteredAgentOperation,
  defaults: AgentRuntimeDefaults = {}
): RegisteredAgentOperation {
  const materialized: unknown = materializeRuntimeDefaults(clone(definition), normalizeDefaults(defaults));
  return materialized as RegisteredAgentOperation;
}

function manifestAction(definition: RegisteredAgentOperation, defaults: AgentRuntimeDefaults): AgentManifestAction {
  const item = materializeOperation(definition, defaults);
  return {
    id: item.id,
    method: item.method,
    path: item.path,
    description: item.description,
    ...(item.body_schema ? { body_schema: item.body_schema } : {}),
    ...(item.query_schema ? { query_schema: item.query_schema } : {}),
    ...(item.path_schema ? { path_schema: item.path_schema } : {}),
    ...(item.execution.idempotency?.supported
      ? {
          header_schema: {
            type: 'object',
            properties: {
              'Idempotency-Key': clone(idempotencyKeyProperty)
            }
          } satisfies JsonSchema
        }
      : {}),
    safety: item.safety,
    execution: item.execution
  };
}

export function buildAgentManifest(defaults: AgentRuntimeDefaults = {}): AgentManifest {
  const resolvedDefaults = normalizeDefaults(defaults);
  return {
    name: 'La Pluma Next Agent API',
    id: 'la-pluma-agent-api',
    version: API_VERSION,
    description: 'AI-readable control surface for MAA / Arknights automation through La Pluma Next.',
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

function queryParameters(schema: JsonSchema = {}): OpenApiParameter[] {
  const required = new Set(schema.required || []);
  return Object.entries(schema.properties || {}).map(([name, property]) => ({
    name,
    in: 'query',
    required: required.has(name),
    ...(property.description ? { description: property.description } : {}),
    schema: property
  }));
}

function pathParameters(schema: JsonSchema = {}): OpenApiParameter[] {
  return Object.entries(schema.properties || {}).map(([name, property]) => ({
    name,
    in: 'path',
    required: true,
    ...(property.description ? { description: property.description } : {}),
    schema: property
  }));
}

const standardErrorResponses: Record<string, OpenApiResponse> = {
  400: { $ref: '#/components/responses/BadRequest' },
  401: { $ref: '#/components/responses/Unauthorized' },
  404: { $ref: '#/components/responses/NotFound' },
  409: { $ref: '#/components/responses/Conflict' },
  422: { $ref: '#/components/responses/UnprocessableEntity' },
  500: { $ref: '#/components/responses/InternalServerError' },
  503: { $ref: '#/components/responses/ServiceUnavailable' }
};

function openApiOperation(definition: RegisteredAgentOperation, defaults: AgentRuntimeDefaults): OpenApiOperation {
  const item = materializeOperation(definition, defaults);
  const successSchema: JsonSchema = item.responseKind === 'openapi'
    ? { $ref: '#/components/schemas/OpenApiDocument' }
    : item.responseKind === 'run'
      ? { $ref: '#/components/schemas/RunResponse' }
      : item.responseKind === 'run-snapshot'
        ? { $ref: '#/components/schemas/RunSnapshotResponse' }
        : { $ref: '#/components/schemas/SuccessResponse' };
  const runHeaders: Record<string, OpenApiHeader> | null = item.execution.producesRun
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
  const result: OpenApiOperation = {
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
        description: item.responseKind === 'openapi' ? 'OpenAPI 3.1 document' : 'Successful La Pluma Next API response',
        ...(runHeaders ? { headers: runHeaders } : {}),
        content: {
          'application/json': { schema: successSchema }
        }
      },
      ...standardErrorResponses
    }
  };

  const parameters: OpenApiParameter[] = [
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

function reusableErrorResponse(description: string): OpenApiResponse {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' }
      }
    }
  };
}

export function buildOpenApiSpec(defaults: AgentRuntimeDefaults = {}): OpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
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
      title: 'La Pluma Next Agent API',
      version: API_VERSION,
      description: 'AI-friendly action and status surface for La Pluma Next / maa-cli automation.'
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
      { name: 'Diagnostics' },
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
          description: 'Deduplicates one logical execution within the same operation on this local La Pluma Next instance across normal process restarts. Records are retained for up to 24 hours and may be evicted sooner when the 500-terminal-run cap is exceeded. Active runs restored after a restart become interrupted and are not resumed.',
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
        RoguelikeBlackFlowNode: {
          type: 'object',
          required: ['id', 'name', 'type'],
          properties: {
            id: { type: 'string' },
            name: { type: ['string', 'null'] },
            type: { type: ['string', 'null'] }
          },
          additionalProperties: false
        },
        RoguelikeBlackFlowActionPoints: {
          type: 'object',
          required: ['before', 'after', 'at'],
          properties: {
            before: { type: ['number', 'null'] },
            after: { type: ['number', 'null'] },
            at: { type: ['string', 'null'], format: 'date-time' }
          },
          additionalProperties: false
        },
        RoguelikeBlackFlowRoute: {
          type: 'object',
          required: [
            'at',
            'floor',
            'target',
            'landing',
            'movement',
            'actionPointsBefore',
            'actionPointsAfter',
            'exactCost',
            'predictedCost',
            'arrived'
          ],
          properties: {
            at: { type: ['string', 'null'], format: 'date-time' },
            floor: { type: ['integer', 'null'] },
            target: {
              oneOf: [
                { $ref: '#/components/schemas/RoguelikeBlackFlowNode' },
                { type: 'null' }
              ]
            },
            landing: {
              oneOf: [
                { $ref: '#/components/schemas/RoguelikeBlackFlowNode' },
                { type: 'null' }
              ]
            },
            movement: { type: ['string', 'null'] },
            actionPointsBefore: { type: ['number', 'null'] },
            actionPointsAfter: { type: ['number', 'null'] },
            exactCost: { type: ['number', 'null'] },
            predictedCost: { type: ['number', 'null'] },
            arrived: { type: 'boolean' }
          },
          additionalProperties: false
        },
        RoguelikeBlackFlowNodeResolution: {
          type: 'object',
          required: ['at', 'floor', 'node', 'eventName', 'progress'],
          properties: {
            at: { type: ['string', 'null'], format: 'date-time' },
            floor: { type: ['integer', 'null'] },
            node: {
              oneOf: [
                { $ref: '#/components/schemas/RoguelikeBlackFlowNode' },
                { type: 'null' }
              ]
            },
            eventName: { type: ['string', 'null'] },
            progress: {
              type: ['string', 'null'],
              enum: ['active', 'completed', 'removed', null]
            }
          },
          additionalProperties: false
        },
        RoguelikeBlackFlowMilestone: {
          type: 'object',
          required: ['id', 'floor', 'progress', 'status', 'at'],
          properties: {
            id: { type: 'string' },
            floor: { type: ['integer', 'null'] },
            progress: { type: ['integer', 'null'] },
            status: { type: 'string' },
            at: { type: ['string', 'null'], format: 'date-time' }
          },
          additionalProperties: false
        },
        RoguelikeBlackFlowStrategy: {
          type: 'object',
          required: ['at', 'profile', 'outcome', 'terminationReason', 'nextAction', 'succeeded'],
          properties: {
            at: { type: ['string', 'null'], format: 'date-time' },
            profile: { type: ['string', 'null'] },
            outcome: { type: ['string', 'null'] },
            terminationReason: { type: ['string', 'null'] },
            nextAction: { type: ['string', 'null'] },
            succeeded: { type: ['boolean', 'null'] }
          },
          additionalProperties: false
        },
        RoguelikeBlackFlowProgress: {
          type: 'object',
          required: [
            'floor',
            'floorAt',
            'currentNode',
            'currentNodeAt',
            'actionPoints',
            'lastRoute',
            'lastNodeResolution',
            'milestones',
            'strategy',
            'updatedAt'
          ],
          properties: {
            floor: { type: ['integer', 'null'] },
            floorAt: { type: ['string', 'null'], format: 'date-time' },
            currentNode: {
              oneOf: [
                { $ref: '#/components/schemas/RoguelikeBlackFlowNode' },
                { type: 'null' }
              ]
            },
            currentNodeAt: { type: ['string', 'null'], format: 'date-time' },
            actionPoints: {
              oneOf: [
                { $ref: '#/components/schemas/RoguelikeBlackFlowActionPoints' },
                { type: 'null' }
              ]
            },
            lastRoute: {
              oneOf: [
                { $ref: '#/components/schemas/RoguelikeBlackFlowRoute' },
                { type: 'null' }
              ]
            },
            lastNodeResolution: {
              oneOf: [
                { $ref: '#/components/schemas/RoguelikeBlackFlowNodeResolution' },
                { type: 'null' }
              ]
            },
            milestones: {
              type: 'array',
              description: 'Newest black flow milestones first; the server keeps at most 5 entries.',
              maxItems: 5,
              items: { $ref: '#/components/schemas/RoguelikeBlackFlowMilestone' }
            },
            strategy: {
              oneOf: [
                { $ref: '#/components/schemas/RoguelikeBlackFlowStrategy' },
                { type: 'null' }
              ]
            },
            updatedAt: { type: ['string', 'null'], format: 'date-time' }
          },
          additionalProperties: false
        },
        RoguelikeProgress: {
          type: 'object',
          required: [
            'command',
            'theme',
            'mode',
            'phase',
            'currentRound',
            'roundStartedAt',
            'targetRounds',
            'roundsStarted',
            'roundsEnded',
            'roundsSettled',
            'roundsPassed',
            'settlementSupported',
            'currentAction',
            'lastEventKind',
            'lastEventName',
            'lastEventAt',
            'combatCount',
            'investment',
            'recentRounds',
            'blackflow',
            'updatedAt',
            'degraded',
            'observed'
          ],
          properties: {
            command: { type: 'string', enum: ['roguelike', 'reclamation'] },
            theme: { type: 'string' },
            mode: { type: ['integer', 'null'] },
            phase: { type: 'string', enum: ['starting', 'exploring', 'ended', 'unknown'] },
            currentRound: { type: ['integer', 'null'], minimum: 1 },
            roundStartedAt: { type: ['string', 'null'], format: 'date-time' },
            targetRounds: { type: ['integer', 'null'], minimum: 1 },
            roundsStarted: { type: 'integer', minimum: 0 },
            roundsEnded: { type: 'integer', minimum: 0 },
            roundsSettled: { type: 'integer', minimum: 0 },
            roundsPassed: { type: 'integer', minimum: 0 },
            settlementSupported: { type: ['boolean', 'null'] },
            currentAction: { type: ['string', 'null'] },
            lastEventKind: {
              type: ['string', 'null'],
              enum: ['round', 'combat', 'event', 'investment', 'task', null]
            },
            lastEventName: { type: ['string', 'null'] },
            lastEventAt: { type: ['string', 'null'], format: 'date-time' },
            combatCount: { type: 'integer', minimum: 0 },
            investment: {
              oneOf: [
                {
                  type: 'object',
                  required: ['rounds', 'count', 'total', 'deposit'],
                  properties: {
                    rounds: { type: 'integer', minimum: 0 },
                    count: { type: 'integer', minimum: 0 },
                    total: { type: ['integer', 'null'] },
                    deposit: { type: ['integer', 'null'] }
                  },
                  additionalProperties: false
                },
                { type: 'null' }
              ]
            },
            recentRounds: {
              type: 'array',
              description: 'Closed rounds newest first; the server keeps at most 5 entries.',
              items: {
                type: 'object',
                required: ['index', 'outcome', 'settled', 'floor', 'score', 'endedAt'],
                properties: {
                  index: { type: ['integer', 'null'], minimum: 1 },
                  outcome: { type: 'string', enum: ['passed', 'not_passed', 'unknown'] },
                  settled: { type: 'boolean' },
                  floor: { type: ['integer', 'null'] },
                  score: { type: ['integer', 'null'] },
                  endedAt: { type: ['string', 'null'], format: 'date-time' }
                },
                additionalProperties: false
              }
            },
            blackflow: {
              oneOf: [
                { $ref: '#/components/schemas/RoguelikeBlackFlowProgress' },
                { type: 'null' }
              ],
              description: 'Black flow projection; null unless at least one BlackFlow callback was observed.'
            },
            updatedAt: { type: 'string', format: 'date-time' },
            degraded: { type: 'boolean' },
            observed: { type: 'boolean' }
          },
          additionalProperties: false
        },
        RunProgress: {
          type: 'object',
          properties: {
            scheduleId: { type: ['string', 'null'] },
            currentStep: { type: ['integer', 'null'], minimum: -1 },
            totalSteps: { type: ['integer', 'null'], minimum: 0 },
            currentTask: {},
            shouldStop: { type: 'boolean' },
            message: { type: ['string', 'null'] },
            roguelike: { $ref: '#/components/schemas/RoguelikeProgress' },
            stopIntent: {
              type: 'object',
              required: ['mode', 'requestedAt', 'deadline', 'combat'],
              properties: {
                mode: { type: 'string', const: 'after-combat' },
                requestedAt: { type: 'string', format: 'date-time' },
                deadline: { type: 'string', format: 'date-time' },
                combat: { type: ['boolean', 'null'] }
              },
              additionalProperties: false,
              description: 'Present only while a Roguelike/Reclamation run waits for the current combat to end before the stop is sent.'
            }
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
        RunRecovery: {
          type: 'object',
          required: ['source', 'previousState', 'executionResumed', 'deviceState'],
          properties: {
            source: { type: 'string', description: 'Why the record was closed without a recorded outcome.' },
            previousState: {
              type: ['string', 'null'],
              description: 'State observed before the service restart.'
            },
            executionResumed: { type: 'boolean', const: false },
            deviceState: {
              type: 'string',
              const: 'unknown',
              description: 'The record cannot prove the device is free; verify the connection before resubmitting.'
            }
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
              enum: ['accepted', 'waiting', 'running', 'succeeded', 'failed', 'stopping', 'stopped', 'interrupted'],
              description: '"waiting" = a manual copilot set waits for the next entry and holds no execution lease; it is active, not terminal.'
            },
            acceptedAt: { type: 'string', format: 'date-time' },
            startedAt: { type: ['string', 'null'], format: 'date-time' },
            finishedAt: { type: ['string', 'null'], format: 'date-time' },
            durationMs: { type: ['integer', 'null'], minimum: 0 },
            progress: { $ref: '#/components/schemas/RunProgress' },
            result: {},
            error: { $ref: '#/components/schemas/RunError' },
            recovery: { $ref: '#/components/schemas/RunRecovery' },
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
        ScheduleExecutionSnapshot: {
          type: 'object',
          properties: {
            isRunning: { type: 'boolean' },
            scheduleId: { type: ['string', 'null'] },
            runId: { type: ['string', 'null'], format: 'uuid' },
            currentStep: { type: ['integer', 'null'], minimum: -1 },
            totalSteps: { type: 'integer', minimum: 0 },
            currentTask: { type: ['string', 'null'] },
            currentTaskId: { type: ['string', 'null'] },
            message: { type: 'string' },
            startTime: { type: ['integer', 'null'] },
            shouldStop: { type: 'boolean' },
            lastResult: {},
            taskResults: { type: 'array', items: {} }
          },
          additionalProperties: true
        },
        RunOccupancy: {
          type: 'object',
          required: ['state', 'runId', 'runState', 'lease', 'task', 'schedule', 'sources'],
          properties: {
            state: {
              type: 'string',
              enum: ['idle', 'pending', 'run', 'external', 'unknown'],
              description: '"run" = a tracked run owns execution; "external" = device activity without such a run; "pending" = only accepted or waiting runs exist; "idle" = nothing is observed; "unknown" = the lease file cannot be verified.'
            },
            runId: { type: ['string', 'null'], format: 'uuid' },
            runState: { type: ['string', 'null'] },
            sources: {
              type: 'array',
              items: { type: 'string', enum: ['run', 'task', 'schedule', 'lease'] }
            },
            lease: {
              type: 'object',
              required: ['state', 'owner'],
              properties: {
                state: {
                  type: 'string',
                  enum: ['free', 'held', 'stale', 'unknown'],
                  description: '"held" = the recorded owner process is alive; "stale" = the lock file is reclaimable; "unknown" = it cannot be interpreted.'
                },
                reason: {
                  type: ['string', 'null'],
                  description: 'Why the lease could not be interpreted; only set when state is unknown.'
                },
                owner: {
                  oneOf: [
                    {
                      type: 'object',
                      required: ['pid', 'source', 'taskName', 'command', 'startedAt'],
                      properties: {
                        pid: { type: ['integer', 'null'] },
                        source: { type: ['string', 'null'] },
                        taskName: { type: ['string', 'null'] },
                        command: { type: ['string', 'null'] },
                        startedAt: { type: ['string', 'null'], format: 'date-time' }
                      },
                      additionalProperties: false
                    },
                    { type: 'null' }
                  ]
                }
              },
              additionalProperties: false
            },
            task: {
              type: 'object',
              required: ['isRunning', 'taskName', 'taskType', 'stopRequested'],
              properties: {
                isRunning: { type: 'boolean' },
                taskName: { type: ['string', 'null'] },
                taskType: { type: ['string', 'null'] },
                stopRequested: { type: 'boolean' }
              },
              additionalProperties: false
            },
            schedule: { $ref: '#/components/schemas/ScheduleExecutionSnapshot' }
          },
          additionalProperties: false
        },
        RunSnapshot: {
          type: 'object',
          required: ['isRunning', 'schedule', 'recentLogs', 'run', 'activeRuns', 'lastRun', 'occupancy'],
          properties: {
            isRunning: {
              type: 'boolean',
              description: 'Legacy task-process projection. False while a flow waits between steps.'
            },
            taskName: { type: ['string', 'null'] },
            startTime: { type: ['integer', 'null'] },
            taskType: { type: ['string', 'null'] },
            stopRequested: { type: 'boolean' },
            logs: { type: 'array', items: {} },
            schedule: { $ref: '#/components/schemas/ScheduleExecutionSnapshot' },
            recentLogs: { type: 'array', items: {} },
            run: {
              oneOf: [
                { $ref: '#/components/schemas/Run' },
                { type: 'null' }
              ],
              description: 'Current active run, ordered stopping > running > accepted > waiting and newest first.'
            },
            activeRuns: {
              type: 'array',
              items: { $ref: '#/components/schemas/Run' },
              description: 'Every active run. More than one entry means additional accepted intents exist.'
            },
            lastRun: {
              oneOf: [
                { $ref: '#/components/schemas/Run' },
                { type: 'null' }
              ],
              description: 'Most recent terminal run by completion time. It is not identity-safe for a specific caller.'
            },
            occupancy: { $ref: '#/components/schemas/RunOccupancy' }
          },
          additionalProperties: true
        },
        RunSnapshotResponse: {
          allOf: [
            { $ref: '#/components/schemas/SuccessResponse' },
            {
              type: 'object',
              properties: {
                data: { $ref: '#/components/schemas/RunSnapshot' }
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
