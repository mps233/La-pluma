import { execMaaCommand, execDynamicTask, execDynamicTasks } from '../services/maaExecutionService.ts';
import { stopCurrentTask } from '../services/maaProcessService.ts';
import { executeScheduleNow, getScheduledTaskFlowPlan, stopScheduleExecution } from '../services/schedulerService.ts';
import { loadUserConfig } from '../services/configStorageService.ts';
import {
  createDailyFlowExecutionError,
  executePreflightAgentTask,
  normalizeCopilotQueueExecutionRequest,
  normalizeCopilotSetExecutionRequest,
  normalizeDailyFlowRequest,
  preflightAgentTaskRequest
} from '../services/agentActionService.ts';
import type {
  AgentTaskConfig,
  AgentTaskDependencies,
  CopilotQueueFailurePolicy,
  CopilotQueueMode,
  CopilotSetRaid,
  NormalizedAgentTaskRequest
} from '../services/agentActionService.ts';
import {
  acquireMaaExecutionLease,
  runWithMaaExecutionLeaseContext
} from '../services/executionCoordinatorService.ts';
import type { MaaExecutionLease, MaaExecutionLeaseRequest } from '../services/executionCoordinatorService.ts';
import {
  continueManualCopilotSet,
  hasCopilotSetSession,
  requestCopilotSetRunStop,
  runContinuousCopilotSet,
  startManualCopilotSet
} from '../services/copilotSetRunService.ts';
import type { CopilotSetLifecycle, CopilotSetPreparedInfo } from '../services/copilotSetRunService.ts';
import {
  assertCopilotQueueFilesReadable,
  continueManualCopilotQueue,
  hasCopilotQueueSession,
  requestCopilotQueueRunStop,
  requestCopilotQueueSkip,
  runContinuousCopilotQueue,
  startManualCopilotQueue
} from '../services/copilotQueueRunService.ts';
import type { CopilotQueueLifecycle, CopilotQueuePreparedInfo } from '../services/copilotQueueRunService.ts';
import type { CopilotExecutionLifecycle, CopilotQueueEntryInput } from '../services/copilotPlanService.ts';
import {
  beginAgentRun,
  startAgentRunForExecution,
  completeAgentRun,
  failAgentRun,
  stopAgentRun,
  requestAgentRunStop,
  getAgentRun,
  getCurrentAgentRun,
  releaseAgentRunIdempotency,
  setAgentRunAcceptedResult,
  flushAgentRunStore,
  withFlushedAgentRunSnapshot
} from '../services/agentRunService.ts';
import type { AgentRunDto, AgentRunStatus } from '../services/agentRunService.ts';
import type { ScheduleFlowExecutionResult } from '../services/scheduleFlowExecution.ts';
import { enrichAgentRun } from '../services/runSnapshotService.ts';
import {
  buildFightStagePlans,
  executeFightStages,
  normalizeFightStages
} from '../services/fightExecutionService.ts';
import type { FightRequestOptions, FightStageEntry } from '../services/fightExecutionService.ts';
import { validateGameTaskParams } from '../services/gameTaskConfigService.ts';
import {
  agentError,
  sendSuccess,
  sendDryRun,
  sendError
} from '../utils/apiHelper.ts';
import type { MaybeApiRequest } from '../utils/apiHelper.ts';
import { createMaaLogCheckpoint, readMaaLogSince } from '../services/maaLogFileService.ts';
import type { MaaLogCheckpoint } from '../services/maaLogFileService.ts';
import { RESOURCE_UPDATE_IN_PROGRESS_CODE } from '../services/resourceUpdateService.ts';
import {
  attachRoguelikeErrorSummary,
  attachRoguelikeResultSummary,
  buildRoguelikeResultSummary,
  isRoguelikeCommand
} from '../services/roguelikeResultService.ts';
import type { RoguelikeResultSummary } from '../services/roguelikeResultService.ts';
import {
  finalizeRoguelikeProgressTracker,
  releaseRoguelikeProgressTracker,
  startRoguelikeProgressTracker
} from '../services/roguelikeProgressTrackerService.ts';
import type { RoguelikeProgressTrackerInput } from '../services/roguelikeProgressTrackerService.ts';
import type { RoguelikeProgressSnapshot } from '../services/roguelikeProgressService.ts';
import {
  beginRoguelikeStopIntent,
  cancelRoguelikeStopIntent,
  releaseAllRoguelikeStopIntents
} from '../services/roguelikeStopIntentService.ts';
import type { RoguelikeStopIntent } from '../services/roguelikeStopIntentService.ts';
import { createLogger } from '../utils/logger.ts'
import { withExecutionLogContext } from '../utils/logContext.ts'
import { resolveRequestConnection } from './requestConnection.ts';
import {
  isRecord,
  isStopped,
  parseContinueRunId,
  parseRequestedRunId,
  parseStopRequestMode,
  parseWaitForCompletion,
  readField,
  readIdempotencyKey,
  resultMessage,
  textOf
} from './executionDto.ts';
import type {
  ExecutionCopilotQueueRequest,
  ExecutionCopilotSetRequest,
  ExecutionRequest,
  ExecutionResponseWriter,
  ExecutionRunPayload,
  ExecutionScheduleRequest,
  StopRequestMode
} from './executionDto.ts';

const logger = createLogger('AgentRoutes');

const ACTIVE_RUN_STATES: ReadonlySet<AgentRunStatus> = new Set<AgentRunStatus>(['accepted', 'waiting', 'running', 'stopping']);
const TERMINAL_RUN_STATES: ReadonlySet<AgentRunStatus> = new Set<AgentRunStatus>(['succeeded', 'failed', 'stopped', 'interrupted']);

export interface ExecutionOutcome {
  ok?: boolean;
  stopped?: boolean;
  result?: unknown;
  error?: unknown;
}

export interface TrackedExecutionLifecycle {
  onBeforeStart?(): void | Promise<void>;
  onStarted?(): void;
  onSettled?(outcome: ExecutionOutcome): void | Promise<void>;
}

export interface ExecutionStopPayload extends Record<string, unknown> {
  stopRequested: boolean;
  deviceStopRequested: boolean;
  run: AgentRunDto | null;
  task?: unknown;
  scheduleStopped?: boolean;
  acceptedRunCanceled?: boolean;
  waitingRunStopped?: boolean;
  alreadyTerminal?: boolean;
  alreadyStopping?: boolean;
  pendingStop?: RoguelikeStopIntent;
  alreadyPending?: boolean;
}

/** 响应文案可以是固定文本，或按实际结果生成；空结果回退到调用方兜底。 */
export type ExecutionMessage = string | ((result: unknown) => string | null | undefined);

