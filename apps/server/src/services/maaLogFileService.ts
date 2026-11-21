import { createHash } from 'node:crypto';
import { readdir, stat, unlink, realpath, open } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createLogger } from '../utils/logger.ts';
import { resolveBoundedInteger } from '../utils/numericQueryHelper.ts';
import { resolveMaaPaths } from '../config/paths.ts';
import { execMaaCommandUnlocked } from './maaProcessService.ts';

const logger = createLogger('MaaService');

// 读取日志文件时的行数上限；/logs/files 的 lines 参数按它夹取。
export const MAX_LOG_FILE_LINES = 5000;

/** 单次读取日志内容的最大字节数；尾部读取不会把整份大日志载入内存。 */
export const MAX_LOG_FILE_READ_BYTES = 2 * 1024 * 1024;

const LOG_READ_CHUNK_BYTES = 64 * 1024;

export interface MaaLogFileEntry {
  name: string;
  path: string;
  size: number;
  modified: string;
}

/** 文件身份：同一个路径上的日志被替换或重命名后，dev/ino 会变化。 */
export interface MaaLogFileIdentity {
  dev: number;
  ino: number;
}

/** 检查点边界之前若干字节的摘要，用于识别同 inode 的原地截断后重新增长。 */
export interface MaaLogFileAnchor {
  length: number;
  sha256: string;
}

export interface MaaLogCheckpoint {
  logPath: string;
  size: number;
  identity?: MaaLogFileIdentity;
  anchor?: MaaLogFileAnchor;
}

export type MaaLogIncrementStatus = 'ok' | 'unreadable' | 'truncated' | 'rotated';

/** 增量日志读取结果；`text` 按原文返回，完整性由 `status` 标明。 */
export interface MaaLogIncrement {
  status: MaaLogIncrementStatus;
  text: string;
}

/** 向前读取的日志块；`nextCheckpoint` 只前进到最后一个完整行，未完成行留待下次。 */
export interface MaaLogChunk {
  status: MaaLogIncrementStatus;
  text: string;
  nextCheckpoint: MaaLogCheckpoint;
  caughtUp: boolean;
}

export interface MaaLogFileStats {
  size: number;
  dev?: number;
  ino?: number;
}

/** 检查点保留的边界前摘要长度；取会话内容而不是固定日志头，又不随文件增长变大。 */
const LOG_ANCHOR_BYTES = 256;

/** 每次向前读取日志的默认预算；按真实回调日志约 8 KB/s 留有充足余量。 */
const LOG_CHUNK_DEFAULT_BYTES = 256 * 1024;

export interface MaaLogFileHandle {
  stat?(): Promise<MaaLogFileStats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number; buffer: Buffer }>;
  close(): Promise<void>;
}

export interface MaaLogCheckpointPorts {
  resolveLogDir?(): Promise<string>;
  stat?(path: string): Promise<MaaLogFileStats>;
  open?(path: string, flags: 'r'): Promise<MaaLogFileHandle>;
}

export interface MaaLogReadPorts {
  stat?(path: string): Promise<MaaLogFileStats>;
  open?(path: string, flags: 'r'): Promise<MaaLogFileHandle>;
}

interface OpenMaaLog {
  handle: MaaLogFileHandle;
  stats: MaaLogFileStats;
}

export interface MaaLogFileContent {
  content: string;
  totalLines: number;
  returnedLines: number;
}

export interface MaaLogCleanupResult {
  deletedCount: number;
  freedSpace: number;
}

export interface MaaDebugScreenshot {
  name: string;
  path: string;
  size: number;
  modified: string;
}

/** 目录边界判定所需的 path 能力；可注入 path.win32/path.posix 验证跨平台策略。 */
export interface MaaPathPolicy {
  relative(from: string, to: string): string;
  readonly sep: string;
  isAbsolute(path: string): boolean;
}

/**
 * 获取 MAA 日志目录
 *
 * 目录由进程环境决定，一次进程生命周期内不变；`/logs/files`、检查点与
 * 增量读取共享同一次 CLI 查询。失败在短冷却期内复用同一个错误。
 */
let logDirPromise: Promise<string> | null = null;
let logDirFailure: { error: unknown; at: number } | null = null;

/** 日志目录查询失败后的冷却时间，避免 CLI 故障时每次读取都重新 spawn。 */
const LOG_DIR_FAILURE_TTL_MS = 30_000;

