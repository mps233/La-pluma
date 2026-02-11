import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { createLogger } from '../utils/logger.js';

const execPromise = promisify(exec);

// 创建日志记录器
const logger = createLogger('MaaService');

// MAA CLI 路径
// Docker 环境使用完整路径，本地环境使用 'maa' 依赖 PATH
const MAA_CLI_PATH = process.env.MAA_CLI_PATH || (process.env.DOCKER_ENV ? '/usr/local/bin/maa' : 'maa');

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

/**
 * 添加日志到缓存
 */
function addLog(level, message) {
  taskStatus.logs.push({
    time: new Date().toISOString(),
    level: level,
    message: message
  });
  // 使用结构化日志，不再使用 console.log
  const logLevel = level.toLowerCase();
  if (logger[logLevel]) {
    logger[logLevel](message);
  } else {
    logger.info(message);
  }
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
export async function execMaaCommand(command, args = [], taskName = null, taskType = null, waitForCompletion = false, silent = false) {
  const fullCommand = `${MAA_CLI_PATH} ${command} ${args.join(' ')}`;
  
  // 静默模式下不输出日志（用于健康检查等频繁调用）
  if (!silent) {
    addLog('INFO', `执行命令: ${fullCommand}, 等待完成: ${waitForCompletion}`);
  }
  
  // 如果有任务名称且不需要等待完成，使用后台异步执行
  if (taskName && !waitForCompletion) {
    return new Promise((resolve, reject) => {
      // 使用 spawn 而不是 exec，这样可以独立运行
      const childProcess = spawn(MAA_CLI_PATH, [command, ...args], {
        detached: false,
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
          taskStatus.logs.push({
            time: new Date().toISOString(),
            level: 'INFO',
            message: line.trim()
          });
        });
      });
      
      childProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        
        // 将错误输出按行分割并添加到日志
        const lines = text.split('\n').filter(line => line.trim());
        lines.forEach(line => {
          const level = line.includes('ERROR') ? 'ERROR' : line.includes('WARN') ? 'WARN' : 'INFO';
          taskStatus.logs.push({
            time: new Date().toISOString(),
            level: level,
            message: line.trim()
          });
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
          addLog('WARN', `stderr: ${stderr.trim()}`);
        }
        
        // 任务完成，清除状态
        setTaskStatus(false);
        
        if (code !== 0) {
          addLog('ERROR', `命令执行失败: ${fullCommand}`);
        }
      });
      
      childProcess.on('error', (error) => {
        addLog('ERROR', `命令执行错误: ${fullCommand} - ${error.message}`);
        setTaskStatus(false);
      });
    });
  } 
  // 需要等待完成（任务流程中的串行执行）
  else if (taskName && waitForCompletion) {
    return new Promise((resolve, reject) => {
      const childProcess = spawn(MAA_CLI_PATH, [command, ...args], {
        detached: false,
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
          taskStatus.logs.push({
            time: new Date().toISOString(),
            level: 'INFO',
            message: line.trim()
          });
        });
      });
      
      childProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        
        const lines = text.split('\n').filter(line => line.trim());
        lines.forEach(line => {
          const level = line.includes('ERROR') ? 'ERROR' : line.includes('WARN') ? 'WARN' : 'INFO';
          taskStatus.logs.push({
            time: new Date().toISOString(),
            level: level,
            message: line.trim()
          });
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
          addLog('WARN', `stderr: ${stderr.trim()}`);
        }
        
        // 任务完成，清除状态
        setTaskStatus(false);
        
        if (code !== 0) {
          addLog('ERROR', `命令执行失败: ${fullCommand}`);
          reject(new Error(`命令执行失败，退出码: ${code}`));
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
      const { stdout, stderr } = await execPromise(fullCommand, {
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

/**
 * 获取 MAA 版本信息
 */
export async function getMaaVersion(silent = false) {
  const result = await execMaaCommand('version', [], false, silent);
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
 * 列出所有可用任务
 */
export async function listMaaTasks() {
  const result = await execMaaCommand('list');
  return result.stdout;
}

/**
 * 获取配置文件路径
 */
async function getConfigPath(profileName = 'default') {
  const configDir = await getMaaConfigDir();
  return join(configDir.trim(), 'profiles', `${profileName}.toml`);
}

/**
 * 读取配置文件
 */
export async function getConfig(profileName = 'default') {
  try {
    const configPath = await getConfigPath(profileName);
    const content = await readFile(configPath, 'utf-8');
    // 简单解析 TOML (实际项目中应使用 toml 库)
    return parseSimpleToml(content);
  } catch (error) {
    logger.debug('配置文件不存在，返回默认配置');
    return {
      adb_path: 'adb',
      address: '127.0.0.1:5555',
      config: 'CompatMac',
    };
  }
}

/**
 * 保存配置文件
 */
export async function saveConfig(profileName = 'default', config) {
  try {
    const configDir = await getMaaConfigDir();
    const profilesDir = join(configDir.trim(), 'profiles');
    
    // 确保目录存在
    await mkdir(profilesDir, { recursive: true });
    
    const configPath = join(profilesDir, `${profileName}.toml`);
    const tomlContent = generateToml(config);
    
    await writeFile(configPath, tomlContent, 'utf-8');
    logger.debug('配置已保存', { configPath });
  } catch (error) {
    throw new Error(`保存配置失败: ${error.message}`);
  }
}

/**
 * 简单的 TOML 解析器 (仅用于演示)
 */
function parseSimpleToml(content) {
  const config = {};
  const lines = content.split('\n');
  let currentSection = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1);
      config[currentSection] = {};
    } else if (trimmed.includes('=')) {
      const [key, value] = trimmed.split('=').map(s => s.trim());
      const cleanValue = value.replace(/^["']|["']$/g, '');
      if (currentSection) {
        config[currentSection][key] = cleanValue;
      } else {
        config[key] = cleanValue;
      }
    }
  }
  
  return config.connection || config;
}

/**
 * 生成 TOML 内容
 */
function generateToml(config) {
  let toml = '[connection]\n';
  
  if (config.connection) {
    for (const [key, value] of Object.entries(config.connection)) {
      toml += `${key} = "${value}"\n`;
    }
  } else {
    for (const [key, value] of Object.entries(config)) {
      toml += `${key} = "${value}"\n`;
    }
  }
  
  return toml;
}

/**
 * 创建临时任务文件并执行
 */
export async function execDynamicTask(taskId, taskConfig, taskName = null, taskType = null, waitForCompletion = false) {
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
    const result = await execMaaCommand('run', [`${taskId}_temp`], taskName, taskType, waitForCompletion);
    
    return result;
  } catch (error) {
    addLog('ERROR', `执行动态任务失败: ${error.message}`);
    throw new Error(`执行动态任务失败: ${error.message}`);
  }
}

/**
 * 生成任务 TOML 内容
 */
function generateTaskToml(taskConfig) {
  let toml = '[[tasks]]\n';
  toml += `name = "${taskConfig.name}"\n`;
  toml += `type = "${taskConfig.type}"\n`;
  
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
            toml += `${key} = [${arrayValue.join(', ')}]\n`;
            continue;
          }
        } catch (e) {
          addLog('ERROR', `解析数组失败 ${key}: ${value} - ${e.message}`);
          // 如果解析失败，继续按普通字符串处理
        }
      }
      
      if (typeof value === 'boolean') {
        toml += `${key} = ${value}\n`;
      } else if (typeof value === 'number') {
        toml += `${key} = ${value}\n`;
      } else if (Array.isArray(value)) {
        // 处理数组中的字符串和数字
        const formattedArray = value.map(v => 
          typeof v === 'string' ? `"${v}"` : v
        ).join(', ');
        toml += `${key} = [${formattedArray}]\n`;
      } else {
        toml += `${key} = "${value}"\n`;
      }
    }
  }
  
  addLog('DEBUG', `生成的 TOML:\n${toml}`);
  return toml;
}

