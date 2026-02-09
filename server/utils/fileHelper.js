/**
 * 文件操作辅助工具 - 统一的文件读写逻辑
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { dirname } from 'path';

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

/**
 * 写入 JSON 文件
 */
export async function writeJsonFile(filePath, data, pretty = true) {
  try {
    // 确保目录存在
    await ensureDir(dirname(filePath));
    
    const content = pretty 
      ? JSON.stringify(data, null, 2) 
      : JSON.stringify(data);
    
    await writeFile(filePath, content, 'utf-8');
  } catch (error) {
    throw new Error(`写入 JSON 文件失败: ${error.message}`);
  }
}

/**
 * 安全地更新 JSON 文件（先读取，再合并，最后写入）
 */
export async function updateJsonFile(filePath, updateFn, defaultValue = {}) {
  const data = await readJsonFile(filePath, defaultValue);
  const updated = await updateFn(data);
  await writeJsonFile(filePath, updated);
  return updated;
}
