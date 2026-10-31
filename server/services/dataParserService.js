import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readJsonFile, writeJsonFile, ensureDir } from '../utils/fileHelper.js';
import { successResponse, errorResponse, agentError } from '../utils/apiHelper.js';
import { createLogger } from '../utils/logger.js';
import { getMaaLogPath, getBattleDataPath } from '../config/paths.js';
import { getMaaItemInfo } from './maaResourceDataService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logger = createLogger('DataParser');

// 项目数据目录
const DATA_DIR = join(__dirname, '..', 'data');

/**
 * 根据物品 ID 获取物品信息；数据统一来自 MaaResource。
 */
async function getItemInfo(itemId) {
  const item = await getMaaItemInfo(itemId).catch(error => {
    logger.warn('加载 MaaResource 物品信息失败', { itemId, error: error.message });
    return null;
  });

  if (item) return item;

  return {
    id: itemId,
    name: `未知物品 (${itemId})`,
    icon: null,
    iconId: itemId,
    classifyType: 'UNKNOWN',
    sortId: 999999
  };
}

const CALLBACK_MARKER = 'Assistant::append_callback | ';

async function readMaaLogFile(logPath) {
  const { readFile } = await import('fs/promises');
  return readFile(logPath, 'utf-8');
}

/**
 * Parse one callback payload per line. MaaCore emits `class`, `details` and
 * `what` in an order that is not stable across versions, so match on the
 * parsed object rather than a positional regular expression.
 */
export function extractCallbackPayloads(logContent, what) {
  const payloads = [];
  const whatPattern = new RegExp(`"what"\\s*:\\s*"${what}"`);

  for (const line of String(logContent || '').split('\n')) {
    const markerIndex = line.indexOf(CALLBACK_MARKER);
    if (markerIndex === -1) continue;

    const jsonStart = line.indexOf('{', markerIndex);
    const jsonEnd = line.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd <= jsonStart) continue;

    const text = line.slice(jsonStart, jsonEnd + 1);
    if (!whatPattern.test(text)) continue;

    try {
      const payload = JSON.parse(text);
      if (payload?.what === what) payloads.push(payload);
    } catch {
      // A wrapped or truncated log line cannot be trusted; try the next one.
    }
  }

  return payloads;
}

export function selectRecognitionPayload(payloads, hasPayload) {
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    const payload = payloads[index];
    if (payload?.details?.done === true && hasPayload(payload)) {
      return { payload, complete: true };
    }
  }

  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    const payload = payloads[index];
    if (hasPayload(payload)) return { payload, complete: false };
  }

  return null;
}

export function parseDepotPayloadData(details) {
  if (typeof details?.data === 'string') return JSON.parse(details.data);
  if (details?.data && typeof details.data === 'object' && !Array.isArray(details.data)) return details.data;
  return null;
}

/**
 * 解析 MAA 日志文件，提取 DepotInfo 数据
 */