export interface TrackedExecutionOptions {
  operationId: string;
  input: unknown;
  waitForCompletion?: boolean;
  metadata?: unknown;
  execute: (lifecycle: TrackedExecutionLifecycle, context: { runId: string }) => unknown | Promise<unknown>;
  successMessage?: ExecutionMessage;
  acceptedMessage?: ExecutionMessage;
  stoppedMessage?: ExecutionMessage;
  settleOnReturn?: boolean;
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setRunResponseHeaders(
  res: ExecutionResponseWriter,
  run: AgentRunDto,
  replayed: boolean,
  includeLocation = false
): void {
  const headers: Record<string, string> = {
    'X-La-Pluma-Run-Id': run.runId,
    'Idempotency-Replayed': String(Boolean(replayed))
  };
  if (includeLocation) headers.Location = run.links.self;

  for (const [name, value] of Object.entries(headers)) {
    if (typeof res.set === 'function') res.set(name, value);
    else if (typeof res.setHeader === 'function') res.setHeader(name, value);
  }
}

function runResponseData(result: unknown, run: AgentRunDto): ExecutionRunPayload {
  const base = isRecord(result) ? { ...result } : { result };
  return {
    ...base,
    runId: run.runId,
    state: run.state,
    pollUrl: run.links.self,
    stopUrl: run.links.stop,
    run
  };
}

interface SendRunSuccessOptions {
  message?: string;
  replayed?: boolean;
  accepted?: boolean;
}

function sendRunSuccess(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest,
  result: unknown,
  run: AgentRunDto,
  {
    message = '操作成功',
    replayed = false,
    accepted = false
  }: SendRunSuccessOptions = {}
): void {
  const enrichedRun: AgentRunDto = enrichAgentRun(run);
  setRunResponseHeaders(res, enrichedRun, replayed, accepted);
  if (accepted) res.status(202);
  sendSuccess(
    res,
    req,
    runResponseData(result, enrichedRun),
    message,
    { runId: enrichedRun.runId, idempotentReplay: replayed }
  );
}

function sendRunFailure(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest,
  run: AgentRunDto,
  replayed = false
): void {
  const error = agentError(run.error?.code || 'AGENT_RUN_FAILED', run.error?.message || 'Agent run 执行失败', {
    statusCode: run.error?.statusCode || 500,
    details: {
      ...(run.error?.details || {}),
      runId: run.runId,
      run
    },
    retryable: run.error?.retryable ?? false
  });
  setRunResponseHeaders(res, run, replayed);
  sendError(res, req, error, undefined, { runId: run.runId, idempotentReplay: replayed });
}

function respondWithExistingRun(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest,
  run: AgentRunDto,
  message = '返回已有执行'
): void {
  if (run.state === 'failed' || run.state === 'interrupted') {
    sendRunFailure(res, req, run, true);
    return;
  }
  const accepted = ACTIVE_RUN_STATES.has(run.state);
  sendRunSuccess(res, req, run.result, run, {
    message,
    replayed: true,
    accepted
  });
}

function isPreExecutionError(error: unknown): boolean {
  const code = readField(error, 'code');
  if (typeof code !== 'string') return false;
  return code === 'MAA_EXECUTION_BUSY'
    || code === 'AGENT_EXECUTION_BUSY'
    || code === 'AGENT_SCHEDULE_ALREADY_RUNNING'
    || code === 'AGENT_DAILY_FLOW_REJECTED'
    || code === 'AGENT_COPILOT_SET_UNAVAILABLE'
    || code === 'AGENT_COPILOT_SET_REJECTED'
    || code === 'AGENT_COPILOT_QUEUE_UNAVAILABLE'
    || code === RESOURCE_UPDATE_IN_PROGRESS_CODE
    || code.startsWith('AGENT_VALIDATION_');
}

// Shutdown rejections are not failures of the execution itself: the run had not
// started when the service began draining. Settling it as `stopped` matches the
// pre-start gate, so callers never see a shutdown as a successful execution.
function isShutdownRejection(error: unknown): boolean {
  const code = readField(error, 'code');
  if (typeof code !== 'string') return false;
  return code === 'MAA_EXECUTION_SHUTTING_DOWN' || code === 'AGENT_EXECUTION_SHUTTING_DOWN';
}

function resolveResponseMessage(message: ExecutionMessage | undefined, result: unknown, fallback: string): string {
  const resolved = typeof message === 'function' ? message(result) : message;
  return resolved || fallback;
}

async function settleBackgroundRun(
  runId: string,
  outcome: ExecutionOutcome | null | undefined
): Promise<AgentRunDto | null> {
  const current = getAgentRun(runId);
  if (!current || TERMINAL_RUN_STATES.has(current.state)) return current;
  try {
    let run: AgentRunDto;
    if (outcome?.stopped || current.state === 'stopping') {
      run = stopAgentRun(runId, outcome?.result || null);
    } else if (outcome?.ok) {
      run = completeAgentRun(runId, outcome.result);
    } else {
      run = failAgentRun(runId, outcome?.error || new Error('后台任务执行失败'));
    }
    await flushAgentRunStore();
    return run;
  } catch (error) {
    logger.error('更新或持久化 Agent run 终态失败', { runId, error: errorMessageOf(error) });
    return getAgentRun(runId);
  }
}

async function persistAgentRunMutation(runId: string, context: string): Promise<unknown | null> {
  try {
    await flushAgentRunStore();
    return null;
  } catch (error) {
    logger.error(context, { runId, error: errorMessageOf(error) });
    return error;
  }
}

async function respondWithPersistedAgentRun<T>(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest,
  runId: string,
  context: string,
  respond: (run: AgentRunDto | null) => T
): Promise<T | void> {
  try {
    return await withFlushedAgentRunSnapshot(runId, respond);
  } catch (error) {
    logger.error(context, { runId, error: errorMessageOf(error) });
    return sendRunPersistenceFailure(res, req, runId, error);
  }
}

function sendRunPersistenceFailure(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest,
  runId: string,
  error: unknown
): void {
  const run = getAgentRun(runId);
  const errorCode = readField(error, 'code');
  const errorStatus = readField(error, 'statusCode');
  const errorStatusFallback = readField(error, 'status');
  const errorDetails = readField(error, 'details');
  const errorRetryable = readField(error, 'retryable');
  const declaredStatus = typeof errorStatus === 'number'
    ? errorStatus
    : typeof errorStatusFallback === 'number' ? errorStatusFallback : 0;
  const persistenceError = agentError(
    typeof errorCode === 'string' ? errorCode : 'AGENT_RUN_PERSISTENCE_FAILED',
    resultMessage(error) || 'Agent run 持久化失败',
    {
      statusCode: declaredStatus || 503,
      details: {
        ...(isRecord(errorDetails) ? errorDetails : {}),
        runId,
        run
      },
      retryable: typeof errorRetryable === 'boolean' ? errorRetryable : true
    }
  );
  sendError(res, req, persistenceError, undefined, { runId });
}

function mergeBackgroundOutcome(
  outcome: ExecutionOutcome | null | undefined,
  acceptedResult: unknown
): ExecutionOutcome {
  const accepted = isRecord(acceptedResult) ? acceptedResult : { acceptedResult };
  const terminalValue = outcome?.result;
  const terminal = isRecord(terminalValue) ? terminalValue : { result: terminalValue ?? null };
  return {
    ...outcome,
    result: { ...accepted, ...terminal }
  };
}

export async function executeTrackedAgentAction(
  req: ExecutionRequest,
  res: ExecutionResponseWriter,
  {
    operationId,
    input,
    waitForCompletion = true,
    metadata = {},
    execute,
    successMessage = '操作成功',
    acceptedMessage = '任务已接受',
    stoppedMessage = '任务已终止',
    settleOnReturn = true
  }: TrackedExecutionOptions
): Promise<unknown> {
  const reservation = beginAgentRun({
    operationId,
    idempotencyKey: readIdempotencyKey(req),
    input,
    metadata
  });
  if (reservation.replayed) {
    return respondWithPersistedAgentRun(
      res,
      req,
      reservation.run.runId,
      'Agent run 重放响应前持久化失败',
      run => respondWithExistingRun(res, req, run || reservation.run)
    );
  }

  const runId = reservation.run.runId;
  // 执行上下文跟随 Run 本身：请求返回后的子进程输出与后台收尾仍记录同一个
  // runId/operationId，不能把 HTTP 请求结束当作执行完成。
  const executionLogContext = { runId, operationId };
  const admissionPersistenceError = await persistAgentRunMutation(
    runId,
    'Agent run 接受状态持久化失败，已阻止执行'
  );
  if (admissionPersistenceError) {
    const rejectedRun = failAgentRun(runId, admissionPersistenceError);
    releaseAgentRunIdempotency(runId);
    await persistAgentRunMutation(runId, 'Agent run 持久化失败终态写入失败');
    sendRunFailure(res, req, rejectedRun);
    return;
  }

  const ensureRunStarted = (): AgentRunDto => startAgentRunForExecution(runId);
  const observeProcessStart = (): AgentRunDto | null => {
    const run = getAgentRun(runId);
    if (!run) return null;
    if (run.state === 'accepted') return ensureRunStarted();
    if (run.state === 'stopping' || TERMINAL_RUN_STATES.has(run.state)) {
      // A stop landed between the pre-start gate and the spawn: kill what just started.
      try {
        stopCurrentTask();
        stopScheduleExecution();
      } catch (error) {
        logger.error('停止已取消的执行进程失败', { runId, error: errorMessageOf(error) });
      }
    }
    return run;
  };
  let acceptedResult: unknown;
  let hasAcceptedResult = false;
  let pendingOutcome: ExecutionOutcome | null = null;
  const settleAcceptedBackgroundRun = async (outcome: ExecutionOutcome): Promise<AgentRunDto | null> => {
    if (!hasAcceptedResult) {
      pendingOutcome = outcome;
      return null;
    }
    return settleBackgroundRun(runId, mergeBackgroundOutcome(outcome, acceptedResult));
  };
  const lifecycle: TrackedExecutionLifecycle = {
    onBeforeStart: () => {
      ensureRunStarted();
    },
    onStarted: () => {
      observeProcessStart();
    },
    ...(!waitForCompletion
      ? {
          onSettled: (outcome: ExecutionOutcome) => withExecutionLogContext(
            executionLogContext,
            async () => {
              await settleAcceptedBackgroundRun(outcome);
            }
          )
        }
      : {})
  };

  try {
    const result = await withExecutionLogContext(
      executionLogContext,
      () => execute(lifecycle, { runId })
    );
    acceptedResult = result;
    hasAcceptedResult = true;
    if (pendingOutcome) {
      const outcome = pendingOutcome;
      pendingOutcome = null;
      await withExecutionLogContext(
        executionLogContext,
        () => settleAcceptedBackgroundRun(outcome)
      );
    }
    let run = getAgentRun(runId) ?? reservation.run;
    if (!waitForCompletion && ACTIVE_RUN_STATES.has(run.state)) {
      run = setAgentRunAcceptedResult(runId, result);
    }
    if (waitForCompletion && !TERMINAL_RUN_STATES.has(run.state) && settleOnReturn) {
      run = run.state === 'stopping' || isStopped(result)
        ? stopAgentRun(runId, result)
        : completeAgentRun(runId, result);
    }
    return respondWithPersistedAgentRun(
      res,
      req,
      runId,
      'Agent run 响应状态持久化失败',
      persistedRun => {
        run = persistedRun || run;
        if (run.state === 'failed' || run.state === 'interrupted') {
          return sendRunFailure(res, req, run);
        }
        if (run.state === 'stopped') {
          return sendRunSuccess(res, req, run.result, run, {
            message: resolveResponseMessage(stoppedMessage, run.result, '任务已终止')
          });
        }
        const accepted = !waitForCompletion && ACTIVE_RUN_STATES.has(run.state);
        return sendRunSuccess(res, req, TERMINAL_RUN_STATES.has(run.state) ? run.result : result, run, {
          message: accepted
            ? resolveResponseMessage(acceptedMessage, result, '任务已接受')
            : resolveResponseMessage(successMessage, result, '操作成功'),
          accepted
        });
      }
    );
  } catch (error) {
    const current = getAgentRun(runId);
    if (current && TERMINAL_RUN_STATES.has(current.state)) {
      return respondWithPersistedAgentRun(
        res,
        req,
        runId,
        'Agent run 终态响应持久化失败',
        persistedRun => {
          const terminalRun = persistedRun || current;
          if (terminalRun.state === 'stopped') {
            return sendRunSuccess(res, req, terminalRun.result, terminalRun, {
              message: resolveResponseMessage(stoppedMessage, terminalRun.result, '任务已终止')
            });
          }
          return sendRunFailure(res, req, terminalRun);
        }
      );
    }
    if (isPreExecutionError(error) && current && !TERMINAL_RUN_STATES.has(current.state)) {
      const rejectedRun = failAgentRun(runId, error);
      releaseAgentRunIdempotency(runId);
      const persistenceError = await persistAgentRunMutation(runId, 'Agent run 拒绝状态持久化失败');
      if (persistenceError) return sendRunPersistenceFailure(res, req, runId, persistenceError);
      return sendRunFailure(res, req, rejectedRun);
    }
    const run = isStopped(error) || isShutdownRejection(error) || current?.state === 'stopping'
      ? stopAgentRun(runId, {
          message: errorMessageOf(error),
          exitCode: readField(error, 'exitCode') ?? null,
          signal: readField(error, 'signal') ?? null,
          ...(isShutdownRejection(error) ? { reason: 'server_shutdown' } : {})
        })
      : failAgentRun(runId, error);
    return respondWithPersistedAgentRun(
      res,
      req,
      runId,
      'Agent run 终态持久化失败',
      persistedRun => {
        const terminalRun = persistedRun || run;
        if (terminalRun.state === 'stopped') {
          return sendRunSuccess(res, req, terminalRun.result, terminalRun, {
            message: resolveResponseMessage(stoppedMessage, terminalRun.result, '任务已终止')
          });
        }
        return sendRunFailure(res, req, terminalRun);
      }
    );
  }
}

function mapLegacyBusyError(error: unknown, legacyCode: string | null): unknown {
  if (!error || !legacyCode || readField(error, 'code') !== 'AGENT_EXECUTION_BUSY') return error;
  return agentError(legacyCode, errorMessageOf(error), {
    statusCode: typeof readField(error, 'statusCode') === 'number' ? readField(error, 'statusCode') as number : 409,
    details: isRecord(readField(error, 'details')) ? readField(error, 'details') as Record<string, unknown> : {},
    retryable: typeof readField(error, 'retryable') === 'boolean' ? readField(error, 'retryable') as boolean : true
  });
}

function toDailyFlowOutcome(result: ScheduleFlowExecutionResult, legacyBusyCode: string | null): ExecutionOutcome {
  const error = createDailyFlowExecutionError(result);
  if (error) return { ok: false, error: mapLegacyBusyError(error, legacyBusyCode) };
  if (isStopped(result)) return { stopped: true, result };
  return { ok: true, result };
}

interface StartDailyFlowBackgroundOptions {
  scheduleId: string;
  taskFlow: unknown[];
  lifecycle: TrackedExecutionLifecycle;
  runId: string;
  legacyBusyCode: string | null;
  acceptedResult: unknown;
}

/**
 * Starts a daily flow in the background and resolves once the flow owns the
 * execution lease and has passed the pre-start gate. Failures before that
 * point are reported synchronously; later failures settle the accepted run.
 */
function startDailyFlowBackground({
  scheduleId,
  taskFlow,
  lifecycle,
  runId,
  legacyBusyCode,
  acceptedResult
}: StartDailyFlowBackgroundOptions): Promise<unknown> {
  if (typeof lifecycle.onSettled !== 'function') {
    throw new Error('后台日常流程需要 onSettled 生命周期');
  }

  return new Promise((resolve, reject) => {
    let started = false;
    let settled = false;
    const settle = (outcome: ExecutionOutcome): void => {
      if (settled) return;
      settled = true;
      Promise.resolve(lifecycle.onSettled?.(outcome)).catch(error => {
        logger.error('后台日常流程终态处理失败', { scheduleId, runId, error: errorMessageOf(error) });
      });
    };

    let flow: Promise<ScheduleFlowExecutionResult>;
    try {
      flow = executeScheduleNow(scheduleId, taskFlow, {
        onBeforeStart: () => lifecycle.onBeforeStart?.(),
        onStarted: () => {
          started = true;
          lifecycle.onStarted?.();
          resolve(acceptedResult);
        }
      }, { runId });
    } catch (error) {
      reject(error);
      return;
    }

    flow.then(result => {
      const outcome = toDailyFlowOutcome(result, legacyBusyCode);
      if (!started) {
        reject(outcome.error || new Error(resultMessage(outcome.result) || '任务流程未能开始'));
        return;
      }
      settle(outcome);
    }, error => {
      if (!started) {
        reject(mapLegacyBusyError(error, legacyBusyCode));
        return;
      }
      settle({ ok: false, error });
    });
  });
}

interface TrackedDailyFlowOptions {
  scheduleId: string;
  taskFlow: unknown[];
  waitForCompletion?: boolean;
  metadata?: unknown;
  legacyBusyCode?: string | null;
  successMessage?: ExecutionMessage;
  acceptedMessage?: ExecutionMessage;
  stoppedMessage?: ExecutionMessage;
  extraResult?: Record<string, unknown>;
}

function executeTrackedDailyFlow(
  req: ExecutionRequest,
  res: ExecutionResponseWriter,
  {
    scheduleId,
    taskFlow,
    waitForCompletion = true,
    metadata,
    legacyBusyCode = null,
    successMessage = '任务流程执行完成',
    acceptedMessage = '任务流程已接受',
    stoppedMessage = result => resultMessage(result) || '任务流程已被终止',
    extraResult = {}
  }: TrackedDailyFlowOptions
): Promise<unknown> {
  const totalSteps = taskFlow.filter(task => isRecord(task) && Boolean(task.enabled)).length;

  return executeTrackedAgentAction(req, res, {
    operationId: 'run_daily_flow',
    input: { scheduleId, taskFlow },
    waitForCompletion,
    metadata,
    execute: async (lifecycle, { runId }) => {
      if (waitForCompletion) {
        const result = await executeScheduleNow(scheduleId, taskFlow, lifecycle, { runId });
        const failure = createDailyFlowExecutionError(result);
        if (failure) throw mapLegacyBusyError(failure, legacyBusyCode);
        return { ...result, scheduleId, totalSteps, ...extraResult };
      }

      return startDailyFlowBackground({
        scheduleId,
        taskFlow,
        lifecycle,
        runId,
        legacyBusyCode,
        acceptedResult: {
          success: true,
          accepted: true,
          stopped: false,
          message: acceptedMessage,
          scheduleId,
          totalSteps,
          ...extraResult
        }
      });
    },
    successMessage,
    acceptedMessage,
    stoppedMessage
  });
}

interface StartCopilotBackgroundOptions<TPrepared> {
  runId: string;
  start: (lifecycle: CopilotExecutionLifecycle & { onPrepared: (info: TPrepared) => void }) => Promise<unknown>;
  lifecycle: TrackedExecutionLifecycle;
  acceptedResult: (info: TPrepared | null) => unknown;
  startFailureMessage: string;
  settleOnFinish: boolean;
}

interface CopilotBackgroundLifecycle<TPrepared> extends CopilotExecutionLifecycle {
  onPrepared: (info: TPrepared) => void;
}

/**
 * Starts a copilot execution in the background and resolves once it owns the
 * lease and has passed the pre-start gate. Continuous executions settle their
 * Run through the tracked-action lifecycle; manual ones settle their own Run
 * when they reach waiting or a terminal state.
 */
function startCopilotBackground<TPrepared>({
  runId,
  start,
  lifecycle,
  acceptedResult,
  startFailureMessage,
  settleOnFinish
}: StartCopilotBackgroundOptions<TPrepared>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let started = false;
    let preparedInfo: TPrepared | null = null;
    const settle = (outcome: ExecutionOutcome): void => {
      Promise.resolve(lifecycle.onSettled?.(outcome)).catch(error => {
        logger.error('后台作业终态处理失败', { runId, error: errorMessageOf(error) });
      });
    };
    const wrappedLifecycle: CopilotBackgroundLifecycle<TPrepared> = {
      ...lifecycle,
      onPrepared: (info: TPrepared) => {
        preparedInfo = info;
      },
      onStarted: () => {
        started = true;
        lifecycle.onStarted?.();
        resolve(acceptedResult(preparedInfo));
      }
    };

    let task: Promise<unknown>;
    try {
      task = start(wrappedLifecycle);
    } catch (error) {
      reject(error);
      return;
    }

    task.then(result => {
      if (!started) {
        const run = getAgentRun(runId);
        if (run && (run.state === 'succeeded' || run.state === 'stopped')) {
          resolve(readField(result, 'result') || result || run.result);
          return;
        }
        reject(new Error(resultMessage(result) || startFailureMessage));
        return;
      }
      if (settleOnFinish) {
        settle({ ok: !isStopped(result), stopped: isStopped(result), result });
      }
    }, error => {
      if (!started) {
        reject(error);
        return;
      }
      settle({ ok: false, stopped: isStopped(error), error });
    });
  });
}

