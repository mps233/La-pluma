import { asErrorWithCode, getErrorCode, getErrorMessage, isRecord } from '../utils/errors.ts';
import cron from 'node-cron';
import { execMaaCommand, execDynamicTask, replaceActivityCode, captureScreen, getGameClientState, getMaaExecutionDiagnostics, testAdbConnection, createMaaLogCheckpoint, readMaaLogSince, canUseMaaSelfUpdate } from './maaService.ts';
import { resolveConnection } from './connectionService.ts';
import { gameTimeZoneForClientType } from './gameCalendar.ts';
import { isResourceCollectionOpenNow } from './activityDataService.ts';
import { sendTaskCompletionNotification, isStageOpenToday, shouldCaptureNotificationScreenshot } from './notificationService.ts';
import { getEnabledAwardItems, parseAwardExecutionActions } from './awardResultService.ts';
import { parseRecruitExecutionAction } from './recruitResultService.ts';
import { parseInfrastExecutionAction } from './infrastResultService.ts';
import { parseMallExecutionAction } from './mallResultService.ts';
import { createFightExecutionAction, isFightSanityDepleted } from './fightResultService.ts';
import { summarizeFightCallbacks } from './maaCallbackService.ts';
import { loadUserConfig, saveUserConfig } from './configStorageService.ts';
import operatorTrainingService from './operatorTrainingService.ts';
import { recordDrops } from './dropRecordService.ts';
import { createLogger } from '../utils/logger.ts';
import { exec } from 'child_process';
import { promisify } from 'util';
import { withMaaExecutionLease } from './executionCoordinatorService.ts';
import {
  beginAgentRun,
  startAgentRun,
  completeAgentRun,
  failAgentRun,
  updateAgentRunProgress,
  flushAgentRunStore
} from './agentRunService.ts';
import { agentError } from '../utils/apiHelper.ts';
import { DEFAULT_CLIENT_TYPE, DEFAULT_MAA_CLI_PATH } from '../config/connectionDefaults.ts';

const execAsync = promisify(exec);

// 创建日志记录器
const logger = createLogger('Scheduler');
const commaSeparatedArrayKeys = new Set(['buy_first', 'blacklist', 'first_tags', 'preserve_tags', 'fiammetta_targets']);

// MAA CLI 路径
const MAA_CLI_PATH = DEFAULT_MAA_CLI_PATH;

type MaaCommandResult = {
  stdout?: string;
  stderr?: string;
};

type MaaLogCheckpoint = Awaited<ReturnType<typeof createMaaLogCheckpoint>>;

interface FightDropItem {
  name: string;
  count: number;
}

interface FightCallbackSummary {
  stage: string | null;
  items: FightDropItem[];
  sanityUsed: number;
}

type RecruitSummary = {
  stars: number | string;
  tags: string[] | string;
  state?: string | null;
};

type TaskSummary = {
  task?: string;
  stage?: string;
  times?: string;
  drops?: string;
  dropItems?: FightDropItem[];
  medicine?: string;
  stone?: string;
  duration?: string;
  recruits?: RecruitSummary[];
  recruitCount?: number;
  refreshCount?: number;
  infrast?: string;
  sanity?: number;
};

type TaskActionResultStatus = 'success' | 'failed' | 'skipped';

type TaskActionResult = {
  task?: string;
  action: string;
  status: TaskActionResultStatus;
  message: string;
};

type FightReportResult = {
  provider: string;
  stage: string;
  status: 'failed' | 'success';
  message: string;
};

interface TaskErrorEntry {
  task?: string;
  error: unknown;
}

interface TaskSkipEntry {
  task?: string;
  reason: string;
}

interface ScheduleTaskResult {
  id: string;
  name?: string;
  state: string;
  startedAt: string;
  finishedAt?: string;
}

interface TaskCounts {
  success: number;
  failed: number;
  skipped: number;
}

interface ScheduleExecutionSummary {
  successCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
  summaries: TaskSummary[];
  reports: FightReportResult[];
  actions: TaskActionResult[];
  taskResults: ScheduleTaskResult[];
  errors: TaskErrorEntry[];
  warnings: string[];
}

interface FightStageConfig {
  stage?: unknown;
  times?: unknown;
}

interface NormalizedFightStage {
  stage: string;
  times: string;
}

interface MaaTaskConfig {
  name?: string;
  type?: string;
  client_type: string;
  condition?: unknown;
  variants?: unknown;
  params: Record<string, unknown>;
}

interface DynamicFightTaskItem {
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

interface DynamicFightTaskDocument {
  tasks?: DynamicFightTaskItem[];
  [key: string]: unknown;
}

interface ScheduledCommandSpec {
  command: string;
  params: string;
  taskConfig?: string;
}

interface SchedulePlanStep {
  index: number;
  id: string;
  name: string;
  command: string;
  args: string[];
  dynamicTask: boolean;
  taskConfig?: unknown;
  preActions?: Array<{ action: string }>;
}

interface ScheduledJobEntry {
  time: string;
  job: ReturnType<typeof cron.schedule>;
}

interface SmartTrainingPlanStage {
  stage?: unknown;
  isOpen?: unknown;
  totalTimes?: unknown;
  times?: unknown;
}

interface SmartTrainingOperator {
  name?: unknown;
}

interface TrainingPlan {
  stages?: SmartTrainingPlanStage[];
  openStages?: SmartTrainingPlanStage[];
  operators?: SmartTrainingOperator[];
}

interface SmartTrainingStage {
  stage: string;
  times: string;
  smart: boolean;
  trainingOperators: string[];
}

interface TrainingQueueOperator {
  name?: string;
  operatorId?: string;
}

interface ScheduleStateEntry {
  scheduleId: string;
  times: string[];
  count: number;
}

// 存储所有定时任务
const scheduledJobs = new Map<string, ScheduledJobEntry[]>();

function isFightStageConfig(value: unknown): value is FightStageConfig {
  return isRecord(value);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function parseDropTargetEntries(value: unknown): string[] | null {
  if (value === undefined || value === null || value === '') return [];

  const rawEntries = isRecord(value)
    ? Object.entries(value).map(([itemId, count]) => `${itemId}=${String(count)}`)
    : String(value).split(',').map(entry => entry.trim()).filter(Boolean);

  const normalizedEntries: string[] = [];
  for (const entry of rawEntries) {
    const match = entry.match(/^([A-Za-z0-9_-]+)\s*=\s*(\d+)$/);
    if (!match || Number(match[2]) <= 0) return null;
    normalizedEntries.push(`${match[1]}=${Number(match[2])}`);
  }
  return normalizedEntries;
}

function normalizeFightStageEntries(task: ScheduledTask): NormalizedFightStage[] {
  const configuredStages = task.params.stages;
  const stages: unknown[] = Array.isArray(configuredStages)
    ? configuredStages
    : [{ stage: task.params.stage || '', times: task.params.times || '' }];
  return stages
    .map((stageConfig): FightStageConfig => typeof stageConfig === 'string'
      ? { stage: stageConfig, times: '' }
      : isFightStageConfig(stageConfig) ? stageConfig : {})
    .filter((stageConfig): stageConfig is FightStageConfig & { stage: string } =>
      typeof stageConfig.stage === 'string' && Boolean(stageConfig.stage.trim()))
    .map(stageConfig => ({
      stage: stageConfig.stage.trim(),
      times: stageConfig.times === undefined || stageConfig.times === '' ? '' : String(stageConfig.times).trim()
    }));
}

function buildDynamicFightTaskConfig(task: ScheduledTask, connectionDefaults: ConnectionDefaults = {}): string | null {
  const commandId = task.commandId || String(task.id || '').split('-')[0];
  if (commandId !== 'fight' || task.taskType) return null;
  const params = task.params || {};
  const medicineExpireDays = Number(params.medicineExpireDays ?? params.medicine_expire_days ?? 0);
  const server = String(params.server || '').trim();
  const series = Number(params.series ?? 1);
  if (!(medicineExpireDays > 0) && !server && !(Number.isFinite(series) && series > 6)) return null;

  const stages = normalizeFightStageEntries(task);
  if (stages.length === 0) return null;

  const dropEntries = parseDropTargetEntries(params.drops);
  if (dropEntries === null) {
    throw new Error('掉落目标格式应为物品 ID=数量，多个目标用逗号分隔');
  }
  const drops = dropEntries.length > 0
    ? Object.fromEntries(dropEntries.map(entry => {
      const [itemId, count] = entry.split('=');
      return [itemId, Number(count)];
    }))
    : null;

  const clientType = params.clientType || params.client_type || connectionDefaults.clientType || DEFAULT_CLIENT_TYPE;
  const commonParams: Record<string, unknown> = {};
  if (params.medicine !== undefined && params.medicine !== '' && params.medicine !== null) {
    commonParams.medicine = Number(params.medicine);
  }
  if (params.expiringMedicine !== undefined && params.expiringMedicine !== '' && params.expiringMedicine !== null && !(medicineExpireDays > 0)) {
    commonParams.expiring_medicine = Number(params.expiringMedicine);
  }
  if (medicineExpireDays > 0) commonParams.medicine_expire_days = medicineExpireDays;
  if (params.stone !== undefined && params.stone !== '' && params.stone !== null) {
    commonParams.stone = Number(params.stone);
  }
  if (params.series !== undefined && params.series !== '' && params.series !== null) {
    commonParams.series = Number(params.series);
  }
  if (drops) commonParams.drops = drops;
  if (server) commonParams.server = server;
  if (typeof params.DrGrandet === 'boolean') commonParams.DrGrandet = params.DrGrandet;
  if (typeof params.report_to_penguin === 'boolean') commonParams.report_to_penguin = params.report_to_penguin;
  if (typeof params.penguin_id === 'string' && params.penguin_id.trim()) commonParams.penguin_id = params.penguin_id.trim();
  if (typeof params.report_to_yituliu === 'boolean') commonParams.report_to_yituliu = params.report_to_yituliu;
  if (typeof params.yituliu_id === 'string' && params.yituliu_id.trim()) commonParams.yituliu_id = params.yituliu_id.trim();

  const tasks = stages.map(({ stage, times }) => ({
    name: `${task.name || '理智作战'} (${stage})`,
    type: 'Fight',
    params: {
      ...commonParams,
      stage,
      ...(times ? { times: Number(times) } : {})
    }
  }));

  return JSON.stringify({
    name: task.name || '理智作战',
    type: 'Fight',
    client_type: clientType,
    tasks
  });
}

function getFightReportResults(task: ScheduledTask, stage: string, result: MaaCommandResult) {
  const stderr = String(result?.stderr || '');
  const diagnostics = getMaaExecutionDiagnostics(stderr);
  const completedFight = /Fight\s+\S+\s+[1-9]\d*\s+times?/i.test(String(result?.stdout || ''));
  if (!completedFight && diagnostics.length === 0) {
    return { reportResults: [], diagnostics };
  }
  const hasUnknownDrops = diagnostics.some(diagnostic => diagnostic.code === 'UNKNOWN_DROPS');
  const reportResults: FightReportResult[] = [];

  const addReport = (provider: string, enabled: unknown, failurePattern: RegExp, successMessage: string, failureMessage: string) => {
    if (!enabled) return;
    const failed = hasUnknownDrops || failurePattern.test(stderr);
    reportResults.push({
      provider,
      stage,
      status: failed ? 'failed' : 'success',
      message: failed
        ? (hasUnknownDrops ? '存在未识别掉落，未发送汇报' : failureMessage)
        : successMessage
    });
  };

  addReport(
    'penguin',
    task.params?.report_to_penguin,
    /FailedToReportToPenguinStats/i,
    '已汇报至企鹅物流',
    '企鹅物流汇报失败'
  );
  addReport(
    'yituliu',
    task.params?.report_to_yituliu,
    /FailedToReportToYituliu/i,
    '已汇报至一图流',
    '一图流汇报失败'
  );

  return { reportResults, diagnostics };
}

async function recordFightDrops(summary: TaskSummary | null | undefined, scheduleId: string) {
  if (!summary?.stage) return;

  try {
    const times = Math.max(1, Number(summary.times) || 1);
    await recordDrops({
      stage: summary.stage,
      times,
      items: Array.isArray(summary.dropItems) ? summary.dropItems : [],
      sanity: Math.max(0, Number(summary.sanity) || 0),
      medicine: Math.max(0, Number(summary.medicine) || 0),
      stone: Math.max(0, Number(summary.stone) || 0)
    });
    logger.debug('掉落记录已保存', { scheduleId, stage: summary.stage, drops: summary.dropItems?.length || 0 });
  } catch (error) {
    logger.error('掉落记录保存失败', { scheduleId, error: getErrorMessage(error) });
  }
}

function attachFightCallbacks(summary: TaskSummary, checkpoint: MaaLogCheckpoint | null, taskName: string): Promise<TaskSummary>;
function attachFightCallbacks(summary: TaskSummary | null, checkpoint: MaaLogCheckpoint | null, taskName: string): Promise<TaskSummary | null>;
async function attachFightCallbacks(summary: TaskSummary | null, checkpoint: MaaLogCheckpoint | null, taskName: string): Promise<TaskSummary | null> {
  if (!checkpoint) return summary;

  let callbackSummary: FightCallbackSummary;
  try {
    callbackSummary = summarizeFightCallbacks(await readMaaLogSince(checkpoint));
  } catch (error) {
    logger.warn('读取战斗回调失败', { taskName, error: getErrorMessage(error) });
    return summary;
  }

  const merged = summary || { task: taskName };
  if (callbackSummary.stage) merged.stage = merged.stage || callbackSummary.stage;
  if (callbackSummary.items.length > 0) {
    merged.dropItems = callbackSummary.items;
    merged.drops = callbackSummary.items.map(item => `${item.name} × ${item.count}`).join(', ');
  }
  if (callbackSummary.sanityUsed > 0) merged.sanity = callbackSummary.sanityUsed;
  return merged;
}

// 定时任务执行状态

interface ScheduleExecutionStatus {
  isRunning: boolean;
  scheduleId: string | null;
  currentStep: number;
  totalSteps: number;
  currentTask: string | null;
  currentTaskId?: string | null;
  message: string;
  startTime: number | null;
  shouldStop: boolean;
  lastResult: unknown;
}

interface ScheduledTask {
  id: string;
  commandId?: string;
  name?: string;
  enabled?: boolean;
  taskType?: string;
  condition?: unknown;
  variants?: unknown;
  params: Record<string, unknown>;
}

type ScheduledTaskFlow = ScheduledTask[];

interface ConnectionDefaults {
  adbPath?: string;
  address?: string;
  clientType?: string;
}

interface ResolvedConnection {
  adbPath: string;
  address: string;
  clientType: string;
}

interface ScheduleLifecycle {
  runId?: string;
  onStarted?: () => unknown;
  onProgress?: (progress: Record<string, unknown>, taskResults?: unknown[] | null) => unknown;
}

interface ScheduleValidationFailure {
  success: false;
  message: string;
  details?: Record<string, unknown>;
}

interface ScheduleValidationSuccess {
  success: true;
}

type ScheduleValidationResult = ScheduleValidationFailure | ScheduleValidationSuccess;

interface SchedulePlanResult {
  success: boolean;
  message?: string;
  totalSteps?: number;
  steps?: SchedulePlanStep[];
  details?: Record<string, unknown>;
}

interface ScheduleExecutionResult {
  success: boolean;
  message: string;
  stopped?: boolean;
  busy?: boolean;
  owner?: unknown;
  summary?: unknown;
  runId?: string;
}

const scheduleExecutionStatus: ScheduleExecutionStatus = {
  isRunning: false,
  scheduleId: null,
  currentStep: -1,
  totalSteps: 0,
  currentTask: null,
  message: '',
  startTime: null,
  shouldStop: false,  // 添加停止标志
  lastResult: null
};

let cancelActiveScheduleDelay: (() => void) | null = null;
let activeScheduleAbortController: AbortController | null = null;
let activeScheduleRunId: symbol | null = null;

function waitForScheduleDelay(delayMs: number): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const signal = activeScheduleAbortController?.signal;

    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      signal?.removeEventListener('abort', cancel);
      if (cancelActiveScheduleDelay === cancel) cancelActiveScheduleDelay = null;
      resolve(completed);
    };

