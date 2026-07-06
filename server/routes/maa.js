import express from 'express';
import { execMaaCommand, getMaaVersion, getMaaConfigDir, getConfig, saveConfig, execDynamicTask, captureScreen, getDebugScreenshots, getTaskStatus, getCurrentActivity, replaceActivityCode, stopCurrentTask, getLogFiles, readLogFile, getRealtimeLogs, clearRealtimeLogs, cleanupLogs, testAdbConnection } from '../services/maaService.js';
import { setupSchedule, stopSchedule, getScheduleStatus, executeScheduleNow, setupAutoUpdate, getAutoUpdateStatus, getScheduleExecutionStatus, stopScheduleExecution } from '../services/schedulerService.js';
import { saveUserConfig, loadUserConfig, getAllUserConfigs, deleteUserConfig } from '../services/configStorageService.js';
import { parseDepotData, parseOperBoxData, getDepotData, getOperBoxData, getAllOperators } from '../services/dataParserService.js';
import { getTodayDrops, getRecentDrops, getDropStatistics } from '../services/dropRecordService.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/apiHelper.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('MaaRoutes');

function normalizeStageIdForPrts(stageId = '') {
  return String(stageId).replace(/#[fn]#/g, '');
}

async function loadLocalJson(relativePath, fallback) {
  const fs = await import('fs/promises');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  try {
    const filePath = path.join(__dirname, relativePath);
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function resolveStageSearchKeyword(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const stages = await loadLocalJson('../data/stages.json', {});
  const upper = raw.toUpperCase();
  const stage = stages[upper]
    || Object.values(stages).find(item =>
      String(item.code || '').toUpperCase() === upper
      || String(item.name || '').trim() === raw
      || String(item.id || '').toUpperCase() === upper
    );

  return stage?.id ? normalizeStageIdForPrts(stage.id) : raw;
}

async function loadParadoxOperators() {
  const cached = await loadLocalJson('../data/paradox-operators.json', null);
  if (Array.isArray(cached)) return cached;

  const [handbookResponse, characterResponse] = await Promise.all([
    fetch('https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/handbook_info_table.json'),
    fetch('https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/character_table.json')
  ]);

  if (!handbookResponse.ok || !characterResponse.ok) {
    throw new Error('无法获取悖论模拟干员数据');
  }

  const handbook = await handbookResponse.json();
  const characters = await characterResponse.json();

  return Object.entries(handbook.handbookStageData || {})
    .map(([charId, stage]) => ({
      id: charId,
      name: characters[charId]?.name || handbook.handbookDict?.[charId]?.infoName || charId,
      stage_id: stage.stageId || stage.code,
      stage_name: stage.name || ''
    }))
    .filter(item => item.stage_id);
}


// 检查关卡是否今日开放的辅助函数
function isStageOpenToday(stage) {
  // 这个函数的实现需要从 maaService 导入
  // 暂时返回默认值
  return { isOpen: true, reason: '' };
}


// WebRTC 实时预览（托管 ScrcpyOverWebRTC）
const WEBRTC_DIR = process.env.LA_PLUMA_WEBRTC_DIR || `${process.env.HOME || ''}/ScrcpyOverWebRTC`;
const WEBRTC_PORT = Number(process.env.LA_PLUMA_WEBRTC_PORT || 8443);
let webrtcServerProcess = null;
let webrtcAgentProcess = null;
let webrtcTurnProcess = null;

async function pathExists(filePath) {
  const fs = await import('fs/promises');
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getWebrtcBinaryPath() {
  const path = await import('path');
  const arch = process.arch === 'arm64' ? 'darwin_arm64' : 'darwin_amd64';
  return path.join(WEBRTC_DIR, 'bin', arch, 'webrtc-signaling');
}

async function getMacLanIp() {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  const interfaces = ['en0', 'en1'];
  for (const name of interfaces) {
    try {
      const { stdout } = await execFileAsync('ipconfig', ['getifaddr', name], { timeout: 2000 });
      const ip = stdout.trim();
      if (ip) return ip;
    } catch {
      // try next interface
    }
  }
  return '127.0.0.1';
}

async function getWebrtcLogPaths() {
  const path = await import('path');
  return {
    serverLog: path.join(WEBRTC_DIR, 'la-pluma-webrtc-server.log'),
    agentLog: path.join(WEBRTC_DIR, 'la-pluma-webrtc-agent.log'),
    turnLog: path.join(WEBRTC_DIR, 'la-pluma-webrtc-turn.log')
  };
}

async function isWebrtcServerReachable() {
  try {
    const response = await fetch(`http://127.0.0.1:${WEBRTC_PORT}`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function isDeviceAgentRunning(address = '127.0.0.1:16384') {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync('/opt/homebrew/bin/adb', ['-s', address, 'shell', 'ps | grep cloudphone-agent || true'], { timeout: 5000 });
    return stdout.includes('cloudphone-agent');
  } catch {
    return false;
  }
}

async function getIceServersConfig() {
  const lanIp = await getMacLanIp();
  return `turn:cloudphone_user:cloudphone_secure_password@${lanIp}:3478?transport=udp,stun:${lanIp}:3478`;
}

async function startLocalTurnServer() {
  if (webrtcTurnProcess && !webrtcTurnProcess.killed) return;
  const { spawn } = await import('child_process');
  const fs = await import('fs');
  const { turnLog } = await getWebrtcLogPaths();
  const logFd = fs.openSync(turnLog, 'a');
  const turnserver = '/opt/homebrew/bin/turnserver';
  if (!await pathExists(turnserver)) return;
  webrtcTurnProcess = spawn(turnserver, [
    '-n',
    '--no-cli',
    '--no-tls',
    '--no-dtls',
    '-L', '0.0.0.0',
    '-p', '3478',
    '-a',
    '-u', 'cloudphone_user:cloudphone_secure_password',
    '-r', 'cloudphone'
  ], {
    cwd: WEBRTC_DIR,
    stdio: ['ignore', logFd, logFd],
    detached: false
  });
  webrtcTurnProcess.on('exit', () => { webrtcTurnProcess = null; });
}

async function getWebrtcStatus() {
  const path = await import('path');
  const binaryPath = await getWebrtcBinaryPath();
  const assetsPath = path.join(WEBRTC_DIR, 'assets', 'v1');
  const lanIp = await getMacLanIp();
  const logPaths = await getWebrtcLogPaths();
  const deviceAddress = '127.0.0.1:16384';
  const serverReachable = await isWebrtcServerReachable();
  const deviceAgentRunning = await isDeviceAgentRunning(deviceAddress);
  return {
    installed: await pathExists(WEBRTC_DIR),
    built: await pathExists(binaryPath) && await pathExists(assetsPath),
    dir: WEBRTC_DIR,
    port: WEBRTC_PORT,
    url: `http://127.0.0.1:${WEBRTC_PORT}`,
    lanUrl: `http://${lanIp}:${WEBRTC_PORT}`,
    signalingUrl: `ws://${lanIp}:${WEBRTC_PORT}`,
    turnRunning: !!webrtcTurnProcess && !webrtcTurnProcess.killed,
    iceServers: await getIceServersConfig(),
    serverRunning: (!!webrtcServerProcess && !webrtcServerProcess.killed) || serverReachable,
    agentRunning: (!!webrtcAgentProcess && !webrtcAgentProcess.killed) || deviceAgentRunning,
    deviceAddress,
    ...logPaths
  };
}

router.get('/webrtc/status', asyncHandler(async (req, res) => {
  res.json(successResponse(await getWebrtcStatus()));
}));

router.post('/webrtc/install', asyncHandler(async (req, res) => {
  const { spawn } = await import('child_process');
  const fs = await import('fs/promises');
  const path = await import('path');
  const home = process.env.HOME || process.cwd();
  const parentDir = path.dirname(WEBRTC_DIR) || home;

  if (!await pathExists(WEBRTC_DIR)) {
    await new Promise((resolve, reject) => {
      const child = spawn('git', ['clone', 'https://github.com/hqw700/ScrcpyOverWebRTC.git', WEBRTC_DIR], {
        cwd: parentDir,
        stdio: 'ignore'
      });
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`git clone 失败: ${code}`)));
      child.on('error', reject);
    });
  }

  const buildScript = path.join(WEBRTC_DIR, 'build.sh');
  await fs.chmod(buildScript, 0o755).catch(() => {});
  await new Promise((resolve, reject) => {
    const child = spawn('bash', ['build.sh'], { cwd: WEBRTC_DIR, stdio: 'ignore' });
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`build.sh 失败: ${code}`)));
    child.on('error', reject);
  });

  res.json(successResponse(await getWebrtcStatus(), 'WebRTC 组件已安装'));
}));

