import express from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  execMaaCommand,
  execDynamicTask,
  getMaaVersion,
  getRealtimeLogs,
  getTaskStatus,
  stopCurrentTask,
  testAdbConnection,
  discoverAdbDevices,
  captureScreen,
  getMaaConfigDir,
  getConfig,
  saveConfig,
  getCurrentActivity,
  getLogFiles,
  readLogFile,
  cleanupLogs,
  getDebugScreenshots,
  clearRealtimeLogs
} from '../services/maaService.js';
import { executeScheduleNow, getScheduledTaskFlowPlan, getScheduleExecutionStatus, stopScheduleExecution, getScheduleStatus, setupSchedule, stopSchedule, setupAutoUpdate, getAutoUpdateStatus } from '../services/schedulerService.js';
import { loadUserConfig, saveUserConfig, getAllUserConfigs, deleteUserConfig } from '../services/configStorageService.js';
import sklandService from '../services/sklandService.js';
import { getNotificationConfig, sendNotification, sendToChannel, testNotificationChannel, setNotificationConfig, getTodayOpenStages } from '../services/notificationService.js';
import operatorTrainingService from '../services/operatorTrainingService.js';
import { getMaaResourceInfo, updateMaaResources } from '../services/resourceUpdateService.js';
import { parseDepotData, parseOperBoxData, getDepotData, getOperBoxData, getAllOperators } from '../services/dataParserService.js';
import { getTodayDrops, getRecentDrops, getDropStatistics } from '../services/dropRecordService.js';
import { loadParadoxOperators, resolveStageSearchKeyword } from '../services/copilotService.js';
import { buildCopilotPlan, executeCopilotPlan, resetCopilotPlanProgress } from '../services/copilotPlanService.js';
import { getActivityRunPreflight } from '../services/activityNavigationService.js';
import { findActivityCopilotCandidates } from '../services/activityCopilotDiscoveryService.js';
import { getActivityCompletion, runCurrentActivityCopilots } from '../services/activityCopilotRunService.js';
import { withMaaExecutionLease } from '../services/executionCoordinatorService.js';
import { createDailyFlowExecutionError, executeAgentTask, normalizeDailyFlowRequest } from '../services/agentActionService.js';
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
  releaseAgentRunIdempotency,
  setAgentRunAcceptedResult,
  flushAgentRunStore,
  withFlushedAgentRunSnapshot
} from '../services/agentRunService.js';
import {
  asyncHandler,
  agentError,
  sendSuccess,
  sendDryRun,
  sendError
} from '../utils/apiHelper.js';
import { createLogger } from '../utils/logger.js'
import { resolveConnectionInput } from '../services/connectionService.js'
import { API_VERSION, buildAgentManifest, buildOpenApiSpec } from './agentContract.js';
import {
  getWebrtcStatus,
  installWebrtc,
  startWebrtcServer,
  stopWebrtcServer,
  startWebrtcAgent,
  stopWebrtcAgent,
  startWebrtc,
  stopWebrtc,
  isWebrtcServerReachable,
  getWebrtcDevices,
  WEBRTC_PORT,
  DEFAULT_DEVICE_ADDRESS,
  DEFAULT_DEVICE_ID
} from '../services/webrtcService.js';

const router = express.Router();
const execFileAsync = promisify(execFile);
const logger = createLogger('AgentRoutes');

const DEFAULT_ADB_PATH = process.env.ADB_PATH || '/opt/homebrew/bin/adb';
const DEFAULT_ADB_ADDRESS = process.env.ADB_ADDRESS || '127.0.0.1:16384';
const DEFAULT_CLIENT_TYPE = process.env.MAA_CLIENT_TYPE || 'Official';
const ACTIVE_RUN_STATES = new Set(['accepted', 'running', 'stopping']);
const TERMINAL_RUN_STATES = new Set(['succeeded', 'failed', 'stopped', 'interrupted']);

function getIdempotencyKey(req) {
  return req.get?.('Idempotency-Key')
    ?? req.headers?.['idempotency-key']
    ?? req.headers?.['Idempotency-Key']
    ?? null;
}

function setRunResponseHeaders(res, run, replayed, includeLocation = false) {
  const headers = {
    'X-La-Pluma-Run-Id': run.runId,
    'Idempotency-Replayed': String(Boolean(replayed))
  };
  if (includeLocation) headers.Location = run.links.self;

  for (const [name, value] of Object.entries(headers)) {
    if (typeof res.set === 'function') res.set(name, value);
    else if (typeof res.setHeader === 'function') res.setHeader(name, value);
  }
}

function enrichAgentRun(run) {
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
  return {
    ...run,
    progress: {
      currentStep: null,
      totalSteps: null,
      currentTask: task.taskName,
      message: task.stopRequested ? '正在终止任务' : task.isRunning ? '任务执行中' : '等待任务启动'
    }
  };
}

