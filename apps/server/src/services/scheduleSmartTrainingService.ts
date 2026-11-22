import { loadUserConfig, saveUserConfig } from './configStorageService.ts';
import type { ConfigStorageResult } from './configStorageService.ts';
import operatorTrainingService from './operatorTrainingService.ts';
import type { TrainingPlan } from './operatorTrainingPlan.ts';
import type { ScheduledTask, ScheduledTaskParams } from './scheduleFlowPlan.ts';
import { resolveConnection } from './connectionService.ts';
import { createLogger } from '../utils/logger.ts';

// 流程结束后的智能养成关卡回写：读取养成队列、生成刷取计划并保存任务流程。
// 这是流程执行之外的存储适配，执行模块只通过端口请求刷新，不直接读写配置。
// 计划生成沿用连接 profile 的客户端类型，智能关卡与执行跳过按同一游戏日挑选。

const logger = createLogger('Scheduler');

export interface SmartTrainingStageSource {
  stage?: string;
  times?: unknown;
  totalTimes?: unknown;
  isOpen?: unknown;
}

export interface SmartTrainingPlanSource {
  openStages?: SmartTrainingStageSource[];
  stages?: SmartTrainingStageSource[];
  operators?: Array<{ name?: string }>;
}

export interface SmartTrainingStage {
  stage: string;
  times: string;
  smart: true;
  trainingOperators: string[];
  [extension: string]: unknown;
}

/** 只要求 params 的写入目标；调用方已确认是 fight 任务。 */
export interface SmartTrainingTask {
  params: ScheduledTaskParams;
}

export interface SmartTrainingLogger {
  info(message: string, data?: unknown): unknown;
  warn(message: string, data?: unknown): unknown;
  error(message: string, data?: unknown): unknown;
  success(message: string, data?: unknown): unknown;
}

export interface SmartTrainingPlanOptions {
  clientType?: string;
}

export interface SmartTrainingUpdateDependencies {
  loadConfig?: (configType: string) => Promise<ConfigStorageResult<unknown>>;
  saveConfig?: (configType: string, data: unknown) => Promise<ConfigStorageResult<null>>;
  /** 连接 profile 的客户端类型；缺省读取当前连接，失败时返回 undefined。 */
  resolveClientType?: () => Promise<string | undefined>;
  generateTrainingPlan?: (mode: string, options?: SmartTrainingPlanOptions) => Promise<TrainingPlan>;
  runtimeLogger?: SmartTrainingLogger;
}

