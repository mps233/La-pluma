import { getErrorCode, getErrorDetails, getErrorStatus, isRecord } from '../utils/errors.ts';
import { asErrorWithCode, getErrorMessage } from '../utils/errors.ts';
import express from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import {
  execMaaCommand,
  execDynamicTask,
  getMaaVersion,
  replaceActivityCode,
  getRealtimeLogs,
  getTaskStatus,
  stopCurrentTask,
  testAdbConnection,
  discoverAdbDevices,
  captureScreen,
  getMaaConfigDir,
  canUseMaaSelfUpdate,
  getConfig,
  saveConfig,
  getCurrentActivity,
  getLogFiles,
  readLogFile,
  cleanupLogs,
  getDebugScreenshots,
  clearRealtimeLogs
} from '../services/maaService.ts';
import { executeScheduleNow, getScheduledTaskFlowPlan, getScheduleExecutionStatus, stopScheduleExecution, getScheduleStatus, setupSchedule, stopSchedule, setupAutoUpdate, getAutoUpdateStatus } from '../services/schedulerService.ts';
import { loadUserConfig, saveUserConfig, getAllUserConfigs, deleteUserConfig } from '../services/configStorageService.ts';
import { getNotificationConfig, sendNotification, sendToChannel, testNotificationChannel, setNotificationConfig, getTodayOpenStages } from '../services/notificationService.ts';
import operatorTrainingService from '../services/operatorTrainingService.ts';
import { getMaaResourceInfo, updateMaaResources } from '../services/resourceUpdateService.ts';
import { getMaaCoreChannel, setMaaCoreChannel } from '../services/maaCliConfigService.ts';
import { buildCustomToolTaskConfig, listCustomTools } from '../services/customTaskService.ts';
import { parseDepotData, parseOperBoxData, getDepotData, getOperBoxData, getAllOperators } from '../services/dataParserService.ts';
import { summarizeAuxiliaryCallbacks } from '../services/maaCallbackService.ts';
import { getMaaLogPath } from '../config/paths.ts';
import { getTodayDrops, getRecentDrops, getDropStatistics, normalizeDropDays } from '../services/dropRecordService.ts';
import { loadParadoxOperators, resolveStageSearchKeyword } from '../services/copilotService.ts';
import { buildCopilotPlan, executeCopilotPlan, resetCopilotPlanProgress } from '../services/copilotPlanService.ts';
import { getActivityRunPreflight } from '../services/activityNavigationService.ts';
import { findActivityCopilotCandidates } from '../services/activityCopilotDiscoveryService.ts';
import { continueManualCopilotSet, getManualCopilotSetSession, startManualCopilotSet, stopManualCopilotSetRun } from '../services/copilotManualRunService.ts';
import { isResourceCollectionOpenNow } from '../services/activityDataService.ts';
import { getActivityCompletion, runCurrentActivityCopilots, runCurrentActivitySet } from '../services/activityCopilotRunService.ts';
import { withMaaExecutionLease, getMaaExecutionLeaseSnapshot } from '../services/executionCoordinatorService.ts';
import { createDailyFlowExecutionError, executeAgentTask, normalizeDailyFlowRequest, validateTaskConfig } from '../services/agentActionService.ts';
import {
  beginAgentRun,
  startAgentRun,
  markAgentRunStopping,
  completeAgentRun,
  failAgentRun,
  stopAgentRun,
  getAgentRun,
  listAgentRuns,
  getCurrentAgentRun,
  getLatestTerminalRun,
  releaseAgentRunIdempotency,
  setAgentRunAcceptedResult,
  updateAgentRunProgress,
  flushAgentRunStore,
  withFlushedAgentRunSnapshot
} from '../services/agentRunService.ts';
import type { ApiRequestLike, ApiResponseWriter } from '../utils/apiHelper.ts';
import type { AgentRunDto } from '../services/agentRunService.ts';
import {
  asyncHandler,
  agentError,
  sendSuccess,
  sendDryRun,
  sendError
} from '../utils/apiHelper.ts';
import { createLogger } from '../utils/logger.ts'
import { resolveConnectionInput } from '../services/connectionService.ts'
import { WEBRTC_SIGNALING_PATH } from '../services/webrtcSignalingGateway.ts'
import { DEFAULT_ADB_ADDRESS, DEFAULT_ADB_PATH, DEFAULT_CLIENT_TYPE, DEFAULT_MAA_CLI_PATH } from '../config/connectionDefaults.ts'
import { API_VERSION, buildAgentManifest, buildOpenApiSpec } from './agentContract.ts';
import {
  getWebrtcStatus,
  startWebrtcInstall,
  getWebrtcInstallState,
  startWebrtcServer,
  stopWebrtcServer,
  startWebrtcAgent,
  stopWebrtcAgent,
  startWebrtc,
  stopWebrtc,
  isWebrtcServerReachable,
  getWebrtcDevices,
  getWebrtcDeviceRecords,
  getWebrtcSnapshot,
  getWebrtcServerVersion,
  getWebrtcAgentVersionStatus,
  MINIMUM_WEBRTC_AGENT_VERSION,
  WEBRTC_PORT,
  DEFAULT_DEVICE_ADDRESS,
  DEFAULT_DEVICE_ID
} from '../services/webrtcService.ts';

const router = express.Router();
const execFileAsync = promisify(execFile);

/**
 * Query values arrive as strings. `Number('abc')` is NaN, and clamping NaN
 * with Math.min/Math.max keeps NaN, which later turns `slice(NaN)` into the
 * entire array. Always fall back to a real integer.
 */
function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

/** Small TTL memo for expensive, external-process status probes. */
function createTtlMemo<T>(ttlMs: number) {
  const values = new Map<string, { expiresAt: number; value: T }>();
  const pending = new Map<string, Promise<T>>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const cached = values.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;

    const promise = load()
      .then(value => {
        values.set(key, { expiresAt: Date.now() + ttlMs, value });
        return value;
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, promise);
    return promise;
  };
}

const memoMaaVersion = createTtlMemo<Awaited<ReturnType<typeof getMaaVersion>>>(60_000);
const memoAdbSummary = createTtlMemo<Awaited<ReturnType<typeof getAdbSummary>>>(5_000);
const memoWebrtcSummary = createTtlMemo<WebrtcSummary>(8_000);
const memoDisplayState = createTtlMemo<AndroidDisplayState>(5_000);

const SCREEN_FRAME_CACHE_TTL_MS = 500;
const SCREEN_FRAME_MAX_WIDTH = (() => {
  const value = Number(process.env.LA_PLUMA_SCREEN_FRAME_MAX_WIDTH || 720);
  return Number.isFinite(value) && value > 0 ? Math.min(1920, Math.trunc(value)) : 720;
})();
interface ScreenFrame {
  buffer: Buffer;
  mediaType: string;
}
const screenFrameCache = new Map<string, { expiresAt: number; value: ScreenFrame }>();
const screenFrameInFlight = new Map<string, Promise<ScreenFrame>>();

async function getScreenFrame(adbPath: string, address: string): Promise<ScreenFrame> {
  const key = `${adbPath}\u0000${address}`;
  const cached = screenFrameCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = screenFrameInFlight.get(key);
  if (pending) return pending;

  const promise = (async (): Promise<ScreenFrame> => {
    const screenshot = await captureScreen(adbPath, address, { skipDeviceProbe: true });
    const png = Buffer.from(screenshot.image, 'base64');
    try {
      const webp = await sharp(png)
        .resize({ width: SCREEN_FRAME_MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: 72, effort: 4 })
        .toBuffer();
      return { buffer: webp, mediaType: 'image/webp' };
    } catch {
      // Keep the original capture if the image codec cannot process it.
      return { buffer: png, mediaType: 'image/png' };
    }
  })().finally(() => {
    screenFrameInFlight.delete(key);
  });

  screenFrameInFlight.set(key, promise);
  const value = await promise;
  screenFrameCache.set(key, { expiresAt: Date.now() + SCREEN_FRAME_CACHE_TTL_MS, value });
  return value;
}

router.get('/screen/frame', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { adbPath, address } = await resolveRequestConnection(req, { allowOverrides: true });
  const frame = await getScreenFrame(adbPath, address);
  res.status(200);
  res.setHeader?.('Content-Type', frame.mediaType);
  res.setHeader?.('Content-Length', String(frame.buffer.length));
  res.setHeader?.('Cache-Control', 'no-store');
  (res as unknown as { end(body: Buffer): void }).end(frame.buffer);
}));

type AgentRequestBody = Record<string, unknown>;
type AgentQuery = Record<string, unknown>;

interface AgentRequest extends ApiRequestLike {
  body?: AgentRequestBody;
  query?: AgentQuery;
  params?: Record<string, string>;
  get?(name: string): string | undefined;
}

interface ResolvedConnection {
  profileId: string;
  adbPath: string;
  address: string;
  clientType: string;
}

interface ConnectionOverrides {
  allowOverrides?: boolean;
}

interface AdbSummary {
  adbPath: string;
  address: string;
  connected: boolean;
  message: string;
  foreground: string | null;
  devices: string;
}

interface WebrtcSummary {
  url: string;
  reachable: boolean;
  serverRunning: boolean;
  agentRunning: boolean;
  installed: boolean;
  built: boolean;
  note: string;
  [key: string]: unknown;
}

interface AndroidDisplayState {
  adbPath: string;
  address: string;
  rotation: number | null;
  accelerometerRotation: string | null;
  userRotation: string | null;
  width: number | null;
  height: number | null;
  inferredOrientation: 'landscape' | 'portrait' | null;
}

interface OrientationOptions {
  orientation?: unknown;
  adbPath?: string;
  address?: string;
}

interface OrientationCommand {
  command: string;
  args: string[];
}

interface OrientationCommandResult {
  ok: boolean;
  optional?: boolean;
  args: string[];
  stdout?: string;
  stderr?: string;
  error?: string;
}

interface FightStageInput {
  stages?: unknown;
  stage?: unknown;
  times?: unknown;
}

interface FightCommonInput {
  medicine?: unknown;
  expiringMedicine?: unknown;
  stone?: unknown;
  series?: unknown;
}

interface FightPlanningInput extends FightStageInput, FightCommonInput {
  medicineExpireDays?: unknown;
  drops?: unknown;
  server?: unknown;
  reportToPenguin?: unknown;
  reportToYituliu?: unknown;
  DrGrandet?: unknown;
  penguinId?: unknown;
  yituliuId?: unknown;
  clientType?: unknown;
}

interface NormalizedFightStage {
  stage: string;
  times: string;
}

interface FightPlan {
  stage: string;
  times: string;
  args: string[];
}

interface DynamicFightTask {
  name: string;
  type: string;
  params: Record<string, unknown> & { stage: string; times?: number };
}

interface DynamicFightPlan {
  name: string;
  type: string;
  client_type?: string;
  tasks: DynamicFightTask[];
}

interface GithubReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  prerelease?: unknown;
}

function toGithubReleases(value: unknown): GithubReleasePayload[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is GithubReleasePayload => isRecord(item));
}

interface ParadoxOperator {
  name: string;
  stage_id: string;
  [key: string]: unknown;
}

interface CopilotSearchItem {
  id?: unknown;
  content?: unknown;
  uploader_id?: unknown;
  views?: unknown;
  hot_score?: unknown;
  doc?: unknown;
}

type AgentResponse = ApiResponseWriter & {
  set?(name: string, value: string): unknown;
  setHeader?(name: string, value: string): unknown;
};

interface AgentRunLifecycle {
  runId: string;
  onStarted?: () => unknown;
  onProgress?: (progress: unknown, taskResults?: unknown[] | null) => unknown;
  onSettled?: (outcome: BackgroundOutcome) => unknown;
}

interface BackgroundOutcome {
  ok?: boolean;
  result?: unknown;
  error?: unknown;
  stopped?: boolean;
}

interface WebrtcDeviceRecord {
  id: string;
  online?: boolean;
  agentVersion?: string | null;
  screenState?: string | null;
}

function toWebrtcDeviceRecords(value: unknown): WebrtcDeviceRecord[] {
  if (!Array.isArray(value)) return [];
  const records: WebrtcDeviceRecord[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) continue;
    records.push({
      id: item.id,
      online: item.online !== false,
      agentVersion: typeof item.agentVersion === 'string' ? item.agentVersion : null,
      screenState: typeof item.screenState === 'string' ? item.screenState : null
    });
  }
  return records;
}

interface TrackedAgentActionOptions {
  operationId: string;
  input?: unknown;
  waitForCompletion?: boolean;
  metadata?: Record<string, unknown>;
  trigger?: unknown;
  execute: (lifecycle: AgentRunLifecycle) => Promise<unknown>;
  successMessage?: string;
  acceptedMessage?: string;
}

const logger = createLogger('AgentRoutes');

const ACTIVE_RUN_STATES = new Set(['accepted', 'waiting', 'running', 'stopping']);
const TERMINAL_RUN_STATES = new Set(['succeeded', 'failed', 'stopped', 'interrupted']);

export function buildWebrtcBrowserProtocol(deviceId: string) {
  return {
    websocket: `${WEBRTC_SIGNALING_PATH}/connect_client?token=`,
    connectMessage: { message_type: 'connect', device_id: deviceId },
    requestOfferPayload: { type: 'request-offer', ip_preference: 'ipv4' },
    candidatePolicy: 'relay preferred / ipv4'
  };
}