interface CopilotSetExecutionOptions {
  setId: string;
  raid: CopilotSetRaid;
  selectedIndexes: number[];
  options: Record<string, unknown>;
  waitForCompletion: boolean;
}

function executeContinuousCopilotSet(
  req: ExecutionRequest,
  res: ExecutionResponseWriter,
  {
    setId,
    raid,
    selectedIndexes,
    options,
    waitForCompletion
  }: CopilotSetExecutionOptions
): Promise<unknown> {
  return executeTrackedAgentAction(req, res, {
    operationId: 'run_copilot_set',
    input: { setId, mode: 'continuous', raid, selectedIndexes, options },
    metadata: { taskName: `作业集 ${setId}`, taskType: 'copilot-set', setId, mode: 'continuous' },
    waitForCompletion,
    successMessage: result => resultMessage(result) || '作业集执行完成',
    acceptedMessage: '作业集任务已接受',
    stoppedMessage: result => resultMessage(result) || '作业集已停止',
    execute: async (lifecycle, { runId }) => {
      if (waitForCompletion) {
        return runContinuousCopilotSet({ runId, setId, raid, selectedIndexes, options, lifecycle });
      }
      return startCopilotBackground<CopilotSetPreparedInfo>({
        runId,
        start: wrappedLifecycle => runContinuousCopilotSet({
          runId,
          setId,
          raid,
          selectedIndexes,
          options,
          lifecycle: wrappedLifecycle
        }),
        lifecycle,
        settleOnFinish: true,
        startFailureMessage: '作业集未能开始执行',
        acceptedResult: info => ({
          success: true,
          accepted: true,
          stopped: false,
          mode: 'continuous',
          setId,
          name: info?.name || `作业集 ${setId}`,
          totalEntries: info?.totalEntries ?? null,
          message: '作业集任务已接受'
        })
      });
    }
  });
}

