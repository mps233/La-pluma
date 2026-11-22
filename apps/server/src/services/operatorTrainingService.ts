/**
 * 队列写入按 `serializeTrainingMutation` 串行，流程同步与应用计划复用同一把锁；
 * 本服务是养成领域唯一入口，不暴露可被其它模块直接改写的队列对象；队列命令入参
 * 来自 HTTP 请求体，进入持久化前按领域类型校验。
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readJsonFile } from '../utils/fileHelper.ts';
import { createLogger } from '../utils/logger.ts';
import { resolveAppPaths } from '../config/runtimeConfig.ts';
import { getAllOperators } from './dataParserService.ts';
import {
  buildTrainingCandidates,
  calculateOperatorMaterials,
  calculateProgress,
  getOperBoxOperators,
  isRecord,
  normalizeTrainingSettings,
  trainingError
} from './operatorTrainingModel.ts';
import type {
  LmdRequirement,
  MaterialCalculation,
  OwnedOperator,
  TrainingBaseOperator,
  TrainingCandidate,
  TrainingMaterialNeed,
  TrainingOperatorFilters,
  TrainingOperatorRequirements,
  TrainingSettings
} from './operatorTrainingModel.ts';
import {
  buildOperatorRecognitionSummary,
  mergeOperatorCatalog,
  resolveRecognitionCoverage
} from './operatorCatalogModel.ts';
import type {
  OperatorCatalogEntry,
  OperatorRecognitionSummary
} from './operatorCatalogModel.ts';
import {
  getQueueRevision,
  loadDepot,
  loadOperatorMaterials,
  loadOperBox,
  loadTrainingQueue,
  saveTrainingQueue,
  serializeTrainingMutation
} from './operatorTrainingStore.ts';
import type { TrainingQueueItem } from './operatorTrainingStore.ts';
import { generateTrainingPlan } from './operatorTrainingPlan.ts';
import type { TrainingPlan, TrainingPlanOptions } from './operatorTrainingPlan.ts';
import { getGameDay, resolveGameZone } from './gameCalendar.ts';
import { resolveConnection } from './connectionService.ts';
import {
  applyPlanToTasks,
  finishQueueMutation,
  getQueueFlowSync,
  syncTrainingFlow
} from './operatorTrainingApplication.ts';
import type {
  ApplyPlanOptions,
  ApplyPlanResult,
  FlowSyncState,
  QueueMutationResult,
  TrainingFlowSyncResult
} from './operatorTrainingApplication.ts';

export { expandMaterialTree, estimateMaterialFarming } from './operatorTrainingPlan.ts';
export { summarizeScheduleSync } from './operatorTrainingApplication.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 养成数据目录：抓取脚本与存储层使用同一解析结果，避免读写目录分裂。
const TRAINING_DATA_DIR = resolveAppPaths().trainingDataDir;

const logger = createLogger('OperatorTraining');

export interface TrainingQueueItemDetail extends TrainingQueueItem {
  operator: {
    id: string;
    name: string;
    rarity?: number;
    profession?: string;
  };
  materials: TrainingMaterialNeed[];
  lmd: LmdRequirement;
  isComplete: boolean;
  progress: number;
}

export interface TrainingQueueSnapshot {
  queue: TrainingQueueItemDetail[];
  settings: TrainingSettings;
  lastUpdated: string;
  revision: string;
  gameDate: string;
  clientType: string;
  flowSync: FlowSyncState;
}

/** 候选列表及其识别完整度；识别概要不受候选筛选条件影响。 */
export interface TrainingOperatorList {
  operators: TrainingCandidate[];
  recognition: OperatorRecognitionSummary;
}

/** 入队选项：来自请求体的值经有限数值校验后写入队列。 */
export interface QueueAddOptions {
  currentElite?: number;
  targetElite?: number;
  position?: number;
}

interface MaterialFetchScriptConfig {
  name: string;
  script: string;
  output: string;
}

export interface MaterialFetchScriptResult {
  name: string;
  script: string;
  output: string;
  success: boolean;
  durationMs: number;
  entries?: number | null;
  error?: string;
}

export interface MaterialFetchSummary {
  scripts: MaterialFetchScriptResult[];
  operatorCount: number;
  materialCount: number;
  recipeCount: number;
  lastUpdated: string;
}