/**
 * 测试 ADB 连接
 */
export async function testAdbConnection(adbPath = '/opt/homebrew/bin/adb', address = '127.0.0.1:16384') {
  try {
    // 检查 ADB 是否可用
    try {
      await execPromise(`${adbPath} version`);
    } catch (error) {
      return {
        success: false,
        message: 'ADB 不可用，请检查 ADB 路径是否正确',
        error: error.message
      };
    }
    
    // 检查设备列表
    const { stdout: devicesOutput } = await execPromise(`${adbPath} devices`);
    const isConnected = devicesOutput.includes(address) && devicesOutput.includes('device');
    
    if (isConnected) {
      return {
        success: true,
        message: `已连接到 ${address}`,
        connected: true
      };
    }
    
    // 尝试连接
    logger.debug('尝试连接设备', { address });
    const { stdout: connectOutput } = await execPromise(`${adbPath} connect ${address}`);
    
    // 等待连接稳定
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 再次检查连接状态
    const { stdout: devicesOutput2 } = await execPromise(`${adbPath} devices`);
    const isConnectedNow = devicesOutput2.includes(address) && devicesOutput2.includes('device');
    
    if (isConnectedNow) {
      return {
        success: true,
        message: `成功连接到 ${address}`,
        connected: true
      };
    } else {
      return {
        success: false,
        message: `无法连接到 ${address}，请确保模拟器已启动`,
        connected: false,
        output: connectOutput
      };
    }
  } catch (error) {
    return {
      success: false,
      message: '连接测试失败',
      error: error.message
    };
  }
}

