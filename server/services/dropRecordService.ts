import { getErrorMessage, isRecord } from '../utils/errors.ts';
/**
 * 掉落记录服务
 * 记录和管理每日的材料掉落数据
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { readJsonFile, ensureDir, updateJsonFile } from '../utils/fileHelper.ts';
import { successResponse, errorResponse } from '../utils/apiHelper.ts';
import { createLogger } from '../utils/logger.ts';
import { getMaaMaterialDatabase } from './maaResourceDataService.ts';

const logger = createLogger('DropRecord');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DROP_RECORDS_DIR = path.join(__dirname, '../data/drop-records');
const DROP_STATS_MAX_DAYS = 365;
const DROP_STATS_CACHE_TTL_MS = (() => {
  const value = Number(process.env.LA_PLUMA_DROP_STATS_TTL_MS || 30_000);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 30_000;
})();
const dropStatsCache = new Map<number, { expiresAt: number; value: unknown }>();

export function normalizeDropDays(value: unknown, fallback = 7): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(DROP_STATS_MAX_DAYS, Math.max(1, Math.trunc(parsed)));
}

interface DropRecordItem {
  name: string;
  count: number;
  [key: string]: unknown;
}

interface DropRecordEntry {
  timestamp: string;
  stage: string;
  times: number;
  sanity: number;
  medicine: number;
  stone: number;
  items: DropRecordItem[];
  source: string;
  mode: string;
}

interface DropSummary {
  totalSanity: number;
  totalMedicine: number;
  totalStone: number;
  totalBattles: number;
  itemsSummary: Record<string, number>;
}

interface DropRecordFile {
  date: string;
  records: DropRecordEntry[];
  summary: DropSummary;
}

interface MaterialInfo {
  name: string;
  iconId: unknown;
  rarity: unknown;
}

interface DropStatisticItem {
  count: number;
  stages: Record<string, number>;
  iconId: unknown;
  rarity: unknown;
}

interface DropStatisticStage {
  battles: number;
  sanity: number;
  items: Record<string, number>;
}

interface DailyDropTrend {
  date: string;
  sanity: number;
  medicine: number;
  stone: number;
  battles: number;
  items: Record<string, number>;
}

interface DropStatistics {
  dateRange: {
    start: string | null;
    end: string | null;
    days: number;
  };
  total: {
    sanity: number;
    medicine: number;
    stone: number;
    battles: number;
  };
  items: Record<string, DropStatisticItem>;
  stages: Record<string, DropStatisticStage>;
  dailyTrend: DailyDropTrend[];
}

// 业务日期统一使用服务器配置时区，避免北京时间凌晨落到前一天。
export function getLocalDateString(
  date: Date | number = new Date(),
  timeZone: string = process.env.TZ || 'Asia/Shanghai'
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part): [string, string] => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

// 获取今天的记录文件路径
function getTodayRecordPath() {
  return path.join(DROP_RECORDS_DIR, `${getLocalDateString()}.json`);
}

// 创建空记录结构
function createEmptyRecord(date: string = getLocalDateString()): DropRecordFile {
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

function normalizeDropItems(value: unknown): DropRecordItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map(item => ({
    ...item,
    name: typeof item.name === 'string' ? item.name : String(item.name ?? ''),
    count: Number(item.count) || 0
  }));
}

/**
 * 记录掉落数据
 */
export async function recordDrops(dropData: unknown) {
  try {
    await ensureDir(DROP_RECORDS_DIR);
    const recordPath = getTodayRecordPath();
    const input = isRecord(dropData) ? dropData : {};

    // 使用 updateJsonFile 简化读取-修改-写入流程
    const todayRecord = await updateJsonFile(
      recordPath,
      (existingRecord: DropRecordFile) => {
        const record = existingRecord || createEmptyRecord();

        // 添加新记录
        const newRecord: DropRecordEntry = {
          timestamp: new Date().toISOString(),
          stage: typeof input.stage === 'string' ? input.stage : String(input.stage ?? ''),
          times: Number(input.times) || 1,
          sanity: Number(input.sanity) || 0,
          medicine: Number(input.medicine) || 0,
          stone: Number(input.stone) || 0,
          items: normalizeDropItems(input.items),
          source: typeof input.source === 'string' && input.source ? input.source : 'fight',
          mode: typeof input.mode === 'string' && input.mode ? input.mode : 'normal'
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

    logger.debug('已记录掉落', { stage: input.stage, times: input.times });
    dropStatsCache.clear();
    return successResponse({ record: todayRecord });
  } catch (error) {
    logger.error('记录掉落失败', { error: getErrorMessage(error) });
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
    const record = await readJsonFile<DropRecordFile>(recordPath, createEmptyRecord());
    return successResponse(record);
  } catch (error) {
    logger.error('获取今日记录失败', { error: getErrorMessage(error) });
    return errorResponse(error, '获取今日记录失败');
  }
}

/**
 * 获取指定日期范围的掉落记录
 */
export async function getRecentDrops(days: number = 7) {
  try {
    await ensureDir(DROP_RECORDS_DIR);

    const normalizedDays = normalizeDropDays(days);
    const today = new Date();
    const recordPaths: string[] = [];

    for (let i = 0; i < normalizedDays; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      recordPaths.push(path.join(DROP_RECORDS_DIR, `${getLocalDateString(date)}.json`));
    }

    const readRecords = await Promise.all(
      recordPaths.map(recordPath => readJsonFile<DropRecordFile | null>(recordPath, null))
    );
    return successResponse(readRecords.filter((record): record is DropRecordFile => record !== null));
  } catch (error) {
    logger.error('获取历史记录失败', { error: getErrorMessage(error) });
    return errorResponse(error, '获取历史记录失败');
  }
}

/**
 * 获取掉落统计（按物品汇总）
 */
export async function getDropStatistics(days: number = 7) {
  const normalizedDays = normalizeDropDays(days);
  const cached = dropStatsCache.get(normalizedDays);
  if (cached && cached.expiresAt > Date.now()) {
    return successResponse(cached.value);
  }

  try {
    const recentResult = await getRecentDrops(normalizedDays);
    if (!recentResult.success) {
      return recentResult;
    }

    const records = recentResult.data as DropRecordFile[];

    // 汇总统计
    const statistics: DropStatistics = {
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
      const dailyData: DailyDropTrend = {
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

    dropStatsCache.set(normalizedDays, {
      expiresAt: Date.now() + DROP_STATS_CACHE_TTL_MS,
      value: statistics
    });
    return successResponse(statistics);
  } catch (error) {
    logger.error('获取统计数据失败', { error: getErrorMessage(error) });
    return errorResponse(error, '获取统计数据失败');
  }
}

// 加载材料数据映射（MaaResource item_index + item_table）
async function loadMaterialsMap(): Promise<Record<string, MaterialInfo>> {
  try {
    const database: unknown = await getMaaMaterialDatabase();
    const materials = isRecord(database) && isRecord(database.materials) ? database.materials : {};
    const map: Record<string, MaterialInfo> = {};
    for (const item of Object.values(materials)) {
      if (!isRecord(item)) continue;
      const name = typeof item.name === 'string' ? item.name : '';
      if (!name) continue;
      map[name] = {
        name,
        iconId: item.iconId ?? null,
        rarity: item.rarity ?? null
      };
    }
    return map;
  } catch (error) {
    logger.warn('无法加载 MaaResource 材料数据', { error: getErrorMessage(error) });
    return {};
  }
}

// 处理单条记录的统计
function processRecordForStatistics(
  record: DropRecordEntry,
  statistics: DropStatistics,
  materialsMap: Record<string, MaterialInfo>
): void {
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
