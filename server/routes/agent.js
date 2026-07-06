import express from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  execMaaCommand,
  getMaaVersion,
  getRealtimeLogs,
  getTaskStatus,
  stopCurrentTask,
  testAdbConnection
} from '../services/maaService.js';
import { asyncHandler, successResponse } from '../utils/apiHelper.js';

const router = express.Router();
const execFileAsync = promisify(execFile);

const DEFAULT_ADB_PATH = process.env.ADB_PATH || '/opt/homebrew/bin/adb';
const DEFAULT_ADB_ADDRESS = process.env.ADB_ADDRESS || '127.0.0.1:16384';
const DEFAULT_CLIENT_TYPE = process.env.MAA_CLIENT_TYPE || 'Official';
const API_VERSION = '2026-07-06';

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
      endpoint('GET', '/agent/webrtc/status', 'Get WebRTC preview status hints.'),
      endpoint('GET', '/agent/webrtc/devices', 'Get online WebRTC device ids.'),
      endpoint('POST', '/agent/webrtc/start', 'Start WebRTC infrastructure.', AGENT_ACTIONS.find(a => a.id === 'webrtc_start').body_schema),
      endpoint('POST', '/agent/webrtc/stop', 'Stop WebRTC infrastructure.'),
      endpoint('POST', '/agent/actions/test-connection', 'Test ADB connection.', AGENT_ACTIONS.find(a => a.id === 'test_connection').body_schema),
      endpoint('POST', '/agent/actions/start-game', 'Start Arknights through MAA.', AGENT_ACTIONS.find(a => a.id === 'start_game').body_schema),
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

async function getWebrtcSummary() {
  const port = Number(process.env.LA_PLUMA_WEBRTC_PORT || 8443);
  let reachable = false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1500) });
    reachable = response.ok;
  } catch {
    reachable = false;
  }
  return {
    url: `http://127.0.0.1:${port}`,
    reachable,
    note: reachable ? 'WebRTC page is reachable. Use browser UI to connect the device.' : 'WebRTC page is not reachable. Start it from /api/maa/webrtc/start-server or the Web UI.'
  };
}

async function getWebrtcAuthToken() {
  const port = Number(process.env.LA_PLUMA_WEBRTC_PORT || 8443);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) return '';
    const data = await response.json();
    return data.token || '';
  } catch {
    return '';
  }
}

async function getWebrtcDevices() {
  const port = Number(process.env.LA_PLUMA_WEBRTC_PORT || 8443);
  try {
    const token = await getWebrtcAuthToken();
    const response = await fetch(`http://127.0.0.1:${port}/devices`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data.map(item => typeof item === 'string' ? item : (item.device_id || item.id)).filter(Boolean);
  } catch {
    return [];
  }
}

async function postMaaWebrtc(path, body = null) {
  const port = process.env.PORT || 3000;
  const response = await fetch(`http://127.0.0.1:${port}/api/maa/webrtc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return response.json();
}

async function buildAgentStatus(req) {
  const adbPath = req.query.adbPath || req.body?.adbPath || DEFAULT_ADB_PATH;
  const address = req.query.address || req.body?.address || DEFAULT_ADB_ADDRESS;
  const [version, adb, webrtc] = await Promise.all([
    getMaaVersion(true).catch(error => ({ error: error.message })),
    getAdbSummary(adbPath, address).catch(error => ({ connected: false, error: error.message, adbPath, address })),
    getWebrtcSummary()
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
      webrtc
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

router.get('/logs/recent', asyncHandler(async (req, res) => {
  const lines = Math.min(Math.max(Number(req.query.lines || 80), 1), 500);
  res.json(successResponse({ lines, logs: getRealtimeLogs(lines) }));
}));

router.get('/webrtc/status', asyncHandler(async (req, res) => {
  const summary = await getWebrtcSummary();
  res.json(successResponse({ ...summary, devices: await getWebrtcDevices() }));
}));

router.get('/webrtc/devices', asyncHandler(async (req, res) => {
  res.json(successResponse({ devices: await getWebrtcDevices() }));
}));

router.post('/webrtc/start', asyncHandler(async (req, res) => {
  const address = req.body?.address || DEFAULT_ADB_ADDRESS;
  const deviceId = req.body?.deviceId || 'mumu-la-pluma';
  await postMaaWebrtc('start-server');
  await postMaaWebrtc('start-agent', { address, deviceId });
  await new Promise(resolve => setTimeout(resolve, 1200));
  const summary = await getWebrtcSummary();
  res.json(successResponse({
    ...summary,
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
  await postMaaWebrtc('stop-agent', { address: req.body?.address || DEFAULT_ADB_ADDRESS }).catch(() => null);
  await postMaaWebrtc('stop-server').catch(() => null);
  res.json(successResponse({ stopped: true }));
}));

router.post('/actions/test-connection', asyncHandler(async (req, res) => {
  const { adbPath = DEFAULT_ADB_PATH, address = DEFAULT_ADB_ADDRESS } = req.body || {};
  res.json(successResponse(await testAdbConnection(adbPath, address)));
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

router.post('/actions/run-task', asyncHandler(async (req, res) => {
  const { command, args = [], waitForCompletion = true } = req.body || {};
  const allowedCommands = new Set([
    'startup', 'closedown', 'fight', 'infrast', 'recruit', 'mall', 'award',
    'copilot', 'ssscopilot', 'paradoxcopilot', 'roguelike', 'depot', 'operbox', 'activity'
  ]);

  if (!allowedCommands.has(command)) {
    return res.status(400).json({
      success: false,
      message: `不允许的 command: ${command}`,
      error: 'command_not_allowed',
      allowed: [...allowedCommands]
    });
  }

  const normalizedArgs = Array.isArray(args) ? args.map(String) : [];
  const result = await execMaaCommand(command, normalizedArgs, `Agent: ${command}`, 'agent', waitForCompletion);
  res.json(successResponse(result));
}));

router.post('/actions/stop', asyncHandler(async (req, res) => {
  res.json(successResponse(stopCurrentTask()));
}));

export default router;
