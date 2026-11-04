import { asErrorWithCode, getErrorMessage, isRecord } from '../utils/errors.ts';
/**
 * 干员养成服务
 * 负责干员识别、材料需求计算、养成队列管理等
 */

import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readJsonFile, writeJsonFile } from '../utils/fileHelper.ts';
import { createLogger } from '../utils/logger.ts';
import { getTodayOpenStages, isStageOpenToday } from './notificationService.ts';
import { isResourceCollectionOpenNow } from './activityDataService.ts';
import { getAllOperators } from './dataParserService.ts';
import { getMaaMaterialDatabase } from './maaResourceDataService.ts';
import { agentError } from '../utils/apiHelper.ts';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 创建日志记录器
const logger = createLogger('OperatorTraining');

// 配置文件路径
const TRAINING_QUEUE_PATH = path.join(__dirname, '../data/user-configs/training-queue.json');
const OPERATOR_MATERIALS_PATH = path.join(__dirname, '../data/operator-materials.json');
const OPERBOX_PATH = path.join(__dirname, '../data/operbox.json');
const DEPOT_PATH = path.join(__dirname, '../data/depot.json');

interface TrainingSettings {
  autoSwitch: boolean;
  notifyOnComplete: boolean;
  useMedicine: number;
  useStone: number;
  fallbackStage?: string;
  fallbackTimes?: number;
  [key: string]: unknown;
}

const DEFAULT_TRAINING_SETTINGS: TrainingSettings = {
  autoSwitch: true,
  notifyOnComplete: true,
  useMedicine: 0,
  useStone: 0
};

function toFiniteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTrainingSettings(settings: unknown = {}): TrainingSettings {
  const normalized: Record<string, unknown> = isRecord(settings) ? { ...settings } : {};
  if (typeof normalized.notify === 'boolean' && typeof normalized.notifyOnComplete !== 'boolean') {
    normalized.notifyOnComplete = normalized.notify;
  }
  delete normalized.notify;
  return {
    ...DEFAULT_TRAINING_SETTINGS,
    ...normalized
  } as TrainingSettings;
}

interface StageMaterialNeed {
  id: string;
  name: string;
  count: number;
  [key: string]: unknown;
}

interface StageOpenInfo {
  isOpen: boolean;
  reason: string | null;
  stageName?: string;
  [key: string]: unknown;
}

interface PlannedStage {
  stage: string;
  materials?: StageMaterialNeed[];
  totalTimes?: number;
  times?: number;
  sanity?: number;
  isOpen?: boolean | StageOpenInfo;
  [key: string]: unknown;
}

function toApplicableStage(value: unknown): PlannedStage | null {
  if (!isRecord(value) || typeof value.stage !== 'string' || !value.stage) return null;
  if (!(Number(value.totalTimes ?? value.times ?? 0) > 0)) return null;
  return { ...value, stage: value.stage } as PlannedStage;
}

function getApplicableStages(plan: unknown = {}): PlannedStage[] {
  if (!isRecord(plan)) return [];
  const openStages = Array.isArray(plan.openStages) ? plan.openStages : null;
  const stages = Array.isArray(plan.stages) ? plan.stages : [];
  const candidateStages = openStages && openStages.length > 0
    ? openStages
    : stages.filter((stage: unknown) => !(isRecord(stage) && stage.isOpen === false));

  return candidateStages
    .map(toApplicableStage)
    .filter((stage): stage is PlannedStage => stage !== null);
}

/**
 * 关卡代号映射表
 * 将数据库中的关卡代号转换为 MAA 可识别的关卡名称
 */
const STAGE_CODE_MAP: Record<string, string> = {
  // 芯片关卡
  'pro_a_1': 'PR-A-1', // 医疗/重装芯片
  'pro_a_2': 'PR-A-2', // 医疗/重装芯片组
  'pro_b_1': 'PR-B-1', // 术师/狙击芯片
  'pro_b_2': 'PR-B-2', // 术师/狙击芯片组
  'pro_c_1': 'PR-C-1', // 先锋/辅助芯片
  'pro_c_2': 'PR-C-2', // 先锋/辅助芯片组
  'pro_d_1': 'PR-D-1', // 近卫/特种芯片
  'pro_d_2': 'PR-D-2', // 近卫/特种芯片组

  // 技能书关卡
  'ca_1': 'CA-1',
  'ca_2': 'CA-2',
  'ca_3': 'CA-3',
  'ca_4': 'CA-4',
  'ca_5': 'CA-5',

  // 龙门币关卡
  'ce_1': 'CE-1',
  'ce_2': 'CE-2',
  'ce_3': 'CE-3',
  'ce_4': 'CE-4',
  'ce_5': 'CE-5',
  'ce_6': 'CE-6',

  // 作战记录关卡
  'ls_1': 'LS-1',
  'ls_2': 'LS-2',
  'ls_3': 'LS-3',
  'ls_4': 'LS-4',
  'ls_5': 'LS-5',
  'ls_6': 'LS-6',

  // 采购凭证关卡
  'ap_1': 'AP-1',
  'ap_2': 'AP-2',
  'ap_3': 'AP-3',
  'ap_4': 'AP-4',
  'ap_5': 'AP-5',

  // 碳关卡
  'sk_1': 'SK-1',
  'sk_2': 'SK-2',
  'sk_3': 'SK-3',
  'sk_4': 'SK-4',
  'sk_5': 'SK-5',
};

/**
 * 芯片类型映射表
 * 根据芯片名称确定应该刷哪个关卡
 */
const CHIP_STAGE_MAP: Record<string, string> = {
  // 医疗/重装 (PR-A)
  '医疗芯片': 'PR-A-1',
  '医疗芯片组': 'PR-A-2',
  '医疗双芯片': 'PR-A-2',
  '重装芯片': 'PR-A-1',
  '重装芯片组': 'PR-A-2',
  '重装双芯片': 'PR-A-2',

  // 术师/狙击 (PR-B)
  '术师芯片': 'PR-B-1',
  '术师芯片组': 'PR-B-2',
  '术师双芯片': 'PR-B-2',
  '狙击芯片': 'PR-B-1',
  '狙击芯片组': 'PR-B-2',
  '狙击双芯片': 'PR-B-2',

  // 先锋/辅助 (PR-C)
  '先锋芯片': 'PR-C-1',
  '先锋芯片组': 'PR-C-2',
  '先锋双芯片': 'PR-C-2',
  '辅助芯片': 'PR-C-1',
  '辅助芯片组': 'PR-C-2',
  '辅助双芯片': 'PR-C-2',

  // 近卫/特种 (PR-D)
  '近卫芯片': 'PR-D-1',
  '近卫芯片组': 'PR-D-2',
  '近卫双芯片': 'PR-D-2',
  '特种芯片': 'PR-D-1',
  '特种芯片组': 'PR-D-2',
  '特种双芯片': 'PR-D-2',
};

/**
 * 转换关卡代号为 MAA 可识别的格式
 */