    const cancel = () => finish(false);
    cancelActiveScheduleDelay = cancel;
    timeoutId = setTimeout(() => finish(true), delayMs);
    signal?.addEventListener('abort', cancel, { once: true });

    if (scheduleExecutionStatus.shouldStop) cancel();
  });
}

/**
 * 获取定时任务执行状态
 */
export function getScheduleExecutionStatus() {
  return { ...scheduleExecutionStatus };
}

/**
 * 停止当前正在执行的任务流程
 */
export function stopScheduleExecution() {
  if (scheduleExecutionStatus.isRunning) {
    logger.warn('设置停止标志，正在终止任务流程');
    updateScheduleStatus({
      shouldStop: true,
      message: '正在终止任务流程'
    });
    activeScheduleAbortController?.abort(new Error('任务流程已被用户终止'));
    cancelActiveScheduleDelay?.();
    return true;
  }
  return false;
}

function isScheduleStopRequested(error: unknown = null): boolean {
  const stopRequested = scheduleExecutionStatus.shouldStop
    || Boolean(activeScheduleAbortController?.signal.aborted)
    || Boolean(asErrorWithCode(error).stopRequested);
  if (stopRequested && !scheduleExecutionStatus.shouldStop) {
    updateScheduleStatus({
      shouldStop: true,
      message: '正在终止任务流程'
    });
  }
  return stopRequested;
}

/**
 * 更新定时任务执行状态
 */
function updateScheduleStatus(updates: Partial<ScheduleExecutionStatus>) {
  Object.assign(scheduleExecutionStatus, updates);
  logger.debug('定时任务状态更新', scheduleExecutionStatus);
}

// 构建 MAA 命令
function buildScheduledTaskCommand(task: ScheduledTask, connectionDefaults: ConnectionDefaults = {}): ScheduledCommandSpec {
  if (task.taskType) {
    // MaaCore 内置任务类型
    const params: Record<string, unknown> = { ...(task.params || {}) };
    const clientType = firstNonEmptyString(params.clientType, params.client_type, connectionDefaults.clientType)
      || DEFAULT_CLIENT_TYPE;
    delete params.clientType;
    delete params.client_type;
    if (task.taskType === 'Recruit') {
      if (params.preserve_tags === undefined && params.skip_robot === true) {
        params.preserve_tags = ['支援机械'];
      }
      if (params.recruitment_time && typeof params.recruitment_time === 'object') {
        params.recruitment_time = Object.fromEntries(
          Object.entries(params.recruitment_time).map(([level, minutes]) => [level, Number(minutes)])
        );
      }
      delete params.skip_robot;
    }
    if (task.taskType === 'Infrast' && Number(params.mode) === 10000 && !String(params.filename || '').trim()) {
      throw new Error('自定义换班需要填写排班文件路径');
    }
    if (task.taskType === 'Infrast' && Number(params.mode) === 10000 && params.plan_index === undefined) {
      params.plan_index = 0;
    }
    const taskConfig: MaaTaskConfig = {
      name: task.name,
      type: task.taskType,
      client_type: clientType,
      ...(task.condition ? { condition: task.condition } : {}),
      ...(Array.isArray(task.variants) ? { variants: task.variants } : {}),
      params: {}
    };

    Object.keys(params).forEach(key => {
      const value = params[key];
      if (value === undefined || value === '' || value === null) return;

      if (key === 'calculationOnly') {
        if (value === true && task.taskType === 'Recruit') {
          taskConfig.params.times = 0;
          taskConfig.params.confirm = [];
          taskConfig.params.set_time = false;
        }
        return;
      }

      if (typeof value === 'boolean') {
        taskConfig.params[key] = value;
      } else if (Array.isArray(value)) {
        if (value.length > 0) {
          taskConfig.params[key] = value;
        }
      } else if (typeof value === 'string' && value.trim().startsWith('[') && value.trim().endsWith(']')) {
        taskConfig.params[key] = value.trim();
      } else if (typeof value === 'string' && (commaSeparatedArrayKeys.has(key) || (value.includes(',') && !value.includes('[')))) {
        taskConfig.params[key] = value.split(',').map(v => v.trim()).filter(v => v);
      } else if (typeof value === 'number') {
        taskConfig.params[key] = value;
      } else if (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '') {
        taskConfig.params[key] = Number(value);
      } else if (value) {
        taskConfig.params[key] = value;
      }
    });

    return {
      command: 'run',
      params: task.commandId || task.id,
      taskConfig: JSON.stringify(taskConfig)
    };
  }

  const startupCommandId = task.commandId || String(task.id || '').split('-')[0];
  if (startupCommandId === 'startup' && task.params?.startGameEnabled === false) {
    const clientType = firstNonEmptyString(task.params?.clientType, connectionDefaults.clientType)
      || DEFAULT_CLIENT_TYPE;
    const params: Record<string, unknown> = { start_game_enabled: false };
    const accountName = typeof task.params?.accountName === 'string' ? task.params.accountName.trim() : '';
    if (accountName) params.account_name = accountName;
    return {
      command: 'run',
      params: 'startup',
      taskConfig: JSON.stringify({
        name: task.name || '启动游戏',
        type: 'StartUp',
        client_type: clientType,
        params
      })
    };
  }

  const dynamicFightConfig = buildDynamicFightTaskConfig(task, connectionDefaults);
  if (dynamicFightConfig) {
    return {
      command: 'run',
      params: task.commandId || task.id,
      taskConfig: dynamicFightConfig
    };
  }

  // 预定义命令
  const commandId = task.commandId || task.id.split('-')[0];
  let params = '';
  const extraArgs: string[] = [];

  if (commandId === 'startup' || commandId === 'closedown') {
    params = firstNonEmptyString(task.params.clientType) || DEFAULT_CLIENT_TYPE;
    const address = connectionDefaults.address;
    if (address) {
      extraArgs.push(`-a ${address}`);
    }
    // 添加账号切换参数
    if (commandId === 'startup' && task.params.accountName) {
      extraArgs.push(`--account-name ${task.params.accountName}`);
    }
  } else if (commandId === 'fight') {
    // 支持多个关卡（stages 数组，每个元素是 {stage, times}）或单个关卡（stage 字符串）
    const configuredStages = task.params.stages;
    const stages: unknown[] = Array.isArray(configuredStages)
      ? configuredStages
      : [{ stage: task.params.stage || '', times: task.params.times || '' }];

    // 标准化格式：将所有元素转换为 {stage, times} 对象
    const normalizedStages = stages.map((stageConfig): FightStageConfig => {
      if (typeof stageConfig === 'string') {
        // 字符串格式，转换为对象
        return { stage: stageConfig, times: '' };
      } else if (isRecord(stageConfig) && stageConfig.stage) {
        // 已经是对象格式
        return stageConfig;
      } else {
        // 无效格式，返回空对象
        return { stage: '', times: '' };
      }
    });

    // 构建关卡列表，格式：stage1:times1,stage2:times2
    const stageList = normalizedStages
      .filter((stageConfig): stageConfig is FightStageConfig & { stage: string } =>
        typeof stageConfig.stage === 'string' && Boolean(stageConfig.stage.trim()))
      .map(stageConfig => {
        const stage = stageConfig.stage.trim();
        const times = stageConfig.times ? `:${stageConfig.times}` : '';
        return `${stage}${times}`;
      })
      .join(',');

    params = stageList;

    if (task.params.medicine !== undefined && task.params.medicine !== '' && task.params.medicine !== null) {
      params += ` -m ${task.params.medicine}`;
    }
    if (task.params.expiringMedicine !== undefined && task.params.expiringMedicine !== '' && task.params.expiringMedicine !== null) {
      params += ` --expiring-medicine ${task.params.expiringMedicine}`;
    }
    if (task.params.stone !== undefined && task.params.stone !== '' && task.params.stone !== null) {
      params += ` --stone ${task.params.stone}`;
    }
    if (task.params.series !== undefined && task.params.series !== '' && task.params.series !== '1') {
      params += ` --series=${task.params.series}`;
    }
    const dropTargets = parseDropTargetEntries(task.params.drops);
    if (dropTargets === null) {
      throw new Error('掉落目标格式应为物品 ID=数量，多个目标用逗号分隔');
    }
    dropTargets.forEach(target => {
      params += ` -D${target}`;
    });
    if (task.params.clientType) {
      params += ` --client-type ${task.params.clientType}`;
    }
    if (task.params.DrGrandet) {
      params += ' --dr-grandet';
    }
    if (task.params.report_to_penguin) {
      params += ' --report-to-penguin';
      if (String(task.params.penguin_id || '').trim()) {
        params += ` --penguin-id ${String(task.params.penguin_id).trim()}`;
      }
    }
    if (task.params.report_to_yituliu) {
      params += ' --report-to-yituliu';
      if (String(task.params.yituliu_id || '').trim()) {
        params += ` --yituliu-id ${String(task.params.yituliu_id).trim()}`;
      }
    }
  }

  if (extraArgs.length > 0) {
    params = `${extraArgs.join(' ')} ${params}`;
  }

  return { command: commandId, params };
}