/** 连接解析失败时按默认客户端生成计划，不阻断流程回写。 */
async function resolvePlanClientType(): Promise<string | undefined> {
  try {
    return (await resolveConnection()).clientType;
  } catch (error) {
    logger.warn('读取连接配置失败，智能养成按默认客户端生成计划', {
      error: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getPlanOpenStages(
  plan: SmartTrainingPlanSource = {}
): Array<SmartTrainingStageSource & { stage: string }> {
  const stages: SmartTrainingStageSource[] = Array.isArray(plan.openStages)
    ? plan.openStages
    : Array.isArray(plan.stages)
      ? plan.stages.filter(stage => stage?.isOpen !== false)
      : [];

  return stages.filter((stage): stage is SmartTrainingStageSource & { stage: string } => (
    Boolean(stage?.stage) && Number(stage.totalTimes ?? stage.times ?? 0) > 0
  ));
}

export function buildSmartTrainingStages(plan: SmartTrainingPlanSource = {}): SmartTrainingStage[] {
  const trainingOperatorNames = Array.isArray(plan.operators)
    ? plan.operators.map(op => op.name).filter((name): name is string => Boolean(name))
    : [];

  return getPlanOpenStages(plan).map(stage => ({
    stage: stage.stage,
    times: String(stage.totalTimes ?? stage.times ?? 0),
    smart: true,
    trainingOperators: trainingOperatorNames
  }));
}

export function replaceSmartTrainingStages(task: SmartTrainingTask, smartStages: SmartTrainingStage[] = []) {
  const currentStages = task.params.stages || [];
  const pinnedStages = currentStages.filter(s => typeof s === 'object' && s.pinned && s.stage && s.stage.trim());
  const normalStages = currentStages.filter(s =>
    (typeof s === 'string' && s.trim()) ||
    (typeof s === 'object' && !s.pinned && !s.smart && s.stage && s.stage.trim())
  );

  task.params.stages = [...pinnedStages, ...smartStages, ...normalStages];
}

export function clearSmartTrainingStagesFromTask(task: SmartTrainingTask) {
  const currentStages = task.params.stages || [];
  const newStages = currentStages.filter(s => !(typeof s === 'object' && s.smart));
  task.params.stages = newStages.length > 0 ? newStages : [{ stage: '', times: '' }];
}

export async function updateSmartTrainingStages(
  scheduleId: string,
  {
    loadConfig = loadUserConfig,
    saveConfig = saveUserConfig,
    // 客户端类型读取可注入，测试不需要真实连接 profile。
    resolveClientType = resolvePlanClientType,
    generateTrainingPlan = async (mode: string, options: SmartTrainingPlanOptions = {}) => {
      const clientType = options.clientType ?? await resolveClientType();
      return operatorTrainingService.generateTrainingPlan(mode, { clientType });
    },
    runtimeLogger = logger
  }: SmartTrainingUpdateDependencies = {}
): Promise<void> {
  runtimeLogger.info('智能养成开始动态更新关卡', { scheduleId });

  try {
    const configResult = await loadConfig('automation-tasks');
    const configData = configResult.success && isRecordValue(configResult.data) ? configResult.data : null;
    if (!configData || !configData.taskFlow) {
      runtimeLogger.info('智能养成未找到任务流程配置，跳过更新', { scheduleId });
      return;
    }

    const taskFlow: ScheduledTask[] = Array.isArray(configData.taskFlow)
      ? configData.taskFlow as ScheduledTask[]
      : [];

    let fightTaskIndex = -1;

    for (let i = 0; i < taskFlow.length; i++) {
      const task = taskFlow[i];
      if (task.commandId === 'fight' && task.params?.stages) {
        const stages = task.params.stages;
        const smartStages = stages.filter(s => typeof s === 'object' && s.smart);
        if (smartStages.length > 0) {
          fightTaskIndex = i;
          break;
        }
      }
    }

    if (fightTaskIndex < 0) {
      runtimeLogger.info('智能养成未找到智能养成关卡，跳过更新', { scheduleId });
      return;
    }

    runtimeLogger.info('智能养成找到智能养成关卡，开始重新生成刷取计划', { scheduleId });

    const queueResult = await loadConfig('training-queue');
    const queueData = queueResult.success && isRecordValue(queueResult.data) ? queueResult.data : null;
    const queue: Array<Record<string, unknown>> = queueData && Array.isArray(queueData.queue)
      ? queueData.queue as Array<Record<string, unknown>>
      : [];

    if (!queueData || !queueData.queue || queue.length === 0) {
      runtimeLogger.info('智能养成队列为空，移除所有智能养成关卡', { scheduleId });

      const task = taskFlow[fightTaskIndex];
      clearSmartTrainingStagesFromTask(task);

      await saveConfig('automation-tasks', { taskFlow, schedule: configData.schedule });
      runtimeLogger.success('智能养成已移除所有智能养成关卡', { scheduleId });
      return;
    }

    const trainingSettings = queueData.settings || {};
    const shouldAutoSwitch = isRecordValue(trainingSettings) ? trainingSettings.autoSwitch !== false : true;

    const plan = await generateTrainingPlan('current');
    if (!plan || !plan.stages) {
      runtimeLogger.warn('智能养成生成刷取计划失败', { scheduleId });
      return;
    }

    const openSmartStages = buildSmartTrainingStages(plan);

    if (plan.stages.length === 0) {
      runtimeLogger.info('智能养成当前干员材料已集齐，检查是否需要切换到下一个干员', { scheduleId });

      if (shouldAutoSwitch && queue.length > 1) {
        const completedOperator: Record<string, unknown> = queue.shift() || {};
        await saveConfig('training-queue', {
          ...queueData,
          queue,
          settings: trainingSettings,
          lastUpdated: new Date().toISOString()
        });
        runtimeLogger.success('智能养成已切换到下一个干员', {
          scheduleId,
          completedOperator: completedOperator.name || completedOperator.operatorId,
          nextOperator: queue[0].name || queue[0].operatorId
        });

        const newPlan = await generateTrainingPlan('current');
        const newSmartStages = buildSmartTrainingStages(newPlan || {});
        if (newPlan && newPlan.stages && newPlan.stages.length > 0 && newSmartStages.length > 0) {
          const task = taskFlow[fightTaskIndex];
          replaceSmartTrainingStages(task, newSmartStages);

          await saveConfig('automation-tasks', { taskFlow, schedule: configData.schedule });
          runtimeLogger.success('智能养成已更新智能养成关卡', {
            scheduleId,
            operators: newSmartStages[0]?.trainingOperators || [],
            stageCount: newSmartStages.length
          });
        } else {
          const task = taskFlow[fightTaskIndex];
          clearSmartTrainingStagesFromTask(task);

          await saveConfig('automation-tasks', { taskFlow, schedule: configData.schedule });
          runtimeLogger.info('智能养成新目标今天没有可刷关卡，已移除所有智能养成关卡', { scheduleId });
        }
      } else {
        runtimeLogger.info('智能养成不切换到下一个干员，移除所有智能养成关卡', {
          scheduleId,
          autoSwitch: shouldAutoSwitch,
          queueLength: queue.length
        });

        const task = taskFlow[fightTaskIndex];
        clearSmartTrainingStagesFromTask(task);

        await saveConfig('automation-tasks', { taskFlow, schedule: configData.schedule });
        runtimeLogger.success('智能养成已移除所有智能养成关卡', { scheduleId });
      }
    } else if (openSmartStages.length === 0) {
      runtimeLogger.info('智能养成当前计划今天没有开放关卡，移除所有智能养成关卡', {
        scheduleId,
        stageCount: plan.stages.length
      });

      const task = taskFlow[fightTaskIndex];
      clearSmartTrainingStagesFromTask(task);

      await saveConfig('automation-tasks', { taskFlow, schedule: configData.schedule });
    } else {
      runtimeLogger.info('智能养成更新剩余关卡', {
        scheduleId,
        stageCount: openSmartStages.length
      });

      const task = taskFlow[fightTaskIndex];
      replaceSmartTrainingStages(task, openSmartStages);

      await saveConfig('automation-tasks', { taskFlow, schedule: configData.schedule });
      runtimeLogger.success('智能养成已更新智能养成关卡', {
        scheduleId,
        stages: openSmartStages.map(s => `${s.stage}×${s.times}`)
      });
    }

  } catch (error) {
    runtimeLogger.error('智能养成动态更新失败', { scheduleId, error: errorMessageOf(error) });
    throw error;
  }
}