function runResponseData(result, run) {
  const base = result && typeof result === 'object' && !Array.isArray(result)
    ? { ...result }
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

function sendRunSuccess(res, req, result, run, {
  message = '操作成功',
  replayed = false,
  accepted = false
} = {}) {
  const enrichedRun = enrichAgentRun(run);
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

function sendRunFailure(res, req, run, replayed = false) {
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
  return sendError(res, req, error, undefined, { runId: run.runId, idempotentReplay: replayed });
}

function respondWithExistingRun(res, req, run, message = '返回已有执行') {
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

function isPreExecutionError(error) {
  return error?.code === 'MAA_EXECUTION_BUSY'
    || error?.code === 'AGENT_EXECUTION_BUSY'
    || String(error?.code || '').startsWith('AGENT_VALIDATION_');
}

async function settleBackgroundRun(runId, outcome) {
  const current = getAgentRun(runId);
  if (!current || TERMINAL_RUN_STATES.has(current.state)) return current;
  try {
    let run;
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
    logger.error('更新或持久化 Agent run 终态失败', { runId, error: error.message });
    return getAgentRun(runId);
  }
}

async function persistAgentRunMutation(runId, context) {
  try {
    await flushAgentRunStore();
    return null;
  } catch (error) {
    logger.error(context, { runId, error: error.message });
    return error;
  }
}

async function respondWithPersistedAgentRun(res, req, runId, context, respond) {
  try {
    return await withFlushedAgentRunSnapshot(runId, respond);
  } catch (error) {
    logger.error(context, { runId, error: error.message });
    return sendRunPersistenceFailure(res, req, runId, error);
  }
}

function sendRunPersistenceFailure(res, req, runId, error) {
  const run = getAgentRun(runId);
  const persistenceError = agentError(
    error?.code || 'AGENT_RUN_PERSISTENCE_FAILED',
    error?.message || 'Agent run 持久化失败',
    {
      statusCode: error?.statusCode || error?.status || 503,
      details: {
        ...(error?.details || {}),
        runId,
        run
      },
      retryable: error?.retryable ?? true
    }
  );
  return sendError(res, req, persistenceError, undefined, { runId });
}

function mergeBackgroundOutcome(outcome, acceptedResult) {
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

export async function executeTrackedAgentAction(req, res, {
  operationId,
  input,
  waitForCompletion = true,
  metadata = {},
  execute,
  successMessage = '操作成功',
  acceptedMessage = '任务已接受'
}) {
  const reservation = beginAgentRun({
    operationId,
    idempotencyKey: getIdempotencyKey(req),
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
  let acceptedResult;
  let hasAcceptedResult = false;
  let pendingOutcome = null;
  const settleAcceptedBackgroundRun = async (outcome) => {
    if (!hasAcceptedResult) {
      pendingOutcome = outcome;
      return null;
    }
    return settleBackgroundRun(runId, mergeBackgroundOutcome(outcome, acceptedResult));
  };
  const lifecycle = {
    onStarted: ensureRunStarted,
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
    let run = getAgentRun(runId);
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
      persistedRun => {
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
    const run = error?.stopped || current?.state === 'stopping'
      ? stopAgentRun(runId, {
          message: error.message,
          exitCode: error.exitCode ?? null,
          signal: error.signal ?? null
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
          return sendRunSuccess(res, req, terminalRun.result, terminalRun, { message: '任务已终止' });
        }
        return sendRunFailure(res, req, terminalRun);
      }
    );
  }
}

function parseWaitForCompletion(value, defaultValue = true) {
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

function sendConfigStorageError(res, req, result, fallbackCode, fallbackMessage) {
  const invalidType = result?.error?.code === 'AGENT_CONFIG_TYPE_INVALID';
  return sendError(res, req, agentError(
    invalidType ? 'AGENT_CONFIG_TYPE_INVALID' : fallbackCode,
    result?.message || fallbackMessage,
    {
      statusCode: invalidType ? 400 : 500,
      details: result?.error?.details || {},
      retryable: !invalidType
    }
  ));
}

async function getAdbSummary(adbPath = DEFAULT_ADB_PATH, address = DEFAULT_ADB_ADDRESS) {
  const connection = await testAdbConnection(adbPath, address);
  let foreground = null;
  let devices = '';

  try {
    const { stdout } = await execFileAsync(adbPath, ['devices', '-l'], { timeout: 5000 });
    devices = stdout.trim();
  } catch (error) {
    devices = `adb devices failed: ${error.message}`;
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

async function getWebrtcSummary(address = DEFAULT_DEVICE_ADDRESS, adbPath = DEFAULT_ADB_PATH) {
  const [status, reachable] = await Promise.all([
    getWebrtcStatus(address, adbPath).catch(() => null),
    isWebrtcServerReachable()
  ])
  return {
    ...(status || {}),
    url: status?.url || `http://127.0.0.1:${WEBRTC_PORT}`,
    reachable,
    serverRunning: Boolean(status?.serverRunning || reachable),
    agentRunning: Boolean(status?.agentRunning),
    installed: Boolean(status?.installed),
    built: Boolean(status?.built),
    note: reachable ? 'WebRTC page is reachable. Use browser UI to connect the device.' : 'WebRTC page is not reachable. Start it from /api/agent/webrtc/start or the Web UI.'
  }
}

async function resolveRequestConnection(req, { allowOverrides = false } = {}) {
  const input = { ...(req.query || {}), ...(req.body || {}) }
  return resolveConnectionInput(input, { allowOverrides })
}

function pngDimensions(base64) {
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

async function getAndroidDisplayState(adbPath = DEFAULT_ADB_PATH, address = DEFAULT_ADB_ADDRESS) {
  const readSetting = async (name) => {
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

function buildOrientationPlan({ orientation, adbPath = DEFAULT_ADB_PATH, address = DEFAULT_ADB_ADDRESS } = {}) {
  const normalized = String(orientation || '').trim().toLowerCase();
  const rotationByOrientation = { portrait: '0', landscape: '1' };

  if (!['portrait', 'landscape', 'auto'].includes(normalized)) {
    throw agentError('AGENT_VALIDATION_ORIENTATION_INVALID', 'orientation 必须是 portrait、landscape 或 auto', {
      statusCode: 400,
      details: { orientation },
      retryable: false
    });
  }

  const commands = normalized === 'auto'
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
    commands: commands.map(args => ({ command: adbPath, args: ['-s', address, 'shell', ...args] }))
  };
}

async function setAndroidOrientation(options = {}) {
  const plan = buildOrientationPlan(options);
  const results = [];

  for (const item of plan.commands) {
    try {
      const { stdout, stderr } = await execFileAsync(item.command, item.args, { timeout: 7000, maxBuffer: 256 * 1024 });
      results.push({ ok: true, args: item.args, stdout: stdout.trim(), stderr: stderr.trim() });
    } catch (error) {
      const optionalCmdWindow = item.args.includes('cmd') && item.args.includes('window') && item.args.includes('set-user-rotation');
      results.push({ ok: optionalCmdWindow, optional: optionalCmdWindow, args: item.args, error: error.message, stdout: (error.stdout || '').trim(), stderr: (error.stderr || '').trim() });
      if (!optionalCmdWindow) throw error;
    }
  }

  await new Promise(resolve => setTimeout(resolve, 500));
  return {
    ...plan,
    results,
    observed: await getAndroidDisplayState(plan.adbPath, plan.address)
  };
}

function buildFightArgs({ stages, stage, times, medicine = 0, expiringMedicine = 0, stone = 0, series = 0 } = {}) {
  const rawStages = Array.isArray(stages) ? stages : [{ stage: stage || '', times: times || '' }];
  const stageList = rawStages
    .map(item => typeof item === 'string' ? { stage: item, times: '' } : item)
    .filter(item => item?.stage && String(item.stage).trim())
    .map(item => `${String(item.stage).trim()}${item.times !== undefined && item.times !== '' && item.times !== null ? `:${item.times}` : ''}`)
    .join(',');

  if (!stageList) return [];

  const args = [stageList];
  if (medicine !== undefined && medicine !== '' && medicine !== null) args.push('-m', String(medicine));
  if (expiringMedicine !== undefined && expiringMedicine !== '' && expiringMedicine !== null) args.push('--expiring-medicine', String(expiringMedicine));
  if (stone !== undefined && stone !== '' && stone !== null) args.push('--stone', String(stone));
  if (series !== undefined && series !== '' && series !== null && String(series) !== '1') args.push('--series', String(series));
  return args;
}

async function loadAutomationTaskFlow(overrideTaskFlow = null) {
  if (Array.isArray(overrideTaskFlow)) return overrideTaskFlow;
  const saved = await loadUserConfig('automation-tasks');
  return saved.success && Array.isArray(saved.data?.taskFlow) ? saved.data.taskFlow : [];
}

async function buildAgentStatus(req) {
  const connection = await resolveRequestConnection(req, { allowOverrides: true })
  const { adbPath, address } = connection
  const [version, adb, webrtc, orientation] = await Promise.all([
    getMaaVersion(true).catch(error => ({ error: error.message })),
    getAdbSummary(adbPath, address).catch(error => ({ connected: false, error: error.message, adbPath, address })),
    getWebrtcSummary(address, adbPath),
    getAndroidDisplayState(adbPath, address).catch(error => ({ error: error.message, adbPath, address }))
  ]);
  const task = getTaskStatus();
  const logs = getRealtimeLogs(25);
  const recommendations = [];

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

router.get('/manifest', (req, res) => {
  return sendSuccess(res, req, buildAgentManifest({
    adbPath: DEFAULT_ADB_PATH,
    adbAddress: DEFAULT_ADB_ADDRESS,
    clientType: DEFAULT_CLIENT_TYPE
  }));
});

router.get('/openapi.json', (req, res) => {
  res.json(buildOpenApiSpec({
    adbPath: DEFAULT_ADB_PATH,
    adbAddress: DEFAULT_ADB_ADDRESS,
    clientType: DEFAULT_CLIENT_TYPE
  }));
});

router.get('/status', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, await buildAgentStatus(req));
}));

router.get('/runs/current', asyncHandler(async (req, res) => {
  const lines = Math.min(Math.max(Number(req.query.lines || 80), 1), 500);
  const task = getTaskStatus();
  const schedule = getScheduleExecutionStatus();
  const recentLogs = getRealtimeLogs(lines);
  const currentRun = enrichAgentRun(getCurrentAgentRun());
  const lastRun = listAgentRuns({ limit: 500 })
    .filter(run => TERMINAL_RUN_STATES.has(run.state))
    .sort((left, right) => String(right.finishedAt).localeCompare(String(left.finishedAt)))[0] || null;
  return sendSuccess(res, req, {
    ...task,
    schedule,
    recentLogs,
    run: currentRun,
    lastRun
  });
}));

router.get('/runs/:runId', asyncHandler(async (req, res) => {
  const run = getAgentRun(req.params.runId);
  if (!run) {
    return sendError(res, req, agentError('AGENT_RUN_NOT_FOUND', `未找到 Agent run: ${req.params.runId}`, {
      statusCode: 404,
      details: { runId: req.params.runId },
      retryable: false
    }));
  }
  return sendSuccess(res, req, enrichAgentRun(run));
}));

router.get('/tasks/status', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, getTaskStatus());
}));

router.post('/screen/screenshot', asyncHandler(async (req, res) => {
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

router.get('/logs/recent', asyncHandler(async (req, res) => {
  const lines = Math.min(Math.max(Number(req.query.lines || 80), 1), 500);
  return sendSuccess(res, req, getRealtimeLogs(lines));
}));

router.post('/logs/recent/clear', asyncHandler(async (req, res) => {
  clearRealtimeLogs();
  return sendSuccess(res, req, null, '实时日志已清空');
}));

router.get('/debug-screenshots', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, await getDebugScreenshots());
}));

router.get('/logs/files', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, await getLogFiles());
}));

router.get('/logs/files/:filePath(*)', asyncHandler(async (req, res) => {
  const { filePath } = req.params;
  const lines = Math.min(Math.max(Number(req.query.lines || 1000), 1), 5000);
  return sendSuccess(res, req, await readLogFile(decodeURIComponent(filePath), lines));
}));

router.post('/logs/cleanup', asyncHandler(async (req, res) => {
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

router.get('/config/maa/:profileName', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, await getConfig(req.params.profileName));
}));

router.post('/config/maa/:profileName', asyncHandler(async (req, res) => {
  await saveConfig(req.params.profileName, req.body || {});
  return sendSuccess(res, req, null, '配置保存成功');
}));

router.get('/config/user/:configType', asyncHandler(async (req, res) => {
  const result = await loadUserConfig(req.params.configType);
  if (!result.success) {
    return sendConfigStorageError(res, req, result, 'AGENT_CONFIG_LOAD_FAILED', '读取配置失败');
  }
  return sendSuccess(res, req, result.data, result.message || '操作成功');
}));

router.post('/config/user/:configType', asyncHandler(async (req, res) => {
  const result = await saveUserConfig(req.params.configType, req.body);
  if (!result.success) {
    return sendConfigStorageError(res, req, result, 'AGENT_CONFIG_SAVE_FAILED', '保存配置失败');
  }
  return sendSuccess(res, req, null, result.message || '配置保存成功');
}));

router.get('/config/user', asyncHandler(async (req, res) => {
  const result = await getAllUserConfigs();
  if (!result.success) {
    return sendConfigStorageError(res, req, result, 'AGENT_CONFIG_LIST_FAILED', '获取配置列表失败');
  }
  return sendSuccess(res, req, result.data || {}, result.message || '操作成功');
}));

router.delete('/config/user/:configType', asyncHandler(async (req, res) => {
  const result = await deleteUserConfig(req.params.configType);
  if (!result.success) {
    return sendConfigStorageError(res, req, result, 'AGENT_CONFIG_DELETE_FAILED', '删除配置失败');
  }
  return sendSuccess(res, req, null, result.message || '配置删除成功');
}));

router.get('/activity', asyncHandler(async (req, res) => {
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
    message: activityInfo.code ? `当前活动: ${activityInfo.name || activityInfo.code}` : '当前没有活动或无法获取活动信息'
  });
}));

router.get('/activity/preflight', asyncHandler(async (req, res) => {
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const preflight = await getActivityRunPreflight(clientType);
  return sendSuccess(res, req, preflight, preflight.reason);
}));

router.get('/activity/copilot-candidates', asyncHandler(async (req, res) => {
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  const candidates = await findActivityCopilotCandidates(clientType);
  return sendSuccess(res, req, candidates, candidates.reason);
}));

router.post('/activity/run', asyncHandler(async (req, res) => {
  const { clientType } = await resolveRequestConnection(req, { allowOverrides: true });
  return executeTrackedAgentAction(req, res, {
    operationId: 'run_current_activity_copilots',
    input: { clientType },
    metadata: { taskName: '当前活动作业', taskType: 'activity' },
    execute: lifecycle => runCurrentActivityCopilots(clientType, lifecycle),
    successMessage: '当前活动作业执行完成'
  });
}));

router.get('/stages/open-today', asyncHandler(async (_req, res) => {
  return sendSuccess(res, _req, getTodayOpenStages(), '已获取今日开放日常关卡');
}));

router.get('/drops/today', asyncHandler(async (req, res) => {
  const result = await getTodayDrops();
  return sendSuccess(res, req, result.data || result, result.message || '操作成功');
}));

router.get('/drops/recent', asyncHandler(async (req, res) => {
  const days = Number(req.query.days || 7);
  const result = await getRecentDrops(days);
  return sendSuccess(res, req, result.data || result, result.message || '操作成功');
}));

router.get('/drops/statistics', asyncHandler(async (req, res) => {
  const days = Number(req.query.days || 7);
  const result = await getDropStatistics(days);
  return sendSuccess(res, req, result.data || result, result.message || '操作成功');
}));

router.get('/data/depot', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, await getDepotData());
}));

