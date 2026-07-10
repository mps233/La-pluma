import express from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  execMaaCommand,
  getMaaVersion,
  getRealtimeLogs,
  getTaskStatus,
  stopCurrentTask,
  testAdbConnection,
  captureScreen,
  getMaaConfigDir,
  getConfig,
  saveConfig,
  getCurrentActivity,
  getLogFiles,
  readLogFile,
  cleanupLogs,
  getDebugScreenshots,
  clearRealtimeLogs,
  replaceActivityCode,
  execDynamicTask
} from '../services/maaService.js';
import { executeScheduleNow, getScheduleExecutionStatus, stopScheduleExecution, getScheduleStatus, setupSchedule, stopSchedule, setupAutoUpdate, getAutoUpdateStatus } from '../services/schedulerService.js';
import { loadUserConfig, saveUserConfig, getAllUserConfigs, deleteUserConfig } from '../services/configStorageService.js';
import sklandService from '../services/sklandService.js';
import { getNotificationConfig, sendNotification, sendToChannel, testNotificationChannel, setNotificationConfig, getTodayOpenStages } from '../services/notificationService.js';
import operatorTrainingService from '../services/operatorTrainingService.js';
import { parseDepotData, parseOperBoxData, getDepotData, getOperBoxData, getAllOperators } from '../services/dataParserService.js';
import { getTodayDrops, getRecentDrops, getDropStatistics } from '../services/dropRecordService.js';
import { loadParadoxOperators, resolveStageSearchKeyword } from '../services/copilotService.js';
import {
  asyncHandler,
  successResponse,
  dryRunResponse,
  agentError,
  sendSuccess,
  sendDryRun,
  sendError
} from '../utils/apiHelper.js';
import { createLogger } from '../utils/logger.js'
import {
  getWebrtcStatus,
  installWebrtc,
  startWebrtcServer,
  stopWebrtcServer,
  startWebrtcAgent,
  stopWebrtcAgent,
  startWebrtc,
  stopWebrtc,
  getMacLanIp,
  getIceServersConfig,
  isWebrtcServerReachable,
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
const API_VERSION = '2026-07-07';

const AGENT_ACTIONS = [
  {
    id: 'get_status',
    method: 'GET',
    path: '/api/agent/status',
    description: 'Return a compact, AI-readable summary of La Pluma, MAA, ADB, WebRTC, and recent logs.'
  },
  {
    id: 'test_connection',
    method: 'POST',
    path: '/api/agent/actions/test-connection',
    description: 'Check ADB availability and emulator connectivity.',
    body_schema: {
      type: 'object',
      properties: {
        adbPath: { type: 'string', default: DEFAULT_ADB_PATH },
        address: { type: 'string', default: DEFAULT_ADB_ADDRESS }
      }
    }
  },
  {
    id: 'start_game',
    method: 'POST',
    path: '/api/agent/actions/start-game',
    description: 'Run maa startup for the selected client. Default is Official.',
    body_schema: {
      type: 'object',
      properties: {
        clientType: { type: 'string', default: DEFAULT_CLIENT_TYPE },
        address: { type: 'string', default: DEFAULT_ADB_ADDRESS },
        waitForCompletion: { type: 'boolean', default: true }
      }
    }
  },
  {
    id: 'fight',
    method: 'POST',
    path: '/api/agent/actions/fight',
    description: 'Semantic action for 理智作战. Agents can pass stages/medicine/stone/series without knowing maa-cli flags.',
    body_schema: {
      type: 'object',
      required: ['stages'],
      properties: {
        stages: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string', examples: ['1-7'] },
              {
                type: 'object',
                required: ['stage'],
                properties: {
                  stage: { type: 'string', examples: ['CE-6'] },
                  times: { type: ['integer', 'string'], description: 'Optional per-stage run count.' }
                }
              }
            ]
          },
          examples: [['HD-7', 'CE-6', 'AP-5']]
        },
        medicine: { type: ['integer', 'string'], default: 0, description: 'Normal sanity medicine count for -m.' },
        expiringMedicine: { type: ['integer', 'string'], default: 0, description: 'Expiring sanity medicine count.' },
        stone: { type: ['integer', 'string'], default: 0, description: 'Originium stone count.' },
        series: { type: ['integer', 'string'], default: 0, description: 'MAA --series value; omit or set 1 to use maa-cli default.' },
        dryRun: { type: 'boolean', default: false },
        waitForCompletion: { type: 'boolean', default: true }
      }
    }
  },
  {
    id: 'run_task',
    method: 'POST',
    path: '/api/agent/actions/run-task',
    description: 'Run one whitelisted maa-cli task with explicit args. Prefer semantic actions when available.',
    body_schema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string', enum: ['startup', 'closedown', 'fight', 'infrast', 'recruit', 'mall', 'award', 'copilot', 'ssscopilot', 'paradoxcopilot', 'roguelike', 'depot', 'operbox', 'activity'] },
        args: { type: 'array', items: { type: 'string' }, default: [] },
        waitForCompletion: { type: 'boolean', default: true }
      }
    }
  },
  {
    id: 'stop_task',
    method: 'POST',
    path: '/api/agent/actions/stop',
    description: 'Stop the currently running MAA task if any.'
  },
  {
    id: 'get_current_run',
    method: 'GET',
    path: '/api/agent/runs/current',
    description: 'Return current MAA task, schedule execution state, and recent logs for polling.'
  },
  {
    id: 'get_screenshot',
    method: 'POST',
    path: '/api/agent/screen/screenshot',
    description: 'Capture the emulator screen as base64 PNG with timestamp and dimensions.',
    body_schema: {
      type: 'object',
      properties: {
        adbPath: { type: 'string', default: DEFAULT_ADB_PATH },
        address: { type: 'string', default: DEFAULT_ADB_ADDRESS }
      }
    }
  },
  {
    id: 'run_daily_flow',
    method: 'POST',
    path: '/api/agent/actions/run-daily-flow',
    description: 'Run the saved enabled automation task flow. Use dryRun=true first to inspect the command plan.',
    body_schema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', default: false },
        scheduleId: { type: 'string', default: 'agent-daily-flow' },
        taskFlow: { type: 'array', items: { type: 'object' }, description: 'Optional task flow override; defaults to saved automation-tasks config.' }
      }
    }
  },
  {
    id: 'recent_logs',
    method: 'GET',
    path: '/api/agent/logs/recent?lines=80',
    description: 'Return recent in-memory MAA logs with optional line count.'
  },
  {
    id: 'webrtc_status',
    method: 'GET',
    path: '/api/agent/webrtc/status',
    description: 'Return lightweight WebRTC endpoint hints for the browser preview.'
  },
  {
    id: 'webrtc_devices',
    method: 'GET',
    path: '/api/agent/webrtc/devices',
    description: 'Return online ScrcpyOverWebRTC device ids in an AI-readable shape.'
  },
  {
    id: 'webrtc_start',
    method: 'POST',
    path: '/api/agent/webrtc/start',
    description: 'Start signaling/TURN and MuMu agent, then return signaling URL, ICE servers, and device id.',
    body_schema: {
      type: 'object',
      properties: {
        address: { type: 'string', default: DEFAULT_ADB_ADDRESS },
        deviceId: { type: 'string', default: 'mumu-la-pluma' }
      }
    }
  },
  {
    id: 'webrtc_stop',
    method: 'POST',
    path: '/api/agent/webrtc/stop',
    description: 'Stop MuMu agent and signaling/TURN managed by La Pluma.'
  },
  {
    id: 'preview_orientation',
    method: 'POST',
    path: '/api/agent/preview/orientation',
    description: 'Set Android emulator orientation for the live preview/device. Uses ADB settings + keyevent fallback and returns observed display state.',
    body_schema: {
      type: 'object',
      required: ['orientation'],
      properties: {
        orientation: { type: 'string', enum: ['portrait', 'landscape', 'auto'] },
        adbPath: { type: 'string', default: DEFAULT_ADB_PATH },
        address: { type: 'string', default: DEFAULT_ADB_ADDRESS },
        dryRun: { type: 'boolean', default: false }
      }
    }
  }
];