function convertStageCode(stageCode: unknown): string {
  if (!stageCode) return '';

  const code = typeof stageCode === 'string' ? stageCode : String(stageCode);

  // 如果已经是大写格式，直接返回
  if (code.match(/^[A-Z]{2,3}-[A-Z0-9]-\d+$/)) {
    return code;
  }

  // 转换为小写进行匹配
  const lowerCode = code.toLowerCase();

  // 查找映射表
  if (STAGE_CODE_MAP[lowerCode]) {
    return STAGE_CODE_MAP[lowerCode];
  }

  // 如果没有找到映射，尝试自动转换
  // 例如: pro_a_1 -> PR-A-1
  const match = lowerCode.match(/^([a-z]+)_([a-z])_(\d+)$/);
  if (match) {
    const [, prefix, letter, number] = match;
    return `${prefix.toUpperCase()}-${letter.toUpperCase()}-${number}`;
  }

  // 例如: ca_5 -> CA-5
  const match2 = lowerCode.match(/^([a-z]+)_(\d+)$/);
  if (match2) {
    const [, prefix, number] = match2;
    return `${prefix.toUpperCase()}-${number}`;
  }

  // 无法转换，返回原值
  logger.warn('无法转换关卡代号', { stageCode });
  return code;
}

interface MaterialRequirement {
  id: string;
  name: string;
  count: number;
  [key: string]: unknown;
}

interface EliteMaterials {
  lmd?: number;
  materials?: MaterialRequirement[];
  chips?: MaterialRequirement[];
  [key: string]: unknown;
}

interface OperatorMaterialsBundle {
  elite1?: EliteMaterials;
  elite2?: EliteMaterials;
}

interface OperatorMaterialData {
  name: string;
  rarity: number;
  profession?: string;
  elite1?: EliteMaterials;
  elite2?: EliteMaterials;
  [key: string]: unknown;
}

interface OperatorMaterialsFile {
  operators: Record<string, OperatorMaterialData>;
  metadata: Record<string, unknown>;
}

function normalizeMaterialRequirement(value: unknown): MaterialRequirement | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : value.id == null ? '' : String(value.id);
  if (!id) return null;
  return {
    ...value,
    id,
    name: typeof value.name === 'string' ? value.name : '',
    count: toFiniteNumber(value.count) ?? 0
  };
}

function normalizeMaterialRequirements(value: unknown): MaterialRequirement[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map(normalizeMaterialRequirement)
    .filter((material): material is MaterialRequirement => material !== null);
}

function normalizeEliteMaterials(value: unknown): EliteMaterials | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...value,
    lmd: toFiniteNumber(value.lmd),
    materials: normalizeMaterialRequirements(value.materials),
    chips: normalizeMaterialRequirements(value.chips)
  };
}

function normalizeOperatorMaterialData(value: unknown): OperatorMaterialData | null {
  if (!isRecord(value)) return null;
  return {
    ...value,
    name: typeof value.name === 'string' ? value.name : '',
    rarity: toFiniteNumber(value.rarity) ?? 0,
    profession: typeof value.profession === 'string' ? value.profession : undefined,
    elite1: normalizeEliteMaterials(value.elite1),
    elite2: normalizeEliteMaterials(value.elite2)
  };
}

function normalizeOperatorMaterialsFile(value: unknown): OperatorMaterialsFile {
  if (!isRecord(value) || !isRecord(value.operators)) {
    return { operators: {}, metadata: {} };
  }
  const operators: Record<string, OperatorMaterialData> = {};
  for (const [id, entry] of Object.entries(value.operators)) {
    const normalized = normalizeOperatorMaterialData(entry);
    if (normalized) operators[id] = normalized;
  }
  return {
    operators,
    metadata: isRecord(value.metadata) ? value.metadata : {}
  };
}

/**
 * 加载干员材料数据库
 */
async function loadOperatorMaterials(): Promise<OperatorMaterialsFile> {
  try {
    const data = await readJsonFile<unknown>(OPERATOR_MATERIALS_PATH, null);
    return normalizeOperatorMaterialsFile(data);
  } catch (error) {
    logger.error('加载干员材料数据失败', { error: getErrorMessage(error) });
    return { operators: {}, metadata: {} };
  }
}

interface MaterialStageCandidate {
  stage?: string;
  [key: string]: unknown;
}

interface MaterialInfo {
  id: string;
  name: string;
  iconId: string;
  bestStage?: string;
  bestStages?: MaterialStageCandidate[];
  [key: string]: unknown;
}

interface MaterialRecipe {
  materials: Record<string, number>;
  [key: string]: unknown;
}

interface MaterialDatabase {
  materials: Record<string, MaterialInfo>;
  recipes: Record<string, MaterialRecipe>;
  stageSchedule: Record<string, unknown>;
}

function normalizeMaterialInfo(value: unknown): MaterialInfo | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : value.id == null ? '' : String(value.id);
  const bestStages = Array.isArray(value.bestStages)
    ? value.bestStages
      .filter(isRecord)
      .map((candidate) => ({
        ...candidate,
        stage: typeof candidate.stage === 'string' ? candidate.stage : undefined
      }))
    : undefined;
  return {
    ...value,
    id,
    name: typeof value.name === 'string' ? value.name : '',
    iconId: typeof value.iconId === 'string' ? value.iconId : id,
    bestStage: typeof value.bestStage === 'string' ? value.bestStage : undefined,
    bestStages
  };
}

function normalizeMaterialRecipe(value: unknown): MaterialRecipe | null {
  if (!isRecord(value)) return null;
  const materials: Record<string, number> = {};
  if (isRecord(value.materials)) {
    for (const [subMaterialId, count] of Object.entries(value.materials)) {
      materials[subMaterialId] = toFiniteNumber(count) ?? 0;
    }
  }
  return { ...value, materials };
}

function normalizeMaterialDatabase(value: unknown): MaterialDatabase {
  const record = isRecord(value) ? value : {};
  const rawMaterials = isRecord(record.materials) ? record.materials : {};
  const rawRecipes = isRecord(record.recipes) ? record.recipes : {};
  const materials: Record<string, MaterialInfo> = {};
  const recipes: Record<string, MaterialRecipe> = {};

  for (const [id, material] of Object.entries(rawMaterials)) {
    const normalized = normalizeMaterialInfo(material);
    if (normalized) materials[id] = normalized;
  }
  for (const [id, recipe] of Object.entries(rawRecipes)) {
    const normalized = normalizeMaterialRecipe(recipe);
    if (normalized) recipes[id] = normalized;
  }

  return { materials, recipes, stageSchedule: {} };
}

let materialNameCache = new Map<string, string>();

/**
 * 加载材料数据库（包含 recipes），数据统一来自 MaaResource。
 */
async function loadMaterialsDatabase(): Promise<MaterialDatabase> {
  try {
    const database = normalizeMaterialDatabase(await getMaaMaterialDatabase());
    materialNameCache = new Map(
      Object.values(database.materials).map((material) => [material.id, material.name])
    );
    return database;
  } catch (error) {
    logger.error('加载 MaaResource 材料数据库失败', { error: getErrorMessage(error) });
    return { materials: {}, recipes: {}, stageSchedule: {} };
  }
}

/**
 * 加载材料合成配方数据库。
 */
