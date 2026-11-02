import { getErrorCode, isRecord } from '../utils/errors.ts';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { link, mkdir, open, readFile, unlink } from 'fs/promises';
import { hostname } from 'os';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const serviceDir = dirname(fileURLToPath(import.meta.url));
const defaultLockPath = join(serviceDir, '../data/maa-execution.lock');
const LEASE_VERSION = 1;

export interface MaaExecutionLeaseOwner {
  version: number;
  token: string;
  pid: number;
  host: string;
  source: string;
  taskName: string | null;
  command: string | null;
  runId: string | null;
  startedAt: string;
}

export interface MaaExecutionLeaseRequest {
  source?: string;
  taskName?: string | null;
  command?: string | null;
  runId?: string | null;
}

export interface MaaExecutionLease {
  owner: MaaExecutionLeaseOwner;
  lockPath: string;
  reentrant: boolean;
  release(): Promise<void>;
}

export interface MaaExecutionLeaseSnapshot {
  state: 'free' | 'held' | 'stale' | 'unknown';
  lockPath: string;
  owner: MaaExecutionLeaseOwner | null;
  legacy?: boolean;
}

type MaaExecutionBusyOwner = Partial<MaaExecutionLeaseOwner> & {
  unknown?: boolean;
  lockPath?: string;
};

const executionContext = new AsyncLocalStorage<{ lease: MaaExecutionLease; depth: number }>();

let admissionClosed = false;
let admissionReason: string | null = null;

export class MaaExecutionBusyError extends Error {
  declare code: string;
  declare statusCode: number;
  declare retryable: boolean;
  declare owner: MaaExecutionBusyOwner | null;
  declare details: { owner: MaaExecutionBusyOwner | null };

  constructor(owner: MaaExecutionBusyOwner | null = null) {
    super(owner?.taskName ? `MAA 正在执行：${owner.taskName}` : 'MAA 正在被其他任务使用');
    this.name = 'MaaExecutionBusyError';
    this.code = 'MAA_EXECUTION_BUSY';
    this.statusCode = 409;
    this.retryable = true;
    this.owner = owner;
    this.details = { owner };
  }
}

export class MaaExecutionShutdownError extends Error {
  declare code: string;
  declare statusCode: number;
  declare retryable: boolean;
  declare details: { reason: string | null };

  constructor(reason: string | null = null) {
    super('服务正在关闭，不再接受新的 MAA 执行');
    this.name = 'MaaExecutionShutdownError';
    this.code = 'MAA_EXECUTION_SHUTTING_DOWN';
    this.statusCode = 503;
    this.retryable = true;
    this.details = { reason };
  }
}

function getLockPath(): string {
  return process.env.LA_PLUMA_MAA_LOCK_FILE || defaultLockPath;
}

function isProcessAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return getErrorCode(error) === 'EPERM';
  }
}

function normalizeOwner(record: unknown): MaaExecutionLeaseOwner | null {
  if (!isRecord(record) || !Number.isInteger(record.pid) || (record.pid as number) <= 0) return null;
  if (record.version !== undefined && record.version !== LEASE_VERSION) return null;
  if (record.version === LEASE_VERSION) {
    if (typeof record.token !== 'string' || !record.token) return null;
    if (typeof record.host !== 'string' || !record.host) return null;
    if (typeof record.startedAt !== 'string' || !record.startedAt) return null;
  }
  return {
    version: typeof record.version === 'number' ? record.version : 0,
    token: typeof record.token === 'string' ? record.token : '',
    pid: record.pid as number,
    host: typeof record.host === 'string' ? record.host : '',
    source: typeof record.source === 'string' ? record.source : 'unknown',
    taskName: typeof record.taskName === 'string' ? record.taskName : null,
    command: typeof record.command === 'string' ? record.command : null,
    runId: typeof record.runId === 'string' ? record.runId : null,
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : ''
  };
}

type LeaseReadState =
  | { state: 'missing' }
  | { state: 'present'; owner: MaaExecutionLeaseOwner; legacy: boolean }
  | { state: 'invalid' }
  | { state: 'unreadable'; error: unknown };

async function readLeaseState(lockPath: string): Promise<LeaseReadState> {
  let content: string;
  try {
    content = await readFile(lockPath, 'utf8');
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return { state: 'missing' };
    return { state: 'unreadable', error };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { state: 'invalid' };
  }
  const owner = normalizeOwner(parsed);
  if (!owner) return { state: 'invalid' };
  return { state: 'present', owner, legacy: owner.version !== LEASE_VERSION };
}

