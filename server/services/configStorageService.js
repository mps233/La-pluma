import { readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { deleteJsonFile, readJsonFile, writeJsonFile, ensureDir } from '../utils/fileHelper.js';
import { agentError, successResponse, errorResponse } from '../utils/apiHelper.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ConfigStorage');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置存储目录
const CONFIG_STORAGE_DIR = path.join(__dirname, '../data/user-configs');
const ALLOWED_CONFIG_TYPES = new Set([
  'activity-cache',
  'auto-update',
  'automation-tasks',
  'combat-tasks',
  'notification',
  'roguelike-tasks',
  'training-queue'
]);

export function validateConfigType(configType) {
  if (typeof configType !== 'string' || !ALLOWED_CONFIG_TYPES.has(configType)) {
    throw agentError('AGENT_CONFIG_TYPE_INVALID', '配置类型不合法', {
      statusCode: 400,
      details: { configType }
    });
  }
  return configType;
}

// 获取配置文件路径
function getConfigPath(configType) {
  const normalizedType = validateConfigType(configType);
  const configPath = path.resolve(CONFIG_STORAGE_DIR, `${normalizedType}.json`);
  if (path.dirname(configPath) !== path.resolve(CONFIG_STORAGE_DIR)) {
    throw new Error('配置路径不合法');
  }
  return configPath;
}

// 保存用户配置
export async function saveUserConfig(configType, data) {
  try {
    await ensureDir(CONFIG_STORAGE_DIR);
    const configPath = getConfigPath(configType);
    await writeJsonFile(configPath, data);
    // 移除 DEBUG 日志，保存配置太频繁
    return successResponse(null, '配置保存成功');
  } catch (error) {
    logger.error('保存配置失败', { configType, error: error.message });
    return errorResponse(error, '保存配置失败');
  }
}

// 读取用户配置
export async function loadUserConfig(configType) {
  try {
    const configPath = getConfigPath(configType);
    const data = await readJsonFile(configPath, null);
    return successResponse(data);
  } catch (error) {
    logger.error('读取配置失败', { configType, error: error.message });
    return errorResponse(error, '读取配置失败');
  }
}

// 获取所有配置
export async function getAllUserConfigs() {
  try {
    await ensureDir(CONFIG_STORAGE_DIR);
    const files = await readdir(CONFIG_STORAGE_DIR);
    const configs = {};
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const configType = file.replace('.json', '');
        if (!ALLOWED_CONFIG_TYPES.has(configType)) continue;
        const result = await loadUserConfig(configType);
        if (result.success && result.data) {
          configs[configType] = result.data;
        }
      }
    }
    
    return successResponse(configs);
  } catch (error) {
    logger.error('获取所有配置失败', { error: error.message });
    return errorResponse(error, '获取所有配置失败');
  }
}

// 删除配置
export async function deleteUserConfig(configType) {
  try {
    const configPath = getConfigPath(configType);
    const deleted = await deleteJsonFile(configPath);

    if (!deleted) {
      return successResponse(null, '配置不存在');
    }

    logger.info('配置删除成功', { configType });
    return successResponse(null, '配置删除成功');
  } catch (error) {
    logger.error('删除配置失败', { configType, error: error.message });
    return errorResponse(error, '删除配置失败');
  }
}
