import { AsyncLocalStorage } from 'async_hooks';
import { mkdir, open, readFile, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const serviceDir = dirname(fileURLToPath(import.meta.url));
const defaultLockPath = join(serviceDir, '../data/maa-execution.lock');
const executionContext = new AsyncLocalStorage();

export class MaaExecutionBusyError extends Error {
  constructor(owner = null) {
    super(owner?.taskName ? `MAA 正在执行：${owner.taskName}` : 'MAA 正在被其他任务使用');
    this.name = 'MaaExecutionBusyError';
    this.code = 'MAA_EXECUTION_BUSY';
    this.statusCode = 409;
    this.retryable = true;
    this.owner = owner;
    this.details = { owner };
  }
}

function getLockPath() {
  return process.env.LA_PLUMA_MAA_LOCK_FILE || defaultLockPath;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function readOwner(lockPath = getLockPath()) {
  try {
    return JSON.parse(await readFile(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

async function removeStaleLock(lockPath) {
  const owner = await readOwner(lockPath);
  if (owner && isProcessAlive(Number(owner.pid))) return owner;
  await unlink(lockPath).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return null;
}

export async function acquireMaaExecutionLease(owner = {}) {
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
  const metadata = {
    pid: process.pid,
    source: owner.source || 'maa-command',
    taskName: owner.taskName || null,
    command: owner.command || null,
    startedAt: new Date().toISOString()
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify(metadata, null, 2));
      await handle.close();
      let released = false;
      return {
        owner: metadata,
        lockPath,
        reentrant: false,
        release: async () => {
          if (released) return;
          released = true;
          const currentOwner = await readOwner(lockPath);
          if (!currentOwner || currentOwner.pid === process.pid) {
            await unlink(lockPath).catch(error => {
              if (error?.code !== 'ENOENT') throw error;
            });
          }
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const liveOwner = await removeStaleLock(lockPath);
      if (liveOwner) throw new MaaExecutionBusyError(liveOwner);
    }
  }

  throw new MaaExecutionBusyError(await readOwner(lockPath));
}

export async function withMaaExecutionLease(owner, callback) {
  const active = executionContext.getStore();
  if (active?.lease) return callback(active.lease);

  const lease = await acquireMaaExecutionLease(owner);
  const store = { lease, depth: 1 };
  try {
    return await executionContext.run(store, () => callback(lease));
  } finally {
    await lease.release();
  }
}