async function loadMaterialFormulas(): Promise<Record<string, MaterialRecipe>> {
  try {
    const { recipes } = await getMaaMaterialDatabase();
    return normalizeMaterialDatabase({ recipes }).recipes;
  } catch (error) {
    logger.error('加载 MaaResource 合成配方失败', { error: getErrorMessage(error) });
    return {};
  }
}

interface OperBoxOperator {
  id: string;
  name?: string;
  rarity?: number;
  profession?: string;
  elite?: number;
  level?: number;
  potential?: number;
  own?: boolean;
  [key: string]: unknown;
}

interface OperBoxCatalogOperator {
  id: string;
  name?: string;
  rarity?: number;
  own?: boolean;
  [key: string]: unknown;
}

interface OperBoxData {
  data?: OperBoxOperator[];
  operators?: OperBoxOperator[];
  allOpers: OperBoxCatalogOperator[];
}

function normalizeOperBoxOperator(value: unknown): OperBoxOperator | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : value.id == null ? '' : String(value.id);
  if (!id) return null;
  return {
    ...value,
    id,
    name: typeof value.name === 'string' ? value.name : undefined,
    rarity: toFiniteNumber(value.rarity),
    profession: typeof value.profession === 'string' ? value.profession : undefined,
    elite: toFiniteNumber(value.elite),
    level: toFiniteNumber(value.level),
    potential: toFiniteNumber(value.potential),
    own: value.own === true
  };
}

function normalizeOperBoxCatalogOperator(value: unknown): OperBoxCatalogOperator | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : value.id == null ? '' : String(value.id);
  if (!id) return null;
  return {
    ...value,
    id,
    name: typeof value.name === 'string' ? value.name : undefined,
    rarity: toFiniteNumber(value.rarity),
    own: value.own === true
  };
}

function normalizeOperBoxOperators(value: unknown): OperBoxOperator[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map(normalizeOperBoxOperator)
    .filter((operator): operator is OperBoxOperator => operator !== null);
}

function normalizeOperBoxData(value: unknown): OperBoxData {
  const record = isRecord(value) ? value : {};
  return {
    data: normalizeOperBoxOperators(record.data),
    operators: normalizeOperBoxOperators(record.operators),
    allOpers: Array.isArray(record.allOpers)
      ? record.allOpers
        .map(normalizeOperBoxCatalogOperator)
        .filter((operator): operator is OperBoxCatalogOperator => operator !== null)
      : []
  };
}

/**
 * 加载 OperBox 识别结果
 */
async function loadOperBox(): Promise<OperBoxData> {
  try {
    return normalizeOperBoxData(await readJsonFile<unknown>(OPERBOX_PATH, { operators: [] }));
  } catch (error) {
    logger.error('加载 OperBox 数据失败', { error: getErrorMessage(error) });
    return { operators: [], allOpers: [] };
  }
}

function getOperBoxOperators(operBoxData: OperBoxData): OperBoxOperator[] {
  if (operBoxData.data) return operBoxData.data;
  if (operBoxData.operators) return operBoxData.operators;
  return [];
}

type TrainingDisabledReason = 'unowned' | 'missing_material_data' | 'already_elite2';

interface TrainingEligibility {
  owned: boolean;
  hasMaterialData: boolean;
  currentElite: number;
  targetElite: number;
}

function getTrainingDisabledReason(operator: TrainingEligibility): TrainingDisabledReason | null {
  if (!operator.owned) return 'unowned';
  if (!operator.hasMaterialData) return 'missing_material_data';
  if (operator.currentElite >= operator.targetElite) return 'already_elite2';
  return null;
}

interface DepotData {
  items: Record<string, number>;
  timestamp: string | null;
}

/**
 * 加载仓库数据
 */
async function loadDepot(): Promise<DepotData> {
  try {
    const depotData = await readJsonFile<unknown>(DEPOT_PATH, { items: [], timestamp: null });

    // 将数组转换为对象 { id: count }
    const itemsMap: Record<string, number> = {};
    if (isRecord(depotData) && Array.isArray(depotData.items)) {
      depotData.items.forEach((item: unknown) => {
        if (!isRecord(item)) return;
        const id = typeof item.id === 'string' ? item.id : item.id == null ? '' : String(item.id);
        if (!id) return;
        itemsMap[id] = toFiniteNumber(item.count) ?? 0;
      });
    }

    const timestamp = isRecord(depotData) && typeof depotData.timestamp === 'string'
      ? depotData.timestamp
      : null;
    return { items: itemsMap, timestamp };
  } catch (error) {
    logger.error('加载仓库数据失败', { error: getErrorMessage(error) });
    return { items: {}, timestamp: null };
  }
}

interface TrainingQueueItem {
  operatorId: string;
  currentElite?: unknown;
  targetElite?: unknown;
  priority?: unknown;
  status?: unknown;
  addedAt?: unknown;
  [key: string]: unknown;
}

interface TrainingQueueData {
  queue: TrainingQueueItem[];
  settings: TrainingSettings;
  lastUpdated: string;
  [key: string]: unknown;
}

function normalizeQueueItem(value: unknown): TrainingQueueItem | null {
  if (!isRecord(value)) return null;
  const operatorId = typeof value.operatorId === 'string'
    ? value.operatorId
    : value.operatorId == null
      ? ''
      : String(value.operatorId);
  if (!operatorId) return null;
  return { ...value, operatorId };
}

/**
 * 加载养成队列
 */
async function loadTrainingQueue(): Promise<TrainingQueueData> {
  const defaultQueue: TrainingQueueData = {
    queue: [],
    settings: DEFAULT_TRAINING_SETTINGS,
    lastUpdated: new Date().toISOString()
  };

  const queueData = await readJsonFile<unknown>(TRAINING_QUEUE_PATH, defaultQueue);
  const record = isRecord(queueData) ? queueData : {};
  const queue = Array.isArray(record.queue)
    ? record.queue
      .map(normalizeQueueItem)
      .filter((item): item is TrainingQueueItem => item !== null)
    : [];

  return {
    ...defaultQueue,
    ...record,
    queue,
    settings: normalizeTrainingSettings(record.settings),
    lastUpdated: typeof record.lastUpdated === 'string' ? record.lastUpdated : defaultQueue.lastUpdated
  };
}

/**
 * 保存养成队列
 */
async function saveTrainingQueue(queueData: TrainingQueueData): Promise<boolean> {
  try {
    queueData.lastUpdated = new Date().toISOString();
    await writeJsonFile(TRAINING_QUEUE_PATH, queueData);
    return true;
  } catch (error) {
    logger.error('保存养成队列失败', { error: getErrorMessage(error) });
    return false;
  }
}

interface BaseOperator {
  id: string;
  name: string;
  rarity: number;
  profession: string;
  position?: string;
}

interface TrainingOperator extends TrainingEligibility {
  id: string;
  name: string;
  rarity: number;
  profession: string;
  position?: string;
  currentLevel: number;
  targetElite: number;
  potential: number;
  materials: OperatorMaterialsBundle | null;
  canTrain: boolean;
  disabledReason: TrainingDisabledReason | null;
  trainingStatus: string;
}

