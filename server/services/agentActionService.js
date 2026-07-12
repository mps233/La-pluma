import { agentError } from '../utils/apiHelper.js';

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
  'depot',
  'operbox',
  'activity',
  'run',
  'list'
]);

const AGENT_TASK_COMMAND_SET = new Set(AGENT_TASK_COMMANDS);
const AGENT_QUERY_COMMANDS = new Set(['activity', 'list']);
const SAFE_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function invalidRequest(code, message, details) {
  return agentError(code, message, {
    statusCode: 400,
    details,
    retryable: false
  });
}

function normalizeTaskConfig(taskConfig) {
  let normalized = taskConfig;

  if (typeof taskConfig === 'string') {
    try {
      normalized = JSON.parse(taskConfig);
    } catch (error) {
      throw invalidRequest(
        'AGENT_VALIDATION_TASK_CONFIG_INVALID',
        'taskConfig 必须是有效的 JSON 对象',
        { reason: 'invalid_json', parseError: error.message }
      );
    }
  }

  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw invalidRequest(
      'AGENT_VALIDATION_TASK_CONFIG_INVALID',
      'taskConfig 必须是非数组对象',
      {
        reason: 'object_required',
        receivedType: Array.isArray(normalized) ? 'array' : normalized === null ? 'null' : typeof normalized
      }
    );
  }

  if (typeof normalized.name !== 'string' || !normalized.name.trim()
    || typeof normalized.type !== 'string' || !normalized.type.trim()) {
    throw invalidRequest(
      'AGENT_VALIDATION_TASK_CONFIG_INVALID',
      'taskConfig.name 和 taskConfig.type 必须是非空字符串',
      { reason: 'name_and_type_required' }
    );
  }

  if (normalized.params !== undefined
    && (!normalized.params || typeof normalized.params !== 'object' || Array.isArray(normalized.params))) {
    throw invalidRequest(
      'AGENT_VALIDATION_TASK_CONFIG_INVALID',
      'taskConfig.params 必须是对象',
      { reason: 'params_object_required' }
    );
  }

  return {
    ...normalized,
    name: normalized.name.trim(),
    type: normalized.type.trim(),
    params: normalized.params || {}
  };
}

function normalizeOptionalLabel(value, field, fallback, maxLength) {
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

export function normalizeDailyFlowRequest(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
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
export async function executeAgentTask(input = {}, dependencies = {}) {
  const {
    command,
    args = [],
    taskConfig,
    taskName,
    taskType,
    waitForCompletion = true,
    userResource = false
  } = input || {};

  if (!AGENT_TASK_COMMAND_SET.has(command)) {
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
    );
  }

  if (typeof dependencies.execMaaCommand !== 'function') {
    throw new TypeError('executeAgentTask requires execMaaCommand');
  }

  if (AGENT_QUERY_COMMANDS.has(command)) {
    return dependencies.execMaaCommand(command, normalizedArgs, null, null, true);
  }

  return dependencies.execMaaCommand(
    command,
    normalizedArgs,
    normalizedTaskName,
    normalizedTaskType,
    waitForCompletion
  );
}

export function createDailyFlowExecutionError(result) {
  if (result?.success !== false) return null;

  const message = result.message || '今日流程未能开始执行';
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
