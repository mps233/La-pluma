/**
 * 应用计划会分别写自动化任务配置、训练队列中的应用标记与默认定时任务，三者可独立失败；
 * 调用方必须能识别部分成功：配置与队列已落盘但定时注册失败时仍返回 success，并以
 * `scheduleSync.attempted=true, success=false` 单独上报；自动同步只改智能关卡，不重注册定时任务。
 */

import { createLogger } from '../utils/logger.ts';
import {
  getApplicableStages,
  isRecord,
  normalizeTrainingSettings,
  trainingError
} from './operatorTrainingModel.ts';
import type { TrainingFlowMode } from './operatorTrainingModel.ts';
import {
  getQueueRevision,
  isCombatStageObject,
  loadTrainingQueue,
  parseCombatTasksConfig,
  readCombatTasksConfig,
  saveTrainingQueue,
  updateCombatTasksConfig
} from './operatorTrainingStore.ts';
import type {
  CombatStageObject,
  CombatTask,
  CombatTaskStage,
  CombatTasksConfig,
  TrainingFlowBinding,
  TrainingQueueData
} from './operatorTrainingStore.ts';
import { generateTrainingPlan, resolveTrainingPlanApplyContext } from './operatorTrainingPlan.ts';
import { resolveConnection } from './connectionService.ts';

const logger = createLogger('OperatorTraining');

export type FlowSyncStatus = 'synced' | 'not_applied' | 'failed';

export interface FlowSyncState {
  status: FlowSyncStatus;
  flowName: string;
  taskName: string;
  mode?: TrainingFlowMode;
  error?: string;
  syncedRevision?: string;
}

/** 定时任务同步结果：attempted=false 表示本次没有重注册定时任务。 */
export interface ScheduleSyncResult {
  attempted: boolean;
  success: boolean;
  message: string | null;
  missingTimes?: string[];
}

export interface FlowTarget {
  config: CombatTasksConfig;
  task?: CombatTask;
  taskIndex: number;
  applied: boolean;
  flowName: string;
  taskName: string;
}

export interface ApplyPlanOptions {
  queueData?: TrainingQueueData;
  automatic?: boolean;
  target?: FlowTarget;
  refreshSchedule?: ((config: CombatTasksConfig) => Promise<ScheduleSyncResult>) | null;
  clientType?: string;
  now?: Date;
}

/** 计划应用成功的结果；定时注册失败仍返回 success=true 并单独标记。 */
export interface ApplyPlanResult {
  success: true;
  stageCount: number;
  totalStages: number;
  hasFallback: boolean;
  flowName: string;
  taskName: string;
  flowSync: FlowSyncState;
  scheduleSync: ScheduleSyncResult;
}

/** 队列已落盘但流程同步单独上报的结果。 */
export interface QueueSyncSummary {
  queueUpdated: boolean;
  queueRevision: string;
  flowSync: FlowSyncState;
}

export interface QueueMutationResult extends QueueSyncSummary {
  queueUpdated: true;
}

/** 手动或自动同步的返回；自动同步会带上完整的计划应用字段。 */
export type TrainingFlowSyncResult = QueueSyncSummary | (ApplyPlanResult & QueueSyncSummary);

interface FlowSyncTarget {
  applied: boolean;
  flowName: string;
  taskName: string;
}

interface AppliedFightTask {
  config: CombatTasksConfig;
  fightTask: CombatTask;
  smartStages: CombatStageObject[];
  newStages: CombatTaskStage[];
  flowName: string;
}

async function getFlowTarget(
  queueData: TrainingQueueData,
  config: CombatTasksConfig | null = null
): Promise<FlowTarget> {
  config ??= await readCombatTasksConfig();
  const tasks = config.taskFlow;
  const binding = queueData.trainingFlow;
  const boundTask = binding?.taskId
    ? tasks.find(task => task.id === binding.taskId && task.commandId === 'fight') ?? null
    : null;
  const smartTask = tasks.find(task =>
    task.commandId === 'fight' &&
    task.params?.stages?.some(stage => isCombatStageObject(stage) && Boolean(stage.smart))
  );
  const task = binding ? boundTask : smartTask || tasks.find(candidate => candidate.commandId === 'fight');
  return {
    config,
    task: task ?? undefined,
    taskIndex: task ? tasks.indexOf(task) : -1,
    applied: Boolean(binding || smartTask),
    flowName: config.name || config.flowName || '自动任务',
    taskName: task?.name || binding?.taskName || '理智作战'
  };
}