router.post('/actions/depot-recognition', asyncHandler(async (req, res) => {
  const plan = {
    action: 'depot-recognition',
    sideEffects: ['parse_maa_logs', 'update_local_depot_cache']
  };
  if (req.body?.dryRun) {
    return sendDryRun(res, req, plan);
  }
  return sendSuccess(res, req, await parseDepotData(), '仓库识别完成');
}));

router.get('/data/operbox', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, await getOperBoxData());
}));

router.post('/actions/operbox-recognition', asyncHandler(async (req, res) => {
  const plan = {
    action: 'operbox-recognition',
    sideEffects: ['parse_maa_logs', 'update_local_operbox_cache']
  };
  if (req.body?.dryRun) {
    return sendDryRun(res, req, plan);
  }
  return sendSuccess(res, req, await parseOperBoxData(), '干员识别完成');
}));

router.get('/data/operators', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, await getAllOperators());
}));

router.get('/changelog/core', asyncHandler(async (req, res) => {
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

    const releases = await response.json();

    const latestBeta = releases.find(release => release.prerelease);
    const latestStable = releases.find(release => !release.prerelease);

    const changelog = [];

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
    return sendError(res, req, agentError('AGENT_CHANGELOG_CORE_FETCH_FAILED', `获取 MaaCore 更新日志失败: ${error.message}`, {
      statusCode: 502,
      details: { provider: 'github', target: 'MaaAssistantArknights' },
      retryable: true
    }));
  }
}));

