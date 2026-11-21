/**
 * 执行关闭协调
 *
 * 运行时关闭中的执行收尾把“停止触发源之后的动作”集中到一处：
 * 1. 关闭执行准入闸门：Run 准入与设备租约都拒绝新执行（见 executionAdmissionService）；
 * 2. 只对本实例记录的活动 run 写入停止意图，并停止本进程当前的任务进程与流程；
 * 3. 在预算内等待执行器按实际结果结算；仍未结算的 run 记为 `interrupted`
 *    （`recovery.source=server_shutdown`），绝不写成成功；
 * 4. 在关闭返回前等待 Run 存储落盘；落盘失败让本步骤失败，由组装入口明确上报。
 *
 * 预算来自生命周期为关闭步骤分配的份额（`RuntimeLifecycleCloseContext.timeoutMs`），
 * 本模块只在该份额内等待，并预留一小段用于落盘。重复关闭由生命周期复用首次摘要，
 * 本步骤不会重复写入停止意图；部分停止失败只记录并继续其余收尾。
 */

import {
  installExecutionAdmissionGate
} from './executionAdmissionService.ts';
import type {
  ExecutionAdmissionGate,
  ExecutionAdmissionStatus
} from './executionAdmissionService.ts';
import {
  getActiveAgentRuns,
  interruptAgentRun,
  flushAgentRunStore,
  requestAgentRunStop
} from './agentRunService.ts';
import { requestCopilotSetRunStop } from './copilotSetRunService.ts';
import { getTaskStatus, stopCurrentTask } from './maaProcessService.ts';
import { releaseAllRoguelikeStopIntents } from './roguelikeStopIntentService.ts';
import { releaseAllRoguelikeProgressTrackers } from './roguelikeProgressTrackerService.ts';
import { getScheduleExecutionStatus, stopScheduleExecution } from './schedulerService.ts';
import type {
  RuntimeLifecycle,
  RuntimeLifecycleCloseContext,
  RuntimeLifecycleLogger
} from './runtimeLifecycleService.ts';

export interface ExecutionShutdownRun {
  runId: string;
  state: string;
  operationId: string;
}

export interface ExecutionShutdownRuntime {
  listActiveRuns(): ExecutionShutdownRun[];
  /** 记录停止意图；返回实际落到的处理方式（`stopping`/`canceled`/`terminal`） */
  requestRunStop(runId: string): { disposition: string };
  /** 作业集 run 先经过集合会话，避免留下可用于“继续下一关”的会话 */
  requestCopilotSetStop(runId: string): { disposition?: string } | null;
  interruptRun(runId: string, details: { reason: string; message: string }): { state?: string } | null;
  flushRunStore(): Promise<unknown>;
  stopDeviceTask(options: { forceKillDelayMs: number }): unknown;
  stopScheduleFlow(): unknown;
  releaseStopIntents(): void;
  releaseRoguelikeProgress(): void;
  isDeviceTaskRunning(): boolean;
  isScheduleRunning(): boolean;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface ExecutionShutdownSummary {
  reason: string;
  budgetMs: number;
  admission: ExecutionAdmissionStatus | null;
  stoppedRuns: Array<{ runId: string; disposition: string }>;
  interruptedRunIds: string[];
  deviceStopCalls: number;
  scheduleStopCalls: number;
  flush: { ok: boolean; error: string | null };
  errors: string[];
}

export interface ExecutionShutdownOptions {
  runtime?: Partial<ExecutionShutdownRuntime>;
  logger?: RuntimeLifecycleLogger;
  settleIntervalMs?: number;
  flushReserveMs?: number;
  forceKillDelayMs?: number;
  defaultDrainBudgetMs?: number;
}

export interface ExecutionShutdownService {
  readonly gate: ExecutionAdmissionGate;
  drain(context?: { reason?: string; timeoutMs?: number }): Promise<ExecutionShutdownSummary>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function positiveInteger(value: unknown, fallback: number): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.floor(normalized) : fallback;
}

function shutdownInterruptedMessage(): string {
  return '服务关闭时该执行未在截止时间内结束，已标记为中断且不会自动续跑';
}

function createDefaultRuntime(): ExecutionShutdownRuntime {
  return {
    listActiveRuns: () => getActiveAgentRuns().map(run => ({
      runId: run.runId,
      state: run.state,
      operationId: run.operationId
    })),
    requestRunStop: runId => ({ disposition: requestAgentRunStop(runId).disposition }),
    requestCopilotSetStop: runId => {
      const outcome = requestCopilotSetRunStop(runId);
      return outcome ? { disposition: outcome.disposition } : null;
    },
    interruptRun: (runId, details) => interruptAgentRun(runId, details),
    flushRunStore: () => flushAgentRunStore(),
    stopDeviceTask: ({ forceKillDelayMs }) => stopCurrentTask({ forceKillDelayMs }),
    stopScheduleFlow: () => stopScheduleExecution(),
    releaseStopIntents: () => releaseAllRoguelikeStopIntents(),
    releaseRoguelikeProgress: () => releaseAllRoguelikeProgressTrackers(),
    isDeviceTaskRunning: () => Boolean(getTaskStatus().isRunning),
    isScheduleRunning: () => Boolean(getScheduleExecutionStatus().isRunning),
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => { setTimeout(resolve, ms); })
  };
}