function executeManualCopilotSet(
  req: ExecutionRequest,
  res: ExecutionResponseWriter,
  {
    setId,
    raid,
    selectedIndexes,
    options,
    waitForCompletion
  }: CopilotSetExecutionOptions
): Promise<unknown> {
  return executeTrackedAgentAction(req, res, {
    operationId: 'run_copilot_set',
    input: { setId, mode: 'manual', raid, selectedIndexes, options },
    metadata: { taskName: `作业集 ${setId}`, taskType: 'copilot-set', setId, mode: 'manual' },
    waitForCompletion,
    settleOnReturn: false,
    successMessage: result => resultMessage(result) || '作业集执行完成',
    acceptedMessage: '作业集任务已接受',
    stoppedMessage: result => resultMessage(result) || '作业集已停止',
    execute: async (lifecycle, { runId }) => {
      if (waitForCompletion) {
        const outcome = await startManualCopilotSet({ runId, setId, raid, selectedIndexes, options, lifecycle });
        return outcome.result;
      }
      return startCopilotBackground<CopilotSetPreparedInfo>({
        runId,
        start: wrappedLifecycle => startManualCopilotSet({
          runId,
          setId,
          raid,
          selectedIndexes,
          options,
          lifecycle: wrappedLifecycle
        }),
        lifecycle,
        settleOnFinish: false,
        startFailureMessage: '作业集未能开始执行',
        acceptedResult: info => ({
          success: true,
          accepted: true,
          stopped: false,
          mode: 'manual',
          setId,
          name: info?.name || `作业集 ${setId}`,
          totalEntries: info?.totalEntries ?? null,
          message: '作业集任务已接受'
        })
      });
    }
  });
}

function settleContinueBackground(runId: string, outcome: ExecutionOutcome | null): void {
  if (!outcome || outcome.ok || outcome.stopped) return;
  const run = getAgentRun(runId);
  if (!run || TERMINAL_RUN_STATES.has(run.state)) return;
  try {
    failAgentRun(runId, outcome.error || new Error('作业集后台执行失败'));
    flushAgentRunStore().catch(error => {
      logger.error('作业集后台失败终态持久化失败', { runId, error: errorMessageOf(error) });
    });
  } catch (error) {
    logger.error('作业集后台失败终态写入失败', { runId, error: errorMessageOf(error) });
  }
}

interface ContinueResponseOptions {
  persistenceContext: string;
  successMessage: string;
  stoppedMessage: string;
  logLabel: string;
  fallbackCode: string;
}

const COPILOT_SET_CONTINUE_RESPONSE: ContinueResponseOptions = {
  persistenceContext: '作业集下一关状态持久化失败',
  successMessage: '作业集已执行下一关',
  stoppedMessage: '作业集已停止',
  logLabel: '作业集下一关执行失败',
  fallbackCode: 'AGENT_COPILOT_SET_CONTINUE_FAILED'
};

const COPILOT_QUEUE_CONTINUE_RESPONSE: ContinueResponseOptions = {
  persistenceContext: '作业队列下一项状态持久化失败',
  successMessage: '作业队列已执行下一项',
  stoppedMessage: '作业队列已停止',
  logLabel: '作业队列下一项执行失败',
  fallbackCode: 'AGENT_COPILOT_QUEUE_CONTINUE_FAILED'
};

function sendContinueSuccess(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest,
  runId: string,
  outcome: unknown,
  options: ContinueResponseOptions
): Promise<void> {
  return respondWithPersistedAgentRun(res, req, runId, options.persistenceContext, persistedRun => {
    const run = persistedRun || getAgentRun(runId);
    if (run?.state === 'failed' || run?.state === 'interrupted') {
      sendRunFailure(res, req, run);
      return;
    }
    if (!run) throw new Error('Agent run 不存在');
    const enrichedRun: AgentRunDto = enrichAgentRun(run);
    const data = readField(outcome, 'result') || run.result;
    setRunResponseHeaders(res, enrichedRun, false);
    sendSuccess(
      res,
      req,
      runResponseData(data, enrichedRun),
      resultMessage(data) || resultMessage(outcome) || options.successMessage,
      { runId }
    );
  });
}

function respondContinueError(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest,
  runId: string,
  error: unknown,
  options: ContinueResponseOptions
): void {
  const code = typeof readField(error, 'code') === 'string' ? readField(error, 'code') as string : '';
  const run = getAgentRun(runId);

  if (code === 'MAA_EXECUTION_BUSY') {
    sendError(res, req, agentError('MAA_EXECUTION_BUSY', errorMessageOf(error), {
      statusCode: 409,
      details: { owner: readField(error, 'owner') ?? readField(readField(error, 'details'), 'owner') ?? null, runId, run },
      retryable: true
    }));
    return;
  }
  if (code === 'MAA_EXECUTION_SHUTTING_DOWN') {
    sendError(res, req, agentError('MAA_EXECUTION_SHUTTING_DOWN', errorMessageOf(error), {
      statusCode: 503,
      details: { reason: readField(readField(error, 'details'), 'reason') ?? null, runId, run },
      retryable: true
    }));
    return;
  }
  if (code === 'AGENT_COPILOT_SET_NOT_WAITING'
    || code === 'AGENT_COPILOT_SET_SESSION_LOST'
    || code === 'AGENT_COPILOT_QUEUE_NOT_WAITING'
    || code === 'AGENT_COPILOT_QUEUE_SESSION_LOST') {
    sendError(res, req, agentError(code, errorMessageOf(error), {
      statusCode: 409,
      details: { ...(isRecord(readField(error, 'details')) ? readField(error, 'details') as Record<string, unknown> : {}), runId, run },
      retryable: readField(error, 'retryable') === true
    }));
    return;
  }
  if (isStopped(error) || run?.state === 'stopped') {
    if (!run) throw new Error('Agent run 不存在');
    sendRunSuccess(res, req, run.result, run, {
      message: resultMessage(run.result) || options.stoppedMessage
    });
    return;
  }
  logger.error(options.logLabel, { runId, error: errorMessageOf(error) });
  sendError(res, req, agentError(options.fallbackCode, errorMessageOf(error) || options.logLabel, {
    statusCode: 500,
    details: { runId, run },
    retryable: true
  }));
}

async function continueCopilotSet(
  req: ExecutionRequest,
  res: ExecutionResponseWriter,
  { runId, waitForCompletion }: { runId: string; waitForCompletion: boolean }
): Promise<unknown> {
  const run = getAgentRun(runId);
  if (!run) {
    return sendError(res, req, agentError('AGENT_RUN_NOT_FOUND', `未找到 Agent run: ${runId}`, {
      statusCode: 404,
      details: { runId },
      retryable: false
    }));
  }
  if (run.operationId !== 'run_copilot_set') {
    return sendError(res, req, agentError('AGENT_COPILOT_SET_NOT_WAITING', '目标 run 不是作业集执行', {
      statusCode: 409,
      details: { runId, operationId: run.operationId },
      retryable: false
    }));
  }
  if (TERMINAL_RUN_STATES.has(run.state)) {
    return sendSuccess(res, req, {
      runId,
      alreadyTerminal: true,
      waitingForNext: false,
      finished: true,
      run: enrichAgentRun(run)
    }, '作业集已经结束');
  }
  if (run.state !== 'waiting') {
    return sendError(res, req, agentError('AGENT_COPILOT_SET_NOT_WAITING', `作业集当前状态为 ${run.state}`, {
      statusCode: 409,
      details: { runId, state: run.state },
      retryable: true
    }));
  }
  if (!hasCopilotSetSession(runId)) {
    return sendError(res, req, agentError('AGENT_COPILOT_SET_SESSION_LOST', '作业集会话已失效，无法继续下一关', {
      statusCode: 409,
      details: { runId },
      retryable: false
    }));
  }

  if (waitForCompletion) {
    try {
      const outcome = await withExecutionLogContext(
        { runId, operationId: run.operationId },
        () => continueManualCopilotSet({ runId })
      );
      return sendContinueSuccess(res, req, runId, outcome, COPILOT_SET_CONTINUE_RESPONSE);
    } catch (error) {
      return respondContinueError(res, req, runId, error, COPILOT_SET_CONTINUE_RESPONSE);
    }
  }

  let accepted: unknown;
  try {
    accepted = await startCopilotBackground<CopilotSetPreparedInfo>({
      runId,
      start: wrappedLifecycle => withExecutionLogContext(
        { runId, operationId: run.operationId },
        () => continueManualCopilotSet({ runId, lifecycle: wrappedLifecycle })
      ),
      lifecycle: {
        onSettled: outcome => withExecutionLogContext(
          { runId, operationId: run.operationId },
          () => settleContinueBackground(runId, outcome)
        )
      },
      settleOnFinish: false,
      startFailureMessage: '作业集未能开始执行',
      acceptedResult: () => ({
        success: true,
        accepted: true,
        stopped: false,
        mode: 'manual',
        runId,
        message: '作业集下一关已接受'
      })
    });
  } catch (error) {
    return respondContinueError(res, req, runId, error, COPILOT_SET_CONTINUE_RESPONSE);
  }

  // 202 确认续跑前必须等 waiting → running 落盘：否则进程在持久化前退出时，
  // 磁盘记录停留在旧 waiting 状态，客户端却已收到续跑成功。
  return respondWithPersistedAgentRun(res, req, runId, '作业集下一关接受状态持久化失败', persistedRun => {
    // 续跑入口刚写入的 Run 必然存在；非空断言只收窄类型，缺失时与旧实现一样原样返回 null。
    const enrichedRun: AgentRunDto = enrichAgentRun((persistedRun || getAgentRun(runId))!);
    setRunResponseHeaders(res, enrichedRun, false, true);
    res.status(202);
    sendSuccess(res, req, runResponseData(accepted, enrichedRun), resultMessage(accepted) || '作业集下一关已接受', { runId });
  });
}

interface CopilotQueueExecutionOptions {
  queueId: string;
  name: string;
  failurePolicy: CopilotQueueFailurePolicy;
  entries: CopilotQueueEntryInput[];
  options: Record<string, unknown>;
  waitForCompletion: boolean;
}

function queueMetadata(
  queueId: string,
  name: string,
  mode: CopilotQueueMode,
  failurePolicy: CopilotQueueFailurePolicy
): Record<string, unknown> {
  const taskName = name === '作业队列' ? name : `作业队列 ${name}`;
  return { taskName, taskType: 'copilot-queue', queueId, mode, failurePolicy };
}