function endpoint(method, path, description, requestBody = null) {
  const operation = {
    summary: description,
    responses: {
      200: {
        description: 'Standard La Pluma API response',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiResponse' }
          }
        }
      }
    }
  };
  if (requestBody) {
    operation.requestBody = {
      required: !!requestBody.required,
      content: {
        'application/json': {
          schema: requestBody
        }
      }
    };
  }
  return { [path]: { [method.toLowerCase()]: operation } };
}

function mergePaths(items) {
  return items.reduce((acc, item) => {
    Object.entries(item).forEach(([path, value]) => {
      acc[path] = { ...(acc[path] || {}), ...value };
    });
    return acc;
  }, {});
}

function getOpenApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'La Pluma Agent API',
      version: API_VERSION,
      description: 'AI-friendly action and status surface for La Pluma / maa-cli automation.'
    },
    servers: [{ url: '/api' }],
    paths: mergePaths([
      endpoint('GET', '/agent/manifest', 'Discover AI-readable capabilities and action contracts.'),
      endpoint('GET', '/agent/status', 'Get compact current status.'),
      endpoint('GET', '/agent/logs/recent', 'Get recent runtime logs.'),
      endpoint('GET', '/agent/openapi.json', 'Get this OpenAPI schema.'),
      endpoint('GET', '/agent/runs/current', 'Poll current task/schedule state.'),
      endpoint('POST', '/agent/screen/screenshot', 'Capture emulator screenshot.', AGENT_ACTIONS.find(a => a.id === 'get_screenshot').body_schema),
      endpoint('GET', '/agent/webrtc/status', 'Get WebRTC preview status hints.'),
      endpoint('GET', '/agent/webrtc/devices', 'Get online WebRTC device ids.'),
      endpoint('POST', '/agent/webrtc/start', 'Start WebRTC infrastructure.', AGENT_ACTIONS.find(a => a.id === 'webrtc_start').body_schema),
      endpoint('POST', '/agent/webrtc/stop', 'Stop WebRTC infrastructure.'),
      endpoint('POST', '/agent/preview/orientation', 'Set emulator orientation and return observed display state.', AGENT_ACTIONS.find(a => a.id === 'preview_orientation').body_schema),
      endpoint('POST', '/agent/actions/test-connection', 'Test ADB connection.', AGENT_ACTIONS.find(a => a.id === 'test_connection').body_schema),
      endpoint('POST', '/agent/actions/start-game', 'Start Arknights through MAA.', AGENT_ACTIONS.find(a => a.id === 'start_game').body_schema),
      endpoint('POST', '/agent/actions/fight', 'Run semantic 理智作战 through MAA.', AGENT_ACTIONS.find(a => a.id === 'fight').body_schema),
      endpoint('POST', '/agent/actions/run-daily-flow', 'Run saved daily task flow or return a dry-run plan.', AGENT_ACTIONS.find(a => a.id === 'run_daily_flow').body_schema),
      endpoint('POST', '/agent/actions/run-task', 'Run a whitelisted maa-cli command.', AGENT_ACTIONS.find(a => a.id === 'run_task').body_schema),
      endpoint('POST', '/agent/actions/stop', 'Stop the current MAA task.')
    ]),
    components: {
      schemas: {
        ApiResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: { type: 'object' },
            error: { type: 'string' }
          }
        }
      }
    }
  };
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

