import { asErrorWithCode, getErrorCode, getErrorDetails, getErrorMessage, getErrorStatus, isRecord } from '../utils/errors.ts';
import type { ErrorWithCode } from '../utils/errors.ts';
import { spawn, execFile } from 'child_process';
import type { ChildProcess } from 'child_process';
import { promisify } from 'util';
import { createConnection } from 'net';
import { readFile, writeFile, mkdir, readdir, stat, unlink, realpath, open } from 'fs/promises';
import type { Dirent } from 'fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { randomBytes } from 'crypto';
import TOML from '@iarna/toml';
import { createLogger } from '../utils/logger.ts';
import type { LogEntry, LogLevel } from '../utils/logger.ts';
import { getFallbackActivity } from './activityFallbackService.ts';
import { getStageActivityInfo } from './activityDataService.ts';
import { listMaaActivityStageCodes } from './maaResourceDataService.ts';
import { acquireMaaExecutionLease } from './executionCoordinatorService.ts';
import { getCurrentAgentRun } from './agentRunService.ts';
import { loadUserConfig, saveUserConfig } from './configStorageService.ts';
import { DEFAULT_ADB_ADDRESS, DEFAULT_ADB_PATH, DEFAULT_CLIENT_TYPE, DEFAULT_MAA_CLI_PATH } from '../config/connectionDefaults.ts';

const execFilePromise = promisify(execFile);

// 创建日志记录器
const logger = createLogger('MaaService');

/** 配置查询等短命令的硬超时，避免 CLI 卡死拖住 HTTP 请求。 */
export const MAA_CLI_EXEC_TIMEOUT_MS = 15_000;
/** Core 安装/更新的默认长超时：真实慢下载应在 15 分钟量级内完成。 */
export const DEFAULT_MAA_MAINTENANCE_TIMEOUT_MS = 900_000;
/** 维护命令超时上限，防止环境配置无限等待。 */
export const MAX_MAA_MAINTENANCE_TIMEOUT_MS = 3_600_000;