function flowSyncStatus(queueData: TrainingQueueData, target: FlowSyncTarget): FlowSyncState {
  return {
    status: target.applied ? (queueData.trainingFlow?.status || 'synced') : 'not_applied',
    flowName: target.flowName,
    taskName: target.taskName,
    mode: queueData.trainingFlow?.mode || 'current',
    ...(queueData.trainingFlow?.error ? { error: queueData.trainingFlow.error } : {}),
    ...(queueData.trainingFlow?.syncedRevision
      ? { syncedRevision: queueData.trainingFlow.syncedRevision }
      : {})
  };
}

export async function getQueueFlowSync(queueData: TrainingQueueData): Promise<FlowSyncState> {
  try {
    const target = await getFlowTarget(queueData);
    if (target.applied && !target.task) {
      return { ...flowSyncStatus(queueData, target), status: 'failed', error: '已应用的作战任务已被移除，请重新应用计划' };
    }
    if (queueData.flowSyncError) {
      return { ...flowSyncStatus(queueData, target), status: 'failed', error: queueData.flowSyncError };
    }
    return flowSyncStatus(queueData, target);
  } catch (error) {
    return {
      status: 'failed',
      flowName: queueData.trainingFlow?.flowName || '自动任务',
      taskName: queueData.trainingFlow?.taskName || '理智作战',
      error: errorMessage(error)
    };
  }
}

/** Synchronize only a flow the user has already applied training to. */
export async function syncTrainingFlow(queueData: TrainingQueueData | null = null): Promise<TrainingFlowSyncResult> {
  queueData ??= await loadTrainingQueue();
  const queueRevision = getQueueRevision(queueData);
  try {
    const target = await getFlowTarget(queueData);
    if (!target.applied) {
      if (queueData.flowSyncError) {
        delete queueData.flowSyncError;
        await saveTrainingQueue(queueData);
      }
      return { queueUpdated: false, queueRevision, flowSync: flowSyncStatus(queueData, target) };
    }
    if (!target.task) throw new Error('已应用的作战任务已被移除，请重新应用计划');
    const mode: TrainingFlowMode = queueData.trainingFlow?.mode || 'current';
    const plan: unknown = queueData.queue.length > 0
      ? await generateTrainingPlan(mode)
      : { operators: [], stages: [], queueRevision, mode };
    const result = await applyPlanToTasks(plan, {}, { target, queueData, automatic: true });
    return { ...result, queueUpdated: false, queueRevision };
  } catch (error) {
    logger.error('队列已保存，但任务流程同步失败', { error: errorMessage(error) });
    queueData.flowSyncError = errorMessage(error);
    if (queueData.trainingFlow) queueData.trainingFlow.status = 'failed';
    // The queue mutation is already committed. Failure to persist the diagnostic
    // must not turn a recoverable flow failure into an apparent queue failure.
    await saveTrainingQueue(queueData).catch(saveError => {
      logger.error('保存流程同步状态失败', { error: errorMessage(saveError) });
    });
    return { queueUpdated: false, queueRevision, flowSync: await getQueueFlowSync(queueData) };
  }
}

export async function finishQueueMutation<T extends object = Record<string, never>>(
  queueData: TrainingQueueData,
  extra: T = {} as T
): Promise<QueueMutationResult & T> {
  await saveTrainingQueue(queueData);
  const result = await syncTrainingFlow(queueData);
  return { ...extra, ...result, queueUpdated: true } as QueueMutationResult & T;
}

/**
 * `setupSchedule` 在至少创建一个 job 时返回 success；某个时间点的 cron 创建失败只能靠
 * 比较请求时间与返回的 times 发现，缺失时间点按部分失败上报，让客户端保留计划并重试。
 */
const scheduleTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function summarizeScheduleSync(result: unknown, requestedTimes: unknown[]): ScheduleSyncResult {
  const record = isRecord(result) ? result : {};
  const appliedTimes = Array.isArray(record.times) ? record.times : [];
  // 与 setupSchedule 一致：忽略非法值与重复项，避免把持久化旧数据误报为缺失时间。
  const normalizedRequested = [...new Set(
    requestedTimes.filter((time): time is string =>
      typeof time === 'string' && scheduleTimePattern.test(time))
  )];
  const missingTimes = normalizedRequested.filter(time => !appliedTimes.includes(time));
  const baseMessage = typeof record.message === 'string' ? record.message : null;
  return {
    attempted: true,
    success: Boolean(record.success) && missingTimes.length === 0,
    message: missingTimes.length > 0
      ? `${baseMessage || '部分定时任务设置失败'}（未设置：${missingTimes.join('、')}）`
      : baseMessage,
    ...(missingTimes.length > 0 ? { missingTimes } : {})
  };
}

/**
 * 已注册的默认定时任务持有 setup 时的 taskFlow 快照，训练流程改写 automation-tasks 后
 * 必须重新注册，否则继续按旧关卡运行，但不会顺带创建未注册的定时任务。重新注册沿用当前
 * profile 的客户端类型，连接解析失败按默认客户端；动态 import 避免静态环。
 */
