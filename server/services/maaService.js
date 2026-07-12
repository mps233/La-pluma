import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { createConnection } from 'net';
import { readFile, writeFile, mkdir, readdir, stat, unlink, realpath, open } from 'fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import TOML from '@iarna/toml';
import { createLogger } from '../utils/logger.js';
import { getFallbackActivity } from './activityFallbackService.js';
import { acquireMaaExecutionLease } from './executionCoordinatorService.js';
import { loadUserConfig, saveUserConfig } from './configStorageService.js';

const execFilePromise = promisify(execFile);

// 创建日志记录器
const logger = createLogger('MaaService');

// MAA CLI 路径
// Docker 环境使用完整路径，本地环境使用 'maa' 依赖 PATH
const MAA_CLI_PATH = process.env.MAA_CLI_PATH || (process.env.DOCKER_ENV ? '/usr/local/bin/maa' : 'maa');
const MAX_REALTIME_LOGS = Number(process.env.LA_PLUMA_MAX_REALTIME_LOGS || 5000);
const LOCAL_EMULATOR_ADDRESSES = [
  '127.0.0.1:16384',
  '127.0.0.1:5555',
  '127.0.0.1:7555',
  '127.0.0.1:62001',
  '127.0.0.1:21503'
];
const WINDOWS_EMULATOR_PROCESSES = [
  { names: ['HD-Player.exe'], label: 'BlueStacks', adbFiles: ['HD-Adb.exe', 'adb.exe'] },
  { names: ['dnplayer.exe'], label: 'LDPlayer', adbFiles: ['adb.exe'] },
  { names: ['Nox.exe', 'NoxVMHandle.exe'], label: '夜神模拟器', adbFiles: ['nox_adb.exe', 'adb.exe'] },
  { names: ['MuMuPlayer.exe', 'MuMuNxDevice.exe'], label: 'MuMu 模拟器', adbFiles: ['adb.exe', 'shell\\adb.exe'] },
  { names: ['MEmu.exe', 'MEmuHeadless.exe'], label: '逍遥模拟器', adbFiles: ['adb.exe', 'MEmuHyperv\\adb.exe'] }
];
const GAME_PACKAGES = {
  Official: 'com.hypergryph.arknights',
  Bilibili: 'com.hypergryph.arknights.bilibili',
  YoStarEN: 'com.YoStarEN.Arknights',
  YoStarJP: 'com.YoStarJP.Arknights',
  YoStarKR: 'com.YoStarKR.Arknights',
  Txwy: 'tw.txwy.and.arknights'
};

// 全局任务状态追踪
const taskStatus = {
  isRunning: false,
  taskName: null,
  startTime: null,
  taskType: null, // 'automation', 'combat', 'roguelike'
  process: null, // 保存子进程引用
  logs: [] // 保存实时日志
};

/**
 * 获取当前任务执行状态
 */
export function getTaskStatus() {
  const { process, ...status } = taskStatus; // 不返回 process 对象
  return { ...status };
}

/**
 * 获取实时日志
 */
export function getRealtimeLogs(lines = 100) {
  // 返回最后 N 行日志
  const startIndex = Math.max(0, taskStatus.logs.length - lines);
  return taskStatus.logs.slice(startIndex);
}

/**
 * 清空实时日志
 */
export function clearRealtimeLogs() {
  taskStatus.logs = [];
}

function trimRealtimeLogs() {
  if (taskStatus.logs.length > MAX_REALTIME_LOGS) {
    taskStatus.logs.splice(0, taskStatus.logs.length - MAX_REALTIME_LOGS);
  }
}

function appendRealtimeLog(level, message) {
  taskStatus.logs.push({
    time: new Date().toISOString(),
    level,
    message
  });
  trimRealtimeLogs();
}

/**
 * 添加日志到缓存
 */
function addLog(level, message) {
  appendRealtimeLog(level, message);
  // 使用结构化日志，不再使用 console.log
  const logLevel = level.toLowerCase();
  if (logger[logLevel]) {
    logger[logLevel](message);
  } else {
    logger.info(message);
  }
}

export function getMaaExecutionDiagnostics(stderr = '') {
  const output = String(stderr || '');
  const diagnostics = [];

  if (output.includes('UnknownDrops')) {
    diagnostics.push({
      code: 'UNKNOWN_DROPS',
      level: 'WARN',
      message: '掉落汇报未发送：结算中存在未识别物品，请更新 MaaCore 和资源后重试'
    });
    return diagnostics;
  }

  if (/FailedToReportToPenguinStats/i.test(output)) {
    diagnostics.push({
      code: 'PENGUIN_REPORT_FAILED',
      level: 'WARN',
      message: '企鹅物流汇报失败，请检查网络或用户 ID'
    });
  }
  if (/FailedToReportToYituliu/i.test(output)) {
    diagnostics.push({
      code: 'YITULIU_REPORT_FAILED',
      level: 'WARN',
      message: '一图流汇报失败，请检查网络或用户 ID'
    });
  }

  if (/FailedToConnect|ConnectionError|device\s+[^\s]+\s+not found|no devices\/emulators found|cannot connect to adb/i.test(output)) {
    diagnostics.push({
      code: 'ADB_CONNECTION_FAILED',
      level: 'ERROR',
      message: '模拟器连接失败，请检查 ADB 地址和模拟器状态'
    });
  }
  if (/account.*(?:not found|failed)|(?:switch|select).*account.*failed/i.test(output)) {
    diagnostics.push({
      code: 'ACCOUNT_SWITCH_FAILED',
      level: 'ERROR',
      message: '账号切换失败，请检查账号关键字是否能唯一匹配已登录账号'
    });
  }
  if (/FailedToStartGame|StartGame.*Failed|game client.*not found/i.test(output)) {
    diagnostics.push({
      code: 'GAME_START_FAILED',
      level: 'ERROR',
      message: '游戏启动失败，请检查客户端类型和游戏安装状态'
    });
  }

  return diagnostics;
}