/** 解析并收敛 LA_PLUMA_MAA_MAINTENANCE_TIMEOUT_MS；非法值回退默认。 */
export function resolveMaaMaintenanceTimeoutMs(raw: string | undefined): number {
  const parsed = Number(String(raw ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAA_MAINTENANCE_TIMEOUT_MS;
  return Math.min(Math.trunc(parsed), MAX_MAA_MAINTENANCE_TIMEOUT_MS);
}

const MAA_MAINTENANCE_TIMEOUT_MS = resolveMaaMaintenanceTimeoutMs(
  process.env.LA_PLUMA_MAA_MAINTENANCE_TIMEOUT_MS
);

interface TaskStatus {
  isRunning: boolean;
  taskName: string | null;
  startTime: number | null;
  taskType: string | null;
  currentStage: string | null;
  currentStep: number | null;
  totalSteps: number | null;
  process: ChildProcess | null;
  stopRequested: boolean;
  forceKillTimer: NodeJS.Timeout | null;
  logs: LogEntry[];
}

interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  command: string;
  exitCode?: number | null;
  signal?: string | null;
  message?: string;
}

interface CommandOutcome {
  ok: boolean;
  stopped: boolean;
  stopRequested: boolean;
  result: CommandExecutionResult;
  error: ErrorWithCode | null;
}

interface MaaCommandLifecycle {
  runId?: string;
  onStarted?: (context?: unknown) => unknown;
  onSettled?: (outcome: CommandOutcome) => unknown;
}

interface DynamicTaskRuntime {
  acquireExecutionLease?: (owner: Record<string, unknown>) => Promise<{ release(): Promise<void> }>;
  getConfigDir?: () => Promise<string>;
  mkdir?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>;
  writeFile?: (path: string, content: string, encoding?: string) => Promise<unknown>;
  unlink?: (path: string) => Promise<unknown>;
  executeCommand?: (...args: unknown[]) => Promise<CommandExecutionResult>;
  createNonce?: () => string;
  lifecycle?: MaaCommandLifecycle;
  shouldAbort?: () => boolean;
  clientType?: string;
}


interface AdbDevice {
  address: string;
  state: string;
  details: string;
  source: string;
  adbPath?: string;
  label?: string;
}

interface AdbInstallation {
  adbPath: string;
  label: string;
  source: string;
}

interface EmulatorProcess {
  name: string;
  executablePath: string;
}

interface AdbDiscoveryResult {
  success: boolean;
  adbAvailable: boolean;
  message: string;
  devices: AdbDevice[];
  candidates: AdbDevice[];
  adbInstallations?: AdbInstallation[];
  error?: string;
}


interface AdbConnectionResult {
  success: boolean
  connected?: boolean
  stopped?: boolean
  message: string
  error?: string
  output?: string
}

export interface MaaConnectionConfig {
  adb_path?: string;
  adbPath?: string;
  address?: string;
  client_type?: string;
  clientType?: string;
  auto_reconnect?: boolean;
  touch_mode?: string;
  [key: string]: unknown;
}

interface ActivityInfo {
  code: string | null
  name: string | null
  source: string | null
  startTime?: number | string | null
  endTime?: number | string | null
  stages?: string[]
  timestamp?: number
  ttl?: number
  status?: 'active' | 'none' | 'unavailable' | 'stale'
  dataUpdatedAt?: number | null
  lastSuccessAt?: number | null
  failure?: { source: 'maa' | 'penguin'; message: string } | null
}

interface MaaLogFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

interface MaaLogCheckpoint {
  logPath: string;
  size: number;
}

interface MaaVersionInfo {
  raw: string;
  cli: string;
  core: string;
}


// MAA CLI 路径
const MAA_CLI_PATH = DEFAULT_MAA_CLI_PATH;
const MAX_REALTIME_LOGS = Number(process.env.LA_PLUMA_MAX_REALTIME_LOGS || 5000);
let realtimeLogSequence = 0;
const MAX_CAPTURED_STDOUT_CHARS = 5 * 1024 * 1024;
const MAX_CAPTURED_STDERR_CHARS = 1024 * 1024;
const DYNAMIC_TASK_DIR = '_lapluma';
const STALE_DYNAMIC_TASK_MS = 24 * 60 * 60 * 1000;
const LOCAL_EMULATOR_ADDRESSES: string[] = [
  '127.0.0.1:16384',
  '127.0.0.1:5555',
  '127.0.0.1:7555',
  '127.0.0.1:62001',
  '127.0.0.1:21503'
];
const WINDOWS_EMULATOR_PROCESSES: Array<{ names: string[]; label: string; adbFiles: string[] }> = [
  { names: ['HD-Player.exe'], label: 'BlueStacks', adbFiles: ['HD-Adb.exe', 'adb.exe'] },
  { names: ['dnplayer.exe'], label: 'LDPlayer', adbFiles: ['adb.exe'] },
  { names: ['Nox.exe', 'NoxVMHandle.exe'], label: '夜神模拟器', adbFiles: ['nox_adb.exe', 'adb.exe'] },
  { names: ['MuMuPlayer.exe', 'MuMuNxDevice.exe'], label: 'MuMu 模拟器', adbFiles: ['adb.exe', 'shell\\adb.exe'] },
  { names: ['MEmu.exe', 'MEmuHeadless.exe'], label: '逍遥模拟器', adbFiles: ['adb.exe', 'MEmuHyperv\\adb.exe'] }
];
const GAME_PACKAGES: Record<string, string> = {
  Official: 'com.hypergryph.arknights',
  Bilibili: 'com.hypergryph.arknights.bilibili',
  YoStarEN: 'com.YoStarEN.Arknights',
  YoStarJP: 'com.YoStarJP.Arknights',
  YoStarKR: 'com.YoStarKR.Arknights',
  Txwy: 'tw.txwy.and.arknights'
};
const CLIENT_TYPE_NAMES: Record<string, string> = {
  official: 'Official',
  bilibili: 'Bilibili',
  txwy: 'txwy',
  yostaren: 'YostarEN',
  yostarjp: 'YostarJP',
  yostarkr: 'YostarKR'
};

/**
 * Normalize a client type to the value maa-cli expects in a task file.
 * maa-cli accepts the values case-insensitively, but the task file should use
 * its canonical spelling so the generated config stays readable.
 */
export function normalizeClientType(value: unknown): string {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return DEFAULT_CLIENT_TYPE;

  const normalized = CLIENT_TYPE_NAMES[key];
  if (!normalized) {
    const error = new Error(`不支持的客户端类型: ${value}`) as ErrorWithCode;
    error.code = 'MAA_CLIENT_TYPE_INVALID';
    error.statusCode = 400;
    asErrorWithCode(error).retryable = false;
    throw error;
  }
  return normalized;
}

// 全局任务状态追踪
const taskStatus: TaskStatus = {
  isRunning: false,
  taskName: null,
  startTime: null,
  taskType: null, // 'automation', 'combat', 'roguelike'
  currentStage: null,
  currentStep: null,
  totalSteps: null,
  process: null, // 保存子进程引用
  stopRequested: false,
  forceKillTimer: null,
  logs: [] // 保存实时日志
};

/**
 * 获取当前任务执行状态
 */
export function getTaskStatus(): Omit<TaskStatus, 'process' | 'forceKillTimer'> {
  const { process, forceKillTimer, ...status } = taskStatus;
  return status;
}

/**
 * 获取实时日志
 */
export function getRealtimeLogs(lines = 100): LogEntry[] {
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

function appendCapturedOutput(current: string, chunk: string, maxChars: number): string {
  const next = current + chunk;
  // 字符数上限足以控制内存；截断只影响诊断输出，不影响进程退出码或终态。
  return next.length > maxChars ? next.slice(-maxChars) : next;
}

function trimRealtimeLogs() {
  if (taskStatus.logs.length > MAX_REALTIME_LOGS) {
    taskStatus.logs.splice(0, taskStatus.logs.length - MAX_REALTIME_LOGS);
  }
}

function appendRealtimeLog(level: LogLevel, message: unknown) {
  const run = getCurrentAgentRun();
  taskStatus.logs.push({
    time: new Date().toISOString(),
    level,
    message,
    sequence: ++realtimeLogSequence,
    runId: run?.runId ?? null,
    operationId: run?.operationId ?? null
  });
  trimRealtimeLogs();
}

/**
 * 添加日志到缓存
 */
function addLog(level: LogLevel, message: string) {
  appendRealtimeLog(level, message);
  // 使用结构化日志，不再使用 console.log
  logger.log(level, message);
}

export function getMaaExecutionDiagnostics(stderr: unknown = ''): Array<{ code: string; message: string; level: LogLevel }> {
  const output = String(stderr || '');
  const diagnostics: Array<{ code: string; message: string; level: LogLevel }> = [];

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

function addExecutionDiagnostics(stderr: unknown): void {
  getMaaExecutionDiagnostics(stderr).forEach(diagnostic => {
    addLog(diagnostic.level, diagnostic.message);
  });
}

/**
 * 设置任务状态
 */
export function setTaskStatus(isRunning: boolean, taskName: string | null = null, taskType: string | null = null, process: ChildProcess | null = null): void {
  if (taskStatus.forceKillTimer) {
    clearTimeout(taskStatus.forceKillTimer);
  }
  taskStatus.isRunning = isRunning;
  taskStatus.taskName = taskName;
  taskStatus.taskType = taskType;
  taskStatus.currentStage = null;
  taskStatus.currentStep = null;
  taskStatus.totalSteps = null;
  taskStatus.startTime = isRunning ? Date.now() : null;
  taskStatus.process = process;
  taskStatus.stopRequested = false;
  taskStatus.forceKillTimer = null;

  addLog('INFO', `任务状态更新: ${JSON.stringify({ isRunning, taskName, taskType, hasProcess: !!process })}`);
}

export function setMaaTaskProgress(progress: {
  currentStage?: string | null;
  currentStep?: number | null;
  totalSteps?: number | null;
}): void {
  if (!taskStatus.isRunning) return;
  if ('currentStage' in progress) taskStatus.currentStage = progress.currentStage ?? null;
  if ('currentStep' in progress) taskStatus.currentStep = progress.currentStep ?? null;
  if ('totalSteps' in progress) taskStatus.totalSteps = progress.totalSteps ?? null;
}

function clearTaskStatusForProcess(childProcess: ChildProcess | null): boolean {
  if (taskStatus.process !== childProcess) return false;
  setTaskStatus(false);
  return true;
}

function createCommandOutcome({ code = null, signal = null, stdout = '', stderr = '', command, error = null, childProcess }: { code?: number | null; signal?: string | null; stdout?: string; stderr?: string; command: string; error?: ErrorWithCode | null; childProcess?: ChildProcess | null }): CommandOutcome {
  const stopRequested = Boolean(taskStatus.process === childProcess && taskStatus.stopRequested);
  const stopped = Boolean(signal || childProcess?.killed || stopRequested);
  const result: CommandExecutionResult = {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    command,
    exitCode: code,
    signal: signal || null
  };
  return {
    ok: !error && code === 0 && !stopped,
    stopped,
    stopRequested,
    result,
    error: error || (code !== 0 && !stopped
      ? Object.assign(new Error(`命令执行失败，退出码: ${code}`), {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: code,
          signal: signal || null
        })
      : null)
  };
}

/**
 * 执行 MAA CLI 命令（支持后台异步执行）
 */
async function execMaaCommandUnlocked(command: string, args: string[] = [], taskName: string | null = null, taskType: string | null = null, waitForCompletion = false, silent = false, onSettled: ((outcome: CommandOutcome) => unknown) | null = null, lifecycle: MaaCommandLifecycle = {}): Promise<CommandExecutionResult> {
  const fullCommand = `${MAA_CLI_PATH} ${command} ${args.join(' ')}`;

  // 静默模式下不输出日志（用于健康检查等频繁调用）
  if (!silent) {
    addLog('INFO', `执行命令: ${fullCommand}, 等待完成: ${waitForCompletion}`);
  }

  // 准备最终的参数列表
  let finalArgs: string[] = [...args];

  // 如果有任务名称且不需要等待完成，使用后台异步执行
  if (taskName && !waitForCompletion) {
    return new Promise<CommandExecutionResult>(resolve => {
      // 使用 spawn 而不是 exec，这样可以独立运行
      const childProcess = spawn(MAA_CLI_PATH, [command, ...finalArgs], {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      // 实时捕获输出
      childProcess.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout = appendCapturedOutput(stdout, text, MAX_CAPTURED_STDOUT_CHARS);

        // 将输出按行分割并添加到日志
        const lines = text.split('\n').filter((line: string) => line.trim());
        lines.forEach((line: string) => {
          appendRealtimeLog('INFO', line.trim());
        });
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr = appendCapturedOutput(stderr, text, MAX_CAPTURED_STDERR_CHARS);

        // 将错误输出按行分割并添加到日志
        const lines = text.split('\n').filter((line: string) => line.trim());
        lines.forEach((line: string) => {
          const level = line.includes('ERROR') ? 'ERROR' : line.includes('WARN') ? 'WARN' : 'INFO';
          appendRealtimeLog(level, line.trim());
        });
      });

      // 设置任务开始状态
      setTaskStatus(true, taskName, taskType, childProcess);
      lifecycle.onStarted?.({ childProcess, command: fullCommand });

      let settled = false;
      const settle = (outcome: CommandOutcome) => {
        if (settled) return;
        settled = true;
        if (stderr) {
          addExecutionDiagnostics(stderr);
        }
        clearTaskStatusForProcess(childProcess);
        onSettled?.(outcome);
        lifecycle.onSettled?.(outcome);
      };

      // 立即返回，不等待命令完成
      resolve({
        stdout: '',
        stderr: '',
        command: fullCommand,
        message: '任务已在后台启动'
      });

      // 在后台继续执行
      childProcess.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        addLog('INFO', `命令执行完成: ${fullCommand}, 退出码: ${code}`);
        if (stdout.trim()) {
          addLog('INFO', `stdout: ${stdout.trim()}`);
        }
        if (stderr) {
          addLog('WARN', `stderr: ${stderr.trim()}`);
        }

        const outcome = createCommandOutcome({ code, signal, stdout, stderr, command: fullCommand, childProcess });
        if (code !== 0) {
          addLog('ERROR', `命令执行失败: ${fullCommand}`);
        }
        settle(outcome);
      });

      childProcess.on('error', (error: Error) => {
        addLog('ERROR', `命令执行错误: ${fullCommand} - ${getErrorMessage(error)}`);
        settle(createCommandOutcome({ stdout, stderr, command: fullCommand, error, childProcess }));
      });
    });
  }
  // 需要等待完成（任务流程中的串行执行）
  else if (taskName && waitForCompletion) {
    return new Promise<CommandExecutionResult>((resolve, reject) => {
      const childProcess = spawn(MAA_CLI_PATH, [command, ...finalArgs], {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      // 实时捕获输出
      childProcess.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout = appendCapturedOutput(stdout, text, MAX_CAPTURED_STDOUT_CHARS);

        const lines = text.split('\n').filter((line: string) => line.trim());
        lines.forEach((line: string) => {
          appendRealtimeLog('INFO', line.trim());
        });
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr = appendCapturedOutput(stderr, text, MAX_CAPTURED_STDERR_CHARS);

        const lines = text.split('\n').filter((line: string) => line.trim());
        lines.forEach((line: string) => {
          const level = line.includes('ERROR') ? 'ERROR' : line.includes('WARN') ? 'WARN' : 'INFO';
          appendRealtimeLog(level, line.trim());
        });
      });

      // 设置任务开始状态
      setTaskStatus(true, taskName, taskType, childProcess);
      lifecycle.onStarted?.({ childProcess, command: fullCommand });

      let settled = false;
      const settle = (outcome: CommandOutcome) => {
        if (settled) return false;
        settled = true;
        clearTaskStatusForProcess(childProcess);
        lifecycle.onSettled?.(outcome);
        return true;
      };

      // 等待命令完成
      childProcess.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        const outcome = createCommandOutcome({ code, signal, stdout, stderr, command: fullCommand, childProcess });
        if (!settle(outcome)) return;
        addLog('INFO', `命令执行完成: ${fullCommand}, 退出码: ${code}`);
        if (stdout.trim()) {
          addLog('INFO', `stdout: ${stdout.trim()}`);
        }
        if (stderr) {
          addExecutionDiagnostics(stderr);
          addLog('WARN', `stderr: ${stderr.trim()}`);
        }

        if (!outcome.ok) {
          addLog('ERROR', `命令执行失败: ${fullCommand}`);
          const diagnostic = getMaaExecutionDiagnostics(stderr)[0];
          const commandError = (outcome.error || new Error(
            diagnostic?.message || (outcome.stopRequested ? '任务已终止' : `任务异常退出${signal ? `（${signal}）` : ''}`)
          )) as ErrorWithCode;
          if (diagnostic && !outcome.stopped) commandError.message = diagnostic.message;
          commandError.stdout = stdout.trim();
          commandError.stderr = stderr.trim();
          commandError.exitCode = code;
          commandError.signal = signal || null;
          commandError.stopped = outcome.stopped;
          commandError.stopRequested = outcome.stopRequested;
          reject(commandError);
        } else {
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            command: fullCommand
          });
        }
      });

      childProcess.on('error', (error: Error) => {
        const outcome = createCommandOutcome({ stdout, stderr, command: fullCommand, error, childProcess });
        if (!settle(outcome)) return;
        addLog('ERROR', `命令执行错误: ${fullCommand} - ${getErrorMessage(error)}`);
        reject(error);
      });
    });
  }
  // 没有任务名称，使用同步执行（用于配置查询等操作）
  else {
    try {
      const maintenance = command === 'install' || command === 'update' || command === 'hot-update';
      const { stdout, stderr } = await execFilePromise(MAA_CLI_PATH, [command, ...finalArgs], {
        maxBuffer: 10 * 1024 * 1024,
        timeout: maintenance ? MAA_MAINTENANCE_TIMEOUT_MS : MAA_CLI_EXEC_TIMEOUT_MS,
        killSignal: 'SIGKILL'
      });

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        command: fullCommand
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error) || '';
      const stderr = asErrorWithCode(error).stderr || '';
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

export function requiresMaaExecutionLease(command: string): boolean {
  return DEVICE_MUTATING_COMMANDS.has(command);
}

export async function execMaaCommand(command: string, args: string[] = [], taskName: string | null = null, taskType: string | null = null, waitForCompletion = false, silent = false, lifecycle: MaaCommandLifecycle = {}): Promise<CommandExecutionResult> {
  if (!requiresMaaExecutionLease(command)) {
    return execMaaCommandUnlocked(command, args, taskName, taskType, waitForCompletion, silent, null, lifecycle);
  }

  const lease = await acquireMaaExecutionLease({
    source: taskType || 'maa-command',
    taskName: taskName || command,
    command,
    runId: lifecycle?.runId || null
  });
  let releaseOnReturn = true;
  try {
    if (taskName && !waitForCompletion) {
      const { onSettled: lifecycleOnSettled, ...processLifecycle } = lifecycle;
      const result = await execMaaCommandUnlocked(
        command,
        args,
        taskName,
        taskType,
        waitForCompletion,
        silent,
        async (outcome: CommandOutcome) => {
          try {
            await lease.release();
          } catch (error) {
            logger.error('释放 MAA 执行锁失败', { error: getErrorMessage(error) });
          }
          try {
            await lifecycleOnSettled?.(outcome);
          } catch (error) {
            logger.error('处理 MAA 后台任务终态失败', { error: getErrorMessage(error) });
          }
        },
        processLifecycle
      );
      releaseOnReturn = false;
      return result;
    }
    return await execMaaCommandUnlocked(command, args, taskName, taskType, waitForCompletion, silent, null, lifecycle);
  } finally {
    if (releaseOnReturn) await lease.release();
  }
}

/**
 * 获取 MAA 版本信息
 */
export async function getMaaVersion(silent = false): Promise<MaaVersionInfo> {
  const result = await execMaaCommand('version', [], null, null, false, silent);
  const output = result.stdout;

  // 解析版本信息
  // 输出格式: "maa-cli <version>\nMaaCore <version>\n"
  const lines = output.trim().split('\n');
  const versions: MaaVersionInfo = {
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
/**
 * Some maa-cli builds (for example the Homebrew formula) are compiled without
 * the `cli_installer` feature, so `maa self` does not exist. Probe it before
 * using `maa self update` instead of assuming the subcommand is available.
 */
export async function canUseMaaSelfUpdate({ execute = execMaaCommand }: { execute?: typeof execMaaCommand } = {}): Promise<boolean> {
  try {
    await execute('self', ['--help'], null, null, true, true);
    return true;
  } catch {
    return false;
  }
}

let maaConfigDirCache: { value: string; cachedAt: number } | null = null;
const MAA_CONFIG_DIR_CACHE_MS = 5 * 60 * 1000;

export async function getMaaConfigDir() {
  const now = Date.now();
  if (maaConfigDirCache && now - maaConfigDirCache.cachedAt < MAA_CONFIG_DIR_CACHE_MS) {
    return maaConfigDirCache.value;
  }
  const result = await execMaaCommand('dir', ['config']);
  const value = result.stdout;
  maaConfigDirCache = { value, cachedAt: now };
  return value;
}

/**
 * 获取配置文件路径
 */
export function validateMaaProfileName(profileName: unknown = 'default'): string {
  if (typeof profileName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(profileName)) {
    throw new Error('连接配置名称不合法');
  }
  return profileName;
}

async function getConfigPath(profileName: unknown = 'default'): Promise<string> {
  const normalizedProfileName = validateMaaProfileName(profileName);
  const configDir = await getMaaConfigDir();
  const profilesDir = resolve(configDir.trim(), 'profiles');
  const configPath = resolve(profilesDir, `${normalizedProfileName}.toml`);
  if (dirname(configPath) !== profilesDir) {
    throw new Error('连接配置路径不合法');
  }
  return configPath;
}

export function parseMaaProfile(content: unknown): Record<string, unknown> {
  return TOML.parse(String(content || '')) as Record<string, unknown>;
}

export function mergeMaaProfileConnection(profileDocument: Record<string, unknown> = {}, config: Record<string, unknown> = {}): Record<string, unknown> {
  if (!profileDocument || typeof profileDocument !== 'object' || Array.isArray(profileDocument)) {
    throw new TypeError('MAA profile 文档格式不合法');
  }

  const rawConnection = Object.prototype.hasOwnProperty.call(config, 'connection')
    ? config.connection
    : config;
  if (!isRecord(rawConnection)) {
    throw new TypeError('connection 配置格式不合法');
  }

  const existingConnection = profileDocument.connection;
  if (existingConnection != null && !isRecord(existingConnection)) {
    throw new TypeError('现有 connection section 格式不合法');
  }

  const connectionUpdates = rawConnection;
  const normalizedUpdates = Object.fromEntries(
    Object.entries(connectionUpdates).filter(([, value]) => value !== undefined)
  );
  const {
    auto_reconnect: autoReconnect,
    touch_mode: touchMode,
    ...connectionOnlyUpdates
  } = normalizedUpdates;
  const {
    auto_reconnect: _legacyAutoReconnect,
    touch_mode: _legacyTouchMode,
    ...existingConnectionOnly
  } = (existingConnection as Record<string, unknown> | undefined) || {};
  const existingBehavior = profileDocument.behavior;
  const behavior = autoReconnect === undefined
    ? existingBehavior
    : {
        ...(existingBehavior && typeof existingBehavior === 'object' && !Array.isArray(existingBehavior)
          ? existingBehavior
          : {}),
        auto_reconnect: autoReconnect
      };
  const existingInstanceOptions = profileDocument.instance_options;
  const instanceOptions = touchMode === undefined
    ? existingInstanceOptions
    : {
        ...(existingInstanceOptions && typeof existingInstanceOptions === 'object' && !Array.isArray(existingInstanceOptions)
          ? existingInstanceOptions
          : {}),
        touch_mode: touchMode
      };

  return {
    ...profileDocument,
    connection: {
      ...existingConnectionOnly,
      ...connectionOnlyUpdates
    },
    ...(behavior ? { behavior } : {}),
    ...(instanceOptions ? { instance_options: instanceOptions } : {})
  };
}

/**
 * 读取配置文件
 */
export async function getConfig(profileName: unknown = 'default'): Promise<MaaConnectionConfig> {
  const normalizedProfileName = validateMaaProfileName(profileName);
  try {
    const configPath = await getConfigPath(normalizedProfileName);
    const content = await readFile(configPath, 'utf-8');
    const profile = parseMaaProfile(content);
    const connection = isRecord(profile.connection) ? profile.connection : profile;
    const result: Record<string, unknown> = { ...connection };
    const behavior = isRecord(profile.behavior) ? profile.behavior : {};
    const behaviorAutoReconnect = behavior.auto_reconnect;
    if (behaviorAutoReconnect !== undefined && result.auto_reconnect === undefined) {
      result.auto_reconnect = behaviorAutoReconnect;
    }
    const instanceOptions = isRecord(profile.instance_options) ? profile.instance_options : {};
    if (instanceOptions.touch_mode) {
      result.touch_mode = instanceOptions.touch_mode;
    }
    return result as MaaConnectionConfig;
  } catch {
    logger.debug('配置文件不存在，返回环境默认配置');
    return {
      adb_path: DEFAULT_ADB_PATH,
      address: DEFAULT_ADB_ADDRESS,
      config: 'CompatMac',
    };
  }
}

/**
 * 保存配置文件
 */
export async function saveConfig(profileName: unknown = 'default', config: Record<string, unknown>): Promise<void> {
  try {
    const normalizedProfileName = validateMaaProfileName(profileName);
    const configPath = await getConfigPath(normalizedProfileName);
    await mkdir(dirname(configPath), { recursive: true });

    let existingProfile: Record<string, unknown> = {};
    try {
      existingProfile = parseMaaProfile(await readFile(configPath, 'utf-8'));
    } catch (error) {
      if (getErrorCode(error) !== 'ENOENT') throw error;
    }

    const mergedProfile = mergeMaaProfileConnection(existingProfile, config);
    const tomlContent = TOML.stringify(mergedProfile as Parameters<typeof TOML.stringify>[0]);
    await writeFile(configPath, tomlContent, 'utf-8');
    logger.debug('配置已保存', { configPath });
  } catch (error) {
    throw new Error(`保存配置失败: ${getErrorMessage(error)}`);
  }
}

/**
 * 创建临时任务文件并执行
 */
export async function execDynamicTask(taskId: string, taskConfig: unknown, taskName: string | null = null, taskType: string | null = null, waitForCompletion = false, userResource = false, runtime: DynamicTaskRuntime = {}): Promise<CommandExecutionResult> {
  const acquireExecutionLease = runtime.acquireExecutionLease || acquireMaaExecutionLease;
  const resolveConfigDir = runtime.getConfigDir || getMaaConfigDir;
  const makeDirectory = runtime.mkdir || mkdir;
  const writeTaskFile = runtime.writeFile || writeFile;
  const removeTaskFile = runtime.unlink || unlink;
  const executeCommand = runtime.executeCommand || execMaaCommandUnlocked;
  const createNonce = runtime.createNonce || (() => `${process.pid}_${Date.now()}_${randomBytes(6).toString('hex')}`);
  const lifecycle: MaaCommandLifecycle = runtime.lifecycle || {};
  const shouldAbort = typeof runtime.shouldAbort === 'function' ? runtime.shouldAbort : null;
  const throwIfAborted = () => {
    if (!shouldAbort?.()) return;
    const error = new Error('任务已被用户终止') as ErrorWithCode;
    asErrorWithCode(error).stopped = true;
    asErrorWithCode(error).stopRequested = true;
    throw error;
  };

  const lease = await acquireExecutionLease({
    source: taskType || 'dynamic-task',
    runId: lifecycle.runId || null,
    taskName: taskName || String(taskId || 'dynamic-task'),
    command: 'run'
  });
  let tempTaskFile: string | null = null;
  let releaseOnReturn = true;

  const cleanup = async () => {
    if (!tempTaskFile) return;
    await removeTaskFile(tempTaskFile).catch(error => {
      if (getErrorCode(error) !== 'ENOENT') throw error;
    });
  };

  const cleanupAndRelease = async () => {
    try {
      await cleanup();
    } catch (error) {
      logger.warn('清理动态任务文件失败', { tempTaskFile, error: getErrorMessage(error) });
    } finally {
      await lease.release();
    }
  };

  try {
    throwIfAborted();
    const configDir = await resolveConfigDir();
    throwIfAborted();
    const tasksDir = join(configDir.trim(), 'tasks');
    const dynamicTasksDir = join(tasksDir, DYNAMIC_TASK_DIR);

    // 确保动态任务目录存在。子目录不会出现在 `maa list` 中，避免临时任务污染任务列表。
    await makeDirectory(dynamicTasksDir, { recursive: true });

    const taskPrefix = String(taskId || 'dynamic-task')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 64) || 'dynamic-task';
    const taskFileId = `${taskPrefix}_temp_${createNonce()}`;
    tempTaskFile = join(dynamicTasksDir, `${taskFileId}.json`);

    // 将 taskConfig 转换为对象（如果是字符串则解析，如果已经是对象则直接使用）
    const configObj = typeof taskConfig === 'string' ? JSON.parse(taskConfig) : taskConfig;
    const clientType = normalizeClientType(
      runtime.clientType || configObj.client_type || configObj.clientType
    );

    // 将配置对象转换为 maa-cli 支持的 JSON 任务文件
    const taskContent = generateTaskConfig({ ...configObj, client_type: clientType });

    // 写入临时文件
    await writeTaskFile(tempTaskFile, taskContent, 'utf-8');
    throwIfAborted();
    addLog('INFO', `临时任务文件已创建: ${tempTaskFile}`);
    addLog('DEBUG', `任务内容:\n${taskContent}`);

    // 执行任务；任务文件位于 tasks/_lapluma，用相对路径交给 maa run。
    const runArgs: string[] = ['--batch'];
    if (userResource) runArgs.push('--user-resource');
    runArgs.push(join(DYNAMIC_TASK_DIR, taskFileId));
    if (taskName && !waitForCompletion) {
      const { onSettled: lifecycleOnSettled, ...processLifecycle } = lifecycle;
      const result = await executeCommand(
        'run',
        runArgs,
        taskName,
        taskType,
        false,
        false,
        async (outcome: CommandOutcome) => {
          try {
            await cleanupAndRelease();
          } catch (error) {
            logger.error('释放动态任务资源失败', { error: getErrorMessage(error) });
          }
          try {
            await lifecycleOnSettled?.(outcome);
          } catch (error) {
            logger.error('处理动态任务终态失败', { error: getErrorMessage(error) });
          }
        },
        processLifecycle
      );
      releaseOnReturn = false;
      return result;
    }

    return await executeCommand('run', runArgs, taskName, taskType, waitForCompletion, false, null, lifecycle);
  } catch (error) {
    addLog('ERROR', `执行动态任务失败: ${getErrorMessage(error)}`);
    if (getErrorCode(error) === 'MAA_EXECUTION_BUSY' || asErrorWithCode(error).stopped) throw error;
    const dynamicTaskError = new Error(`执行动态任务失败: ${getErrorMessage(error)}`, { cause: error }) as ErrorWithCode;
    dynamicTaskError.code = getErrorCode(error) ?? undefined;
    dynamicTaskError.statusCode = getErrorStatus(error) ?? undefined;
    dynamicTaskError.details = getErrorDetails(error);
    dynamicTaskError.retryable = asErrorWithCode(error).retryable;
    dynamicTaskError.exitCode = asErrorWithCode(error).exitCode;
    dynamicTaskError.signal = asErrorWithCode(error).signal ?? undefined;
    throw dynamicTaskError;
  } finally {
    if (releaseOnReturn) await cleanupAndRelease();
  }
}

function normalizeTaskParams(params: Record<string, unknown> = {}): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;

    // Preserve the old API convenience: a JSON-array string becomes an array.
    if (typeof value === 'string' && value.trim().startsWith('[') && value.trim().endsWith(']')) {
      try {
        const parsed = JSON.parse(value.trim());
        if (Array.isArray(parsed)) {
          normalized[key] = parsed;
          continue;
        }
      } catch {
        // Leave malformed array-like strings as strings.
      }
    }

    normalized[key] = value;
  }

  return normalized;
}