router.post('/webrtc/start-server', asyncHandler(async (req, res) => {
  if (webrtcServerProcess && !webrtcServerProcess.killed) {
    return res.json(successResponse(await getWebrtcStatus(), 'WebRTC 服务已在运行'));
  }
  const { spawn } = await import('child_process');
  const path = await import('path');
  const binaryPath = await getWebrtcBinaryPath();
  const assetsPath = path.join(WEBRTC_DIR, 'assets', 'v1');
  if (!await pathExists(binaryPath) || !await pathExists(assetsPath)) {
    return res.status(400).json(errorResponse(new Error('WebRTC 组件未安装或未构建')));
  }
  await startLocalTurnServer();
  const fs = await import('fs');
  const { serverLog } = await getWebrtcLogPaths();
  const logFd = fs.openSync(serverLog, 'a');
  const iceServers = await getIceServersConfig();
  webrtcServerProcess = spawn(binaryPath, ['-host', '0.0.0.0', '-port', String(WEBRTC_PORT), '-assets', assetsPath, '-ice_servers', iceServers], {
    cwd: WEBRTC_DIR,
    stdio: ['ignore', logFd, logFd],
    detached: false,
    env: { ...process.env, PORT: String(WEBRTC_PORT), PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` }
  });
  webrtcServerProcess.on('exit', () => { webrtcServerProcess = null; });
  res.json(successResponse(await getWebrtcStatus(), 'WebRTC 服务已启动'));
}));

router.post('/webrtc/stop-server', asyncHandler(async (req, res) => {
  if (webrtcAgentProcess && !webrtcAgentProcess.killed) {
    webrtcAgentProcess.kill('SIGTERM');
    webrtcAgentProcess = null;
  }
  if (webrtcServerProcess && !webrtcServerProcess.killed) {
    webrtcServerProcess.kill('SIGTERM');
    webrtcServerProcess = null;
  }
  if (webrtcTurnProcess && !webrtcTurnProcess.killed) {
    webrtcTurnProcess.kill('SIGTERM');
    webrtcTurnProcess = null;
  }
  res.json(successResponse(await getWebrtcStatus(), 'WebRTC 服务已停止'));
}));

router.post('/webrtc/start-agent', asyncHandler(async (req, res) => {
  if (webrtcAgentProcess && !webrtcAgentProcess.killed) {
    return res.json(successResponse(await getWebrtcStatus(), 'MuMu Agent 已在运行'));
  }
  const { spawn } = await import('child_process');
  const path = await import('path');
  const address = req.body?.address || '127.0.0.1:16384';
  const runScript = path.join(WEBRTC_DIR, 'agentd', 'run.sh');
  if (!await pathExists(runScript)) {
    return res.status(400).json(errorResponse(new Error('WebRTC agent 未安装')));
  }
  const fs = await import('fs');
  const { agentLog } = await getWebrtcLogPaths();
  const logFd = fs.openSync(agentLog, 'a');
  const lanIp = await getMacLanIp();
  // Agent 运行在 Android 内，不能用 127.0.0.1；必须连 Mac 局域网 IP。
  // MuMu 同一实例可能有 127.0.0.1:16384 / 127.0.0.1:5555 / emulator-5554 多个 serial，只部署一份 agent。
  const iceServers = await getIceServersConfig();
  webrtcAgentProcess = spawn('bash', [runScript, address, '-id', 'mumu-la-pluma', '-signaling', `ws://${lanIp}:${WEBRTC_PORT}`, '-ice-servers', iceServers, '-webrtc-port', '50000'], {
    cwd: path.join(WEBRTC_DIR, 'agentd'),
    stdio: ['ignore', logFd, logFd],
    detached: false,
    env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` }
  });
  webrtcAgentProcess.on('exit', () => { webrtcAgentProcess = null; });
  res.json(successResponse(await getWebrtcStatus(), 'MuMu Agent 已启动'));
}));

router.post('/webrtc/stop-agent', asyncHandler(async (req, res) => {
  if (webrtcAgentProcess && !webrtcAgentProcess.killed) {
    webrtcAgentProcess.kill('SIGTERM');
    webrtcAgentProcess = null;
  }
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  const address = req.body?.address || '127.0.0.1:16384';
  await execFileAsync('/opt/homebrew/bin/adb', ['-s', address, 'shell', 'pkill -f cloudphone-agent || true'], { timeout: 5000 }).catch(() => {});
  await execFileAsync('/opt/homebrew/bin/adb', ['-s', address, 'shell', 'pkill -f scrcpy.Server || true'], { timeout: 5000 }).catch(() => {});
  res.json(successResponse(await getWebrtcStatus(), 'MuMu Agent 已停止'));
}));

// 获取任务执行状态
router.get('/task-status', asyncHandler(async (req, res) => {
  const status = getTaskStatus();
  res.json(successResponse(status));
}));

// 获取实时日志
router.get('/realtime-logs', asyncHandler(async (req, res) => {
  const { lines = 100 } = req.query;
  const logs = getRealtimeLogs(parseInt(lines));
  res.json(successResponse(logs));
}));

// 清空实时日志
router.post('/realtime-logs/clear', asyncHandler(async (req, res) => {
  clearRealtimeLogs();
  res.json(successResponse(null, '实时日志已清空'));
}));

// 终止当前任务
router.post('/stop-task', asyncHandler(async (req, res) => {
  // 1. 停止当前正在运行的 MAA 命令
  const taskStopped = stopCurrentTask();
  
  // 2. 停止整个定时任务流程
  const scheduleStopped = stopScheduleExecution();
  
  const taskStopSuccess = !!taskStopped?.success;
  if (taskStopSuccess || scheduleStopped) {
    const message = taskStopSuccess && scheduleStopped
      ? '已终止当前任务并停止任务流程'
      : taskStopSuccess
        ? taskStopped.message || '已终止当前任务'
        : '已设置停止标志，将在当前任务完成后终止流程';
    res.json(successResponse(null, message));
  } else {
    res.json(errorResponse(taskStopped?.message || '没有正在运行的任务'));
  }
}));

// 获取 MAA 版本信息
router.get('/version', asyncHandler(async (req, res) => {
  // 健康检查请求不输出日志
  const isHealthCheck = req.headers['user-agent']?.includes('curl');
  const version = await getMaaVersion(isHealthCheck);
  res.json(successResponse(version));
}));

// 获取配置目录
router.get('/config-dir', asyncHandler(async (req, res) => {
  const configDir = await getMaaConfigDir();
  res.json(successResponse(configDir));
}));


router.post('/config-dir/open', asyncHandler(async (req, res) => {
  const configDir = await getMaaConfigDir();
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'explorer.exe'
      : 'xdg-open';

  await execFileAsync(command, [configDir]);
  res.json(successResponse(configDir, '配置目录已打开'));
}));

// 获取配置
router.get('/config/:profileName', asyncHandler(async (req, res) => {
  const { profileName } = req.params;
  const config = await getConfig(profileName);
  res.json(successResponse(config));
}));

// 保存配置
router.post('/config/:profileName', asyncHandler(async (req, res) => {
  const { profileName } = req.params;
  const config = req.body;
  await saveConfig(profileName, config);
  res.json(successResponse(null, '配置保存成功'));
}));

// 执行 MAA 命令
router.post('/execute', asyncHandler(async (req, res) => {
  let { command, args = [], taskConfig, taskName, taskType, waitForCompletion = false } = req.body;
  
  logger.debug('收到执行请求', { command, argsCount: args.length, hasTaskConfig: !!taskConfig });

  const allowedCommands = new Set([
    'version', 'dir', 'list', 'run', 'fight', 'copilot', 'sscopilot', 'ssscopilot',
    'paradoxcopilot', 'roguelike', 'reclamation', 'startup', 'closedown', 'infrast',
    'recruit', 'mall', 'award', 'depot', 'operbox', 'activity'
  ]);
  if (!allowedCommands.has(command)) {
    return res.status(400).json(errorResponse(new Error('不支持的 MAA 命令'), '不支持的 MAA 命令'));
  }
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
    return res.status(400).json(errorResponse(new Error('args 必须是字符串数组'), '参数格式错误'));
  }
  
  // 对于需要交互式输入的命令，自动添加 --batch 参数
  const batchCommands = ['copilot', 'ssscopilot', 'paradoxcopilot'];
  if (batchCommands.includes(command) && !args.includes('--batch')) {
    args.unshift('--batch');
    logger.debug('添加 --batch 参数', { command });
  }
  
  // 如果是 fight 命令，检查并替换活动代号，并检查资源本是否开放
  if (command === 'fight' && args.length > 0) {
    const stageInput = args[0];
    logger.debug('处理 fight 命令', { originalStage: stageInput });
    
    const stages = stageInput.split(',').map(s => s.trim()).filter(s => s);
    
    if (stages.length > 1) {
      logger.debug('检测到多个关卡', { stages });
      const validStages = [];
      
      for (const stage of stages) {
        const { isStageOpenToday } = await import('../services/notificationService.js');
        const openCheck = isStageOpenToday(stage);
        if (!openCheck.isOpen) {
          logger.debug('关卡未开放，跳过', { stage, reason: openCheck.reason });
          continue;
        }
        
        const clientType = 'Official';
        const realStage = await replaceActivityCode(stage, clientType);
        validStages.push(realStage);
        
        if (realStage !== stage) {
          logger.debug('关卡代号已替换', { from: stage, to: realStage });
        }
      }
      
      if (validStages.length === 0) {
        return res.json(errorResponse(
          new Error('所有关卡今日均未开放'),
          '所有关卡今日均未开放，已全部跳过'
        ));
      }
      
      args[0] = validStages.join(',');
      logger.debug('有效关卡列表', { validStages: args[0] });
    } else {
      const stage = stages[0];
      
      const { isStageOpenToday } = await import('../services/notificationService.js');
      const openCheck = isStageOpenToday(stage);
      if (!openCheck.isOpen) {
        logger.debug('关卡未开放', { stage, reason: openCheck.reason });
        return res.json(errorResponse(
          new Error(openCheck.reason),
          `${openCheck.reason}，已跳过`
        ));
      }
      
      const clientType = 'Official';
      const realStage = await replaceActivityCode(stage, clientType);
      if (realStage !== stage) {
        args[0] = realStage;
        logger.debug('关卡代号已替换', { from: stage, to: realStage });
      }
    }
  }
  
  logger.debug('执行命令', { command, args });
  
  // 如果有 taskConfig，说明是动态任务，需要创建临时文件
  if (taskConfig) {
    const taskId = args[0];
    const result = await execDynamicTask(taskId, taskConfig, taskName, taskType, waitForCompletion);
    res.json(successResponse(result));
  } else {
    const result = await execMaaCommand(command, args, taskName, taskType, waitForCompletion);
    res.json(successResponse(result));
  }
}));

// 获取当前活动信息
router.get('/activity', asyncHandler(async (req, res) => {
  const { clientType = 'Official' } = req.query;
  const activityInfo = await getCurrentActivity(clientType);
  res.json(successResponse({ 
    code: activityInfo.code,
    name: activityInfo.name,
    available: !!activityInfo.code,
    message: activityInfo.code 
      ? `当前活动: ${activityInfo.name || activityInfo.code}` 
      : '当前没有活动或无法获取活动信息'
  }));
}));

// 测试 ADB 连接
router.post('/test-connection', asyncHandler(async (req, res) => {
  const { adbPath, address } = req.body;
  const result = await testAdbConnection(adbPath, address);
  res.json(result);
}));

// 获取 MAA 调试截图列表
router.get('/debug-screenshots', asyncHandler(async (req, res) => {
  const screenshots = await getDebugScreenshots();
  res.json(successResponse(screenshots));
}));

// 设置定时任务
router.post('/schedule', asyncHandler(async (req, res) => {
  const { scheduleId = 'default', times, taskFlow } = req.body;
  const result = setupSchedule(scheduleId, times, taskFlow);
  res.json(result);
}));

// 停止定时任务
router.delete('/schedule/:scheduleId', asyncHandler(async (req, res) => {
  const { scheduleId } = req.params;
  const result = stopSchedule(scheduleId);
  res.json(result);
}));

// 获取定时任务状态
router.get('/schedule/status', asyncHandler(async (req, res) => {
  const status = getScheduleStatus();
  res.json(successResponse(status));
}));

// 获取定时任务执行状态
router.get('/schedule/execution-status', asyncHandler(async (req, res) => {
  const status = getScheduleExecutionStatus();
  res.json(successResponse(status));
}));

// 立即执行定时任务（测试用）
router.post('/schedule/:scheduleId/execute', asyncHandler(async (req, res) => {
  const { scheduleId } = req.params;
  const { taskFlow } = req.body;
  const result = await executeScheduleNow(scheduleId, taskFlow);
  res.json(result);
}));

// 获取日志文件列表
router.get('/logs', asyncHandler(async (req, res) => {
  const files = await getLogFiles();
  res.json(successResponse(files));
}));

// 读取日志文件内容
router.get('/logs/:filePath(*)', asyncHandler(async (req, res) => {
  const { filePath } = req.params;
  const { lines = 1000 } = req.query;
  const decodedPath = decodeURIComponent(filePath);
  const result = await readLogFile(decodedPath, parseInt(lines));
  res.json(successResponse(result));
}));

// 手动清理日志文件
router.post('/logs/cleanup', asyncHandler(async (req, res) => {
  const { maxSizeMB = 10 } = req.body;
  const result = await cleanupLogs(maxSizeMB);
  res.json(successResponse(
    result,
    `已清理 ${result.deletedCount} 个日志文件，释放 ${(result.freedSpace / 1024 / 1024).toFixed(2)} MB 空间`
  ));
}));

// 更新 MaaCore
router.post('/update-core', asyncHandler(async (req, res) => {
  const { version } = req.body;
  
  try {
    if (version === 'beta') {
      // 切换到 Beta 渠道
      logger.info('切换到 Beta 渠道');
      const result = await execMaaCommand('install', ['beta', '--force']);
      res.json(successResponse(result, '已切换到 Beta 渠道'));
    } else if (version === 'stable') {
      // 切换到正式版渠道
      logger.info('切换到正式版渠道');
      const result = await execMaaCommand('install', ['stable', '--force']);
      res.json(successResponse(result, '已切换到正式版渠道'));
    } else {
      // 更新当前渠道到最新版本
      logger.info('更新 MaaCore 到最新版本');
      const result = await execMaaCommand('update', []);
      res.json(successResponse(result, '已更新 MaaCore 到最新版本'));
    }
  } catch (error) {
    logger.error('更新 MaaCore 失败', { error: error.message, version });
    res.json(errorResponse(error, `更新失败: ${error.message}`));
  }
}));

// 更新 MAA CLI
router.post('/update-cli', asyncHandler(async (req, res) => {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const os = await import('os');
  const execAsync = promisify(exec);
  
  const MAA_CLI_PATH = process.env.MAA_CLI_PATH || (process.env.DOCKER_ENV ? '/usr/local/bin/maa' : 'maa');
  
  const isDocker = process.env.NODE_ENV === 'production' && 
                   await execAsync('test -f /.dockerenv').then(() => true).catch(() => false);
  
  if (isDocker) {
    const { stdout, stderr } = await execAsync(`${MAA_CLI_PATH} self update`);
    res.json(successResponse(
      { output: stdout || stderr },
      'MAA CLI 更新完成（Docker 环境）\n更新已持久化到 volume，重启容器后仍然有效'
    ));
  } else {
    const platform = os.platform();
    let command;
    
    if (platform === 'darwin') {
      command = 'brew upgrade maa-cli';
    } else if (platform === 'linux' || platform === 'win32') {
      command = `${MAA_CLI_PATH} self update`;
    } else {
      throw new Error(`不支持的操作系统: ${platform}`);
    }
    
    const { stdout, stderr } = await execAsync(command);
    res.json(successResponse(
      { output: stdout || stderr },
      `MAA CLI 更新完成 (${platform})`
    ));
  }
}));

// 热更新资源文件
router.post('/hot-update', asyncHandler(async (req, res) => {
  logger.info('开始热更新资源文件');
  
  const { spawn } = await import('child_process');
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const scriptPath = join(__dirname, '../scripts/update-maa-resources.js');
  
  // 使用 spawn 执行脚本
  const child = spawn('node', [scriptPath], {
    cwd: join(__dirname, '..'),
    stdio: 'pipe'
  });
  
  let output = '';
  let errorOutput = '';
  
  child.stdout.on('data', (data) => {
    output += data.toString();
  });
  
  child.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });
  
  child.on('close', (code) => {
    if (code === 0) {
      logger.success('资源文件热更新成功');
      res.json(successResponse({ output }, '资源文件更新成功'));
    } else {
      logger.error('资源文件热更新失败', { code, errorOutput });
      res.status(500).json(errorResponse(new Error(`更新失败: ${errorOutput || output || '未知错误'}`)));
    }
  });
}));

// 设置自动更新
router.post('/auto-update', asyncHandler(async (req, res) => {
  const config = req.body;
  const result = setupAutoUpdate(config);
  res.json(result);
}));

// 获取自动更新状态
router.get('/auto-update/status', asyncHandler(async (req, res) => {
  const status = getAutoUpdateStatus();
  res.json(successResponse(status));
}));

// 获取 MaaCore 更新日志
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
    
    // 找到最新的 Beta 版本和最新的正式版本
    const latestBeta = releases.find(release => release.prerelease);
    const latestStable = releases.find(release => !release.prerelease);
    
    const changelog = [];
    
    // Beta 版在前
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
    
    // 正式版在后
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
    
    res.json(successResponse(changelog));
  } catch (error) {
    logger.error('获取 MaaCore 更新日志失败', { error: error.message });
    res.json(errorResponse(`获取更新日志失败: ${error.message}`));
  }
}));

// 获取 MAA CLI 更新日志
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
    // MAA CLI 只显示最新的正式版
    const latestStable = releases.find(release => !release.prerelease);
    
    const changelog = latestStable ? [{
      version: latestStable.tag_name,
      name: latestStable.name,
      body: latestStable.body,
      publishedAt: latestStable.published_at,
      htmlUrl: latestStable.html_url,
      prerelease: latestStable.prerelease
    }] : [];
    
    res.json(successResponse(changelog));
  } catch (error) {
    logger.error('获取 MAA CLI 更新日志失败', { error: error.message });
    res.json(errorResponse(`获取更新日志失败: ${error.message}`));
  }
}));

// ========== 用户配置存储 API ==========

// 保存用户配置
router.post('/user-config/:configType', asyncHandler(async (req, res) => {
  const { configType } = req.params;
  const data = req.body;
  const result = await saveUserConfig(configType, data);
  res.json(result);
}));

// 读取用户配置
router.get('/user-config/:configType', asyncHandler(async (req, res) => {
  const { configType } = req.params;
  const result = await loadUserConfig(configType);
  res.json(result);
}));

// 获取所有用户配置
router.get('/user-configs', asyncHandler(async (req, res) => {
  const result = await getAllUserConfigs();
  res.json(result);
}));

// 删除用户配置
router.delete('/user-config/:configType', asyncHandler(async (req, res) => {
  const { configType } = req.params;
  const result = await deleteUserConfig(configType);
  res.json(result);
}));

// ========== 数据统计 API ==========

// 解析并保存仓库数据
router.post('/data/depot/parse', asyncHandler(async (req, res) => {
  const result = await parseDepotData();
  if (result) {
    res.json(successResponse(
      {
        path: result.path,
        itemCount: result.itemCount,
        items: result.items || []
      },
      `仓库数据已保存，共 ${result.itemCount} 种物品`
    ));
  } else {
    res.json(errorResponse(
      new Error('未找到仓库识别数据'),
      '未找到仓库识别数据，请先执行仓库识别任务'
    ));
  }
}));

// 解析并保存干员数据
router.post('/data/operbox/parse', asyncHandler(async (req, res) => {
  const result = await parseOperBoxData();
  if (result) {
    res.json(successResponse(
      {
        path: result.path,
        operCount: result.operCount
      },
      `干员数据已保存，共 ${result.operCount} 名干员`
    ));
  } else {
    res.json(errorResponse(
      new Error('未找到干员识别数据'),
      '未找到干员识别数据，请先执行干员识别任务'
    ));
  }
}));

// 获取已保存的仓库数据
router.get('/data/depot', asyncHandler(async (req, res) => {
  const data = await getDepotData();
  if (data) {
    res.json(successResponse(data));
  } else {
    res.json(errorResponse(new Error('暂无仓库数据')));
  }
}));

// 获取已保存的干员数据
router.get('/data/operbox', asyncHandler(async (req, res) => {
  const data = await getOperBoxData();
  if (data) {
    res.json(successResponse(data));
  } else {
    res.json(errorResponse(new Error('暂无干员数据')));
  }
}));

// 获取所有干员列表
router.get('/data/all-operators', asyncHandler(async (req, res) => {
  const operators = await getAllOperators();
  res.json(successResponse(operators));
}));

// 图片代理接口 - 干员头像
router.get('/operator-avatar/:charId', asyncHandler(async (req, res) => {
  const { charId } = req.params;
  
  const imageUrls = [
    `https://raw.githubusercontent.com/Aceship/Arknight-Images/main/avatars/${charId}.png`,
    `https://cdn.jsdelivr.net/gh/Aceship/Arknight-Images@main/avatars/${charId}.png`,
    `https://raw.githubusercontent.com/yuanyan3060/Arknights-Bot-Resource/main/avatars/${charId}.png`
  ];
  
  let imageData = null;
  let contentType = 'image/png';
  const https = await import('https');
  
  for (const url of imageUrls) {
    try {
      await new Promise((resolve, reject) => {
        https.get(url, { timeout: 5000 }, (response) => {
          if (response.statusCode === 200) {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
              imageData = Buffer.concat(chunks);
              contentType = response.headers['content-type'] || 'image/png';
              resolve();
            });
          } else {
            reject(new Error(`HTTP ${response.statusCode}`));
          }
        }).on('error', reject).on('timeout', () => {
          reject(new Error('Timeout'));
        });
      });
      
      if (imageData) break;
    } catch (err) {
      logger.debug('图片获取失败', { url, error: err.message });
      continue;
    }
  }
  
  if (imageData) {
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(imageData);
  } else {
    res.status(404).json(errorResponse(new Error('图片未找到')));
  }
}));