async function getWebrtcSummary(address = DEFAULT_DEVICE_ADDRESS) {
  const [status, reachable] = await Promise.all([
    getWebrtcStatus(address).catch(() => null),
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

async function getWebrtcAuthToken() {
  try {
    const response = await fetch(`http://127.0.0.1:${WEBRTC_PORT}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      signal: AbortSignal.timeout(2000)
    })
    if (!response.ok) return ''
    const data = await response.json()
    return data.token || ''
  } catch {
    return ''
  }
}

async function getWebrtcDevices() {
  try {
    const token = await getWebrtcAuthToken()
    const response = await fetch(`http://127.0.0.1:${WEBRTC_PORT}/devices`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(2000)
    })
    if (!response.ok) return []
    const data = await response.json()
    if (!Array.isArray(data)) return []
    return data.map(item => typeof item === 'string' ? item : (item.device_id || item.id)).filter(Boolean)
  } catch {
    return []
  }
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

function normalizeTaskCommand(task) {
  const command = task.commandId || String(task.id || '').split('-')[0];
  const params = task.params || {};

  if (command === 'startup' || command === 'closedown') {
    const args = [params.clientType || DEFAULT_CLIENT_TYPE];
    if (params.address) args.push('-a', String(params.address));
    if (command === 'startup' && params.accountName) args.push('--account-name', String(params.accountName));
    return { command, args };
  }

  if (command === 'fight') {
    return { command, args: buildFightArgs(params) };
  }

  return { command, args: [] };
}

async function loadAutomationTaskFlow(overrideTaskFlow = null) {
  if (Array.isArray(overrideTaskFlow)) return overrideTaskFlow;
  const saved = await loadUserConfig('automation-tasks');
  return saved.success && Array.isArray(saved.data?.taskFlow) ? saved.data.taskFlow : [];
}

function buildTaskFlowPlan(taskFlow) {
  return taskFlow
    .filter(task => task.enabled !== false)
    .map((task, index) => ({
      index: index + 1,
      id: task.id,
      name: task.name || task.commandId || task.id,
      enabled: task.enabled !== false,
      ...normalizeTaskCommand(task)
    }));
}

async function buildAgentStatus(req) {
  const adbPath = req.query.adbPath || req.body?.adbPath || DEFAULT_ADB_PATH;
  const address = req.query.address || req.body?.address || DEFAULT_ADB_ADDRESS;
  const [version, adb, webrtc, orientation] = await Promise.all([
    getMaaVersion(true).catch(error => ({ error: error.message })),
    getAdbSummary(adbPath, address).catch(error => ({ connected: false, error: error.message, adbPath, address })),
    getWebrtcSummary(),
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
  res.json(successResponse({
    name: 'La Pluma Agent API',
    id: 'la-pluma-agent-api',
    version: API_VERSION,
    description: 'AI-readable control surface for MAA / Arknights automation through La Pluma.',
    auth: {
      type: 'optional-bearer-or-x-la-pluma-token',
      note: 'Required only when LA_PLUMA_TOKEN is set on the backend.'
    },
    defaults: {
      adbPath: DEFAULT_ADB_PATH,
      adbAddress: DEFAULT_ADB_ADDRESS,
      clientType: DEFAULT_CLIENT_TYPE
    },
    links: {
      status: '/api/agent/status',
      openapi: '/api/agent/openapi.json',
      currentRun: '/api/agent/runs/current',
      screenshot: '/api/agent/screen/screenshot',
      recentLogs: '/api/agent/logs/recent?lines=80'
    },
    actions: AGENT_ACTIONS
  }));
});

router.get('/openapi.json', (req, res) => {
  res.json(getOpenApiSpec());
});

router.get('/status', asyncHandler(async (req, res) => {
  res.json(successResponse(await buildAgentStatus(req)));
}));

router.get('/runs/current', asyncHandler(async (req, res) => {
  const lines = Math.min(Math.max(Number(req.query.lines || 80), 1), 500);
  const task = getTaskStatus();
  const schedule = getScheduleExecutionStatus();
  const recentLogs = getRealtimeLogs(lines);
  return sendSuccess(res, req, {
    ...task,
    schedule,
    recentLogs
  });
}));

router.get('/tasks/status', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, getTaskStatus());
}));

router.post('/screen/screenshot', asyncHandler(async (req, res) => {
  const { adbPath = DEFAULT_ADB_PATH, address = DEFAULT_ADB_ADDRESS } = req.body || {};
  const screenshot = await captureScreen(adbPath, address);
  res.json(successResponse({
    ...screenshot,
    ...pngDimensions(screenshot.image),
    mediaType: 'image/png',
    adbPath,
    address
  }));
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
  const maxSizeMB = Number(req.body?.maxSizeMB || 10);
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
  return sendSuccess(res, req, result.data, result.message || '操作成功');
}));

router.post('/config/user/:configType', asyncHandler(async (req, res) => {
  const result = await saveUserConfig(req.params.configType, req.body);
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_CONFIG_SAVE_FAILED', result.message || '保存配置失败', { statusCode: 500 }));
  }
  return sendSuccess(res, req, null, result.message || '配置保存成功');
}));