/**
 * Generate the JSON task file consumed by `maa run`.
 */
function generateTaskConfig(taskConfig: unknown): string {
  const configInput = (taskConfig && typeof taskConfig === 'object' && !Array.isArray(taskConfig))
    ? taskConfig as Record<string, unknown>
    : {};
  const clientType = configInput.client_type || configInput.clientType;
  const sourceTasks: unknown[] = Array.isArray(configInput.tasks) ? configInput.tasks : [configInput];
  const tasks = sourceTasks.map(sourceTaskValue => {
    const sourceTask = (sourceTaskValue && typeof sourceTaskValue === 'object' && !Array.isArray(sourceTaskValue))
      ? sourceTaskValue as Record<string, unknown>
      : {};
    const task: Record<string, unknown> = {
      name: sourceTask.name,
      type: sourceTask.type,
      params: normalizeTaskParams(sourceTask.params as Record<string, unknown>)
    };
    if (sourceTask.strategy) task.strategy = sourceTask.strategy;
    if (sourceTask.condition) task.condition = sourceTask.condition;
    if (sourceTask.variants) task.variants = sourceTask.variants;
    return task;
  });

  const config: Record<string, unknown> = {
    ...(clientType ? { client_type: normalizeClientType(clientType) } : {}),
    tasks
  };
  const content = JSON.stringify(config, null, 2);
  addLog('DEBUG', `生成的任务配置:\n${content}`);
  return content;
}