export function validateScheduledTaskFlow(taskFlow: unknown): ScheduleValidationResult {
  if (!Array.isArray(taskFlow)) {
    return { success: false, message: '任务流程格式无效' };
  }

  const tasks = taskFlow as ScheduledTaskFlow;
  const invalidTaskIndex = tasks.findIndex(task => !task || typeof task !== 'object' || Array.isArray(task));
  if (invalidTaskIndex >= 0) {
    return {
      success: false,
      message: '任务流程中的每一项都必须是对象',
      details: { index: invalidTaskIndex }
    };
  }

  const invalidCustomInfrast = tasks.find(task =>
    task.enabled !== false &&
    task.taskType === 'Infrast' &&
    Number(task.params?.mode) === 10000 &&
    !String(task.params?.filename || '').trim()
  );
  if (invalidCustomInfrast) {
    return { success: false, message: '自定义换班需要填写排班文件路径' };
  }

  const invalidFightDrops = tasks.find(task => {
    const commandId = task.commandId || String(task.id || '').split('-')[0];
    return task.enabled !== false && commandId === 'fight' && parseDropTargetEntries(task.params?.drops) === null;
  });
  if (invalidFightDrops) {
    return { success: false, message: '掉落目标格式应为物品 ID=数量，多个目标用逗号分隔' };
  }

  return { success: true };
}

export function buildScheduledTaskFlowPlan(taskFlow: unknown, connectionDefaults: ConnectionDefaults = {}): SchedulePlanResult {
  const validation = validateScheduledTaskFlow(taskFlow);
  if (!validation.success) return validation;

  try {
    const steps = (taskFlow as ScheduledTaskFlow)
      .filter(task => task.enabled)
      .map((task, index): SchedulePlanStep => {
        const { command, params, taskConfig } = buildScheduledTaskCommand(task, connectionDefaults);
        const args = params ? params.split(' ').filter(Boolean) : [];
        return {
          index: index + 1,
          id: task.id,
          name: task.name || task.commandId || task.id,
          command,
          args,
          dynamicTask: Boolean(taskConfig),
          ...(taskConfig ? { taskConfig: JSON.parse(taskConfig) as unknown } : {}),
          ...(command === 'closedown' && task.params?.recognizeDepotBeforeClose === true
            ? { preActions: [{ action: 'depot-recognition' }] }
            : {})
        };
      });

    return { success: true, totalSteps: steps.length, steps };
  } catch (error) {
    return { success: false, message: getErrorMessage(error) };
  }
}

export async function getScheduledTaskFlowPlan(taskFlow: unknown): Promise<SchedulePlanResult> {
  const validation = validateScheduledTaskFlow(taskFlow);
  if (!validation.success) return validation;

  const needsConnection = Array.isArray(taskFlow) && (taskFlow as ScheduledTaskFlow).some(task => {
    if (!task.enabled) return false;
    const commandId = task.commandId || String(task.id || '').split('-')[0];
    return commandId === 'startup' || commandId === 'closedown';
  });
  const connection = needsConnection ? await resolveConnection() : {};
  return buildScheduledTaskFlowPlan(taskFlow, connection);
}