router.get('/config/user', asyncHandler(async (req, res) => {
  const result = await getAllUserConfigs();
  return sendSuccess(res, req, result.data || {}, result.message || '操作成功');
}));

router.delete('/config/user/:configType', asyncHandler(async (req, res) => {
  const result = await deleteUserConfig(req.params.configType);
  return sendSuccess(res, req, null, result.message || '配置删除成功');
}));

router.get('/activity', asyncHandler(async (req, res) => {
  const clientType = req.query.clientType || DEFAULT_CLIENT_TYPE;
  const activityInfo = await getCurrentActivity(clientType);
  return sendSuccess(res, req, {
    code: activityInfo.code,
    name: activityInfo.name,
    available: !!activityInfo.code,
    message: activityInfo.code ? `当前活动: ${activityInfo.name || activityInfo.code}` : '当前没有活动或无法获取活动信息'
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
  const summary = await getWebrtcSummary(req.query?.address || DEFAULT_DEVICE_ADDRESS);
  res.json(successResponse({ ...summary, devices: await getWebrtcDevices() }));
}));

router.get('/webrtc/devices', asyncHandler(async (req, res) => {
  res.json(successResponse({ devices: await getWebrtcDevices() }));
}));

router.post('/webrtc/start', asyncHandler(async (req, res) => {
  const address = req.body?.address || DEFAULT_DEVICE_ADDRESS;
  const deviceId = req.body?.deviceId || DEFAULT_DEVICE_ID;
  const status = await startWebrtc(address, deviceId);
  const summary = await getWebrtcSummary(address);
  res.json(successResponse({
    ...summary,
    ...status,
    devices: await getWebrtcDevices(),
    deviceId,
    address,
    protocol: {
      websocket: `${summary.url.replace(/^http/, 'ws')}/connect_client?token=`,
      connectMessage: { message_type: 'connect', device_id: deviceId },
      requestOfferPayload: { type: 'request-offer', ip_preference: 'ipv4' },
      candidatePolicy: 'relay preferred / ipv4'
    }
  }));
}));

router.post('/webrtc/stop', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, await stopWebrtc(req.body?.address || DEFAULT_DEVICE_ADDRESS));
}));