export async function parseDepotData(runtime = {}) {
  const logPath = runtime.logPath || getMaaLogPath();

  try {
    logger.info('开始解析仓库数据', { logPath });
    let logContent;
    try {
      logContent = runtime.logContent !== undefined
        ? runtime.logContent
        : await readMaaLogFile(logPath);
    } catch (error) {
      return errorResponse(
        agentError('AGENT_DEPOT_LOG_UNAVAILABLE', `无法读取 MAA 日志: ${error.message}`, {
          statusCode: 500,
          details: { logPath },
          retryable: true
        }),
        '解析仓库数据失败'
      );
    }
    const payloads = extractCallbackPayloads(logContent, 'DepotInfo');

    if (payloads.length === 0) {
      logger.warn('未找到 DepotInfo 数据', { logPath });
      return errorResponse(
        agentError('AGENT_DEPOT_NOT_FOUND', 'MAA 日志中未找到仓库识别结果，请先运行仓库识别任务', {
          statusCode: 404,
          details: { logPath },
          retryable: true
        }),
        '解析仓库数据失败'
      );
    }

    const selected = selectRecognitionPayload(
      payloads,
      payload => typeof payload.details?.data === 'string'
        || (payload.details?.data && typeof payload.details.data === 'object' && !Array.isArray(payload.details.data))
    );

    if (!selected) {
      return errorResponse(
        agentError('AGENT_DEPOT_DATA_EMPTY', '仓库识别结果为空，请重新运行仓库识别任务', {
          statusCode: 422,
          details: { logPath },
          retryable: true
        }),
        '解析仓库数据失败'
      );
    }

    if (!selected.complete) {
      logger.warn('未找到完成的 DepotInfo，使用最后一次识别结果', { logPath });
    }

    let depotData;
    try {
      depotData = parseDepotPayloadData(selected.payload.details);
    } catch (error) {
      return errorResponse(
        agentError('AGENT_DEPOT_PARSE_FAILED', `仓库识别数据解析失败: ${error.message}`, {
          statusCode: 500,
          details: { logPath },
          retryable: true
        }),
        '解析仓库数据失败'
      );
    }

    if (!depotData || Object.keys(depotData).length === 0) {
      return errorResponse(
        agentError('AGENT_DEPOT_DATA_EMPTY', '仓库识别结果为空，请重新运行仓库识别任务', {
          statusCode: 422,
          details: { logPath },
          retryable: true
        }),
        '解析仓库数据失败'
      );
    }

    logger.success(`解析成功，物品数量: ${Object.keys(depotData).length}`);

    // 加载物品索引，添加物品名称
    const enrichedData = await enrichDepotData(depotData);

    // 按 sortId 排序
    const sortedData = Object.values(enrichedData).sort((a, b) => a.sortId - b.sortId);

    // 保存到文件
    await ensureDir(DATA_DIR);
    const outputPath = join(DATA_DIR, 'depot.json');

    const output = {
      timestamp: new Date().toISOString(),
      itemCount: Object.keys(depotData).length,
      items: sortedData
    };

    await writeJsonFile(outputPath, output);
    logger.success('仓库数据已保存', { path: outputPath });

    return successResponse({
      path: outputPath,
      itemCount: Object.keys(depotData).length,
      items: sortedData,
      complete: selected.complete
    });
  } catch (error) {
    logger.error('解析仓库数据失败', { error: error.message, stack: error.stack });
    return errorResponse(
      agentError('AGENT_DEPOT_PROCESSING_FAILED', `解析仓库数据失败: ${error.message}`, {
        statusCode: 500,
        details: { logPath },
        retryable: true
      }),
      '解析仓库数据失败'
    );
  }
}

// 辅助函数：丰富仓库数据（添加物品信息）
async function enrichDepotData(depotData) {
  const enrichedData = {};
  
  for (const [itemId, count] of Object.entries(depotData)) {
    const itemInfo = await getItemInfo(itemId);
    enrichedData[itemId] = {
      id: itemId,
      name: itemInfo.name,
      count: count,
      icon: itemInfo.icon,
      iconId: itemInfo.iconId,
      classifyType: itemInfo.classifyType,
      sortId: itemInfo.sortId
    };
  }
  
  return enrichedData;
}

/**
 * 解析 MAA 日志文件，提取 OperBoxInfo 数据
 */