export function buildWebrtcDeviceStatus(records: WebrtcDeviceRecord[] = [], deviceId: string = DEFAULT_DEVICE_ID) {
  const device = records.find(record => record.id === deviceId) || null
  return {
    deviceId,
    devices: records.filter(record => record.online).map(record => record.id),
    agentVersion: device?.agentVersion || null,
    agentOnline: Boolean(device?.online),
    agentVersionStatus: getWebrtcAgentVersionStatus(device?.agentVersion),
    minimumAgentVersion: MINIMUM_WEBRTC_AGENT_VERSION,
    screenState: device?.screenState || null
  }
}

function getIdempotencyKey(req: AgentRequest): string | null {
  const value = req.get?.('Idempotency-Key')
    ?? req.headers?.['idempotency-key']
    ?? req.headers?.['Idempotency-Key'];
  return typeof value === 'string' ? value : null;
}

function setRunResponseHeaders(res: AgentResponse, run: AgentRunDto, replayed: boolean, includeLocation = false) {
  const headers: Record<string, string> = {
    'X-La-Pluma-Run-Id': run.runId,
    'Idempotency-Replayed': String(Boolean(replayed))
  };
  if (includeLocation) headers.Location = run.links.self;

  for (const [name, value] of Object.entries(headers) as Array<[string, string]>) {
    if (typeof res.set === 'function') res.set(name, value);
    else if (typeof res.setHeader === 'function') res.setHeader(name, value);
  }
}

function enrichAgentRun(run: AgentRunDto | null): AgentRunDto | null {
  if (!run || !ACTIVE_RUN_STATES.has(run.state)) return run;

  const schedule = getScheduleExecutionStatus();
  const task = getTaskStatus();
  if (run.operationId === 'run_daily_flow') {
    return {
      ...run,
      progress: {
        currentStep: schedule.currentStep,
        totalSteps: schedule.totalSteps,
        currentTask: schedule.currentTask,
        message: schedule.message || (schedule.isRunning ? '今日流程执行中' : '今日流程正在收尾')
      }
    };
  }
  const progress = isRecord(run.progress) ? run.progress : {};
  return {
    ...run,
    progress: {
      ...progress,
      currentStep: typeof progress.currentStep === 'number' ? progress.currentStep : null,
      totalSteps: typeof progress.totalSteps === 'number' ? progress.totalSteps : null,
      currentTask: typeof progress.currentTask === 'string' && progress.currentTask
        ? progress.currentTask
        : task.taskName,
      currentStage: typeof progress.currentStage === 'string' ? progress.currentStage : null,
      message: task.stopRequested
        ? '正在终止任务'
        : task.isRunning
          ? (typeof progress.message === 'string' && progress.message ? progress.message : '任务执行中')
          : '等待任务启动'
    }
  };
}

function runResponseData(result: unknown, run: AgentRunDto) {
  const base = result && typeof result === 'object' && !Array.isArray(result)
    ? { ...(result as Record<string, unknown>) }
    : { result };
  return {
    ...base,
    runId: run.runId,
    state: run.state,
    pollUrl: run.links.self,
    stopUrl: run.links.stop,
    run
  };
}

function sendRunSuccess(res: AgentResponse, req: AgentRequest, result: unknown, run: AgentRunDto, {
  message = '操作成功',
  replayed = false,
  accepted = false
}: { message?: string; replayed?: boolean; accepted?: boolean } = {}) {
  const enrichedRun = enrichAgentRun(run) || run;
  setRunResponseHeaders(res, enrichedRun, replayed, accepted);
  if (accepted) res.status(202);
  return sendSuccess(
    res,
    req,
    runResponseData(result, enrichedRun),
    message,
    { runId: enrichedRun.runId, idempotentReplay: replayed }
  );
}

function sendRunFailure(res: AgentResponse, req: AgentRequest, run: AgentRunDto, replayed = false) {
  const failure = run.error;
  const error = agentError(failure?.code || 'AGENT_RUN_FAILED', failure?.message || 'Agent run 执行失败', {
    statusCode: failure?.statusCode || 500,
    details: {
      ...(failure?.details || {}),
      runId: run.runId,
      run
    },
    retryable: failure?.retryable ?? false
  });
  setRunResponseHeaders(res, run, replayed);
  return sendError(res, req, error, undefined, { runId: run.runId, idempotentReplay: replayed });
}

function respondWithExistingRun(res: AgentResponse, req: AgentRequest, run: AgentRunDto, message = '返回已有执行') {
  if (run.state === 'failed' || run.state === 'interrupted') {
    return sendRunFailure(res, req, run, true);
  }
  const accepted = ACTIVE_RUN_STATES.has(run.state);
  return sendRunSuccess(res, req, run.result, run, {
    message,
    replayed: true,
    accepted
  });
}

function isPreExecutionError(error: unknown) {
  return getErrorCode(error) === 'MAA_EXECUTION_BUSY'
    || getErrorCode(error) === 'AGENT_EXECUTION_BUSY'
    || getErrorCode(error) === 'AGENT_SCHEDULE_ALREADY_RUNNING'
    || getErrorCode(error) === 'AGENT_DAILY_FLOW_REJECTED'
    || String(getErrorCode(error) || '').startsWith('AGENT_VALIDATION_');
}

async function settleBackgroundRun(runId: string, outcome: BackgroundOutcome) {
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
    logger.error('更新或持久化 Agent run 终态失败', { runId, error: getErrorMessage(error) });
    return getAgentRun(runId);
  }
}

async function persistAgentRunMutation(runId: string, context: string) {
  try {
    await flushAgentRunStore();
    return null;
  } catch (error) {
    logger.error(context, { runId, error: getErrorMessage(error) });
    return error;
  }
}

async function respondWithPersistedAgentRun(res: AgentResponse, req: AgentRequest, runId: string, context: string, respond: (run: AgentRunDto | null) => unknown) {
  try {
    return await withFlushedAgentRunSnapshot(runId, respond);
  } catch (error) {
    logger.error(context, { runId, error: getErrorMessage(error) });
    return sendRunPersistenceFailure(res, req, runId, error);
  }
}

function sendRunPersistenceFailure(res: AgentResponse, req: AgentRequest, runId: string, error: unknown) {
  const run = getAgentRun(runId);
  const persistenceError = agentError(
    getErrorCode(error) || 'AGENT_RUN_PERSISTENCE_FAILED',
    getErrorMessage(error) || 'Agent run 持久化失败',
    {
      statusCode: getErrorStatus(error) || 503,
      details: {
        ...(getErrorDetails(error) || {}),
        runId,
        run
      },
      retryable: asErrorWithCode(error).retryable ?? true
    }
  );
  return sendError(res, req, persistenceError, undefined, { runId });
}

function mergeBackgroundOutcome(outcome: BackgroundOutcome, acceptedResult: unknown): BackgroundOutcome {
  const accepted = acceptedResult && typeof acceptedResult === 'object' && !Array.isArray(acceptedResult)
    ? acceptedResult
    : { acceptedResult };
  const terminal = outcome?.result && typeof outcome.result === 'object' && !Array.isArray(outcome.result)
    ? outcome.result
    : { result: outcome?.result ?? null };
  return {
    ...outcome,
    result: { ...accepted, ...terminal }
  };
}

export async function executeTrackedAgentAction(req: AgentRequest, res: AgentResponse, {
  operationId,
  input,
  waitForCompletion = true,
  metadata = {},
  trigger = null,
  execute,
  successMessage = '操作成功',
  acceptedMessage = '任务已接受'
}: TrackedAgentActionOptions) {
  const reservation = beginAgentRun({
    operationId,
    idempotencyKey: getIdempotencyKey(req),
    input,
    metadata,
    trigger
  });
  if (reservation.replayed) {
    return respondWithPersistedAgentRun(
      res,
      req,
      reservation.run.runId,
      'Agent run 重放响应前持久化失败',
      (run: AgentRunDto | null) => respondWithExistingRun(res, req, run || reservation.run)
    );
  }

  const runId = reservation.run.runId;
  const admissionPersistenceError = await persistAgentRunMutation(
    runId,
    'Agent run 接受状态持久化失败，已阻止执行'
  );
  if (admissionPersistenceError) {
    const rejectedRun = failAgentRun(runId, admissionPersistenceError);
    releaseAgentRunIdempotency(runId);
    await persistAgentRunMutation(runId, 'Agent run 持久化失败终态写入失败');
    return sendRunFailure(res, req, rejectedRun);
  }

  const ensureRunStarted = () => {
    const run = getAgentRun(runId);
    return run?.state === 'accepted' ? startAgentRun(runId) : run;
  };
  let acceptedResult: unknown;
  let hasAcceptedResult = false;
  let pendingOutcome: BackgroundOutcome | null = null;
  const settleAcceptedBackgroundRun = async (outcome: BackgroundOutcome) => {
    if (!hasAcceptedResult) {
      pendingOutcome = outcome;
      return null;
    }
    return settleBackgroundRun(runId, mergeBackgroundOutcome(outcome, acceptedResult));
  };
  const lifecycle: AgentRunLifecycle = {
    runId,
    onStarted: ensureRunStarted,
    onProgress: (progress: unknown, taskResults: unknown[] | null = null) => {
      updateAgentRunProgress(runId, progress, taskResults);
      return getAgentRun(runId);
    },
    ...(!waitForCompletion ? { onSettled: settleAcceptedBackgroundRun } : {})
  };

  try {
    const result = await execute(lifecycle);
    acceptedResult = result;
    hasAcceptedResult = true;
    if (pendingOutcome) {
      const outcome = pendingOutcome;
      pendingOutcome = null;
      await settleAcceptedBackgroundRun(outcome);
    }
    let run = getAgentRun(runId)!;
    if (!waitForCompletion && ACTIVE_RUN_STATES.has(run.state)) {
      run = setAgentRunAcceptedResult(runId, result);
    }
    if (waitForCompletion && !TERMINAL_RUN_STATES.has(run.state)) {
      run = run.state === 'stopping'
        ? stopAgentRun(runId, result)
        : completeAgentRun(runId, result);
    }
    return respondWithPersistedAgentRun(
      res,
      req,
      runId,
      'Agent run 响应状态持久化失败',
      (persistedRun: AgentRunDto | null) => {
        run = persistedRun || run;
        if (run.state === 'failed' || run.state === 'interrupted') {
          return sendRunFailure(res, req, run);
        }
        if (run.state === 'stopped') {
          return sendRunSuccess(res, req, run.result, run, { message: '任务已终止' });
        }
        const accepted = !waitForCompletion && ACTIVE_RUN_STATES.has(run.state);
        return sendRunSuccess(res, req, TERMINAL_RUN_STATES.has(run.state) ? run.result : result, run, {
          message: accepted ? acceptedMessage : successMessage,
          accepted
        });
      }
    );
  } catch (error) {
    const current = getAgentRun(runId);
    if (isPreExecutionError(error) && current && !TERMINAL_RUN_STATES.has(current.state)) {
      const rejectedRun = failAgentRun(runId, error);
      releaseAgentRunIdempotency(runId);
      const persistenceError = await persistAgentRunMutation(runId, 'Agent run 拒绝状态持久化失败');
      if (persistenceError) return sendRunPersistenceFailure(res, req, runId, persistenceError);
      return sendRunFailure(res, req, rejectedRun);
    }
    const run = asErrorWithCode(error).stopped || current?.state === 'stopping'
      ? stopAgentRun(runId, {
          message: getErrorMessage(error),
          exitCode: asErrorWithCode(error).exitCode ?? null,
          signal: asErrorWithCode(error).signal ?? null
        })
      : failAgentRun(runId, error);
    return respondWithPersistedAgentRun(
      res,
      req,
      runId,
      'Agent run 终态持久化失败',
      (persistedRun: AgentRunDto | null) => {
        const terminalRun = persistedRun || run;
        if (terminalRun.state === 'stopped') {
          return sendRunSuccess(res, req, terminalRun.result, terminalRun, { message: '任务已终止' });
        }
        return sendRunFailure(res, req, terminalRun);
      }
    );
  }
}

function parseWaitForCompletion(value: unknown, defaultValue = true): boolean {
  const normalized = value ?? defaultValue;
  if (typeof normalized !== 'boolean') {
    throw agentError('AGENT_VALIDATION_WAIT_FOR_COMPLETION_INVALID', 'waitForCompletion 必须是布尔值', {
      statusCode: 400,
      details: { receivedType: typeof normalized },
      retryable: false
    });
  }
  return normalized;
}

function sendConfigStorageError(res: AgentResponse, req: AgentRequest, result: unknown, fallbackCode: string, fallbackMessage: string) {
  const resultRecord = isRecord(result) ? result : {};
  const errorRecord = isRecord(resultRecord.error) ? resultRecord.error : {};
  const invalidType = errorRecord.code === 'AGENT_CONFIG_TYPE_INVALID';
  const message = typeof resultRecord.message === 'string' && resultRecord.message
    ? resultRecord.message
    : fallbackMessage;
  return sendError(res, req, agentError(
    invalidType ? 'AGENT_CONFIG_TYPE_INVALID' : fallbackCode,
    message,
    {
      statusCode: invalidType ? 400 : 500,
      details: errorRecord.details || {},
      retryable: !invalidType
    }
  ));
}

