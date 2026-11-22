/**
 * 养成计算与刷取计划：材料配方展开、掉落估算、关卡代号转换与计划生成；只读数据，
 * 不写队列、不改自动化任务或定时任务。关卡开放按客户端服务区游戏日判定，clientType 缺省时读取连接 profile。
 */

import { createLogger } from '../utils/logger.ts';
import { getTodayOpenStages, isStageOpenToday } from './notificationService.ts';
import type { DailyOpenStage } from './notificationService.ts';
import { isResourceCollectionOpen } from './maaActivityService.ts';
import type { CachedResourceCollectionWindow, ResourceCollectionWindow } from './maaActivityService.ts';
import { getGameDay, resolveGameZone } from './gameCalendar.ts';
import { resolveConnection } from './connectionService.ts';
import { findBestFarmStage, getStageEstimate, loadPenguinDropData } from './dropDataService.ts';
import type { PenguinDropData, PenguinDropMetadata, StageDropEstimate } from './dropDataService.ts';
import {
  calculateOperatorMaterials,
  getApplicableStages,
  isRecord,
  trainingError
} from './operatorTrainingModel.ts';
import type {
  DepotSnapshot,
  MaterialFormulas,
  TrainingFlowMode,
  TrainingMaterialDefinition,
  TrainingMaterialNeed,
  TrainingMaterialsDatabase,
  TrainingOperatorRequirements
} from './operatorTrainingModel.ts';
import {
  getQueueRevision,
  loadDepot,
  loadMaterialFormulas,
  loadMaterialsDatabase,
  loadOperatorMaterials,
  loadTrainingQueue
} from './operatorTrainingStore.ts';

const logger = createLogger('OperatorTraining');

// 经验估算兜底值：企鹅掉落数据不可用时沿用旧假设（掉率 50%、每关 18 理智）
const FALLBACK_DROP_RATE = 0.5;
const FALLBACK_SANITY_COST = 18;

export type FarmEstimateSource = 'penguin-stats' | 'experience';

export interface FarmEstimate {
  stage: string;
  stageId: string | null;
  apCost: number;
  expectedPerRun: number;
  samples: number | null;
  dataSource: FarmEstimateSource;
  fallbackReason: string | null;
}

export interface TrainingPlanStageMaterial {
  id: string;
  name: string;
  count: number;
}

export interface TrainingPlanStage {
  stage: string;
  stageId: string | null;
  apCost: number;
  sanityPerRun: number;
  dataSource: FarmEstimateSource;
  materials: TrainingPlanStageMaterial[];
  totalTimes: number;
  sanity: number;
  isOpen: boolean;
}

export interface TrainingMaterialHierarchyEntry {
  id: string;
  name: string;
  iconId?: string;
  needed: number;
  have: number;
  stillNeeded: number;
  children: [];
}

export interface TrainingPlanOperator {
  id: string;
  name: string;
  rarity?: number;
  currentElite: number;
  targetElite: number;
  materials: TrainingMaterialNeed[];
}

export interface TrainingPlanSummary {
  backlogCount: number;
  openStageCount: number;
  closedStageCount: number;
  /** 计划判定所用的游戏日与客户端类型，与关卡开放结论同源。 */
  gameDate: string;
  clientType: string;
  todayOpenResourceStages: DailyOpenStage[];
  todayClosedResourceStages: DailyOpenStage[];
}

/**
 * 刷取计划。材料已集齐的早退结果额外带 `materials: []`，
 * 其余可选字段只在完整计划里出现（与既有响应保持一致）。
 */
export interface TrainingPlan {
  queueRevision: string;
  mode: TrainingFlowMode;
  operators: TrainingPlanOperator[];
  materials?: [];
  materialHierarchy: TrainingMaterialHierarchyEntry[];
  stages: TrainingPlanStage[];
  openStages?: TrainingPlanStage[];
  closedStages?: TrainingPlanStage[];
  focusOperator?: TrainingPlanOperator | null;
  totalSanity: number;
  estimatedTime?: number;
  warnings: string[];
  dropDataInfo?: PenguinDropMetadata | null;
  summary?: TrainingPlanSummary;
}