// 执行任务流程
async function executeTaskFlowUnlocked(taskFlow: ScheduledTaskFlow, scheduleId: string, runId: symbol, lifecycle: ScheduleLifecycle = {}): Promise<ScheduleExecutionResult> {
  if (!Array.isArray(taskFlow)) {
    return { success: false, message: '任务流程格式无效' };
  }

  if (scheduleExecutionStatus.isRunning) {
    logger.warn('任务流程已在执行，忽略重复触发', {
      activeScheduleId: scheduleExecutionStatus.scheduleId,
      requestedScheduleId: scheduleId
    });
    return { success: false, message: '已有任务流程正在执行' };
  }

  const validation = validateScheduledTaskFlow(taskFlow);
  if (!validation.success) return validation;

  lifecycle.onStarted?.();
  logger.info('开始执行任务流程', { scheduleId });
  activeScheduleRunId = runId;
  activeScheduleAbortController = new AbortController();

  // 更新状态：开始执行
  updateScheduleStatus({
    isRunning: true,
    scheduleId,
    currentStep: -1,
    totalSteps: taskFlow.filter(t => t.enabled).length,
    currentTask: null,
    message: '开始执行任务流程',
    startTime: Date.now(),
    shouldStop: false,  // 重置停止标志
    lastResult: null
  });

  const startTime = Date.now();
  const enabledTasks = taskFlow.filter(t => t.enabled);
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const errors: TaskErrorEntry[] = [];
  const skipped: TaskSkipEntry[] = [];
  const taskSummaries: TaskSummary[] = []; // 收集任务总结信息
  const reportResults: FightReportResult[] = [];
  const executionWarnings = new Set<string>();
  const actionResults: TaskActionResult[] = [];
  const addFightAction = (action: TaskActionResult) => {
    actionResults.push(action);
    if (action.status === 'failed') {
      errors.push({ task: action.task, error: action.message });
    } else if (action.status === 'skipped') {
      skipped.push({ task: action.task, reason: action.message });
    }
  };
  const countFightTaskResult = (actions: TaskActionResult[]) => {
    if (actions.some(action => action.status === 'failed')) failedCount++;
    else if (actions.some(action => action.status === 'success')) successCount++;
    else skippedCount++;
  };
  let screenshot: string | null = null;
  const sharedConnection = await resolveConnection();
  const adbConfig: ResolvedConnection = {
    adbPath: sharedConnection.adbPath,
    address: sharedConnection.address,
    clientType: sharedConnection.clientType
  };
  const resourceCollectionOpen = await isResourceCollectionOpenNow(sharedConnection.clientType).catch(() => false);

  const taskResults: ScheduleTaskResult[] = [];
  let activeTaskResult: ScheduleTaskResult | null = null;
  let lastTaskCounts: TaskCounts = { success: 0, failed: 0, skipped: 0 };
  const finalizeActiveTask = (forcedState: string | null = null) => {
    if (!activeTaskResult) return;
    const successDelta = successCount - lastTaskCounts.success;
    const failedDelta = failedCount - lastTaskCounts.failed;
    const skippedDelta = skippedCount - lastTaskCounts.skipped;
    activeTaskResult.state = forcedState || (failedDelta > 0
      ? 'failed'
      : successDelta > 0
        ? 'success'
        : 'skipped');
    activeTaskResult.finishedAt = new Date().toISOString();
    lastTaskCounts = { success: successCount, failed: failedCount, skipped: skippedCount };
    activeTaskResult = null;
  };

  for (let i = 0; i < enabledTasks.length; i++) {
    // 检查是否需要停止
    if (isScheduleStopRequested()) {
      logger.warn('检测到停止信号，终止任务流程', { scheduleId });
      updateScheduleStatus({
        message: '任务流程已被用户终止'
      });
      break;
    }

    finalizeActiveTask();
    const task = enabledTasks[i];
    const taskName = task.name || task.id;
    const commandId = task.commandId || task.id.split('-')[0];

    logger.info('执行任务', {
      scheduleId,
      taskIndex: i + 1,
      totalTasks: enabledTasks.length,
      taskName: task.name
    });

    // 更新状态：执行中
    updateScheduleStatus({
      currentStep: i,
      currentTask: task.name,
      currentTaskId: task.id, // 添加任务 ID
      message: `正在执行: ${task.name} (${i + 1}/${enabledTasks.length})`
    });
    activeTaskResult = {
      id: task.id,
      name: task.name,
      state: 'running',
      startedAt: new Date().toISOString()
    };
    taskResults.push(activeTaskResult);
    lifecycle.onProgress?.({
      currentStep: i + 1,
      totalSteps: enabledTasks.length,
      currentTask: task.name,
      currentTaskId: task.id,
      message: `正在执行: ${task.name} (${i + 1}/${enabledTasks.length})`,
      updatedAt: new Date().toISOString()
    }, taskResults);

    if (commandId === 'award') {
      try {
        const { command, params, taskConfig } = buildScheduledTaskCommand(task, adbConfig);
        const enabledAwardItems = getEnabledAwardItems(task.params);

        if (enabledAwardItems.length === 0) {
          skippedCount++;
          skipped.push({ task: task.name, reason: '未启用任何领取项目' });
          actionResults.push(...parseAwardExecutionActions(taskName, task.params));
          continue;
        }

        const logCheckpoint = await createMaaLogCheckpoint();
        if (isScheduleStopRequested()) break;
        let result: MaaCommandResult;

        if (taskConfig) {
          const taskId = params;
          result = await execDynamicTask(taskId, taskConfig, task.name, null, true, false, {
            shouldAbort: isScheduleStopRequested
          });
        } else {
          const args = params ? params.split(' ').filter(arg => arg) : [];
          result = await execMaaCommand(command, args, task.name, null, true);
        }

        if (result?.stdout) {
          const summary = parseTaskSummary(taskName, result.stdout);
          if (summary) taskSummaries.push(summary);
        }

        const awardActions: TaskActionResult[] = parseAwardExecutionActions(
          taskName,
          task.params,
          await readMaaLogSince(logCheckpoint)
        );
        actionResults.push(...awardActions);
        if (awardActions.some(action => action.status === 'success')) successCount++;
        else skippedCount++;

        if (shouldCaptureNotificationScreenshot()) {
          logger.info('图片通知已启用，领取奖励完成后截图', { scheduleId });
          const screenshotDelayCompleted = await waitForScheduleDelay(2000);
          if (!screenshotDelayCompleted) break;
          try {
            const screenshotResult = await captureScreen(adbConfig.adbPath, adbConfig.address);
            screenshot = screenshotResult.image;
            logger.success('通知截图成功', { scheduleId });
          } catch (error) {
            logger.error('通知截图失败', { scheduleId, error: getErrorMessage(error) });
          }
        }

        const delayCompleted = await waitForScheduleDelay(2000);
        if (!delayCompleted) break;
        continue;
      } catch (error) {
        if (isScheduleStopRequested(error)) break;
        failedCount++;
        errors.push({ task: task.name, error: getErrorMessage(error) });
        actionResults.push({
          task: task.name,
          action: 'award',
          status: 'failed',
          message: `领取奖励失败：${getErrorMessage(error)}`
        });
        logger.error('任务执行失败', {
          scheduleId,
          taskName: task.name,
          error: getErrorMessage(error)
        });
        continue;
      }
    }

    // 关闭前仓库识别是可选步骤，不再作为隐藏的强制行为。
    if (commandId === 'closedown' && task.params?.recognizeDepotBeforeClose === true) {
      // 识别仓库
      try {
        logger.info('关闭游戏前先识别仓库', { scheduleId });

        // 等待3秒确保游戏回到主界面
        logger.debug('等待游戏回到主界面', { scheduleId, waitSeconds: 3 });
        if (!await waitForScheduleDelay(3000)) break;

        if (isScheduleStopRequested()) break;
        updateScheduleStatus({
          message: '正在识别仓库...'
        });

        // 构建 Depot 任务配置
        const depotTaskConfig = {
          name: '仓库识别',
          type: 'Depot',
          params: {
            enable: true
          }
        };

        // execDynamicTask 需要 JSON 字符串
        // execDynamicTask 成功时不抛出异常，失败时抛出异常
        try {
          if (isScheduleStopRequested()) break;
          await execDynamicTask('Depot_temp', JSON.stringify(depotTaskConfig), '仓库识别', 'depot', true, false, {
            clientType: adbConfig.clientType,
            shouldAbort: isScheduleStopRequested
          });
          logger.success('仓库识别命令执行完成', { scheduleId });

          // 解析并保存仓库数据
          logger.debug('开始解析仓库数据', { scheduleId });
          const { parseDepotData } = await import('./dataParserService.ts');
          const parseResult = await parseDepotData();
          if (parseResult && parseResult.success) {
            const itemCount = isRecord(parseResult.data) ? (parseResult.data.itemCount || 0) : 0;
            logger.success('仓库数据已保存', {
              scheduleId,
              itemCount
            });
            actionResults.push({
              task: task.name,
              action: 'depot',
              status: 'success',
              message: `关闭前仓库识别完成，共 ${itemCount} 项`
            });
          } else {
            logger.warn('仓库数据解析失败', { scheduleId });
            actionResults.push({
              task: task.name,
              action: 'depot',
              status: 'failed',
              message: '关闭前仓库识别完成，但数据解析失败'
            });
          }
        } catch (depotError) {
          if (isScheduleStopRequested(depotError)) break;
          logger.error('仓库识别失败', {
            scheduleId,
            error: getErrorMessage(depotError)
          });
          actionResults.push({
            task: task.name,
            action: 'depot',
            status: 'failed',
            message: `关闭前仓库识别失败：${getErrorMessage(depotError)}`
          });
          // 即使识别失败也继续执行后续任务
        }

        // 等待2秒
        logger.debug('等待后继续', { scheduleId, waitSeconds: 2 });
        if (!await waitForScheduleDelay(2000)) break;
      } catch (error) {
        logger.error('仓库识别异常', {
          scheduleId,
          error: getErrorMessage(error)
        });
        actionResults.push({
          task: task.name,
          action: 'depot',
          status: 'failed',
          message: `关闭前仓库识别异常：${getErrorMessage(error)}`
        });
        // 即使识别失败也继续
      }
    }

    // 如果是启动游戏任务，添加重试机制
    if (commandId === 'startup') {
      if (isScheduleStopRequested()) break;

      const connectionCheck = await testAdbConnection(adbConfig.adbPath, adbConfig.address, {
        shouldStop: isScheduleStopRequested
      });
      if (isScheduleStopRequested()) break;
      if (!connectionCheck.success) {
        const errorMessage = connectionCheck.message || '模拟器连接失败';
        failedCount++;
        errors.push({ task: task.name, error: errorMessage });
        actionResults.push({
          task: task.name,
          action: 'startup',
          status: 'failed',
          message: errorMessage
        });
        logger.error('启动游戏前连接检查失败', { scheduleId, error: errorMessage });
        continue;
      }

      const maxRetries = 2;
      let retryCount = 0;
      let startupSuccess = false;

      while (retryCount <= maxRetries && !startupSuccess) {
        if (isScheduleStopRequested()) break;

        try {
          if (retryCount > 0) {
            logger.info('启动游戏重试', {
              scheduleId,
              retryCount,
              maxRetries
            });
            // 重试前等待3秒，停止时立即打断
            if (!await waitForScheduleDelay(3000)) break;
          }

          const { command, params } = buildScheduledTaskCommand(task, adbConfig);
          const args = params ? params.split(' ').filter(arg => arg) : [];
          if (isScheduleStopRequested()) break;
          await execMaaCommand(command, args, task.name, null, true);
          if (isScheduleStopRequested()) break;

          logger.info('启动游戏命令执行完成', { scheduleId });

          // 同时检查前台包名和截图，避免游戏闪退到模拟器桌面后被误判为成功。
          try {
            logger.debug('检测游戏是否运行中', { scheduleId });
            const gameState = await getGameClientState(
              adbConfig.adbPath,
              adbConfig.address,
              firstNonEmptyString(task.params.clientType) || DEFAULT_CLIENT_TYPE
            );
            if (!gameState.running) {
              throw new Error(`游戏未在前台，当前应用：${gameState.foregroundPackage || '未知'}`);
            }
            if (isScheduleStopRequested()) break;
            await captureScreen(adbConfig.adbPath, adbConfig.address);
            if (isScheduleStopRequested()) break;
            logger.success('游戏运行正常', { scheduleId });
            startupSuccess = true;
            successCount++;
            actionResults.push({
              task: task.name,
              action: 'startup',
              status: 'success',
              message: task.params.accountName
                ? `游戏已启动，账号 ${task.params.accountName} 已匹配`
                : '游戏已启动并进入前台'
            });
          } catch (error) {
            if (isScheduleStopRequested(error)) break;
            logger.error('游戏可能已闪退', {
              scheduleId,
              error: getErrorMessage(error)
            });
            retryCount++;
            if (retryCount > maxRetries) {
              throw new Error('游戏启动后闪退，已达到最大重试次数');
            }
          }
        } catch (error) {
          if (isScheduleStopRequested(error)) {
            logger.warn('启动游戏已终止，不再重试', { scheduleId });
            break;
          }
          if (retryCount >= maxRetries) {
            failedCount++;
            errors.push({ task: task.name, error: getErrorMessage(error) });
            actionResults.push({
              task: task.name,
              action: 'startup',
              status: 'failed',
              message: getErrorMessage(error)
            });
            logger.error('任务执行失败', {
              scheduleId,
              taskName: task.name,
              error: getErrorMessage(error)
            });
            break;
          }
          retryCount++;
        }
      }

      if (isScheduleStopRequested()) break;
      // 启动游戏任务已处理完成，继续下一个任务
      continue;
    }

    if (commandId === 'recruit') {
      try {
        const { command, params, taskConfig } = buildScheduledTaskCommand(task, adbConfig);
        const logCheckpoint = await createMaaLogCheckpoint();
        if (isScheduleStopRequested()) break;
        let result: MaaCommandResult;

        if (taskConfig) {
          result = await execDynamicTask(params, taskConfig, task.name, null, true, false, {
            shouldAbort: isScheduleStopRequested
          });
        } else {
          const args = params ? params.split(' ').filter(arg => arg) : [];
          result = await execMaaCommand(command, args, task.name, null, true);
        }

        if (result?.stdout) {
          const summary = parseTaskSummary(taskName, result.stdout);
          if (summary) taskSummaries.push(summary);
        }

        const recruitAction: TaskActionResult = parseRecruitExecutionAction(
          taskName,
          task.params,
          await readMaaLogSince(logCheckpoint)
        );
        actionResults.push(recruitAction);

        if (recruitAction.status === 'failed') {
          failedCount++;
          errors.push({ task: task.name, error: recruitAction.message });
        } else if (recruitAction.status === 'skipped') {
          skippedCount++;
          skipped.push({ task: task.name, reason: recruitAction.message });
        } else {
          successCount++;
        }

        const delayCompleted = await waitForScheduleDelay(2000);
        if (!delayCompleted) break;
        continue;
      } catch (error) {
        if (isScheduleStopRequested(error)) break;
        failedCount++;
        errors.push({ task: task.name, error: getErrorMessage(error) });
        actionResults.push({
          task: task.name,
          action: 'recruit',
          status: 'failed',
          message: `自动公招失败：${getErrorMessage(error)}`
        });
        logger.error('自动公招执行失败', { scheduleId, taskName: task.name, error: getErrorMessage(error) });
        continue;
      }
    }

    if (commandId === 'infrast') {
      try {
        if (!Array.isArray(task.params.facility) || task.params.facility.length === 0) {
          const infrastAction: TaskActionResult = parseInfrastExecutionAction(taskName, task.params);
          skippedCount++;
          skipped.push({ task: task.name, reason: infrastAction.message });
          actionResults.push(infrastAction);
          continue;
        }

        const { command, params, taskConfig } = buildScheduledTaskCommand(task, adbConfig);
        const logCheckpoint = await createMaaLogCheckpoint();
        if (isScheduleStopRequested()) break;
        let result: MaaCommandResult;

        if (taskConfig) {
          result = await execDynamicTask(params, taskConfig, task.name, null, true, false, {
            shouldAbort: isScheduleStopRequested
          });
        } else {
          const args = params ? params.split(' ').filter(arg => arg) : [];
          result = await execMaaCommand(command, args, task.name, null, true);
        }

        if (result?.stdout) {
          const summary = parseTaskSummary(taskName, result.stdout);
          if (summary) taskSummaries.push(summary);
        }

        const infrastAction: TaskActionResult = parseInfrastExecutionAction(
          taskName,
          task.params,
          await readMaaLogSince(logCheckpoint)
        );
        actionResults.push(infrastAction);

        if (infrastAction.status === 'failed') {
          failedCount++;
          errors.push({ task: task.name, error: infrastAction.message });
        } else if (infrastAction.status === 'skipped') {
          skippedCount++;
          skipped.push({ task: task.name, reason: infrastAction.message });
        } else {
          successCount++;
        }

        const delayCompleted = await waitForScheduleDelay(2000);
        if (!delayCompleted) break;
        continue;
      } catch (error) {
        if (isScheduleStopRequested(error)) break;
        failedCount++;
        errors.push({ task: task.name, error: getErrorMessage(error) });
        actionResults.push({
          task: task.name,
          action: 'infrast',
          status: 'failed',
          message: `基建任务失败：${getErrorMessage(error)}`
        });
        logger.error('基建任务执行失败', { scheduleId, taskName: task.name, error: getErrorMessage(error) });
        continue;
      }
    }

    if (commandId === 'mall') {
      try {
        if (task.params?.visit_friends === false
          && task.params?.shopping === false
          && task.params?.credit_fight === false) {
          const mallAction: TaskActionResult = parseMallExecutionAction(taskName, task.params);
          skippedCount++;
          skipped.push({ task: task.name, reason: mallAction.message });
          actionResults.push(mallAction);
          continue;
        }

        const { command, params, taskConfig } = buildScheduledTaskCommand(task, adbConfig);
        const logCheckpoint = await createMaaLogCheckpoint();
        if (isScheduleStopRequested()) break;
        let result: MaaCommandResult;

        if (taskConfig) {
          result = await execDynamicTask(params, taskConfig, task.name, null, true, false, {
            shouldAbort: isScheduleStopRequested
          });
        } else {
          const args = params ? params.split(' ').filter(arg => arg) : [];
          result = await execMaaCommand(command, args, task.name, null, true);
        }

        if (result?.stdout) {
          const summary = parseTaskSummary(taskName, result.stdout);
          if (summary) taskSummaries.push(summary);
        }

        const mallAction: TaskActionResult = parseMallExecutionAction(
          taskName,
          task.params,
          await readMaaLogSince(logCheckpoint)
        );
        actionResults.push(mallAction);

        if (mallAction.status === 'failed') {
          failedCount++;
          errors.push({ task: task.name, error: mallAction.message });
        } else if (mallAction.status === 'skipped') {
          skippedCount++;
          skipped.push({ task: task.name, reason: mallAction.message });
        } else {
          successCount++;
        }

        const delayCompleted = await waitForScheduleDelay(2000);
        if (!delayCompleted) break;
        continue;
      } catch (error) {
        if (isScheduleStopRequested(error)) break;
        failedCount++;
        errors.push({ task: task.name, error: getErrorMessage(error) });
        actionResults.push({
          task: task.name,
          action: 'mall',
          status: 'failed',
          message: `信用收支失败：${getErrorMessage(error)}`
        });
        logger.error('信用收支执行失败', { scheduleId, taskName: task.name, error: getErrorMessage(error) });
        continue;
      }
    }

    try {
      const { command, params, taskConfig } = buildScheduledTaskCommand(task, adbConfig);

      if (taskConfig) {
        const taskId = params;
        const fightLogCheckpoint = commandId === 'fight' ? await createMaaLogCheckpoint() : null;
        let effectiveTaskConfig = taskConfig;
        if (commandId === 'fight') {
          const parsed = JSON.parse(taskConfig) as DynamicFightTaskDocument;
          if (Array.isArray(parsed.tasks)) {
            const clientType = firstNonEmptyString(task.params?.clientType, adbConfig.clientType)
              || DEFAULT_CLIENT_TYPE;
            parsed.tasks = await Promise.all(parsed.tasks.map(async item => {
              const itemStage = item.params?.stage;
              return {
                ...item,
                params: {
                  ...item.params,
                  stage: typeof itemStage === 'string'
                    ? await replaceActivityCode(itemStage, clientType)
                    : itemStage
                }
              };
            }));
            effectiveTaskConfig = JSON.stringify(parsed);
          }
        }
        // 定时任务需要等待命令完成才能获取输出
        if (isScheduleStopRequested()) break;
        const result = await execDynamicTask(taskId, effectiveTaskConfig, task.name, null, true, false, {
          shouldAbort: isScheduleStopRequested
        });

        // 尝试从输出中提取任务总结
        if (result.stdout) {
          let summary = parseTaskSummary(taskName, result.stdout);
          if (summary) {
            if (commandId === 'fight' && fightLogCheckpoint) {
              summary = await attachFightCallbacks(summary, fightLogCheckpoint, taskName);
              await recordFightDrops(summary, scheduleId);
            }
            taskSummaries.push(summary);
          }
        }
      } else {
        const args = params ? params.split(' ').filter(arg => arg) : [];

        // 如果是 fight 命令，处理多个关卡
        if (command === 'fight' && args.length > 0) {
          const stageInput = args[0];
          const clientType = firstNonEmptyString(task.params.clientType) || DEFAULT_CLIENT_TYPE;

          // 解析关卡列表，格式：stage1:times1,stage2:times2 或 stage1,stage2
          const stageEntries = stageInput.split(',').map((entry): NormalizedFightStage => {
            const parts = entry.trim().split(':');
            return {
              stage: parts[0],
              times: parts[1] || ''
            };
          }).filter(entry => entry.stage);

          if (stageEntries.length > 1) {
            // 多个关卡，依次执行
            logger.info('检测到多个关卡', {
              scheduleId,
              stages: stageEntries.map(entry => `${entry.stage}${entry.times ? `:${entry.times}` : ''}`).join(', ')
            });

            let sanityDepleted = false;
            const fightActionStartIndex = actionResults.length;

            for (let i = 0; i < stageEntries.length; i++) {
              if (isScheduleStopRequested()) {
                logger.warn('多关卡任务收到停止信号，不再进入下一关', { scheduleId });
                break;
              }
              const { stage, times } = stageEntries[i];

              // 如果理智已耗尽，跳过剩余关卡
              if (sanityDepleted) {
                logger.info('理智已耗尽，跳过关卡', { scheduleId, stage });
                addFightAction(createFightExecutionAction(`${task.name} (${stage})`, stage, {
                  skipReason: '理智已耗尽'
                }));
                continue;
              }

              // 检查关卡是否开放
              const openCheck = isStageOpenToday(stage, { clientType: sharedConnection.clientType, resourceCollectionOpen });
              if (!openCheck.isOpen) {
                logger.info('关卡今日未开放，跳过', {
                  scheduleId,
                  stage,
                  reason: openCheck.reason
                });
                addFightAction(createFightExecutionAction(`${task.name} (${stage})`, stage, {
                  skipReason: openCheck.reason
                }));
                continue; // 跳过这个关卡
              }

              logger.info('执行关卡', {
                scheduleId,
                stageIndex: i + 1,
                totalStages: stageEntries.length,
                stage,
                times
              });

              // 替换活动代号
              const realStage = await replaceActivityCode(stage, clientType);
              if (realStage !== stage) {
                logger.debug('关卡代号已替换', {
                  scheduleId,
                  originalStage: stage,
                  realStage
                });
              }

              // 构建当前关卡的参数（移除第一个参数，添加当前关卡和次数）
              const currentArgs: string[] = [realStage];
              if (times) {
                currentArgs.push('--times', times);
              }

              // 添加其他参数（理智药、源石等）
              // 如果填了次数，排除 --series 参数；否则保留所有参数
              let otherArgs: string[];
              if (times) {
                // 填了次数，过滤掉 --series
                otherArgs = args.slice(1).filter((arg, index, arr) => {
                  if (arg.startsWith('--series=')) return false;
                  const previous = index > 0 ? arr[index - 1] : '';
                  return arg !== '--series' && previous !== '--series';
                });
              } else {
                // 没填次数，保留所有参数（包括 --series）
                otherArgs = args.slice(1);
              }
              currentArgs.push(...otherArgs);

              // 执行命令
              try {
                const fightLogCheckpoint = await createMaaLogCheckpoint();
                if (isScheduleStopRequested()) break;
                const result = await execMaaCommand(command, currentArgs, `${task.name} (${stage})`, null, true);
                if (isScheduleStopRequested()) break;
                const reportSummary = getFightReportResults(task, stage, result);
                reportResults.push(...reportSummary.reportResults);
                reportSummary.diagnostics.forEach(diagnostic => executionWarnings.add(diagnostic.message));

                // 检查理智状态（传入关卡名称用于排除剿灭）
                const output = (result.stdout || '') + (result.stderr || '');
                logger.debug('检查理智状态', {
                  scheduleId,
                  stage,
                  outputLength: output.length
                });
                logger.debug('输出内容预览', {
                  scheduleId,
                  preview: output.substring(0, 200)
                });

                if (isFightSanityDepleted(output, stage)) {
                  logger.info('检测到理智已耗尽', { scheduleId, stage });
                  sanityDepleted = true;
                } else {
                  logger.debug('未检测到理智耗尽', { scheduleId, stage });
                }

                // 提取任务总结，并用结构化回调补齐掉落与理智
                let summary = result.stdout
                  ? parseTaskSummary(`${task.name} (${stage})`, result.stdout)
                  : null;
                summary = await attachFightCallbacks(summary, fightLogCheckpoint, `${task.name} (${stage})`);
                if (summary) {
                  taskSummaries.push(summary);
                  await recordFightDrops(summary, scheduleId);
                }
                addFightAction(createFightExecutionAction(`${task.name} (${stage})`, stage, {
                  summary,
                  output
                }));
              } catch (error) {
                if (isScheduleStopRequested(error)) {
                  logger.warn('当前关卡已被终止，不再执行后续关卡', { scheduleId, stage });
                  break;
                }
                const errorMsg = getErrorMessage(error) || '';
                const errorOutput = String(asErrorWithCode(error).stdout || '') + String(asErrorWithCode(error).stderr || '');

                logger.debug('任务执行出错，检查是否理智不足', {
                  scheduleId,
                  stage,
                  errorMsg
                });

                const fightAction = createFightExecutionAction(`${task.name} (${stage})`, stage, {
                  output: errorOutput,
                  error
                });
                if (fightAction.sanityDepleted) {
                  logger.info('检测到理智已耗尽（从错误信息）', { scheduleId, stage });
                  sanityDepleted = true;
                } else if (fightAction.status === 'skipped') {
                  logger.info('关卡未执行，已跳过', { scheduleId, stage, reason: fightAction.message });
                } else {
                  logger.error('关卡执行失败', { scheduleId, stage, error: errorMsg });
                }
                addFightAction(fightAction);
              }

              // 关卡之间等待2秒
              if (i < stageEntries.length - 1) {
                logger.debug('等待后继续下一个关卡', { scheduleId, waitSeconds: 2 });
                const delayCompleted = await waitForScheduleDelay(2000);
                if (!delayCompleted) break;
              }
            }

            countFightTaskResult(actionResults.slice(fightActionStartIndex));

            // 所有关卡完成后的延迟
            let delayTime = 2000;
            logger.debug('任务完成，等待后继续', {
              scheduleId,
              taskName: task.name,
              delaySeconds: delayTime / 1000
            });
            const delayCompleted = await waitForScheduleDelay(delayTime);
            if (!delayCompleted) break;

            continue; // 跳过后面的单关卡处理
          } else {
            // 单个关卡，检查是否开放
            const { stage, times } = stageEntries[0];

            // 检查关卡是否开放
            const openCheck = isStageOpenToday(stage, { clientType: sharedConnection.clientType, resourceCollectionOpen });
            if (!openCheck.isOpen) {
              logger.info('关卡今日未开放，跳过', {
                scheduleId,
                stage,
                reason: openCheck.reason
              });
              const fightAction = createFightExecutionAction(`${task.name} (${stage})`, stage, {
                skipReason: openCheck.reason
              });
              addFightAction(fightAction);
              countFightTaskResult([fightAction]);

              // 跳过后的延迟
              logger.debug('任务已跳过，等待后继续', {
                scheduleId,
                taskName: task.name,
                waitSeconds: 2
              });
              if (!await waitForScheduleDelay(2000)) break;
              continue; // 跳过这个任务
            }

            // 替换活动代号
            const realStage = await replaceActivityCode(stage, clientType);
            if (realStage !== stage) {
              args[0] = realStage; // 只保留关卡名，不要拼接次数
              logger.debug('关卡代号已替换', {
                scheduleId,
                originalStage: stage,
                realStage
              });
            } else if (times) {
              // 如果没有替换但有次数，也要更新 args[0] 为纯关卡名
              args[0] = stage;
            }

            // 如果有次数，添加 --times 参数，并移除 --series 参数
            if (times && !args.includes('--times')) {
              args.splice(1, 0, '--times', times);

              // 移除 --series 参数（填了次数的关卡不使用连战）
              const combinedSeriesIndex = args.findIndex(arg => arg.startsWith('--series='));
              if (combinedSeriesIndex !== -1) {
                args.splice(combinedSeriesIndex, 1);
              } else {
                const seriesIndex = args.indexOf('--series');
                if (seriesIndex !== -1) args.splice(seriesIndex, 2);
              }
            }
          }
        }

        // 定时任务需要等待命令完成才能获取输出
        const fightLogCheckpoint = command === 'fight' ? await createMaaLogCheckpoint() : null;
        if (isScheduleStopRequested()) break;
        const result = await execMaaCommand(command, args, task.name, null, true);
        if (command === 'closedown') {
          actionResults.push({
            task: task.name,
            action: 'closedown',
            status: 'success',
            message: '游戏客户端已关闭'
          });
        }
        const fightStage = command === 'fight'
          ? (args[0] || (typeof task.params?.stage === 'string' ? task.params.stage : '') || '')
          : '';
        if (command === 'fight') {
          const stage = fightStage;
          const reportSummary = getFightReportResults(task, stage, result);
          reportResults.push(...reportSummary.reportResults);
          reportSummary.diagnostics.forEach(diagnostic => executionWarnings.add(diagnostic.message));
        }

        // 尝试从输出中提取任务总结，并用结构化回调补齐掉落与理智
        let parsedTaskSummary: TaskSummary | null = null;
        if (result.stdout) {
          parsedTaskSummary = parseTaskSummary(taskName, result.stdout);
        }
        if (command === 'fight') {
          parsedTaskSummary = await attachFightCallbacks(parsedTaskSummary, fightLogCheckpoint, taskName);
        }
        if (parsedTaskSummary) {
          taskSummaries.push(parsedTaskSummary);
          if (command === 'fight') await recordFightDrops(parsedTaskSummary, scheduleId);
        }

        if (command === 'fight') {
          const output = (result.stdout || '') + (result.stderr || '');
          const fightAction = createFightExecutionAction(taskName, fightStage, {
            summary: parsedTaskSummary,
            output
          });
          addFightAction(fightAction);
          countFightTaskResult([fightAction]);
        }
      }

      if (commandId !== 'fight') successCount++;

      // 任务完成后的延迟时间
      // 启动游戏需要更长的等待时间，确保游戏完全启动
      let delayTime = 2000;
      if (commandId === 'startup') {
        delayTime = 15000; // 启动游戏等待15秒
      } else if (commandId === 'closedown') {
        delayTime = 3000; // 关闭游戏等待3秒
      }

      logger.debug('任务完成，等待后继续', {
        scheduleId,
        taskName: task.name,
        delaySeconds: delayTime / 1000
      });
      const delayCompleted = await waitForScheduleDelay(delayTime);
      if (!delayCompleted) {
        logger.warn('任务间等待已被终止信号打断', { scheduleId, taskName: task.name });
        break;
      }
    } catch (error) {
      if (isScheduleStopRequested(error)) {
        logger.warn('当前任务已被用户终止', { scheduleId, taskName: task.name });
        break;
      }

      failedCount++;
      errors.push({ task: task.name, error: getErrorMessage(error) });
      if (commandId === 'fight') {
        const firstStage = Array.isArray(task.params?.stages) && isRecord(task.params.stages[0])
          ? task.params.stages[0].stage
          : undefined;
        const configuredStage = (typeof firstStage === 'string' && firstStage)
          ? firstStage
          : (typeof task.params?.stage === 'string' ? task.params.stage : '');
        const action = createFightExecutionAction(taskName, configuredStage, { error });
        actionResults.push(action);
        if (action.status === 'skipped') {
          failedCount--;
          errors.pop();
          skippedCount++;
          skipped.push({ task: action.task, reason: action.message });
        }
      }
      if (commandId === 'closedown') {
        actionResults.push({
          task: task.name,
          action: 'closedown',
          status: 'failed',
          message: `关闭游戏失败：${getErrorMessage(error)}`
        });
      }
      logger.error('任务执行失败', {
        scheduleId,
        taskName: task.name,
        error: getErrorMessage(error)
      });
      // 继续执行下一个任务
    }
  }

  const wasStopped = scheduleExecutionStatus.shouldStop;
  finalizeActiveTask(wasStopped ? 'stopped' : null);
  const duration = Date.now() - startTime;
  const reportFailureCount = reportResults.filter(report => report.status === 'failed').length;
  const completionMessage = wasStopped
    ? '任务流程已被用户终止'
    : reportFailureCount > 0
      ? `任务流程执行完成，${reportFailureCount} 项掉落汇报失败`
      : failedCount > 0
        ? `任务流程执行完成，${failedCount} 项任务失败`
        : '任务流程执行完成';
  const executionSummary: ScheduleExecutionSummary = {
    successCount,
    failedCount,
    skippedCount,
    durationMs: duration,
    summaries: taskSummaries,
    reports: reportResults,
    actions: actionResults,
    taskResults,
    errors,
    warnings: [...executionWarnings]
  };
  logger.info(completionMessage, {
    scheduleId,
    successCount,
    failedCount,
    skippedCount,
    durationSeconds: Math.floor(duration / 1000)
  });

  lifecycle.onProgress?.({
    currentStep: wasStopped ? scheduleExecutionStatus.currentStep : enabledTasks.length,
    totalSteps: enabledTasks.length,
    currentTask: null,
    message: completionMessage,
    updatedAt: new Date().toISOString()
  }, taskResults);

  // 更新状态：完成
  updateScheduleStatus({
    isRunning: false,
    currentStep: wasStopped ? scheduleExecutionStatus.currentStep : enabledTasks.length,
    message: completionMessage,
    scheduleId: null,
    currentTask: null,
    currentTaskId: null,
    shouldStop: false,
    lastResult: executionSummary
  });
  activeScheduleAbortController = null;
  activeScheduleRunId = null;

  if (wasStopped) {
    return { success: true, stopped: true, message: completionMessage, summary: executionSummary };
  }

  // 收尾副作用在 Run 释放后异步执行，不阻塞流程完成与设备租约释放。
  void updateSmartTrainingStages(scheduleId).catch((error: unknown) => {
    logger.error('动态更新智能养成关卡失败', {
      scheduleId,
      error: getErrorMessage(error)
    });
  });

  // 发送完成通知
  void sendTaskCompletionNotification({
      taskName: `定时任务 ${scheduleId}`,
      totalTasks: enabledTasks.length,
      successTasks: successCount,
      failedTasks: failedCount,
      skippedTasks: skippedCount,
      duration,
      errors,
      skipped,
      summaries: taskSummaries as Parameters<typeof sendTaskCompletionNotification>[0]['summaries'],
      actions: actionResults,
      reports: reportResults,
      warnings: [...executionWarnings],
      screenshot,
  }).catch((error: unknown) => {
    logger.error('发送通知失败', {
      scheduleId,
      error: getErrorMessage(error)
    });
  });

  return { success: true, stopped: false, message: completionMessage, summary: executionSummary };
}