function addExecutionDiagnostics(stderr) {
  getMaaExecutionDiagnostics(stderr).forEach(diagnostic => {
    addLog(diagnostic.level, diagnostic.message);
  });
}

/**
 * 设置任务状态
 */
export function setTaskStatus(isRunning, taskName = null, taskType = null, process = null) {
  taskStatus.isRunning = isRunning;
  taskStatus.taskName = taskName;
  taskStatus.taskType = taskType;
  taskStatus.startTime = isRunning ? Date.now() : null;
  taskStatus.process = process;
  
  if (!isRunning) {
    // 任务结束时，保留日志一段时间
    setTimeout(() => {
      if (!taskStatus.isRunning) {
        taskStatus.logs = [];
      }
    }, 60000); // 1分钟后清空
  }
  
  addLog('INFO', `任务状态更新: ${JSON.stringify({ isRunning, taskName, taskType, hasProcess: !!process })}`);
}

/**
 * 执行 MAA CLI 命令（支持后台异步执行）
 */
async function execMaaCommandUnlocked(command, args = [], taskName = null, taskType = null, waitForCompletion = false, silent = false, onSettled = null) {
  const fullCommand = `${MAA_CLI_PATH} ${command} ${args.join(' ')}`;
  
  // 静默模式下不输出日志（用于健康检查等频繁调用）
  if (!silent) {
    addLog('INFO', `执行命令: ${fullCommand}, 等待完成: ${waitForCompletion}`);
  }
  
  // 准备最终的参数列表
  let finalArgs = [...args];
  
  // 如果有任务名称且不需要等待完成，使用后台异步执行
  if (taskName && !waitForCompletion) {
    return new Promise((resolve, reject) => {
      // 使用 spawn 而不是 exec，这样可以独立运行
      const childProcess = spawn(MAA_CLI_PATH, [command, ...finalArgs], {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      // 实时捕获输出
      childProcess.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        
        // 将输出按行分割并添加到日志
        const lines = text.split('\n').filter(line => line.trim());
        lines.forEach(line => {
          appendRealtimeLog('INFO', line.trim());
        });
      });
      
      childProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        
        // 将错误输出按行分割并添加到日志
        const lines = text.split('\n').filter(line => line.trim());
        lines.forEach(line => {
          const level = line.includes('ERROR') ? 'ERROR' : line.includes('WARN') ? 'WARN' : 'INFO';
          appendRealtimeLog(level, line.trim());
        });
      });
      
      // 设置任务开始状态
      setTaskStatus(true, taskName, taskType, childProcess);
      
      // 立即返回，不等待命令完成
      resolve({
        stdout: '',
        stderr: '',
        command: fullCommand,
        message: '任务已在后台启动'
      });
      
      // 在后台继续执行
      childProcess.on('close', (code) => {
        addLog('INFO', `命令执行完成: ${fullCommand}, 退出码: ${code}`);
        if (stdout.trim()) {
          addLog('INFO', `stdout: ${stdout.trim()}`);
        }
        if (stderr) {
          addExecutionDiagnostics(stderr);
          addLog('WARN', `stderr: ${stderr.trim()}`);
        }
        
        // 任务完成，清除状态
        setTaskStatus(false);
        
        if (code !== 0) {
          addLog('ERROR', `命令执行失败: ${fullCommand}`);
        }
        onSettled?.();
      });
      
      childProcess.on('error', (error) => {
        addLog('ERROR', `命令执行错误: ${fullCommand} - ${error.message}`);
        setTaskStatus(false);
        onSettled?.();
      });
    });
  } 
  // 需要等待完成（任务流程中的串行执行）
  else if (taskName && waitForCompletion) {
    return new Promise((resolve, reject) => {
      const childProcess = spawn(MAA_CLI_PATH, [command, ...finalArgs], {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      // 实时捕获输出
      childProcess.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        
        const lines = text.split('\n').filter(line => line.trim());
        lines.forEach(line => {
          appendRealtimeLog('INFO', line.trim());
        });
      });
      
      childProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        
        const lines = text.split('\n').filter(line => line.trim());
        lines.forEach(line => {
          const level = line.includes('ERROR') ? 'ERROR' : line.includes('WARN') ? 'WARN' : 'INFO';
          appendRealtimeLog(level, line.trim());
        });
      });
      
      // 设置任务开始状态
      setTaskStatus(true, taskName, taskType, childProcess);
      
      // 等待命令完成
      childProcess.on('close', (code) => {
        addLog('INFO', `命令执行完成: ${fullCommand}, 退出码: ${code}`);
        if (stdout.trim()) {
          addLog('INFO', `stdout: ${stdout.trim()}`);
        }
        if (stderr) {
          addExecutionDiagnostics(stderr);
          addLog('WARN', `stderr: ${stderr.trim()}`);
        }
        
        // 任务完成，清除状态
        setTaskStatus(false);
        
        if (code !== 0) {
          addLog('ERROR', `命令执行失败: ${fullCommand}`);
          const diagnostic = getMaaExecutionDiagnostics(stderr)[0];
          const commandError = new Error(diagnostic?.message || `命令执行失败，退出码: ${code}`);
          commandError.stdout = stdout.trim();
          commandError.stderr = stderr.trim();
          commandError.exitCode = code;
          reject(commandError);
        } else {
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            command: fullCommand
          });
        }
      });
      
      childProcess.on('error', (error) => {
        addLog('ERROR', `命令执行错误: ${fullCommand} - ${error.message}`);
        setTaskStatus(false);
        reject(error);
      });
    });
  }
  // 没有任务名称，使用同步执行（用于配置查询等操作）
  else {
    try {
      const { stdout, stderr } = await execFilePromise(MAA_CLI_PATH, [command, ...finalArgs], {
        maxBuffer: 10 * 1024 * 1024
      });
      
      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        command: fullCommand
      };
    } catch (error) {
      const errorMessage = error.message || '';
      const stderr = error.stderr || '';
      const combinedError = `${errorMessage}\n${stderr}`;
      
      // 检测常见错误类型
      if (combinedError.includes('Copilot Error')) {
        if (combinedError.includes('Some error occurred during running task')) {
          throw new Error('作业执行失败：干员不满足要求或编队配置有误');
        }
        throw new Error('作业执行失败：' + combinedError);
      }
      
      if (combinedError.includes('ADB') || combinedError.includes('adb')) {
        throw new Error('ADB 连接失败：请检查模拟器是否已启动，ADB 地址是否正确');
      }
      
      if (combinedError.includes('timeout') || combinedError.includes('Timeout')) {
        throw new Error('任务执行超时：可能是游戏卡住或网络问题，请检查游戏状态');
      }
      
      if (combinedError.includes('not found') || combinedError.includes('No such')) {
        throw new Error('资源文件未找到：请检查 MAA 资源是否完整，可尝试运行 maa update');
      }
      
      throw new Error(`命令执行失败: ${errorMessage}`);
    }
  }
}