async function getMaaLogDir(): Promise<string> {
  const now = Date.now();
  if (logDirFailure) {
    if (now - logDirFailure.at < LOG_DIR_FAILURE_TTL_MS) throw logDirFailure.error;
    logDirFailure = null;
  }
  if (!logDirPromise) {
    logDirPromise = execMaaCommandUnlocked('dir', ['log'], null, null, false, true)
      .then(result => result.stdout.trim())
      .catch(error => {
        const wrapped = new Error(`获取日志目录失败: ${error instanceof Error ? error.message : String(error)}`);
        logDirFailure = { error: wrapped, at: Date.now() };
        logDirPromise = null;
        throw wrapped;
      });
  }
  return logDirPromise;
}

async function collectMaaLogFiles(logDir: string): Promise<MaaLogFileEntry[]> {
  const files: MaaLogFileEntry[] = [];

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

function readLogIdentity(stats: MaaLogFileStats): MaaLogFileIdentity | null {
  const dev = Number(stats.dev);
  const ino = Number(stats.ino);
  if (!Number.isFinite(dev) || !Number.isFinite(ino) || ino <= 0) return null;
  return { dev, ino };
}

function sameLogIdentity(first: MaaLogFileIdentity, second: MaaLogFileIdentity | null): boolean {
  return second !== null && first.dev === second.dev && first.ino === second.ino;
}

function digestBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readLogAnchor(
  handle: MaaLogFileHandle,
  size: number
): Promise<MaaLogFileAnchor | null> {
  const length = Math.min(Math.max(size, 0), LOG_ANCHOR_BYTES);
  if (length === 0) return null;
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, size - length);
  if (bytesRead !== length) return null;
  return { length, sha256: digestBytes(buffer) };
}

