/**
 * 掉落记录服务
 * 记录和管理每日的材料掉落数据
 */

import { readdir, unlink } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { readJsonFile, ensureDir, updateJsonFile } from '../utils/fileHelper.js';
import { successResponse, errorResponse } from '../utils/apiHelper.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DropRecord');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DROP_RECORDS_DIR = path.join(__dirname, '../data/drop-records');
const MATERIALS_PATH = path.join(__dirname, '../data/materials.json');

// 获取今天的日期字符串 (YYYY-MM-DD)
function getTodayString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// 获取今天的记录文件路径
function getTodayRecordPath() {
  return path.join(DROP_RECORDS_DIR, `${getTodayString()}.json`);
}

// 创建空记录结构
function createEmptyRecord(date = getTodayString()) {
  return {
    date,
    records: [],
    summary: {
      totalSanity: 0,
      totalMedicine: 0,
      totalStone: 0,
      totalBattles: 0,
      itemsSummary: {}
    }
  };
}

/**
 * 记录掉落数据
 */
export async function recordDrops(dropData) {
  try {
    await ensureDir(DROP_RECORDS_DIR);
    const recordPath = getTodayRecordPath();
    
    // 使用 updateJsonFile 简化读取-修改-写入流程
    const todayRecord = await updateJsonFile(
      recordPath,
      (existingRecord) => {
        const record = existingRecord || createEmptyRecord();
        
        // 添加新记录
        const newRecord = {
          timestamp: new Date().toISOString(),
          stage: dropData.stage,
          times: dropData.times || 1,
          sanity: dropData.sanity || 0,
          medicine: dropData.medicine || 0,
          stone: dropData.stone || 0,
          items: dropData.items || []
        };
        
        record.records.push(newRecord);
        
        // 更新汇总数据
        record.summary.totalSanity += newRecord.sanity;
        record.summary.totalMedicine += newRecord.medicine;
        record.summary.totalStone += newRecord.stone;
        record.summary.totalBattles += newRecord.times;
        
        // 更新物品汇总
        for (const item of newRecord.items) {
          if (!record.summary.itemsSummary[item.name]) {
            record.summary.itemsSummary[item.name] = 0;
          }
          record.summary.itemsSummary[item.name] += item.count;
        }
        
        return record;
      },
      createEmptyRecord()
    );
    
    logger.debug('已记录掉落', { stage: dropData.stage, times: dropData.times });
    return successResponse({ record: todayRecord });
  } catch (error) {
    logger.error('记录掉落失败', { error: error.message });
    return errorResponse(error, '记录掉落失败');
  }
}

/**
 * 获取今天的掉落记录
 */
export async function getTodayDrops() {
  try {
    await ensureDir(DROP_RECORDS_DIR);
    const recordPath = getTodayRecordPath();
    const record = await readJsonFile(recordPath, createEmptyRecord());
    return successResponse(record);
  } catch (error) {
    logger.error('获取今日记录失败', { error: error.message });
    return errorResponse(error, '获取今日记录失败');
  }
}

/**
 * 获取指定日期范围的掉落记录
 */
export async function getRecentDrops(days = 7) {
  try {
    await ensureDir(DROP_RECORDS_DIR);
    
    const records = [];
    const today = new Date();
    
    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const recordPath = path.join(DROP_RECORDS_DIR, `${dateStr}.json`);
      
      const record = await readJsonFile(recordPath, null);
      if (record) {
        records.push(record);
      }
    }
    
    return successResponse(records);
  } catch (error) {
    logger.error('获取历史记录失败', { error: error.message });
    return errorResponse(error, '获取历史记录失败');
  }
}

/**
 * 获取掉落统计（按物品汇总）
 */
