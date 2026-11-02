import { getErrorMessage, isRecord } from '../utils/errors.ts';
import { agentError } from '../utils/apiHelper.ts';

export const AGENT_TASK_COMMANDS = Object.freeze([
  'startup',
  'closedown',
  'fight',
  'infrast',
  'recruit',
  'mall',
  'award',
  'copilot',
  'ssscopilot',
  'paradoxcopilot',
  'roguelike',
  'reclamation',
  'depot',
  'operbox',
  'activity',
  'run',
  'list'
]);

export const MAA_TASK_TYPES = Object.freeze([
  'StartUp',
  'CloseDown',
  'Fight',
  'Recruit',
  'Infrast',
  'Mall',
  'Award',
  'Roguelike',
  'Copilot',
  'SSSCopilot',
  'ParadoxCopilot',
  'Depot',
  'OperBox',
  'Reclamation',
  'Custom',
  'SingleStep',
  'VideoRecognition'
]);

const AGENT_TASK_COMMAND_SET = new Set(AGENT_TASK_COMMANDS);
const MAA_TASK_TYPE_SET = new Set(MAA_TASK_TYPES);
const AGENT_QUERY_COMMANDS = new Set(['activity', 'list']);
const SAFE_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

interface AgentTaskConfig {
  name: string;
  type: string;
  params: Record<string, unknown>;
  tasks?: AgentTaskConfig[];
  [key: string]: unknown;
}

interface AgentTaskDependencies {
  execDynamicTask?: (
    taskId: string,
    taskConfig: AgentTaskConfig,
    taskName: string,
    taskType: string,
    waitForCompletion: boolean,
    userResource: boolean
  ) => unknown;
  execMaaCommand?: (
    command: string,
    args: string[],
    taskName: string | null,
    taskType: string | null,
    waitForCompletion: boolean
  ) => unknown;
}

interface DailyFlowRequest {
  dryRun: boolean;
  scheduleId: string;
  taskFlow: unknown[] | null;
}

function invalidRequest(code: string, message: string, details: unknown) {
  return agentError(code, message, {
    statusCode: 400,
    details,
    retryable: false
  });
}

export function validateTaskConfig(taskConfig: unknown): AgentTaskConfig {
  return normalizeTaskConfig(taskConfig);
}

function normalizeSingleTaskConfig(taskConfig: unknown, label = 'taskConfig'): AgentTaskConfig {
  if (!isRecord(taskConfig)
    || typeof taskConfig.name !== 'string' || !taskConfig.name.trim()
    || typeof taskConfig.type !== 'string' || !taskConfig.type.trim()) {
    throw invalidRequest(
      'AGENT_VALIDATION_TASK_CONFIG_INVALID',
      `${label}.name 和 ${label}.type 必须是非空字符串`,
      { reason: 'name_and_type_required' }
    );
  }

  const normalizedType = taskConfig.type.trim();
  if (!MAA_TASK_TYPE_SET.has(normalizedType)) {
    throw invalidRequest(
      'AGENT_VALIDATION_TASK_TYPE_NOT_SUPPORTED',
      `不支持的 MaaCore 任务类型: ${normalizedType}`,
      { type: normalizedType, allowed: [...MAA_TASK_TYPES] }
    );
  }

  if (taskConfig.params !== undefined
    && (!taskConfig.params || typeof taskConfig.params !== 'object' || Array.isArray(taskConfig.params))) {
    throw invalidRequest(
      'AGENT_VALIDATION_TASK_CONFIG_INVALID',
      `${label}.params 必须是对象`,
      { reason: 'params_object_required' }
    );
  }

  return {
    ...taskConfig,
    name: taskConfig.name.trim(),
    type: normalizedType,
    params: isRecord(taskConfig.params) ? taskConfig.params : {}
  };
}

function normalizeTaskConfig(taskConfig: unknown): AgentTaskConfig {
  let normalized: unknown = taskConfig;

  if (typeof taskConfig === 'string') {
    try {
      normalized = JSON.parse(taskConfig) as unknown;
    } catch (error) {
      throw invalidRequest(
        'AGENT_VALIDATION_TASK_CONFIG_INVALID',
        'taskConfig 必须是有效的 JSON 对象',
        { reason: 'invalid_json', parseError: getErrorMessage(error) }
      );
    }
  }

  if (!isRecord(normalized)) {
    throw invalidRequest(
      'AGENT_VALIDATION_TASK_CONFIG_INVALID',
      'taskConfig 必须是非数组对象',
      {
        reason: 'object_required',
        receivedType: Array.isArray(normalized) ? 'array' : normalized === null ? 'null' : typeof normalized
      }
    );
  }

  const normalizedTopLevel = normalizeSingleTaskConfig(normalized, 'taskConfig');

  if (normalized.tasks === undefined) return normalizedTopLevel;

  if (!Array.isArray(normalized.tasks) || normalized.tasks.length === 0) {
    throw invalidRequest(
      'AGENT_VALIDATION_TASK_CONFIG_INVALID',
      'taskConfig.tasks 必须是非空数组',
      { reason: 'tasks_array_required' }
    );
  }

  return {
    ...normalizedTopLevel,
    tasks: normalized.tasks.map((task, index) => {
      if (!isRecord(task)) {
        throw invalidRequest(
          'AGENT_VALIDATION_TASK_CONFIG_INVALID',
          `taskConfig.tasks[${index}] 必须是对象`,
          { reason: 'task_object_required', index }
        );
      }
      return normalizeSingleTaskConfig(task, `taskConfig.tasks[${index}]`);
    })
  };
}