/**
 * 通过 ADB 截取模拟器屏幕
 */
export async function captureScreen(adbPath = '/opt/homebrew/bin/adb', address = '127.0.0.1:16384') {
  try {
    // 先检查设备是否已连接
    const checkCommand = `${adbPath} devices`;
    const { stdout: devicesOutput } = await execPromise(checkCommand);
    
    // 检查设备是否在列表中
    const isConnected = devicesOutput.includes(address);
    
    if (!isConnected) {
      logger.debug('设备未连接，尝试连接', { address });
      // 尝试连接设备
      const connectCommand = `${adbPath} connect ${address}`;
      const { stdout: connectOutput, stderr: connectError } = await execPromise(connectCommand);
      logger.debug('连接结果', { output: connectOutput });
      
      if (connectError) {
        logger.warn('连接警告', { error: connectError });
      }
      
      // 等待连接稳定
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 使用 adb screencap 命令截图并转换为 base64
    const command = `${adbPath} -s ${address} exec-out screencap -p | base64`;
    logger.debug('执行截图命令', { command });
    
    const { stdout, stderr } = await execPromise(command, {
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for screenshot
      encoding: 'utf-8'
    });
    
    if (stderr) {
      logger.warn('截图警告', { error: stderr });
    }
    
    // 返回 base64 编码的图片
    return {
      image: stdout.trim(),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    throw new Error(`截图失败: ${error.message}`);
  }
}

/**
 * 活动代号缓存
 */
let activityCache = {
  code: null,
  name: null,
  timestamp: null,
  ttl: 24 * 60 * 60 * 1000 // 24小时缓存
};

/**
 * 获取当前活动代号和名称
 */
export async function getCurrentActivity(clientType = 'Official') {
  try {
    // 检查缓存是否有效
    if (activityCache.code && activityCache.timestamp) {
      const now = Date.now();
      if (now - activityCache.timestamp < activityCache.ttl) {
        logger.debug('使用缓存的活动信息', { code: activityCache.code, name: activityCache.name });
        return { code: activityCache.code, name: activityCache.name };
      }
    }
    
    // 获取活动信息
    const result = await execMaaCommand('activity', [clientType]);
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
      
      // 更新缓存
      activityCache.code = activityCode;
      activityCache.name = activityName;
      activityCache.timestamp = Date.now();
      
      return { code: activityCode, name: activityName };
    }
    
    logger.debug('未找到活动代号，可能当前没有活动');
    return { code: null, name: null };
  } catch (error) {
    logger.error('获取活动信息失败', { error: error.message });
    // 如果获取失败，返回缓存的信息（如果有）
    return { code: activityCache.code || null, name: activityCache.name || null };
  }
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
      // 直接使用 SIGKILL 强制终止，不等待
      logger.warn('使用 SIGKILL 强制终止进程');
      addLog('WARN', '使用 SIGKILL 强制终止进程');
      taskStatus.process.kill('SIGKILL');
      
      setTaskStatus(false);
      return { success: true, message: '已强制终止任务' };
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
    const result = await execMaaCommand('dir', ['log']);
    return result.stdout.trim();
  } catch (error) {
    throw new Error(`获取日志目录失败: ${error.message}`);
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
    
    // 清理旧日志文件，只保留最新的10MB
    await cleanupOldLogs(files);
    
    return files;
  } catch (error) {
    logger.error('获取日志文件列表失败', { error: error.message });
    return [];
  }
}

/**
 * 清理旧日志文件，只保留最新的10MB
 */
async function cleanupOldLogs(files) {
  const maxSize = 10 * 1024 * 1024; // 10MB
  let totalSize = 0;
  const filesToDelete = [];
  
  for (const file of files) {
    totalSize += file.size;
    if (totalSize > maxSize) {
      filesToDelete.push(file);
    }
  }
  
  // 删除超出限制的文件
  for (const file of filesToDelete) {
    try {
      await unlink(file.path);
      addLog('INFO', `已删除旧日志文件: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
    } catch (error) {
      logger.error('删除日志文件失败', { path: file.path, error: error.message });
    }
  }
  
  if (filesToDelete.length > 0) {
    addLog('INFO', `日志清理完成，删除了 ${filesToDelete.length} 个文件，释放 ${(filesToDelete.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(2)} MB`);
  }
}

/**
 * 手动清理日志文件
 */
export async function cleanupLogs(maxSizeMB = 10) {
  try {
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
    
    const maxSize = maxSizeMB * 1024 * 1024;
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
    const content = await readFile(filePath, 'utf-8');
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
