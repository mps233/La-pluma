/**
 * 养成领域纯模型：只做数据投影与计算，不读取文件、不写队列、不触发流程或定时同步；
 * 文件解析入口在这里声明领域类型，未知值先校验再进入计算。
 */

import type { OperBoxRecognitionInfo, OperatorCatalogEntry } from './operatorCatalogModel.ts';

/** 训练设置：已知字段有默认值，未知扩展字段原样保留。 */
export interface TrainingSettings {
  autoSwitch: boolean;
  notifyOnComplete: boolean;
  useMedicine: number;
  useStone: number;
  fallbackStage?: string;
  fallbackTimes?: number;
  [extension: string]: unknown;
}

export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = {
  autoSwitch: true,
  notifyOnComplete: true,
  useMedicine: 0,
  useStone: 0
};

const KNOWN_SETTING_KEYS = new Set([
  'autoSwitch',
  'notifyOnComplete',
  'useMedicine',
  'useStone',
  'fallbackStage',
  'fallbackTimes',
  'notify'
]);

/** 领域错误：沿用既有 statusCode 约定（400 参数无效、409 计划过期）。 */
export interface TrainingError extends Error {
  statusCode: number;
  code?: string;
  details?: Record<string, unknown>;
}

export interface TrainingErrorOptions {
  code?: string;
  details?: Record<string, unknown>;
}