/**
 * Remove dynamic task files left behind by a crashed or interrupted process.
 * Only files created by La Pluma are considered: everything under
 * `tasks/_lapluma` and legacy `*_temp*` files in the tasks root.
 */
export async function cleanupStaleDynamicTaskFiles({
  configDir = null,
  now = Date.now(),
  maxAgeMs = STALE_DYNAMIC_TASK_MS
}: { configDir?: string | null; now?: number; maxAgeMs?: number } = {}): Promise<number> {
  const resolvedConfigDir = configDir || (await getMaaConfigDir()).trim();
  const tasksDir = join(resolvedConfigDir, 'tasks');
  const targets: Array<{ dir: string; matches: (name: string) => boolean }> = [
    { dir: join(tasksDir, DYNAMIC_TASK_DIR), matches: () => true },
    { dir: tasksDir, matches: name => /_temp(?:_|\.)/.test(name) }
  ];
  let removed = 0;

  for (const target of targets) {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(target.dir, { withFileTypes: true });
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !target.matches(entry.name)) continue;
      const filePath = join(target.dir, entry.name);
      const fileStat = await stat(filePath).catch((error: unknown) => {
        if (getErrorCode(error) === 'ENOENT') return null;
        throw error;
      });
      if (!fileStat || now - fileStat.mtimeMs <= maxAgeMs) continue;

      await unlink(filePath).catch(error => {
        if (getErrorCode(error) !== 'ENOENT') throw error;
      });
      removed += 1;
    }
  }

  return removed;
}