async function refreshRegisteredSchedule(config: CombatTasksConfig): Promise<ScheduleSyncResult> {
  const { getScheduleStatus, setupSchedule, stopSchedule } = await import('./schedulerService.ts');
  const registered = getScheduleStatus().some(entry => entry.scheduleId === 'default');
  if (!registered) return { attempted: false, success: true, message: null };

  const schedule = config.schedule;
  const times: unknown[] = Array.isArray(schedule?.times) ? schedule.times : [];
  if (schedule?.enabled && times.length > 0) {
    let clientType: string | undefined;
    try {
      clientType = (await resolveConnection()).clientType;
    } catch (error) {
      logger.warn('读取连接配置失败，定时任务按默认客户端时区重新注册', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    const result = setupSchedule(
      'default',
      times,
      Array.isArray(config?.taskFlow) ? config.taskFlow : [],
      clientType
    );
    return summarizeScheduleSync(result, times);
  }

  // 配置已不需要定时执行，但进程内仍有注册：同步停止，避免继续按旧流程运行。
  const result = stopSchedule('default');
  return { attempted: true, success: Boolean(result?.success), message: result?.message || null };
}

function readPlanOperatorNames(planRecord: Record<string, unknown>): string[] {
  if (!Array.isArray(planRecord.operators)) return [];
  const names: string[] = [];
  for (const operator of planRecord.operators) {
    if (isRecord(operator) && typeof operator.name === 'string') names.push(operator.name);
  }
  return names;
}

async function resolveApplyClientType(): Promise<string | undefined> {
  try {
    return (await resolveConnection()).clientType;
  } catch (error) {
    logger.warn('读取连接配置失败，养成计划按默认客户端校验', { error: errorMessage(error) });
    return undefined;
  }
}

export async function applyPlanToTasks(
  plan: unknown,
  settings: unknown = {},
  options: ApplyPlanOptions = {}
): Promise<ApplyPlanResult> {
  const queueData = options.queueData ?? await loadTrainingQueue();
  const planRecord = isRecord(plan) ? plan : null;
  const planRevision = planRecord?.queueRevision;
  if (typeof planRevision !== 'string' || !planRevision || planRevision !== getQueueRevision(queueData)) {
    throw trainingError('养成队列已变化，请重新生成计划后应用', 409);
  }

  const applyContext = await resolveTrainingPlanApplyContext(planRecord, {
    clientType: options.clientType ?? await resolveApplyClientType(),
    now: options.now
  });
  const staleReason = applyContext.gameDateMismatch
    ? 'game_day'
    : applyContext.clientTypeMismatch
      ? 'client_type'
      : applyContext.closedStages.length > 0
        ? 'stage_closed'
        : null;
  if (staleReason) {
    throw trainingError('养成计划已过期，请重新生成计划后应用', 409, {
      code: 'AGENT_TRAINING_PLAN_STALE',
      details: {
        reason: staleReason,
        gameDate: applyContext.gameDate,
        planGameDate: applyContext.planGameDate,
        clientType: applyContext.clientType,
        planClientType: applyContext.planClientType,
        closedStages: applyContext.closedStages
      }
    });
  }

  const effectiveSettings = normalizeTrainingSettings({
    ...queueData.settings,
    ...(isRecord(settings) ? settings : {})
  });
  const applicableStages = getApplicableStages(planRecord);
  const trainingOperatorNames = readPlanOperatorNames(planRecord ?? {});

  logger.info('开始应用养成计划');
  logger.debug('计划详情', {
    stageCount: Array.isArray(planRecord?.stages) ? planRecord.stages.length : 0,
    applicableStageCount: applicableStages.length,
    operatorCount: Array.isArray(planRecord?.operators) ? planRecord.operators.length : 0
  });

  try {
    let appliedResult!: AppliedFightTask;
    await updateCombatTasksConfig(async configValue => {
      const config = parseCombatTasksConfig(configValue);

      logger.debug('成功读取现有配置', { taskCount: config.taskFlow.length });

      config.taskFlow = Array.isArray(config.taskFlow) ? config.taskFlow : [];
      let fightTask: CombatTask | undefined;
      if (options.automatic) {
        const target = options.target;
        const targetTask = target?.task;
        if (!target || !targetTask) throw new Error('已应用的作战任务已被移除，请重新应用计划');
        fightTask = targetTask.id
          ? config.taskFlow.find(task => task.id === targetTask.id && task.commandId === 'fight')
          : config.taskFlow[target.taskIndex];
      } else {
        fightTask = (await getFlowTarget(queueData, config)).task;
      }
      if (options.automatic && (!fightTask || fightTask.commandId !== 'fight')) {
        throw new Error('已应用的作战任务已被移除，请重新应用计划');
      }

      if (!fightTask) {
        fightTask = {
          id: `fight-${Date.now()}`,
          name: queueData.trainingFlow?.taskName || '理智作战',
          description: '自动刷关卡消耗理智',
          commandId: 'fight',
          enabled: true,
          params: {
            stage: '1-7',
            stages: [],
            medicine: effectiveSettings.useMedicine || 0,
            medicineExpireDays: 0,
            stone: effectiveSettings.useStone || 0,
            series: 0
          }
        };
        config.taskFlow.push(fightTask);
        logger.info('创建了新的 fight 任务');
      }
      fightTask.id ||= `fight-${Date.now()}`;
      fightTask.params ||= {};

      const existingStages = fightTask.params.stages || [];
      const pinnedStages = existingStages.filter(stage => isCombatStageObject(stage) && stage.pinned && !stage.smart);
      const normalStages = existingStages.filter(stage => !isCombatStageObject(stage) || (!stage.pinned && !stage.smart));

      logger.debug('现有关卡分类', {
        total: existingStages.length,
        pinned: pinnedStages.length,
        normal: normalStages.length
      });

      const smartStages: CombatStageObject[] = [];

      logger.debug('养成干员', { operators: trainingOperatorNames });

      if (applicableStages.length > 0) {
        applicableStages.forEach(stage => {
          smartStages.push({
            stage: stage.stage,
            times: String(stage.totalTimes),
            smart: true,
            trainingOperators: trainingOperatorNames
          });
        });
        logger.info('生成智能关卡', { count: smartStages.length });
      }

      if (queueData.queue.length > 0 && effectiveSettings.fallbackStage && effectiveSettings.fallbackStage.trim()) {
        smartStages.push({
          stage: effectiveSettings.fallbackStage.trim(),
          times: (effectiveSettings.fallbackTimes || 999).toString(),
          smart: true,
          trainingOperators: trainingOperatorNames
        });
        logger.debug('添加 fallback 关卡', { stage: effectiveSettings.fallbackStage });
      }

      const newStages: CombatTaskStage[] = [...pinnedStages, ...smartStages, ...normalStages];

      logger.info('关卡重组完成', {
        totalStages: newStages.length,
        smartStages: smartStages.length
      });

      fightTask.params = {
        ...fightTask.params,
        stages: newStages,
        medicine: effectiveSettings.useMedicine || 0,
        medicineExpireDays: 0,
        stone: effectiveSettings.useStone || 0,
        series: fightTask.params.series || 0
      };

      appliedResult = {
        config,
        fightTask,
        smartStages,
        newStages,
        flowName: config.name || config.flowName || '自动任务'
      };
      return config;
    }, { taskFlow: [], schedule: { enabled: false, times: [] } });

    const { config, fightTask, smartStages, newStages, flowName } = appliedResult;
    const taskName = fightTask.name || '理智作战';
    const trainingFlow: TrainingFlowBinding = {
      taskId: fightTask.id,
      taskName,
      flowName,
      mode: planRecord?.mode === 'all' ? 'all' : 'current',
      status: 'synced',
      syncedRevision: getQueueRevision(queueData)
    };
    queueData.settings = effectiveSettings;
    queueData.trainingFlow = trainingFlow;
    delete queueData.flowSyncError;
    await saveTrainingQueue(queueData);

    // 配置与队列都已落盘；定时注册失败不回滚已生效的写入，而是作为部分失败上报，
    // 让客户端保留计划并重试。自动队列同步只改写智能关卡，不在此重注册定时任务。
    const refreshSchedule = options.refreshSchedule
      ?? (options.automatic ? null : refreshRegisteredSchedule);
    let scheduleSync: ScheduleSyncResult = { attempted: false, success: true, message: null };
    if (refreshSchedule) {
      try {
        scheduleSync = await refreshSchedule(config);
      } catch (error) {
        logger.error('定时任务刷新失败', { error: errorMessage(error) });
        scheduleSync = { attempted: true, success: false, message: errorMessage(error) };
      }
    }
    logger.success('养成计划应用成功');

    return {
      success: true,
      stageCount: smartStages.length,
      totalStages: newStages.length,
      hasFallback: queueData.queue.length > 0 && Boolean(effectiveSettings.fallbackStage),
      flowName,
      taskName,
      flowSync: flowSyncStatus(queueData, { applied: true, flowName, taskName }),
      scheduleSync
    };
  } catch (error) {
    logger.error('应用任务流程失败', { error: errorMessage(error) });
    throw new Error('应用任务流程失败');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