const STAGE_CODE_MAP: Record<string, string> = {
  'pro_a_1': 'PR-A-1',
  'pro_a_2': 'PR-A-2',
  'pro_b_1': 'PR-B-1',
  'pro_b_2': 'PR-B-2',
  'pro_c_1': 'PR-C-1',
  'pro_c_2': 'PR-C-2',
  'pro_d_1': 'PR-D-1',
  'pro_d_2': 'PR-D-2',

  'ca_1': 'CA-1',
  'ca_2': 'CA-2',
  'ca_3': 'CA-3',
  'ca_4': 'CA-4',
  'ca_5': 'CA-5',

  'ce_1': 'CE-1',
  'ce_2': 'CE-2',
  'ce_3': 'CE-3',
  'ce_4': 'CE-4',
  'ce_5': 'CE-5',
  'ce_6': 'CE-6',

  'ls_1': 'LS-1',
  'ls_2': 'LS-2',
  'ls_3': 'LS-3',
  'ls_4': 'LS-4',
  'ls_5': 'LS-5',
  'ls_6': 'LS-6',

  'ap_1': 'AP-1',
  'ap_2': 'AP-2',
  'ap_3': 'AP-3',
  'ap_4': 'AP-4',
  'ap_5': 'AP-5',

  'sk_1': 'SK-1',
  'sk_2': 'SK-2',
  'sk_3': 'SK-3',
  'sk_4': 'SK-4',
  'sk_5': 'SK-5',
};

const CHIP_STAGE_MAP: Record<string, string> = {
  '医疗芯片': 'PR-A-1',
  '医疗芯片组': 'PR-A-2',
  '医疗双芯片': 'PR-A-2',
  '重装芯片': 'PR-A-1',
  '重装芯片组': 'PR-A-2',
  '重装双芯片': 'PR-A-2',

  '术师芯片': 'PR-B-1',
  '术师芯片组': 'PR-B-2',
  '术师双芯片': 'PR-B-2',
  '狙击芯片': 'PR-B-1',
  '狙击芯片组': 'PR-B-2',
  '狙击双芯片': 'PR-B-2',

  '先锋芯片': 'PR-C-1',
  '先锋芯片组': 'PR-C-2',
  '先锋双芯片': 'PR-C-2',
  '辅助芯片': 'PR-C-1',
  '辅助芯片组': 'PR-C-2',
  '辅助双芯片': 'PR-C-2',

  '近卫芯片': 'PR-D-1',
  '近卫芯片组': 'PR-D-2',
  '近卫双芯片': 'PR-D-2',
  '特种芯片': 'PR-D-1',
  '特种芯片组': 'PR-D-2',
  '特种双芯片': 'PR-D-2',
};

function convertStageCode(stageCode: string): string {
  if (!stageCode) return stageCode;

  if (stageCode.match(/^[A-Z]{2,3}-[A-Z0-9]-\d+$/)) {
    return stageCode;
  }

  const lowerCode = stageCode.toLowerCase();

  if (STAGE_CODE_MAP[lowerCode]) {
    return STAGE_CODE_MAP[lowerCode];
  }

  const match = lowerCode.match(/^([a-z]+)_([a-z])_(\d+)$/);
  if (match) {
    const [, prefix, letter, number] = match;
    return `${prefix.toUpperCase()}-${letter.toUpperCase()}-${number}`;
  }

  const match2 = lowerCode.match(/^([a-z]+)_(\d+)$/);
  if (match2) {
    const [, prefix, number] = match2;
    return `${prefix.toUpperCase()}-${number}`;
  }

  logger.warn('无法转换关卡代号', { stageCode });
  return stageCode;
}

interface MaterialBranchResult {
  blocked: boolean;
  blockedMaterialName: string | null;
  farmable: Record<string, number>;
}

/**
 * 展开单个材料支路；`blocked` 表示配方展开被循环引用阻断（farmable 为空），
 * 由上层放弃整条配方转换链并回退为根材料本身直接刷取。
 */