async function removeLockIfMatches(lockPath: string, expected: MaaExecutionLeaseOwner): Promise<boolean> {
  const current = await readLeaseState(lockPath);
  if (current.state === 'missing') return true;
  if (current.state !== 'present') return false;
  if (current.owner.token && current.owner.token !== expected.token) return false;
  await unlink(lockPath).catch(error => {
    if (getErrorCode(error) !== 'ENOENT') throw error;
  });
  return true;
}

async function publishLock(lockPath: string, metadata: MaaExecutionLeaseOwner): Promise<void> {
  const tempPath = join(
    dirname(lockPath),
    `.${basename(lockPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  const handle = await open(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(metadata, null, 2));
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }

  try {
    await link(tempPath, lockPath);
  } catch (error) {
    const code = getErrorCode(error);
    if (code && ['EPERM', 'ENOTSUP', 'EACCES', 'EXDEV'].includes(code)) {
      // Some filesystems do not support hard links. O_EXCL still prevents a
      // second writer; readers treat an incomplete record as unknown and fail closed.
      const fallback = await open(lockPath, 'wx', 0o600);
      try {
        await fallback.writeFile(JSON.stringify(metadata, null, 2));
        await fallback.sync();
      } finally {
        await fallback.close().catch(() => undefined);
      }
    } else {
      throw error;
    }
  } finally {
    await unlink(tempPath).catch(error => {
      if (getErrorCode(error) !== 'ENOENT') throw error;
    });
  }
}

export async function getMaaExecutionLeaseSnapshot(): Promise<MaaExecutionLeaseSnapshot> {
  const lockPath = getLockPath();
  const current = await readLeaseState(lockPath);
  if (current.state === 'missing') {
    return { state: 'free', lockPath, owner: null };
  }
  if (current.state === 'invalid' || current.state === 'unreadable') {
    return { state: 'unknown', lockPath, owner: null };
  }
  const alive = isProcessAlive(current.owner.pid);
  return {
    state: alive ? 'held' : 'stale',
    lockPath,
    owner: current.owner,
    legacy: current.legacy
  };
}

export function closeMaaExecutionLeaseAdmission(reason: string | null = null): void {
  admissionClosed = true;
  admissionReason = reason;
}

export function resetMaaExecutionLeaseForTests(): void {
  admissionClosed = false;
  admissionReason = null;
}

export async function acquireMaaExecutionLease(
  request: MaaExecutionLeaseRequest = {}
): Promise<MaaExecutionLease> {
  if (admissionClosed) throw new MaaExecutionShutdownError(admissionReason);

  const active = executionContext.getStore();
  if (active?.lease) {
    active.depth += 1;
    return {
      ...active.lease,
      reentrant: true,
      release: async () => {
        active.depth = Math.max(1, active.depth - 1);
      }
    };
  }

  const lockPath = getLockPath();
  await mkdir(dirname(lockPath), { recursive: true });
  const metadata: MaaExecutionLeaseOwner = {
    version: LEASE_VERSION,
    token: randomUUID(),
    pid: process.pid,
    host: process.env.LA_PLUMA_HOST_ID || hostname(),
    source: request.source || 'maa-command',
    taskName: request.taskName || null,
    command: request.command || null,
    runId: request.runId || null,
    startedAt: new Date().toISOString()
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readLeaseState(lockPath);
    if (current.state === 'missing') {
      try {
        await publishLock(lockPath, metadata);
      } catch (error) {
        if (getErrorCode(error) === 'EEXIST') continue;
        throw error;
      }
      let released = false;
      return {
        owner: metadata,
        lockPath,
        reentrant: false,
        release: async () => {
          if (released) return;
          released = true;
          await removeLockIfMatches(lockPath, metadata);
        }
      };
    }

    if (current.state === 'invalid' || current.state === 'unreadable') {
      throw new MaaExecutionBusyError({ taskName: null, unknown: true, lockPath });
    }

    if (isProcessAlive(current.owner.pid)) {
      throw new MaaExecutionBusyError(current.owner);
    }

    await removeLockIfMatches(lockPath, current.owner).catch(() => false);
  }

  throw new MaaExecutionBusyError({ taskName: null, unknown: true, lockPath });
}

export async function withMaaExecutionLease<T>(
  request: MaaExecutionLeaseRequest,
  callback: (lease: MaaExecutionLease) => Promise<T>
): Promise<T> {
  const active = executionContext.getStore();
  if (active?.lease) return callback(active.lease);

  const lease = await acquireMaaExecutionLease(request);
  try {
    return await executionContext.run({ lease, depth: 1 }, () => callback(lease));
  } finally {
    await lease.release();
  }
}