const DEVICE_MUTATING_COMMANDS = new Set([
  'startup', 'closedown', 'fight', 'run', 'copilot', 'ssscopilot', 'paradoxcopilot',
  'roguelike', 'reclamation', 'infrast', 'recruit', 'mall', 'award', 'depot', 'operbox',
  'install', 'update', 'hot-update'
]);

export function requiresMaaExecutionLease(command) {
  return DEVICE_MUTATING_COMMANDS.has(command);
}

export async function execMaaCommand(command, args = [], taskName = null, taskType = null, waitForCompletion = false, silent = false) {
  if (!requiresMaaExecutionLease(command)) {
    return execMaaCommandUnlocked(command, args, taskName, taskType, waitForCompletion, silent);
  }

  const lease = await acquireMaaExecutionLease({
    source: taskType || 'maa-command',
    taskName: taskName || command,
    command
  });
  let releaseOnReturn = true;
  try {
    if (taskName && !waitForCompletion) {
      releaseOnReturn = false;
      return await execMaaCommandUnlocked(
        command,
        args,
        taskName,
        taskType,
        waitForCompletion,
        silent,
        () => lease.release().catch(error => logger.error('释放 MAA 执行锁失败', { error: error.message }))
      );
    }
    return await execMaaCommandUnlocked(command, args, taskName, taskType, waitForCompletion, silent);
  } finally {
    if (releaseOnReturn) await lease.release();
  }
}

/**
 * 获取 MAA 版本信息
 */
export async function getMaaVersion(silent = false) {
  const result = await execMaaCommand('version', [], null, null, false, silent);
  const output = result.stdout;
  
  // 解析版本信息
  // 输出格式: "maa-cli v0.7.0\nMaaCore v6.2.3\n"
  const lines = output.trim().split('\n');
  const versions = {
    raw: output,
    cli: '',
    core: ''
  };
  
  for (const line of lines) {
    if (line.startsWith('maa-cli')) {
      versions.cli = line.replace('maa-cli', '').trim();
    } else if (line.startsWith('MaaCore')) {
      versions.core = line.replace('MaaCore', '').trim();
    }
  }
  
  return versions;
}

/**
 * 获取 MAA 配置目录
 */
export async function getMaaConfigDir() {
  const result = await execMaaCommand('dir', ['config']);
  return result.stdout;
}

/**
 * 获取配置文件路径
 */
export function validateMaaProfileName(profileName = 'default') {
  if (typeof profileName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(profileName)) {
    throw new Error('连接配置名称不合法');
  }
  return profileName;
}

async function getConfigPath(profileName = 'default') {
  const normalizedProfileName = validateMaaProfileName(profileName);
  const configDir = await getMaaConfigDir();
  const profilesDir = resolve(configDir.trim(), 'profiles');
  const configPath = resolve(profilesDir, `${normalizedProfileName}.toml`);
  if (dirname(configPath) !== profilesDir) {
    throw new Error('连接配置路径不合法');
  }
  return configPath;
}

export function parseMaaProfile(content) {
  return TOML.parse(String(content || ''));
}

export function mergeMaaProfileConnection(profileDocument = {}, config = {}) {
  if (!profileDocument || typeof profileDocument !== 'object' || Array.isArray(profileDocument)) {
    throw new TypeError('MAA profile 文档格式不合法');
  }

  const connectionUpdates = Object.prototype.hasOwnProperty.call(config, 'connection')
    ? config.connection
    : config;
  if (!connectionUpdates || typeof connectionUpdates !== 'object' || Array.isArray(connectionUpdates)) {
    throw new TypeError('connection 配置格式不合法');
  }

  const existingConnection = profileDocument.connection;
  if (existingConnection != null && (typeof existingConnection !== 'object' || Array.isArray(existingConnection))) {
    throw new TypeError('现有 connection section 格式不合法');
  }

  const normalizedUpdates = Object.fromEntries(
    Object.entries(connectionUpdates).filter(([, value]) => value !== undefined)
  );
  return {
    ...profileDocument,
    connection: {
      ...(existingConnection || {}),
      ...normalizedUpdates
    }
  };
}

/**
 * 读取配置文件
 */
export async function getConfig(profileName = 'default') {
  const normalizedProfileName = validateMaaProfileName(profileName);
  try {
    const configPath = await getConfigPath(normalizedProfileName);
    const content = await readFile(configPath, 'utf-8');
    const profile = parseMaaProfile(content);
    return profile.connection || profile;
  } catch {
    logger.debug('配置文件不存在，返回环境默认配置');
    return {
      adb_path: process.env.ADB_PATH || '/opt/homebrew/bin/adb',
      address: process.env.ADB_ADDRESS || '127.0.0.1:16384',
      config: 'CompatMac',
    };
  }
}

/**
 * 保存配置文件
 */