function executeContinuousCopilotQueue(
  req: ExecutionCopilotQueueRequest,
  res: ExecutionResponseWriter,
  {
    queueId,
    name,
    failurePolicy,
    entries,
    options,
    waitForCompletion
  }: CopilotQueueExecutionOptions
): Promise<unknown> {
  return executeTrackedAgentAction(req, res, {
    operationId: 'run_copilot_queue',
    input: { queueId, name, mode: 'continuous', failurePolicy, entries, options },
    metadata: queueMetadata(queueId, name, 'continuous', failurePolicy),
    waitForCompletion,
    successMessage: result => resultMessage(result) || '作业队列执行完成',
    acceptedMessage: '作业队列任务已接受',
    stoppedMessage: result => resultMessage(result) || '作业队列已停止',
    execute: async (lifecycle, { runId }) => {
      if (waitForCompletion) {
        return runContinuousCopilotQueue({
          runId,
          queueId,
          name,
          entries,
          mode: 'continuous',
          failurePolicy,
          options,
          lifecycle
        });
      }
      return startCopilotBackground<CopilotQueuePreparedInfo>({
        runId,
        start: wrappedLifecycle => runContinuousCopilotQueue({
          runId,
          queueId,
          name,
          entries,
          mode: 'continuous',
          failurePolicy,
          options,
          lifecycle: wrappedLifecycle
        }),
        lifecycle,
        settleOnFinish: true,
        startFailureMessage: '作业队列未能开始执行',
        acceptedResult: info => ({
          success: true,
          accepted: true,
          stopped: false,
          mode: 'continuous',
          queueId,
          name: info?.name || name,
          failurePolicy,
          totalEntries: info?.totalEntries ?? null,
          message: '作业队列任务已接受'
        })
      });
    }
  });
}

function executeManualCopilotQueue(
  req: ExecutionCopilotQueueRequest,
  res: ExecutionResponseWriter,
  {
    queueId,
    name,
    failurePolicy,
    entries,
    options,
    waitForCompletion
  }: CopilotQueueExecutionOptions
): Promise<unknown> {
  return executeTrackedAgentAction(req, res, {
    operationId: 'run_copilot_queue',
    input: { queueId, name, mode: 'manual', failurePolicy, entries, options },
    metadata: queueMetadata(queueId, name, 'manual', failurePolicy),
    waitForCompletion,
    settleOnReturn: false,
    successMessage: result => resultMessage(result) || '作业队列执行完成',
    acceptedMessage: '作业队列任务已接受',
    stoppedMessage: result => resultMessage(result) || '作业队列已停止',
    execute: async (lifecycle, { runId }) => {
      if (waitForCompletion) {
        const outcome = await startManualCopilotQueue({
          runId,
          queueId,
          name,
          entries,
          mode: 'manual',
          failurePolicy,
          options,
          lifecycle
        });
        return outcome.result;
      }
      return startCopilotBackground<CopilotQueuePreparedInfo>({
        runId,
        start: wrappedLifecycle => startManualCopilotQueue({
          runId,
          queueId,
          name,
          entries,
          mode: 'manual',
          failurePolicy,
          options,
          lifecycle: wrappedLifecycle
        }),
        lifecycle,
        settleOnFinish: false,
        startFailureMessage: '作业队列未能开始执行',
        acceptedResult: info => ({
          success: true,
          accepted: true,
          stopped: false,
          mode: 'manual',
          queueId,
          name: info?.name || name,
          failurePolicy,
          totalEntries: info?.totalEntries ?? null,
          message: '作业队列任务已接受'
        })
      });
    }
  });
}

async function continueCopilotQueue(
  req: ExecutionRequest,
  res: ExecutionResponseWriter,
  { runId, waitForCompletion }: { runId: string; waitForCompletion: boolean }
): Promise<unknown> {
  const run = getAgentRun(runId);
  if (!run) {
    return sendError(res, req, agentError('AGENT_RUN_NOT_FOUND', `未找到 Agent run: ${runId}`, {
      statusCode: 404,
      details: { runId },
      retryable: false
    }));
  }
  if (run.operationId !== 'run_copilot_queue') {
    return sendError(res, req, agentError('AGENT_COPILOT_QUEUE_NOT_WAITING', '目标 run 不是作业队列执行', {
      statusCode: 409,
      details: { runId, operationId: run.operationId },
      retryable: false
    }));
  }
  if (TERMINAL_RUN_STATES.has(run.state)) {
    return sendSuccess(res, req, {
      runId,
      alreadyTerminal: true,
      waitingForNext: false,
      finished: true,
      run: enrichAgentRun(run)
    }, '作业队列已经结束');
  }
  if (run.state !== 'waiting') {
    return sendError(res, req, agentError('AGENT_COPILOT_QUEUE_NOT_WAITING', `作业队列当前状态为 ${run.state}`, {
      statusCode: 409,
      details: { runId, state: run.state },
      retryable: true
    }));
  }
  if (!hasCopilotQueueSession(runId)) {
    return sendError(res, req, agentError('AGENT_COPILOT_QUEUE_SESSION_LOST', '作业队列会话已失效，无法继续下一项', {
      statusCode: 409,
      details: { runId },
      retryable: false
    }));
  }

  if (waitForCompletion) {
    try {
      const outcome = await withExecutionLogContext(
        { runId, operationId: run.operationId },
        () => continueManualCopilotQueue({ runId })
      );
      return sendContinueSuccess(res, req, runId, outcome, COPILOT_QUEUE_CONTINUE_RESPONSE);
    } catch (error) {
      return respondContinueError(res, req, runId, error, COPILOT_QUEUE_CONTINUE_RESPONSE);
    }
  }

  let accepted: unknown;
  try {
    accepted = await startCopilotBackground<CopilotQueuePreparedInfo>({
      runId,
      start: wrappedLifecycle => withExecutionLogContext(
        { runId, operationId: run.operationId },
        () => continueManualCopilotQueue({ runId, lifecycle: wrappedLifecycle })
      ),
      lifecycle: {
        onSettled: outcome => withExecutionLogContext(
          { runId, operationId: run.operationId },
          () => settleContinueBackground(runId, outcome)
        )
      },
      settleOnFinish: false,
      startFailureMessage: '作业队列下一项未能开始执行',
      acceptedResult: () => ({
        success: true,
        accepted: true,
        stopped: false,
        mode: 'manual',
        runId,
        message: '作业队列下一项已接受'
      })
    });
  } catch (error) {
    return respondContinueError(res, req, runId, error, COPILOT_QUEUE_CONTINUE_RESPONSE);
  }

  return respondWithPersistedAgentRun(res, req, runId, '作业队列下一项接受状态持久化失败', persistedRun => {
    const enrichedRun: AgentRunDto = enrichAgentRun((persistedRun || getAgentRun(runId))!);
    setRunResponseHeaders(res, enrichedRun, false, true);
    res.status(202);
    sendSuccess(res, req, runResponseData(accepted, enrichedRun), resultMessage(accepted) || '作业队列下一项已接受', { runId });
  });
}

export async function executeCopilotQueue(
  req: ExecutionCopilotQueueRequest,
  res: ExecutionResponseWriter
): Promise<unknown> {
  const request = normalizeCopilotQueueExecutionRequest(req.body || {});
  await assertCopilotQueueFilesReadable(request.entries);
  const execution: CopilotQueueExecutionOptions = {
    queueId: request.queueId,
    name: request.name,
    failurePolicy: request.failurePolicy,
    entries: request.entries,
    options: request.options,
    waitForCompletion: request.waitForCompletion
  };
  if (request.mode === 'manual') return executeManualCopilotQueue(req, res, execution);
  return executeContinuousCopilotQueue(req, res, execution);
}

export async function continueCopilotQueueAction(
  req: ExecutionRequest,
  res: ExecutionResponseWriter
): Promise<unknown> {
  const runId = parseContinueRunId(req.body);
  const waitForCompletion = parseWaitForCompletion(readField(req.body, 'waitForCompletion'));
  return continueCopilotQueue(req, res, { runId, waitForCompletion });
}

export async function skipCopilotQueueEntryAction(
  req: ExecutionRequest,
  res: ExecutionResponseWriter
): Promise<unknown> {
  const runId = parseContinueRunId(req.body);
  const run = getAgentRun(runId);
  if (!run) {
    return sendError(res, req, agentError('AGENT_RUN_NOT_FOUND', `未找到 Agent run: ${runId}`, {
      statusCode: 404,
      details: { runId },
      retryable: false
    }));
  }
  if (run.operationId !== 'run_copilot_queue') {
    return sendError(res, req, agentError('AGENT_COPILOT_QUEUE_NOT_WAITING', '目标 run 不是作业队列执行', {
      statusCode: 409,
      details: { runId, operationId: run.operationId },
      retryable: false
    }));
  }

  let outcome: ReturnType<typeof requestCopilotQueueSkip>;
  try {
    outcome = requestCopilotQueueSkip(runId);
  } catch (error) {
    return respondContinueError(res, req, runId, error, COPILOT_QUEUE_CONTINUE_RESPONSE);
  }
  return respondWithPersistedAgentRun(res, req, runId, '作业队列跳过状态持久化失败', persistedRun => {
    const enrichedRun: AgentRunDto = enrichAgentRun((persistedRun || getAgentRun(runId))!);
    setRunResponseHeaders(res, enrichedRun, false);
    sendSuccess(res, req, {
      skippedClientId: outcome.skippedClientId,
      waitingForNext: outcome.waitingForNext,
      finished: outcome.finished,
      ...(outcome.nextEntry ? { nextEntry: outcome.nextEntry } : {}),
      run: enrichedRun
    }, outcome.finished ? '作业队列已跳过当前项并完成' : '已跳过当前项', { runId });
  });
}

interface FightOptions extends Record<string, unknown> {
  stages?: unknown;
  stage?: unknown;
  times?: unknown;
  medicine?: unknown;
  medicineExpireDays?: unknown;
  /** @deprecated 旧版按瓶数表达临期药；新调用方使用 medicineExpireDays。 */
  expiringMedicine?: unknown;
  stone?: unknown;
  series?: unknown;
}