router.post('/preview/orientation', asyncHandler(async (req, res) => {
  const { orientation, adbPath = DEFAULT_ADB_PATH, address = DEFAULT_ADB_ADDRESS, dryRun = false } = req.body || {};
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
  const result = await startWebrtcServer(req.body?.address || DEFAULT_DEVICE_ADDRESS);
  return sendSuccess(res, req, result, 'WebRTC 服务已启动');
}));

router.post('/webrtc/stop-server', asyncHandler(async (req, res) => {
  const result = await stopWebrtcServer(req.body?.address || DEFAULT_DEVICE_ADDRESS);
  return sendSuccess(res, req, result, 'WebRTC 服务已停止');
}));

router.post('/webrtc/start-agent', asyncHandler(async (req, res) => {
  const address = req.body?.address || DEFAULT_DEVICE_ADDRESS;
  const deviceId = req.body?.deviceId || DEFAULT_DEVICE_ID;
  const result = await startWebrtcAgent(address, deviceId);
  return sendSuccess(res, req, result, 'MuMu Agent 已启动');
}));

router.post('/webrtc/stop-agent', asyncHandler(async (req, res) => {
  const result = await stopWebrtcAgent(req.body?.address || DEFAULT_DEVICE_ADDRESS);
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
  const adbPath = req.query.adbPath || DEFAULT_ADB_PATH;
  const address = req.query.address || DEFAULT_DEVICE_ADDRESS;
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
  setNotificationConfig(req.body || {});
  const result = await saveUserConfig('notification', req.body || {});
  if (!result.success) {
    return sendError(res, req, agentError('AGENT_NOTIFICATION_CONFIG_SAVE_FAILED', result.message || '通知配置保存失败', { statusCode: 500 }));
  }
  return sendSuccess(res, req, null, '通知配置已保存');
}));

router.post('/actions/test-notification-channel', asyncHandler(async (req, res) => {
  const channel = req.body?.channel;
  if (!channel) {
    return sendError(res, req, agentError('AGENT_VALIDATION_CHANNEL_REQUIRED', '缺少通知渠道', { statusCode: 400 }));
  }
  const result = await testNotificationChannel(channel);
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
  return sendSuccess(res, req, setupSchedule(scheduleId, times, taskFlow));
}));

router.delete('/schedules/:scheduleId', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, stopSchedule(req.params.scheduleId));
}));

router.post('/schedules/:scheduleId/execute', asyncHandler(async (req, res) => {
  const { scheduleId } = req.params;
  const { taskFlow } = req.body || {};
  return sendSuccess(res, req, await executeScheduleNow(scheduleId, taskFlow));
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
  const plan = version === 'beta'
    ? { action: 'update-core', targetChannel: 'beta', command: 'install', args: ['beta', '--force'] }
    : version === 'stable'
      ? { action: 'update-core', targetChannel: 'stable', command: 'install', args: ['stable', '--force'] }
      : { action: 'update-core', targetChannel: 'current', command: 'update', args: [] };

  if (dryRun) return sendDryRun(res, req, plan);

  try {
    const result = version === 'beta'
      ? await execMaaCommand('install', ['beta', '--force'])
      : version === 'stable'
        ? await execMaaCommand('install', ['stable', '--force'])
        : await execMaaCommand('update', []);
    return sendSuccess(res, req, { ...result, plan }, version ? `已切换到 ${version} 渠道` : '已更新 MaaCore 到最新版本');
  } catch (error) {
    logger.error('更新 MaaCore 失败', { error: error.message, version });
    return sendError(res, req, agentError('AGENT_MAA_UPDATE_CORE_FAILED', `更新失败: ${error.message}`, { statusCode: 500, details: { version } }));
  }
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
  const { stdout, stderr } = await execAsync(command);
  return sendSuccess(res, req, { output: stdout || stderr, plan }, `MAA CLI 更新完成${isDocker ? '（Docker 环境）' : ''}`);
}));