export async function createMaaLogCheckpoint(
  ports: MaaLogCheckpointPorts = {}
): Promise<MaaLogCheckpoint | null> {
  const resolveLogDir = ports.resolveLogDir || getMaaLogDir;
  const statFile = ports.stat || stat;
  const openFile = ports.open || open;
  try {
    const logPath = join(await resolveLogDir(), 'asst.log');
    const handle = await openFile(logPath, 'r');
    try {
      const logStats = await (handle.stat?.() ?? statFile(logPath));
      const checkpoint: MaaLogCheckpoint = { logPath, size: logStats.size };
      const identity = readLogIdentity(logStats);
      if (identity) checkpoint.identity = identity;
      const anchor = await readLogAnchor(handle, checkpoint.size);
      if (anchor) checkpoint.anchor = anchor;
      return checkpoint;
    } finally {
      await handle.close();
    }
  } catch (error) {
    logger.debug('无法创建 Maa 日志检查点', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function matchesCheckpointAnchor(handle: MaaLogFileHandle, checkpoint: MaaLogCheckpoint): Promise<boolean> {
  const anchor = checkpoint.anchor;
  if (!anchor) return true;
  const buffer = Buffer.alloc(anchor.length);
  const { bytesRead } = await handle.read(buffer, 0, anchor.length, checkpoint.size - anchor.length);
  return bytesRead === anchor.length && digestBytes(buffer) === anchor.sha256;
}

async function isCurrentLog(
  path: string,
  stats: MaaLogFileStats,
  statFile: NonNullable<MaaLogReadPorts['stat']>
): Promise<boolean> {
  const identity = readLogIdentity(stats);
  if (!identity) return true;
  const current = await statFile(path);
  return current.size >= stats.size && sameLogIdentity(identity, readLogIdentity(current));
}

async function readLogSegment(
  handle: MaaLogFileHandle,
  buffer: Buffer,
  offset: number,
  length: number,
  end: number
): Promise<number> {
  if (length === 0) return 0;
  const { bytesRead } = await handle.read(buffer, offset, length, end - length);
  return bytesRead;
}

async function readRotatedLog(
  checkpoint: MaaLogCheckpoint,
  current: OpenMaaLog,
  maxBytes: number,
  ports: Required<MaaLogReadPorts>
): Promise<MaaLogIncrement> {
  const rotated: MaaLogIncrement = { status: 'rotated', text: '' };
  if (!checkpoint.identity || (checkpoint.size > 0 && !checkpoint.anchor) || basename(checkpoint.logPath) !== 'asst.log') {
    return rotated;
  }

  const backupPath = join(dirname(checkpoint.logPath), 'asst.bak.log');
  const backup = await ports.open(backupPath, 'r').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!backup) return rotated;

  try {
    const backupStats = await (backup.stat?.() ?? ports.stat(backupPath));
    if (backupStats.size < checkpoint.size
      || !sameLogIdentity(checkpoint.identity, readLogIdentity(backupStats))
      || !(await matchesCheckpointAnchor(backup, checkpoint))) {
      return rotated;
    }

    const availableBackupBytes = backupStats.size - checkpoint.size;
    const activeBytes = Math.min(current.stats.size, maxBytes);
    const backupBytes = Math.min(availableBackupBytes, maxBytes - activeBytes);
    const buffer = Buffer.alloc(backupBytes + activeBytes);
    const backupRead = await readLogSegment(backup, buffer, 0, backupBytes, backupStats.size);
    const activeRead = await readLogSegment(current.handle, buffer, backupBytes, activeBytes, current.stats.size);
    if (!(await isCurrentLog(checkpoint.logPath, current.stats, ports.stat))) return rotated;

    const complete = backupBytes === availableBackupBytes && activeBytes === current.stats.size
      && backupRead === backupBytes && activeRead === activeBytes;
    const start = backupRead === backupBytes ? 0 : backupBytes;
    return {
      status: complete ? 'rotated' : 'truncated',
      text: buffer.subarray(start, backupBytes + activeRead).toString('utf-8')
    };
  } finally {
    await backup.close();
  }
}

/**
 * 读取检查点之后的增量日志并标明完整性：`ok` 表示拿到了全部新增字节，
 * `unreadable` 表示检查点或文件不可读，`truncated` 表示只拿到部分新增内容
 * （文件回绕变小、超出单次读取上限或单次读取不足）。`rotated` 表示日志已替换
 * 或重写，可携带从轮转备份恢复的新增内容。依赖「没有读到某类回调」下结论的
 * 调用方只能接受 `ok`。
 */
export async function readMaaLogIncrement(
  checkpoint: MaaLogCheckpoint | null,
  maxBytes = 2 * 1024 * 1024,
  ports: MaaLogReadPorts = {}
): Promise<MaaLogIncrement> {
  if (!checkpoint?.logPath) return { status: 'unreadable', text: '' };

  const statFile = ports.stat || stat;
  const openFile = ports.open || open;
  try {
    const handle = await openFile(checkpoint.logPath, 'r');
    try {
      const logStats = await (handle.stat?.() ?? statFile(checkpoint.logPath));
      const identity = readLogIdentity(logStats);
      if (checkpoint.identity && identity && !sameLogIdentity(checkpoint.identity, identity)) {
        return await readRotatedLog(checkpoint, { handle, stats: logStats }, maxBytes, { stat: statFile, open: openFile });
      }
      if (logStats.size < checkpoint.size) return { status: 'truncated', text: '' };
      if (!(await matchesCheckpointAnchor(handle, checkpoint))) {
        return { status: 'rotated', text: '' };
      }

      const availableBytes = logStats.size - checkpoint.size;
      const bytesToRead = Math.min(availableBytes, maxBytes);
      const buffer = Buffer.alloc(bytesToRead);
      const bytesRead = await readLogSegment(handle, buffer, 0, bytesToRead, logStats.size);
      if (!(await isCurrentLog(checkpoint.logPath, logStats, statFile))) return { status: 'rotated', text: '' };
      const complete = bytesToRead === availableBytes && bytesRead === bytesToRead;
      return { status: complete ? 'ok' : 'truncated', text: buffer.subarray(0, bytesRead).toString('utf-8') };
    } finally {
      await handle.close();
    }
  } catch (error) {
    logger.debug('无法读取 Maa 增量日志', { error: error instanceof Error ? error.message : String(error) });
    return { status: 'unreadable', text: '' };
  }
}

export async function readMaaLogSince(
  checkpoint: MaaLogCheckpoint | null,
  maxBytes = 2 * 1024 * 1024,
  ports: MaaLogReadPorts = {}
): Promise<string> {
  return (await readMaaLogIncrement(checkpoint, maxBytes, ports)).text;
}

function resolveLogChunkBudget(maxBytes: number): number {
  return Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.max(1, Math.floor(maxBytes))
    : LOG_CHUNK_DEFAULT_BYTES;
}

async function readLogBytesAt(
  handle: MaaLogFileHandle,
  position: number,
  length: number
): Promise<{ buffer: Buffer; bytesRead: number }> {
  if (length <= 0) return { buffer: Buffer.alloc(0), bytesRead: 0 };
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  const safeBytes = Math.max(0, Math.min(bytesRead, length));
  return { buffer: buffer.subarray(0, safeBytes), bytesRead: safeBytes };
}

async function buildLogChunkCheckpoint(
  handle: MaaLogFileHandle,
  checkpoint: MaaLogCheckpoint,
  size: number,
  stats: MaaLogFileStats,
  reuseMissing: boolean
): Promise<MaaLogCheckpoint> {
  const nextCheckpoint: MaaLogCheckpoint = { logPath: checkpoint.logPath, size };
  const identity = readLogIdentity(stats);
  if (identity) nextCheckpoint.identity = identity;
  else if (reuseMissing && checkpoint.identity) nextCheckpoint.identity = checkpoint.identity;
  const anchor = await readLogAnchor(handle, size);
  if (anchor) nextCheckpoint.anchor = anchor;
  else if (reuseMissing && size === checkpoint.size && checkpoint.anchor) nextCheckpoint.anchor = checkpoint.anchor;
  return nextCheckpoint;
}

async function readRotationBackupBytes(
  checkpoint: MaaLogCheckpoint,
  maxBytes: number,
  ports: Required<MaaLogReadPorts>
): Promise<Buffer> {
  if (!checkpoint.identity || (checkpoint.size > 0 && !checkpoint.anchor) || basename(checkpoint.logPath) !== 'asst.log') {
    return Buffer.alloc(0);
  }

  const backupPath = join(dirname(checkpoint.logPath), 'asst.bak.log');
  let backup: MaaLogFileHandle | null = null;
  try {
    backup = await ports.open(backupPath, 'r').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    });
    if (!backup) return Buffer.alloc(0);

    const backupStats = await (backup.stat?.() ?? ports.stat(backupPath));
    if (backupStats.size < checkpoint.size
      || !sameLogIdentity(checkpoint.identity, readLogIdentity(backupStats))
      || !(await matchesCheckpointAnchor(backup, checkpoint))) {
      return Buffer.alloc(0);
    }

    const availableBytes = backupStats.size - checkpoint.size;
    const { buffer } = await readLogBytesAt(backup, checkpoint.size, Math.min(availableBytes, maxBytes));
    return buffer;
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (backup) await backup.close().catch(() => undefined);
  }
}