// 图片代理接口 - 物品图标
router.get('/item-icon/:iconId', asyncHandler(async (req, res) => {
  const { iconId } = req.params;
  const url = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/refs/heads/main/item/${iconId}.png`;
  const https = await import('https');
  
  await new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 10000 }, (response) => {
      if (response.statusCode === 200) {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const imageData = Buffer.concat(chunks);
          const contentType = response.headers['content-type'] || 'image/png';
          res.set('Content-Type', contentType);
          res.set('Cache-Control', 'public, max-age=86400');
          res.send(imageData);
          resolve();
        });
      } else {
        reject(new Error(`HTTP ${response.statusCode}`));
      }
    });
    
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
  });
}));

// 代理 PRTS 作业 API（解决 CORS 问题）
router.get('/copilot/get/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const response = await fetch(`https://prts.maa.plus/copilot/get/${id}`);
  const data = await response.json();
  res.json(data);
}));

// 代理 PRTS 作业集 API（解决 CORS 问题）
router.get('/copilot/set/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const response = await fetch(`https://prts.maa.plus/set/get?id=${encodeURIComponent(id)}`);
  const data = await response.json();
  res.json(data);
}));

// 搜索悖论模拟作业
router.get('/paradox/search', asyncHandler(async (req, res) => {
  const { name } = req.query;
  
  if (!name) {
    return res.status(400).json(errorResponse(new Error('请提供干员名字')));
  }
  
  const paradoxData = await loadParadoxOperators();
  const operator = paradoxData.find(op => op.name.includes(name) || name.includes(op.name));
  
  if (!operator) {
    return res.json(errorResponse(
      new Error(`未找到干员"${name}"的悖论模拟关卡`),
      `未找到干员"${name}"的悖论模拟关卡`
    ));
  }
  
  const stageKeyword = operator.stage_id;
  const response = await fetch(`https://prts.maa.plus/copilot/query?level_keyword=${stageKeyword}&page=1&limit=10&order_by=hot`);
  const data = await response.json();
  
  if (data.status_code === 200 && data.data && data.data.data && data.data.data.length > 0) {
    const copilots = data.data.data.map(item => {
      let title = item.doc?.title || '无标题';
      try {
        const content = JSON.parse(item.content || '{}');
        title = content.doc?.title || title;
      } catch {
        // 使用接口默认标题
      }
      return {
        id: item.id,
        uri: `maa://${item.id}`,
        views: item.views,
        hotScore: item.hot_score,
        uploader: item.uploader_id,
        title
      };
    });
    
    res.json(successResponse({
      operator: operator.name,
      stageId: operator.stage_id,
      copilots,
      recommended: copilots[0]
    }));
  } else {
    res.json(errorResponse(
      new Error(`未找到干员"${operator.name}"的作业`),
      `未找到干员"${operator.name}"的作业`
    ));
  }
}));