export async function saveConfig(profileName = 'default', config) {
  try {
    const normalizedProfileName = validateMaaProfileName(profileName);
    const configPath = await getConfigPath(normalizedProfileName);
    await mkdir(dirname(configPath), { recursive: true });

    let existingProfile = {};
    try {
      existingProfile = parseMaaProfile(await readFile(configPath, 'utf-8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const mergedProfile = mergeMaaProfileConnection(existingProfile, config);
    const tomlContent = TOML.stringify(mergedProfile);
    await writeFile(configPath, tomlContent, 'utf-8');
    logger.debug('配置已保存', { configPath });
  } catch (error) {
    throw new Error(`保存配置失败: ${error.message}`);
  }
}

/**
 * 创建临时任务文件并执行
 */
export async function execDynamicTask(taskId, taskConfig, taskName = null, taskType = null, waitForCompletion = false, userResource = false) {
  try {
    const configDir = await getMaaConfigDir();
    const tasksDir = join(configDir.trim(), 'tasks');
    
    // 确保 tasks 目录存在
    await mkdir(tasksDir, { recursive: true });
    
    // 生成临时任务文件名
    const tempTaskFile = join(tasksDir, `${taskId}_temp.toml`);
    
    // 将 taskConfig 转换为对象（如果是字符串则解析，如果已经是对象则直接使用）
    const configObj = typeof taskConfig === 'string' ? JSON.parse(taskConfig) : taskConfig;
    
    // 将配置对象转换为 TOML 格式
    const tomlContent = generateTaskToml(configObj);
    
    // 写入临时文件
    await writeFile(tempTaskFile, tomlContent, 'utf-8');
    addLog('INFO', `临时任务文件已创建: ${tempTaskFile}`);
    addLog('DEBUG', `任务内容:\n${tomlContent}`);
    
    // 执行任务
    const runArgs = [`${taskId}_temp`];
    if (userResource) runArgs.push('--user-resource');
    const result = await execMaaCommand('run', runArgs, taskName, taskType, waitForCompletion);
    
    return result;
  } catch (error) {
    addLog('ERROR', `执行动态任务失败: ${error.message}`);
    throw new Error(`执行动态任务失败: ${error.message}`);
  }
}

/**
 * 生成任务 TOML 内容
 */
function formatTomlValue(value) {
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`TOML 数值必须是有限数字: ${value}`);
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatTomlValue).join(', ')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, nestedValue]) => nestedValue !== undefined && nestedValue !== null && nestedValue !== '')
      .map(([nestedKey, nestedValue]) => `${JSON.stringify(nestedKey)} = ${formatTomlValue(nestedValue)}`);
    return `{ ${entries.join(', ')} }`;
  }
  throw new TypeError(`不支持的 TOML 参数类型: ${typeof value}`);
}

export function generateTaskToml(taskConfig) {
  let toml = '[[tasks]]\n';
  toml += `name = ${formatTomlValue(taskConfig.name)}\n`;
  toml += `type = ${formatTomlValue(taskConfig.type)}\n`;
  
  if (taskConfig.params && Object.keys(taskConfig.params).length > 0) {
    toml += '\n[tasks.params]\n';
    
    for (const [key, value] of Object.entries(taskConfig.params)) {
      if (value === undefined || value === null || value === '') continue;
      
      addLog('DEBUG', `处理参数 ${key}: ${typeof value} ${value}`);
      
      // 处理字符串形式的数组，如 "[4,5,6]"
      if (typeof value === 'string' && value.trim().startsWith('[') && value.trim().endsWith(']')) {
        try {
          // 移除空格并解析
          const cleanValue = value.trim();
          const arrayValue = JSON.parse(cleanValue);
          if (Array.isArray(arrayValue)) {
            addLog('DEBUG', `  -> 解析为数组: ${JSON.stringify(arrayValue)}`);
            toml += `${key} = ${formatTomlValue(arrayValue)}\n`;
            continue;
          }
        } catch (e) {
          addLog('ERROR', `解析数组失败 ${key}: ${value} - ${e.message}`);
          // 如果解析失败，继续按普通字符串处理
        }
      }
      
      toml += `${key} = ${formatTomlValue(value)}\n`;
    }
  }
  
  addLog('DEBUG', `生成的 TOML:\n${toml}`);
  return toml;
}

function validateAdbPath(adbPath) {
  if (typeof adbPath !== 'string' || !adbPath.trim()) {
    throw new Error('ADB 路径不能为空');
  }
  if (process.platform === 'win32' && /^[A-Za-z]:[\\/][^<>:"|?*\x00-\x1f]*$/.test(adbPath)) {
    return adbPath;
  }
  // 允许命令名或普通绝对/相对路径，拒绝 shell 元字符。
  if (!/^[\w@%+=:,./~-]+$/.test(adbPath)) {
    throw new Error('ADB 路径包含非法字符');
  }
  return adbPath;
}

function validateAdbAddress(address) {
  if (typeof address !== 'string' || !address.trim()) {
    throw new Error('ADB 地址不能为空');
  }
  // 常见形态：127.0.0.1:5555、192.168.1.2:5555、localhost:5555、emulator-5554
  if (!/^([a-zA-Z0-9_.-]+)(:\d{1,5})?$/.test(address)) {
    throw new Error('ADB 地址格式不合法');
  }
  return address;
}

async function adbExec(adbPath, args, options = {}) {
  validateAdbPath(adbPath);
  return execFilePromise(adbPath, args, {
    maxBuffer: 50 * 1024 * 1024,
    ...options
  });
}

function parseAdbDeviceList(output = '') {
  return String(output)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('List of devices attached'))
    .map(line => {
      const [address = '', state = 'unknown', ...attributes] = line.split(/\s+/);
      const metadata = Object.fromEntries(attributes
        .map(attribute => attribute.split(':', 2))
        .filter(([key, value]) => key && value));
      const details = [metadata.model, metadata.device, metadata.product]
        .filter(Boolean)
        .map(value => value.replace(/_/g, ' '))
        .join(' · ');

      return {
        address,
        state: ['device', 'offline', 'unauthorized'].includes(state) ? state : 'unknown',
        details: details || attributes.join(' '),
        source: 'adb'
      };
    })
    .filter(device => device.address);
}