function expandMaterialBranch(
  materialId: string,
  needed: number,
  depot: DepotSnapshot,
  materialsDb: TrainingMaterialsDatabase,
  formulasDb: MaterialFormulas,
  visiting: Set<string>
): MaterialBranchResult {
  const material = materialsDb.materials[materialId];
  if (!material) {
    logger.debug('材料不存在', { materialId });
    return { blocked: false, blockedMaterialName: null, farmable: {} };
  }

  const have = depot.items[materialId] || 0;
  const stillNeeded = Math.max(0, needed - have);

  if (stillNeeded === 0) {
    logger.debug('材料仓库已足够', { materialName: material.name });
    return { blocked: false, blockedMaterialName: null, farmable: {} };
  }

  // 环命中：不做任何产出，向上层报告阻断位置，由展开根回退为直接刷取
  if (visiting.has(materialId)) {
    logger.debug('材料配方存在循环引用，阻断该支路', { materialName: material.name });
    return { blocked: true, blockedMaterialName: material.name, farmable: {} };
  }

  // 芯片特殊处理：芯片组不展开，直接刷取；双芯片需要展开合成
  if (material.name.includes('芯片组')) {
    logger.debug('芯片组直接刷取', { materialName: material.name });
    return { blocked: false, blockedMaterialName: null, farmable: { [materialId]: stillNeeded } };
  }

  // 双芯片需要展开合成配方（通常需要 2×芯片组 + 1×芯片助剂）
  // 这样可以正确扣除仓库中已有的芯片组

  // 检查是否有合成配方（配方直接在根对象下，不是在 formulas 属性下）
  const formula = formulasDb[materialId];

  if (formula && formula.materials && Object.keys(formula.materials).length > 0) {
    logger.debug('材料需要合成，展开子材料', { materialName: material.name });

    const branchVisiting = new Set(visiting).add(materialId);
    const branchFarmable: Record<string, number> = {};
    let blockedMaterialName: string | null = null;

    for (const [subMaterialId, subQuantity] of Object.entries(formula.materials)) {
      const totalSubNeeded = subQuantity * stillNeeded;
      logger.debug('展开子材料', {
        subMaterialId,
        subQuantity,
        totalSubNeeded
      });
      const subResult = expandMaterialBranch(
        subMaterialId,
        totalSubNeeded,
        depot,
        materialsDb,
        formulasDb,
        branchVisiting
      );

      if (subResult.blocked) {
        // 子支路被环阻断：放弃本材料的整条配方转换链，已收集的正常子材料一并作废——
        // 它们的产出只为合成根材料，改为直接刷取后不再需要；继续向上层报告，最终由展开根回退
        blockedMaterialName = subResult.blockedMaterialName;
        break;
      }

      for (const [id, count] of Object.entries(subResult.farmable)) {
        branchFarmable[id] = (branchFarmable[id] || 0) + count;
      }
    }

    if (blockedMaterialName) {
      return { blocked: true, blockedMaterialName, farmable: {} };
    }

    return { blocked: false, blockedMaterialName: null, farmable: branchFarmable };
  }

  logger.debug('可刷取材料', { materialName: material.name });
  return { blocked: false, blockedMaterialName: null, farmable: { [materialId]: stillNeeded } };
}

/**
 * 递归展开材料树。配方循环引用（如芯片互转）会作废整条被阻断的转换链，回退为
 * 展开根材料本身直接刷取，由关卡映射（如 CHIP_STAGE_MAP）决定关卡；
 * 仓库已覆盖的正常空结果不受影响。
 */
export function expandMaterialTree(
  materialId: string,
  needed: number,
  depot: DepotSnapshot,
  materialsDb: TrainingMaterialsDatabase,
  formulasDb: MaterialFormulas,
  farmableMaterials: Record<string, number> = {}
): Record<string, number> {
  const result = expandMaterialBranch(materialId, needed, depot, materialsDb, formulasDb, new Set());

  if (result.blocked) {
    // 配方展开遇环，回退为该材料本身直接刷取，避免整条支路被静默丢弃
    logger.warn('材料配方展开遇环，回退为直接刷取', {
      materialName: materialsDb.materials[materialId]?.name || materialId,
      cycleMaterialName: result.blockedMaterialName
    });
    const stillNeeded = Math.max(0, needed - (depot.items[materialId] || 0));
    if (stillNeeded > 0) {
      farmableMaterials[materialId] = (farmableMaterials[materialId] || 0) + stillNeeded;
    }
    return farmableMaterials;
  }

  for (const [id, count] of Object.entries(result.farmable)) {
    farmableMaterials[id] = (farmableMaterials[id] || 0) + count;
  }

  return farmableMaterials;
}

function toEstimate(found: StageDropEstimate): FarmEstimate {
  return {
    stage: found.code,
    stageId: found.stageId,
    apCost: found.apCost,
    expectedPerRun: found.expectedPerRun,
    samples: found.samples,
    dataSource: 'penguin-stats',
    fallbackReason: null
  };
}