// 搜索普通关卡作业
router.get('/copilot/search', asyncHandler(async (req, res) => {
  const { stage } = req.query;

  if (!stage) {
    return res.status(400).json(errorResponse(new Error('请提供关卡名称')));
  }

  // 标准化关卡名称（去除空格、转大写），查询 PRTS 时优先使用游戏内部 stage id
  const normalizedStage = stage.trim().toUpperCase();
  const searchKeyword = await resolveStageSearchKeyword(stage);

  // 搜索多页，直到找到足够的结果
  const allCopilots = [];
  let page = 1;
  const maxPages = 5; // 最多搜索5页
  const targetCount = 10; // 目标找到10个匹配结果

  while (page <= maxPages && allCopilots.length < targetCount) {
    const response = await fetch(`https://prts.maa.plus/copilot/query?level_keyword=${encodeURIComponent(searchKeyword)}&page=${page}&limit=50&order_by=hot`);
    const data = await response.json();

    if (data.status_code !== 200 || !data.data?.data?.length) {
      break;
    }

    // 解析并过滤结果
    for (const item of data.data.data) {
      let title = '无标题';
      let stageName = stage;
      let titleStageCode = '';

      try {
        const content = JSON.parse(item.content);
        title = content.doc?.title || '无标题';
        stageName = content.stage_name || stage;

        // 从标题开头提取关卡代号，如 "CG-7 - xxx" -> "CG-7"
        const titleMatch = title.match(/^([A-Z]{2,4}-\d+[A-Z]?)/i);
        if (titleMatch) {
          titleStageCode = titleMatch[1].toUpperCase();
        }
      } catch (e) {
        // 解析失败使用默认值
      }

      const normalizedStageName = String(stageName || '').trim().toUpperCase();
      const normalizedSearchKeyword = String(searchKeyword || '').trim().toUpperCase();
      // 优先匹配作业 JSON 的 stage_name/内部 stage id，标题关卡代号仅作辅助
      if (normalizedStageName === normalizedStage || normalizedStageName === normalizedSearchKeyword || titleStageCode === normalizedStage) {
        allCopilots.push({
          id: item.id,
          uri: `maa://${item.id}`,
          views: item.views,
          hotScore: item.hot_score,
          uploader: item.uploader_id,
          title: title,
          stageName: stageName
        });
      }
    }

    // 检查是否还有下一页
    if (!data.data.has_next) {
      break;
    }
    page++;
  }

  if (allCopilots.length > 0) {
    res.json(successResponse({
      stage: stage,
      copilots: allCopilots.slice(0, targetCount),
      recommended: allCopilots[0]
    }));
  } else {
    res.json(errorResponse(
      new Error(`未找到关卡"${stage}"的作业`),
      `未找到关卡"${stage}"的作业`
    ));
  }
}));

// 获取所有悖论模拟干员列表
router.get('/paradox/operators', asyncHandler(async (req, res) => {
  const paradoxData = await loadParadoxOperators();
  res.json(successResponse(paradoxData));
}));

// ==================== 掉落记录 API ====================

// 获取今日掉落记录
router.get('/drops/today', asyncHandler(async (req, res) => {
  const result = await getTodayDrops();
  res.json(result);
}));

// 获取最近几天的掉落记录
router.get('/drops/recent', asyncHandler(async (req, res) => {
  const { days = 7 } = req.query;
  const result = await getRecentDrops(parseInt(days));
  res.json(result);
}));

// 获取掉落统计数据
router.get('/drops/statistics', asyncHandler(async (req, res) => {
  const { days = 7 } = req.query;
  const result = await getDropStatistics(parseInt(days));
  res.json(result);
}));

export default router;