router.post('/actions/hot-update-resources', asyncHandler(async (req, res) => {
  const plan = { action: 'hot-update-resources', script: 'server/scripts/update-maa-resources.js' };
  if (req.body?.dryRun) return sendDryRun(res, req, plan);
  const { spawn } = await import('child_process');
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const scriptPath = join(__dirname, '../scripts/update-maa-resources.js');
  const child = spawn('node', [scriptPath], { cwd: join(__dirname, '..'), stdio: 'pipe' });
  let output = '';
  let errorOutput = '';
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { errorOutput += data.toString(); });
  await new Promise((resolve, reject) => {
    child.on('close', code => code === 0 ? resolve() : reject(new Error(errorOutput || output || `exit ${code}`)));
    child.on('error', reject);
  });
  return sendSuccess(res, req, { output, plan }, '资源文件更新成功');
}));

router.post('/actions/test-connection', asyncHandler(async (req, res) => {
  const { adbPath = DEFAULT_ADB_PATH, address = DEFAULT_ADB_ADDRESS } = req.body || {};
  return sendSuccess(res, req, await testAdbConnection(adbPath, address));
}));

router.get('/version', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, await getMaaVersion(true));
}));

router.get('/config-directory', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, { path: await getMaaConfigDir() });
}));

router.post('/actions/start-game', asyncHandler(async (req, res) => {
  const {
    clientType = DEFAULT_CLIENT_TYPE,
    address = DEFAULT_ADB_ADDRESS,
    waitForCompletion = true
  } = req.body || {};
  const result = await execMaaCommand('startup', [clientType, '-a', address], '启动游戏', 'agent', waitForCompletion);
  res.json(successResponse(result));
}));

router.post('/actions/run-daily-flow', asyncHandler(async (req, res) => {
  const { dryRun = false, scheduleId = 'agent-daily-flow', taskFlow: overrideTaskFlow = null } = req.body || {};
  const taskFlow = await loadAutomationTaskFlow(overrideTaskFlow);
  const plan = buildTaskFlowPlan(taskFlow);

  if (dryRun) {
    return res.json(successResponse({
      dryRun: true,
      scheduleId,
      totalSteps: plan.length,
      plan
    }));
  }

  if (!plan.length) {
    return sendError(res, req, agentError('AGENT_VALIDATION_EMPTY_TASK_FLOW', '没有可执行的自动化任务', {
      statusCode: 400,
      details: { scheduleId },
      retryable: false
    }));
  }

  const result = await executeScheduleNow(scheduleId, taskFlow);
  return sendSuccess(res, req, { ...result, scheduleId, totalSteps: plan.length, plan });
}));

router.post('/actions/fight', asyncHandler(async (req, res) => {
  const { dryRun = false, waitForCompletion = true, ...fightOptions } = req.body || {};
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

  const result = await execMaaCommand('fight', args, 'Agent: 理智作战', 'agent', waitForCompletion);
  return sendSuccess(res, req, { ...result, plan });
}));

router.post('/actions/run-task', asyncHandler(async (req, res) => {
  const { command, args = [], waitForCompletion = true } = req.body || {};
  const allowedCommands = new Set([
    'startup', 'closedown', 'fight', 'infrast', 'recruit', 'mall', 'award',
    'copilot', 'ssscopilot', 'paradoxcopilot', 'roguelike', 'depot', 'operbox', 'activity'
  ]);

  if (!allowedCommands.has(command)) {
    return sendError(res, req, agentError('AGENT_VALIDATION_COMMAND_NOT_ALLOWED', `不允许的 command: ${command}`, {
      statusCode: 400,
      details: { command, allowed: [...allowedCommands] },
      retryable: false
    }));
  }

  const normalizedArgs = Array.isArray(args) ? args.map(String) : [];
  const result = await execMaaCommand(command, normalizedArgs, `Agent: ${command}`, 'agent', waitForCompletion);
  return sendSuccess(res, req, result);
}));

router.post('/actions/stop', asyncHandler(async (req, res) => {
  return sendSuccess(res, req, {
    task: stopCurrentTask(),
    scheduleStopped: stopScheduleExecution()
  });
}));

export default router;