router.get('/changelog/cli', asyncHandler(async (req, res) => {
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

    const releases = await response.json();
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
    return sendError(res, req, agentError('AGENT_CHANGELOG_CLI_FETCH_FAILED', `获取 MAA CLI 更新日志失败: ${error.message}`, {
      statusCode: 502,
      details: { provider: 'github', target: 'maa-cli' },
      retryable: true
    }));
  }
}));

router.get('/copilots/:id', asyncHandler(async (req, res) => {
  const response = await fetch(`https://prts.maa.plus/copilot/get/${req.params.id}`);
  const data = await response.json();
  return sendSuccess(res, req, data);
}));

router.get('/copilot-sets/:id', asyncHandler(async (req, res) => {
  const response = await fetch(`https://prts.maa.plus/set/get?id=${encodeURIComponent(req.params.id)}`);
  const data = await response.json();
  return sendSuccess(res, req, data);
}));

router.get('/copilot-sets/:id/plan', asyncHandler(async (req, res) => {
  const raid = ['normal', 'raid', 'both'].includes(req.query.raid) ? req.query.raid : 'normal';
  return sendSuccess(res, req, await buildCopilotPlan(req.params.id, raid));
}));

router.post('/copilot-sets/:id/execute', asyncHandler(async (req, res) => {
  const { raid = 'normal', selectedIndexes = [], options = {} } = req.body || {};
  const result = await executeCopilotPlan({
    setId: req.params.id,
    raid,
    selectedIndexes: Array.isArray(selectedIndexes) ? selectedIndexes : [],
    options
  });
  return sendSuccess(res, req, result);
}));

router.post('/copilot-sets/:id/reset-progress', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, await resetCopilotPlanProgress(req.params.id));
}));