function buildRecognitionFailure(result: unknown, fallbackCode: string, fallbackMessage: string) {
  const record = isRecord(result) ? result : {};
  const failure = isRecord(record.error) ? record.error : {};
  return agentError(
    typeof failure.code === 'string' && failure.code ? failure.code : fallbackCode,
    typeof record.message === 'string' && record.message ? record.message : fallbackMessage,
    {
      statusCode: typeof failure.statusCode === 'number' && failure.statusCode ? failure.statusCode : 500,
      details: failure.details || {},
      retryable: typeof failure.retryable === 'boolean' ? failure.retryable : true
    }
  );
}

function extractServiceResult(result: unknown): { data: unknown; message: string } {
  const record = isRecord(result) ? result : {};
  return {
    data: record.data || result,
    message: typeof record.message === 'string' && record.message ? record.message : '操作成功'
  };
}

async function getAdbSummary(adbPath: string = DEFAULT_ADB_PATH, address: string = DEFAULT_ADB_ADDRESS): Promise<AdbSummary> {
  const connection = await testAdbConnection(adbPath, address);
  let foreground: string | null = null;
  let devices = '';

  try {
    const { stdout } = await execFileAsync(adbPath, ['devices', '-l'], { timeout: 5000 });
    devices = stdout.trim();
  } catch (error) {
    devices = `adb devices failed: ${getErrorMessage(error)}`;
  }

  if (connection.connected || connection.success) {
    try {
      const { stdout } = await execFileAsync(adbPath, ['-s', address, 'shell', 'dumpsys', 'window', 'windows'], { timeout: 7000, maxBuffer: 1024 * 1024 });
      const focusLine = stdout.split('\n').find(line => line.includes('mCurrentFocus') || line.includes('mFocusedApp')) || '';
      foreground = focusLine.trim() || null;
    } catch {
      foreground = null;
    }
  }

  return {
    adbPath,
    address,
    connected: !!(connection.connected || connection.success),
    message: connection.message,
    foreground,
    devices
  };
}

async function getWebrtcSummary(
  address: string = DEFAULT_DEVICE_ADDRESS,
  adbPath: string = DEFAULT_ADB_PATH,
  { agentRunning = null }: { agentRunning?: boolean | null } = {}
): Promise<WebrtcSummary> {
  const status = await getWebrtcStatus(address, adbPath, { agentRunning }).catch(() => null);
  const statusRecord: Record<string, unknown> = isRecord(status) ? status : {};
  // getWebrtcStatus already probes reachability. Only fall back to a second
  // probe when the status call itself failed.
  const reachable = isRecord(status)
    ? Boolean(statusRecord.reachable || statusRecord.serverRunning)
    : await isWebrtcServerReachable().catch(() => false);
  return {
    ...statusRecord,
    url: typeof statusRecord.url === 'string' && statusRecord.url
      ? statusRecord.url
      : `http://127.0.0.1:${WEBRTC_PORT}`,
    reachable,
    serverRunning: Boolean(statusRecord.serverRunning || reachable),
    agentRunning: Boolean(statusRecord.agentRunning),
    installed: Boolean(statusRecord.installed),
    built: Boolean(statusRecord.built),
    note: reachable ? 'WebRTC page is reachable. Use browser UI to connect the device.' : 'WebRTC page is not reachable. Start it from /api/agent/webrtc/start or the Web UI.'
  }
}

async function resolveRequestConnection(req: AgentRequest, { allowOverrides = false }: ConnectionOverrides = {}): Promise<ResolvedConnection> {
  const input: Record<string, unknown> = { ...(req.query || {}), ...(req.body || {}) }
  return resolveConnectionInput(input, { allowOverrides })
}

function pngDimensions(base64: string) {
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length >= 24 && buffer.toString('ascii', 12, 16) === 'IHDR') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
  } catch {
    // best-effort metadata only
  }
  return { width: null, height: null };
}

async function getAndroidDisplayState(adbPath: string = DEFAULT_ADB_PATH, address: string = DEFAULT_ADB_ADDRESS): Promise<AndroidDisplayState> {
  const readSetting = async (name: string): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync(adbPath, ['-s', address, 'shell', 'settings', 'get', 'system', name], { timeout: 5000 });
      return stdout.trim();
    } catch {
      return null;
    }
  };

  let display = '';
  try {
    const { stdout } = await execFileAsync(adbPath, ['-s', address, 'shell', 'dumpsys', 'display'], { timeout: 7000, maxBuffer: 512 * 1024 });
    display = stdout;
  } catch {
    display = '';
  }

  const rotationMatch = display.match(/mCurrentOrientation\s*=\s*(\d+)/)
    || display.match(/mDisplayInfo=.*?rotation\s+(\d+)/)
    || display.match(/rotation\s*=\s*(\d+)/i);
  const sizeMatch = display.match(/real\s+(\d+)\s+x\s+(\d+)/i)
    || display.match(/logicalWidth=(\d+).*?logicalHeight=(\d+)/s);
  const width = sizeMatch ? Number(sizeMatch[1]) : null;
  const height = sizeMatch ? Number(sizeMatch[2]) : null;

  return {
    adbPath,
    address,
    rotation: rotationMatch ? Number(rotationMatch[1]) : null,
    accelerometerRotation: await readSetting('accelerometer_rotation'),
    userRotation: await readSetting('user_rotation'),
    width,
    height,
    inferredOrientation: width && height ? (width > height ? 'landscape' : 'portrait') : null
  };
}

function buildOrientationPlan({ orientation, adbPath = DEFAULT_ADB_PATH, address = DEFAULT_ADB_ADDRESS }: OrientationOptions = {}) {
  const normalized = String(orientation || '').trim().toLowerCase();
  const rotationByOrientation: Record<string, string> = { portrait: '0', landscape: '1' };

  if (!['portrait', 'landscape', 'auto'].includes(normalized)) {
    throw agentError('AGENT_VALIDATION_ORIENTATION_INVALID', 'orientation 必须是 portrait、landscape 或 auto', {
      statusCode: 400,
      details: { orientation },
      retryable: false
    });
  }

  const commands: string[][] = normalized === 'auto'
    ? [
        ['settings', 'put', 'system', 'accelerometer_rotation', '1']
      ]
    : [
        ['settings', 'put', 'system', 'accelerometer_rotation', '0'],
        ['settings', 'put', 'system', 'user_rotation', rotationByOrientation[normalized]],
        ['cmd', 'window', 'set-user-rotation', 'lock', rotationByOrientation[normalized]]
      ];

  return {
    action: 'preview-orientation',
    orientation: normalized,
    adbPath,
    address,
    commands: commands.map((args): OrientationCommand => ({ command: adbPath, args: ['-s', address, 'shell', ...args] }))
  };
}

async function setAndroidOrientation(options: OrientationOptions = {}) {
  const plan = buildOrientationPlan(options);
  const results: OrientationCommandResult[] = [];

  for (const item of plan.commands) {
    try {
      const { stdout, stderr } = await execFileAsync(item.command, item.args, { timeout: 7000, maxBuffer: 256 * 1024 });
      results.push({ ok: true, args: item.args, stdout: stdout.trim(), stderr: stderr.trim() });
    } catch (error) {
      const optionalCmdWindow = item.args.includes('cmd') && item.args.includes('window') && item.args.includes('set-user-rotation');
      results.push({ ok: optionalCmdWindow, optional: optionalCmdWindow, args: item.args, error: getErrorMessage(error), stdout: String(asErrorWithCode(error).stdout || '').trim(), stderr: String(asErrorWithCode(error).stderr || '').trim() });
      if (!optionalCmdWindow) throw error;
    }
  }

  await new Promise<void>(resolve => { setTimeout(() => resolve(), 500); });
  return {
    ...plan,
    results,
    observed: await getAndroidDisplayState(plan.adbPath, plan.address)
  };
}

function normalizeFightStages({ stages, stage, times }: FightStageInput = {}): NormalizedFightStage[] {
  const rawStages: unknown[] = Array.isArray(stages) ? stages : [{ stage: stage || '', times: times || '' }];
  return rawStages
    .map(item => typeof item === 'string' ? { stage: item, times: '' } : item)
    .filter((item): item is Record<string, unknown> => isRecord(item) && Boolean(item.stage) && Boolean(String(item.stage).trim()))
    .map(item => ({
      stage: String(item.stage).trim(),
      times: item.times !== undefined && item.times !== null ? String(item.times) : ''
    }));
}

function buildFightCommonArgs({ medicine = 0, expiringMedicine = 0, stone = 0, series = 0 }: FightCommonInput = {}) {
  const args: string[] = [];
  if (medicine !== undefined && medicine !== '' && medicine !== null) args.push('-m', String(medicine));
  if (expiringMedicine !== undefined && expiringMedicine !== '' && expiringMedicine !== null) args.push('--expiring-medicine', String(expiringMedicine));
  if (stone !== undefined && stone !== '' && stone !== null) args.push('--stone', String(stone));
  if (series !== undefined && series !== '' && series !== null && String(series) !== '1') args.push('--series', String(series));
  return args;
}

export function buildFightPlans(input: FightPlanningInput = {}): FightPlan[] {
  const commonArgs = buildFightCommonArgs(input);
  return normalizeFightStages(input).map(({ stage, times }) => {
    const args: string[] = [stage];
    if (times !== '') args.push('--times', times);
    args.push(...commonArgs);
    return { stage, times, args };
  });
}

function normalizeFightDropMap(drops: unknown): Record<string, number> | null {
  if (drops === undefined || drops === null || drops === '') return null;
  if (isRecord(drops)) {
    const entries = Object.entries(drops);
    if (entries.length === 0) return null;
    const normalized: Record<string, number> = {};
    for (const [itemId, count] of entries) {
      const numeric = Number(count);
      if (!/^[A-Za-z0-9_-]+$/.test(itemId) || !Number.isFinite(numeric) || numeric <= 0) {
        throw new Error('掉落目标格式应为物品 ID=数量，多个目标用逗号分隔');
      }
      normalized[itemId] = numeric;
    }
    return normalized;
  }
  const normalized: Record<string, number> = {};
  for (const entry of String(drops).split(',').map(value => value.trim()).filter(Boolean)) {
    const match = entry.match(/^([A-Za-z0-9_-]+)\s*=\s*(\d+)$/);
    if (!match || Number(match[2]) <= 0) {
      throw new Error('掉落目标格式应为物品 ID=数量，多个目标用逗号分隔');
    }
    normalized[match[1]] = Number(match[2]);
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function needsDynamicFight(input: FightPlanningInput = {}) {
  const medicineExpireDays = Number(input.medicineExpireDays ?? 0);
  const series = Number(input.series ?? 1);
  const drops = input.drops;
  return (Number.isFinite(medicineExpireDays) && medicineExpireDays > 0)
    || Boolean(String(input.server || '').trim())
    || (drops !== undefined && drops !== null && drops !== ''
      && (typeof drops !== 'object' || Object.keys(drops).length > 0))
    || input.reportToPenguin === true
    || input.reportToYituliu === true
    || input.DrGrandet === true
    || Boolean(String(input.clientType || '').trim())
    || (Number.isFinite(series) && series > 6);
}

export function buildDynamicFightPlan(
  input: FightPlanningInput = {},
  resolvedStages: NormalizedFightStage[] | null = null
): DynamicFightPlan | null {
  const stages: NormalizedFightStage[] = Array.isArray(resolvedStages) ? resolvedStages : normalizeFightStages(input);
  if (stages.length === 0) return null;
  const common: Record<string, unknown> = {};
  if (input.medicine !== undefined && input.medicine !== '' && input.medicine !== null) {
    common.medicine = Number(input.medicine);
  }
  if (input.medicineExpireDays !== undefined && input.medicineExpireDays !== '' && input.medicineExpireDays !== null) {
    common.medicine_expire_days = Number(input.medicineExpireDays);
  }
  if (input.expiringMedicine !== undefined && input.expiringMedicine !== '' && input.expiringMedicine !== null) {
    common.expiring_medicine = Number(input.expiringMedicine);
  }
  if (input.stone !== undefined && input.stone !== '' && input.stone !== null) {
    common.stone = Number(input.stone);
  }
  if (input.series !== undefined && input.series !== '' && input.series !== null) {
    common.series = Number(input.series);
  }
  const drops = normalizeFightDropMap(input.drops);
  if (drops) common.drops = drops;
  if (String(input.server || '').trim()) common.server = String(input.server).trim();
  if (typeof input.DrGrandet === 'boolean') common.DrGrandet = input.DrGrandet;
  if (typeof input.reportToPenguin === 'boolean') common.report_to_penguin = input.reportToPenguin;
  if (typeof input.penguinId === 'string' && input.penguinId.trim()) common.penguin_id = input.penguinId.trim();
  if (typeof input.reportToYituliu === 'boolean') common.report_to_yituliu = input.reportToYituliu;
  if (typeof input.yituliuId === 'string' && input.yituliuId.trim()) common.yituliu_id = input.yituliuId.trim();

  const tasks: DynamicFightTask[] = stages.map(({ stage, times }) => ({
    name: `Agent: 理智作战 (${stage})`,
    type: 'Fight',
    params: {
      ...common,
      stage,
      ...(times !== '' ? { times: Number(times) } : {})
    }
  }));
  return {
    name: 'Agent: 理智作战',
    type: 'Fight',
    ...(input.clientType ? { client_type: String(input.clientType) } : {}),
    tasks
  };
}

async function loadAutomationTaskFlow(overrideTaskFlow: unknown = null): Promise<unknown[]> {
  if (Array.isArray(overrideTaskFlow)) return overrideTaskFlow;
  const saved = await loadUserConfig('automation-tasks');
  if (!isRecord(saved) || !saved.success || !isRecord(saved.data)) return [];
  return Array.isArray(saved.data.taskFlow) ? saved.data.taskFlow : [];
}

async function buildAgentStatus(req: AgentRequest) {
  const connection = await resolveRequestConnection(req, { allowOverrides: true })
  const { adbPath, address } = connection
  const [version, adb, webrtc, orientation] = await Promise.all([
    memoMaaVersion('default', () => getMaaVersion(true)).catch((error: unknown) => ({ error: getErrorMessage(error) })),
    memoAdbSummary(`${adbPath}\u0000${address}`, () => getAdbSummary(adbPath, address))
      .catch((error: unknown) => ({ connected: false, error: getErrorMessage(error), adbPath, address })),
    memoWebrtcSummary(`${adbPath}\u0000${address}`, () => getWebrtcSummary(address, adbPath)),
    memoDisplayState(`${adbPath}\u0000${address}`, () => getAndroidDisplayState(adbPath, address))
      .catch((error: unknown) => ({ error: getErrorMessage(error), adbPath, address }))
  ]);
  const task = getTaskStatus();
  const logs = getRealtimeLogs(25);
  const recommendations: string[] = [];

  if (!adb.connected) recommendations.push(`ADB 未连接：检查模拟器和 ${address}`);
  if (task.isRunning) recommendations.push('MAA 当前有任务运行，避免并发启动新任务');
  if (!webrtc.reachable) recommendations.push('WebRTC 实时预览未启动，可启动 WebRTC 服务');
  if (adb.connected && !task.isRunning) recommendations.push('可以执行 start-game 或 run-task');

  return {
    api: {
      name: 'la-pluma-agent-api',
      version: API_VERSION,
      manifest: '/api/agent/manifest',
      openapi: '/api/agent/openapi.json'
    },
    maa: {
      version,
      task
    },
    device: adb,
    screen: {
      webrtc,
      orientation
    },
    recentLogs: logs,
    recommendations
  };
}

router.get('/manifest', (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, buildAgentManifest({
    adbPath: DEFAULT_ADB_PATH,
    adbAddress: DEFAULT_ADB_ADDRESS,
    clientType: DEFAULT_CLIENT_TYPE
  }));
});

router.get('/openapi.json', (_req: AgentRequest, res: AgentResponse) => {
  res.json(buildOpenApiSpec({
    adbPath: DEFAULT_ADB_PATH,
    adbAddress: DEFAULT_ADB_ADDRESS,
    clientType: DEFAULT_CLIENT_TYPE
  }));
});

router.get('/status', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const query = req.query || {};
  if (query.slim === 'true' || query.slim === '1') {
    const { adbPath, address } = await resolveRequestConnection(req, { allowOverrides: true });
    const version = await memoMaaVersion('default', () => getMaaVersion(true))
      .catch((error: unknown) => ({ error: getErrorMessage(error) }));
    return sendSuccess(res, req, {
      api: { name: 'la-pluma-agent-api', version: API_VERSION },
      maa: { version, task: getTaskStatus() },
      connection: { adbPath, address }
    });
  }
  return sendSuccess(res, req, await buildAgentStatus(req));
}));

