import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readJsonFile, writeJsonFile, ensureDir } from '../utils/fileHelper.js';
import { successResponse, errorResponse, safeJsonParse } from '../utils/apiHelper.js';
import { createLogger } from '../utils/logger.js';
import { 
  getMaaLogPath, 
  getItemIndexPath, 
  getItemTablePath, 
  getRecruitmentDataPath, 
  getBattleDataPath,
  getMaaResourceDir
} from '../config/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logger = createLogger('DataParser');

// 项目数据目录
const DATA_DIR = join(__dirname, '..', 'data');

// 物品索引缓存
let itemIndexCache = null;
let itemTableCache = null;

/**
 * 加载物品索引
 */
async function loadItemIndex() {
  if (itemIndexCache) {
    return itemIndexCache;
  }
  
  try {
    const itemIndexPath = getItemIndexPath();
    itemIndexCache = await readJsonFile(itemIndexPath, {});
    logger.info(`物品索引加载成功，共 ${Object.keys(itemIndexCache).length} 种物品`);
    return itemIndexCache;
  } catch (error) {
    logger.error('物品索引加载失败', { error: error.message });
    return {};
  }
}

/**
 * 加载游戏物品表（包含 iconId）
 */
async function loadItemTable() {
  if (itemTableCache) {
    return itemTableCache;
  }
  
  try {
    const itemTablePath = getItemTablePath();
    
    // 尝试从本地加载
    const localData = await readJsonFile(itemTablePath, null);
    if (localData) {
      itemTableCache = localData.items || {};
      logger.info(`物品表从本地加载成功，共 ${Object.keys(itemTableCache).length} 种物品`);
      return itemTableCache;
    }
    
    // 从网络获取
    logger.info('本地文件不存在，尝试从网络获取物品表...');
    const response = await fetch('https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/gamedata/excel/item_table.json');
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    itemTableCache = data.items || {};
    logger.success(`物品表从网络加载成功，共 ${Object.keys(itemTableCache).length} 种物品`);
    
    // 保存到本地
    const resourceDir = getMaaResourceDir();
    await ensureDir(join(resourceDir, 'gamedata', 'excel'));
    await writeJsonFile(itemTablePath, data);
    logger.info('物品表已缓存到本地');
    
    return itemTableCache;
  } catch (error) {
    logger.error('物品表加载失败', { error: error.message });
    return {};
  }
}

/**
 * 根据物品 ID 获取物品信息
 */
async function getItemInfo(itemId) {
  const itemIndex = await loadItemIndex();
  const itemTable = await loadItemTable();
  const item = itemIndex[itemId];
  const gameItem = itemTable[itemId];
  
  if (item) {
    return {
      id: itemId,
      name: item.name,
      icon: item.icon,
      iconId: gameItem?.iconId || itemId, // 使用游戏数据的 iconId，如果没有则使用 itemId
      classifyType: item.classifyType,
      sortId: item.sortId
    };
  }
  
  return {
    id: itemId,
    name: `未知物品 (${itemId})`,
    icon: null,
    classifyType: 'UNKNOWN',
    sortId: 999999
  };
}

/**
 * 解析 MAA 日志文件，提取 DepotInfo 数据
 */
export async function parseDepotData() {
  try {
    const logPath = getMaaLogPath();
    logger.info('开始解析仓库数据', { logPath });
    
    const { readFile } = await import('fs/promises');
    let logContent = await readFile(logPath, 'utf-8');
    
    // 移除日志中的换行符（MAA 日志可能在单词中间换行）
    logContent = logContent.replace(/([a-zA-Z])\n([a-z])/g, '$1$2');
    
    // 查找最后一次 DepotInfo 数据
    const depotMatches = [...logContent.matchAll(/"what"\s*:\s*"DepotInfo"[\s\S]*?"details"\s*:\s*\{[\s\S]*?"data"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
    
    if (depotMatches.length === 0) {
      logger.warn('未找到 DepotInfo 数据');
      return null;
    }
    
    // 取最后一次识别结果（done:true 的那个）
    let dataStr = findCompletedDepotData(logContent, depotMatches);
    
    if (!dataStr) {
      dataStr = depotMatches[depotMatches.length - 1][1];
      logger.info('使用最后一次 DepotInfo 数据');
    }
    
    logger.debug('数据字符串长度', { length: dataStr.length });
    
    // 解析数据
    const unescapedStr = dataStr.replace(/\\"/g, '"');
    const depotData = safeJsonParse(unescapedStr, {});
    
    if (!depotData || Object.keys(depotData).length === 0) {
      throw new Error('解析仓库数据失败');
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
      items: sortedData
    });
  } catch (error) {
    logger.error('解析仓库数据失败', { error: error.message, stack: error.stack });
    return errorResponse(error, '解析仓库数据失败');
  }
}

// 辅助函数：查找完成的 DepotInfo 数据
function findCompletedDepotData(logContent, depotMatches) {
  for (let i = depotMatches.length - 1; i >= 0; i--) {
    const match = depotMatches[i];
    const contextStart = match.index;
    const contextEnd = Math.min(contextStart + 5000, logContent.length);
    const context = logContent.substring(contextStart, contextEnd);
    
    if (context.includes('"done":true')) {
      return match[1];
    }
  }
  return null;
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
export async function parseOperBoxData() {
  try {
    const logPath = getMaaLogPath();
    logger.info('开始解析干员数据', { logPath });
    
    const { readFile } = await import('fs/promises');
    const logContent = await readFile(logPath, 'utf-8');
    
    // 查找所有 OperBoxInfo 行
    const lines = logContent.split('\n');
    const operBoxLines = lines.filter(line => line.includes('"what":"OperBoxInfo"'));
    
    if (operBoxLines.length === 0) {
      logger.warn('未找到 OperBoxInfo 数据');
      return null;
    }
    
    // 取最后一行
    const lastLine = operBoxLines[operBoxLines.length - 1];
    logger.info('找到 OperBoxInfo 数据');
    
    // 找到 JSON 对象的开始位置
    const jsonStart = lastLine.indexOf('{"class');
    if (jsonStart === -1) {
      throw new Error('无法找到 JSON 数据起始位置');
    }
    
    // 解析 JSON
    const jsonStr = lastLine.substring(jsonStart);
    const data = safeJsonParse(jsonStr);
    
    if (!data || !data.details) {
      throw new Error('解析 JSON 失败');
    }
    
    // 检查是否完成
    if (!data.details.done) {
      logger.warn('识别未完成，使用部分数据');
    }
    
    const opers = data.details.own_opers || [];
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
    return errorResponse(error, '解析干员数据失败');
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