router.get('/paradox/search', asyncHandler(async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) {
    return sendError(res, req, agentError('AGENT_VALIDATION_OPERATOR_NAME_REQUIRED', '请提供干员名字', { statusCode: 400 }));
  }

  const paradoxData = await loadParadoxOperators();
  const operator = paradoxData.find(op => op.name.includes(name) || name.includes(op.name));
  if (!operator) {
    return sendError(res, req, agentError('AGENT_PARADOX_OPERATOR_NOT_FOUND', `未找到干员"${name}"的悖论模拟关卡`, { statusCode: 404, details: { name } }));
  }

  const response = await fetch(`https://prts.maa.plus/copilot/query?level_keyword=${operator.stage_id}&page=1&limit=10&order_by=hot`);
  const data = await response.json();
  if (data.status_code !== 200 || !data.data?.data?.length) {
    return sendError(res, req, agentError('AGENT_PARADOX_COPILOT_NOT_FOUND', `未找到干员"${operator.name}"的作业`, { statusCode: 404, details: { operator: operator.name, stageId: operator.stage_id } }));
  }

  const copilots = data.data.data.map(item => {
    let title = item.doc?.title || '无标题';
    try {
      const content = JSON.parse(item.content || '{}');
      title = content.doc?.title || title;
    } catch {}
    return {
      id: item.id,
      uri: `maa://${item.id}`,
      views: item.views,
      hotScore: item.hot_score,
      uploader: item.uploader_id,
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

router.get('/copilot/search', asyncHandler(async (req, res) => {
  const stage = String(req.query.stage || '').trim();
  if (!stage) {
    return sendError(res, req, agentError('AGENT_VALIDATION_STAGE_REQUIRED', '请提供关卡名称', { statusCode: 400 }));
  }

  const normalizedStage = stage.toUpperCase();
  const searchKeyword = await resolveStageSearchKeyword(stage);
  const allCopilots = [];
  let page = 1;
  const maxPages = 5;
  const targetCount = 10;

  while (page <= maxPages && allCopilots.length < targetCount) {
    const response = await fetch(`https://prts.maa.plus/copilot/query?level_keyword=${encodeURIComponent(searchKeyword)}&page=${page}&limit=50&order_by=hot`);
    const data = await response.json();
    if (data.status_code !== 200 || !data.data?.data?.length) break;

    for (const item of data.data.data) {
      let title = '无标题';
      let stageName = stage;
      let titleStageCode = '';
      try {
        const content = JSON.parse(item.content);
        title = content.doc?.title || '无标题';
        stageName = content.stage_name || stage;
        const titleMatch = title.match(/^([A-Z]{2,4}-\d+[A-Z]?)/i);
        if (titleMatch) titleStageCode = titleMatch[1].toUpperCase();
      } catch {}

      const normalizedStageName = String(stageName || '').trim().toUpperCase();
      const normalizedSearchKeyword = String(searchKeyword || '').trim().toUpperCase();
      if (normalizedStageName === normalizedStage || normalizedStageName === normalizedSearchKeyword || titleStageCode === normalizedStage) {
        allCopilots.push({
          id: item.id,
          uri: `maa://${item.id}`,
          views: item.views,
          hotScore: item.hot_score,
          uploader: item.uploader_id,
          title,
          stageName
        });
      }
    }

    if (!data.data.has_next) break;
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

router.get('/paradox/operators', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, await loadParadoxOperators());
}));

router.get('/training/operators', asyncHandler(async (req, res) => {
  const filters = {
    rarity: req.query.rarity ? parseInt(req.query.rarity) : undefined,
    profession: req.query.profession,
    owned: req.query.owned === 'true' ? true : req.query.owned === 'false' ? false : undefined,
    needsElite2: req.query.needsElite2 === 'true',
    status: req.query.status || 'trainable'
  };
  const operators = await operatorTrainingService.getOperatorList(filters);
  return sendSuccess(res, req, { operators, count: operators.length });
}));

router.get('/training/queue', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, await operatorTrainingService.getTrainingQueue());
}));

router.post('/training/queue', asyncHandler(async (req, res) => {
  const { operatorId, currentElite, targetElite } = req.body || {};
  if (!operatorId) {
    return sendError(res, req, agentError('AGENT_VALIDATION_OPERATOR_ID_REQUIRED', '缺少 operatorId 参数', { statusCode: 400 }));
  }
  const queueItem = await operatorTrainingService.addToQueue(operatorId, { currentElite, targetElite });
  return sendSuccess(res, req, queueItem, '已添加到养成队列');
}));

router.delete('/training/queue/:operatorId', asyncHandler(async (req, res) => {
  await operatorTrainingService.removeFromQueue(req.params.operatorId);
  return sendSuccess(res, req, null, '已从养成队列中移除');
}));

router.put('/training/queue/order', asyncHandler(async (req, res) => {
  const { operatorIds } = req.body || {};
  if (!Array.isArray(operatorIds)) {
    return sendError(res, req, agentError('AGENT_VALIDATION_OPERATOR_IDS_REQUIRED', 'operatorIds 必须是数组', { statusCode: 400 }));
  }
  await operatorTrainingService.updateQueueOrder(operatorIds);
  return sendSuccess(res, req, null, '队列顺序已更新');
}));

router.put('/training/settings', asyncHandler(async (req, res) => {
  const settings = await operatorTrainingService.updateSettings(req.body || {});
  return sendSuccess(res, req, settings, '设置已更新');
}));

router.post('/training/plan', asyncHandler(async (req, res) => {
  const plan = await operatorTrainingService.generateTrainingPlan(req.body?.mode || 'current');
  return sendSuccess(res, req, plan);
}));

router.post('/actions/apply-training-plan', asyncHandler(async (req, res) => {
  const { plan, settings, taskType = 'combat' } = req.body || {};
  if (!plan) {
    return sendError(res, req, agentError('AGENT_VALIDATION_PLAN_REQUIRED', '缺少 plan 参数', { statusCode: 400 }));
  }
  const result = await operatorTrainingService.applyPlanToTasks(plan, settings, taskType);
  return sendSuccess(res, req, result, '养成计划已应用到任务流程');
}));

router.post('/actions/fetch-training-materials', asyncHandler(async (req, res) => {
  const plan = { action: 'fetch-training-materials', sideEffects: ['refresh_training_material_cache'] };
  if (req.body?.dryRun) {
    return sendDryRun(res, req, plan);
  }
  const result = await operatorTrainingService.fetchOperatorMaterials();
  return sendSuccess(res, req, result, '养成材料数据已更新');
}));

router.get('/webrtc/status', asyncHandler(async (req, res) => {
  const { address, adbPath, profileId } = await resolveRequestConnection(req, { allowOverrides: true })
  const summary = await getWebrtcSummary(address, adbPath);
  return sendSuccess(res, req, { ...summary, profileId, devices: await getWebrtcDevices() });
}));

router.get('/webrtc/devices', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, { devices: await getWebrtcDevices() });
}));

router.post('/webrtc/start', asyncHandler(async (req, res) => {
  const { address, adbPath, profileId } = await resolveRequestConnection(req, { allowOverrides: true })
  const deviceId = req.body?.deviceId || DEFAULT_DEVICE_ID;
  const status = await startWebrtc(address, deviceId, adbPath);
  const summary = await getWebrtcSummary(address, adbPath);
  return sendSuccess(res, req, {
    ...summary,
    ...status,
    devices: await getWebrtcDevices(),
    deviceId,
    address,
    profileId,
    protocol: {
      websocket: `${summary.url.replace(/^http/, 'ws')}/connect_client?token=`,
      connectMessage: { message_type: 'connect', device_id: deviceId },
      requestOfferPayload: { type: 'request-offer', ip_preference: 'ipv4' },
      candidatePolicy: 'relay preferred / ipv4'
    }
  });
}));

router.post('/webrtc/stop', asyncHandler(async (req, res) => {
  const { address, adbPath } = await resolveRequestConnection(req, { allowOverrides: true })
  return sendSuccess(res, req, await stopWebrtc(address, adbPath));
}));

router.post('/preview/orientation', asyncHandler(async (req, res) => {
  const { orientation, dryRun = false } = req.body || {};
  const { adbPath, address } = await resolveRequestConnection(req, { allowOverrides: true })
  const plan = buildOrientationPlan({ orientation, adbPath, address });

  if (dryRun) {
    return sendDryRun(res, req, plan);
  }

  return sendSuccess(res, req, await setAndroidOrientation({ orientation, adbPath, address }), '屏幕方向已设置');
}));