router.get('/runs/current', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const query = req.query || {};
  const lines = parseBoundedInt(query.lines, 80, 1, 500);
  const task = getTaskStatus();
  const schedule = getScheduleExecutionStatus();
  const recentLogs = getRealtimeLogs(lines);
  const currentRun = enrichAgentRun(getCurrentAgentRun());
  const lease = await getMaaExecutionLeaseSnapshot();
  const lastRun = getLatestTerminalRun();
  return sendSuccess(res, req, {
    ...task,
    schedule,
    recentLogs,
    run: currentRun,
    lastRun,
    lease
  });
}));

router.get('/runs/:runId', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const run = getAgentRun(req.params!.runId);
  if (!run) {
    return sendError(res, req, agentError('AGENT_RUN_NOT_FOUND', `未找到 Agent run: ${req.params!.runId}`, {
      statusCode: 404,
      details: { runId: req.params!.runId },
      retryable: false
    }));
  }
  return sendSuccess(res, req, enrichAgentRun(run));
}));

router.post('/runs/:runId/stop', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const runId = req.params!.runId;
  const run = getAgentRun(runId);
  if (!run) {
    return sendError(res, req, agentError('AGENT_RUN_NOT_FOUND', `未找到 Agent run: ${runId}`, {
      statusCode: 404,
      details: { runId },
      retryable: false
    }));
  }
  if (TERMINAL_RUN_STATES.has(run.state)) {
    return sendSuccess(res, req, { stopped: false, alreadyTerminal: true, run: enrichAgentRun(run) }, '任务已经结束');
  }
  const manualStopped = run.state === 'waiting' ? stopManualCopilotSetRun(runId) : null;
  if (manualStopped) {
    return respondWithPersistedAgentRun(res, req, runId, '停止手动作业集时持久化失败', (persistedRun: AgentRunDto | null) =>
      sendSuccess(res, req, {
        stopped: true,
        run: enrichAgentRun(persistedRun || manualStopped)
      }, '手动作业集已停止')
    );
  }
  if (run.state === 'accepted') {
    const stopped = stopAgentRun(runId, { canceled: true });
    releaseAgentRunIdempotency(runId);
    return respondWithPersistedAgentRun(res, req, runId, '取消尚未开始的 Agent run 时持久化失败', (persistedRun: AgentRunDto | null) =>
      sendSuccess(res, req, {
        stopped: true,
        acceptedRunCanceled: true,
        run: enrichAgentRun(persistedRun || stopped)
      }, '已取消尚未开始的执行')
    );
  }
  const current = getCurrentAgentRun();
  if (!current || current.runId !== runId) {
    return sendError(res, req, agentError('AGENT_RUN_NOT_CURRENT', '目标 run 不是当前执行，未发送终止命令', {
      statusCode: 409,
      details: { runId, currentRunId: current?.runId || null },
      retryable: false
    }));
  }
  const task = stopCurrentTask();
  const scheduleStopped = stopScheduleExecution();
  const stopRequested = task.success || scheduleStopped;
  let updated = getAgentRun(runId) || run;
  if (stopRequested && ACTIVE_RUN_STATES.has(updated.state) && updated.state !== 'stopping') {
    updated = markAgentRunStopping(runId);
  }
  return respondWithPersistedAgentRun(res, req, runId, 'Agent run 停止状态持久化失败', (persistedRun: AgentRunDto | null) =>
    sendSuccess(res, req, {
      task,
      scheduleStopped,
      stopRequested,
      run: enrichAgentRun(persistedRun || updated)
    }, stopRequested ? '已发送终止请求' : '没有可终止的当前任务')
  );
}));

router.get('/tasks/status', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, getTaskStatus());
}));

router.post('/screen/screenshot', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { adbPath, address, profileId } = await resolveRequestConnection(req, { allowOverrides: true })
  const screenshot = await captureScreen(adbPath, address);
  return sendSuccess(res, req, {
    ...screenshot,
    ...pngDimensions(screenshot.image),
    mediaType: 'image/png',
    adbPath,
    address,
    profileId
  });
}));

router.get('/logs/maa-callbacks', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const query = req.query || {};
  const lines = parseBoundedInt(query.lines, 2000, 1, 5000);
  const logPath = getMaaLogPath();
  try {
    const result = await readLogFile(logPath, lines);
    return sendSuccess(res, req, {
      ...summarizeAuxiliaryCallbacks(result.content),
      logPath,
      totalLines: result.totalLines,
      returnedLines: result.returnedLines
    });
  } catch (error) {
    return sendError(res, req, agentError('AGENT_MAA_LOG_UNAVAILABLE', `无法读取 MAA 日志: ${getErrorMessage(error)}`, {
      statusCode: 500,
      details: { logPath },
      retryable: true
    }));
  }
}));

router.get('/logs/recent', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const query = req.query || {};
  const lines = parseBoundedInt(query.lines, 80, 1, 500);
  const afterSequence = parseBoundedInt(query.afterSequence, 0, 0, Number.MAX_SAFE_INTEGER);
  return sendSuccess(res, req, getRealtimeLogs(lines, afterSequence));
}));

router.post('/logs/recent/clear', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  clearRealtimeLogs();
  return sendSuccess(res, req, null, '实时日志已清空');
}));

router.get('/debug-screenshots', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, await getDebugScreenshots());
}));

router.get('/logs/files', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, await getLogFiles());
}));

router.get('/logs/files/:filePath(*)', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { filePath } = req.params!;
  const query = req.query || {};
  const lines = parseBoundedInt(query.lines, 1000, 1, 5000);
  return sendSuccess(res, req, await readLogFile(decodeURIComponent(filePath), lines));
}));

router.post('/logs/cleanup', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const maxSizeMB = Number(req.body?.maxSizeMB ?? 10);
  if (!Number.isFinite(maxSizeMB) || maxSizeMB < 1 || maxSizeMB > 1024) {
    return sendError(res, req, agentError(
      'AGENT_VALIDATION_LOG_SIZE_INVALID',
      '日志保留上限必须在 1 到 1024 MB 之间',
      { statusCode: 400, details: { maxSizeMB: req.body?.maxSizeMB } }
    ));
  }
  const result = await cleanupLogs(maxSizeMB);
  return sendSuccess(res, req, result, `已清理 ${result.deletedCount} 个日志文件，释放 ${(result.freedSpace / 1024 / 1024).toFixed(2)} MB 空间`);
}));

router.get('/config/maa/:profileName', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, await getConfig(req.params!.profileName));
}));

router.post('/config/maa/:profileName', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  await saveConfig(req.params!.profileName, req.body || {});
  return sendSuccess(res, req, null, '配置保存成功');
}));

router.get('/config/user/:configType', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const result = await loadUserConfig(req.params!.configType);
  if (!result.success) {
    return sendConfigStorageError(res, req, result, 'AGENT_CONFIG_LOAD_FAILED', '读取配置失败');
  }
  return sendSuccess(res, req, result.data, result.message || '操作成功');
}));

router.post('/config/user/:configType', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const result = await saveUserConfig(req.params!.configType, req.body);
  if (!result.success) {
    return sendConfigStorageError(res, req, result, 'AGENT_CONFIG_SAVE_FAILED', '保存配置失败');
  }
  return sendSuccess(res, req, null, result.message || '配置保存成功');
}));

router.get('/config/user', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const result = await getAllUserConfigs();
  if (!result.success) {
    return sendConfigStorageError(res, req, result, 'AGENT_CONFIG_LIST_FAILED', '获取配置列表失败');
  }
  return sendSuccess(res, req, result.data || {}, result.message || '操作成功');
}));

router.delete('/config/user/:configType', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const result = await deleteUserConfig(req.params!.configType);
  if (!result.success) {
    return sendConfigStorageError(res, req, result, 'AGENT_CONFIG_DELETE_FAILED', '删除配置失败');
  }
  return sendSuccess(res, req, null, result.message || '配置删除成功');
}));

router.get('/activity', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const activityInfo = await getCurrentActivity(clientType);
  const completion = await getActivityCompletion(activityInfo);
  return sendSuccess(res, req, {
    code: activityInfo.code,
    name: activityInfo.name,
    source: activityInfo.source || null,
    startTime: activityInfo.startTime || null,
    endTime: activityInfo.endTime || null,
    stages: activityInfo.stages || [],
    completion,
    available: !!activityInfo.code,
    status: activityInfo.status ?? (activityInfo.code ? 'active' : 'none'),
    failure: activityInfo.failure ?? null,
    dataUpdatedAt: activityInfo.dataUpdatedAt ?? null,
    lastSuccessAt: activityInfo.lastSuccessAt ?? null,
    message: activityInfo.code ? `当前活动: ${activityInfo.name || activityInfo.code}` : '当前没有活动或无法获取活动信息'
  });
}));

router.get('/activity/preflight', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const preflight = await getActivityRunPreflight(clientType);
  return sendSuccess(res, req, preflight, preflight.reason);
}));

router.get('/activity/copilot-candidates', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const candidates = await findActivityCopilotCandidates(clientType);
  return sendSuccess(res, req, candidates, candidates.reason);
}));

router.post('/activity/run', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const setId = typeof req.body?.setId === 'string' ? req.body.setId.trim() : '';
  const selectedIndexes = Array.isArray(req.body?.selectedIndexes)
    ? req.body.selectedIndexes.map(Number).filter(Number.isInteger)
    : [];
  const raidValue = req.body?.raid;
  const raid: 'normal' | 'raid' | 'both' = raidValue === 'raid' || raidValue === 'both' ? raidValue : 'normal';
  const options = isRecord(req.body?.options) ? req.body.options : {};
  const waitForCompletion = parseWaitForCompletion(req.body?.waitForCompletion);
  return executeTrackedAgentAction(req, res, {
    operationId: 'run_current_activity_copilots',
    input: { clientType, setId: setId || null, selectedIndexes, raid, options, waitForCompletion },
    waitForCompletion,
    metadata: { taskName: '当前活动作业', taskType: 'activity' },
    execute: async (lifecycle: AgentRunLifecycle) => {
      const run = () => setId
        ? runCurrentActivitySet({ setId, selectedIndexes, raid, options, clientType }, lifecycle)
        : runCurrentActivityCopilots(clientType, lifecycle);

      if (waitForCompletion) return run();

      // 后台模式不能把 execute 的返回当成终态：先返回 accepted，等实际执行结束
      // 再通过 onSettled 把最终结果或错误写回同一个 Run。
      void (async () => {
        try {
          const result = await run();
          await lifecycle.onSettled?.({ ok: true, result });
        } catch (error) {
          await lifecycle.onSettled?.({ ok: false, error });
        }
      })();
      return { message: '当前活动作业已在后台启动', background: true };
    },
    successMessage: '当前活动作业执行完成'
  });
}));