function isAgentRunStopRequested(runId: string): boolean {
  const run = getAgentRun(runId);
  return !run || run.state === 'stopping' || TERMINAL_RUN_STATES.has(run.state);
}

interface StartFightBackgroundOptions {
  runId: string;
  stages: readonly FightStageEntry[];
  options: FightRequestOptions;
  lifecycle: TrackedExecutionLifecycle;
  plan: unknown;
  acceptedResult: unknown;
}

function startFightBackground({
  runId,
  stages,
  options,
  lifecycle,
  plan,
  acceptedResult
}: StartFightBackgroundOptions): Promise<unknown> {
  if (typeof lifecycle.onSettled !== 'function') {
    throw new Error('后台理智作战需要 onSettled 生命周期');
  }

  return new Promise((resolve, reject) => {
    let started = false;
    let settled = false;
    const settle = (outcome: ExecutionOutcome): void => {
      if (settled) return;
      settled = true;
      Promise.resolve(lifecycle.onSettled?.(outcome)).catch(error => {
        logger.error('后台理智作战终态处理失败', { error: errorMessageOf(error) });
      });
    };

    const task = executeFightStages({
      stages,
      options,
      taskName: 'Agent: 理智作战',
      lifecycle: {
        onBeforeStart: () => lifecycle.onBeforeStart?.(),
        onStarted: () => {
          started = true;
          lifecycle.onStarted?.();
          resolve(acceptedResult);
        }
      },
      shouldStop: () => isAgentRunStopRequested(runId)
    });
    task.then(result => {
      if (!started) {
        if (result.stopped) {
          reject(Object.assign(new Error('执行在开始前已被停止，未向设备发送任何命令'), { stopped: true }));
          return;
        }
        reject(new Error(result.message || '理智作战未能开始'));
        return;
      }
      settle({ ok: !result.stopped, stopped: result.stopped, result: { ...result, plan } });
    }, error => {
      if (!started) {
        reject(error);
        return;
      }
      settle({ ok: false, stopped: isStopped(error), error });
    });
  });
}

async function loadAutomationTaskFlow(overrideTaskFlow: unknown = null): Promise<unknown[]> {
  if (Array.isArray(overrideTaskFlow)) return overrideTaskFlow;
  const saved = await loadUserConfig('automation-tasks');
  if (!saved.success) return [];
  const taskFlow = readField(saved.data, 'taskFlow');
  return Array.isArray(taskFlow) ? taskFlow : [];
}

function sendStopSuccess(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest,
  runId: string,
  data: ExecutionStopPayload,
  message: string
): Promise<void> {
  return respondWithPersistedAgentRun(
    res,
    req,
    runId,
    'Agent run 停止状态持久化失败',
    persistedRun => sendSuccess(res, req, {
      ...data,
      run: enrichAgentRun(persistedRun || data.run)
    }, message)
  );
}

function sendStopRunNotFound(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest,
  runId: string
): void {
  sendError(res, req, agentError('AGENT_RUN_NOT_FOUND', `未找到 Agent run: ${runId}`, {
    statusCode: 404,
    details: { runId },
    retryable: false
  }));
}

function sendStopAlreadyTerminal(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest,
  run: AgentRunDto
): void {
  sendSuccess(res, req, {
    stopRequested: false,
    deviceStopRequested: false,
    alreadyTerminal: true,
    run
  }, '任务已经结束');
}

function sendStopTargetNotCurrent(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest,
  requestedRunId: string,
  run: AgentRunDto,
  currentRunId: string | null
): void {
  if (run.state === 'stopping') {
    sendSuccess(res, req, {
      stopRequested: true,
      deviceStopRequested: false,
      alreadyStopping: true,
      run
    }, '任务正在终止');
    return;
  }
  sendError(res, req, agentError('AGENT_RUN_NOT_CURRENT', '目标 run 不是当前执行，未发送终止命令', {
    statusCode: 409,
    details: { requestedRunId, currentRunId },
    retryable: false
  }));
}

async function stopRequestedRun(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest,
  requestedRunId: string,
  mode: StopRequestMode
): Promise<unknown> {
  const requestedRun = getAgentRun(requestedRunId);
  if (!requestedRun) {
    return sendStopRunNotFound(res, req, requestedRunId);
  }
  if (mode === 'now') cancelRoguelikeStopIntent(requestedRunId);
  if (TERMINAL_RUN_STATES.has(requestedRun.state)) {
    return sendStopAlreadyTerminal(res, req, requestedRun);
  }

  if (requestedRun.operationId === 'run_copilot_set') {
    const setStop = requestCopilotSetRunStop(requestedRunId);
    if (setStop?.disposition === 'stopped') {
      return sendStopSuccess(res, req, setStop.run.runId, {
        stopRequested: true,
        deviceStopRequested: false,
        waitingRunStopped: true,
        run: setStop.run
      }, '作业集已停止，未开始下一关');
    }
    if (setStop?.disposition === 'canceled') {
      return sendStopSuccess(res, req, setStop.run.runId, {
        stopRequested: true,
        deviceStopRequested: false,
        acceptedRunCanceled: true,
        run: setStop.run
      }, '已取消尚未开始的作业集执行');
    }
  }

  if (requestedRun.operationId === 'run_copilot_queue') {
    const queueStop = requestCopilotQueueRunStop(requestedRunId);
    if (queueStop?.disposition === 'stopped') {
      return sendStopSuccess(res, req, queueStop.run.runId, {
        stopRequested: true,
        deviceStopRequested: false,
        waitingRunStopped: true,
        run: queueStop.run
      }, '作业队列已停止，未开始下一项');
    }
    if (queueStop?.disposition === 'canceled') {
      return sendStopSuccess(res, req, queueStop.run.runId, {
        stopRequested: true,
        deviceStopRequested: false,
        acceptedRunCanceled: true,
        run: queueStop.run
      }, '已取消尚未开始的作业队列执行');
    }
  }

  // Accepted runs hold no execution rights: canceling them is safe and
  // cannot touch a newer execution.
  if (requestedRun.state === 'accepted') {
    const { run } = requestAgentRunStop(requestedRunId);
    return sendStopSuccess(res, req, run.runId, {
      stopRequested: true,
      deviceStopRequested: false,
      acceptedRunCanceled: true,
      run
    }, '已取消尚未开始的执行');
  }

  const currentRun = getCurrentAgentRun();
  if (!currentRun || currentRun.runId !== requestedRunId) {
    cancelRoguelikeStopIntent(requestedRunId);
    return sendStopTargetNotCurrent(res, req, requestedRunId, requestedRun, currentRun?.runId || null);
  }

  if (mode === 'after-combat') {
    const outcome = await beginRoguelikeStopIntent(requestedRunId);
    if (outcome.status !== 'immediate') {
      const pendingRun = getAgentRun(requestedRunId) || requestedRun;
      return sendSuccess(res, req, {
        stopRequested: true,
        deviceStopRequested: false,
        pendingStop: outcome.intent,
        ...(outcome.status === 'already-pending' ? { alreadyPending: true } : {}),
        run: enrichAgentRun(pendingRun)
      }, outcome.status === 'already-pending'
        ? '已在等待战斗结束后终止'
        : '已记录停止意图，等待本场战斗结束后终止');
    }

    const latestRun = getAgentRun(requestedRunId);
    if (!latestRun) return sendStopRunNotFound(res, req, requestedRunId);
    if (TERMINAL_RUN_STATES.has(latestRun.state)) return sendStopAlreadyTerminal(res, req, latestRun);
    const latestCurrent = getCurrentAgentRun();
    if (!latestCurrent || latestCurrent.runId !== requestedRunId) {
      cancelRoguelikeStopIntent(requestedRunId);
      return sendStopTargetNotCurrent(res, req, requestedRunId, latestRun, latestCurrent?.runId || null);
    }
  }

  const task = stopCurrentTask();
  const scheduleStopped = stopScheduleExecution();
  const deviceStopRequested = task.success || scheduleStopped;
  const { run } = requestAgentRunStop(requestedRunId);
  return sendStopSuccess(res, req, run.runId, {
    task,
    scheduleStopped,
    stopRequested: true,
    deviceStopRequested,
    run
  }, '已发送终止请求');
}

async function stopCurrentExecution(
  res: ExecutionResponseWriter,
  req: MaybeApiRequest
): Promise<unknown> {
  releaseAllRoguelikeStopIntents();
  const task = stopCurrentTask();
  const scheduleStopped = stopScheduleExecution();
  const deviceStopRequested = task.success || scheduleStopped;
  const currentRun = getCurrentAgentRun();

  if (currentRun?.operationId === 'run_copilot_set') {
    const setStop = requestCopilotSetRunStop(currentRun.runId);
    if (setStop?.disposition === 'stopped' || setStop?.disposition === 'canceled') {
      const canceled = setStop.disposition === 'canceled';
      return sendStopSuccess(res, req, setStop.run.runId, {
        task,
        scheduleStopped,
        stopRequested: true,
        deviceStopRequested,
        ...(canceled ? { acceptedRunCanceled: true } : { waitingRunStopped: true }),
        run: setStop.run
      }, canceled ? '已取消尚未开始的作业集执行' : '作业集已停止，未开始下一关');
    }
  }

  if (currentRun?.operationId === 'run_copilot_queue') {
    const queueStop = requestCopilotQueueRunStop(currentRun.runId);
    if (queueStop?.disposition === 'stopped' || queueStop?.disposition === 'canceled') {
      const canceled = queueStop.disposition === 'canceled';
      return sendStopSuccess(res, req, queueStop.run.runId, {
        task,
        scheduleStopped,
        stopRequested: true,
        deviceStopRequested,
        ...(canceled ? { acceptedRunCanceled: true } : { waitingRunStopped: true }),
        run: queueStop.run
      }, canceled ? '已取消尚未开始的作业队列执行' : '作业队列已停止，未开始下一项');
    }
  }

  if (currentRun && ACTIVE_RUN_STATES.has(currentRun.state)) {
    const { run, disposition } = requestAgentRunStop(currentRun.runId);
    const acceptedRunCanceled = disposition === 'canceled';
    return sendStopSuccess(res, req, run.runId, {
      task,
      scheduleStopped,
      stopRequested: true,
      deviceStopRequested,
      ...(acceptedRunCanceled ? { acceptedRunCanceled: true } : {}),
      run
    }, acceptedRunCanceled ? '已取消尚未开始的执行' : '已发送终止请求');
  }

  return sendSuccess(res, req, {
    task,
    scheduleStopped,
    stopRequested: deviceStopRequested,
    deviceStopRequested,
    run: enrichAgentRun(currentRun)
  }, deviceStopRequested ? '已发送终止请求' : '当前没有可终止的任务');
}