export function trainingError(
  message: string,
  statusCode = 400,
  options: TrainingErrorOptions = {}
): TrainingError {
  const error: TrainingError = Object.assign(new Error(message), { statusCode });
  if (options.code !== undefined) error.code = options.code;
  if (options.details !== undefined) error.details = options.details;
  return error;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 归一化训练设置：旧字段 `notify` 仅在缺少布尔 `notifyOnComplete` 时映射，
 * 已知字段类型不符回退默认值，未知扩展字段原样保留。
 */
export function normalizeTrainingSettings(settings: unknown = {}): TrainingSettings {
  const source: Record<string, unknown> = isRecord(settings) ? { ...settings } : {};

  if (typeof source.notify === 'boolean' && typeof source.notifyOnComplete !== 'boolean') {
    source.notifyOnComplete = source.notify;
  }
  delete source.notify;

  const normalized: TrainingSettings = {
    autoSwitch: typeof source.autoSwitch === 'boolean'
      ? source.autoSwitch
      : DEFAULT_TRAINING_SETTINGS.autoSwitch,
    notifyOnComplete: typeof source.notifyOnComplete === 'boolean'
      ? source.notifyOnComplete
      : DEFAULT_TRAINING_SETTINGS.notifyOnComplete,
    useMedicine: toFiniteNumber(source.useMedicine) ?? DEFAULT_TRAINING_SETTINGS.useMedicine,
    useStone: toFiniteNumber(source.useStone) ?? DEFAULT_TRAINING_SETTINGS.useStone
  };

  if (typeof source.fallbackStage === 'string') normalized.fallbackStage = source.fallbackStage;
  const fallbackTimes = toFiniteNumber(source.fallbackTimes);
  if (fallbackTimes !== undefined) normalized.fallbackTimes = fallbackTimes;

  for (const [key, value] of Object.entries(source)) {
    if (!KNOWN_SETTING_KEYS.has(key)) normalized[key] = value;
  }

  return normalized;
}

export interface TrainingMaterialRequirement {
  id: string;
  name: string;
  count: number;
}

/** 精英化阶段的材料需求；`chips` 只出现在精二。 */
export interface TrainingElitePlan {
  lmd?: number;
  materials?: TrainingMaterialRequirement[];
  chips?: TrainingMaterialRequirement[];
}

export interface OperatorMaterialData {
  id?: string;
  name: string;
  rarity?: number;
  profession?: string;
  elite1?: TrainingElitePlan;
  elite2?: TrainingElitePlan;
}

export interface OperatorMaterialsFile {
  operators: Record<string, OperatorMaterialData>;
  metadata?: Record<string, unknown>;
}

export interface OwnedOperator {
  id: string;
  name?: string;
  rarity?: number;
  profession?: string;
  elite?: number;
  level?: number;
  potential?: number;
  own?: boolean;
}

/**
 * 持有干员快照：`data`/`operators` 是已识别拥有的干员，`allOpers` 是识别目录
 * （含拥有标记与多语言名称），`recognition` 是写入时的识别完整度；缺目录或缺
 * 完整信号时只能确认已识别拥有的干员。
 */
export interface OperBoxData {
  data?: OwnedOperator[];
  operators?: OwnedOperator[];
  allOpers?: OperatorCatalogEntry[];
  operTotal?: number;
  recognition?: OperBoxRecognitionInfo;
  timestamp?: string;
}

export interface DepotSnapshot {
  items: Record<string, number>;
  timestamp?: string | null;
}

export interface TrainingMaterialDefinition {
  id?: string;
  name: string;
  rarity?: number;
  iconId?: string;
  bestStage?: string;
  bestStages?: { stage: string }[];
}

/** materials.json 的结构；recipes 与 stageSchedule 仅供计数。 */
export interface TrainingMaterialsDatabase {
  materials: Record<string, TrainingMaterialDefinition>;
  recipes?: Record<string, unknown>;
  stageSchedule?: Record<string, unknown>;
}

export interface MaterialFormula {
  materials?: Record<string, number>;
}

export type MaterialFormulas = Record<string, MaterialFormula>;

export type TrainingDisabledReason = 'unowned' | 'unrecognized' | 'missing_material_data' | 'already_elite2';

/** 干员的拥有状态：未确认与已确认未拥有不能混用。 */
export type TrainingCandidateOwnership = 'owned' | 'unowned' | 'unknown';

/** 候选列表过滤状态，与 `/training/operators` 的 status 参数一致。 */
export type TrainingCandidateStatus = 'trainable' | 'owned' | 'all';

export interface TrainingBaseOperator {
  id: string;
  name: string;
  rarity: number;
  profession?: string;
  position?: string;
}

export interface TrainingOperatorFilters {
  rarity?: number;
  profession?: string;
  owned?: boolean;
  needsElite2?: boolean;
  status?: TrainingCandidateStatus;
}

export interface TrainingOperatorMaterials {
  elite1?: TrainingElitePlan;
  elite2?: TrainingElitePlan;
}

export interface TrainingCandidate {
  id: string;
  name: string;
  rarity: number;
  profession: string;
  position?: string;
  currentElite: number;
  currentLevel: number;
  targetElite: number;
  owned: boolean;
  ownership: TrainingCandidateOwnership;
  potential: number;
  hasMaterialData: boolean;
  materials: TrainingOperatorMaterials | null;
  canTrain: boolean;
  disabledReason: TrainingDisabledReason | null;
  trainingStatus: 'trainable' | TrainingDisabledReason;
}

interface CandidateState {
  id: string;
  name: string;
  rarity: number;
  profession: string;
  position?: string;
  currentElite: number;
  currentLevel: number;
  targetElite: number;
  owned: boolean;
  ownership: TrainingCandidateOwnership;
  potential: number;
  hasMaterialData: boolean;
  materials: TrainingOperatorMaterials | null;
}

interface DisabledReasonInput {
  owned: boolean;
  unrecognized: boolean;
  hasMaterialData: boolean;
  currentElite: number;
  targetElite: number;
}

/** 计划模式：只刷当前首位干员或全部队列干员。 */
export type TrainingFlowMode = 'current' | 'all';

export interface ApplicableStage {
  stage: string;
  totalTimes: number;
}

/**
 * 从计划中挑选可执行的关卡：openStages 存在（包括空数组）即权威，否则取标记开放的 stages。
 * 关卡代号与非正数次数在解析时被丢弃。
 */
export function getApplicableStages(plan: unknown = {}): ApplicableStage[] {
  const record = isRecord(plan) ? plan : {};
  const candidateStages = Array.isArray(record.openStages)
    ? record.openStages
    : Array.isArray(record.stages)
      ? record.stages.filter(stage => !isRecord(stage) || stage.isOpen !== false)
      : [];

  const applicable: ApplicableStage[] = [];
  for (const candidate of candidateStages) {
    const parsed = toApplicableStage(candidate);
    if (parsed) applicable.push(parsed);
  }
  return applicable;
}

function toApplicableStage(value: unknown): ApplicableStage | null {
  if (!isRecord(value) || typeof value.stage !== 'string' || value.stage.length === 0) return null;
  const rawCount = value.totalTimes ?? value.times ?? 0;
  const totalTimes = typeof rawCount === 'number'
    ? rawCount
    : typeof rawCount === 'string' && rawCount.trim() !== ''
      ? Number(rawCount)
      : Number.NaN;
  if (!(totalTimes > 0)) return null;
  return { stage: value.stage, totalTimes };
}

export function getTrainingDisabledReason(operator: DisabledReasonInput): TrainingDisabledReason | null {
  if (operator.unrecognized) return 'unrecognized';
  if (!operator.owned) return 'unowned';
  if (!operator.hasMaterialData) return 'missing_material_data';
  if (operator.currentElite >= operator.targetElite) return 'already_elite2';
  return null;
}

/** OperBox 旧结构兼容：`data` 与 `operators` 都表示已识别干员数组。 */
export function getOperBoxOperators(operBoxData: OperBoxData | null | undefined): OwnedOperator[] {
  if (Array.isArray(operBoxData?.data)) return operBoxData.data;
  if (Array.isArray(operBoxData?.operators)) return operBoxData.operators;
  return [];
}

/**
 * 候选干员投影与计数：全量干员为基底，OperBox 与材料数据补充状态后筛选排序；
 * `unknownOwnership` 是识别未能确认拥有状态的干员，这些条目在列表里按未识别处理，
 * 不能与确认未拥有混同。纯函数，不读取目录/OperBox/材料文件。
 */
export function buildTrainingCandidates(
  baseOperators: TrainingBaseOperator[],
  ownedOperators: OwnedOperator[],
  operatorMaterialsData: OperatorMaterialsFile,
  filters: TrainingOperatorFilters = {},
  unknownOwnership: ReadonlySet<string> = new Set<string>()
): TrainingCandidate[] {
  const ownedMap = new Map(ownedOperators.map(operator => [operator.id, operator]));

  const operators: TrainingCandidate[] = baseOperators.map(baseOperator => {
    const ownedOperator = ownedMap.get(baseOperator.id);
    const ownership: TrainingCandidateOwnership = ownedOperator
      ? 'owned'
      : unknownOwnership.has(baseOperator.id)
        ? 'unknown'
        : 'unowned';
    const opData = operatorMaterialsData.operators[baseOperator.id];
    const operator: CandidateState = {
      id: baseOperator.id,
      name: ownedOperator?.name || baseOperator.name,
      rarity: ownedOperator?.rarity ?? baseOperator.rarity,
      profession: opData?.profession || baseOperator.profession || ownedOperator?.profession || '未知',
      position: baseOperator.position,
      currentElite: ownedOperator ? (ownedOperator.elite || 0) : 0,
      currentLevel: ownedOperator ? (ownedOperator.level || 1) : 0,
      targetElite: 2,
      owned: ownership === 'owned',
      ownership,
      potential: ownedOperator ? (ownedOperator.potential || 1) : 0,
      hasMaterialData: Boolean(opData),
      materials: opData ? {
        elite1: opData.elite1,
        elite2: opData.elite2
      } : null
    };

    const disabledReason = getTrainingDisabledReason({
      ...operator,
      unrecognized: ownership === 'unknown'
    });
    return {
      ...operator,
      canTrain: disabledReason === null,
      disabledReason,
      trainingStatus: disabledReason === null
        ? 'trainable'
        : disabledReason
    };
  });

  const filteredOperators = operators.filter(operator => {
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

  filteredOperators.sort((a, b) => {
    if (a.canTrain !== b.canTrain) return a.canTrain ? -1 : 1;
    if (a.owned !== b.owned) return a.owned ? -1 : 1;
    if (a.rarity !== b.rarity) return b.rarity - a.rarity;
    if (a.currentElite !== b.currentElite) return a.currentElite - b.currentElite;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return filteredOperators;
}

export interface TrainingMaterialNeed {
  id: string;
  name: string;
  needed: number;
  have: number;
  stillNeeded: number;
}

export interface LmdRequirement {
  needed: number;
  have: number;
  stillNeeded: number;
}

export interface MaterialCalculation {
  materials: TrainingMaterialNeed[];
  lmd: LmdRequirement;
  isComplete: boolean;
}

export interface TrainingOperatorRequirements {
  id: string;
  name?: string;
  rarity?: number;
  profession?: string;
  currentElite: number;
  targetElite: number;
  materials: TrainingOperatorMaterials;
}

export function calculateOperatorMaterials(
  operator: TrainingOperatorRequirements,
  depot: Record<string, number> = {}
): MaterialCalculation {
  const materials: TrainingMaterialNeed[] = [];
  const totalLMD: LmdRequirement = { needed: 0, have: 0, stillNeeded: 0 };
  const targetElite = operator.targetElite ?? 2;

  const needElite1 = operator.currentElite < 1 && targetElite >= 1;
  const needElite2 = operator.currentElite < 2 && targetElite >= 2;

  const allMaterials: Record<string, number> = {};
  const elite1 = operator.materials.elite1;
  const elite2 = operator.materials.elite2;

  if (needElite1 && elite1) {
    totalLMD.needed += elite1.lmd || 0;
    elite1.materials?.forEach(mat => {
      allMaterials[mat.id] = (allMaterials[mat.id] || 0) + mat.count;
    });
  }

  if (needElite2 && elite2) {
    totalLMD.needed += elite2.lmd || 0;
    elite2.materials?.forEach(mat => {
      allMaterials[mat.id] = (allMaterials[mat.id] || 0) + mat.count;
    });
    elite2.chips?.forEach(mat => {
      allMaterials[mat.id] = (allMaterials[mat.id] || 0) + mat.count;
    });
  }

  for (const [id, needed] of Object.entries(allMaterials)) {
    const have = depot[id] || 0;
    const stillNeeded = Math.max(0, needed - have);

    const materialName = getMaterialName(id, operator.materials);

    materials.push({
      id,
      name: materialName,
      needed,
      have,
      stillNeeded
    });
  }

  totalLMD.have = depot['4001'] || 0;
  totalLMD.stillNeeded = Math.max(0, totalLMD.needed - totalLMD.have);

  return {
    materials,
    lmd: totalLMD,
    isComplete: materials.every(m => m.stillNeeded === 0) && totalLMD.stillNeeded === 0
  };
}

export function getMaterialName(id: string, operatorMaterials: TrainingOperatorMaterials): string {
  if (operatorMaterials.elite1?.materials) {
    const mat = operatorMaterials.elite1.materials.find(m => m.id === id);
    if (mat) return mat.name;
  }

  if (operatorMaterials.elite2?.materials) {
    const mat = operatorMaterials.elite2.materials.find(m => m.id === id);
    if (mat) return mat.name;
  }

  if (operatorMaterials.elite2?.chips) {
    const mat = operatorMaterials.elite2.chips.find(m => m.id === id);
    if (mat) return mat.name;
  }

  return `材料_${id}`;
}

export function calculateProgress(materialCalc: MaterialCalculation): number {
  const totalNeeded = materialCalc.materials.reduce((sum, m) => sum + m.needed, 0) +
                      (materialCalc.lmd.needed / 1000); // 龙门币按千计算
  const totalStillNeeded = materialCalc.materials.reduce((sum, m) => sum + m.stillNeeded, 0) +
                           (materialCalc.lmd.stillNeeded / 1000);

  if (totalNeeded === 0) return 100;

  const progress = ((totalNeeded - totalStillNeeded) / totalNeeded) * 100;
  return Math.min(100, Math.max(0, Math.round(progress)));
}