router.post('/webrtc/install', asyncHandler(async (req, res) => {
  const result = await installWebrtc();
  return sendSuccess(res, req, result, 'WebRTC 组件已安装');
}));

router.post('/webrtc/start-server', asyncHandler(async (req, res) => {
  const { address, adbPath } = await resolveRequestConnection(req, { allowOverrides: true })
  const result = await startWebrtcServer(address, adbPath);
  return sendSuccess(res, req, result, 'WebRTC 服务已启动');
}));

router.post('/webrtc/stop-server', asyncHandler(async (req, res) => {
  const { address, adbPath } = await resolveRequestConnection(req, { allowOverrides: true })
  const result = await stopWebrtcServer(address, adbPath);
  return sendSuccess(res, req, result, 'WebRTC 服务已停止');
}));

router.post('/webrtc/start-agent', asyncHandler(async (req, res) => {
  const { address, adbPath } = await resolveRequestConnection(req, { allowOverrides: true })
  const deviceId = req.body?.deviceId || DEFAULT_DEVICE_ID;
  const result = await startWebrtcAgent(address, deviceId, adbPath);
  return sendSuccess(res, req, result, 'MuMu Agent 已启动');
}));

router.post('/webrtc/stop-agent', asyncHandler(async (req, res) => {
  const { address, adbPath } = await resolveRequestConnection(req, { allowOverrides: true })
  const result = await stopWebrtcAgent(address, adbPath);
  return sendSuccess(res, req, result, 'MuMu Agent 已停止');
}));

async function getDeviceStats(adbPath, address) {
  try {
    const cmd = (c) => execFileAsync(adbPath, ['-s', address, 'shell', c], { timeout: 5000, maxBuffer: 256 * 1024 })
    const [loadRaw, memRaw, diskRaw, tempRaw, topRaw] = await Promise.all([
      cmd('cat /proc/loadavg'),
      cmd('cat /proc/meminfo | head -4'),
      cmd('df -h /data | tail -1'),
      cmd('dumpsys battery | grep temperature'),
      cmd('top -b -n 1 -d 0.3 | head -5'),
    ])

    // CPU load from /proc/loadavg
    const loadParts = loadRaw.stdout.trim().split(/\s+/)
    // CPU usage % from top output: "400%cpu  0%user ... 396%idle"
    const topTotal = topRaw.stdout.match(/(\d+)%cpu/i)
    const topIdle  = topRaw.stdout.match(/(\d+)%idle/i)
    const cpuPct = topTotal && topIdle ? Math.round(((parseInt(topTotal[1]) - parseInt(topIdle[1])) / parseInt(topTotal[1])) * 100) : null
    // Memory from /proc/meminfo (kB)
    const memInfo = {};
    for (const line of memRaw.stdout.split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+)/);
      if (m) memInfo[m[1]] = parseInt(m[2]);
    }
    const memTotalKb = memInfo['MemTotal'] || 0;
    const memFreeKb  = memInfo['MemFree'] || 0;
    const memAvailKb = memInfo['MemAvailable'] || 0;
    const memUsedKb  = memTotalKb - (memAvailKb || memFreeKb);
    const swapTotalKb = memInfo['SwapTotal'] || 0;
    const swapUsedKb  = swapTotalKb - (memInfo['SwapFree'] || 0);
    const diskParts = diskRaw.stdout.trim().split(/\s+/)
    const tempMatch = tempRaw.stdout.match(/temperature:\s*(\d+)/)

    const fmtMb = (kb) => kb >= 1048576 ? `${(kb / 1048576).toFixed(1)}G` : kb >= 1024 ? `${Math.round(kb / 1024)}M` : `${kb}K`

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
  } catch { return null }
}

router.get('/device-stats', asyncHandler(async (req, res) => {
  const { adbPath, address } = await resolveRequestConnection(req, { allowOverrides: true })
  const stats = await getDeviceStats(adbPath, address);
  return sendSuccess(res, req, stats);
}));

router.get('/skland/status', asyncHandler(async (req, res) => {
  const isLoggedIn = await sklandService.isLoggedIn();
  const config = await sklandService.getConfig();
  return sendSuccess(res, req, {
    isLoggedIn,
    phone: config?.phone || null,
    loginTime: config?.loginTime || null
  });
}));

router.get('/skland/player', asyncHandler(async (req, res) => {
  const useCache = req.query.cache !== 'false';
  const result = await sklandService.getDashboardSummary(useCache);
  if (!result.success) {
    return sendError(res, req, agentError(result.error === '未登录' ? 'AGENT_SKLAND_NOT_LOGGED_IN' : 'AGENT_SKLAND_FETCH_FAILED', result.error || '获取森空岛数据失败', {
      statusCode: result.error === '未登录' ? 401 : 400,
      details: { useCache },
      retryable: result.error !== '未登录'
    }));
  }
  return sendSuccess(res, req, result.data, result.cached ? '使用缓存数据' : '获取成功');
}));

router.post('/skland/send-code', asyncHandler(async (req, res) => {
  const phone = req.body?.phone;
  if (!phone) {
    return sendError(res, req, agentError('AGENT_VALIDATION_PHONE_REQUIRED', '手机号不能为空', { statusCode: 400 }));
  }
  const result = await sklandService.sendCode(phone);
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_SKLAND_SEND_CODE_FAILED', result.error || '发送失败', { statusCode: 400 }));
  }
  return sendSuccess(res, req, null, result.message || '验证码已发送');
}));

router.post('/skland/login', asyncHandler(async (req, res) => {
  const { phone, code, savePassword } = req.body || {};
  if (!phone || !code) {
    return sendError(res, req, agentError('AGENT_VALIDATION_SKLAND_LOGIN_REQUIRED', '手机号和验证码/密码不能为空', { statusCode: 400 }));
  }
  const result = await sklandService.login(phone, code, savePassword || false);
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_SKLAND_LOGIN_FAILED', result.error || '登录失败', { statusCode: 400 }));
  }
  return sendSuccess(res, req, null, result.message || '登录成功');
}));

router.post('/skland/logout', asyncHandler(async (req, res) => {
  const result = await sklandService.logout();
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_SKLAND_LOGOUT_FAILED', result.error || '登出失败', { statusCode: 400 }));
  }
  return sendSuccess(res, req, null, '登出成功');
}));

router.post('/skland/refresh', asyncHandler(async (req, res) => {
  const result = await sklandService.getPlayerData(false);
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_SKLAND_REFRESH_FAILED', result.error || '刷新失败', { statusCode: 400 }));
  }
  return sendSuccess(res, req, result.data, '刷新成功');
}));