function getThrownMessage(error: unknown): string {
  if (!isRecord(error)) return '';
  return error.message ? String(error.message) : '';
}

async function executeTaskFlow(taskFlow: unknown, scheduleId: string, lifecycle: ScheduleLifecycle = {}): Promise<ScheduleExecutionResult> {
  const runId = Symbol(scheduleId);
  let unexpectedError: unknown = null;
  try {
    return await withMaaExecutionLease({
      source: 'schedule',
      taskName: `任务流程 ${scheduleId}`,
      command: 'schedule',
      runId: lifecycle.runId || null
    }, () => executeTaskFlowUnlocked(taskFlow as ScheduledTaskFlow, scheduleId, runId, lifecycle));
  } catch (error) {
    if (getErrorCode(error) === 'MAA_EXECUTION_BUSY') {
      logger.warn('设备正被其他 MAA 任务占用，跳过任务流程', { scheduleId, owner: asErrorWithCode(error).owner });
      return {
        success: false,
        message: getErrorMessage(error),
        busy: true,
        owner: asErrorWithCode(error).owner
      };
    }
    unexpectedError = error;
    throw error;
  } finally {
    const ownsActiveExecution = activeScheduleRunId === runId;
    if (ownsActiveExecution && scheduleExecutionStatus.isRunning) {
      const wasStopped = scheduleExecutionStatus.shouldStop;
      const unexpectedMessage = getThrownMessage(unexpectedError);
      const message = wasStopped
        ? '任务流程已被用户终止'
        : `任务流程异常终止${unexpectedMessage ? `: ${unexpectedMessage}` : ''}`;

      logger.error('任务流程未正常收尾，已复位执行状态', {
        scheduleId,
        stopped: wasStopped,
        error: unexpectedMessage || null
      });
      updateScheduleStatus({
        isRunning: false,
        scheduleId: null,
        currentStep: -1,
        totalSteps: 0,
        currentTask: null,
        currentTaskId: null,
        message,
        startTime: null,
        shouldStop: false
      });
    }

    if (ownsActiveExecution || !scheduleExecutionStatus.isRunning) {
      cancelActiveScheduleDelay = null;
      activeScheduleAbortController = null;
      if (ownsActiveExecution) activeScheduleRunId = null;
    }
  }
}