router.get('/stages/open-today', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const resourceCollectionOpen = await isResourceCollectionOpenNow(clientType).catch(() => false);
  return sendSuccess(res, req, getTodayOpenStages({ clientType, resourceCollectionOpen }), '已获取今日开放日常关卡');
}));

router.get('/drops/today', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const result = extractServiceResult(await getTodayDrops());
  return sendSuccess(res, req, result.data, result.message);
}));

router.get('/drops/recent', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const query = req.query || {};
  const days = normalizeDropDays(query.days, 7);
  const result = extractServiceResult(await getRecentDrops(days));
  return sendSuccess(res, req, result.data, result.message);
}));

router.get('/drops/statistics', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const query = req.query || {};
  const days = normalizeDropDays(query.days, 7);
  const result = extractServiceResult(await getDropStatistics(days));
  return sendSuccess(res, req, result.data, result.message);
}));

router.get('/data/depot', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, await getDepotData());
}));

router.post('/actions/depot-recognition', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const plan: Record<string, unknown> = {
    action: 'depot-recognition',
    sideEffects: ['parse_maa_logs', 'update_local_depot_cache']
  };
  if (req.body?.dryRun) {
    return sendDryRun(res, req, plan);
  }

  return executeTrackedAgentAction(req, res, {
    operationId: 'depot_recognition',
    input: { action: 'depot-recognition' },
    waitForCompletion: true,
    metadata: { taskName: '仓库识别', taskType: 'statistics' },
    execute: async () => {
      const result = await parseDepotData();
      const resultRecord: Record<string, unknown> = isRecord(result) ? result : {};
      if (resultRecord.success !== true) {
        throw buildRecognitionFailure(result, 'AGENT_DEPOT_RECOGNITION_FAILED', '仓库识别失败');
      }
      return resultRecord.data;
    },
    successMessage: '仓库识别完成'
  });
}));

router.get('/data/operbox', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, await getOperBoxData());
}));

router.post('/actions/operbox-recognition', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const plan: Record<string, unknown> = {
    action: 'operbox-recognition',
    sideEffects: ['parse_maa_logs', 'update_local_operbox_cache']
  };
  if (req.body?.dryRun) {
    return sendDryRun(res, req, plan);
  }

  return executeTrackedAgentAction(req, res, {
    operationId: 'operbox_recognition',
    input: { action: 'operbox-recognition' },
    waitForCompletion: true,
    metadata: { taskName: '干员识别', taskType: 'statistics' },
    execute: async () => {
      const result = await parseOperBoxData();
      const resultRecord: Record<string, unknown> = isRecord(result) ? result : {};
      if (resultRecord.success !== true) {
        throw buildRecognitionFailure(result, 'AGENT_OPERBOX_RECOGNITION_FAILED', '干员识别失败');
      }
      return resultRecord.data;
    },
    successMessage: '干员识别完成'
  });
}));

router.get('/data/operators', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, await getAllOperators());
}));

router.get('/changelog/core', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/MaaAssistantArknights/MaaAssistantArknights/releases?per_page=100`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'MAA-WebUI'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API 请求失败: ${response.status}`);
    }

    const releases = toGithubReleases(await response.json());

    const latestBeta = releases.find(release => Boolean(release.prerelease));
    const latestStable = releases.find(release => !release.prerelease);

    const changelog: Array<Record<string, unknown>> = [];

    if (latestBeta) {
      changelog.push({
        version: latestBeta.tag_name,
        name: latestBeta.name,
        body: latestBeta.body,
        publishedAt: latestBeta.published_at,
        htmlUrl: latestBeta.html_url,
        prerelease: latestBeta.prerelease
      });
    }

    if (latestStable) {
      changelog.push({
        version: latestStable.tag_name,
        name: latestStable.name,
        body: latestStable.body,
        publishedAt: latestStable.published_at,
        htmlUrl: latestStable.html_url,
        prerelease: latestStable.prerelease
      });
    }

    return sendSuccess(res, req, changelog);
  } catch (error) {
    return sendError(res, req, agentError('AGENT_CHANGELOG_CORE_FETCH_FAILED', `获取 MaaCore 更新日志失败: ${getErrorMessage(error)}`, {
      statusCode: 502,
      details: { provider: 'github', target: 'MaaAssistantArknights' },
      retryable: true
    }));
  }
}));

router.get('/changelog/cli', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/MaaAssistantArknights/maa-cli/releases?per_page=100`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'MAA-WebUI'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API 请求失败: ${response.status}`);
    }

    const releases = toGithubReleases(await response.json());
    const latestStable = releases.find(release => !release.prerelease);

    const changelog = latestStable ? [{
      version: latestStable.tag_name,
      name: latestStable.name,
      body: latestStable.body,
      publishedAt: latestStable.published_at,
      htmlUrl: latestStable.html_url,
      prerelease: latestStable.prerelease
    }] : [];

    return sendSuccess(res, req, changelog);
  } catch (error) {
    return sendError(res, req, agentError('AGENT_CHANGELOG_CLI_FETCH_FAILED', `获取 MAA CLI 更新日志失败: ${getErrorMessage(error)}`, {
      statusCode: 502,
      details: { provider: 'github', target: 'maa-cli' },
      retryable: true
    }));
  }
}));

router.get('/copilots/:id', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const response = await fetch(`https://prts.maa.plus/copilot/get/${req.params!.id}`);
  const data: unknown = await response.json();
  return sendSuccess(res, req, data);
}));

router.get('/copilot-sets/:id', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const response = await fetch(`https://prts.maa.plus/set/get?id=${encodeURIComponent(req.params!.id)}`);
  const data: unknown = await response.json();
  return sendSuccess(res, req, data);
}));

router.get('/copilot-sets/:id/plan', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const query = req.query || {};
  const raidValue = query.raid;
  const raid = raidValue === 'normal' || raidValue === 'raid' || raidValue === 'both' ? raidValue : 'normal';
  return sendSuccess(res, req, await buildCopilotPlan(req.params!.id, raid));
}));

router.post('/copilot-sets/:id/execute', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { selectedIndexes = [], options: rawOptions = {} } = req.body || {};
  const raid = typeof req.body?.raid === 'string' ? req.body.raid : 'normal';
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const options = isRecord(rawOptions) ? rawOptions : {};
  return executeTrackedAgentAction(req, res, {
    operationId: 'run_copilot_set',
    input: {
      clientType,
      setId: req.params!.id,
      selectedIndexes: Array.isArray(selectedIndexes) ? selectedIndexes : [],
      raid,
      options
    },
    waitForCompletion: true,
    metadata: { taskName: '作业集执行', taskType: 'copilot' },
    execute: (lifecycle: AgentRunLifecycle) => executeCopilotPlan({
      setId: req.params!.id,
      raid,
      selectedIndexes: Array.isArray(selectedIndexes) ? selectedIndexes : [],
      options: { ...options, clientType },
      lifecycle: {
        runId: lifecycle.runId,
        onStarted: lifecycle.onStarted,
        onProgress: lifecycle.onProgress
      }
    }),
    successMessage: '作业集执行完成'
  });
}));

router.post('/copilot-sets/:id/manual/start', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { selectedIndexes = [], options: rawOptions = {}, raid: rawRaid, idempotencyKey } = req.body || {};
  const raid = rawRaid === 'raid' || rawRaid === 'both' ? rawRaid : 'normal';
  const options = isRecord(rawOptions) ? rawOptions : {};
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const result = await startManualCopilotSet({
    setId: req.params!.id,
    raid,
    selectedIndexes,
    options,
    clientType,
    idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : null
  });
  return sendSuccess(res, req, result, result.message);
}));

router.post('/actions/continue-copilot-set', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const runId = typeof req.body?.runId === 'string' ? req.body.runId.trim() : '';
  if (!runId) {
    return sendError(res, req, agentError('AGENT_RUN_ID_REQUIRED', '继续手动作业集需要 runId', {
      statusCode: 400,
      retryable: false
    }));
  }
  const options = isRecord(req.body?.options) ? req.body.options : undefined;
  const result = await continueManualCopilotSet({ runId, options });
  return sendSuccess(res, req, result, result.message);
}));

router.get('/copilot-sets/:id/manual/:runId', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const session = getManualCopilotSetSession(req.params!.runId);
  if (!session || session.setId !== String(req.params!.id)) {
    return sendError(res, req, agentError('COPILOT_MANUAL_SESSION_NOT_FOUND', '手动作业集会话不存在或已结束', {
      statusCode: 404,
      retryable: false
    }));
  }
  return sendSuccess(res, req, {
    ...session,
    run: getAgentRun(req.params!.runId)
  });
}));

router.post('/copilot-sets/:id/reset-progress', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, await resetCopilotPlanProgress(req.params!.id));
}));

router.get('/paradox/search', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const query = req.query || {};
  const name = String(query.name || '').trim();
  if (!name) {
    return sendError(res, req, agentError('AGENT_VALIDATION_OPERATOR_NAME_REQUIRED', '请提供干员名字', { statusCode: 400 }));
  }

  const paradoxData: unknown = await loadParadoxOperators();
  const operators = Array.isArray(paradoxData) ? paradoxData : [];
  const operator = operators.find((candidate): candidate is ParadoxOperator => {
    if (!isRecord(candidate) || typeof candidate.name !== 'string' || typeof candidate.stage_id !== 'string') return false;
    return candidate.name.includes(name) || name.includes(candidate.name);
  });
  if (!operator) {
    return sendError(res, req, agentError('AGENT_PARADOX_OPERATOR_NOT_FOUND', `未找到干员"${name}"的悖论模拟关卡`, { statusCode: 404, details: { name } }));
  }

  const response = await fetch(`https://prts.maa.plus/copilot/query?level_keyword=${operator.stage_id}&page=1&limit=10&order_by=hot`);
  const payload: unknown = await response.json();
  const payloadRecord = isRecord(payload) ? payload : {};
  const dataRecord = isRecord(payloadRecord.data) ? payloadRecord.data : null;
  const searchItems = dataRecord && Array.isArray(dataRecord.data) ? dataRecord.data : [];
  if (payloadRecord.status_code !== 200 || searchItems.length === 0) {
    return sendError(res, req, agentError('AGENT_PARADOX_COPILOT_NOT_FOUND', `未找到干员"${operator.name}"的作业`, { statusCode: 404, details: { operator: operator.name, stageId: operator.stage_id } }));
  }

  const copilots = searchItems.map(item => {
    const itemRecord = isRecord(item) ? item : {};
    const itemDoc = isRecord(itemRecord.doc) ? itemRecord.doc : {};
    let title: unknown = itemDoc.title || '无标题';
    try {
      const content = JSON.parse(typeof itemRecord.content === 'string' && itemRecord.content ? itemRecord.content : '{}') as unknown;
      if (isRecord(content) && isRecord(content.doc) && content.doc.title) title = content.doc.title;
    } catch {}
    return {
      id: itemRecord.id,
      uri: `prts://${String(itemRecord.id)}`,
      views: itemRecord.views,
      hotScore: itemRecord.hot_score,
      uploader: itemRecord.uploader_id,
      title
    };
  });

  return sendSuccess(res, req, {
    operator: operator.name,
    stageId: operator.stage_id,
    copilots,
    recommended: copilots[0]
  });
}));

router.get('/copilot/search', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const query = req.query || {};
  const stage = String(query.stage || '').trim();
  if (!stage) {
    return sendError(res, req, agentError('AGENT_VALIDATION_STAGE_REQUIRED', '请提供关卡名称', { statusCode: 400 }));
  }

  const normalizedStage = stage.toUpperCase();
  const searchKeyword = await resolveStageSearchKeyword(stage);
  const allCopilots: unknown[] = [];
  let page = 1;
  const maxPages = 5;
  const targetCount = 10;

  while (page <= maxPages && allCopilots.length < targetCount) {
    const response = await fetch(`https://prts.maa.plus/copilot/query?level_keyword=${encodeURIComponent(searchKeyword)}&page=${page}&limit=50&order_by=hot`);
    const payload: unknown = await response.json();
    const payloadRecord = isRecord(payload) ? payload : {};
    const dataRecord = isRecord(payloadRecord.data) ? payloadRecord.data : null;
    const searchItems = dataRecord && Array.isArray(dataRecord.data) ? dataRecord.data : [];
    if (payloadRecord.status_code !== 200 || searchItems.length === 0) break;

    for (const item of searchItems) {
      const itemRecord: CopilotSearchItem = isRecord(item) ? item : {};
      let title = '无标题';
      let stageName = stage;
      let titleStageCode = '';
      try {
        const content = JSON.parse(typeof itemRecord.content === 'string' ? itemRecord.content : '{}') as unknown;
        if (isRecord(content)) {
          const doc = isRecord(content.doc) ? content.doc : {};
          if (typeof doc.title === 'string' && doc.title) title = doc.title;
          if (typeof content.stage_name === 'string' && content.stage_name) stageName = content.stage_name;
        }
        const titleMatch = title.match(/^([A-Z]{2,4}-\d+[A-Z]?)/i);
        if (titleMatch) titleStageCode = titleMatch[1].toUpperCase();
      } catch {}

      const normalizedStageName = String(stageName || '').trim().toUpperCase();
      const normalizedSearchKeyword = String(searchKeyword || '').trim().toUpperCase();
      if (normalizedStageName === normalizedStage || normalizedStageName === normalizedSearchKeyword || titleStageCode === normalizedStage) {
        allCopilots.push({
          id: itemRecord.id,
          uri: `prts://${String(itemRecord.id)}`,
          views: itemRecord.views,
          hotScore: itemRecord.hot_score,
          uploader: itemRecord.uploader_id,
          title,
          stageName
        });
      }
    }

    if (!dataRecord || !dataRecord.has_next) break;
    page += 1;
  }

  if (!allCopilots.length) {
    return sendError(res, req, agentError('AGENT_COPILOT_NOT_FOUND', `未找到关卡"${stage}"的作业`, { statusCode: 404, details: { stage, searchKeyword } }));
  }

  return sendSuccess(res, req, {
    stage,
    copilots: allCopilots.slice(0, targetCount),
    recommended: allCopilots[0]
  });
}));