export interface OperatorTrainingService {
  getOperatorList(filters?: TrainingOperatorFilters): Promise<TrainingOperatorList>;
  getTrainingQueue(): Promise<TrainingQueueSnapshot>;
  addToQueue(operatorId: string, options?: QueueAddOptions): Promise<QueueMutationResult & TrainingQueueItem>;
  removeFromQueue(operatorId: string): Promise<QueueMutationResult>;
  updateQueueOrder(orderedOperatorIds: unknown): Promise<QueueMutationResult>;
  updateSettings(settings: unknown): Promise<TrainingSettings>;
  syncTrainingFlow(): Promise<TrainingFlowSyncResult>;
  generateTrainingPlan(mode?: string, options?: TrainingPlanOptions): Promise<TrainingPlan>;
  applyPlanToTasks(plan: unknown, settings?: unknown, options?: ApplyPlanOptions): Promise<ApplyPlanResult>;
  calculateOperatorMaterials(
    operator: TrainingOperatorRequirements,
    depot?: Record<string, number>
  ): MaterialCalculation;
  fetchOperatorMaterials(): Promise<MaterialFetchSummary>;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toCatalogEntry(operator: OwnedOperator): OperatorCatalogEntry {
  const entry: OperatorCatalogEntry = {
    id: operator.id,
    name: operator.name || operator.id
  };
  if (operator.rarity !== undefined) entry.rarity = operator.rarity;
  if (operator.profession) entry.profession = operator.profession;
  return entry;
}

/**
 * 合并本地训练目录、识别目录与已识别干员：识别目录补充本地目录缺失的条目，
 * 本地目录字段优先。识别快照缺失或没有目录时，未列出的干员保持拥有状态未知。
 */
async function buildOperatorCatalog(): Promise<{
  operators: TrainingBaseOperator[];
  owned: OwnedOperator[];
  recognition: OperatorRecognitionSummary;
}> {
  const operBoxData = await loadOperBox();
  const ownedOperators = getOperBoxOperators(operBoxData);
  const recognizedCatalog = operBoxData?.allOpers ?? [];

  let localOperators: TrainingBaseOperator[] = [];
  try {
    localOperators = await getAllOperators();
  } catch (error) {
    logger.warn('加载全量干员失败，改用识别目录与已识别干员', { error: errorMessage(error) });
  }

  const merged = mergeOperatorCatalog(
    localOperators,
    recognizedCatalog,
    ownedOperators.map(toCatalogEntry)
  );
  const baseOperators: TrainingBaseOperator[] = merged.map(entry => ({
    id: entry.id,
    name: entry.name,
    rarity: entry.rarity ?? 0,
    ...(entry.profession ? { profession: entry.profession } : {}),
    ...(entry.position ? { position: entry.position } : {})
  }));

  const ownedIds = new Set(ownedOperators.map(operator => operator.id));
  const hasSnapshot = operBoxData !== null
    && (ownedOperators.length > 0 || recognizedCatalog.length > 0);
  // 完整度取快照写入时的识别信号；目录存在不代表识别覆盖了全部干员。
  const coverage = resolveRecognitionCoverage(
    baseOperators.map(operator => operator.id),
    hasSnapshot
      ? {
          status: operBoxData.recognition?.status ?? 'partial',
          catalog: recognizedCatalog,
          ownedIds
        }
      : null
  );

  return {
    operators: baseOperators,
    owned: ownedOperators,
    recognition: buildOperatorRecognitionSummary(coverage, {
      recognizedAt: operBoxData?.timestamp ?? null,
      total: baseOperators.length,
      owned: ownedIds.size
    })
  };
}

async function getOperatorList(filters: TrainingOperatorFilters = {}): Promise<TrainingOperatorList> {
  const [operatorMaterialsData, catalog] = await Promise.all([
    loadOperatorMaterials(),
    buildOperatorCatalog()
  ]);

  return {
    operators: buildTrainingCandidates(
      catalog.operators,
      catalog.owned,
      operatorMaterialsData,
      filters,
      new Set(catalog.recognition.missing)
    ),
    recognition: catalog.recognition
  };
}

async function resolveQueueContext(): Promise<{ gameDate: string; clientType: string }> {
  let rawClientType: string | undefined;
  try {
    rawClientType = (await resolveConnection()).clientType;
  } catch (error) {
    logger.warn('读取连接配置失败，养成队列上下文按默认客户端计算', { error: errorMessage(error) });
  }
  const clientType = resolveGameZone(rawClientType).clientType;
  return {
    gameDate: getGameDay(new Date(), clientType).date,
    clientType
  };
}

async function getTrainingQueue(): Promise<TrainingQueueSnapshot> {
  const queueData = await loadTrainingQueue();
  const depot = await loadDepot();
  const operatorMaterialsData = await loadOperatorMaterials();
  const context = await resolveQueueContext();

  const enrichedQueue: TrainingQueueItemDetail[] = [];

  for (const queueItem of queueData.queue) {
    const opData = operatorMaterialsData.operators[queueItem.operatorId];
    if (!opData) continue;

    const operator: TrainingOperatorRequirements = {
      id: queueItem.operatorId,
      name: opData.name,
      rarity: opData.rarity,
      profession: opData.profession,
      currentElite: queueItem.currentElite ?? 0,
      targetElite: queueItem.targetElite ?? 2,
      materials: {
        elite1: opData.elite1,
        elite2: opData.elite2
      }
    };

    const materialCalc = calculateOperatorMaterials(operator, depot.items);

    enrichedQueue.push({
      ...queueItem,
      operator: {
        id: operator.id,
        name: opData.name,
        rarity: opData.rarity,
        profession: opData.profession
      },
      materials: materialCalc.materials,
      lmd: materialCalc.lmd,
      isComplete: materialCalc.isComplete,
      progress: calculateProgress(materialCalc)
    });
  }

  return {
    queue: enrichedQueue,
    settings: queueData.settings,
    lastUpdated: queueData.lastUpdated,
    revision: getQueueRevision(queueData),
    gameDate: context.gameDate,
    clientType: context.clientType,
    flowSync: await getQueueFlowSync(queueData)
  };
}

async function addToQueue(
  operatorId: string,
  options: QueueAddOptions = {}
): Promise<QueueMutationResult & TrainingQueueItem> {
  const queueData = await loadTrainingQueue();
  const operatorMaterialsData = await loadOperatorMaterials();
  const operBoxData = await loadOperBox();

  const opData = operatorMaterialsData.operators[operatorId];
  if (!opData) {
    throw new Error(`干员材料数据不存在，暂不支持该干员`);
  }

  const operBoxOp = getOperBoxOperators(operBoxData).find(op => op.id === operatorId);
  const operatorName = operBoxOp?.name || opData.name;

  const existingIndex = queueData.queue.findIndex(item => item.operatorId === operatorId);
  if (existingIndex !== -1) {
    throw new Error(`干员 ${operatorName} 已在养成队列中`);
  }

  const queueItem: TrainingQueueItem = {
    operatorId,
    currentElite: toFiniteNumber(options.currentElite) ?? operBoxOp?.elite ?? 0,
    targetElite: toFiniteNumber(options.targetElite) ?? 2,
    priority: queueData.queue.length + 1,
    status: 'pending',
    addedAt: new Date().toISOString()
  };

  const position = options.position ?? queueData.queue.length;
  if (!Number.isInteger(position) || position < 0 || position > queueData.queue.length) {
    throw trainingError('position 必须是有效的队列位置');
  }
  queueData.queue.splice(position, 0, queueItem);
  queueData.queue.forEach((item, index) => { item.priority = index + 1; });
  return finishQueueMutation(queueData, queueItem);
}

async function removeFromQueue(operatorId: string): Promise<QueueMutationResult> {
  const queueData = await loadTrainingQueue();

  const index = queueData.queue.findIndex(item => item.operatorId === operatorId);
  if (index === -1) {
    throw new Error('干员不在养成队列中');
  }

  const operatorMaterialsData = await loadOperatorMaterials();
  const opData = operatorMaterialsData.operators[operatorId];
  const operatorName = opData?.name || operatorId;

  queueData.queue.splice(index, 1);

  queueData.queue.forEach((item, idx) => {
    item.priority = idx + 1;
  });

  logger.info('干员已从养成队列移除', { operatorName, remainingCount: queueData.queue.length });
  return finishQueueMutation(queueData);
}

async function updateQueueOrder(orderedOperatorIds: unknown): Promise<QueueMutationResult> {
  const queueData = await loadTrainingQueue();
  const existingIds = queueData.queue.map(item => item.operatorId);
  const orderedIds = Array.isArray(orderedOperatorIds) && orderedOperatorIds.every(id => typeof id === 'string')
    ? orderedOperatorIds as string[]
    : null;
  if (!orderedIds || orderedIds.length !== existingIds.length ||
      new Set(orderedIds).size !== existingIds.length ||
      orderedIds.some(id => !existingIds.includes(id))) {
    throw trainingError('排序必须包含全部养成干员且不能重复');
  }
  const newQueue: TrainingQueueItem[] = [];
  orderedIds.forEach((opId, index) => {
    const item = queueData.queue.find(q => q.operatorId === opId);
    if (item) {
      item.priority = index + 1;
      newQueue.push(item);
    }
  });

  queueData.queue = newQueue;
  return finishQueueMutation(queueData);
}

async function updateSettings(settings: unknown): Promise<TrainingSettings> {
  const queueData = await loadTrainingQueue();
  queueData.settings = normalizeTrainingSettings({
    ...queueData.settings,
    ...(isRecord(settings) ? settings : {})
  });
  await saveTrainingQueue(queueData);
  return queueData.settings;
}

const MATERIAL_FETCH_SCRIPTS: MaterialFetchScriptConfig[] = [
  { name: 'fetch-all-materials', script: 'fetch-all-materials.ts', output: 'materials.json' },
  { name: 'fetch-material-formulas', script: 'fetch-material-formulas.ts', output: 'material-formulas.json' },
  { name: 'merge-formulas', script: 'merge-formulas.ts', output: 'materials.json' },
  { name: 'fetch-operator-materials', script: 'fetch-operator-materials.ts', output: 'operator-materials.json' },
  { name: 'fetch-penguin-stats', script: 'fetch-penguin-stats.ts', output: 'penguin-drop-data.json' }
];

const FETCH_SCRIPT_TIMEOUT_MS = 5 * 60 * 1000;

async function countDataFileEntries(fileName: string): Promise<number | null> {
  const data = await readJsonFile(path.join(TRAINING_DATA_DIR, fileName), null);
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (isRecord(record.operators)) return Object.keys(record.operators).length;
  if (isRecord(record.materials)) return Object.keys(record.materials).length;
  return Object.keys(record).length;
}

async function countMaterialSnapshotEntries(): Promise<{ materialCount: number; recipeCount: number }> {
  const data = await readJsonFile(path.join(TRAINING_DATA_DIR, 'materials.json'), null);
  if (!isRecord(data)) return { materialCount: 0, recipeCount: 0 };
  return {
    materialCount: isRecord(data.materials) ? Object.keys(data.materials).length : 0,
    recipeCount: isRecord(data.recipes) ? Object.keys(data.recipes).length : 0
  };
}

async function runMaterialFetchScript(config: MaterialFetchScriptConfig): Promise<MaterialFetchScriptResult> {
  const { name, script, output } = config;
  const scriptPath = path.join(__dirname, '../../scripts', script);
  const startedAt = Date.now();
  logger.info('执行材料数据抓取脚本', { name, script });

  try {
    // promisify 在调用时包装，便于测试中通过 mock 替换 execFile
    const { stdout } = await promisify(execFile)(process.execPath, [scriptPath], {
      cwd: path.join(__dirname, '..', '..'),
      timeout: FETCH_SCRIPT_TIMEOUT_MS,
      // 脚本输出可能超出默认 1MiB，放宽缓冲避免以晦涩的错误失败
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });
    const durationMs = Date.now() - startedAt;
    const entries = await countDataFileEntries(output);
    logger.success('材料数据脚本执行成功', { name, durationMs, entries, stdout: stdout?.slice(0, 200) });
    return { name, script, output, success: true, durationMs, entries };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    // execFile 失败时错误对象带有 stderr，优先携带到错误信息中
    const stderr = isRecord(error) && typeof error.stderr === 'string' ? error.stderr : '';
    const detail = (stderr && stderr.trim()) || errorMessage(error);
    logger.error('材料数据脚本执行失败', { name, durationMs, error: detail });
    return { name, script, output, success: false, durationMs, error: detail };
  }
}

/**
 * 串行执行抓取脚本（避免数据源限流）；单个脚本失败记录后继续，全部结束后整体抛错。
 */
async function fetchOperatorMaterials(): Promise<MaterialFetchSummary> {
  logger.info('开始更新养成材料数据');

  const results: MaterialFetchScriptResult[] = [];
  for (const scriptConfig of MATERIAL_FETCH_SCRIPTS) {
    results.push(await runMaterialFetchScript(scriptConfig));
  }

  const failedScripts = results.filter(result => !result.success);
  if (failedScripts.length > 0) {
    const detail = failedScripts.map(result => `${result.name}: ${result.error}`).join('; ');
    throw new Error(`养成材料数据更新失败（${failedScripts.length}/${results.length} 个脚本失败）: ${detail}`);
  }

  const operatorMaterialsData = await loadOperatorMaterials();
  const snapshotCounts = await countMaterialSnapshotEntries();
  const summary: MaterialFetchSummary = {
    scripts: results,
    operatorCount: Object.keys(operatorMaterialsData.operators).length,
    materialCount: snapshotCounts.materialCount,
    recipeCount: snapshotCounts.recipeCount,
    lastUpdated: new Date().toISOString()
  };

  logger.success('养成材料数据更新完成', {
    operatorCount: summary.operatorCount,
    materialCount: summary.materialCount,
    recipeCount: summary.recipeCount
  });

  return summary;
}

const operatorTrainingService: OperatorTrainingService = {
  getOperatorList,
  getTrainingQueue,
  addToQueue: (...args) => serializeTrainingMutation(() => addToQueue(...args)),
  removeFromQueue: (...args) => serializeTrainingMutation(() => removeFromQueue(...args)),
  updateQueueOrder: (...args) => serializeTrainingMutation(() => updateQueueOrder(...args)),
  updateSettings: (...args) => serializeTrainingMutation(() => updateSettings(...args)),
  syncTrainingFlow: () => serializeTrainingMutation(() => syncTrainingFlow()),
  generateTrainingPlan,
  applyPlanToTasks: (...args) => serializeTrainingMutation(() => applyPlanToTasks(...args)),
  calculateOperatorMaterials,
  fetchOperatorMaterials
};

export default operatorTrainingService;
