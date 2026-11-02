/**
 * 文件操作辅助工具 - 统一的文件读写逻辑
 */

import { randomUUID } from 'crypto';
import { mkdir, open, readFile, rename, unlink } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import { getErrorCode } from './errors.ts';

export class JsonFileParseError extends Error {
  declare code: string;
  declare filePath: string;
  declare cause: unknown;

  constructor(filePath: string, cause: unknown) {
    super(`读取 JSON 文件失败: ${(cause as Error)?.message || String(cause)}`);
    this.name = 'JsonFileParseError';
    this.code = 'JSON_FILE_PARSE_FAILED';
    this.filePath = filePath;
    this.cause = cause;
  }
}

export class FileReadError extends Error {
  declare code: string;
  declare filePath: string;
  declare cause: unknown;

  constructor(filePath: string, cause: unknown) {
    super(`读取 JSON 文件失败: ${(cause as Error)?.message || String(cause)}`);
    this.name = 'FileReadError';
    this.code = 'FILE_READ_FAILED';
    this.filePath = filePath;
    this.cause = cause;
  }
}

export class FileWriteError extends Error {
  declare code: string;
  declare filePath: string;
  declare committed: boolean;
  declare cause: unknown;

  constructor(filePath: string, committed: boolean, cause: unknown) {
    super(`写入 JSON 文件失败: ${(cause as Error)?.message || String(cause)}`);
    this.name = 'FileWriteError';
    this.code = 'FILE_WRITE_FAILED';
    this.filePath = filePath;
    this.committed = committed;
    this.cause = cause;
  }
}

const fileMutationQueues = new Map<string, Promise<unknown>>();

function enqueueFileMutation<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const queueKey = resolve(filePath);
  const previous = fileMutationQueues.get(queueKey) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  fileMutationQueues.set(queueKey, current);

  return current.finally(() => {
    if (fileMutationQueues.get(queueKey) === current) {
      fileMutationQueues.delete(queueKey);
    }
  });
}

async function syncDirectory(dirPath: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(dirPath, 'r');
    await handle.sync();
  } catch (error) {
    // Directory fsync is unavailable on some supported platforms. The file
    // itself has already been synced before rename, so only ignore that case.
    if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR', 'EBADF'].includes(getErrorCode(error) || '')) {
      throw error;
    }
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * 确保目录存在
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (getErrorCode(error) !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * 读取 JSON 文件
 */
export async function readJsonFile<T = unknown>(
  filePath: string,
  defaultValue: unknown = null
): Promise<T> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return defaultValue as T;
    throw new FileReadError(filePath, error);
  }

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new JsonFileParseError(filePath, error);
  }
}

async function writeJsonFileAtomic(filePath: string, data: unknown, pretty: boolean): Promise<void> {
  const targetPath = resolve(filePath);
  const targetDir = dirname(targetPath);
  let committed = false;
  let content: string;

  try {
    content = pretty
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
    if (typeof content !== 'string') {
      throw new TypeError('JSON 顶层值无法序列化');
    }

    await ensureDir(targetDir);

    const tempPath = join(
      targetDir,
      `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`
    );
    let handle: FileHandle | undefined;

    try {
      handle = await open(tempPath, 'wx', 0o600);
      await handle.writeFile(content, 'utf-8');
      await handle.sync();
      await handle.close();
      handle = undefined;

      await rename(tempPath, targetPath);
      committed = true;
      await syncDirectory(targetDir);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(tempPath).catch(cleanupError => {
        if (getErrorCode(cleanupError) !== 'ENOENT') throw cleanupError;
      });
      throw error;
    }
  } catch (error) {
    if (error instanceof FileWriteError) throw error;
    throw new FileWriteError(targetPath, committed, error);
  }
}

/**
 * 写入 JSON 文件
 */
export async function writeJsonFile(filePath: string, data: unknown, pretty = true): Promise<void> {
  try {
    await enqueueFileMutation(filePath, () => writeJsonFileAtomic(filePath, data, pretty));
  } catch (error) {
    if (error instanceof FileWriteError) throw error;
    throw new FileWriteError(resolve(filePath), false, error);
  }
}

/**
 * 安全地更新 JSON 文件（先读取，再合并，最后写入）
 */
export async function updateJsonFile<T = Record<string, unknown>>(
  filePath: string,
  updateFn: (data: T) => T | Promise<T>,
  defaultValue: unknown = {}
): Promise<T> {
  return enqueueFileMutation(filePath, async () => {
    const data = await readJsonFile<T>(filePath, defaultValue);
    const updated = await updateFn((data ?? defaultValue) as T);
    await writeJsonFileAtomic(filePath, updated, true);
    return updated;
  });
}

/**
 * 删除 JSON 文件，并与同路径的写入/更新操作串行化。
 */
export async function deleteJsonFile(filePath: string): Promise<boolean> {
  return enqueueFileMutation(filePath, async () => {
    try {
      await unlink(filePath);
      return true;
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT') return false;
      throw error;
    }
  });
}