router.get('/paradox/operators', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, await loadParadoxOperators());
}));

router.get('/training/operators', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const query = req.query || {};
  const filters: Record<string, unknown> = {
    rarity: typeof query.rarity === 'string' && query.rarity ? parseInt(query.rarity, 10) : undefined,
    profession: query.profession,
    owned: query.owned === 'true' ? true : query.owned === 'false' ? false : undefined,
    needsElite2: query.needsElite2 === 'true',
    status: query.status || 'trainable'
  };
  const operators = await operatorTrainingService.getOperatorList(filters);
  return sendSuccess(res, req, { operators, count: operators.length });
}));

router.get('/training/operator-counts', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const query = req.query || {};
  const rarityValue = Number(query.rarity);
  const rarity = Number.isFinite(rarityValue) && rarityValue > 0 ? Math.trunc(rarityValue) : undefined;
  return sendSuccess(res, req, await operatorTrainingService.getOperatorCounts({ rarity }));
}));

router.get('/training/queue', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, await operatorTrainingService.getTrainingQueue());
}));

router.post('/training/queue', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { operatorId: operatorIdValue, currentElite, targetElite } = req.body || {};
  if (!operatorIdValue) {
    return sendError(res, req, agentError('AGENT_VALIDATION_OPERATOR_ID_REQUIRED', '缺少 operatorId 参数', { statusCode: 400 }));
  }
  const operatorId = typeof operatorIdValue === 'string' ? operatorIdValue : String(operatorIdValue);
  const queueItem = await operatorTrainingService.addToQueue(operatorId, { currentElite, targetElite });
  return sendSuccess(res, req, queueItem, '已添加到养成队列');
}));

router.delete('/training/queue/:operatorId', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  await operatorTrainingService.removeFromQueue(req.params!.operatorId);
  return sendSuccess(res, req, null, '已从养成队列中移除');
}));

router.put('/training/queue/order', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { operatorIds } = req.body || {};
  if (!Array.isArray(operatorIds)) {
    return sendError(res, req, agentError('AGENT_VALIDATION_OPERATOR_IDS_REQUIRED', 'operatorIds 必须是数组', { statusCode: 400 }));
  }
  await operatorTrainingService.updateQueueOrder(operatorIds);
  return sendSuccess(res, req, null, '队列顺序已更新');
}));

router.put('/training/settings', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const settings = await operatorTrainingService.updateSettings(req.body || {});
  return sendSuccess(res, req, settings, '设置已更新');
}));

router.post('/training/plan', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const modeValue = req.body?.mode;
  const mode = typeof modeValue === 'string' && modeValue ? modeValue : 'current';
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const plan = await operatorTrainingService.generateTrainingPlan(mode, clientType);
  return sendSuccess(res, req, plan);
}));

router.post('/actions/apply-training-plan', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { plan, settings } = req.body || {};
  if (!plan) {
    return sendError(res, req, agentError('AGENT_VALIDATION_PLAN_REQUIRED', '缺少 plan 参数', { statusCode: 400 }));
  }
  const trainingPlan = plan as unknown as Parameters<typeof operatorTrainingService.applyPlanToTasks>[0];
  const result = await operatorTrainingService.applyPlanToTasks(trainingPlan, settings);
  return sendSuccess(res, req, result, '养成计划已应用到任务流程');
}));

router.post('/actions/fetch-training-materials', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const plan: Record<string, unknown> = { action: 'fetch-training-materials', sideEffects: ['refresh_training_material_cache'] };
  if (req.body?.dryRun) {
    return sendDryRun(res, req, plan);
  }
  const result = await operatorTrainingService.fetchOperatorMaterials();
  return sendSuccess(res, req, result, '养成材料数据已更新');
}));

router.get('/webrtc/status', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { address, adbPath, profileId } = await resolveRequestConnection(req, { allowOverrides: true })
  const deviceId = typeof req.query?.deviceId === 'string' && req.query.deviceId.trim()
    ? req.query.deviceId.trim()
    : DEFAULT_DEVICE_ID
  const [recordList, serverVersion] = await Promise.all([
    getWebrtcDeviceRecords(),
    getWebrtcServerVersion().catch(() => null)
  ])
  const records = toWebrtcDeviceRecords(recordList)
  const device = records.find(record => record.id === deviceId) || null
  const summary = await getWebrtcSummary(address, adbPath, {
    agentRunning: device ? device.online : null
  })
  return sendSuccess(res, req, {
    ...summary,
    ...buildWebrtcDeviceStatus(records, deviceId),
    profileId,
    serverVersion
  })
}));

router.get('/webrtc/devices', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, { devices: await getWebrtcDevices() });
}));

router.get('/webrtc/snapshot', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const deviceId = typeof req.query?.deviceId === 'string' && req.query.deviceId.trim()
    ? req.query.deviceId.trim()
    : DEFAULT_DEVICE_ID
  const snapshot = await getWebrtcSnapshot(deviceId)
  if (!snapshot) {
    return sendError(res, req, agentError(
      'WEBRTC_SNAPSHOT_UNAVAILABLE',
      '无法读取设备快照，请确认 WebRTC 服务正在运行',
      { statusCode: 404, retryable: true, details: { deviceId } }
    ))
  }
  return sendSuccess(res, req, snapshot)
}));

router.post('/webrtc/start', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { address, adbPath, profileId } = await resolveRequestConnection(req, { allowOverrides: true })
  const requestedDeviceId = req.body?.deviceId;
  const deviceId = typeof requestedDeviceId === 'string' && requestedDeviceId.trim()
    ? requestedDeviceId.trim()
    : DEFAULT_DEVICE_ID;
  const status = await startWebrtc(address, deviceId, adbPath);
  const [summary, recordList, serverVersion] = await Promise.all([
    getWebrtcSummary(address, adbPath),
    getWebrtcDeviceRecords(),
    getWebrtcServerVersion().catch(() => null)
  ])
  const records = toWebrtcDeviceRecords(recordList)
  const statusRecord: Record<string, unknown> = isRecord(status) ? status : {};
  return sendSuccess(res, req, {
    ...summary,
    ...statusRecord,
    ...buildWebrtcDeviceStatus(records, deviceId),
    serverVersion,
    deviceId,
    address,
    profileId,
    protocol: buildWebrtcBrowserProtocol(deviceId)
  });
}));

router.post('/webrtc/stop', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { address, adbPath } = await resolveRequestConnection(req, { allowOverrides: true })
  return sendSuccess(res, req, await stopWebrtc(address, adbPath));
}));

router.post('/preview/orientation', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { orientation, dryRun = false } = req.body || {};
  const { adbPath, address } = await resolveRequestConnection(req, { allowOverrides: true })
  const plan = buildOrientationPlan({ orientation, adbPath, address });

  if (dryRun) {
    return sendDryRun(res, req, plan);
  }

  return sendSuccess(res, req, await setAndroidOrientation({ orientation, adbPath, address }), '屏幕方向已设置');
}));

router.post('/webrtc/install', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const state = startWebrtcInstall()
  const running = state.status === 'running'
  res.status(running ? 202 : 200)
  return sendSuccess(res, req, state, running ? 'WebRTC 组件安装已开始' : 'WebRTC 组件安装状态')
}));

router.get('/webrtc/install/status', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, getWebrtcInstallState())
}));

router.post('/webrtc/start-server', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { address, adbPath } = await resolveRequestConnection(req, { allowOverrides: true })
  const result = await startWebrtcServer(address, adbPath);
  return sendSuccess(res, req, result, 'WebRTC 服务已启动');
}));

router.post('/webrtc/stop-server', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { address, adbPath } = await resolveRequestConnection(req, { allowOverrides: true })
  const result = await stopWebrtcServer(address, adbPath);
  return sendSuccess(res, req, result, 'WebRTC 服务已停止');
}));

router.post('/webrtc/start-agent', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { address, adbPath } = await resolveRequestConnection(req, { allowOverrides: true })
  const requestedDeviceId = req.body?.deviceId;
  const deviceId = typeof requestedDeviceId === 'string' && requestedDeviceId.trim()
    ? requestedDeviceId.trim()
    : DEFAULT_DEVICE_ID;
  const result = await startWebrtcAgent(address, deviceId, adbPath);
  return sendSuccess(res, req, result, 'MuMu Agent 已启动');
}));

router.post('/webrtc/stop-agent', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { address, adbPath } = await resolveRequestConnection(req, { allowOverrides: true })
  const result = await stopWebrtcAgent(address, adbPath);
  return sendSuccess(res, req, result, 'MuMu Agent 已停止');
}));

const DEVICE_STATS_CACHE_TTL_MS = 10_000;
const DEVICE_STATS_MARKERS = {
  load: '@@LA_PLUMA_LOAD@@',
  mem: '@@LA_PLUMA_MEM@@',
  disk: '@@LA_PLUMA_DISK@@',
  temp: '@@LA_PLUMA_TEMP@@',
  top: '@@LA_PLUMA_TOP@@'
} as const;

function extractDeviceStatsSection(output: string, start: string, end?: string): string {
  const startIndex = output.indexOf(start);
  if (startIndex < 0) return '';
  const contentStart = startIndex + start.length;
  const endIndex = end ? output.indexOf(end, contentStart) : -1;
  return output.slice(contentStart, endIndex >= 0 ? endIndex : undefined).trim();
}

export function parseDeviceStatsOutput(stdout: string) {
  const loadRaw = extractDeviceStatsSection(stdout, DEVICE_STATS_MARKERS.load, DEVICE_STATS_MARKERS.mem);
  const memRaw = extractDeviceStatsSection(stdout, DEVICE_STATS_MARKERS.mem, DEVICE_STATS_MARKERS.disk);
  const diskRaw = extractDeviceStatsSection(stdout, DEVICE_STATS_MARKERS.disk, DEVICE_STATS_MARKERS.temp);
  const tempRaw = extractDeviceStatsSection(stdout, DEVICE_STATS_MARKERS.temp, DEVICE_STATS_MARKERS.top);
  const topRaw = extractDeviceStatsSection(stdout, DEVICE_STATS_MARKERS.top);

  // CPU load from /proc/loadavg
  const loadParts = loadRaw.split(/\s+/)
  // CPU usage % from top output: "400%cpu  0%user ... 396%idle"
  const topTotal = topRaw.match(/(\d+)%cpu/i)
  const topIdle  = topRaw.match(/(\d+)%idle/i)
  const cpuPct = topTotal && topIdle ? Math.round(((parseInt(topTotal[1]) - parseInt(topIdle[1])) / parseInt(topTotal[1])) * 100) : null
  // Memory from /proc/meminfo (kB)
  const memInfo: Record<string, number> = {};
  for (const line of memRaw.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) memInfo[m[1]] = parseInt(m[2]);
  }
  const memTotalKb = memInfo['MemTotal'] || 0;
  const memFreeKb  = memInfo['MemFree'] || 0;
  const memAvailKb = memInfo['MemAvailable'] || 0;
  const memUsedKb  = memTotalKb - (memAvailKb || memFreeKb);
  const swapTotalKb = memInfo['SwapTotal'] || 0;
  const swapUsedKb  = swapTotalKb - (memInfo['SwapFree'] || 0);
  const diskParts = diskRaw.split(/\s+/)
  const tempMatch = tempRaw.match(/temperature:\s*(\d+)/)

  const fmtMb = (kb: number) => kb >= 1048576 ? `${(kb / 1048576).toFixed(1)}G` : kb >= 1024 ? `${Math.round(kb / 1024)}M` : `${kb}K`

  return {
    load1m: loadParts[0] ? parseFloat(loadParts[0]) : null,
    load5m: loadParts[1] ? parseFloat(loadParts[1]) : null,
    load15m: loadParts[2] ? parseFloat(loadParts[2]) : null,
    cpuPct,
    memTotalKb, memUsedKb, memFreeKb: memAvailKb || memFreeKb,
    memTotal: fmtMb(memTotalKb),
    memUsed:  fmtMb(memUsedKb),
    memFree:  fmtMb(memAvailKb || memFreeKb),
    memPct: memTotalKb ? Math.round((memUsedKb / memTotalKb) * 100) : null,
    swapTotalKb,
    swapUsedKb,
    diskTotal: diskParts[1] || null,
    diskUsed:  diskParts[2] || null,
    diskFree:  diskParts[3] || null,
    diskPct:   diskParts[4] ? parseInt(diskParts[4]) : null,
    temp: tempMatch ? parseInt(tempMatch[1]) / 10 : null,
  }
}