router.get('/notifications/config', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, getNotificationConfig());
}));

router.post('/notifications/config', asyncHandler(async (req, res) => {
  const result = await saveUserConfig('notification', req.body || {});
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_NOTIFICATION_CONFIG_SAVE_FAILED', result.message || '通知配置保存失败', { statusCode: 500 }));
  }
  setNotificationConfig(req.body || {});
  return sendSuccess(res, req, null, '通知配置已保存');
}));

router.post('/actions/test-notification-channel', asyncHandler(async (req, res) => {
  const channel = req.body?.channel;
  const config = req.body?.config;
  if (!channel) {
    return sendError(res, req, agentError('AGENT_VALIDATION_CHANNEL_REQUIRED', '缺少通知渠道', { statusCode: 400 }));
  }
  if (config != null && (typeof config !== 'object' || Array.isArray(config))) {
    return sendError(res, req, agentError('AGENT_VALIDATION_NOTIFICATION_CONFIG_INVALID', '通知渠道配置格式无效', { statusCode: 400 }));
  }
  const result = await testNotificationChannel(channel, config || null);
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_NOTIFICATION_TEST_FAILED', result.message || '测试通知失败', { statusCode: 400, details: { channel } }));
  }
  return sendSuccess(res, req, { channel }, result.message || '测试消息已发送');
}));

router.post('/actions/send-notification', asyncHandler(async (req, res) => {
  const { channel, title, content, level = 'info', data } = req.body || {};
  const payload = { title: title || '测试通知', content: content || '这是一条测试通知', level, data };
  const result = channel ? await sendToChannel(channel, payload) : await sendNotification(payload);
  return sendSuccess(res, req, result, channel ? '通知已发送到指定渠道' : '通知已发送');
}));

router.get('/schedules/status', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, getScheduleStatus());
}));

router.get('/schedules/execution', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, getScheduleExecutionStatus());
}));

router.post('/schedules', asyncHandler(async (req, res) => {
  const { scheduleId = 'default', times, taskFlow } = req.body || {};
  const result = setupSchedule(scheduleId, times, taskFlow);
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_SCHEDULE_SETUP_FAILED', result.message, { statusCode: 400 }));
  }
  return sendSuccess(res, req, result, result.message);
}));

router.delete('/schedules/:scheduleId', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, stopSchedule(req.params.scheduleId));
}));

router.post('/schedules/:scheduleId/execute', asyncHandler(async (req, res) => {
  const { scheduleId } = req.params;
  const { taskFlow } = req.body || {};
  if (!Array.isArray(taskFlow)) {
    return sendError(res, req, agentError('AGENT_VALIDATION_TASK_FLOW_INVALID', '任务流程格式无效', { statusCode: 400 }));
  }
  const result = await executeScheduleNow(scheduleId, taskFlow);
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_SCHEDULE_ALREADY_RUNNING', result.message, { statusCode: 409 }));
  }
  return sendSuccess(res, req, result, result.message);
}));

router.post('/actions/configure-auto-update', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, setupAutoUpdate(req.body || {}));
}));

router.get('/auto-update/status', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, getAutoUpdateStatus());
}));

router.post('/actions/open-config-directory', asyncHandler(async (req, res) => {
  const configDir = await getMaaConfigDir();
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'explorer.exe'
      : 'xdg-open';
  await execFileAsync(command, [configDir]);
  return sendSuccess(res, req, { configDir }, '配置目录已打开');
}));

router.post('/actions/update-core', asyncHandler(async (req, res) => {
  const { version, dryRun = false } = req.body || {};
  const corePlan = version === 'beta'
    ? { action: 'update-core', targetChannel: 'beta', command: 'install', args: ['beta', '--force'] }
    : version === 'stable'
      ? { action: 'update-core', targetChannel: 'stable', command: 'install', args: ['stable', '--force'] }
      : { action: 'update-core', targetChannel: 'current', command: 'update', args: [] };
  const plan = {
    action: 'update-core-and-resources',
    steps: [corePlan, { action: 'hot-update-resources', script: 'server/scripts/update-maa-resources.js' }]
  };

  if (dryRun) return sendDryRun(res, req, plan);

  return withMaaExecutionLease({ source: 'core-update', taskName: '更新 MaaCore 与资源', command: 'update' }, async () => {
    let coreResult;
    try {
      coreResult = version === 'beta'
        ? await execMaaCommand('install', ['beta', '--force'])
        : version === 'stable'
          ? await execMaaCommand('install', ['stable', '--force'])
          : await execMaaCommand('update', []);
    } catch (error) {
      logger.error('更新 MaaCore 失败', { error: error.message, version });
      return sendError(res, req, agentError('AGENT_MAA_UPDATE_CORE_FAILED', `MaaCore 更新失败: ${error.message}`, {
        statusCode: 500,
        retryable: true,
        details: { version, failedStep: 'core', coreUpdated: false }
      }));
    }

    try {
      const resourceResult = await updateMaaResources();
      const runtime = await getMaaVersion(true);
      return sendSuccess(res, req, {
        plan,
        steps: {
          core: { success: true, output: coreResult.stdout || coreResult.stderr || '' },
          resources: { success: true, output: resourceResult.output }
        },
        runtime: { ...runtime, resource: resourceResult.resource }
      }, version ? `已切换到 ${version} 渠道并同步最新资源` : 'MaaCore 和资源已更新');
    } catch (error) {
      const runtime = await getMaaVersion(true).catch(() => null);
      const resource = await getMaaResourceInfo().catch(() => null);
      logger.error('MaaCore 已更新，但资源同步失败', { error: error.message, version });
      return sendError(res, req, agentError('AGENT_MAA_UPDATE_RESOURCE_FAILED', `MaaCore 已更新，但资源同步失败: ${error.message}`, {
        statusCode: 500,
        retryable: true,
        details: {
          version,
          failedStep: 'resources',
          coreUpdated: true,
          runtime: runtime ? { ...runtime, resource } : null
        }
      }));
    }
  });
}));