async function readRotatedLogChunk(
  checkpoint: MaaLogCheckpoint,
  current: OpenMaaLog,
  maxBytes: number,
  ports: Required<MaaLogReadPorts>
): Promise<MaaLogChunk> {
  const backupBytes = await readRotationBackupBytes(checkpoint, maxBytes, ports);
  const activeBudget = Math.max(0, maxBytes - backupBytes.length);
  const active = await readLogBytesAt(current.handle, 0, Math.min(current.stats.size, activeBudget));
  const combined = Buffer.concat([backupBytes, active.buffer]);
  const lastNewline = combined.lastIndexOf(0x0a);
  const nextSize = lastNewline >= 0 ? Math.max(0, lastNewline + 1 - backupBytes.length) : 0;
  const nextCheckpoint = await buildLogChunkCheckpoint(current.handle, checkpoint, nextSize, current.stats, false);
  return {
    status: 'rotated',
    text: lastNewline >= 0 ? combined.subarray(0, lastNewline + 1).toString('utf-8') : '',
    nextCheckpoint,
    caughtUp: active.bytesRead === current.stats.size
  };
}

async function readRotatedLogChunkFromPath(
  checkpoint: MaaLogCheckpoint,
  maxBytes: number,
  ports: Required<MaaLogReadPorts>
): Promise<MaaLogChunk> {
  const handle = await ports.open(checkpoint.logPath, 'r');
  try {
    const stats = await (handle.stat?.() ?? ports.stat(checkpoint.logPath));
    return await readRotatedLogChunk(checkpoint, { handle, stats }, maxBytes, ports);
  } finally {
    await handle.close();
  }
}

