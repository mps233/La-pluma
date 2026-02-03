import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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
    const content = await readFile(itemIndexPath, 'utf-8');
    itemIndexCache = JSON.parse(content);
    console.log('[物品索引] 加载成功，共', Object.keys(itemIndexCache).length, '种物品');
    return itemIndexCache;
  } catch (error) {
    console.error('[物品索引] 加载失败:', error.message);
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
    // 尝试从本地加载
    const itemTablePath = getItemTablePath();
    try {
      const content = await readFile(itemTablePath, 'utf-8');
      const data = JSON.parse(content);
      itemTableCache = data.items || {};
      console.log('[物品表] 从本地加载成功，共', Object.keys(itemTableCache).length, '种物品');
      return itemTableCache;
    } catch (localError) {
      console.log('[物品表] 本地文件不存在，尝试从网络获取...');
      
      // 从 GitHub 获取
      const response = await fetch('https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/gamedata/excel/item_table.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      itemTableCache = data.items || {};
      console.log('[物品表] 从网络加载成功，共', Object.keys(itemTableCache).length, '种物品');
      
      // 保存到本地以便下次使用
      const resourceDir = getMaaResourceDir();
      await mkdir(join(resourceDir, 'gamedata', 'excel'), { recursive: true });
      await writeFile(itemTablePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log('[物品表] 已缓存到本地');
      
      return itemTableCache;
    }
  } catch (error) {
    console.error('[物品表] 加载失败:', error.message);
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
    console.log('[数据解析] 读取日志文件:', logPath);
    
    let logContent = await readFile(logPath, 'utf-8');
    
    // 移除日志中的换行符（MAA 日志可能在单词中间换行）
    // 保留真正的 JSON 结构换行，只移除单词中间的换行
    logContent = logContent.replace(/([a-zA-Z])\n([a-z])/g, '$1$2');
    
    // 查找最后一次 DepotInfo 数据
    // 实际格式: "what":"DepotInfo","details":{"data":"{\"2001\":10000,...}","done":true}
    // 使用更宽松的正则匹配，允许跨行
    const depotMatches = [...logContent.matchAll(/"what"\s*:\s*"DepotInfo"[\s\S]*?"details"\s*:\s*\{[\s\S]*?"data"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
    
    if (depotMatches.length === 0) {
      console.log('[数据解析] 未找到 DepotInfo 数据');
      return null;
    }
    
    // 取最后一次识别结果（done:true 的那个）
    let dataStr = null;
    for (let i = depotMatches.length - 1; i >= 0; i--) {
      const match = depotMatches[i];
      // 检查这条记录是否包含 "done":true
      const contextStart = match.index;
      const contextEnd = Math.min(contextStart + 5000, logContent.length);
      const context = logContent.substring(contextStart, contextEnd);
      
      if (context.includes('"done":true')) {
        dataStr = match[1];
        console.log('[数据解析] 找到完成的 DepotInfo 数据');
        break;
      }
    }
    
    if (!dataStr) {
      // 如果没有找到 done:true 的，就用最后一个
      dataStr = depotMatches[depotMatches.length - 1][1];
      console.log('[数据解析] 使用最后一次 DepotInfo 数据');
    }
    
    console.log('[数据解析] 数据字符串长度:', dataStr.length);
    
    // 数据是转义的 JSON 字符串，需要先解转义再解析
    // 将 \" 替换为 "
    const unescapedStr = dataStr.replace(/\\"/g, '"');
    const depotData = JSON.parse(unescapedStr);
    
    console.log('[数据解析] 解析成功，物品数量:', Object.keys(depotData).length);
    
    // 加载物品索引，添加物品名称
    const itemIndex = await loadItemIndex();
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
    
    // 按 sortId 排序
    const sortedData = Object.values(enrichedData).sort((a, b) => a.sortId - b.sortId);
    
    // 保存到文件
    await mkdir(DATA_DIR, { recursive: true });
    const outputPath = join(DATA_DIR, 'depot.json');
    
    const output = {
      timestamp: new Date().toISOString(),
      itemCount: Object.keys(depotData).length,
      items: sortedData
    };
    
    await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log('[数据解析] 仓库数据已保存到:', outputPath);
    
    return {
      success: true,
      path: outputPath,
      itemCount: Object.keys(depotData).length,
      items: sortedData
    };
  } catch (error) {
    console.error('[数据解析] 解析仓库数据失败:', error.message);
    console.error('[数据解析] 错误堆栈:', error.stack);
    throw new Error(`解析仓库数据失败: ${error.message}`);
  }
}

/**
 * 解析 MAA 日志文件，提取 OperBoxInfo 数据
 */
export async function parseOperBoxData() {
  try {
    const logPath = getMaaLogPath();
    console.log('[数据解析] 读取日志文件:', logPath);
    
    const logContent = await readFile(logPath, 'utf-8');
    
    // 查找所有 OperBoxInfo 行
    const lines = logContent.split('\n');
    const operBoxLines = lines.filter(line => line.includes('"what":"OperBoxInfo"'));
    
    if (operBoxLines.length === 0) {
      console.log('[数据解析] 未找到 OperBoxInfo 数据');
      return null;
    }
    
    // 取最后一行
    const lastLine = operBoxLines[operBoxLines.length - 1];
    console.log('[数据解析] 找到 OperBoxInfo 数据');
    
    // 找到 JSON 对象的开始位置
    const jsonStart = lastLine.indexOf('{"class');
    if (jsonStart === -1) {
      throw new Error('无法找到 JSON 数据起始位置');
    }
    
    // 解析 JSON
    const jsonStr = lastLine.substring(jsonStart);
    const data = JSON.parse(jsonStr);
    
    // 检查是否完成
    if (!data.details.done) {
      console.log('[数据解析] 识别未完成，使用部分数据');
    }
    
    const opers = data.details.own_opers || [];
    console.log('[数据解析] 解析成功，干员数量:', opers.length);
    
    // 保存到文件
    await mkdir(DATA_DIR, { recursive: true });
    const outputPath = join(DATA_DIR, 'operbox.json');
    
    const output = {
      timestamp: new Date().toISOString(),
      operCount: opers.length,
      data: opers
    };
    
    await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log('[数据解析] 干员数据已保存到:', outputPath);
    
    return {
      success: true,
      path: outputPath,
      operCount: opers.length,
      data: opers
    };
  } catch (error) {
    console.error('[数据解析] 解析干员数据失败:', error.message);
    console.error('[数据解析] 错误堆栈:', error.stack);
    throw new Error(`解析干员数据失败: ${error.message}`);
  }
}

/**
 * 读取已保存的仓库数据
 */
export async function getDepotData() {
  try {
    const filePath = join(DATA_DIR, 'depot.json');
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * 读取已保存的干员数据
 */
export async function getOperBoxData() {
  try {
    const filePath = join(DATA_DIR, 'operbox.json');
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * 获取所有干员列表（从 MAA 资源文件）
 */
export async function getAllOperators() {
  try {
    const battleDataPath = getBattleDataPath();
    const content = await readFile(battleDataPath, 'utf-8');
    const data = JSON.parse(content);
    
    // 从 chars 对象中提取所有干员
    const operators = Object.entries(data.chars || {})
      .filter(([id, char]) => {
        // 过滤条件：
        // 1. ID以 char_ 开头（排除召唤物、陷阱等）
        // 2. 排除预备干员（char_5xx 和 char_6xx）
        if (!id.startsWith('char_')) return false;
        
        // 排除预备干员（保全派驻临时干员）
        if (id.match(/^char_[56]\d{2}_/)) return false;
        
        return true;
      })
      .map(([id, char]) => ({
        id: id,
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
    
    console.log(`[所有干员] 加载成功，共 ${operators.length} 名干员（已过滤预备干员）`);
    return operators;
  } catch (error) {
    console.error('[所有干员] 加载失败:', error.message);
    throw error;
  }
}