export function getAdbDeviceState(output, address) {
  return parseAdbDeviceList(output).find(device => device.address === address)?.state || null;
}

function probeLocalAddress(address, timeout = 280) {
  const [host, portValue] = address.split(':');
  const port = Number(portValue);
  if (!host || !Number.isInteger(port)) return Promise.resolve(false);

  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    const complete = (reachable) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => complete(true));
    socket.once('timeout', () => complete(false));
    socket.once('error', () => complete(false));
  });
}

async function isRegularFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function findWindowsEmulatorSpec(processName = '') {
  const normalizedName = String(processName).toLowerCase();
  return WINDOWS_EMULATOR_PROCESSES.find(spec =>
    spec.names.some(name => name.toLowerCase() === normalizedName)
  );
}

async function getWindowsEmulatorProcesses() {
  if (process.platform !== 'win32') return [];

  const processFilter = WINDOWS_EMULATOR_PROCESSES
    .flatMap(spec => spec.names)
    .map(name => `Name='${name}'`)
    .join(' OR ');
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Get-CimInstance Win32_Process -Filter \"${processFilter}\"`,
    'Select-Object Name, ExecutablePath',
    'ConvertTo-Json -Compress'
  ].join(' | ');

  try {
    const { stdout } = await execFilePromise('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      command
    ], { timeout: 6000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const output = stdout.trim();
    if (!output) return [];
    const entries = JSON.parse(output);
    return (Array.isArray(entries) ? entries : [entries])
      .filter(entry => entry?.Name && entry?.ExecutablePath)
      .map(entry => ({
        name: String(entry.Name),
        executablePath: String(entry.ExecutablePath)
      }));
  } catch (error) {
    logger.debug('Windows 模拟器进程扫描失败', { error: error.message });
    return [];
  }
}

async function discoverWindowsEmulatorAdbs() {
  const processes = await getWindowsEmulatorProcesses();
  const seenPaths = new Set();
  const installations = [];

  for (const processInfo of processes) {
    const spec = findWindowsEmulatorSpec(processInfo.name);
    if (!spec) continue;

    // 模拟器进程可能在安装根目录或其 bin/shell 子目录中，检查两层即可避免扫描无关路径。
    const roots = [dirname(processInfo.executablePath), dirname(dirname(processInfo.executablePath))];
    for (const root of roots) {
      for (const adbFile of spec.adbFiles) {
        const adbPath = join(root, adbFile);
        const key = adbPath.toLowerCase();
        if (seenPaths.has(key) || !await isRegularFile(adbPath)) continue;
        seenPaths.add(key);
        installations.push({
          adbPath,
          label: spec.label,
          source: 'emulator-adb'
        });
      }
    }
  }

  return installations;
}

async function listDevicesFromAdb(adbPath, metadata = {}) {
  try {
    const { stdout } = await adbExec(adbPath, ['devices', '-l'], { timeout: 6000, windowsHide: true });
    return parseAdbDeviceList(stdout).map(device => ({
      ...device,
      adbPath,
      ...metadata,
      details: [
        metadata.source === 'emulator-adb' ? `${metadata.label} 内置 ADB` : '',
        device.details
      ].filter(Boolean).join(' · ')
    }));
  } catch (error) {
    logger.debug('读取模拟器内置 ADB 设备失败', { adbPath, error: error.message });
    return [];
  }
}

function mergeDiscoveredDevices(...deviceGroups) {
  const devicesByAddress = new Map();
  for (const device of deviceGroups.flat()) {
    const existing = devicesByAddress.get(device.address);
    // Preserve the configured ADB result when two servers report the same serial.
    if (!existing || (existing.source === 'emulator-adb' && device.source !== 'emulator-adb')) {
      devicesByAddress.set(device.address, device);
    }
  }
  return [...devicesByAddress.values()];
}

/**
 * Lists ADB-visible devices and reachable common local emulator ports.
 * On Windows, also locates ADB executables bundled with running emulators.
 * Candidates are not connected automatically; callers must confirm them.
 */
export async function discoverAdbDevices(adbPath = '/opt/homebrew/bin/adb') {
  let configuredAdbAvailable = true;
  try {
    await adbExec(adbPath, ['version']);
  } catch (error) {
    configuredAdbAvailable = false;
    logger.debug('当前 ADB 不可用，继续查找 Windows 模拟器内置 ADB', { adbPath, error: error.message });
  }

  try {
    const emulatorAdbs = await discoverWindowsEmulatorAdbs();
    if (!configuredAdbAvailable && emulatorAdbs.length === 0) {
      return {
        success: false,
        adbAvailable: false,
        message: 'ADB 不可用，请检查 ADB 路径或启动模拟器后重试',
        devices: [],
        candidates: [],
        adbInstallations: [],
        error: '未找到可用的 ADB'
      };
    }

    const configuredDevices = configuredAdbAvailable
      ? await listDevicesFromAdb(adbPath, { adbPath, label: '当前 ADB', source: 'adb' })
      : [];
    const emulatorDevices = await Promise.all(emulatorAdbs.map(installation =>
      listDevicesFromAdb(installation.adbPath, installation)
    ));
    const devices = mergeDiscoveredDevices(configuredDevices, emulatorDevices);
    const knownAddresses = new Set(devices.map(device => device.address));
    const reachable = await Promise.all(LOCAL_EMULATOR_ADDRESSES.map(async address => ({
      address,
      reachable: await probeLocalAddress(address)
    })));
    const candidates = reachable
      .filter(candidate => candidate.reachable && !knownAddresses.has(candidate.address))
      .map(candidate => ({
        address: candidate.address,
        state: 'candidate',
        details: '发现可尝试连接的本机模拟器端口',
        source: 'local-port'
      }));

    const count = devices.length + candidates.length;
    const installationNote = emulatorAdbs.length && count === 0
      ? `，已发现 ${emulatorAdbs.length} 个模拟器内置 ADB`
      : '';
    return {
      success: true,
      adbAvailable: true,
      message: count ? `找到 ${count} 个设备或可尝试地址` : `未找到已连接的模拟器${installationNote}`,
      devices,
      candidates,
      adbInstallations: emulatorAdbs
    };
  } catch (error) {
    return {
      success: false,
      adbAvailable: true,
      message: '查找设备失败',
      devices: [],
      candidates: [],
      error: error.message
    };
  }
}