/**
 * 为单个材料选择刷取关卡并给出期望掉落与理智单价。数据来自企鹅物流掉落统计，
 * 抓取为 apps/server/data/penguin-drop-data.json：芯片类刷固定关卡，其余按
 * 「期望理智消耗/个」（apCost / 期望掉落）反查最优永久关卡；数据缺失、无样本或
 * 无候选关卡时回退经验估算（50% 掉率、18 理智/关），保证计划不中断。
 * 返回 null 表示无任何可用关卡，调用方应 warn 并跳过该材料。
 */
export function estimateMaterialFarming(
  material: TrainingMaterialDefinition,
  dropData: PenguinDropData | null
): FarmEstimate | null {
  const isChip = Boolean(CHIP_STAGE_MAP[material.name]);

  if (isChip) {
    const stageCode = CHIP_STAGE_MAP[material.name];
    const found = getStageEstimate(stageCode, material.id ?? '', dropData);
    if (found) {
      return toEstimate(found);
    }
    return {
      stage: stageCode,
      stageId: null,
      apCost: FALLBACK_SANITY_COST,
      expectedPerRun: FALLBACK_DROP_RATE,
      samples: null,
      dataSource: 'experience',
      fallbackReason: dropData ? '掉落数据中无该关卡统计' : '掉落数据未加载'
    };
  }

  const found = findBestFarmStage(material.id ?? '', dropData);
  if (found) {
    return toEstimate(found);
  }

  // 回退：材料库的最优关卡（来自游戏数据 stageDropList，可能指向已过期活动关）
  const rawStage = material.bestStage || (material.bestStages && material.bestStages[0]?.stage);
  if (!rawStage) return null;

  return {
    stage: convertStageCode(rawStage),
    stageId: rawStage,
    apCost: FALLBACK_SANITY_COST,
    expectedPerRun: FALLBACK_DROP_RATE,
    samples: null,
    dataSource: 'experience',
    fallbackReason: dropData ? '掉落数据中无该材料的可刷关卡' : '掉落数据未加载'
  };
}

interface StagePlan {
  stage: string;
  stageId: string | null;
  apCost: number;
  dataSource: FarmEstimateSource;
  materials: TrainingPlanStageMaterial[];
  // 该关卡需要产出的期望掉落总数（各材料 stillNeeded / 期望掉落 之和），最终向上取整为刷取次数
  expectedDrops: number;
  isOpen: boolean;
}

/** 计划生成的查询选项：客户端类型决定关卡开放所依据的游戏日。 */
export interface TrainingPlanOptions {
  clientType?: string;
  /** 资源收集全开放活动；缺省按客户端服务区的活动窗口解析。 */
  allResourceStagesOpen?: boolean;
}