export async function parseOperBoxData(runtime = {}) {
  const logPath = runtime.logPath || getMaaLogPath();

  try {
    logger.info('开始解析干员数据', { logPath });
    let logContent;
    try {
      logContent = runtime.logContent !== undefined
        ? runtime.logContent
        : await readMaaLogFile(logPath);
    } catch (error) {
      return errorResponse(
        agentError('AGENT_OPERBOX_LOG_UNAVAILABLE', `无法读取 MAA 日志: ${error.message}`, {
          statusCode: 500,
          details: { logPath },
          retryable: true
        }),
        '解析干员数据失败'
      );
    }
    const payloads = extractCallbackPayloads(logContent, 'OperBoxInfo');

    if (payloads.length === 0) {
      logger.warn('未找到 OperBoxInfo 数据', { logPath });
      return errorResponse(
        agentError('AGENT_OPERBOX_NOT_FOUND', 'MAA 日志中未找到干员识别结果，请先运行干员识别任务', {
          statusCode: 404,
          details: { logPath },
          retryable: true
        }),
        '解析干员数据失败'
      );
    }

    const selected = selectRecognitionPayload(
      payloads,
      payload => Array.isArray(payload.details?.own_opers)
    );

    if (!selected) {
      return errorResponse(
        agentError('AGENT_OPERBOX_DATA_EMPTY', '干员识别结果为空，请重新运行干员识别任务', {
          statusCode: 422,
          details: { logPath },
          retryable: true
        }),
        '解析干员数据失败'
      );
    }

    if (!selected.complete) {
      logger.warn('干员识别未完成，保留已有干员数据', { logPath });
      return errorResponse(
        agentError('AGENT_OPERBOX_RECOGNITION_INCOMPLETE', '干员识别未完成，未覆盖已有数据，请重试', {
          statusCode: 409,
          details: { logPath },
          retryable: true
        }),
        '解析干员数据失败'
      );
    }

    const opers = selected.payload.details.own_opers;
    logger.success(`解析成功，干员数量: ${opers.length}`);

    // 保存到文件
    await ensureDir(DATA_DIR);
    const outputPath = join(DATA_DIR, 'operbox.json');

    const output = {
      timestamp: new Date().toISOString(),
      operCount: opers.length,
      data: opers
    };

    await writeJsonFile(outputPath, output);
    logger.success('干员数据已保存', { path: outputPath });

    return successResponse({
      path: outputPath,
      operCount: opers.length,
      data: opers
    });
  } catch (error) {
    logger.error('解析干员数据失败', { error: error.message, stack: error.stack });
    return errorResponse(
      agentError('AGENT_OPERBOX_PROCESSING_FAILED', `解析干员数据失败: ${error.message}`, {
        statusCode: 500,
        details: { logPath },
        retryable: true
      }),
      '解析干员数据失败'
    );
  }
}

/**
 * 读取已保存的仓库数据
 */
export async function getDepotData() {
  const filePath = join(DATA_DIR, 'depot.json');
  return await readJsonFile(filePath, null);
}

/**
 * 读取已保存的干员数据
 */
export async function getOperBoxData() {
  const filePath = join(DATA_DIR, 'operbox.json');
  return await readJsonFile(filePath, null);
}

/**
 * 获取所有干员列表（从 MAA 资源文件）
 */
export async function getAllOperators() {
  try {
    const battleDataPath = getBattleDataPath();
    const data = await readJsonFile(battleDataPath);
    
    if (!data || !data.chars) {
      throw new Error('无法读取干员数据');
    }
    
    // 从 chars 对象中提取所有干员
    const operators = Object.entries(data.chars)
      .filter(([id]) => {
        // 过滤条件：
        // 1. ID以 char_ 开头（排除召唤物、陷阱等）
        // 2. 排除预备干员（char_5xx 和 char_6xx）
        if (!id.startsWith('char_')) return false;
        
        // 排除预备干员（保全派驻临时干员）
        if (id.match(/^char_[56]\d{2}_/)) return false;
        
        return true;
      })
      .map(([id, char]) => ({
        id,
        name: char.name,
        rarity: char.rarity,
        profession: char.profession,
        position: char.position
      }))
      .sort((a, b) => {
        // 按星级降序，同星级按名称排序
        if (b.rarity !== a.rarity) {
          return b.rarity - a.rarity;
        }
        return a.name.localeCompare(b.name, 'zh-CN');
      });
    
    logger.success(`加载所有干员成功，共 ${operators.length} 名干员（已过滤预备干员）`);
    return operators;
  } catch (error) {
    logger.error('加载所有干员失败', { error: error.message });
    throw error;
  }
}