async function getDeviceStats(adbPath: string, address: string) {
  try {
    // One device shell instead of five adb processes per poll. `top -d 0.3`
    // stays intentionally short; the result is cached for 10 s below.
    const script = [
      `echo ${DEVICE_STATS_MARKERS.load}`,
      'cat /proc/loadavg',
      `echo ${DEVICE_STATS_MARKERS.mem}`,
      'cat /proc/meminfo | head -4',
      `echo ${DEVICE_STATS_MARKERS.disk}`,
      'df -h /data | tail -1',
      `echo ${DEVICE_STATS_MARKERS.temp}`,
      'dumpsys battery | grep temperature',
      `echo ${DEVICE_STATS_MARKERS.top}`,
      'top -b -n 1 -d 0.3 | head -5'
    ].join('; ');
    const { stdout } = await execFileAsync(
      adbPath,
      ['-s', address, 'shell', script],
      { timeout: 10_000, maxBuffer: 256 * 1024 }
    );
    return parseDeviceStatsOutput(stdout);
  } catch {
    return null;
  }
}

type DeviceStatsSnapshot = Awaited<ReturnType<typeof getDeviceStats>>;
let deviceStatsCache: { key: string; fetchedAt: number; value: DeviceStatsSnapshot } | null = null;
let deviceStatsInFlight: { key: string; promise: Promise<DeviceStatsSnapshot> } | null = null;

async function getDeviceStatsCached(adbPath: string, address: string): Promise<DeviceStatsSnapshot> {
  const key = `${adbPath}\u0000${address}`;
  if (deviceStatsCache && deviceStatsCache.key === key
    && Date.now() - deviceStatsCache.fetchedAt < DEVICE_STATS_CACHE_TTL_MS) {
    return deviceStatsCache.value;
  }
  if (deviceStatsInFlight && deviceStatsInFlight.key === key) {
    return deviceStatsInFlight.promise;
  }

  const promise = getDeviceStats(adbPath, address)
    .then(value => {
      deviceStatsCache = { key, fetchedAt: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (deviceStatsInFlight?.key === key) deviceStatsInFlight = null;
    });
  deviceStatsInFlight = { key, promise };
  return promise;
}

router.get('/device-stats', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { adbPath, address } = await resolveRequestConnection(req, { allowOverrides: true })
  const stats = await getDeviceStatsCached(adbPath, address);
  return sendSuccess(res, req, stats);
}));

router.get('/notifications/config', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, getNotificationConfig());
}));

router.post('/notifications/config', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const result = await saveUserConfig('notification', req.body || {});
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_NOTIFICATION_CONFIG_SAVE_FAILED', result.message || '通知配置保存失败', { statusCode: 500 }));
  }
  setNotificationConfig((req.body || {}) as unknown as Parameters<typeof setNotificationConfig>[0]);
  return sendSuccess(res, req, null, '通知配置已保存');
}));

router.post('/actions/test-notification-channel', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const channelValue = req.body?.channel;
  const rawConfig = req.body?.config;
  if (!channelValue) {
    return sendError(res, req, agentError('AGENT_VALIDATION_CHANNEL_REQUIRED', '缺少通知渠道', { statusCode: 400 }));
  }
  if (rawConfig != null && !isRecord(rawConfig)) {
    return sendError(res, req, agentError('AGENT_VALIDATION_NOTIFICATION_CONFIG_INVALID', '通知渠道配置格式无效', { statusCode: 400 }));
  }
  const channel = typeof channelValue === 'string' ? channelValue : String(channelValue);
  const config = rawConfig == null
    ? null
    : rawConfig as unknown as Parameters<typeof testNotificationChannel>[1];
  const result = await testNotificationChannel(channel, config);
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_NOTIFICATION_TEST_FAILED', result.message || '测试通知失败', { statusCode: 400, details: { channel } }));
  }
  return sendSuccess(res, req, { channel }, result.message || '测试消息已发送');
}));

router.post('/actions/send-notification', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { channel: channelValue, title, content, level = 'info', data } = req.body || {};
  const channel = channelValue ? String(channelValue) : null;
  const notificationData = data === undefined ? undefined : isRecord(data) ? data : null;
  const payload = {
    title: title ? String(title) : '测试通知',
    content: content ? String(content) : '这是一条测试通知',
    level: typeof level === 'string' ? level : 'info',
    data: notificationData
  } satisfies import('../services/notificationService.ts').NotificationMessage;
  const result = channel ? await sendToChannel(channel, payload) : await sendNotification(payload);
  return sendSuccess(res, req, result, channel ? '通知已发送到指定渠道' : '通知已发送');
}));

router.get('/schedules/status', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, getScheduleStatus());
}));

router.get('/schedules/execution', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const query = req.query || {};
  return sendSuccess(res, req, getScheduleExecutionStatus(query.includeResult === 'true'));
}));

router.post('/schedules', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { scheduleId: scheduleIdValue, times, taskFlow } = req.body || {};
  const scheduleId = typeof scheduleIdValue === 'string' ? scheduleIdValue : 'default';
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const result = setupSchedule(scheduleId, times, taskFlow, clientType);
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_SCHEDULE_SETUP_FAILED', result.message, { statusCode: 400 }));
  }
  return sendSuccess(res, req, result, result.message);
}));

router.delete('/schedules/:scheduleId', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, stopSchedule(req.params!.scheduleId));
}));

router.post('/schedules/:scheduleId/execute', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { scheduleId } = req.params!;
  const { taskFlow } = req.body || {};
  if (!Array.isArray(taskFlow)) {
    return sendError(res, req, agentError('AGENT_VALIDATION_TASK_FLOW_INVALID', '任务流程格式无效', { statusCode: 400 }));
  }
  return executeTrackedAgentAction(req, res, {
    operationId: 'execute_schedule',
    input: { scheduleId, taskFlow },
    trigger: { type: 'schedule', scheduleId, source: 'api' },
    metadata: { taskName: `定时任务 ${scheduleId}`, taskType: 'schedule' },
    execute: async (lifecycle: AgentRunLifecycle) => {
      const result = await executeScheduleNow(scheduleId, taskFlow, lifecycle);
      if (!result.success) {
        const busy = Boolean((result as { busy?: boolean }).busy);
        throw agentError(
          busy ? 'AGENT_SCHEDULE_ALREADY_RUNNING' : 'AGENT_DAILY_FLOW_REJECTED',
          result.message || '定时任务执行失败',
          {
            statusCode: busy ? 409 : 400,
            details: { scheduleId, owner: (result as { owner?: unknown }).owner || null },
            retryable: busy
          }
        );
      }
      return result;
    },
    successMessage: '定时任务执行完成',
    acceptedMessage: '定时任务已接受'
  });
}));

router.post('/actions/configure-auto-update', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  return sendSuccess(res, req, setupAutoUpdate(req.body || {}, clientType));
}));

router.get('/auto-update/status', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, getAutoUpdateStatus());
}));

router.post('/actions/open-config-directory', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const configDir = await getMaaConfigDir();
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'explorer.exe'
      : 'xdg-open';
  await execFileAsync(command, [configDir]);
  return sendSuccess(res, req, { configDir }, '配置目录已打开');
}));

router.post('/actions/update-core', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { version, dryRun = false } = req.body || {};
  const corePlan = version === 'beta'
    ? { action: 'update-core', targetChannel: 'beta', command: 'install', args: ['beta', '--force'] }
    : version === 'stable'
      ? { action: 'update-core', targetChannel: 'stable', command: 'install', args: ['stable', '--force'] }
      : { action: 'update-core', targetChannel: 'current', command: 'update', args: [] };
  const plan: Record<string, unknown> = {
    action: 'update-core-and-resources',
    steps: [corePlan],
    resourcesIncluded: true
  };

  if (dryRun) return sendDryRun(res, req, plan);

  return executeTrackedAgentAction(req, res, {
    operationId: 'update_core',
    input: { version: version || 'current' },
    waitForCompletion: true,
    metadata: { taskName: '更新 MaaCore 与资源', taskType: 'maintenance' },
    execute: async (): Promise<unknown> => withMaaExecutionLease({
      source: 'core-update',
      taskName: '更新 MaaCore 与资源',
      command: 'update'
    }, async (): Promise<unknown> => {
      let coreResult: Awaited<ReturnType<typeof execMaaCommand>>;
      try {
        coreResult = version === 'beta'
          ? await execMaaCommand('install', ['beta', '--force'])
          : version === 'stable'
            ? await execMaaCommand('install', ['stable', '--force'])
            : await execMaaCommand('update', []);
      } catch (error) {
        logger.error('更新 MaaCore 失败', { error: getErrorMessage(error), version });
        throw agentError('AGENT_MAA_UPDATE_CORE_FAILED', `MaaCore 更新失败: ${getErrorMessage(error)}`, {
          statusCode: 500,
          retryable: true,
          details: { version, failedStep: 'core', coreUpdated: false }
        });
      }

      try {
        let coreChannel: string | null = null;
        let channelPersisted = false;
        try {
          coreChannel = version === 'beta' || version === 'stable'
            ? await setMaaCoreChannel(version)
            : await getMaaCoreChannel();
          channelPersisted = true;
        } catch (channelError) {
          logger.warn('持久化 MaaCore 更新渠道失败', { error: getErrorMessage(channelError), version });
        }

        // `maa update` / `maa install` already refresh the base resource,
        // MaaResource/hot-fix source, and the hot-update cache. Read the
        // resulting version instead of running a second custom resource sync.
        const resource = await getMaaResourceInfo();
        const runtime = await getMaaVersion(true);
        return {
          plan,
          channel: coreChannel,
          channelPersisted,
          steps: {
            core: { success: true, output: coreResult.stdout || coreResult.stderr || '' },
            resources: { success: true, resource }
          },
          runtime: { ...runtime, resource }
        };
      } catch (error) {
        const runtime = await getMaaVersion(true).catch(() => null);
        const resource = await getMaaResourceInfo().catch(() => null);
        logger.error('MaaCore 已更新，但资源同步失败', { error: getErrorMessage(error), version });
        throw agentError('AGENT_MAA_UPDATE_RESOURCE_FAILED', `MaaCore 已更新，但资源同步失败: ${getErrorMessage(error)}`, {
          statusCode: 500,
          retryable: true,
          details: {
            version,
            failedStep: 'resources',
            coreUpdated: true,
            runtime: runtime ? { ...runtime, resource } : null
          }
        });
      }
    }),
    successMessage: version ? `已切换到 ${version} 渠道并同步最新资源` : 'MaaCore 和资源已更新'
  });
}));

router.post('/actions/update-cli', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const os = await import('os');
  const execAsync = promisify(exec);
  const MAA_CLI_PATH = DEFAULT_MAA_CLI_PATH;
  const platform = os.platform();
  const isDocker = process.env.NODE_ENV === 'production' && await execAsync('test -f /.dockerenv').then(() => true).catch(() => false);
  const selfUpdateAvailable = await canUseMaaSelfUpdate();
  const command = platform === 'darwin' && !isDocker
    ? 'brew upgrade maa-cli'
    : selfUpdateAvailable
      ? `${MAA_CLI_PATH} self update`
      : null;
  const plan: Record<string, unknown> = { action: 'update-cli', command, platform, selfUpdateAvailable };

  if (!command) {
    return sendError(res, req, agentError(
      'AGENT_MAA_CLI_UPDATE_UNSUPPORTED',
      '当前 maa-cli 构建没有 self 子命令，无法自动更新；请使用安装方式对应的包管理器升级',
      {
        statusCode: 409,
        details: { platform, cliPath: MAA_CLI_PATH, selfUpdateAvailable },
        retryable: false
      }
    ));
  }

  if (req.body?.dryRun) return sendDryRun(res, req, plan);
  return withMaaExecutionLease({ source: 'cli-update', taskName: '更新 MAA CLI', command: 'update-cli' }, async () => {
    const { stdout, stderr } = await execAsync(command);
    return sendSuccess(res, req, { output: stdout || stderr, plan }, `MAA CLI 更新完成${isDocker ? '（Docker 环境）' : ''}`);
  });
}));

router.post('/actions/hot-update-resources', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const plan: Record<string, unknown> = { action: 'hot-update-resources', command: 'hot-update' };
  if (req.body?.dryRun) return sendDryRun(res, req, plan);

  return executeTrackedAgentAction(req, res, {
    operationId: 'hot_update_resources',
    input: { action: 'hot-update' },
    waitForCompletion: true,
    metadata: { taskName: '同步 MAA 资源', taskType: 'maintenance' },
    execute: async () => {
      try {
        const result = await updateMaaResources();
        return { ...result, plan };
      } catch (error) {
        throw agentError('AGENT_MAA_RESOURCE_UPDATE_FAILED', `资源同步失败: ${getErrorMessage(error)}`, {
          statusCode: 500,
          retryable: true,
          details: { failedStep: 'resources' }
        });
      }
    },
    successMessage: '资源文件更新成功'
  });
}));

router.get('/custom-tools', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, { tools: listCustomTools() });
}));