function normalizeBaseOperator(value: unknown): BaseOperator | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : value.id == null ? '' : String(value.id);
  if (!id) return null;
  return {
    id,
    name: typeof value.name === 'string' ? value.name : id,
    rarity: toFiniteNumber(value.rarity) ?? 0,
    profession: typeof value.profession === 'string' ? value.profession : '未知',
    position: typeof value.position === 'string' ? value.position : undefined
  };
}

function normalizeBaseOperators(value: unknown): BaseOperator[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeBaseOperator)
    .filter((operator): operator is BaseOperator => operator !== null);
}

/**
 * 获取干员列表（全量干员为主，OperBox 和材料数据库补充养成状态）
 */
async function getOperatorList(filters: Record<string, unknown> = {}): Promise<TrainingOperator[]> {
  const operatorMaterialsData = await loadOperatorMaterials();
  const operBoxData = await loadOperBox();

  const ownedOperators = getOperBoxOperators(operBoxData);
  const ownedMap = new Map(ownedOperators.map((operator) => [operator.id, operator]));
  const catalogOwnIds = new Set(operBoxData.allOpers
    .filter((operator) => operator.own === true)
    .map((operator) => operator.id));
  let allOperators: BaseOperator[] = [];

  try {
    allOperators = normalizeBaseOperators(await getAllOperators());
  } catch (error) {
    logger.warn('加载全量干员失败，降级为仅显示已识别干员', { error: getErrorMessage(error) });
    allOperators = ownedOperators.map((operator) => ({
      id: operator.id,
      name: operator.name || operator.id,
      rarity: operator.rarity ?? 0,
      profession: operator.profession || '未知'
    }));
  }

  // Keep the training catalog consistent with OperBox/DataStatistics: add
  // operators that exist in `all_opers` but not in battle_data.
  const knownOperatorIds = new Set(allOperators.map((operator) => operator.id));
  for (const catalogOperator of operBoxData.allOpers) {
    const id = String(catalogOperator.id || '');
    if (!id || knownOperatorIds.has(id)) continue;
    allOperators.push({
      id,
      name: catalogOperator.name || id,
      rarity: Number(catalogOperator.rarity) || 0,
      profession: operatorMaterialsData.operators[id]?.profession || '未知',
      position: undefined
    });
    knownOperatorIds.add(id);
  }

  const operators = allOperators.map((baseOperator): TrainingOperator => {
    const ownedOperator = ownedMap.get(baseOperator.id);
    const opData = operatorMaterialsData.operators[baseOperator.id];
    const owned = Boolean(ownedOperator) || catalogOwnIds.has(baseOperator.id);
    const eligibility: TrainingEligibility = {
      owned,
      hasMaterialData: !!opData,
      currentElite: owned ? (ownedOperator?.elite || 0) : 0,
      targetElite: 2
    };
    const operator: TrainingOperator = {
      id: baseOperator.id,
      name: ownedOperator?.name || baseOperator.name,
      rarity: ownedOperator?.rarity ?? baseOperator.rarity,
      profession: opData?.profession || baseOperator.profession || ownedOperator?.profession || '未知',
      position: baseOperator.position,
      currentElite: eligibility.currentElite,
      currentLevel: owned ? (ownedOperator?.level || 1) : 0,
      targetElite: 2,
      owned,
      potential: owned ? (ownedOperator?.potential || 1) : 0,
      hasMaterialData: !!opData,
      materials: opData ? {
        elite1: opData.elite1,
        elite2: opData.elite2
      } : null,
      canTrain: false,
      disabledReason: null,
      trainingStatus: ''
    };

    const disabledReason = getTrainingDisabledReason(operator);
    operator.canTrain = disabledReason === null;
    operator.disabledReason = disabledReason;
    operator.trainingStatus = disabledReason === null
      ? 'trainable'
      : owned
        ? disabledReason
        : 'unowned';
    return operator;
  });

  const filteredOperators = operators.filter((operator) => {
    if (filters.rarity && operator.rarity !== filters.rarity) return false;
    if (filters.profession && operator.profession !== filters.profession) return false;
    if (filters.owned !== undefined && operator.owned !== filters.owned) return false;
    if (filters.needsElite2 && operator.owned && operator.currentElite >= 2) return false;

    switch (filters.status) {
      case 'trainable':
        return operator.canTrain;
      case 'owned':
        return operator.owned;
      case 'all':
      default:
        return true;
    }
  });

  // 排序：可养成优先，已拥有其次，未拥有最后；同组按稀有度和名称排序
  filteredOperators.sort((a, b) => {
    if (a.canTrain !== b.canTrain) return a.canTrain ? -1 : 1;
    if (a.owned !== b.owned) return a.owned ? -1 : 1;
    if (a.rarity !== b.rarity) return b.rarity - a.rarity;
    if (a.currentElite !== b.currentElite) return a.currentElite - b.currentElite;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return filteredOperators;
}

// Current Arknights game data no longer carries the LMD entry in evolveCost.
// These are the standard promotion LMD costs by rarity.
const ELITE_LMD_COSTS: Record<number, { elite1: number; elite2: number }> = {
  3: { elite1: 15000, elite2: 0 },
  4: { elite1: 30000, elite2: 180000 },
  5: { elite1: 40000, elite2: 200000 },
  6: { elite1: 50000, elite2: 210000 }
};

interface EliteLmdSource {
  rarity?: number;
  materials?: {
    elite1?: { lmd?: number };
    elite2?: { lmd?: number };
  } | null;
}

export function getEliteLmdCost(operator: EliteLmdSource, phase: 'elite1' | 'elite2'): number {
  const explicit = Number(operator?.materials?.[phase]?.lmd);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return ELITE_LMD_COSTS[Number(operator?.rarity)]?.[phase] || 0;
}

interface OperatorTrainingTarget {
  id: string;
  name: string;
  rarity: number;
  profession?: string;
  currentElite: number;
  targetElite: number;
  materials: OperatorMaterialsBundle;
}

interface LmdRequirement {
  needed: number;
  have: number;
  stillNeeded: number;
}

interface MaterialCalculation {
  materials: Array<{
    id: string;
    name: string;
    needed: number;
    have: number;
    stillNeeded: number;
  }>;
  lmd: LmdRequirement;
  isComplete: boolean;
}

/**
 * 计算单个干员的材料需求
 */
function calculateOperatorMaterials(operator: OperatorTrainingTarget, depot: Record<string, number> = {}): MaterialCalculation {
  const materials: MaterialCalculation['materials'] = [];
  const totalLMD: LmdRequirement = { needed: 0, have: 0, stillNeeded: 0 };
  const targetElite = operator.targetElite ?? 2;

  // 根据当前精英等级决定需要哪些材料
  const needElite1 = operator.currentElite < 1 && targetElite >= 1;
  const needElite2 = operator.currentElite < 2 && targetElite >= 2;

  // 收集所有需要的材料
  const allMaterials: Record<string, number> = {};

  if (needElite1 && operator.materials.elite1) {
    totalLMD.needed += getEliteLmdCost(operator, 'elite1');
    operator.materials.elite1.materials?.forEach((mat) => {
      allMaterials[mat.id] = (allMaterials[mat.id] || 0) + mat.count;
    });
  }

  if (needElite2 && operator.materials.elite2) {
    totalLMD.needed += getEliteLmdCost(operator, 'elite2');
    operator.materials.elite2.materials?.forEach((mat) => {
      allMaterials[mat.id] = (allMaterials[mat.id] || 0) + mat.count;
    });
    operator.materials.elite2.chips?.forEach((mat) => {
      allMaterials[mat.id] = (allMaterials[mat.id] || 0) + mat.count;
    });
  }

  // 转换为数组并计算库存
  for (const [id, needed] of Object.entries(allMaterials)) {
    const have = depot[id] || 0;
    const stillNeeded = Math.max(0, needed - have);

    // 从材料数据库获取材料名称
    const materialName = getMaterialName(id, operator.materials);

    materials.push({
      id,
      name: materialName,
      needed,
      have,
      stillNeeded
    });
  }

  // 计算龙门币
  totalLMD.have = depot['4001'] || 0;
  totalLMD.stillNeeded = Math.max(0, totalLMD.needed - totalLMD.have);

  return {
    materials,
    lmd: totalLMD,
    isComplete: materials.every((m) => m.stillNeeded === 0) && totalLMD.stillNeeded === 0
  };
}

/**
 * 从材料列表中获取材料名称
 */
function getMaterialName(id: string, operatorMaterials: OperatorMaterialsBundle): string {
  // 尝试从精1材料中查找
  if (operatorMaterials.elite1?.materials) {
    const mat = operatorMaterials.elite1.materials.find((m) => m.id === id);
    if (mat) return mat.name;
  }

  // 尝试从精2材料中查找
  if (operatorMaterials.elite2?.materials) {
    const mat = operatorMaterials.elite2.materials.find((m) => m.id === id);
    if (mat) return mat.name;
  }

  // 尝试从精2芯片中查找
  if (operatorMaterials.elite2?.chips) {
    const mat = operatorMaterials.elite2.chips.find((m) => m.id === id);
    if (mat) return mat.name;
  }

  // 最后使用 MaaResource 的物品名
  const cachedName = materialNameCache.get(String(id));
  if (cachedName !== undefined) return cachedName;

  return `材料_${id}`;
}

interface TrainingOperatorSummary {
  id: string;
  name: string;
  rarity: number;
  profession?: string;
}

interface EnrichedQueueItem extends TrainingQueueItem {
  operator: TrainingOperatorSummary;
  materials: MaterialCalculation['materials'];
  lmd: LmdRequirement;
  isComplete: boolean;
  progress: number;
}

interface TrainingQueueResult {
  queue: EnrichedQueueItem[];
  settings: TrainingSettings;
  lastUpdated: string;
}

/**
 * 获取养成队列
 */
async function getTrainingQueue(): Promise<TrainingQueueResult> {
  const queueData = await loadTrainingQueue();
  const depot = await loadDepot();
  const operatorMaterialsData = await loadOperatorMaterials();
  const operBoxData = await loadOperBox();
  const ownedOperators = new Map(
    getOperBoxOperators(operBoxData).map((operator) => [operator.id, operator])
  );
  let queueChanged = false;

  // 为队列中的每个干员计算材料需求和进度
  const enrichedQueue: EnrichedQueueItem[] = [];

  for (const queueItem of queueData.queue) {
    const opData = operatorMaterialsData.operators[queueItem.operatorId];
    if (!opData) continue;

    const ownedOperator = ownedOperators.get(queueItem.operatorId);
    const queueElite = toFiniteNumber(queueItem.currentElite);
    const currentElite = ownedOperator
      ? Math.max(0, Number(ownedOperator.elite) || 0)
      : Math.max(0, queueElite || 0);
    if (currentElite !== queueItem.currentElite) {
      queueItem.currentElite = currentElite;
      queueChanged = true;
    }

    const operator: OperatorTrainingTarget = {
      id: queueItem.operatorId,
      name: opData.name,
      rarity: opData.rarity,
      profession: opData.profession,
      currentElite,
      targetElite: toFiniteNumber(queueItem.targetElite) ?? 2,
      materials: {
        elite1: opData.elite1,
        elite2: opData.elite2
      }
    };

    const materialCalc = calculateOperatorMaterials(operator, depot.items || {});

    enrichedQueue.push({
      ...queueItem,
      operator: {
        id: operator.id,
        name: operator.name,
        rarity: operator.rarity,
        profession: operator.profession
      },
      materials: materialCalc.materials,
      lmd: materialCalc.lmd,
      isComplete: materialCalc.isComplete,
      progress: calculateProgress(materialCalc)
    });
  }

  if (queueChanged) {
    await saveTrainingQueue(queueData);
  }

  return {
    queue: enrichedQueue,
    settings: queueData.settings,
    lastUpdated: queueData.lastUpdated
  };
}

/**
 * 计算完成进度（百分比）
 */
function calculateProgress(materialCalc: MaterialCalculation): number {
  // 计算总需求和总缺少
  const totalNeeded = materialCalc.materials.reduce((sum, m) => sum + m.needed, 0) +
                      (materialCalc.lmd.needed / 1000); // 龙门币按千计算
  const totalStillNeeded = materialCalc.materials.reduce((sum, m) => sum + m.stillNeeded, 0) +
                           (materialCalc.lmd.stillNeeded / 1000);

  if (totalNeeded === 0) return 100;

  // 进度 = (总需求 - 还需要的) / 总需求 * 100
  const progress = ((totalNeeded - totalStillNeeded) / totalNeeded) * 100;
  return Math.min(100, Math.max(0, Math.round(progress)));
}

interface AddToQueueOptions {
  currentElite?: unknown;
  targetElite?: unknown;
}

/**
 * 添加干员到养成队列
 */
async function addToQueue(operatorId: string, options: AddToQueueOptions = {}): Promise<TrainingQueueItem> {
  const queueData = await loadTrainingQueue();
  const operatorMaterialsData = await loadOperatorMaterials();
  const operBoxData = await loadOperBox();

  const opData = operatorMaterialsData.operators[operatorId];
  if (!opData) {
    throw new Error(`干员材料数据不存在，暂不支持该干员`);
  }

  // 从 OperBox 获取干员名称
  const operBoxOp = operBoxData.data?.find((op) => op.id === operatorId);
  const operatorName = operBoxOp?.name || opData.name;

  // 检查是否已在队列中
  const existingIndex = queueData.queue.findIndex((item) => item.operatorId === operatorId);
  if (existingIndex !== -1) {
    throw new Error(`干员 ${operatorName} 已在养成队列中`);
  }

  // 添加到队列
  const queueItem: TrainingQueueItem = {
    operatorId,
    currentElite: options.currentElite ?? operBoxOp?.elite ?? 0,
    targetElite: options.targetElite ?? 2,
    priority: queueData.queue.length + 1,
    status: 'pending',
    addedAt: new Date().toISOString()
  };

  queueData.queue.push(queueItem);
  await saveTrainingQueue(queueData);

  return queueItem;
}

interface SmartTrainingStage {
  stage: string;
  times: string;
  smart: true;
  trainingOperators: string[];
  [key: string]: unknown;
}

interface AutomationTask {
  commandId?: unknown;
  params?: unknown;
  [key: string]: unknown;
}

interface AutomationConfig {
  taskFlow: AutomationTask[];
  schedule: Record<string, unknown>;
  [key: string]: unknown;
}

function normalizeAutomationConfig(value: unknown): AutomationConfig {
  const record = isRecord(value) ? value : {};
  return {
    ...record,
    taskFlow: Array.isArray(record.taskFlow) ? record.taskFlow.filter(isRecord) : [],
    schedule: isRecord(record.schedule)
      ? record.schedule
      : { enabled: false, times: [] }
  };
}

async function loadAutomationConfig(filePath: string): Promise<AutomationConfig> {
  return normalizeAutomationConfig(await readJsonFile<unknown>(filePath, null));
}

/**
 * 从养成队列中移除干员
 */
async function removeFromQueue(operatorId: string): Promise<boolean> {
  const queueData = await loadTrainingQueue();

  const index = queueData.queue.findIndex((item) => item.operatorId === operatorId);
  if (index === -1) {
    throw new Error('干员不在养成队列中');
  }

  // 获取被删除干员的名称（用于日志）
  const operatorMaterialsData = await loadOperatorMaterials();
  const opData = operatorMaterialsData.operators[operatorId];
  const operatorName = opData?.name || operatorId;

  queueData.queue.splice(index, 1);

  // 重新调整优先级
  queueData.queue.forEach((item, idx) => {
    item.priority = idx + 1;
  });

  await saveTrainingQueue(queueData);

  logger.info('干员已从养成队列移除', { operatorName, remainingCount: queueData.queue.length });

  // 重新生成刷取计划并应用到任务流程
  try {
    if (queueData.queue.length > 0) {
      // 还有其他干员，重新生成计划
      logger.info('重新生成刷取计划', { remainingOperators: queueData.queue.length });
      const plan = await generateTrainingPlan('current');
      await applyPlanToTasks(plan, queueData.settings || {});
      logger.success('刷取计划已更新');
    } else {
      // 队列为空，清除所有智能养成关卡
      logger.info('养成队列已空，清除所有智能养成关卡');
      await clearSmartTrainingStages();
    }
  } catch (error) {
    logger.error('更新刷取计划失败', { error: getErrorMessage(error) });
    // 即使更新失败也不影响删除操作
  }

  return true;
}

/**
 * 清除所有智能养成关卡
 */
async function clearSmartTrainingStages(): Promise<void> {
  const COMBAT_TASKS_PATH = path.join(__dirname, '../data/user-configs/automation-tasks.json');

  try {
    // 读取现有配置
    const config = await loadAutomationConfig(COMBAT_TASKS_PATH);

    // 查找 fight 任务
    const fightTask = config.taskFlow.find((t) => t.commandId === 'fight');

    if (fightTask && isRecord(fightTask.params) && fightTask.params.stages) {
      // 过滤掉所有智能养成关卡
      const existingStages: unknown[] = Array.isArray(fightTask.params.stages) ? fightTask.params.stages : [];
      const nonSmartStages = existingStages.filter((s) => !(isRecord(s) && s.smart));

      logger.info('清除智能关卡', {
        originalCount: existingStages.length,
        remainingCount: nonSmartStages.length
      });

      fightTask.params.stages = nonSmartStages;

      // 保存配置
      await writeJsonFile(COMBAT_TASKS_PATH, config);
      logger.success('智能关卡已清除');
    }
  } catch (error) {
    logger.error('清除智能关卡失败', { error: getErrorMessage(error) });
    throw error;
  }
}

/**
 * 更新队列顺序
 */
async function updateQueueOrder(orderedOperatorIds: unknown[]): Promise<boolean> {
  const queueData = await loadTrainingQueue();

  const newQueue: TrainingQueueItem[] = [];
  orderedOperatorIds.forEach((opId, index) => {
    const item = queueData.queue.find((q) => q.operatorId === opId);
    if (item) {
      item.priority = index + 1;
      newQueue.push(item);
    }
  });

  queueData.queue = newQueue;
  await saveTrainingQueue(queueData);

  return true;
}

/**
 * 更新养成设置
 */
async function updateSettings(settings: unknown): Promise<TrainingSettings> {
  const queueData = await loadTrainingQueue();
  const overrides = isRecord(settings) ? settings : {};
  queueData.settings = normalizeTrainingSettings({ ...queueData.settings, ...overrides });
  await saveTrainingQueue(queueData);
  return queueData.settings;
}

/**
 * 递归展开材料树，找到所有需要刷的原材料
 * @param {string} materialId - 材料ID
 * @param {number} needed - 需要数量
 * @param {object} depot - 仓库数据
 * @param {object} materialsDb - 材料数据库
 * @param {object} formulasDb - 合成配方数据库
 * @param {object} farmableMaterials - 累积的可刷取材料 {materialId: quantity}
 */
function expandMaterialTree(
  materialId: string,
  needed: number,
  depot: DepotData,
  materialsDb: MaterialDatabase,
  formulasDb: Record<string, MaterialRecipe>,
  farmableMaterials: Record<string, number> = {}
): Record<string, number> {
  const material = materialsDb.materials[materialId];
  if (!material) {
    logger.debug('材料不存在', { materialId });
    return farmableMaterials;
  }

  // 检查仓库中的数量
  const have = depot.items?.[materialId] || 0;
  const stillNeeded = Math.max(0, needed - have);

  if (stillNeeded === 0) {
    logger.debug('材料仓库已足够', { materialName: material.name });
    return farmableMaterials;
  }

  logger.debug('展开材料', {
    materialName: material.name,
    needed,
    have,
    stillNeeded
  });

  // 芯片特殊处理：芯片组不展开，直接刷取；双芯片需要展开合成
  const isChipPack = material.name.includes('芯片组'); // 芯片组（如辅助芯片组）

  if (isChipPack) {
    // 芯片组直接刷芯片组关卡（PR-X-2），不展开合成
    logger.debug('芯片组直接刷取', { materialName: material.name });
    farmableMaterials[materialId] = (farmableMaterials[materialId] || 0) + stillNeeded;
    return farmableMaterials;
  }

  // 双芯片需要展开合成配方（通常需要 2×芯片组 + 1×芯片助剂）
  // 这样可以正确扣除仓库中已有的芯片组

  // 检查是否有合成配方（配方直接在根对象下，不是在 formulas 属性下）
  const formula = formulasDb[materialId];

  if (formula && formula.materials && Object.keys(formula.materials).length > 0) {
    // 有合成配方，递归展开子材料
    logger.debug('材料需要合成，展开子材料', { materialName: material.name });

    for (const [subMaterialId, subQuantity] of Object.entries(formula.materials)) {
      const totalSubNeeded = subQuantity * stillNeeded;
      logger.debug('展开子材料', {
        subMaterialId,
        subQuantity,
        totalSubNeeded
      });
      expandMaterialTree(subMaterialId, totalSubNeeded, depot, materialsDb, formulasDb, farmableMaterials);
    }
  } else {
    // 没有合成配方，这是可以直接刷的材料
    logger.debug('可刷取材料', { materialName: material.name });
    farmableMaterials[materialId] = (farmableMaterials[materialId] || 0) + stillNeeded;
  }

  return farmableMaterials;
}

interface TrainingPlanOperator {
  id: string;
  name: string;
  rarity: number;
  profession?: string;
  currentElite: number;
  targetElite: number;
  materials?: MaterialCalculation['materials'];
  [key: string]: unknown;
}

interface MaterialHierarchyNode {
  id: string;
  name: string;
  iconId: string;
  needed: number;
  have: number;
  stillNeeded: number;
  children: MaterialHierarchyNode[];
}

interface TrainingStage {
  stage: string;
  materials: StageMaterialNeed[];
  totalTimes: number;
  sanity: number;
  isOpen: boolean | StageOpenInfo;
  [key: string]: unknown;
}

interface TrainingPlanSummary {
  backlogCount: number;
  openStageCount: number;
  closedStageCount: number;
  todayOpenResourceStages: unknown[];
  todayClosedResourceStages: unknown[];
}

interface TrainingPlan {
  operators: TrainingPlanOperator[];
  materials?: MaterialCalculation['materials'];
  materialHierarchy?: MaterialHierarchyNode[];
  stages: TrainingStage[];
  openStages?: TrainingStage[];
  closedStages?: TrainingStage[];
  focusOperator?: TrainingPlanOperator | null;
  totalSanity: number;
  estimatedTime?: number;
  warnings: string[];
  mode?: string;
  summary?: TrainingPlanSummary;
}

/**
 * 生成养成计划（刷取计划）
 */
async function generateTrainingPlan(mode: string = 'current', clientType?: string): Promise<TrainingPlan> {
  const queueData = await loadTrainingQueue();
  const depot = await loadDepot();
  const resourceCollectionOpen = await isResourceCollectionOpenNow(clientType).catch(() => false);
  const operatorMaterialsData = await loadOperatorMaterials();
  const materialsDb = await loadMaterialsDatabase();

  if (queueData.queue.length === 0) {
    throw new Error('养成队列为空');
  }

  // 收集需要刷取的材料
  const materialNeeds: Record<string, number> = {};
  const operators: TrainingPlanOperator[] = [];

  // 根据模式决定处理哪些干员
  const operatorsToProcess = mode === 'current'
    ? [queueData.queue[0]]
    : queueData.queue;

  for (const queueItem of operatorsToProcess) {
    const opData = operatorMaterialsData.operators[queueItem.operatorId];
    if (!opData) continue;

    const operator: OperatorTrainingTarget = {
      id: queueItem.operatorId,
      name: opData.name,
      rarity: opData.rarity,
      profession: opData.profession,
      currentElite: toFiniteNumber(queueItem.currentElite) ?? 0,
      targetElite: toFiniteNumber(queueItem.targetElite) ?? 2,
      materials: {
        elite1: opData.elite1,
        elite2: opData.elite2
      }
    };

    const materialCalc = calculateOperatorMaterials(operator, depot.items || {});

    // 只添加还需要材料的干员
    if (!materialCalc.isComplete) {
      operators.push({
        id: operator.id,
        name: operator.name,
        rarity: operator.rarity,
        currentElite: operator.currentElite,
        targetElite: operator.targetElite,
        materials: materialCalc.materials.filter((m) => m.stillNeeded > 0)
      });

      // 汇总材料需求
      materialCalc.materials.forEach((mat) => {
        if (mat.stillNeeded > 0) {
          materialNeeds[mat.id] = (materialNeeds[mat.id] || 0) + mat.stillNeeded;
        }
      });
    }
  }

  if (Object.keys(materialNeeds).length === 0) {
    return {
      operators,
      materials: [],
      materialHierarchy: [],
      stages: [],
      totalSanity: 0,
      warnings: ['所有干员的材料已集齐！']
    };
  }

  logger.info('开始展开材料树', { materialCount: Object.keys(materialNeeds).length });
  logger.debug('原始材料需求', { materialNeeds });

  // 加载合成配方数据库
  const formulasDb = await loadMaterialFormulas();

  // 递归展开所有材料，找到需要刷的原材料
  const farmableMaterials: Record<string, number> = {};
  for (const [materialId, needed] of Object.entries(materialNeeds)) {
    expandMaterialTree(materialId, needed, depot, materialsDb, formulasDb, farmableMaterials);
  }

  logger.info('材料树展开完成', { farmableMaterialCount: Object.keys(farmableMaterials).length });
  logger.debug('可刷取材料', { farmableMaterials });

  // 生成刷取计划
  const materialHierarchy: MaterialHierarchyNode[] = [];
  const stagesMap = new Map<string, TrainingStage>();
  let totalSanity = 0;
  const warnings: string[] = [];

  // 为每个可刷取的材料生成关卡
  for (const [materialId, needed] of Object.entries(farmableMaterials)) {
    const material = materialsDb.materials[materialId];
    if (!material) {
      warnings.push(`材料 ${materialId} 在数据库中不存在`);
      continue;
    }

    logger.debug('处理材料', { materialName: material.name, needed });

    materialHierarchy.push({
      id: materialId,
      name: material.name,
      iconId: material.iconId,
      needed,
      have: depot.items?.[materialId] || 0,
      stillNeeded: needed,
      children: []
    });

    // 如果还需要刷取且有最优关卡
    if (needed > 0) {
      let stage: string;

      // 芯片类材料特殊处理：使用 CHIP_STAGE_MAP
      if (CHIP_STAGE_MAP[material.name]) {
        stage = CHIP_STAGE_MAP[material.name];
        logger.debug('使用芯片关卡映射', { materialName: material.name, stage });
      } else if (material.bestStage || material.bestStages) {
        // 非芯片材料：使用数据库中的最优关卡
        const rawStage = material.bestStage || (material.bestStages && material.bestStages[0]?.stage);

        if (!rawStage) {
          warnings.push(`材料 ${material.name} 没有最优关卡信息`);
          logger.warn('材料没有最优关卡', { materialName: material.name });
          continue;
        }

        // 转换关卡代号为 MAA 可识别的格式
        stage = convertStageCode(rawStage);
        logger.debug('转换关卡代号', { materialName: material.name, rawStage, stage });
      } else {
        warnings.push(`材料 ${material.name} 没有最优关卡信息`);
        logger.warn('材料没有最优关卡', { materialName: material.name });
        continue;
      }

      let stageData = stagesMap.get(stage);
      if (!stageData) {
        stageData = {
          stage,
          materials: [],
          totalTimes: 0,
          sanity: 0,
          isOpen: true // 简化版本假设都开放
        };
        stagesMap.set(stage, stageData);
      }

      stageData.materials.push({
        id: materialId,
        name: material.name,
        count: needed
      });

      // 估算需要刷的次数（简化计算）
      const dropRate = 0.5; // 假设50%掉落率
      const timesNeeded = Math.ceil(needed / dropRate);
      stageData.totalTimes += timesNeeded;

      // 估算理智消耗（假设每关卡平均18理智）
      const sanityCost = 18;
      stageData.sanity += timesNeeded * sanityCost;
      totalSanity += timesNeeded * sanityCost;
    }
  }

  const stages: TrainingStage[] = Array.from(stagesMap.values()).map((stageData) => ({
    ...stageData,
    isOpen: isStageOpenToday(stageData.stage, { clientType, resourceCollectionOpen })
  }));
  const todayOpen = getTodayOpenStages({ clientType, resourceCollectionOpen });
  const openStages = stages.filter((stage) => stage.isOpen !== false);
  const closedStages = stages.filter((stage) => stage.isOpen === false);
  const focusOperator = operators[0] || null;

  return {
    operators,
    materialHierarchy,
    stages,
    openStages,
    closedStages,
    focusOperator,
    totalSanity,
    estimatedTime: Math.ceil(totalSanity / 240 * 60), // 假设每天240理智，转换为分钟
    warnings,
    mode,
    summary: {
      backlogCount: Math.max(operators.length - 1, 0),
      openStageCount: openStages.length,
      closedStageCount: closedStages.length,
      todayOpenResourceStages: todayOpen.open,
      todayClosedResourceStages: todayOpen.closed
    }
  };
}

interface ApplyPlanResult {
  success: boolean;
  stageCount: number;
  totalStages: number;
  hasFallback: boolean;
}

/**
 * 应用养成计划到任务流程
 */
async function applyPlanToTasks(plan: TrainingPlan, settings: unknown = {}): Promise<ApplyPlanResult> {
  const queueData = await loadTrainingQueue();
  const effectiveSettings = normalizeTrainingSettings({ ...queueData.settings, ...(isRecord(settings) ? settings : {}) });
  const applicableStages = getApplicableStages(plan);

  logger.info('开始应用养成计划');
  logger.debug('计划详情', {
    stageCount: plan.stages?.length || 0,
    applicableStageCount: applicableStages.length,
    operatorCount: plan.operators?.length || 0
  });

  // 保存到作战任务配置
  const COMBAT_TASKS_PATH = path.join(__dirname, '../data/user-configs/automation-tasks.json');

  try {
    // 读取现有配置
    const config = await loadAutomationConfig(COMBAT_TASKS_PATH);

    logger.debug('成功读取现有配置', { taskCount: config.taskFlow?.length || 0 });

    // 查找或创建 fight 任务
    let fightTask = config.taskFlow.find((t) => t.commandId === 'fight');

    if (!fightTask) {
      fightTask = {
        id: `fight-${Date.now()}`,
        name: '理智作战',
        description: '自动刷关卡消耗理智',
        commandId: 'fight',
        enabled: true,
        params: {
          stage: '1-7',
          stages: [],
          medicine: effectiveSettings.useMedicine || 0,
          expiringMedicine: 0,
          stone: effectiveSettings.useStone || 0,
          series: 0
        }
      };
      config.taskFlow.push(fightTask);
      logger.info('创建了新的 fight 任务');
    }

    // 获取现有的 stages，并分类
    const currentParams = isRecord(fightTask.params) ? fightTask.params : {};
    const existingStages: unknown[] = Array.isArray(currentParams.stages) ? currentParams.stages : [];
    const pinnedStages = existingStages.filter((s) => isRecord(s) && Boolean(s.pinned));
    const normalStages = existingStages.filter((s) => !(isRecord(s) && s.pinned) && !(isRecord(s) && s.smart));

    logger.debug('现有关卡分类', {
      total: existingStages.length,
      pinned: pinnedStages.length,
      normal: normalStages.length
    });

    // 构建新的智能养成关卡
    const smartStages: SmartTrainingStage[] = [];

    // 获取正在养成的干员名称
    let trainingOperatorNames: string[] = [];
    if (plan.operators && plan.operators.length > 0) {
      trainingOperatorNames = plan.operators.map((op) => op.name);
    }

    logger.debug('养成干员', { operators: trainingOperatorNames });

    if (applicableStages.length > 0) {
      applicableStages.forEach((stage) => {
        smartStages.push({
          stage: stage.stage,
          times: String(stage.totalTimes ?? stage.times ?? 0),
          smart: true,
          trainingOperators: trainingOperatorNames
        });
      });
      logger.info('生成智能关卡', { count: smartStages.length });
    }

    // 添加 fallback 关卡（理智用完后刷什么）
    if (effectiveSettings.fallbackStage && effectiveSettings.fallbackStage.trim()) {
      smartStages.push({
        stage: effectiveSettings.fallbackStage.trim(),
        times: (effectiveSettings.fallbackTimes || 999).toString(),
        smart: true,
        trainingOperators: trainingOperatorNames
      });
      logger.debug('添加 fallback 关卡', { stage: effectiveSettings.fallbackStage });
    }

    // 重新组合关卡顺序：置顶 -> 智能 -> 普通
    const newStages: unknown[] = [...pinnedStages, ...smartStages, ...normalStages];

    logger.info('关卡重组完成', {
      totalStages: newStages.length,
      smartStages: smartStages.length
    });

    // 更新任务参数
    fightTask.params = {
      ...currentParams,
      stages: newStages,
      medicine: effectiveSettings.useMedicine || 0,
      expiringMedicine: 0,
      stone: effectiveSettings.useStone || 0,
      series: currentParams.series || 0
    };

    // 保存配置
    await writeJsonFile(COMBAT_TASKS_PATH, config);
    logger.success('养成计划应用成功');

    return {
      success: true,
      stageCount: smartStages.length,
      totalStages: newStages.length,
      hasFallback: !!effectiveSettings.fallbackStage
    };
  } catch (error) {
    logger.error('应用任务流程失败', { error: getErrorMessage(error) });
    throw new Error('应用任务流程失败');
  }
}

interface MaterialFetchResult {
  script: string;
  ok: true;
  stdout: string;
  stderr: string;
}

interface MaterialFetchError {
  script: string;
  message: string;
  stderr: string;
}

export async function fetchOperatorMaterials(): Promise<{ success: true; scripts: MaterialFetchResult[] }> {
  const scriptDir = path.join(__dirname, '..', 'scripts');
  const scripts: string[] = [
    'fetch-all-materials.ts',
    'fetch-material-formulas.ts',
    'merge-formulas.ts',
    'fetch-operator-materials.ts'
  ];
  const results: MaterialFetchResult[] = [];
  const errors: MaterialFetchError[] = [];

  for (const script of scripts) {
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ['--experimental-strip-types', path.join(scriptDir, script)],
        {
          cwd: path.join(__dirname, '..'),
          timeout: 5 * 60 * 1000,
          maxBuffer: 10 * 1024 * 1024
        }
      );
      results.push({ script, ok: true, stdout: String(stdout).trim(), stderr: String(stderr).trim() });
    } catch (error) {
      errors.push({
        script,
        message: getErrorMessage(error) || String(error),
        stderr: String(asErrorWithCode(error).stderr || '').trim()
      });
      logger.warn('材料数据脚本失败，继续执行后续脚本', { script, error: getErrorMessage(error) });
    }
  }

  if (errors.length > 0) {
    throw agentError('AGENT_TRAINING_FETCH_FAILED', '材料数据更新部分失败', {
      statusCode: 500,
      details: { errors, results },
      retryable: true
    });
  }

  return { success: true, scripts: results };
}

export default {
  getOperatorList,
  getTrainingQueue,
  addToQueue,
  removeFromQueue,
  updateQueueOrder,
  updateSettings,
  generateTrainingPlan,
  applyPlanToTasks,
  fetchOperatorMaterials
};