export async function getGameClientState(
  adbPath = '/opt/homebrew/bin/adb',
  address = '127.0.0.1:16384',
  clientType = 'Official'
) {
  validateAdbPath(adbPath);
  validateAdbAddress(address);

  const expectedPackage = GAME_PACKAGES[clientType] || GAME_PACKAGES.Official;
  const { stdout } = await adbExec(adbPath, ['-s', address, 'shell', 'dumpsys', 'window']);
  const foregroundPackage = parseForegroundPackage(stdout);

  return {
    running: foregroundPackage === expectedPackage,
    expectedPackage,
    foregroundPackage
  };
}

export function parseForegroundPackage(output = '') {
  const lines = String(output).split('\n');
  const focusLine = lines.find(line => line.includes('mCurrentFocus'))
    || lines.find(line => line.includes('mFocusedApp'))
    || '';
  const packageMatch = focusLine.match(/\s([A-Za-z0-9_.]+)\/[A-Za-z0-9_.$]+/);
  return packageMatch?.[1] || null;
}

/**
 * 测试 ADB 连接
 */
export async function testAdbConnection(adbPath = '/opt/homebrew/bin/adb', address = '127.0.0.1:16384') {
  try {
    // 检查 ADB 是否可用
    try {
      await adbExec(adbPath, ['version'], { timeout: 5000, windowsHide: true });
    } catch (error) {
      return {
        success: false,
        message: `ADB 不可用，请检查 ADB 路径：${error.message}`,
        error: error.message
      };
    }
    
    // 检查设备列表
    validateAdbAddress(address);
    const { stdout: devicesOutput } = await adbExec(adbPath, ['devices'], { timeout: 6000, windowsHide: true });
    const deviceState = getAdbDeviceState(devicesOutput, address);
    
    if (deviceState === 'device') {
      return {
        success: true,
        message: `已连接到 ${address}`,
        connected: true
      };
    }

    if (deviceState === 'unauthorized') {
      return {
        success: false,
        message: `设备 ${address} 未授权，请在模拟器中允许 USB 调试`,
        connected: false
      };
    }

    if (deviceState === 'offline') {
      return {
        success: false,
        message: `设备 ${address} 已离线，请重启模拟器或 ADB`,
        connected: false
      };
    }
    
    // 尝试连接
    logger.debug('尝试连接设备', { address });
    const { stdout: connectOutput } = await adbExec(adbPath, ['connect', address], { timeout: 8000, windowsHide: true });
    
    // 等待连接稳定
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 再次检查连接状态
    const { stdout: devicesOutput2 } = await adbExec(adbPath, ['devices'], { timeout: 6000, windowsHide: true });
    const currentDeviceState = getAdbDeviceState(devicesOutput2, address);
    
    if (currentDeviceState === 'device') {
      return {
        success: true,
        message: `成功连接到 ${address}`,
        connected: true
      };
    }

    const stateMessage = currentDeviceState === 'unauthorized'
      ? `设备 ${address} 未授权，请在模拟器中允许 USB 调试`
      : currentDeviceState === 'offline'
        ? `设备 ${address} 已离线，请重启模拟器或 ADB`
        : `无法连接到 ${address}，请确保模拟器已启动`;
    return {
      success: false,
      message: stateMessage,
      connected: false,
      output: connectOutput
    };
  } catch (error) {
    return {
      success: false,
      message: `连接测试失败：${error.message}`,
      error: error.message
    };
  }
}

/**
 * 通过 ADB 截取模拟器屏幕
 */