export async function getDropStatistics(days = 7) {
  try {
    const recentResult = await getRecentDrops(days);
    if (!recentResult.success) {
      return recentResult;
    }
    
    const records = recentResult.data;
    
    // 汇总统计
    const statistics = {
      dateRange: {
        start: records.length > 0 ? records[records.length - 1].date : null,
        end: records.length > 0 ? records[0].date : null,
        days: records.length
      },
      total: {
        sanity: 0,
        medicine: 0,
        stone: 0,
        battles: 0
      },
      items: {},
      stages: {},
      dailyTrend: []
    };
    
    // 加载材料数据
    const materialsMap = await loadMaterialsMap();
    
    // 遍历每天的记录
    for (const dayRecord of records) {
      const dailyData = {
        date: dayRecord.date,
        sanity: dayRecord.summary.totalSanity,
        medicine: dayRecord.summary.totalMedicine,
        stone: dayRecord.summary.totalStone,
        battles: dayRecord.summary.totalBattles,
        items: dayRecord.summary.itemsSummary
      };
      
      statistics.dailyTrend.push(dailyData);
      
      // 累加总计
      statistics.total.sanity += dayRecord.summary.totalSanity;
      statistics.total.medicine += dayRecord.summary.totalMedicine;
      statistics.total.stone += dayRecord.summary.totalStone;
      statistics.total.battles += dayRecord.summary.totalBattles;
      
      // 遍历每条记录
      for (const record of dayRecord.records) {
        processRecordForStatistics(record, statistics, materialsMap);
      }
    }
    
    // 反转 dailyTrend，使其按时间正序排列
    statistics.dailyTrend.reverse();
    
    return successResponse(statistics);
  } catch (error) {
    logger.error('获取统计数据失败', { error: error.message });
    return errorResponse(error, '获取统计数据失败');
  }
}

// 加载材料数据映射
async function loadMaterialsMap() {
  try {
    const materials = await readJsonFile(MATERIALS_PATH, []);
    // 确保 materials 是数组
    if (!Array.isArray(materials)) {
      logger.warn('材料数据格式错误，应为数组', { type: typeof materials });
      return {};
    }
    return materials.reduce((map, item) => {
      map[item.name] = item;
      return map;
    }, {});
  } catch (error) {
    logger.warn('无法加载材料数据', { error: error.message });
    return {};
  }
}

// 处理单条记录的统计
function processRecordForStatistics(record, statistics, materialsMap) {
  const stageName = record.stage;
  
  // 统计关卡数据
  if (!statistics.stages[stageName]) {
    statistics.stages[stageName] = {
      battles: 0,
      sanity: 0,
      items: {}
    };
  }
  statistics.stages[stageName].battles += record.times;
  statistics.stages[stageName].sanity += record.sanity;
  
  // 统计物品数据
  for (const item of record.items) {
    const itemName = item.name;
    
    // 全局物品统计
    if (!statistics.items[itemName]) {
      statistics.items[itemName] = {
        count: 0,
        stages: {},
        iconId: materialsMap[itemName]?.iconId || null,
        rarity: materialsMap[itemName]?.rarity || null
      };
    }
    statistics.items[itemName].count += item.count;
    
    // 物品在各关卡的掉落统计
    if (!statistics.items[itemName].stages[stageName]) {
      statistics.items[itemName].stages[stageName] = 0;
    }
    statistics.items[itemName].stages[stageName] += item.count;
    
    // 关卡的物品掉落统计
    if (!statistics.stages[stageName].items[itemName]) {
      statistics.stages[stageName].items[itemName] = 0;
    }
    statistics.stages[stageName].items[itemName] += item.count;
  }
}

/**
 * 清理旧记录
 */
export async function cleanOldRecords(keepDays = 30) {
  try {
    await ensureDir(DROP_RECORDS_DIR);
    
    const files = await readdir(DROP_RECORDS_DIR);
    const today = new Date();
    const cutoffDate = new Date(today);
    cutoffDate.setDate(cutoffDate.getDate() - keepDays);
    
    let deletedCount = 0;
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const dateStr = file.replace('.json', '');
      const fileDate = new Date(dateStr);
      
      if (fileDate < cutoffDate) {
        const filePath = path.join(DROP_RECORDS_DIR, file);
        await unlink(filePath);
        deletedCount++;
        logger.debug('已删除旧记录', { file });
      }
    }
    
    logger.info('清理旧记录完成', { deletedCount });
    return successResponse({ deletedCount });
  } catch (error) {
    logger.error('清理旧记录失败', { error: error.message });
    return errorResponse(error, '清理旧记录失败');
  }
}