export function createExecutionShutdownService(
  options: ExecutionShutdownOptions = {}
): ExecutionShutdownService {
  const runtime: ExecutionShutdownRuntime = { ...createDefaultRuntime(), ...options.runtime };
  const logger: RuntimeLifecycleLogger = options.logger ?? console;
  const settleIntervalMs = positiveInteger(options.settleIntervalMs, 25);
  const flushReserveMs = positiveInteger(options.flushReserveMs, 300);
  const forceKillDelayMs = positiveInteger(options.forceKillDelayMs, 1500);
  const defaultDrainBudgetMs = positiveInteger(options.defaultDrainBudgetMs, 10_000);
  // 只保留本实例的闸门；重复挂接同一生命周期由 attach 去重。
  const gate = installExecutionAdmissionGate();

  function requestStop(run: ExecutionShutdownRun): string {
    if (run.operationId === 'run_copilot_set') {
      const outcome = runtime.requestCopilotSetStop(run.runId);
      // `running` 表示集合仍在执行，只能记录停止意图，由集合循环在下一项前退出。
      if (outcome && outcome.disposition !== 'running') return outcome.disposition || 'stopped';
    }
    return runtime.requestRunStop(run.runId).disposition;
  }

  async function drain(
    context: { reason?: string; timeoutMs?: number } = {}
  ): Promise<ExecutionShutdownSummary> {
    const reason = context.reason || 'shutdown';
    const budgetMs = context.timeoutMs !== undefined && Number.isFinite(context.timeoutMs) && context.timeoutMs >= 0
      ? Math.floor(context.timeoutMs)
      : defaultDrainBudgetMs;
    const startedAt = runtime.now();
    const deadlineAt = startedAt + budgetMs;
    // 预留落盘时间：等待只在 deadlineAt 之前结束，落盘本身仍受生命周期步骤超时约束。
    const reserveMs = Math.min(flushReserveMs, Math.floor(budgetMs / 3));
    const waitUntil = deadlineAt - reserveMs;

    const admission = gate.close(reason);
    const errorMessages = new Set<string>();
    const recordError = (message: string) => { errorMessages.add(message); };
    try {
      runtime.releaseStopIntents();
    } catch (error) {
      recordError(`释放等待战斗结束的停止意图失败: ${describeError(error)}`);
    }
    try {
      runtime.releaseRoguelikeProgress();
    } catch (error) {
      recordError(`释放肉鸽进度跟踪失败: ${describeError(error)}`);
    }
    const stoppedRuns: Array<{ runId: string; disposition: string }> = [];
    const seenRunIds = new Set<string>();
    const deviceStopRunIds = new Set<string>();
    const interruptedRunIds: string[] = [];
    let deviceStopCalls = 0;
    let scheduleStopCalls = 0;
    let lastDeviceStopAt = Number.NEGATIVE_INFINITY;

    function readActiveRuns(): ExecutionShutdownRun[] {
      try {
        return runtime.listActiveRuns();
      } catch (error) {
        recordError(`读取活动执行失败: ${describeError(error)}`);
        return [];
      }
    }

    function safeIsDeviceTaskRunning(): boolean {
      try {
        return runtime.isDeviceTaskRunning();
      } catch (error) {
        recordError(`读取任务进程状态失败: ${describeError(error)}`);
        return false;
      }
    }

    function safeIsScheduleRunning(): boolean {
      try {
        return runtime.isScheduleRunning();
      } catch (error) {
        recordError(`读取流程状态失败: ${describeError(error)}`);
        return false;
      }
    }

    while (true) {
      const active = readActiveRuns();
      for (const run of active) {
        if (seenRunIds.has(run.runId)) continue;
        seenRunIds.add(run.runId);
        try {
          const disposition = requestStop(run);
          stoppedRuns.push({ runId: run.runId, disposition });
        } catch (error) {
          recordError(`记录执行停止意图失败 ${run.runId}: ${describeError(error)}`);
        }
      }

      const runningRunIds = active
        .filter(run => run.state === 'running' || run.state === 'stopping')
        .map(run => run.runId);
      const newRunningRunIds = runningRunIds.filter(runId => !deviceStopRunIds.has(runId));
      const deviceTaskRunning = safeIsDeviceTaskRunning();
      const scheduleRunning = safeIsScheduleRunning();
      // 新出现的执行立即停止；没有 Run 身份的进程/流程（Telegram 指令、维护更新）
      // 在首次观察时停止，之后按 300ms 节流重试，避免每个轮询都重复发信号。
      const throttleElapsed = runtime.now() - lastDeviceStopAt >= 300;
      const needsDeviceStop = newRunningRunIds.length > 0
        || ((deviceTaskRunning || scheduleRunning) && throttleElapsed);

      if (needsDeviceStop) {
        for (const runId of newRunningRunIds) deviceStopRunIds.add(runId);
        lastDeviceStopAt = runtime.now();
        const remaining = Math.max(0, waitUntil - runtime.now());
        // 任务进程先 SIGTERM；预算不足时提前升级 SIGKILL，避免退出后遗留 detach 子进程。
        const killDelay = Math.max(100, Math.min(forceKillDelayMs, Math.floor(remaining / 2) || 100));
        try {
          runtime.stopDeviceTask({ forceKillDelayMs: killDelay });
          deviceStopCalls += 1;
        } catch (error) {
          recordError(`停止任务进程失败: ${describeError(error)}`);
        }
        if (scheduleRunning) {
          try {
            runtime.stopScheduleFlow();
            scheduleStopCalls += 1;
          } catch (error) {
            recordError(`停止任务流程失败: ${describeError(error)}`);
          }
        }
      }

      if (active.length === 0
        && !safeIsDeviceTaskRunning()
        && !safeIsScheduleRunning()) {
        break;
      }
      if (runtime.now() >= waitUntil) break;
      await runtime.sleep(Math.min(settleIntervalMs, Math.max(1, waitUntil - runtime.now())));
    }

    // 预算耗尽：剩余活动 run 按中断记录；这不是成功，也不自动续跑。
    // `recovery.source` 使用稳定的 `server_shutdown`，具体触发原因保留在关闭摘要中。
    for (const run of readActiveRuns()) {
      try {
        const interrupted = runtime.interruptRun(run.runId, {
          reason: 'server_shutdown',
          message: shutdownInterruptedMessage()
        });
        if (!interrupted || interrupted.state === 'interrupted') interruptedRunIds.push(run.runId);
      } catch (error) {
        recordError(`记录执行中断失败 ${run.runId}: ${describeError(error)}`);
      }
    }

    let flush: { ok: boolean; error: string | null } = { ok: true, error: null };
    try {
      await runtime.flushRunStore();
    } catch (error) {
      flush = { ok: false, error: describeError(error) };
      recordError(`Run 持久化失败: ${flush.error}`);
    }

    const summary: ExecutionShutdownSummary = {
      reason,
      budgetMs,
      admission,
      stoppedRuns,
      interruptedRunIds,
      deviceStopCalls,
      scheduleStopCalls,
      flush,
      errors: [...errorMessages]
    };

    if (errorMessages.size > 0) {
      logger.error?.('执行关闭未完全成功', {
        reason,
        interruptedRunIds,
        flush,
        errors: [...errorMessages]
      });
    } else {
      logger.info?.('执行关闭已完成', {
        reason,
        budgetMs,
        stoppedRuns: stoppedRuns.length,
        interruptedRunIds,
        deviceStopCalls,
        durationMs: runtime.now() - startedAt
      });
    }
    return summary;
  }

  return { gate, drain };
}