export async function captureScreen(adbPath = '/opt/homebrew/bin/adb', address = '127.0.0.1:16384') {
  try {
    validateAdbPath(adbPath);
    validateAdbAddress(address);

    // 先检查设备是否已连接
    const { stdout: devicesOutput } = await adbExec(adbPath, ['devices']);
    const isConnected = devicesOutput.includes(address);
    
    if (!isConnected) {
      logger.debug('设备未连接，尝试连接', { address });
      const { stdout: connectOutput, stderr: connectError } = await adbExec(adbPath, ['connect', address]);
      logger.debug('连接结果', { output: connectOutput });
      
      if (connectError) {
        logger.warn('连接警告', { error: connectError });
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    logger.debug('执行截图命令', { adbPath, address });
    const { stdout, stderr } = await adbExec(adbPath, ['-s', address, 'exec-out', 'screencap', '-p'], {
      encoding: 'buffer'
    });
    
    if (stderr && stderr.length) {
      logger.warn('截图警告', { error: stderr.toString() });
    }
    
    return {
      image: Buffer.from(stdout).toString('base64'),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    throw new Error(`截图失败: ${error.message}`);
  }
}

/**
 * 活动代号缓存
 */
const ACTIVITY_CACHE_TTL = 24 * 60 * 60 * 1000;
const activityCache = new Map();

function cacheActivity(clientType, activity) {
  const cached = {
    ...activity,
    timestamp: Date.now(),
    ttl: ACTIVITY_CACHE_TTL
  };
  activityCache.set(clientType, cached);
  void saveUserConfig('activity-cache', { [clientType]: cached });
  return { ...activity };
}

function getValidCachedActivity(clientType, cachedActivity, now = Date.now()) {
  if (!cachedActivity?.code || !cachedActivity.timestamp) return null;
  const ttlExpiresAt = cachedActivity.timestamp + (cachedActivity.ttl || ACTIVITY_CACHE_TTL);
  const expiresAt = cachedActivity.endTime
    ? Math.min(ttlExpiresAt, cachedActivity.endTime)
    : ttlExpiresAt;
  if (now >= expiresAt) return null;
  return {
    code: cachedActivity.code,
    name: cachedActivity.name,
    source: cachedActivity.source,
    startTime: cachedActivity.startTime,
    endTime: cachedActivity.endTime,
    stages: cachedActivity.stages
  };
}

/**
 * 获取当前活动代号和名称
 */
export async function getCurrentActivity(clientType = 'Official') {
  const now = Date.now();
  const cachedActivity = activityCache.get(clientType);
  const cached = getValidCachedActivity(clientType, cachedActivity, now);
  if (cached) {
      logger.debug('使用缓存的活动信息', {
        clientType, code: cached.code, name: cached.name, source: cached.source
      });
    return cached;
  }
  if (cachedActivity) {
    activityCache.delete(clientType);
  }

  const persistedResult = await loadUserConfig('activity-cache');
  const persisted = getValidCachedActivity(clientType, persistedResult.success ? persistedResult.data?.[clientType] : null, now);
  if (persisted) {
    activityCache.set(clientType, { ...persisted, timestamp: persistedResult.data[clientType].timestamp, ttl: persistedResult.data[clientType].ttl || ACTIVITY_CACHE_TTL });
    logger.debug('使用持久化活动缓存', { clientType, code: persisted.code, name: persisted.name, source: persisted.source });
    return persisted;
  }

  try {
    // 获取活动信息
    const result = await execMaaCommand('activity', [clientType], null, null, false, true);
    const output = result.stdout;
    
    logger.debug('maa activity 原始输出', { output });
    
    let activityName = null;
    let activityCode = null;
    
    // 提取活动名称（从「」中提取）
    const nameMatch = output.match(/「([^」]+)」/);
    if (nameMatch && nameMatch[1]) {
      activityName = nameMatch[1];
    }
    
    // 尝试多种解析方式提取代号
    // 方式1: 匹配 (XX-数字) 格式
    let match = output.match(/\(([A-Z]{2,3})-\d+/i);
    
    // 方式2: 匹配 XX-数字 格式（不在括号内）
    if (!match) {
      match = output.match(/([A-Z]{2,3})-\d+/i);
    }
    
    // 方式3: 匹配 SideStory 后面的内容
    if (!match) {
      match = output.match(/SideStory[:\s]+.*?([A-Z]{2,3})-\d+/i);
    }
    
    // 方式4: 匹配任何 2-3 个大写字母后跟 -数字 的模式
    if (!match) {
      const allMatches = output.match(/\b([A-Z]{2,3})-\d+\b/gi);
      if (allMatches && allMatches.length > 0) {
        // 取第一个匹配
        const firstMatch = allMatches[0];
        match = [firstMatch, firstMatch.split('-')[0]];
      }
    }
    
    if (match && match[1]) {
      activityCode = match[1].toUpperCase();
      logger.debug('获取到活动信息', { code: activityCode, name: activityName });
      return cacheActivity(clientType, {
        code: activityCode,
        name: activityName,
        source: 'maa',
        startTime: null,
        endTime: null,
        stages: []
      });
    }

    logger.debug('MAA 活动表未返回当前活动，尝试备用数据源');
  } catch (error) {
    logger.warn('获取 MAA 活动信息失败，尝试备用数据源', { error: error.message });
  }

  try {
    const fallbackActivity = await getFallbackActivity(clientType);
    if (fallbackActivity?.code) {
      logger.info('从备用数据源获取到活动信息', fallbackActivity);
      return cacheActivity(clientType, fallbackActivity);
    }
  } catch (error) {
    logger.warn('备用活动数据源不可用', { error: error.message });
  }

  return { code: null, name: null, source: null, startTime: null, endTime: null, stages: [] };
}

/**
 * 替换关卡代号中的 hd 为实际活动代号
 */
export async function replaceActivityCode(stage, clientType = 'Official') {
  if (!stage || typeof stage !== 'string') {
    return stage;
  }
  
  // 检查是否是 hd-数字 格式（不区分大小写）
  const hdMatch = stage.match(/^hd-(\d+)$/i);
  if (!hdMatch) {
    return stage;
  }
  
  const stageNumber = hdMatch[1];
  const activityInfo = await getCurrentActivity(clientType);
  
  if (activityInfo.code) {
    const realStage = `${activityInfo.code}-${stageNumber}`;
    logger.debug('关卡代号替换', { original: stage, replaced: realStage });
    return realStage;
  }
  
  logger.warn('无法获取活动代号，保持原关卡代号', { stage });
  return stage;
}

/**
 * 终止当前正在运行的任务
 */
export function stopCurrentTask() {
  if (!taskStatus.isRunning) {
    return { success: false, message: '当前没有正在运行的任务' };
  }
  
  if (taskStatus.process) {
    logger.warn('终止任务', { taskName: taskStatus.taskName });
    addLog('WARN', `正在终止任务: ${taskStatus.taskName}`);
    
    try {
      const runningProcess = taskStatus.process;
      const sendSignal = (signal) => {
        if (process.platform !== 'win32' && runningProcess.pid) {
          try {
            process.kill(-runningProcess.pid, signal);
            return;
          } catch (error) {
            if (error?.code !== 'ESRCH') throw error;
          }
        }
        runningProcess.kill(signal);
      };

      logger.warn('使用 SIGTERM 请求任务正常退出');
      addLog('WARN', '正在请求任务正常退出');
      sendSignal('SIGTERM');

      const forceKillTimer = setTimeout(() => {
        if (taskStatus.process !== runningProcess || runningProcess.exitCode !== null) return;
        try {
          logger.warn('任务未及时退出，升级为 SIGKILL');
          addLog('WARN', '任务未及时退出，正在强制终止');
          sendSignal('SIGKILL');
        } catch (error) {
          logger.error('强制终止任务失败', { error: error.message });
        }
      }, 3000);
      forceKillTimer.unref?.();

      return { success: true, message: '已发送终止请求' };
    } catch (error) {
      logger.error('终止任务失败', { error: error.message });
      addLog('ERROR', `终止任务失败: ${error.message}`);
      setTaskStatus(false);
      return { success: false, message: `终止失败: ${error.message}` };
    }
  } else {
    // 进程引用不存在，但状态显示正在运行
    // 这种情况可能是任务刚启动还没有进程引用
    addLog('WARN', '任务正在启动中，无法立即终止');
    setTaskStatus(false);
    return { success: true, message: '任务正在启动中，已标记为停止' };
  }
}

/**
 * 获取 MAA 日志目录
 */
export async function getMaaLogDir() {
  try {
    const result = await execMaaCommand('dir', ['log'], null, null, false, true);
    return result.stdout.trim();
  } catch (error) {
    throw new Error(`获取日志目录失败: ${error.message}`);
  }
}

export async function createMaaLogCheckpoint() {
  try {
    const logPath = join(await getMaaLogDir(), 'asst.log');
    const logStats = await stat(logPath);
    return { logPath, size: logStats.size };
  } catch (error) {
    logger.debug('无法创建 Maa 日志检查点', { error: error.message });
    return null;
  }
}

export async function readMaaLogSince(checkpoint, maxBytes = 2 * 1024 * 1024) {
  if (!checkpoint?.logPath) return '';

  try {
    const logStats = await stat(checkpoint.logPath);
    if (logStats.size <= checkpoint.size) return '';

    const availableBytes = logStats.size - checkpoint.size;
    const bytesToRead = Math.min(availableBytes, maxBytes);
    const start = logStats.size - bytesToRead;
    const buffer = Buffer.alloc(bytesToRead);
    const handle = await open(checkpoint.logPath, 'r');
    try {
      await handle.read(buffer, 0, bytesToRead, start);
    } finally {
      await handle.close();
    }
    return buffer.toString('utf-8');
  } catch (error) {
    logger.debug('无法读取 Maa 增量日志', { error: error.message });
    return '';
  }
}

/**
 * 获取日志文件列表
 */
export async function getLogFiles() {
  try {
    const logDir = await getMaaLogDir();
    
    // 递归读取日志目录
    const files = [];
    
    async function scanDir(dir, prefix = '') {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name);
        } else if (entry.name.endsWith('.log')) {
          const stats = await stat(fullPath);
          files.push({
            name: prefix ? `${prefix}/${entry.name}` : entry.name,
            path: fullPath,
            size: stats.size,
            modified: stats.mtime.toISOString()
          });
        }
      }
    }
    
    await scanDir(logDir);
    
    // 按修改时间倒序排序
    files.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    
    return files;
  } catch (error) {
    logger.error('获取日志文件列表失败', { error: error.message });
    return [];
  }
}

/**
 * 手动清理日志文件
 */
export async function cleanupLogs(maxSizeMB = 10) {
  try {
    const sizeLimit = Number(maxSizeMB);
    if (!Number.isFinite(sizeLimit) || sizeLimit < 1 || sizeLimit > 1024) {
      throw new Error('日志保留上限必须在 1 到 1024 MB 之间');
    }

    const logDir = await getMaaLogDir();
    const files = [];
    
    async function scanDir(dir, prefix = '') {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name);
        } else if (entry.name.endsWith('.log')) {
          const stats = await stat(fullPath);
          files.push({
            name: prefix ? `${prefix}/${entry.name}` : entry.name,
            path: fullPath,
            size: stats.size,
            modified: stats.mtime.toISOString()
          });
        }
      }
    }
    
    await scanDir(logDir);
    files.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    
    const maxSize = sizeLimit * 1024 * 1024;
    let totalSize = 0;
    const filesToDelete = [];
    
    for (const file of files) {
      totalSize += file.size;
      if (totalSize > maxSize) {
        filesToDelete.push(file);
      }
    }
    
    for (const file of filesToDelete) {
      await unlink(file.path);
    }
    
    return {
      deletedCount: filesToDelete.length,
      freedSpace: filesToDelete.reduce((sum, f) => sum + f.size, 0)
    };
  } catch (error) {
    throw new Error(`清理日志失败: ${error.message}`);
  }
}