export async function executeScheduledTaskFromCron(taskFlow: unknown, scheduleId: string): Promise<ScheduleExecutionResult & { runId: string }> {
  const reservation = beginAgentRun({
    operationId: 'run_daily_flow',
    input: { scheduleId, taskFlow },
    trigger: { type: 'cron', scheduleId, source: 'cron' },
    metadata: { taskName: `定时任务 ${scheduleId}`, taskType: 'schedule' }
  });
  const runId = reservation.run.runId;
  const lifecycle: ScheduleLifecycle = {
    runId,
    onProgress: (progress, taskResults = null) => updateAgentRunProgress(runId, progress, taskResults)
  };

  try {
    await flushAgentRunStore();
  } catch (error) {
    failAgentRun(runId, error);
    await flushAgentRunStore().catch((_error: unknown) => undefined);
    logger.error('定时任务 Run 接受状态持久化失败，已跳过执行', { scheduleId, runId, error: getErrorMessage(error) });
    return { success: false, message: getErrorMessage(error), runId };
  }

  startAgentRun(runId);
  try {
    const result = await executeTaskFlow(taskFlow, scheduleId, lifecycle);
    if (result.success) {
      completeAgentRun(runId, result);
    } else {
      const failure = result.busy
        ? agentError('MAA_EXECUTION_BUSY', result.message || '设备正被其他任务占用', {
            statusCode: 409,
            details: { owner: result.owner || null },
            retryable: true
          })
        : new Error(result.message || '定时任务执行失败');
      failAgentRun(runId, failure);
    }
    await flushAgentRunStore().catch((error: unknown) => {
      logger.error('定时任务 Run 终态持久化失败', { scheduleId, runId, error: getErrorMessage(error) });
    });
    return { ...result, runId };
  } catch (error) {
    failAgentRun(runId, error);
    await flushAgentRunStore().catch((flushError: unknown) => {
      logger.error('定时任务 Run 失败状态持久化失败', { scheduleId, runId, error: getErrorMessage(flushError) });
    });
    logger.error('定时任务回调执行失败', { scheduleId, runId, error: getErrorMessage(error) });
    return { success: false, message: getErrorMessage(error), runId };
  }
}