router.post('/actions/run-custom-tool', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { toolId, params = {}, dryRun = false, waitForCompletion = true } = req.body || {};
  const taskConfig = buildCustomToolTaskConfig(toolId, params);
  const plan: Record<string, unknown> = { action: 'run-custom-tool', toolId, taskConfig };

  if (dryRun) return sendDryRun(res, req, plan);

  const shouldWait = parseWaitForCompletion(waitForCompletion);
  return executeTrackedAgentAction(req, res, {
    operationId: 'run_custom_tool',
    input: { toolId, params, waitForCompletion: shouldWait },
    waitForCompletion: shouldWait,
    metadata: { taskName: taskConfig.name, taskType: 'custom' },
    execute: async (lifecycle: AgentRunLifecycle) => {
      const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
      return execDynamicTask(
        `custom_${toolId}`,
        taskConfig,
        taskConfig.name,
        'custom',
        shouldWait,
        false,
        { lifecycle, clientType }
      );
    },
    successMessage: `${taskConfig.name}执行完成`,
    acceptedMessage: `${taskConfig.name}已接受`
  });
}));

router.post('/actions/test-connection', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { adbPath, address } = await resolveRequestConnection(req, { allowOverrides: true })
  return sendSuccess(res, req, await testAdbConnection(adbPath, address));
}));

router.get('/actions/discover-devices', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { adbPath } = await resolveRequestConnection(req, { allowOverrides: true })
  return sendSuccess(res, req, await discoverAdbDevices(adbPath));
}));

router.get('/version', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const [version, resource] = await Promise.all([
    getMaaVersion(true),
    getMaaResourceInfo().catch((error: unknown) => ({
      lastUpdated: null,
      modifiedAt: null,
      ageDays: null,
      status: 'unknown',
      message: `资源版本读取失败: ${getErrorMessage(error)}`,
      activity: null,
      gacha: null
    }))
  ]);
  return sendSuccess(res, req, { ...version, resource });
}));

router.get('/config-directory', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  return sendSuccess(res, req, { path: await getMaaConfigDir() });
}));

router.post('/actions/start-game', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const waitForCompletion = parseWaitForCompletion(req.body?.waitForCompletion);
  const accountName = typeof req.body?.accountName === 'string' ? req.body.accountName.trim() : '';
  const startGameEnabled = req.body?.startGameEnabled !== false;
  const { clientType, address } = await resolveRequestConnection(req, { allowOverrides: true })
  return executeTrackedAgentAction(req, res, {
    operationId: 'start_game',
    input: { clientType, address, accountName, startGameEnabled, waitForCompletion },
    waitForCompletion,
    metadata: { taskName: '启动游戏', taskType: 'agent' },
    execute: (lifecycle: AgentRunLifecycle) => startGameEnabled
      ? execMaaCommand(
          'startup',
          [clientType, '-a', address, ...(accountName ? ['--account-name', accountName] : [])],
          '启动游戏',
          'agent',
          waitForCompletion,
          false,
          lifecycle
        )
      : execDynamicTask(
          'startup',
          {
            name: '启动游戏',
            type: 'StartUp',
            client_type: clientType,
            params: {
              start_game_enabled: false,
              ...(accountName ? { account_name: accountName } : {})
            }
          },
          '启动游戏',
          'agent',
          waitForCompletion,
          false,
          { lifecycle, clientType }
        ),
    successMessage: '游戏启动命令执行完成',
    acceptedMessage: '游戏启动命令已接受'
  });
}));

router.post('/actions/run-daily-flow', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { dryRun, scheduleId, taskFlow: overrideTaskFlow } = normalizeDailyFlowRequest(req.body || {});
  const taskFlow = await loadAutomationTaskFlow(overrideTaskFlow);
  const planResult = await getScheduledTaskFlowPlan(taskFlow);
  const planError = createDailyFlowExecutionError(planResult);
  if (planError) {
    return sendError(res, req, planError);
  }
  const plan = planResult.steps || [];

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

  return executeTrackedAgentAction(req, res, {
    operationId: 'run_daily_flow',
    input: { scheduleId, taskFlow },
    metadata: { taskName: `今日流程 ${scheduleId}`, taskType: 'schedule' },
    execute: async (lifecycle: AgentRunLifecycle) => {
      const result = await executeScheduleNow(scheduleId, taskFlow, lifecycle);
      const executionError = createDailyFlowExecutionError(result);
      if (executionError) throw executionError;
      return { ...result, scheduleId, totalSteps: planResult.totalSteps, plan };
    },
    successMessage: '今日流程执行完成'
  });
}));

router.post('/actions/fight', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const { dryRun = false, ...requestOptions } = req.body || {};
  const waitForCompletion = parseWaitForCompletion(requestOptions.waitForCompletion);
  const fightOptions: Record<string, unknown> = { ...requestOptions };
  delete fightOptions.waitForCompletion;

  let dynamicFightPlan: DynamicFightPlan | null = null;
  let dynamicConnection: ResolvedConnection | null = null;
  try {
    if (needsDynamicFight(fightOptions)) {
      dynamicConnection = await resolveRequestConnection(req, { allowOverrides: true });
      const clientType = fightOptions.clientType
        ? String(fightOptions.clientType)
        : dynamicConnection.clientType;
      const resolvedStages = await Promise.all(normalizeFightStages(fightOptions).map(async stage => ({
        ...stage,
        stage: await replaceActivityCode(stage.stage, clientType)
      })));
      dynamicFightPlan = buildDynamicFightPlan(fightOptions, resolvedStages);
    }
  } catch (error) {
    return sendError(res, req, agentError('AGENT_VALIDATION_DROPS_INVALID', getErrorMessage(error), {
      statusCode: 400,
      retryable: false
    }));
  }

  if (dynamicFightPlan) {
    const selectedFightPlan = dynamicFightPlan;
    const semantic = {
      stages: selectedFightPlan.tasks.map(task => ({
        stage: task.params.stage,
        times: task.params.times !== undefined ? String(task.params.times) : ''
      })),
      medicine: fightOptions.medicine ?? 0,
      medicineExpireDays: fightOptions.medicineExpireDays ?? 0,
      expiringMedicine: fightOptions.expiringMedicine ?? 0,
      stone: fightOptions.stone ?? 0,
      series: fightOptions.series ?? 0,
      server: fightOptions.server || null,
      drops: fightOptions.drops ?? null,
      clientType: fightOptions.clientType || null
    };
    const plan = {
      command: 'run',
      taskConfig: selectedFightPlan,
      semantic
    };

    if (dryRun) return sendDryRun(res, req, plan);

    return executeTrackedAgentAction(req, res, {
      operationId: 'fight',
      input: { ...semantic, waitForCompletion },
      waitForCompletion,
      metadata: { taskName: 'Agent: 理智作战', taskType: 'agent', plan },
      execute: async (lifecycle: AgentRunLifecycle) => {
        const result = await execDynamicTask(
          'fight',
          selectedFightPlan,
          'Agent: 理智作战',
          'agent',
          waitForCompletion,
          false,
          {
            lifecycle,
            clientType: fightOptions.clientType
              ? String(fightOptions.clientType)
              : dynamicConnection?.clientType
          }
        );
        return { ...result, plan };
      },
      successMessage: '理智作战执行完成',
      acceptedMessage: '理智作战已接受'
    });
  }

  const fightPlans = buildFightPlans(fightOptions);
  if (!fightPlans.length) {
    return sendError(res, req, agentError('AGENT_VALIDATION_MISSING_STAGES', '至少需要一个有效关卡', {
      statusCode: 400,
      details: { fightOptions },
      retryable: false
    }));
  }
  const effectiveWait = fightPlans.length > 1 ? true : waitForCompletion;
  const semantic = {
    stages: fightPlans.map(item => ({ stage: item.stage, times: item.times })),
    medicine: fightOptions.medicine ?? 0,
    expiringMedicine: fightOptions.expiringMedicine ?? 0,
    stone: fightOptions.stone ?? 0,
    series: fightOptions.series ?? 0
  };
  const plan = {
    command: 'fight',
    args: fightPlans[0].args,
    commands: fightPlans.map(item => item.args),
    semantic
  };

  if (dryRun) {
    return sendDryRun(res, req, plan);
  }

  return executeTrackedAgentAction(req, res, {
    operationId: 'fight',
    input: { ...plan.semantic, waitForCompletion: effectiveWait },
    waitForCompletion: effectiveWait,
    metadata: { taskName: 'Agent: 理智作战', taskType: 'agent', plan },
    execute: async (lifecycle: AgentRunLifecycle) => {
      if (fightPlans.length === 1) {
        return {
          ...(await execMaaCommand(
            'fight',
            fightPlans[0].args,
            'Agent: 理智作战',
            'agent',
            waitForCompletion,
            false,
            lifecycle
          )),
          plan
        };
      }

      const stageResults: unknown[] = [];
      for (const item of fightPlans) {
        const result = await execMaaCommand(
          'fight',
          item.args,
          `Agent: 理智作战 (${item.stage})`,
          'agent',
          true,
          false,
          lifecycle
        );
        stageResults.push({ stage: item.stage, times: item.times, result });
      }
      return { ...plan, stages: stageResults, results: stageResults };
    },
    successMessage: '理智作战执行完成',
    acceptedMessage: '理智作战已接受'
  });
}));

router.post('/actions/run-task', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const input = req.body || {};
  if (input.taskConfig !== undefined && input.taskConfig !== null) {
    try {
      validateTaskConfig(input.taskConfig);
    } catch (error) {
      return sendError(res, req, error);
    }
  }
  const requestedWait = parseWaitForCompletion(input.waitForCompletion);
  const waitForCompletion = input.command === 'activity' || input.command === 'list'
    ? true
    : requestedWait;
  return executeTrackedAgentAction(req, res, {
    operationId: 'run_task',
    input: { ...input, waitForCompletion },
    waitForCompletion,
    metadata: { taskName: input.taskName || `Agent: ${input.command || 'task'}`, taskType: input.taskType || 'agent' },
    execute: async (lifecycle: AgentRunLifecycle) => {
      const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
      return executeAgentTask(
        { ...input, waitForCompletion },
        {
          execMaaCommand: (
            command: string,
            args: string[],
            taskName: string | null,
            taskType: string | null,
            shouldWait: boolean,
            silent = false
          ) => execMaaCommand(command, args, taskName, taskType, shouldWait, silent, lifecycle),
          execDynamicTask: (
            taskId: string,
            taskConfig: unknown,
            taskName: string | null,
            taskType: string | null,
            shouldWait: boolean,
            userResource: boolean
          ) => execDynamicTask(taskId, taskConfig, taskName, taskType, shouldWait, userResource, { lifecycle, clientType })
        }
      );
    },
    successMessage: '任务执行完成',
    acceptedMessage: '任务已接受'
  });
}));

router.post('/actions/stop', asyncHandler(async (req: AgentRequest, res: AgentResponse) => {
  const requestedRunIdValue = req.body?.runId;
  const requestedRunId = requestedRunIdValue ? String(requestedRunIdValue) : null;
  const currentRun = getCurrentAgentRun();

  if (requestedRunId) {
    const requestedRun = getAgentRun(requestedRunId);
    if (!requestedRun) {
      return sendError(res, req, agentError('AGENT_RUN_NOT_FOUND', `未找到 Agent run: ${requestedRunId}`, {
        statusCode: 404,
        details: { runId: requestedRunId },
        retryable: false
      }));
    }
    if (TERMINAL_RUN_STATES.has(requestedRun.state)) {
      return sendSuccess(res, req, { stopped: false, alreadyTerminal: true, run: requestedRun }, '任务已经结束');
    }
    const manualStopped = requestedRun.state === 'waiting' ? stopManualCopilotSetRun(requestedRunId) : null;
    if (manualStopped) {
      return respondWithPersistedAgentRun(res, req, requestedRunId, '停止手动作业集时持久化失败', (persistedRun: AgentRunDto | null) =>
        sendSuccess(res, req, {
          stopped: true,
          run: enrichAgentRun(persistedRun || manualStopped)
        }, '手动作业集已停止')
      );
    }
    if (requestedRun.state === 'accepted') {
      return sendError(res, req, agentError('AGENT_RUN_NOT_STARTED', '目标 run 尚未获得执行权，未发送终止命令', {
        statusCode: 409,
        details: { requestedRunId, state: requestedRun.state },
        retryable: true
      }));
    }
    if (!currentRun || currentRun.runId !== requestedRunId) {
      return sendError(res, req, agentError('AGENT_RUN_NOT_CURRENT', '目标 run 不是当前执行，未发送终止命令', {
        statusCode: 409,
        details: { requestedRunId, currentRunId: currentRun?.runId || null },
        retryable: false
      }));
    }
  }

  const task = stopCurrentTask();
  const scheduleStopped = stopScheduleExecution();
  const stopRequested = task.success || scheduleStopped;
  let run = currentRun;
  if (stopRequested && run && ACTIVE_RUN_STATES.has(run.state)) {
    if (run.state !== 'stopping') run = markAgentRunStopping(run.runId);
    return respondWithPersistedAgentRun(
      res,
      req,
      run.runId,
      'Agent run 停止状态持久化失败',
      (persistedRun: AgentRunDto | null) => sendSuccess(res, req, {
        task,
        scheduleStopped,
        stopRequested,
        run: enrichAgentRun(persistedRun || run)
      }, '已发送终止请求')
    );
  }
  return sendSuccess(res, req, {
    task,
    scheduleStopped,
    stopRequested,
    run: enrichAgentRun(run)
  }, stopRequested ? '已发送终止请求' : '当前没有可终止的任务');
}));

export default router;