function validateAdbPath(adbPath: unknown): string {
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

function validateAdbAddress(address: unknown): string {
  if (typeof address !== 'string' || !address.trim()) {
    throw new Error('ADB 地址不能为空');
  }
  // 常见形态：127.0.0.1:5555、192.168.1.2:5555、localhost:5555、emulator-5554
  if (!/^([a-zA-Z0-9_.-]+)(:\d{1,5})?$/.test(address)) {
    throw new Error('ADB 地址格式不合法');
  }
  return address;
}

type AdbExecOptions = { timeout?: number; windowsHide?: boolean; maxBuffer?: number };
type AdbExecBufferOptions = AdbExecOptions & { encoding: 'buffer' };

async function adbExec(adbPath: string, args: string[], options: AdbExecBufferOptions): Promise<{ stdout: Buffer; stderr: Buffer }>;
async function adbExec(adbPath: string, args: string[], options?: AdbExecOptions): Promise<{ stdout: string; stderr: string }>;
async function adbExec(adbPath: string, args: string[], options: AdbExecOptions | AdbExecBufferOptions = {}): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  validateAdbPath(adbPath);
  return execFilePromise(adbPath, args, {
    maxBuffer: 50 * 1024 * 1024,
    ...options
  }) as Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;
}

function parseAdbDeviceList(output: unknown = ''): AdbDevice[] {
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

export function getAdbDeviceState(output: unknown, address: string): string | null {
  return parseAdbDeviceList(output).find(device => device.address === address)?.state || null;
}

function probeLocalAddress(address: string, timeout = 280): Promise<boolean> {
  const [host, portValue] = address.split(':');
  const port = Number(portValue);
  if (!host || !Number.isInteger(port)) return Promise.resolve(false);

  return new Promise<boolean>(resolve => {
    const socket = createConnection({ host, port });
    const complete = (reachable: boolean) => {
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

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function findWindowsEmulatorSpec(processName = ''): { names: string[]; label: string; adbFiles: string[] } | undefined {
  const normalizedName = String(processName).toLowerCase();
  return WINDOWS_EMULATOR_PROCESSES.find(spec =>
    spec.names.some(name => name.toLowerCase() === normalizedName)
  );
}

async function getWindowsEmulatorProcesses(): Promise<EmulatorProcess[]> {
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
    const entries: unknown = JSON.parse(output);
    const list = Array.isArray(entries) ? entries : [entries];
    return list
      .filter(isRecord)
      .filter(entry => entry.Name && entry.ExecutablePath)
      .map(entry => ({
        name: String(entry.Name),
        executablePath: String(entry.ExecutablePath)
      }));
  } catch (error) {
    logger.debug('Windows 模拟器进程扫描失败', { error: getErrorMessage(error) });
    return [];
  }
}

async function discoverWindowsEmulatorAdbs(): Promise<AdbInstallation[]> {
  const processes = await getWindowsEmulatorProcesses();
  const seenPaths = new Set<string>();
  const installations: AdbInstallation[] = [];

  for (const processInfo of processes) {
    const spec = findWindowsEmulatorSpec(processInfo.name);
    if (!spec) continue;

    // 模拟器进程可能在安装根目录或其 bin/shell 子目录中，检查两层即可避免扫描无关路径。
    const roots: string[] = [dirname(processInfo.executablePath), dirname(dirname(processInfo.executablePath))];
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

async function listDevicesFromAdb(adbPath: string, metadata: Partial<AdbInstallation> = {}): Promise<AdbDevice[]> {
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
    logger.debug('读取模拟器内置 ADB 设备失败', { adbPath, error: getErrorMessage(error) });
    return [];
  }
}

function mergeDiscoveredDevices(...deviceGroups: AdbDevice[][]): AdbDevice[] {
  const devicesByAddress = new Map<string, AdbDevice>();
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
export async function discoverAdbDevices(adbPath: string = DEFAULT_ADB_PATH): Promise<AdbDiscoveryResult> {
  let configuredAdbAvailable = true;
  try {
    await adbExec(adbPath, ['version']);
  } catch (error) {
    configuredAdbAvailable = false;
    logger.debug('当前 ADB 不可用，继续查找 Windows 模拟器内置 ADB', { adbPath, error: getErrorMessage(error) });
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
    const devices = mergeDiscoveredDevices(configuredDevices, ...emulatorDevices);
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
      error: getErrorMessage(error)
    };
  }
}

export async function getGameClientState(
  adbPath: string = DEFAULT_ADB_PATH,
  address: string = DEFAULT_ADB_ADDRESS,
  clientType: string = DEFAULT_CLIENT_TYPE
): Promise<{ running: boolean; expectedPackage: string; foregroundPackage: string | null }> {
  validateAdbPath(adbPath);
  validateAdbAddress(address);

  const expectedPackage = GAME_PACKAGES[clientType] || GAME_PACKAGES.Official;
  const { stdout } = await adbExec(adbPath, ['-s', address, 'shell', 'dumpsys', 'window'], {
    timeout: 10000,
    windowsHide: true
  });
  const foregroundPackage = parseForegroundPackage(stdout);

  return {
    running: foregroundPackage === expectedPackage,
    expectedPackage,
    foregroundPackage
  };
}

export function parseForegroundPackage(output: unknown = ''): string | null {
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
export async function testAdbConnection(adbPath: string = DEFAULT_ADB_PATH, address: string = DEFAULT_ADB_ADDRESS, options: { shouldStop?: () => boolean } = {}): Promise<AdbConnectionResult> {
  const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : null;
  const stoppedResult = () => ({
    success: false,
    stopped: true,
    message: '连接检查已终止'
  });

  try {
    // 检查 ADB 是否可用
    try {
      await adbExec(adbPath, ['version'], { timeout: 5000, windowsHide: true });
    } catch (error) {
      return {
        success: false,
        message: `ADB 不可用，请检查 ADB 路径：${getErrorMessage(error)}`,
        error: getErrorMessage(error)
      };
    }

    if (shouldStop?.()) return stoppedResult();

    // 检查设备列表
    validateAdbAddress(address);
    const { stdout: devicesOutput } = await adbExec(adbPath, ['devices'], { timeout: 6000, windowsHide: true });
    if (shouldStop?.()) return stoppedResult();
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
    if (shouldStop?.()) return stoppedResult();
    logger.debug('尝试连接设备', { address });
    const { stdout: connectOutput } = await adbExec(adbPath, ['connect', address], { timeout: 8000, windowsHide: true });
    if (shouldStop?.()) return stoppedResult();

    // 等待连接稳定
    await new Promise<void>(resolve => setTimeout(resolve, 1000));

    // 再次检查连接状态
    const { stdout: devicesOutput2 } = await adbExec(adbPath, ['devices'], { timeout: 6000, windowsHide: true });
    if (shouldStop?.()) return stoppedResult();
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
      message: `连接测试失败：${getErrorMessage(error)}`,
      error: getErrorMessage(error)
    };
  }
}

/**
 * 通过 ADB 截取模拟器屏幕
 */
export async function captureScreen(adbPath: string = DEFAULT_ADB_PATH, address: string = DEFAULT_ADB_ADDRESS): Promise<{ image: string; timestamp: string }> {
  try {
    validateAdbPath(adbPath);
    validateAdbAddress(address);

    // 先检查设备是否已连接
    const { stdout: devicesOutput } = await adbExec(adbPath, ['devices'], {
      timeout: 5000,
      windowsHide: true
    });
    const isConnected = devicesOutput.includes(address);

    if (!isConnected) {
      logger.debug('设备未连接，尝试连接', { address });
      const { stdout: connectOutput, stderr: connectError } = await adbExec(adbPath, ['connect', address], {
        timeout: 8000,
        windowsHide: true
      });
      logger.debug('连接结果', { output: connectOutput });

      if (connectError) {
        logger.warn('连接警告', { error: connectError });
      }

      await new Promise<void>(resolve => setTimeout(resolve, 1000));
    }

    logger.debug('执行截图命令', { adbPath, address });
    const { stdout, stderr } = await adbExec(adbPath, ['-s', address, 'exec-out', 'screencap', '-p'], {
      timeout: 15000,
      windowsHide: true,
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
    throw new Error(`截图失败: ${getErrorMessage(error)}`);
  }
}

/**
 * 活动代号缓存
 */
const ACTIVITY_CACHE_TTL = 24 * 60 * 60 * 1000;
const activityCache = new Map<string, ActivityInfo & { timestamp: number; ttl: number }>();

function cacheActivity(clientType: string, activity: ActivityInfo): ActivityInfo {
  const cached: ActivityInfo & { timestamp: number; ttl: number } = {
    ...activity,
    timestamp: Date.now(),
    ttl: ACTIVITY_CACHE_TTL
  };
  activityCache.set(clientType, cached);
  void saveUserConfig('activity-cache', { [clientType]: cached });
  return { ...activity };
}

async function withFullActivityStages(activity: ActivityInfo): Promise<ActivityInfo> {
  if (!activity.code) return activity;
  try {
    const stages = await listMaaActivityStageCodes(activity.code);
    return stages.length ? { ...activity, stages } : activity;
  } catch {
    return activity;
  }
}

function getValidCachedActivity(cachedActivity: ActivityInfo | undefined, now: number = Date.now()): ActivityInfo | null {
  if (!cachedActivity?.code || !cachedActivity.timestamp) return null;
  const ttlExpiresAt = cachedActivity.timestamp + (cachedActivity.ttl || ACTIVITY_CACHE_TTL);
  const endTimeMs = typeof cachedActivity.endTime === 'number'
    ? cachedActivity.endTime
    : Date.parse(String(cachedActivity.endTime || ''));
  const expiresAt = Number.isFinite(endTimeMs) && endTimeMs > 0
    ? Math.min(ttlExpiresAt, endTimeMs)
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
export async function getCurrentActivity(clientType: string = DEFAULT_CLIENT_TYPE): Promise<ActivityInfo> {
  const now = Date.now();
  const cachedActivity = activityCache.get(clientType);
  let staleCandidate: ActivityInfo | null = cachedActivity?.code ? cachedActivity : null;
  const cached = getValidCachedActivity(cachedActivity, now);
  if (cached) {
      logger.debug('使用缓存的活动信息', {
        clientType, code: cached.code, name: cached.name, source: cached.source
      });
    return withFullActivityStages({
      ...cached,
      status: 'active',
      dataUpdatedAt: cached.timestamp ?? now,
      lastSuccessAt: cached.timestamp ?? now,
      failure: null
    });
  }
  if (cachedActivity) {
    activityCache.delete(clientType);
  }

  const persistedResult = await loadUserConfig('activity-cache');
  const persistedData = persistedResult.success && 'data' in persistedResult && isRecord(persistedResult.data)
    ? persistedResult.data
    : {};
  const rawPersistedEntry = persistedData[clientType];
  const persistedEntry = isRecord(rawPersistedEntry) ? rawPersistedEntry : null;
  const persisted = getValidCachedActivity(
    persistedEntry ? persistedEntry as unknown as ActivityInfo : undefined,
    now
  );
  if (persisted) {
    const timestamp = typeof persistedEntry?.timestamp === 'number' ? persistedEntry.timestamp : 0;
    const ttl = typeof persistedEntry?.ttl === 'number' && persistedEntry.ttl ? persistedEntry.ttl : ACTIVITY_CACHE_TTL;
    activityCache.set(clientType, { ...persisted, timestamp, ttl });
    logger.debug('使用持久化活动缓存', { clientType, code: persisted.code, name: persisted.name, source: persisted.source });
    return withFullActivityStages({
      ...persisted,
      status: 'active',
      dataUpdatedAt: timestamp || now,
      lastSuccessAt: timestamp || now,
      failure: null
    });
  }
  if (persistedEntry && typeof persistedEntry.code === 'string' && persistedEntry.code) {
    staleCandidate = staleCandidate || (persistedEntry as unknown as ActivityInfo);
  }

  let failureMessage: string | null = null;
  try {
    const stageActivity = await getStageActivityInfo(clientType, now);
    if (stageActivity?.code) {
      logger.debug('从 StageActivityV2 获取活动信息', {
        clientType,
        code: stageActivity.code,
        name: stageActivity.name,
        stages: stageActivity.stages.length
      });
      return withFullActivityStages({
        ...cacheActivity(clientType, stageActivity),
        status: 'active',
        dataUpdatedAt: now,
        lastSuccessAt: now,
        failure: null
      });
    }
  } catch (error) {
    failureMessage = getErrorMessage(error);
    logger.warn('读取 StageActivityV2 失败，尝试 maa activity', { error: failureMessage });
  }

  try {
    // 获取活动信息
    const result = await execMaaCommand('activity', [clientType], null, null, false, true);
    const output = result.stdout;

    logger.debug('maa activity 原始输出', { output });

    let activityName: string | null = null;
    let activityCode: string | null = null;

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
      return withFullActivityStages({
        ...cacheActivity(clientType, {
          code: activityCode,
          name: activityName,
          source: 'maa',
          startTime: null,
          endTime: null,
          stages: []
        }),
        status: 'active',
        dataUpdatedAt: now,
        lastSuccessAt: now,
        failure: null
      });
    }

    logger.debug('MAA 活动表未返回当前活动，尝试备用数据源');
  } catch (error) {
    failureMessage = getErrorMessage(error);
    logger.warn('获取 MAA 活动信息失败，尝试备用数据源', { error: failureMessage });
  }

  try {
    const fallbackActivity = await getFallbackActivity(clientType);
    if (fallbackActivity?.code) {
      logger.info('从备用数据源获取到活动信息', fallbackActivity);
      return withFullActivityStages({
        ...cacheActivity(clientType, fallbackActivity),
        status: 'active',
        dataUpdatedAt: now,
        lastSuccessAt: now,
        failure: null
      });
    }
  } catch (error) {
    failureMessage = getErrorMessage(error);
    logger.warn('备用活动数据源不可用', { error: failureMessage });
  }

  if (staleCandidate?.code) {
    return withFullActivityStages({
      ...staleCandidate,
      status: 'stale',
      dataUpdatedAt: staleCandidate.timestamp ?? null,
      lastSuccessAt: staleCandidate.timestamp ?? null,
      failure: failureMessage ? { source: 'maa', message: failureMessage } : null
    });
  }

  return {
    code: null,
    name: null,
    source: null,
    startTime: null,
    endTime: null,
    stages: [],
    status: failureMessage ? 'unavailable' : 'none',
    dataUpdatedAt: null,
    lastSuccessAt: null,
    failure: failureMessage ? { source: 'maa', message: failureMessage } : null
  };
}

/**
 * 替换关卡代号中的 hd 为实际活动代号
 */
export async function replaceActivityCode(stage: string, clientType: string = DEFAULT_CLIENT_TYPE): Promise<string> {
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

    const runningProcess = taskStatus.process;
    try {
      if (taskStatus.stopRequested) {
        return { success: true, message: '终止请求已发送，正在等待任务退出' };
      }
      taskStatus.stopRequested = true;
      const sendSignal = (signal: NodeJS.Signals) => {
        if (process.platform !== 'win32' && runningProcess.pid) {
          try {
            process.kill(-runningProcess.pid, signal);
            return;
          } catch (error) {
            if (getErrorCode(error) !== 'ESRCH') throw error;
          }
        }
        runningProcess.kill(signal);
      };

      logger.warn('使用 SIGTERM 请求任务正常退出');
      addLog('WARN', '正在请求任务正常退出');
      sendSignal('SIGTERM');

      taskStatus.forceKillTimer = setTimeout(() => {
        if (taskStatus.process !== runningProcess || runningProcess.exitCode !== null) return;
        try {
          logger.warn('任务未及时退出，升级为 SIGKILL');
          addLog('WARN', '任务未及时退出，正在强制终止');
          sendSignal('SIGKILL');
        } catch (error) {
          logger.error('强制终止任务失败', { error: getErrorMessage(error) });
        }
      }, 3000);
      taskStatus.forceKillTimer.unref?.();

      return { success: true, message: '已发送终止请求' };
    } catch (error) {
      logger.error('终止任务失败', { error: getErrorMessage(error) });
      addLog('ERROR', `终止任务失败: ${getErrorMessage(error)}`);
      if (taskStatus.process === runningProcess) {
        taskStatus.stopRequested = false;
      }
      return { success: false, message: `终止失败: ${getErrorMessage(error)}` };
    }
  } else {
    // 进程引用不存在，但状态显示正在运行
    // 这种情况可能是任务刚启动还没有进程引用
    addLog('WARN', '任务正在启动中，无法立即终止');
    return { success: false, message: '任务正在启动中，暂时无法终止' };
  }
}

/**
 * 获取 MAA 日志目录
 */
async function getMaaLogDir() {
  try {
    const result = await execMaaCommand('dir', ['log'], null, null, false, true);
    return result.stdout.trim();
  } catch (error) {
    throw new Error(`获取日志目录失败: ${getErrorMessage(error)}`);
  }
}

async function collectMaaLogFiles(logDir: string): Promise<MaaLogFile[]> {
  const files: MaaLogFile[] = [];

  async function scanDir(dir: string, prefix = ''): Promise<void> {
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
  return files;
}

export async function createMaaLogCheckpoint() {
  try {
    const logPath = join(await getMaaLogDir(), 'asst.log');
    const logStats = await stat(logPath);
    return { logPath, size: logStats.size };
  } catch (error) {
    logger.debug('无法创建 Maa 日志检查点', { error: getErrorMessage(error) });
    return null;
  }
}

export async function readMaaLogSince(checkpoint: MaaLogCheckpoint | null, maxBytes = 2 * 1024 * 1024): Promise<string> {
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
    logger.debug('无法读取 Maa 增量日志', { error: getErrorMessage(error) });
    return '';
  }
}

/**
 * 获取日志文件列表
 */
export async function getLogFiles() {
  try {
    const logDir = await getMaaLogDir();
    const files = await collectMaaLogFiles(logDir);
    // 按修改时间倒序排序
    files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    return files;
  } catch (error) {
    logger.error('获取日志文件列表失败', { error: getErrorMessage(error) });
    return [];
  }
}

/**
 * 手动清理日志文件
 */
export async function cleanupLogs(maxSizeMB = 10): Promise<{ deletedCount: number; freedSpace: number }> {
  try {
    const sizeLimit = Number(maxSizeMB);
    if (!Number.isFinite(sizeLimit) || sizeLimit < 1 || sizeLimit > 1024) {
      throw new Error('日志保留上限必须在 1 到 1024 MB 之间');
    }

    const logDir = await getMaaLogDir();
    const files = await collectMaaLogFiles(logDir);
    files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    const maxSize = sizeLimit * 1024 * 1024;
    let totalSize = 0;
    const filesToDelete: MaaLogFile[] = [];

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
      freedSpace: filesToDelete.reduce((sum, file) => sum + file.size, 0)
    };
  } catch (error) {
    throw new Error(`清理日志失败: ${getErrorMessage(error)}`);
  }
}

/**
 * 读取日志文件内容
 */
export async function readLogFile(filePath: string, lines = 1000): Promise<{ content: string; totalLines: number; returnedLines: number }> {
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
    // 只读取文件尾部：历史日志可能很大，整文件读取会让打开日志页出现
    // 明显的内存与延迟尖峰。2 MiB 足够覆盖默认的最后 1000 行。
    const fileStats = await stat(requestedPath);
    const maxTailBytes = 2 * 1024 * 1024;
    const tailBytes = Math.min(fileStats.size, maxTailBytes);
    const startByte = Math.max(0, fileStats.size - tailBytes);
    const handle = await open(requestedPath, 'r');
    let tail = '';
    try {
      const buffer = Buffer.alloc(tailBytes);
      const { bytesRead } = await handle.read(buffer, 0, tailBytes, startByte);
      tail = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
    // 从中间开始时第一行可能被截断，丢弃它；从文件开头读取时保留首行。
    if (startByte > 0) {
      const firstNewline = tail.indexOf('\n');
      tail = firstNewline >= 0 ? tail.slice(firstNewline + 1) : '';
    }
    const allLines = tail.split('\n');

    // 只返回最后 N 行
    const startIndex = Math.max(0, allLines.length - lines);
    const selectedLines = allLines.slice(startIndex);

    return {
      content: selectedLines.join('\n'),
      totalLines: allLines.length,
      returnedLines: selectedLines.length
    };
  } catch (error) {
    throw new Error(`读取日志文件失败: ${getErrorMessage(error)}`);
  }
}

/**
 * 获取 MAA 调试截图列表
 */
export async function getDebugScreenshots(): Promise<MaaLogFile[]> {
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
      imageFiles.map(async file => {
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
    screenshots.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    return screenshots;
  } catch (error) {
    logger.error('获取调试截图失败', { error: getErrorMessage(error) });
    return [];
  }
}