/**
 * 解析 MAA 任务总结信息
 */
export function parseTaskSummary(taskName: string, output: string): TaskSummary | null {
  const summary: TaskSummary = { task: taskName };

  // 调试：打印原始输出
  logger.debug('解析任务总结', {
    taskName,
    outputLength: output.length
  });
  logger.debug('任务总结完整输出', { output });

  // 解析 MAA 的实际输出格式
  // 格式示例: Fight OR-7 1 times, drops:

  // 提取关卡和次数
  const fightMatch = output.match(/Fight\s+([A-Z0-9-]+)\s+(\d+)\s+times?/i);
  if (fightMatch) {
    summary.stage = fightMatch[1];
    summary.times = fightMatch[2];
  }

  // 提取掉落信息
  // 格式: total drops: "生香" × 21, 全新装置 × 1, 龙门币 × 252
  const totalDropsMatch = output.match(/total drops:\s*(.+?)(?:\n|$)/i);
  if (totalDropsMatch) {
    const dropsText = totalDropsMatch[1].trim();
    // 解析每个物品
    const itemMatches = dropsText.matchAll(/(?:"([^"]+)"|([^\s,×]+))\s*×\s*(\d+)/g);
    const drops: string[] = [];
    const dropItems: FightDropItem[] = []; // 用于记录的结构化数据
    for (const match of itemMatches) {
      const itemName = match[1] || match[2];
      const count = parseInt(match[3]);
      drops.push(`${itemName} × ${count}`);
      dropItems.push({ name: itemName, count });
    }
    if (drops.length > 0) {
      summary.drops = drops.join(', ');
      summary.dropItems = dropItems; // 保存结构化数据
    }
  }

  // 提取理智药和源石使用（maa-cli 0.7.x 的 Summary 格式）
  const medicineMatch = output.match(/used\s+(\d+)\s+medicine/i)
    || output.match(/medicine[:\s]+(\d+)/i);
  if (medicineMatch) {
    summary.medicine = medicineMatch[1];
  }

  const stoneMatch = output.match(/used\s+(\d+)\s+stone/i)
    || output.match(/stone[:\s]+(\d+)/i);
  if (stoneMatch) {
    summary.stone = stoneMatch[1];
  }

  // 提取执行时间
  const timeMatch = output.match(/\[Fight\]\s+([\d:]+)\s+-\s+([\d:]+)\s+\(([^)]+)\)/);
  if (timeMatch) {
    summary.duration = timeMatch[3];
  }

  // 解析公招总结（Detected tags 格式）
  if (output.includes('Detected tags')) {
    const recruits: RecruitSummary[] = [];
    const recruitLinePattern = /^\s*\d+\.\s*(★+)\s*(.*?)(?:,\s*(Recruited|Refreshed))?\s*$/gm;
    for (const match of output.matchAll(recruitLinePattern)) {
      const tags = match[2].split(',').map(tag => tag.trim()).filter(Boolean);
      recruits.push({
        stars: match[1].length,
        tags,
        state: match[3] || null
      });
    }
    if (recruits.length > 0) {
      summary.recruits = recruits;
    }

    const recruitedMatch = output.match(/Recruited\s+(\d+)\s+times/i);
    if (recruitedMatch) summary.recruitCount = Number(recruitedMatch[1]);
    const refreshedMatch = output.match(/Refreshed\s+(\d+)\s+times/i);
    if (refreshedMatch) summary.refreshCount = Number(refreshedMatch[1]);
  } else if (output.includes('Recruit')) {
    const recruitMatches = output.matchAll(/Recruit[:\s]+\[([^\]]+)\]\s*->\s*(\d+)\*/gi);
    const recruits: RecruitSummary[] = [];
    for (const match of recruitMatches) {
      recruits.push({
        tags: match[1],
        stars: match[2]
      });
    }
    if (recruits.length > 0) {
      summary.recruits = recruits;
    }
  }

  // 解析基建总结（maa-cli 0.7.x 的设施明细格式）
  const infrastLines = output.split('\n')
    .map(line => line.trim())
    .filter(line => /^(Control|Mfg|Trade|Power|Office|Reception|Dorm|Processing|Training|Unknown)\b/.test(line));
  if (infrastLines.length > 0) {
    summary.infrast = infrastLines.join('\n');
  } else if (output.includes('Infrast')) {
    const infrastMatch = output.match(/Infrast[:\s]+([^\n]+)/i);
    if (infrastMatch) {
      summary.infrast = infrastMatch[1].trim();
    }
  }

  logger.debug('任务总结解析结果', { summary });

  return Object.keys(summary).length > 1 ? summary : null;
}

// 创建或更新定时任务
export function setupSchedule(
  scheduleId: string,
  times: unknown,
  taskFlow: unknown,
  clientType?: string
) {
  if (!Array.isArray(taskFlow)) {
    return { success: false, message: '任务流程格式无效' };
  }

  const normalizedTimes: string[] = Array.isArray(times)
    ? [...new Set(times.filter((time): time is string =>
      typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)))]
    : [];

  if (normalizedTimes.length === 0) {
    return { success: false, message: '没有设置执行时间' };
  }

  // 仅在新配置通过校验后替换现有任务，避免错误输入清空有效计划。
  const existingJobs = scheduledJobs.get(scheduleId);
  if (existingJobs) {
    existingJobs.forEach(({ job }) => job.stop());
    scheduledJobs.delete(scheduleId);
  }

  const jobs: ScheduledJobEntry[] = [];
  const failedTimes: string[] = [];

  normalizedTimes.forEach((time, index) => {
    if (!time) return;

    // 解析时间 (HH:MM)
    const [hour, minute] = time.split(':');
    if (!hour || !minute) return;

    // 创建 cron 表达式: 分 时 * * *
    const cronExpression = `${minute} ${hour} * * *`;
    const cronOptions = {
      scheduled: true,
      timezone: gameTimeZoneForClientType(clientType)
    };

    try {
      const job = cron.schedule(cronExpression, () => {
        logger.info('定时任务触发执行', { scheduleId: `${scheduleId}-${index}`, time });
        void executeScheduledTaskFromCron(taskFlow, `${scheduleId}-${index}`);
      }, cronOptions);

      jobs.push({ time, job });
    } catch (error) {
      failedTimes.push(time);
      logger.error('定时任务设置失败', {
        scheduleId: `${scheduleId}-${index}`,
        time,
        error: getErrorMessage(error)
      });
    }
  });

  if (jobs.length > 0) {
    scheduledJobs.set(scheduleId, jobs);
    logger.info('定时任务已设置', {
      scheduleId,
      count: jobs.length,
      times: jobs.map(job => job.time).join(', ')
    });
    return {
      success: true,
      message: `已设置 ${jobs.length} 个定时任务`,
      times: jobs.map(job => job.time)
    };
  }

  return { success: false, message: '没有成功设置任何定时任务' };
}

// 停止定时任务
export function stopSchedule(scheduleId: string) {
  const jobs = scheduledJobs.get(scheduleId);
  if (jobs) {
    jobs.forEach(({ job }) => job.stop());
    scheduledJobs.delete(scheduleId);
    logger.debug('定时任务已停止', {
      scheduleId,
      count: jobs.length,
      times: jobs.map(job => job.time).join(', ')
    });
    return { success: true, message: '定时任务已停止' };
  }
  return { success: false, message: '没有找到该定时任务' };
}

// 获取所有定时任务状态
export function getScheduleStatus() {
  const status: ScheduleStateEntry[] = [];
  scheduledJobs.forEach((jobs, scheduleId) => {
    status.push({
      scheduleId,
      times: jobs.map(job => job.time),
      count: jobs.length
    });
  });
  return status;
}

// 立即执行一次定时任务（用于测试）
export async function executeScheduleNow(scheduleId: string, taskFlow: unknown, lifecycle: ScheduleLifecycle = {}) {
  logger.info('手动触发执行', { scheduleId });
  return await executeTaskFlow(taskFlow, scheduleId, lifecycle);
}