export async function executeCopilotSet(
  req: ExecutionCopilotSetRequest,
  res: ExecutionResponseWriter
): Promise<unknown> {
  const setId = String(req.params.id || '').trim();
  if (!setId) {
    return sendError(res, req, agentError('AGENT_VALIDATION_COPILOT_SET_ID_REQUIRED', '作业集 id 不能为空', {
      statusCode: 400,
      retryable: false
    }));
  }
  const { mode, raid, selectedIndexes, options, waitForCompletion } =
    normalizeCopilotSetExecutionRequest(req.body || {});

  if (mode === 'manual') {
    return executeManualCopilotSet(req, res, { setId, raid, selectedIndexes, options, waitForCompletion });
  }
  return executeContinuousCopilotSet(req, res, { setId, raid, selectedIndexes, options, waitForCompletion });
}

export async function continueCopilotSetAction(
  req: ExecutionRequest,
  res: ExecutionResponseWriter
): Promise<unknown> {
  const runId = parseContinueRunId(req.body);
  const waitForCompletion = parseWaitForCompletion(readField(req.body, 'waitForCompletion'));
  return continueCopilotSet(req, res, { runId, waitForCompletion });
}

export async function executeSchedule(
  req: ExecutionScheduleRequest,
  res: ExecutionResponseWriter
): Promise<unknown> {
  const { scheduleId } = req.params;
  const requestBody = isRecord(req.body) ? req.body : {};
  const { taskFlow } = requestBody;
  if (!Array.isArray(taskFlow)) {
    return sendError(res, req, agentError('AGENT_VALIDATION_TASK_FLOW_INVALID', '任务流程格式无效', { statusCode: 400 }));
  }
  const waitForCompletion = parseWaitForCompletion(requestBody.waitForCompletion);
  return executeTrackedDailyFlow(req, res, {
    scheduleId,
    taskFlow,
    waitForCompletion,
    metadata: {
      taskName: `任务流程 ${scheduleId}`,
      taskType: 'schedule',
      scheduleId,
      trigger: 'schedule-api'
    },
    legacyBusyCode: 'AGENT_SCHEDULE_ALREADY_RUNNING',
    successMessage: result => resultMessage(result) || '任务流程执行完成'
  });
}

export async function startGame(
  req: ExecutionRequest,
  res: ExecutionResponseWriter
): Promise<unknown> {
  const waitForCompletion = parseWaitForCompletion(readField(req.body, 'waitForCompletion'));
  const { clientType, address } = await resolveRequestConnection(req, { allowOverrides: true })
  return executeTrackedAgentAction(req, res, {
    operationId: 'start_game',
    input: { clientType, address, waitForCompletion },
    waitForCompletion,
    metadata: { taskName: '启动游戏', taskType: 'agent' },
    execute: lifecycle => execMaaCommand(
      'startup',
      [clientType, '-a', address],
      '启动游戏',
      'agent',
      waitForCompletion,
      false,
      lifecycle
    ),
    successMessage: '游戏启动命令执行完成',
    acceptedMessage: '游戏启动命令已接受'
  });
}

export async function runDailyFlow(
  req: ExecutionRequest,
  res: ExecutionResponseWriter
): Promise<unknown> {
  const {
    dryRun,
    scheduleId,
    taskFlow: overrideTaskFlow,
    waitForCompletion
  } = normalizeDailyFlowRequest(req.body || {});
  const taskFlow = await loadAutomationTaskFlow(overrideTaskFlow);
  const planResult = await getScheduledTaskFlowPlan(taskFlow);
  if (!planResult.success) {
    const planError = createDailyFlowExecutionError(planResult);
    return sendError(res, req, planError ?? planResult);
  }
  const plan = planResult.steps;

  if (!plan.length) {
    return sendError(res, req, agentError('AGENT_VALIDATION_EMPTY_TASK_FLOW', '没有可执行的自动化任务', {
      statusCode: 400,
      details: { scheduleId },
      retryable: false
    }));
  }

  if (dryRun) {
    return sendSuccess(res, req, {
      dryRun: true,
      scheduleId,
      totalSteps: planResult.totalSteps,
      plan
    }, 'Dry run only', { dryRun: true });
  }

  return executeTrackedDailyFlow(req, res, {
    scheduleId,
    taskFlow,
    waitForCompletion,
    metadata: {
      taskName: `今日流程 ${scheduleId}`,
      taskType: 'schedule',
      scheduleId,
      trigger: 'agent-api'
    },
    successMessage: '今日流程执行完成',
    acceptedMessage: '今日流程已接受',
    extraResult: { plan }
  });
}

export async function runFight(
  req: ExecutionRequest,
  res: ExecutionResponseWriter
): Promise<unknown> {
  const body: FightOptions = isRecord(req.body) ? req.body : {};
  const { dryRun = false, ...requestOptions } = body;
  const waitForCompletion = parseWaitForCompletion(requestOptions.waitForCompletion);
  const fightOptions: FightOptions = { ...requestOptions };
  delete fightOptions.waitForCompletion;
  const stages = normalizeFightStages(fightOptions.stages, fightOptions.stage, fightOptions.times);
  if (!stages.length) {
    return sendError(res, req, agentError('AGENT_VALIDATION_MISSING_STAGES', '至少需要一个有效关卡', {
      statusCode: 400,
      details: { fightOptions },
      retryable: false
    }));
  }
  const fightValidation = validateGameTaskParams('Fight', {
    medicine: fightOptions.medicine,
    medicine_expire_days: fightOptions.medicineExpireDays,
    expiring_medicine: fightOptions.expiringMedicine,
    series: fightOptions.series
  });
  if (fightValidation) {
    return sendError(res, req, agentError('AGENT_VALIDATION_FIGHT_OPTIONS_INVALID', fightValidation, {
      statusCode: 400,
      details: { fightOptions },
      retryable: false
    }));
  }
  const hasLegacyExpiringMedicine = fightOptions.expiringMedicine !== undefined
    && fightOptions.expiringMedicine !== null
    && fightOptions.expiringMedicine !== '';
  const stageOptions: FightRequestOptions = {
    medicine: fightOptions.medicine ?? 0,
    ...(hasLegacyExpiringMedicine && fightOptions.medicineExpireDays === undefined
      ? { expiringMedicine: fightOptions.expiringMedicine }
      : { medicineExpireDays: fightOptions.medicineExpireDays ?? 0 }),
    stone: fightOptions.stone ?? 0,
    series: fightOptions.series ?? 0
  };
  const stagePlans = buildFightStagePlans(stages, stageOptions);
  const rawStages: unknown[] = Array.isArray(fightOptions.stages)
    ? fightOptions.stages
    : [{ stage: fightOptions.stage || '', times: fightOptions.times || '' }];
  const plan = {
    command: 'fight',
    args: stagePlans[0].args,
    stages: stagePlans,
    semantic: { stages: rawStages, ...stageOptions }
  };

  if (dryRun) {
    return sendDryRun(res, req, plan);
  }

  return executeTrackedAgentAction(req, res, {
    operationId: 'fight',
    input: { ...plan.semantic, waitForCompletion },
    waitForCompletion,
    metadata: { taskName: 'Agent: 理智作战', taskType: 'agent', plan },
    execute: async (lifecycle, { runId }) => {
      if (!waitForCompletion) {
        return startFightBackground({
          runId,
          stages,
          options: stageOptions,
          lifecycle,
          plan,
          acceptedResult: {
            success: true,
            accepted: true,
            stopped: false,
            command: 'fight',
            stdout: '',
            stderr: '',
            plan,
            message: '理智作战已接受'
          }
        });
      }
      const result = await executeFightStages({
        stages,
        options: stageOptions,
        taskName: 'Agent: 理智作战',
        lifecycle,
        shouldStop: () => isAgentRunStopRequested(runId)
      });
      return { ...result, plan };
    },
    successMessage: '理智作战执行完成',
    acceptedMessage: '理智作战已接受',
    stoppedMessage: result => resultMessage(result) || '理智作战已停止'
  });
}

interface RoguelikeResultTarget {
  command: 'roguelike' | 'reclamation';
  args: readonly string[];
  theme: string;
  startCount: number | null;
  mode: number | null;
}

interface RoguelikeResultCapture {
  target: RoguelikeResultTarget;
  checkpoint: MaaLogCheckpoint | null;
  started: boolean;
}

/** 肉鸽执行编排的可注入端口；默认实现连到真实租约、检查点与日志读取。 */
export interface RoguelikeTaskCapturePorts {
  acquireLease?(request: MaaExecutionLeaseRequest): Promise<MaaExecutionLease>;
  runWithLease?<T>(lease: MaaExecutionLease, callback: () => T): T;
  createCheckpoint?(): Promise<MaaLogCheckpoint | null>;
  readLogSince?(checkpoint: MaaLogCheckpoint | null): Promise<string>;
  startProgress?(input: RoguelikeProgressTrackerInput): boolean;
  finalizeProgress?(runId: string): Promise<RoguelikeProgressSnapshot | null>;
  releaseProgress?(runId: string): void;
}

/** 一次肉鸽/生息演算执行：调用方提供 Run 生命周期、租约元数据与实际执行函数。 */
export interface RoguelikeTaskCaptureRun {
  runId: string;
  target: RoguelikeResultTarget;
  lease: MaaExecutionLeaseRequest;
  waitForCompletion: boolean;
  lifecycle: TrackedExecutionLifecycle;
  execute(lifecycle: TrackedExecutionLifecycle): Promise<unknown>;
}

const ROGUELIKE_UNBOUNDED_START_COUNT = 2147483647;
const ROGUELIKE_START_COUNT_FLAGS = ['--starts-count', '--start-count'] as const;

function readSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function readStartCount(value: unknown): number | null {
  const count = readSafeInteger(value);
  return count !== null && count > 0 && count !== ROGUELIKE_UNBOUNDED_START_COUNT ? count : null;
}

function readIntegerText(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) return null;
  return readSafeInteger(Number(value));
}

function readCliIntegerArg(args: readonly string[], flags: readonly string[]): number | null {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const separator = token.indexOf('=');
    const flag = separator >= 0 ? token.slice(0, separator) : token;
    if (!flags.includes(flag)) continue;
    const value = separator >= 0 ? token.slice(separator + 1) : args[index + 1];
    const parsed = readIntegerText(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function resolveRoguelikeSettlementSupported(target: RoguelikeResultTarget): boolean | null {
  if (target.command === 'reclamation') return false;
  if (target.mode === null) return null;
  return target.mode === 0 || target.mode === 30001 || target.mode === 30003;
}

function resolveRoguelikeResultTarget(
  request: NormalizedAgentTaskRequest
): RoguelikeResultTarget | null {
  const taskConfig = request.taskConfig;
  if (taskConfig) {
    if (taskConfig.type !== 'Roguelike' && taskConfig.type !== 'Reclamation') return null;
    const theme = typeof taskConfig.params.theme === 'string' ? taskConfig.params.theme.trim() : '';
    return {
      command: taskConfig.type === 'Reclamation' ? 'reclamation' : 'roguelike',
      args: [theme],
      theme,
      startCount: readStartCount(taskConfig.params.starts_count),
      mode: readSafeInteger(taskConfig.params.mode)
    };
  }
  if (!isRoguelikeCommand(request.command)) return null;

  return {
    command: request.command,
    args: request.args,
    theme: request.args[0]?.trim() ?? '',
    startCount: readStartCount(readCliIntegerArg(request.args, ROGUELIKE_START_COUNT_FLAGS)),
    mode: readCliIntegerArg(request.args, ['--mode'])
  };
}

/** 租约元数据与执行器自行申请时保持一致，运行状态与诊断仍能看到真实任务。 */
function roguelikeTaskLeaseRequest(request: NormalizedAgentTaskRequest): MaaExecutionLeaseRequest {
  if (request.taskConfig) {
    return {
      source: request.taskType || 'dynamic-task',
      taskName: request.taskName || request.args[0]?.trim() || request.command,
      command: 'run'
    };
  }
  return {
    source: request.taskType || 'maa-command',
    taskName: request.taskName || request.command,
    command: request.command
  };
}

/**
 * 肉鸽/生息演算摘要只从本次执行新增的 MaaCore 日志读取。检查点在取得执行租约
 * 之后创建，摘要在释放租约之前采集：被设备占用拒绝的请求不会读到其它 Run 的
 * 日志，没有真正启动的执行直接跳过采集。检查点创建失败时保留执行本身，只是
 * 不产出摘要，不能用整份历史日志冒充本次结果。同一检查点也供进度跟踪器使用：
 * 跟踪器在 spawn 后启动，在释放租约之前收尾。
 */
export async function runRoguelikeTaskWithCapture(
  {
    runId,
    target,
    lease: leaseRequest,
    waitForCompletion,
    lifecycle,
    execute
  }: RoguelikeTaskCaptureRun,
  ports: RoguelikeTaskCapturePorts = {}
): Promise<unknown> {
  const acquireLease = ports.acquireLease || acquireMaaExecutionLease;
  const runWithLease = ports.runWithLease || runWithMaaExecutionLeaseContext;
  const createCheckpoint = ports.createCheckpoint || createMaaLogCheckpoint;
  const readLogSince = ports.readLogSince || readMaaLogSince;
  const startProgress = ports.startProgress || startRoguelikeProgressTracker;
  const finalizeProgress = ports.finalizeProgress || finalizeRoguelikeProgressTracker;
  const releaseProgress = ports.releaseProgress || releaseRoguelikeProgressTracker;
  const settlementSupported = resolveRoguelikeSettlementSupported(target);

  const lease = await acquireLease(leaseRequest);
  let released = false;
  const releaseLease = async (): Promise<void> => {
    if (released) return;
    released = true;
    await lease.release();
  };

  let capture: RoguelikeResultCapture;
  try {
    capture = { target, checkpoint: await createCheckpoint(), started: false };
  } catch (error) {
    logger.warn('创建肉鸽结果日志检查点失败', { error: errorMessageOf(error) });
    capture = { target, checkpoint: null, started: false };
  }

  let progressStarted = false;
  let progressFinalized = false;
  let progressSnapshot: RoguelikeProgressSnapshot | null = null;

  const finalizeProgressOnce = async (): Promise<RoguelikeProgressSnapshot | null> => {
    if (!progressStarted) return null;
    if (progressFinalized) return progressSnapshot;
    progressFinalized = true;
    try {
      progressSnapshot = await finalizeProgress(runId);
    } catch (error) {
      logger.warn('收尾肉鸽进度跟踪失败', { error: errorMessageOf(error) });
      progressSnapshot = null;
    }
    return progressSnapshot;
  };

  const readSummary = async (
    progress: RoguelikeProgressSnapshot | null
  ): Promise<RoguelikeResultSummary | null> => {
    if (!capture.started || !capture.checkpoint) return null;
    try {
      return buildRoguelikeResultSummary(await readLogSince(capture.checkpoint), target, progress);
    } catch (error) {
      logger.warn('读取肉鸽任务结果失败', { error: errorMessageOf(error) });
      return null;
    }
  };

  const settleWithSummary = lifecycle.onSettled && !waitForCompletion
    ? async (outcome: ExecutionOutcome): Promise<void> => {
        try {
          const progress = await finalizeProgressOnce();
          const summary = await readSummary(progress);
          const enriched: ExecutionOutcome = {
            ...outcome,
            result: attachRoguelikeResultSummary(outcome.result, summary),
            error: attachRoguelikeErrorSummary(outcome.error, summary)
          };
          await lifecycle.onSettled?.(enriched);
        } finally {
          releaseProgress(runId);
          await releaseLease();
        }
      }
    : null;

  const capturedLifecycle: TrackedExecutionLifecycle = {
    ...lifecycle,
    onStarted: () => {
      capture.started = true;
      if (!progressStarted && capture.checkpoint) {
        try {
          progressStarted = startProgress({
            runId,
            checkpoint: capture.checkpoint,
            command: target.command,
            theme: target.theme,
            mode: target.mode,
            targetRounds: target.startCount,
            settlementSupported,
            startedAtMs: Date.now()
          });
        } catch (error) {
          logger.warn('启动肉鸽进度跟踪失败', { error: errorMessageOf(error) });
        }
      }
      lifecycle.onStarted?.();
    },
    ...(settleWithSummary ? { onSettled: settleWithSummary } : {})
  };

  try {
    return await runWithLease(lease, async () => {
      try {
        const result = await execute(capturedLifecycle);
        if (!waitForCompletion) return result;
        const progress = await finalizeProgressOnce();
        return attachRoguelikeResultSummary(result, await readSummary(progress));
      } catch (error) {
        if (!waitForCompletion) throw error;
        const progress = await finalizeProgressOnce();
        throw attachRoguelikeErrorSummary(error, await readSummary(progress));
      }
    });
  } finally {
    // 后台执行把租约交给 settle 回调释放；同步完成、未启动与缺少 settle 的执行在此收尾。
    if (waitForCompletion || !capture.started || !settleWithSummary) {
      await finalizeProgressOnce();
      releaseProgress(runId);
      await releaseLease();
    }
  }
}

function agentTaskDependencies(lifecycle: TrackedExecutionLifecycle): AgentTaskDependencies {
  return {
    execMaaCommand: (execCommand, execArgs, execTaskName, execTaskType, shouldWait, silent = false) =>
      execMaaCommand(execCommand, execArgs, execTaskName, execTaskType, shouldWait, silent, lifecycle),
    execDynamicTask: (taskId, config: AgentTaskConfig, execTaskName, execTaskType, shouldWait, useUserResource) =>
      execDynamicTask(taskId, config, execTaskName, execTaskType, shouldWait, useUserResource, { lifecycle }),
    execDynamicTasks: (taskId, configs, execTaskName, execTaskType, shouldWait, useUserResource) =>
      execDynamicTasks(taskId, configs, execTaskName, execTaskType, shouldWait, useUserResource, { lifecycle })
  };
}

export async function runTask(
  req: ExecutionRequest,
  res: ExecutionResponseWriter
): Promise<unknown> {
  // 所有请求形状（TaskType、参数、命令组合）在创建 Run 之前完成校验；
  // 非法请求直接走统一错误出口，不占用设备、不写入执行记录。
  const request = preflightAgentTaskRequest(isRecord(req.body) ? req.body : {});
  const waitForCompletion = request.waitForCompletion;

  return executeTrackedAgentAction(req, res, {
    operationId: 'run_task',
    input: { ...(isRecord(req.body) ? req.body : {}), waitForCompletion },
    waitForCompletion,
    metadata: { taskName: request.taskName, taskType: request.taskType },
    execute: async (lifecycle, { runId }) => {
      const target = resolveRoguelikeResultTarget(request);
      if (!target) {
        return executePreflightAgentTask(request, agentTaskDependencies(lifecycle));
      }
      return runRoguelikeTaskWithCapture({
        runId,
        target,
        lease: roguelikeTaskLeaseRequest(request),
        waitForCompletion,
        lifecycle,
        execute: execLifecycle => executePreflightAgentTask(request, agentTaskDependencies(execLifecycle))
      });
    },
    successMessage: '任务执行完成',
    acceptedMessage: '任务已接受'
  });
}

export async function stopExecution(
  req: ExecutionRequest,
  res: ExecutionResponseWriter
): Promise<unknown> {
  const requestedRunId = parseRequestedRunId(req.body, req.query);
  const mode = parseStopRequestMode(readField(req.body, 'mode'));
  if (requestedRunId) return stopRequestedRun(res, req, requestedRunId, mode);
  return stopCurrentExecution(res, req);
}
