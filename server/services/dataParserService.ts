import { asErrorWithCode, getErrorMessage, isRecord } from '../utils/errors.ts';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readJsonFile, writeJsonFile, ensureDir } from '../utils/fileHelper.ts';
import { successResponse, errorResponse, agentError } from '../utils/apiHelper.ts';
import type { ApiErrorResponse } from '../utils/apiHelper.ts';
import { createLogger } from '../utils/logger.ts';
import { getMaaLogPath, getBattleDataPath } from '../config/paths.ts';
import { getMaaItemInfo } from './maaResourceDataService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logger = createLogger('DataParser');

// 项目数据目录
const DATA_DIR = join(__dirname, '..', 'data');

interface MaaItemInfo {
  name: unknown;
  icon: unknown;
  iconId: unknown;
  classifyType: unknown;
  sortId: number;
}

interface EnrichedDepotItem {
  id: string;
  name: unknown;
  count: unknown;
  icon: unknown;
  iconId: unknown;
  classifyType: unknown;
  sortId: number;
}

interface MaaCallbackPayload {
  what?: unknown;
  details?: unknown;
  [key: string]: unknown;
}

interface RecognitionPayloadSelection {
  payload: MaaCallbackPayload;
  complete: boolean;
}

type DepotPayloadData = Record<string, unknown> | unknown[];

interface OperBoxRecord {
  id: string;
  name: string;
  rarity: number;
  own: boolean;
}

interface DepotOutput {
  timestamp: string;
  itemCount: number;
  items: EnrichedDepotItem[];
  complete: boolean;
}

interface DepotParseData {
  path: string;
  itemCount: number;
  items: EnrichedDepotItem[];
  complete: boolean;
}

interface DepotParseSuccess {
  success: true;
  message: string;
  data: DepotParseData;
  meta: Record<string, unknown>;
}

type DepotParseResult = DepotParseSuccess | ApiErrorResponse;

interface OperBoxOutput {
  timestamp: string;
  operCount: number;
  totalOperCount: number;
  data: unknown[];
  allOpers: OperBoxRecord[];
}

interface OperBoxParseData {
  path: string;
  operCount: number;
  totalOperCount: number;
  data: unknown[];
  allOpers: OperBoxRecord[];
}

interface OperBoxParseSuccess {
  success: true;
  message: string;
  data: OperBoxParseData;
  meta: Record<string, unknown>;
}

type OperBoxParseResult = OperBoxParseSuccess | ApiErrorResponse;

interface OperatorSummary {
  id: string;
  name: string;
  rarity: number;
  profession: unknown;
  position: unknown;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getPayloadDetails(payload: MaaCallbackPayload): Record<string, unknown> {
  return isRecord(payload.details) ? payload.details : {};
}

function isDepotPayloadData(value: unknown): value is DepotPayloadData {
  return isRecord(value) || Array.isArray(value);
}

/**
 * 根据物品 ID 获取物品信息；数据统一来自 MaaResource。
 */
async function getItemInfo(itemId: string): Promise<MaaItemInfo> {
  const item: unknown = await getMaaItemInfo(itemId).catch((error: unknown) => {
    logger.warn('加载 MaaResource 物品信息失败', { itemId, error: getErrorMessage(error) });
    return null;
  });

  if (isRecord(item)) {
    return {
      name: typeof item.name === 'string' ? item.name : `未知物品 (${itemId})`,
      icon: item.icon ?? null,
      iconId: item.iconId ?? itemId,
      classifyType: typeof item.classifyType === 'string' ? item.classifyType : 'UNKNOWN',
      sortId: toFiniteNumber(item.sortId, 999999)
    };
  }

  return {
    name: `未知物品 (${itemId})`,
    icon: null,
    iconId: itemId,
    classifyType: 'UNKNOWN',
    sortId: 999999
  };
}

const CALLBACK_MARKER = 'Assistant::append_callback | ';

async function readMaaLogFile(logPath: string): Promise<string> {
  const { readFile } = await import('fs/promises');
  return readFile(logPath, 'utf-8');
}

/**
 * Parse one callback payload per line. MaaCore emits `class`, `details` and
 * `what` in an order that is not stable across versions, so match on the
 * parsed object rather than a positional regular expression.
 */
export function extractCallbackPayloads(logContent: unknown, what: string): MaaCallbackPayload[] {
  const payloads: MaaCallbackPayload[] = [];
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
      const payload: unknown = JSON.parse(text);
      if (isRecord(payload) && payload.what === what) payloads.push(payload);
    } catch {
      // A wrapped or truncated log line cannot be trusted; try the next one.
    }
  }

  return payloads;
}