async function readMaaLogChunkInternal(
  checkpoint: MaaLogCheckpoint,
  maxBytes: number,
  ports: Required<MaaLogReadPorts>,
  allowRotationRetry: boolean
): Promise<MaaLogChunk> {
  try {
    const handle = await ports.open(checkpoint.logPath, 'r');
    try {
      const logStats = await (handle.stat?.() ?? ports.stat(checkpoint.logPath));
      const identity = readLogIdentity(logStats);
      const identityChanged = checkpoint.identity !== undefined
        && identity !== null
        && !sameLogIdentity(checkpoint.identity, identity);
      const rotated = identityChanged
        || logStats.size < checkpoint.size
        || !(await matchesCheckpointAnchor(handle, checkpoint));
      if (rotated) {
        return await readRotatedLogChunk(checkpoint, { handle, stats: logStats }, maxBytes, ports);
      }

      const availableBytes = logStats.size - checkpoint.size;
      const read = await readLogBytesAt(handle, checkpoint.size, Math.min(availableBytes, maxBytes));
      if (!(await isCurrentLog(checkpoint.logPath, logStats, ports.stat))) {
        if (allowRotationRetry) return await readMaaLogChunkInternal(checkpoint, maxBytes, ports, false);
        return await readRotatedLogChunkFromPath(checkpoint, maxBytes, ports);
      }

      const caughtUp = read.bytesRead === availableBytes;
      const lastNewline = read.buffer.lastIndexOf(0x0a);
      const nextSize = lastNewline >= 0 ? checkpoint.size + lastNewline + 1 : checkpoint.size;
      const nextCheckpoint = await buildLogChunkCheckpoint(handle, checkpoint, nextSize, logStats, true);
      return {
        status: caughtUp ? 'ok' : 'truncated',
        text: lastNewline >= 0 ? read.buffer.subarray(0, lastNewline + 1).toString('utf-8') : '',
        nextCheckpoint,
        caughtUp
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    logger.debug('无法读取 Maa 日志块', { error: error instanceof Error ? error.message : String(error) });
    return { status: 'unreadable', text: '', nextCheckpoint: checkpoint, caughtUp: false };
  }
}

/**
 * 从检查点向前读取日志，只返回完整行组成的块。
 *
 * 与 `readMaaLogIncrement` 不同，超出 `maxBytes` 时保留起点而不是退化为尾部窗口；
 * `nextCheckpoint` 停在最后一个完整换行，末尾半行留给下次读取。检测到轮转时尽量从
 * `asst.bak.log` 补齐，并让 `nextCheckpoint` 始终指向当前 `asst.log` 的可继续位置。
 */
export async function readMaaLogChunk(
  checkpoint: MaaLogCheckpoint,
  maxBytes: number,
  ports: MaaLogReadPorts = {}
): Promise<MaaLogChunk> {
  const readPorts: Required<MaaLogReadPorts> = {
    stat: ports.stat || stat,
    open: ports.open || open
  };
  return readMaaLogChunkInternal(checkpoint, resolveLogChunkBudget(maxBytes), readPorts, true);
}

export async function getLogFiles(): Promise<MaaLogFileEntry[]> {
  try {
    const logDir = await getMaaLogDir();
    const files = await collectMaaLogFiles(logDir);
    files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    return files;
  } catch (error) {
    logger.error('获取日志文件列表失败', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

export async function cleanupLogs(maxSizeMB: unknown = 10): Promise<MaaLogCleanupResult> {
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
    const filesToDelete: MaaLogFileEntry[] = [];

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
    throw new Error(`清理日志失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 判断目标路径是否落在目录之外；等于目录本身同样视为越界。
 * pathImpl 可注入 path.win32 等实现，使 Windows 路径策略可以脱离运行平台验证。
 */
export function isPathOutsideDir(
  logDir: string,
  requestedPath: string,
  pathImpl: MaaPathPolicy = { relative, sep, isAbsolute }
): boolean {
  const relativePath = pathImpl.relative(logDir, requestedPath);
  return !relativePath
    || relativePath === '..'
    || relativePath.startsWith(`..${pathImpl.sep}`)
    || pathImpl.isAbsolute(relativePath);
}

/**
 * 从文件尾部读取最多 MAX_LOG_FILE_READ_BYTES 字节，并标明是否从文件开头开始。
 * 分块读取避免一次性分配整个文件大小的缓冲区。
 */
async function readLogTail(
  handle: MaaLogFileHandle,
  fileSize: number
): Promise<{ text: string; startsAtBeginning: boolean; startsAtLineBoundary: boolean }> {
  const bytesToRead = Math.min(fileSize, MAX_LOG_FILE_READ_BYTES);
  const start = fileSize - bytesToRead;
  const buffer = Buffer.alloc(bytesToRead);
  let offset = 0;
  while (offset < bytesToRead) {
    const chunkSize = Math.min(LOG_READ_CHUNK_BYTES, bytesToRead - offset);
    const { bytesRead } = await handle.read(buffer, offset, chunkSize, start + offset);
    if (bytesRead <= 0) break;
    offset += bytesRead;
  }

  let startsAtLineBoundary = start === 0;
  if (start > 0) {
    // 窗口可能从某行中间开始；先看窗口前一个字节，决定是否丢弃首行残片。
    const boundary = Buffer.alloc(1);
    const { bytesRead } = await handle.read(boundary, 0, 1, start - 1);
    startsAtLineBoundary = bytesRead === 1 && boundary[0] === 0x0a;
  }

  return {
    text: buffer.subarray(0, offset).toString('utf-8'),
    startsAtBeginning: start === 0,
    startsAtLineBoundary
  };
}

/** 分块统计换行符，保留 `totalLines` 的既有语义且不把整份文件留在内存。 */
async function countLogLines(handle: MaaLogFileHandle, fileSize: number): Promise<number> {
  const buffer = Buffer.alloc(LOG_READ_CHUNK_BYTES);
  let position = 0;
  let newlines = 0;
  while (position < fileSize) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, fileSize - position), position);
    if (bytesRead <= 0) break;
    for (let index = 0; index < bytesRead; index += 1) {
      if (buffer[index] === 0x0a) newlines += 1;
    }
    position += bytesRead;
  }
  // split('\n') 语义：换行数 + 1，空文件也有一行空内容。
  return newlines + 1;
}

/**
 * 读取日志文件内容
 *
 * 只从文件尾部按块读取，单次最多 MAX_LOG_FILE_READ_BYTES 字节；返回最后
 * `lines` 行，并保留结尾换行对应的空行（与 split('\n') 的既有语义一致）。
 */
export async function readLogFile(filePath: string, lines: unknown = 1000): Promise<MaaLogFileContent> {
  // 直接调用也受限：非法输入回落默认值，有限值截断并夹取到公开行数上限。
  const lineCount = resolveBoundedInteger(lines, {
    defaultValue: 1000,
    min: 1,
    max: MAX_LOG_FILE_LINES
  });
  try {
    const logDir = await realpath(resolve(await getMaaLogDir()));
    const requestedPath = await realpath(resolve(filePath));

    if (isPathOutsideDir(logDir, requestedPath) || extname(requestedPath).toLowerCase() !== '.log') {
      throw new Error('只能读取 MAA 日志目录内的文件');
    }

    const fileStats = await stat(requestedPath);
    const handle = await open(requestedPath, 'r');
    try {
      const tail = await readLogTail(handle, fileStats.size);
      const allLines = tail.text.split('\n');
      if (!tail.startsAtBeginning && !tail.startsAtLineBoundary) {
        // 首元素是从窗口起点截断的行残片，不属于“最后 N 行”。
        allLines.shift();
      }

      const totalLines = tail.startsAtBeginning
        ? tail.text.split('\n').length
        : await countLogLines(handle, fileStats.size);

      const startIndex = Math.max(0, allLines.length - lineCount);
      const selectedLines = allLines.slice(startIndex);

      return {
        content: selectedLines.join('\n'),
        totalLines,
        returnedLines: selectedLines.length
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw new Error(`读取日志文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function getDebugScreenshots(): Promise<MaaDebugScreenshot[]> {
  try {
    // MAA 的状态目录（Linux 为 XDG_STATE_HOME/maa）下才是调试产物目录；
    // 不能用配置目录的相邻目录推算，否则会落到 ~/.config/debug。
    const debugDir = join(resolveMaaPaths().stateDir, 'debug');

    logger.debug('调试目录', { debugDir });

    const files = await readdir(debugDir);

    const imageFiles = files.filter(file =>
      file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')
    );

    // 获取文件信息；响应只暴露文件名，不返回服务器绝对路径。
    const screenshots = await Promise.all(
      imageFiles.map(async (file) => {
        const filePath = join(debugDir, file);
        const stats = await stat(filePath);
        return {
          name: file,
          path: file,
          size: stats.size,
          modified: stats.mtime.toISOString()
        };
      })
    );

    screenshots.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    return screenshots;
  } catch (error) {
    logger.error('获取调试截图失败', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}