function normalizeOptionalLabel(value: unknown, field: string, fallback: string, maxLength: number): string {
  const errorField = field.replace(/[A-Z]/g, character => `_${character}`).toUpperCase();
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') {
    throw invalidRequest(
      `AGENT_VALIDATION_${errorField}_INVALID`,
      `${field} 必须是字符串`,
      { receivedType: Array.isArray(value) ? 'array' : typeof value }
    );
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw invalidRequest(
      `AGENT_VALIDATION_${errorField}_INVALID`,
      `${field} 长度不能超过 ${maxLength} 个字符`,
      { maxLength, actualLength: normalized.length }
    );
  }
  return normalized || fallback;
}

export function normalizeDailyFlowRequest(input: unknown = {}): DailyFlowRequest {
  if (!isRecord(input)) {
    throw invalidRequest('AGENT_VALIDATION_DAILY_FLOW_INPUT_INVALID', '请求体必须是对象', {
      receivedType: Array.isArray(input) ? 'array' : input === null ? 'null' : typeof input
    });
  }

  const dryRun = input.dryRun ?? false;
  if (typeof dryRun !== 'boolean') {
    throw invalidRequest('AGENT_VALIDATION_DRY_RUN_INVALID', 'dryRun 必须是布尔值', {
      receivedType: typeof dryRun
    });
  }

  const scheduleId = normalizeOptionalLabel(input.scheduleId, 'scheduleId', 'agent-daily-flow', 128);
  const taskFlow = input.taskFlow ?? null;
  if (taskFlow !== null && !Array.isArray(taskFlow)) {
    throw invalidRequest('AGENT_VALIDATION_TASK_FLOW_INVALID', 'taskFlow 必须是数组', {
      receivedType: typeof taskFlow
    });
  }

  return { dryRun, scheduleId, taskFlow };
}

/**
 * Execute a command exposed through the Agent API after validating its
 * filesystem-sensitive dynamic-task inputs.
 */
export async function executeAgentTask(
  input: unknown = {},
  dependencies: AgentTaskDependencies = {}
): Promise<Record<string, unknown>> {
  const record = isRecord(input) ? input : {};
  const {
    command,
    args = [],
    taskConfig,
    taskName,
    taskType,
    waitForCompletion = true,
    userResource = false
  } = record;

  if (typeof command !== 'string' || !AGENT_TASK_COMMAND_SET.has(command)) {
    throw invalidRequest(
      'AGENT_VALIDATION_COMMAND_NOT_ALLOWED',
      `不允许的 command: ${command}`,
      { command, allowed: [...AGENT_TASK_COMMANDS] }
    );
  }

  if (!Array.isArray(args)) {
    throw invalidRequest(
      'AGENT_VALIDATION_ARGS_INVALID',
      'args 必须是数组',
      { receivedType: args === null ? 'null' : typeof args }
    );
  }

  if (typeof waitForCompletion !== 'boolean') {
    throw invalidRequest(
      'AGENT_VALIDATION_WAIT_FOR_COMPLETION_INVALID',
      'waitForCompletion 必须是布尔值',
      { receivedType: typeof waitForCompletion }
    );
  }

  if (typeof userResource !== 'boolean') {
    throw invalidRequest(
      'AGENT_VALIDATION_USER_RESOURCE_INVALID',
      'userResource 必须是布尔值',
      { receivedType: typeof userResource }
    );
  }

  const normalizedArgs = args.map(String);
  const normalizedTaskName = normalizeOptionalLabel(taskName, 'taskName', `Agent: ${command}`, 160);
  const normalizedTaskType = normalizeOptionalLabel(taskType, 'taskType', 'agent', 64);
  const hasTaskConfig = taskConfig !== undefined && taskConfig !== null;

  if (hasTaskConfig) {
    const normalizedTaskConfig = normalizeTaskConfig(taskConfig);
    const requestedTaskId = normalizedArgs[0]?.trim();
    const taskId = requestedTaskId || command;

    if (!SAFE_TASK_ID_PATTERN.test(taskId)) {
      throw invalidRequest(
        'AGENT_VALIDATION_TASK_ID_INVALID',
        '动态任务 ID 只能包含字母、数字、下划线和连字符',
        { taskId, pattern: SAFE_TASK_ID_PATTERN.source }
      );
    }

    if (typeof dependencies.execDynamicTask !== 'function') {
      throw new TypeError('executeAgentTask requires execDynamicTask');
    }

    return dependencies.execDynamicTask(
      taskId,
      normalizedTaskConfig,
      normalizedTaskName,
      normalizedTaskType,
      waitForCompletion,
      userResource
    ) as Record<string, unknown>;
  }

  if (typeof dependencies.execMaaCommand !== 'function') {
    throw new TypeError('executeAgentTask requires execMaaCommand');
  }

  if (AGENT_QUERY_COMMANDS.has(command)) {
    return dependencies.execMaaCommand(command, normalizedArgs, null, null, true) as Record<string, unknown>;
  }

  return dependencies.execMaaCommand(
    command,
    normalizedArgs,
    normalizedTaskName,
    normalizedTaskType,
    waitForCompletion
  ) as Record<string, unknown>;
}

export function createDailyFlowExecutionError(result: unknown) {
  if (!isRecord(result) || result.success !== false) return null;

  const message = typeof result.message === 'string' && result.message ? result.message : '今日流程未能开始执行';
  const isBusy = result.busy === true || message.includes('已有任务');

  if (isBusy) {
    return agentError('AGENT_EXECUTION_BUSY', message, {
      statusCode: 409,
      details: { owner: result.owner ?? null },
      retryable: true
    });
  }

  return agentError('AGENT_DAILY_FLOW_REJECTED', message, {
    statusCode: 400,
    details: { result },
    retryable: false
  });
}