// 自动更新任务
export function setupAutoUpdate(config: unknown, clientType?: string) {
  const configRecord = isRecord(config) ? config : {};
  const enabled = Boolean(configRecord.enabled);
  const time = typeof configRecord.time === 'string' ? configRecord.time : '';
  const updateCore = Boolean(configRecord.updateCore);
  const updateCli = Boolean(configRecord.updateCli);

  // 先停止已存在的自动更新任务（静默停止）
  const existingJobs = scheduledJobs.get('auto-update');
  if (existingJobs) {
    existingJobs.forEach(({ job }) => job.stop());
    scheduledJobs.delete('auto-update');
  }

  if (!enabled || !time) {
    return { success: false, message: '自动更新未启用' };
  }

  // 解析时间 (HH:MM)
  const [hour, minute] = time.split(':');
  if (!hour || !minute) {
    return { success: false, message: '时间格式错误' };
  }

  // 创建 cron 表达式: 分 时 * * *
  const cronExpression = `${minute} ${hour} * * *`;
  const cronOptions = {
    scheduled: true,
    timezone: gameTimeZoneForClientType(clientType)
  };

  try {
    const job = cron.schedule(cronExpression, async () => {
      logger.info('自动更新触发执行', { time });

      try {
        await withMaaExecutionLease({ source: 'auto-update', taskName: '自动更新 MAA', command: 'update' }, async () => {
          if (updateCore) {
            logger.info('开始更新 MaaCore 与资源');
            // `maa update` already refreshes MaaCore, base resources, the
            // configured resource source, and hot-update files.
            await execMaaCommand('update', []);
            logger.success('MaaCore 与资源更新完成');
          }

          if (updateCli) {
            logger.info('开始更新 MAA CLI');

            // 检查是否在 Docker 环境
            const isDocker = process.env.NODE_ENV === 'production' &&
              await execAsync('test -f /.dockerenv').then(() => true).catch(() => false);

            if (isDocker) {
              // Docker 环境：支持更新，更新会持久化
              if (await canUseMaaSelfUpdate()) {
                try {
                  await execAsync(`${MAA_CLI_PATH} self update`);
                  logger.success('MAA CLI 更新完成', { environment: 'Docker', persistent: true });
                } catch (error) {
                  logger.error('MAA CLI 更新失败', { error: getErrorMessage(error) });
                }
              } else {
                logger.warn('当前 maa-cli 构建没有 self 子命令，跳过 CLI 更新');
              }
            } else {
              // 根据操作系统选择更新方式
              const os = await import('os');
              const platform = os.platform();

              if (platform === 'darwin') {
                await execAsync('brew upgrade maa-cli');
                logger.success('MAA CLI 更新完成', { platform });
              } else if ((platform === 'linux' || platform === 'win32') && await canUseMaaSelfUpdate()) {
                await execAsync(`${MAA_CLI_PATH} self update`);
                logger.success('MAA CLI 更新完成', { platform });
              } else {
                logger.warn('当前 maa-cli 构建没有 self 子命令，跳过 CLI 更新', { platform });
              }
            }
          }

          logger.success('所有自动更新任务完成');
        });
      } catch (error) {
        logger.error('自动更新失败', { error: getErrorMessage(error) });
      }
    }, cronOptions);

    scheduledJobs.set('auto-update', [{ time, job }]);
    logger.info('自动更新已设置', { time });

    return {
      success: true,
      message: `自动更新已设置，每天 ${time} 执行`,
      config
    };
  } catch (error) {
    logger.error('自动更新设置失败', { error: getErrorMessage(error) });
    return { success: false, message: `设置失败: ${getErrorMessage(error)}` };
  }
}

// 获取自动更新状态
export function getAutoUpdateStatus() {
  const jobs = scheduledJobs.get('auto-update');
  if (jobs && jobs.length > 0) {
    return {
      enabled: true,
      time: jobs[0].time
    };
  }
  return {
    enabled: false,
    time: null
  };
}

/**
 * 动态更新智能养成关卡
 * 在任务执行完成后，重新生成刷取计划并更新任务流程
 */
function getPlanOpenStages(plan: unknown = {}): SmartTrainingPlanStage[] {
  const planRecord = isRecord(plan) ? plan : {};
  const stages: unknown[] = Array.isArray(planRecord.openStages) && planRecord.openStages.length > 0
    ? planRecord.openStages
    : Array.isArray(planRecord.stages)
      ? planRecord.stages.filter(stage => !isRecord(stage) || stage.isOpen !== false)
      : [];

  return stages.filter((stage): stage is SmartTrainingPlanStage =>
    isRecord(stage) &&
    typeof stage.stage === 'string' &&
    Boolean(stage.stage) &&
    Number(stage.totalTimes ?? stage.times ?? 0) > 0
  );
}

function buildSmartTrainingStages(plan: unknown = {}): SmartTrainingStage[] {
  const planRecord = isRecord(plan) ? plan : {};
  const trainingOperatorNames = Array.isArray(planRecord.operators)
    ? planRecord.operators
      .map(operator => isRecord(operator) ? operator.name : undefined)
      .filter((name): name is string => typeof name === 'string' && Boolean(name))
    : [];

  return getPlanOpenStages(plan).map(stage => ({
    stage: String(stage.stage),
    times: String(stage.totalTimes ?? stage.times ?? 0),
    smart: true,
    trainingOperators: trainingOperatorNames
  }));
}

function replaceSmartTrainingStages(task: ScheduledTask, smartStages: SmartTrainingStage[] = []) {
  const currentStages = task.params.stages;
  const stageList: unknown[] = Array.isArray(currentStages) ? currentStages : [];
  const pinnedStages = stageList.filter(stage =>
    isRecord(stage) && Boolean(stage.pinned) && typeof stage.stage === 'string' && Boolean(stage.stage.trim()));
  const normalStages = stageList.filter(stage =>
    (typeof stage === 'string' && Boolean(stage.trim())) ||
    (isRecord(stage) && !stage.pinned && !stage.smart && typeof stage.stage === 'string' && Boolean(stage.stage.trim()))
  );

  task.params.stages = [...pinnedStages, ...smartStages, ...normalStages];
}

function clearSmartTrainingStagesFromTask(task: ScheduledTask) {
  const currentStages = task.params.stages;
  const stageList: unknown[] = Array.isArray(currentStages) ? currentStages : [];
  const newStages = stageList.filter(stage => !(isRecord(stage) && stage.smart));
  task.params.stages = newStages.length > 0 ? newStages : [{ stage: '', times: '' }];
}

async function updateSmartTrainingStages(scheduleId: string) {
  logger.info('智能养成开始动态更新关卡', { scheduleId });

  try {
    // 1. 加载当前的任务流程配置
    const configResult = await loadUserConfig('automation-tasks');
    const configData = configResult.success && isRecord(configResult.data) ? configResult.data : null;
    if (!configData || !configData.taskFlow) {
      logger.info('智能养成未找到任务流程配置，跳过更新', { scheduleId });
      return;
    }

    const taskFlow = configData.taskFlow as ScheduledTaskFlow;

    // 2. 查找包含智能养成关卡的任务
    let hasSmartStages = false;
    let fightTaskIndex = -1;

    for (let i = 0; i < taskFlow.length; i++) {
      const task = taskFlow[i];
      if (task.commandId === 'fight' && task.params && task.params.stages) {
        const stages = task.params.stages;
        const smartStages = Array.isArray(stages)
          ? stages.filter(stage => isRecord(stage) && Boolean(stage.smart))
          : [];
        if (smartStages.length > 0) {
          hasSmartStages = true;
          fightTaskIndex = i;
          break;
        }
      }
    }

    if (!hasSmartStages) {
      logger.info('智能养成未找到智能养成关卡，跳过更新', { scheduleId });
      return;
    }

    logger.info('智能养成找到智能养成关卡，开始重新生成刷取计划', { scheduleId });

    // 3. 加载养成队列
    const queueResult = await loadUserConfig('training-queue');
    const queueData = queueResult.success && isRecord(queueResult.data) ? queueResult.data : null;
    const queueValue = queueData?.queue;
    if (!queueData || !Array.isArray(queueValue) || queueValue.length === 0) {
      logger.info('智能养成队列为空，移除所有智能养成关卡', { scheduleId });

      const task = taskFlow[fightTaskIndex];
      clearSmartTrainingStagesFromTask(task);

      await saveUserConfig('automation-tasks', { taskFlow, schedule: configData.schedule });
      logger.success('智能养成已移除所有智能养成关卡', { scheduleId });
      return;
    }

    const queue = queueValue as TrainingQueueOperator[];
    const trainingSettings = queueData.settings || {};
    const shouldAutoSwitch = !isRecord(trainingSettings) || trainingSettings.autoSwitch !== false;

    // 4. 重新生成刷取计划（仅当前干员）
    const plan = await operatorTrainingService.generateTrainingPlan('current') as TrainingPlan | null;
    if (!plan || !Array.isArray(plan.stages)) {
      logger.warn('智能养成生成刷取计划失败', { scheduleId });
      return;
    }

    const openSmartStages = buildSmartTrainingStages(plan);

    // 5. 检查是否还有需要刷的关卡
    if (plan.stages.length === 0) {
      logger.info('智能养成当前干员材料已集齐，检查是否需要切换到下一个干员', { scheduleId });

      // 6. 自动切换到下一个干员
      if (shouldAutoSwitch && queue.length > 1) {
        // 移除第一个干员（已完成）
        const completedOperator = queue.shift()!;
        await saveUserConfig('training-queue', {
          ...queueData,
          queue,
          settings: trainingSettings,
          lastUpdated: new Date().toISOString()
        });
        logger.success('智能养成已切换到下一个干员', {
          scheduleId,
          completedOperator: completedOperator.name || completedOperator.operatorId,
          nextOperator: queue[0].name || queue[0].operatorId
        });

        // 重新生成刷取计划
        const newPlan = await operatorTrainingService.generateTrainingPlan('current') as TrainingPlan | null;
        const newSmartStages = buildSmartTrainingStages(newPlan || {});
        if (newPlan && Array.isArray(newPlan.stages) && newPlan.stages.length > 0 && newSmartStages.length > 0) {
          const task = taskFlow[fightTaskIndex];
          replaceSmartTrainingStages(task, newSmartStages);

          await saveUserConfig('automation-tasks', { taskFlow, schedule: configData.schedule });
          logger.success('智能养成已更新智能养成关卡', {
            scheduleId,
            operators: newSmartStages[0]?.trainingOperators || [],
            stageCount: newSmartStages.length
          });
        } else {
          const task = taskFlow[fightTaskIndex];
          clearSmartTrainingStagesFromTask(task);

          await saveUserConfig('automation-tasks', { taskFlow, schedule: configData.schedule });
          logger.info('智能养成新目标今天没有可刷关卡，已移除所有智能养成关卡', { scheduleId });
        }
      } else {
        logger.info('智能养成不切换到下一个干员，移除所有智能养成关卡', {
          scheduleId,
          autoSwitch: shouldAutoSwitch,
          queueLength: queue.length
        });

        const task = taskFlow[fightTaskIndex];
        clearSmartTrainingStagesFromTask(task);

        await saveUserConfig('automation-tasks', { taskFlow, schedule: configData.schedule });
        logger.success('智能养成已移除所有智能养成关卡', { scheduleId });
      }
    } else if (openSmartStages.length === 0) {
      logger.info('智能养成当前计划今天没有开放关卡，移除所有智能养成关卡', {
        scheduleId,
        stageCount: plan.stages.length
      });

      const task = taskFlow[fightTaskIndex];
      clearSmartTrainingStagesFromTask(task);

      await saveUserConfig('automation-tasks', { taskFlow, schedule: configData.schedule });
    } else {
      // 7. 还有关卡需要刷，更新关卡和次数
      logger.info('智能养成更新剩余关卡', {
        scheduleId,
        stageCount: openSmartStages.length
      });

      const task = taskFlow[fightTaskIndex];
      replaceSmartTrainingStages(task, openSmartStages);

      await saveUserConfig('automation-tasks', { taskFlow, schedule: configData.schedule });
      logger.success('智能养成已更新智能养成关卡', {
        scheduleId,
        stages: openSmartStages.map(stage => `${stage.stage}×${stage.times}`)
      });
    }

  } catch (error) {
    logger.error('智能养成动态更新失败', { scheduleId, error: getErrorMessage(error) });
    throw error;
  }
}