/** 读取连接 profile 的客户端类型；读取失败按连接默认客户端继续，不阻断计划生成。 */
async function resolveDefaultClientType(): Promise<string | undefined> {
  try {
    return (await resolveConnection()).clientType;
  } catch (error) {
    logger.warn('读取连接配置失败，养成计划按默认客户端时区生成', {
      error: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

/**
 * 生成养成计划。关卡开放按客户端服务区的游戏日判定；`clientType` 缺省时读取连接 profile，
 * 资源收集全开放期间所有资源本按开放处理。
 */
export async function generateTrainingPlan(
  mode: string = 'current',
  options: TrainingPlanOptions = {}
): Promise<TrainingPlan> {
  if (mode !== 'current' && mode !== 'all') throw trainingError('计划模式必须为 current 或 all');
  const now = new Date();
  const planMode: TrainingFlowMode = mode;
  const queueData = await loadTrainingQueue();
  const depot = await loadDepot();
  const operatorMaterialsData = await loadOperatorMaterials();
  const materialsDb = await loadMaterialsDatabase();

  if (queueData.queue.length === 0) {
    throw new Error('养成队列为空');
  }

  const materialNeeds: Record<string, number> = {};
  const operators: TrainingPlanOperator[] = [];
  let totalLmdNeeded = 0;

  const operatorsToProcess = planMode === 'current'
    ? [queueData.queue[0]]
    : queueData.queue;

  for (const queueItem of operatorsToProcess) {
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
    totalLmdNeeded += materialCalc.lmd.needed;

    if (!materialCalc.isComplete) {
      operators.push({
        id: operator.id,
        name: opData.name,
        rarity: operator.rarity,
        currentElite: operator.currentElite,
        targetElite: operator.targetElite,
        materials: materialCalc.materials.filter(m => m.stillNeeded > 0)
      });

      materialCalc.materials.forEach(mat => {
        if (mat.stillNeeded > 0) {
          materialNeeds[mat.id] = (materialNeeds[mat.id] || 0) + mat.stillNeeded;
        }
      });
    }
  }

  const missingLmd = Math.max(0, totalLmdNeeded - (depot.items['4001'] || 0));
  const warnings: string[] = missingLmd > 0
    ? [`尚缺 ${missingLmd} 龙门币；当前计划不包含龙门币刷取估算，请另行安排。`]
    : [];

  if (Object.keys(materialNeeds).length === 0) {
    return {
      queueRevision: getQueueRevision(queueData),
      mode: planMode,
      operators,
      materials: [],
      materialHierarchy: [],
      stages: [],
      totalSanity: 0,
      warnings: warnings.length > 0 ? warnings : ['所有干员的材料已集齐！']
    };
  }

  logger.info('开始展开材料树', { materialCount: Object.keys(materialNeeds).length });
  logger.debug('原始材料需求', { materialNeeds });

  const formulasDb = await loadMaterialFormulas();

  const farmableMaterials: Record<string, number> = {};
  for (const [materialId, needed] of Object.entries(materialNeeds)) {
    expandMaterialTree(materialId, needed, depot, materialsDb, formulasDb, farmableMaterials);
  }

  logger.info('材料树展开完成', { farmableMaterialCount: Object.keys(farmableMaterials).length });
  logger.debug('可刷取材料', { farmableMaterials });

  // 企鹅物流真实掉落数据：缺失时 estimateMaterialFarming 会自动回退经验估算
  const dropData = await loadPenguinDropData();
  if (dropData?.metadata) {
    logger.info('掉落数据已加载', {
      server: dropData.metadata.server,
      fetchedAt: dropData.metadata.fetchedAt
    });
  }

  const materialHierarchy: TrainingMaterialHierarchyEntry[] = [];
  const stagesMap = new Map<string, StagePlan>();
  const fallbackMaterials: string[] = [];

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
      have: depot.items[materialId] || 0,
      stillNeeded: needed,
      children: []
    });

    if (needed > 0) {
      const estimate = estimateMaterialFarming(material, dropData);
      if (!estimate) {
        warnings.push(`材料 ${material.name} 没有最优关卡信息`);
        logger.warn('材料没有最优关卡', { materialName: material.name });
        continue;
      }

      if (estimate.fallbackReason) {
        fallbackMaterials.push(material.name);
        logger.warn('材料回退经验估算', { materialName: material.name, reason: estimate.fallbackReason });
      }

      if (!stagesMap.has(estimate.stage)) {
        stagesMap.set(estimate.stage, {
          stage: estimate.stage,
          stageId: estimate.stageId,
          apCost: estimate.apCost,
          dataSource: estimate.dataSource,
          materials: [],
          expectedDrops: 0,
          isOpen: true
        });
      }

      const stageData = stagesMap.get(estimate.stage) as StagePlan;
      stageData.materials.push({
        id: materialId,
        name: material.name,
        count: needed
      });
      stageData.expectedDrops += needed / estimate.expectedPerRun;
    }
  }

  if (fallbackMaterials.length > 0) {
    warnings.push(
      `企鹅物流掉落数据不可用，${fallbackMaterials.length} 种材料按经验估算（掉率 ${FALLBACK_DROP_RATE * 100}%、每关 ${FALLBACK_SANITY_COST} 理智）：${fallbackMaterials.join('、')}`
    );
  }

  // 关卡开放按连接 profile 的服务区游戏日判定；未显式指定客户端类型时补解析，
  // 避免内部同步入口（队列变更、POST /training/sync）退回连接默认时区。
  const clientType = options.clientType ?? await resolveDefaultClientType();
  const allResourceStagesOpen = options.allResourceStagesOpen
    ?? await isResourceCollectionOpen(clientType);

  // 刷取次数 = 该关累计期望掉落向上取整；理智 = 次数 × 关卡真实理智消耗（企鹅物流 apCost）
  const stages: TrainingPlanStage[] = Array.from(stagesMap.values()).map(stageData => {
    const totalTimes = Math.ceil(stageData.expectedDrops);
    return {
      stage: stageData.stage,
      stageId: stageData.stageId,
      apCost: stageData.apCost,
      sanityPerRun: stageData.apCost,
      dataSource: stageData.dataSource,
      materials: stageData.materials,
      totalTimes,
      sanity: totalTimes * stageData.apCost,
      isOpen: isStageOpenToday(stageData.stage, { now, clientType, allResourceStagesOpen }).isOpen
    };
  });
  const totalSanity = stages.reduce((sum, stage) => sum + stage.sanity, 0);
  const todayOpen = getTodayOpenStages({ now, clientType, allResourceStagesOpen });
  const openStages = stages.filter(stage => stage.isOpen !== false);
  const closedStages = stages.filter(stage => stage.isOpen === false);
  const focusOperator = operators[0] || null;

  return {
    queueRevision: getQueueRevision(queueData),
    operators,
    materialHierarchy,
    stages,
    openStages,
    closedStages,
    focusOperator,
    totalSanity,
    estimatedTime: Math.ceil(totalSanity / 240 * 60), // 假设每天240理智，转换为分钟
    warnings,
    mode: planMode,
    // 估算所用的企鹅物流掉落数据版本；null 表示本次生成全部回退经验估算
    dropDataInfo: dropData?.metadata || null,
    summary: {
      backlogCount: Math.max(operators.length - 1, 0),
      openStageCount: openStages.length,
      closedStageCount: closedStages.length,
      gameDate: todayOpen.gameDate,
      clientType: todayOpen.clientType,
      todayOpenResourceStages: todayOpen.open,
      todayClosedResourceStages: todayOpen.closed
    }
  };
}

export interface TrainingPlanApplyContextOptions {
  now?: Date;
  clientType?: string;
}

export interface TrainingPlanApplyContext {
  gameDate: string;
  clientType: string;
  planGameDate: string | null;
  planClientType: string | null;
  gameDateMismatch: boolean;
  clientTypeMismatch: boolean;
  intendedStages: string[];
  closedStages: string[];
}

export async function resolveTrainingPlanApplyContext(
  plan: unknown,
  options: TrainingPlanApplyContextOptions = {}
): Promise<TrainingPlanApplyContext> {
  const now = options.now ?? new Date();
  const clientType = resolveGameZone(options.clientType).clientType;
  const gameDate = getGameDay(now, clientType).date;

  const planRecord = isRecord(plan) ? plan : {};
  const summary = isRecord(planRecord.summary) ? planRecord.summary : null;
  const rawPlanGameDate = summary?.gameDate;
  const planGameDate = typeof rawPlanGameDate === 'string' && rawPlanGameDate.trim() !== ''
    ? rawPlanGameDate.trim()
    : null;
  const rawPlanClientType = summary?.clientType;
  const planClientType = typeof rawPlanClientType === 'string' && rawPlanClientType.trim() !== ''
    ? resolveGameZone(rawPlanClientType).clientType
    : null;
  const gameDateMismatch = planGameDate !== null && planGameDate !== gameDate;
  const clientTypeMismatch = planClientType !== null && planClientType !== clientType;

  const intendedStages: string[] = [];
  const seenStages = new Set<string>();
  for (const applicable of getApplicableStages(planRecord)) {
    const code = applicable.stage.trim();
    const key = code.toUpperCase();
    if (!code || seenStages.has(key)) continue;
    seenStages.add(key);
    intendedStages.push(code);
  }

  const activityCache = new Map<string, CachedResourceCollectionWindow>();
  const activityRequests = new Map<string, Promise<ResourceCollectionWindow | null>>();
  const allResourceStagesOpen = await isResourceCollectionOpen(clientType, {
    now: () => now.getTime(),
    cache: activityCache,
    inflight: activityRequests
  });
  const activityUnreadable = [...activityCache.values()].some(entry => entry.failed);

  const summaryOpenStages = new Set<string>();
  if (activityUnreadable && planGameDate === gameDate && planClientType === clientType) {
    const entries = summary && Array.isArray(summary.todayOpenResourceStages)
      ? summary.todayOpenResourceStages
      : [];
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.stage !== 'string') continue;
      const code = entry.stage.trim().toUpperCase();
      if (code) summaryOpenStages.add(code);
    }
  }

  const closedStages = intendedStages.filter(stage => {
    const { isOpen } = isStageOpenToday(stage, { now, clientType, allResourceStagesOpen });
    return !isOpen && !summaryOpenStages.has(stage.toUpperCase());
  });

  return {
    gameDate,
    clientType,
    planGameDate,
    planClientType,
    gameDateMismatch,
    clientTypeMismatch,
    intendedStages,
    closedStages
  };
}