const attachedLifecycles = new WeakMap<RuntimeLifecycle, ExecutionShutdownService>();

/**
 * 把执行关闭步骤接入运行时生命周期。步骤在组装期注册，关闭时先于传输与预览执行，
 * 晚于运行时初始化注册的触发源/轮询停止步骤（关闭按注册逆序进行）。
 */
export function attachExecutionShutdownToLifecycle(
  lifecycle: RuntimeLifecycle,
  options: ExecutionShutdownOptions = {}
): { attached: boolean; duplicate: boolean; service: ExecutionShutdownService | null } {
  if (!lifecycle || typeof lifecycle.register !== 'function') {
    return { attached: false, duplicate: false, service: null };
  }
  const existing = attachedLifecycles.get(lifecycle);
  if (existing) return { attached: true, duplicate: true, service: existing };

  const service = createExecutionShutdownService(options);
  lifecycle.register({
    name: 'execution-shutdown',
    close: async (context: RuntimeLifecycleCloseContext) => {
      const summary = await service.drain({
        reason: context?.reason,
        timeoutMs: context?.timeoutMs
      });
      if (summary.errors.length > 0) {
        throw new Error(`执行关闭未完全成功: ${summary.errors.join('; ')}`);
      }
      return summary;
    }
  });
  attachedLifecycles.set(lifecycle, service);
  return { attached: true, duplicate: false, service };
}