router.post('/actions/update-cli', asyncHandler(async (req, res) => {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const os = await import('os');
  const execAsync = promisify(exec);
  const MAA_CLI_PATH = process.env.MAA_CLI_PATH || (process.env.DOCKER_ENV ? '/usr/local/bin/maa' : 'maa');
  const isDocker = process.env.NODE_ENV === 'production' && await execAsync('test -f /.dockerenv').then(() => true).catch(() => false);
  const command = isDocker ? `${MAA_CLI_PATH} self update` : (os.platform() === 'darwin' ? 'brew upgrade maa-cli' : `${MAA_CLI_PATH} self update`);
  const plan = { action: 'update-cli', command };
  if (req.body?.dryRun) return sendDryRun(res, req, plan);
  return withMaaExecutionLease({ source: 'cli-update', taskName: '更新 MAA CLI', command: 'update-cli' }, async () => {
    const { stdout, stderr } = await execAsync(command);
    return sendSuccess(res, req, { output: stdout || stderr, plan }, `MAA CLI 更新完成${isDocker ? '（Docker 环境）' : ''}`);
  });
}));

router.post('/actions/hot-update-resources', asyncHandler(async (req, res) => {
  const plan = { action: 'hot-update-resources', script: 'server/scripts/update-maa-resources.js' };
  if (req.body?.dryRun) return sendDryRun(res, req, plan);
  try {
    const result = await updateMaaResources();
    return sendSuccess(res, req, { ...result, plan }, '资源文件更新成功');
  } catch (error) {
    return sendError(res, req, agentError('AGENT_MAA_RESOURCE_UPDATE_FAILED', `资源同步失败: ${error.message}`, {
      statusCode: 500,
      retryable: true,
      details: { failedStep: 'resources' }
    }));
  }
}));

router.post('/actions/test-connection', asyncHandler(async (req, res) => {
  const { adbPath, address } = await resolveRequestConnection(req, { allowOverrides: true })
  return sendSuccess(res, req, await testAdbConnection(adbPath, address));
}));

router.get('/actions/discover-devices', asyncHandler(async (req, res) => {
  const { adbPath } = await resolveRequestConnection(req, { allowOverrides: true })
  return sendSuccess(res, req, await discoverAdbDevices(adbPath));
}));

router.get('/version', asyncHandler(async (req, res) => {
  const [version, resource] = await Promise.all([
    getMaaVersion(true),
    getMaaResourceInfo().catch(error => ({
      lastUpdated: null,
      modifiedAt: null,
      ageDays: null,
      status: 'unknown',
      message: `资源版本读取失败: ${error.message}`,
      activity: null,
      gacha: null
    }))
  ]);
  return sendSuccess(res, req, { ...version, resource });
}));

router.get('/config-directory', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, { path: await getMaaConfigDir() });
}));

router.post('/actions/start-game', asyncHandler(async (req, res) => {
  const waitForCompletion = parseWaitForCompletion(req.body?.waitForCompletion);
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
}));

router.post('/actions/run-daily-flow', asyncHandler(async (req, res) => {
  const { dryRun, scheduleId, taskFlow: overrideTaskFlow } = normalizeDailyFlowRequest(req.body || {});
  const taskFlow = await loadAutomationTaskFlow(overrideTaskFlow);
  const planResult = await getScheduledTaskFlowPlan(taskFlow);
  const planError = createDailyFlowExecutionError(planResult);
  if (planError) {
    return sendError(res, req, planError);
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

  return executeTrackedAgentAction(req, res, {
    operationId: 'run_daily_flow',
    input: { scheduleId, taskFlow },
    metadata: { taskName: `今日流程 ${scheduleId}`, taskType: 'schedule' },
    execute: async lifecycle => {
      const result = await executeScheduleNow(scheduleId, taskFlow, lifecycle);
      const executionError = createDailyFlowExecutionError(result);
      if (executionError) throw executionError;
      return { ...result, scheduleId, totalSteps: planResult.totalSteps, plan };
    },
    successMessage: '今日流程执行完成'
  });
}));

router.post('/actions/fight', asyncHandler(async (req, res) => {
  const { dryRun = false, ...requestOptions } = req.body || {};
  const waitForCompletion = parseWaitForCompletion(requestOptions.waitForCompletion);
  const { waitForCompletion: _ignoredWait, ...fightOptions } = requestOptions;
  const args = buildFightArgs(fightOptions);
  if (!args.length) {
    return sendError(res, req, agentError('AGENT_VALIDATION_MISSING_STAGES', '至少需要一个有效关卡', {
      statusCode: 400,
      details: { fightOptions },
      retryable: false
    }));
  }
  const plan = {
    command: 'fight',
    args,
    semantic: {
      stages: Array.isArray(fightOptions.stages) ? fightOptions.stages : [{ stage: fightOptions.stage || '', times: fightOptions.times || '' }],
      medicine: fightOptions.medicine ?? 0,
      expiringMedicine: fightOptions.expiringMedicine ?? 0,
      stone: fightOptions.stone ?? 0,
      series: fightOptions.series ?? 0
    }
  };

  if (dryRun) {
    return sendDryRun(res, req, plan);
  }

  return executeTrackedAgentAction(req, res, {
    operationId: 'fight',
    input: { ...plan.semantic, waitForCompletion },
    waitForCompletion,
    metadata: { taskName: 'Agent: 理智作战', taskType: 'agent', plan },
    execute: async lifecycle => ({
      ...(await execMaaCommand(
        'fight',
        args,
        'Agent: 理智作战',
        'agent',
        waitForCompletion,
        false,
        lifecycle
      )),
      plan
    }),
    successMessage: '理智作战执行完成',
    acceptedMessage: '理智作战已接受'
  });
}));

router.post('/actions/run-task', asyncHandler(async (req, res) => {
  const input = req.body || {};
  const requestedWait = parseWaitForCompletion(input.waitForCompletion);
  const waitForCompletion = input.command === 'activity' || input.command === 'list'
    ? true
    : requestedWait;
  return executeTrackedAgentAction(req, res, {
    operationId: 'run_task',
    input: { ...input, waitForCompletion },
    waitForCompletion,
    metadata: { taskName: input.taskName || `Agent: ${input.command || 'task'}`, taskType: input.taskType || 'agent' },
    execute: lifecycle => executeAgentTask(
      { ...input, waitForCompletion },
      {
        execMaaCommand: (command, args, taskName, taskType, shouldWait, silent = false) =>
          execMaaCommand(command, args, taskName, taskType, shouldWait, silent, lifecycle),
        execDynamicTask: (taskId, taskConfig, taskName, taskType, shouldWait, userResource) =>
          execDynamicTask(taskId, taskConfig, taskName, taskType, shouldWait, userResource, { lifecycle })
      }
    ),
    successMessage: '任务执行完成',
    acceptedMessage: '任务已接受'
  });
}));

router.post('/actions/stop', asyncHandler(async (req, res) => {
  const requestedRunId = req.body?.runId || null;
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
      persistedRun => sendSuccess(res, req, {
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
