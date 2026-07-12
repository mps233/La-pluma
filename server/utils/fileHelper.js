/**
 * 文件操作辅助工具 - 统一的文件读写逻辑
 */

import { randomUUID } from 'crypto';
import { access, mkdir, open, readFile, rename, unlink } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';

const fileMutationQueues = new Map();

function enqueueFileMutation(filePath, operation) {
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

async function syncDirectory(dirPath) {
  let handle;
  try {
    handle = await open(dirPath, 'r');
    await handle.sync();
  } catch (error) {
    // Directory fsync is unavailable on some supported platforms. The file
    // itself has already been synced before rename, so only ignore that case.
    if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR', 'EBADF'].includes(error?.code)) {
      throw error;
    }
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * 确保目录存在
 */
export async function ensureDir(dirPath) {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * 检查文件是否存在
 */
export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取 JSON 文件
 */
export async function readJsonFile(filePath, defaultValue = null) {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return defaultValue;
    }
    throw new Error(`读取 JSON 文件失败: ${error.message}`);
  }
}

async function writeJsonFileAtomic(filePath, data, pretty) {
  const targetPath = resolve(filePath);
  const targetDir = dirname(targetPath);
  const content = pretty
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
  let handle;

  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(content, 'utf-8');
    await handle.sync();
    await handle.close();
    handle = null;

    await rename(tempPath, targetPath);
    await syncDirectory(targetDir);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(tempPath).catch(cleanupError => {
      if (cleanupError?.code !== 'ENOENT') throw cleanupError;
    });
    throw error;
  }
}

/**
 * 写入 JSON 文件
 */
export async function writeJsonFile(filePath, data, pretty = true) {
  try {
    await enqueueFileMutation(filePath, () => writeJsonFileAtomic(filePath, data, pretty));
  } catch (error) {
    throw new Error(`写入 JSON 文件失败: ${error.message}`);
  }
}

/**
 * 安全地更新 JSON 文件（先读取，再合并，最后写入）
 */
export async function updateJsonFile(filePath, updateFn, defaultValue = {}) {
  return enqueueFileMutation(filePath, async () => {
    const data = await readJsonFile(filePath, defaultValue);
    const updated = await updateFn(data);
    await writeJsonFileAtomic(filePath, updated, true);
    return updated;
  });
}

/**
 * 删除 JSON 文件，并与同路径的写入/更新操作串行化。
 */
export async function deleteJsonFile(filePath) {
  return enqueueFileMutation(filePath, async () => {
    try {
      await unlink(filePath);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  });
}