/**
 * 读取日志文件内容
 */
export async function readLogFile(filePath, lines = 1000) {
  try {
    const logDir = await realpath(resolve(await getMaaLogDir()));
    const requestedPath = await realpath(resolve(filePath));
    const relativePath = relative(logDir, requestedPath);
    const isOutsideLogDir = relativePath === '..'
      || relativePath.startsWith(`..${sep}`)
      || isAbsolute(relativePath);

    if (!relativePath || isOutsideLogDir || extname(requestedPath).toLowerCase() !== '.log') {
      throw new Error('只能读取 MAA 日志目录内的文件');
    }
    const content = await readFile(requestedPath, 'utf-8');
    const allLines = content.split('\n');
    
    // 只返回最后 N 行
    const startIndex = Math.max(0, allLines.length - lines);
    const selectedLines = allLines.slice(startIndex);
    
    return {
      content: selectedLines.join('\n'),
      totalLines: allLines.length,
      returnedLines: selectedLines.length
    };
  } catch (error) {
    throw new Error(`读取日志文件失败: ${error.message}`);
  }
}

/**
 * 获取 MAA 调试截图列表
 */
export async function getDebugScreenshots() {
  try {
    const configDir = await getMaaConfigDir();
    const debugDir = join(configDir.trim(), '..', 'debug');
    
    logger.debug('调试目录', { debugDir });
    
    // 读取 debug 目录下的所有文件
    const files = await readdir(debugDir);
    
    // 筛选图片文件
    const imageFiles = files.filter(file => 
      file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')
    );
    
    // 获取文件信息
    const screenshots = await Promise.all(
      imageFiles.map(async (file) => {
        const filePath = join(debugDir, file);
        const stats = await stat(filePath);
        return {
          name: file,
          path: filePath,
          size: stats.size,
          modified: stats.mtime.toISOString()
        };
      })
    );
    
    // 按修改时间倒序排序
    screenshots.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    
    return screenshots;
  } catch (error) {
    logger.error('获取调试截图失败', { error: error.message });
    return [];
  }
}