export function selectRecognitionPayload(
  payloads: MaaCallbackPayload[],
  hasPayload: (payload: MaaCallbackPayload) => boolean
): RecognitionPayloadSelection | null {
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    const payload = payloads[index];
    if (getPayloadDetails(payload).done === true && hasPayload(payload)) {
      return { payload, complete: true };
    }
  }

  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    const payload = payloads[index];
    if (hasPayload(payload)) return { payload, complete: false };
  }

  return null;
}

export function parseDepotPayloadData(details: unknown): DepotPayloadData | null {
  if (!isRecord(details)) return null;
  const data = details.data;
  if (typeof data === 'string') {
    const parsed: unknown = JSON.parse(data);
    return isDepotPayloadData(parsed) ? parsed : null;
  }
  if (isRecord(data)) return data;
  return null;
}

/**
 * 解析 MAA 日志文件，提取 DepotInfo 数据
 */
export async function parseDepotData(runtime: unknown = {}): Promise<DepotParseResult> {
  const runtimeRecord = isRecord(runtime) ? runtime : {};
  const runtimeLogPath = runtimeRecord.logPath;
  const logPath = typeof runtimeLogPath === 'string' && runtimeLogPath
    ? runtimeLogPath
    : getMaaLogPath();

  try {
    logger.info('开始解析仓库数据', { logPath });
    let logContent: unknown;
    try {
      logContent = runtimeRecord.logContent !== undefined
        ? runtimeRecord.logContent
        : await readMaaLogFile(logPath);
    } catch (error) {
      return errorResponse(
        agentError('AGENT_DEPOT_LOG_UNAVAILABLE', `无法读取 MAA 日志: ${getErrorMessage(error)}`, {
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
      payload => {
        const data = getPayloadDetails(payload).data;
        return typeof data === 'string' || isRecord(data);
      }
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

    let depotData: DepotPayloadData | null;
    try {
      depotData = parseDepotPayloadData(selected.payload.details);
    } catch (error) {
      return errorResponse(
        agentError('AGENT_DEPOT_PARSE_FAILED', `仓库识别数据解析失败: ${getErrorMessage(error)}`, {
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
    const runtimeDataDir = runtimeRecord.dataDir;
    const dataDir = typeof runtimeDataDir === 'string' && runtimeDataDir ? runtimeDataDir : DATA_DIR;
    await ensureDir(dataDir);
    const outputPath = join(dataDir, 'depot.json');

    const output: DepotOutput = {
      timestamp: new Date().toISOString(),
      itemCount: Object.keys(depotData).length,
      items: sortedData,
      complete: selected.complete
    };

    await writeJsonFile(outputPath, output);
    logger.success('仓库数据已保存', { path: outputPath });

    return successResponse({
      path: outputPath,
      itemCount: Object.keys(depotData).length,
      items: sortedData,
      complete: selected.complete
    }) as DepotParseSuccess;
  } catch (error) {
    logger.error('解析仓库数据失败', { error: getErrorMessage(error), stack: asErrorWithCode(error).stack });
    return errorResponse(
      agentError('AGENT_DEPOT_PROCESSING_FAILED', `解析仓库数据失败: ${getErrorMessage(error)}`, {
        statusCode: 500,
        details: { logPath },
        retryable: true
      }),
      '解析仓库数据失败'
    );
  }
}

// 辅助函数：丰富仓库数据（添加物品信息）
async function enrichDepotData(depotData: DepotPayloadData): Promise<Record<string, EnrichedDepotItem>> {
  const enrichedData: Record<string, EnrichedDepotItem> = {};

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
export async function parseOperBoxData(runtime: unknown = {}): Promise<OperBoxParseResult> {
  const runtimeRecord = isRecord(runtime) ? runtime : {};
  const runtimeLogPath = runtimeRecord.logPath;
  const logPath = typeof runtimeLogPath === 'string' && runtimeLogPath
    ? runtimeLogPath
    : getMaaLogPath();

  try {
    logger.info('开始解析干员数据', { logPath });
    let logContent: unknown;
    try {
      logContent = runtimeRecord.logContent !== undefined
        ? runtimeRecord.logContent
        : await readMaaLogFile(logPath);
    } catch (error) {
      return errorResponse(
        agentError('AGENT_OPERBOX_LOG_UNAVAILABLE', `无法读取 MAA 日志: ${getErrorMessage(error)}`, {
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
      payload => Array.isArray(getPayloadDetails(payload).own_opers)
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

    const details = getPayloadDetails(selected.payload);
    const ownOpers = details.own_opers;
    const opers = Array.isArray(ownOpers) ? ownOpers : [];
    const allOpersValue = details.all_opers;
    const allOpers = Array.isArray(allOpersValue)
      ? allOpersValue
        .map(oper => toOperBoxRecord(oper, isRecord(oper) && oper.own === true))
        .filter((oper): oper is OperBoxRecord => oper !== null)
      : opers
        .map(oper => toOperBoxRecord(oper, true))
        .filter((oper): oper is OperBoxRecord => oper !== null);
    logger.success(`解析成功，已拥有干员: ${opers.length}/${allOpers.length}`);

    // 保存到文件
    const runtimeDataDir = runtimeRecord.dataDir;
    const dataDir = typeof runtimeDataDir === 'string' && runtimeDataDir ? runtimeDataDir : DATA_DIR;
    await ensureDir(dataDir);
    const outputPath = join(dataDir, 'operbox.json');

    const output: OperBoxOutput = {
      timestamp: new Date().toISOString(),
      operCount: opers.length,
      totalOperCount: allOpers.length,
      data: opers,
      allOpers
    };

    await writeJsonFile(outputPath, output);
    logger.success('干员数据已保存', { path: outputPath });

    return successResponse({
      path: outputPath,
      operCount: opers.length,
      totalOperCount: allOpers.length,
      data: opers,
      allOpers
    }) as OperBoxParseSuccess;
  } catch (error) {
    logger.error('解析干员数据失败', { error: getErrorMessage(error), stack: asErrorWithCode(error).stack });
    return errorResponse(
      agentError('AGENT_OPERBOX_PROCESSING_FAILED', `解析干员数据失败: ${getErrorMessage(error)}`, {
        statusCode: 500,
        details: { logPath },
        retryable: true
      }),
      '解析干员数据失败'
    );
  }
}

function toOperBoxRecord(oper: unknown, own: boolean): OperBoxRecord | null {
  if (!isRecord(oper) || typeof oper.id !== 'string' || !oper.id) return null;
  return {
    id: oper.id,
    name: typeof oper.name === 'string' && oper.name ? oper.name : oper.id,
    rarity: Number(oper.rarity) || 0,
    own
  };
}

/**
 * 读取已保存的仓库数据
 */
export async function getDepotData(): Promise<unknown> {
  const filePath = join(DATA_DIR, 'depot.json');
  return await readJsonFile<unknown>(filePath, null);
}

/**
 * 读取已保存的干员数据
 */
export async function getOperBoxData(): Promise<unknown> {
  const filePath = join(DATA_DIR, 'operbox.json');
  return await readJsonFile<unknown>(filePath, null);
}

/**
 * 获取所有干员列表（从 MAA 资源文件）
 */
export async function getAllOperators(): Promise<OperatorSummary[]> {
  try {
    const battleDataPath = getBattleDataPath();
    const data = await readJsonFile<unknown>(battleDataPath);

    if (!isRecord(data) || !isRecord(data.chars)) {
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
      .map(([id, char]) => {
        const record = isRecord(char) ? char : {};
        return {
          id,
          name: typeof record.name === 'string' && record.name ? record.name : id,
          rarity: Number(record.rarity) || 0,
          profession: record.profession ?? null,
          position: record.position ?? null
        };
      })
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
    logger.error('加载所有干员失败', { error: getErrorMessage(error) });
    throw error;
  }
}
