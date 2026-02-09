/**
 * 干员养成服务
 * 负责干员识别、材料需求计算、养成队列管理等
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readJsonFile, writeJsonFile } from '../utils/fileHelper.js';
import { createLogger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 创建日志记录器
const logger = createLogger('OperatorTraining');

// 配置文件路径
const TRAINING_QUEUE_PATH = path.join(__dirname, '../data/user-configs/training-queue.json');
const OPERATOR_MATERIALS_PATH = path.join(__dirname, '../data/operator-materials.json');
const OPERBOX_PATH = path.join(__dirname, '../data/operbox.json');
const DEPOT_PATH = path.join(__dirname, '../data/depot.json');

/**
 * 关卡代号映射表
 * 将数据库中的关卡代号转换为 MAA 可识别的关卡名称
 */
const STAGE_CODE_MAP = {
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
const CHIP_STAGE_MAP = {
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
function convertStageCode(stageCode) {
  if (!stageCode) return stageCode;
  
  // 如果已经是大写格式，直接返回
  if (stageCode.match(/^[A-Z]{2,3}-[A-Z0-9]-\d+$/)) {
    return stageCode;
  }
  
  // 转换为小写进行匹配
  const lowerCode = stageCode.toLowerCase();
  
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
  return stageCode;
}

/**
 * 加载干员材料数据库
 */
async function loadOperatorMaterials() {
  try {
    return await readJsonFile(OPERATOR_MATERIALS_PATH, { operators: {}, metadata: {} });
  } catch (error) {
    logger.error('加载干员材料数据失败', { error: error.message });
    return { operators: {}, metadata: {} };
  }
}

/**
 * 加载材料数据库（包含 recipes）
 */
async function loadMaterialsDatabase() {
  try {
    const MATERIALS_DB_PATH = path.join(__dirname, '../data/materials.json');
    return await readJsonFile(MATERIALS_DB_PATH, { materials: {}, recipes: {}, stageSchedule: {} });
  } catch (error) {
    logger.error('加载材料数据库失败', { error: error.message });
    return { materials: {}, recipes: {}, stageSchedule: {} };
  }
}

/**
 * 加载材料合成配方数据库
 */
async function loadMaterialFormulas() {
  try {
    const FORMULAS_PATH = path.join(__dirname, '../data/material-formulas.json');
    return await readJsonFile(FORMULAS_PATH, {});
  } catch (error) {
    logger.error('加载材料合成配方失败', { error: error.message });
    return {};
  }
}

/**
 * 加载 OperBox 识别结果
 */
async function loadOperBox() {
  try {
    return await readJsonFile(OPERBOX_PATH, { operators: [] });
  } catch (error) {
    logger.error('加载 OperBox 数据失败', { error: error.message });
    return { operators: [] };
  }
}

/**
 * 加载仓库数据
 */
async function loadDepot() {
  try {
    const depotData = await readJsonFile(DEPOT_PATH, { items: [], timestamp: null });
    
    // 将数组转换为对象 { id: count }
    const itemsMap = {};
    if (depotData.items && Array.isArray(depotData.items)) {
      depotData.items.forEach(item => {
        itemsMap[item.id] = item.count;
      });
    }
    
    return { items: itemsMap, timestamp: depotData.timestamp };
  } catch (error) {
    logger.error('加载仓库数据失败', { error: error.message });
    return { items: {}, timestamp: null };
  }
}

/**
 * 加载养成队列
 */
async function loadTrainingQueue() {
  const defaultQueue = {
    queue: [],
    settings: {
      autoSwitch: true,
      notifyOnComplete: true,
      useMedicine: 0,
      useStone: 0
    },
    lastUpdated: new Date().toISOString()
  };
  
  return await readJsonFile(TRAINING_QUEUE_PATH, defaultQueue);
}

/**
 * 保存养成队列
 */
async function saveTrainingQueue(queueData) {
  try {
    queueData.lastUpdated = new Date().toISOString();
    await writeJsonFile(TRAINING_QUEUE_PATH, queueData);
    return true;
  } catch (error) {
    logger.error('保存养成队列失败', { error: error.message });
    return false;
  }
}

/**
 * 获取干员列表（以 OperBox 为主，材料数据库为辅）
 */
async function getOperatorList(filters = {}) {
  const operatorMaterialsData = await loadOperatorMaterials();
  const operBoxData = await loadOperBox();
  
  const operators = [];
  
  // 遍历 OperBox 中的所有干员（实际拥有的干员）
  if (operBoxData.data && Array.isArray(operBoxData.data)) {
    for (const operBoxOp of operBoxData.data) {
      // 尝试从材料数据库中查找对应的材料数据
      const opData = operatorMaterialsData.operators[operBoxOp.id];
      
      const operator = {
        id: operBoxOp.id,
        name: operBoxOp.name,
        rarity: operBoxOp.rarity,
        profession: opData?.profession || '未知',
        currentElite: operBoxOp.elite || 0,
        currentLevel: operBoxOp.level || 1,
        owned: true,
        potential: operBoxOp.potential || 1,
        hasMaterialData: !!opData, // 标记是否有材料数据
        materials: opData ? {
          elite1: opData.elite1,
          elite2: opData.elite2
        } : null
      };
      
      // 应用过滤器
      if (filters.rarity && operator.rarity !== filters.rarity) continue;
      if (filters.profession && operator.profession !== filters.profession) continue;
      if (filters.owned !== undefined && operator.owned !== filters.owned) continue;
      if (filters.needsElite2 && operator.currentElite >= 2) continue;
      
      operators.push(operator);
    }
  }
  
  // 排序：六星优先，然后按稀有度降序，最后按名称
  operators.sort((a, b) => {
    if (a.rarity !== b.rarity) return b.rarity - a.rarity;
    if (a.currentElite !== b.currentElite) return a.currentElite - b.currentElite;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  
  return operators;
}

/**
 * 计算单个干员的材料需求
 */
function calculateOperatorMaterials(operator, depot = {}) {
  const materials = [];
  const totalLMD = { needed: 0, have: 0 };
  
  // 根据当前精英等级决定需要哪些材料
  const needElite1 = operator.currentElite < 1;
  const needElite2 = operator.currentElite < 2;
  
  // 收集所有需要的材料
  const allMaterials = {};
  
  if (needElite1 && operator.materials.elite1) {
    totalLMD.needed += operator.materials.elite1.lmd || 0;
    operator.materials.elite1.materials?.forEach(mat => {
      allMaterials[mat.id] = (allMaterials[mat.id] || 0) + mat.count;
    });
  }
  
  if (needElite2 && operator.materials.elite2) {
    totalLMD.needed += operator.materials.elite2.lmd || 0;
    operator.materials.elite2.materials?.forEach(mat => {
      allMaterials[mat.id] = (allMaterials[mat.id] || 0) + mat.count;
    });
    operator.materials.elite2.chips?.forEach(mat => {
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
    isComplete: materials.every(m => m.stillNeeded === 0) && totalLMD.stillNeeded === 0
  };
}

/**
 * 从材料列表中获取材料名称
 */
function getMaterialName(id, operatorMaterials) {
  // 尝试从精1材料中查找
  if (operatorMaterials.elite1?.materials) {
    const mat = operatorMaterials.elite1.materials.find(m => m.id === id);
    if (mat) return mat.name;
  }
  
  // 尝试从精2材料中查找
  if (operatorMaterials.elite2?.materials) {
    const mat = operatorMaterials.elite2.materials.find(m => m.id === id);
    if (mat) return mat.name;
  }
  
  // 尝试从精2芯片中查找
  if (operatorMaterials.elite2?.chips) {
    const mat = operatorMaterials.elite2.chips.find(m => m.id === id);
    if (mat) return mat.name;
  }
  
  return `材料_${id}`;
}

/**
 * 获取养成队列
 */
async function getTrainingQueue() {
  const queueData = await loadTrainingQueue();
  const depot = await loadDepot();
  const operatorMaterialsData = await loadOperatorMaterials();
  
  // 为队列中的每个干员计算材料需求和进度
  const enrichedQueue = [];
  
  for (const queueItem of queueData.queue) {
    const opData = operatorMaterialsData.operators[queueItem.operatorId];
    if (!opData) continue;
    
    const operator = {
      id: queueItem.operatorId,
      name: opData.name,
      rarity: opData.rarity,
      profession: opData.profession,
      currentElite: queueItem.currentElite || 0,
      targetElite: queueItem.targetElite || 2,
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
  
  return {
    queue: enrichedQueue,
    settings: queueData.settings,
    lastUpdated: queueData.lastUpdated
  };
}

/**
 * 计算完成进度（百分比）
 */
function calculateProgress(materialCalc) {
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

/**
 * 添加干员到养成队列
 */
async function addToQueue(operatorId, options = {}) {
  const queueData = await loadTrainingQueue();
  const operatorMaterialsData = await loadOperatorMaterials();
  const operBoxData = await loadOperBox();
  
  const opData = operatorMaterialsData.operators[operatorId];
  if (!opData) {
    throw new Error(`干员材料数据不存在，暂不支持该干员`);
  }
  
  // 从 OperBox 获取干员名称
  const operBoxOp = operBoxData.data?.find(op => op.id === operatorId);
  const operatorName = operBoxOp?.name || opData.name;
  
  // 检查是否已在队列中
  const existingIndex = queueData.queue.findIndex(item => item.operatorId === operatorId);
  if (existingIndex !== -1) {
    throw new Error(`干员 ${operatorName} 已在养成队列中`);
  }
  
  // 添加到队列
  const queueItem = {
    operatorId,
    currentElite: options.currentElite || 0,
    targetElite: options.targetElite || 2,
    priority: queueData.queue.length + 1,
    status: 'pending',
    addedAt: new Date().toISOString()
  };
  
  queueData.queue.push(queueItem);
  await saveTrainingQueue(queueData);
  
  return queueItem;
}

/**
 * 从养成队列中移除干员
 */
async function removeFromQueue(operatorId) {
  const queueData = await loadTrainingQueue();
  
  const index = queueData.queue.findIndex(item => item.operatorId === operatorId);
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
    logger.error('更新刷取计划失败', { error: error.message });
    // 即使更新失败也不影响删除操作
  }
  
  return true;
}

/**
 * 清除所有智能养成关卡
 */
async function clearSmartTrainingStages() {
  const COMBAT_TASKS_PATH = path.join(__dirname, '../data/user-configs/automation-tasks.json');
  
  try {
    // 读取现有配置
    const config = await readJsonFile(COMBAT_TASKS_PATH, { taskFlow: [], schedule: { enabled: false, times: [] } });
    
    // 查找 fight 任务
    const fightTask = config.taskFlow?.find(t => t.commandId === 'fight');
    
    if (fightTask && fightTask.params.stages) {
      // 过滤掉所有智能养成关卡
      const existingStages = fightTask.params.stages || [];
      const nonSmartStages = existingStages.filter(s => !s.smart);
      
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
    logger.error('清除智能关卡失败', { error: error.message });
    throw error;
  }
}

/**
 * 更新队列顺序
 */
async function updateQueueOrder(orderedOperatorIds) {
  const queueData = await loadTrainingQueue();
  
  const newQueue = [];
  orderedOperatorIds.forEach((opId, index) => {
    const item = queueData.queue.find(q => q.operatorId === opId);
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
async function updateSettings(settings) {
  const queueData = await loadTrainingQueue();
  queueData.settings = { ...queueData.settings, ...settings };
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
function expandMaterialTree(materialId, needed, depot, materialsDb, formulasDb, farmableMaterials = {}) {
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

/**
 * 生成养成计划（刷取计划）
 */
async function generateTrainingPlan(mode = 'current') {
  const queueData = await loadTrainingQueue();
  const depot = await loadDepot();
  const operatorMaterialsData = await loadOperatorMaterials();
  const materialsDb = await loadMaterialsDatabase();
  
  if (queueData.queue.length === 0) {
    throw new Error('养成队列为空');
  }
  
  // 收集需要刷取的材料
  const materialNeeds = {};
  const operators = [];
  
  // 根据模式决定处理哪些干员
  const operatorsToProcess = mode === 'current' 
    ? [queueData.queue[0]] 
    : queueData.queue;
  
  for (const queueItem of operatorsToProcess) {
    const opData = operatorMaterialsData.operators[queueItem.operatorId];
    if (!opData) continue;
    
    const operator = {
      id: queueItem.operatorId,
      name: opData.name,
      rarity: opData.rarity,
      profession: opData.profession,
      currentElite: queueItem.currentElite || 0,
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
        materials: materialCalc.materials.filter(m => m.stillNeeded > 0)
      });
      
      // 汇总材料需求
      materialCalc.materials.forEach(mat => {
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
  const farmableMaterials = {};
  for (const [materialId, needed] of Object.entries(materialNeeds)) {
    expandMaterialTree(materialId, needed, depot, materialsDb, formulasDb, farmableMaterials);
  }
  
  logger.info('材料树展开完成', { farmableMaterialCount: Object.keys(farmableMaterials).length });
  logger.debug('可刷取材料', { farmableMaterials });
  
  // 生成刷取计划
  const materialHierarchy = [];
  const stagesMap = new Map();
  let totalSanity = 0;
  const warnings = [];
  
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
      let stage = null;
      
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
      
      if (!stagesMap.has(stage)) {
        stagesMap.set(stage, {
          stage,
          materials: [],
          totalTimes: 0,
          sanity: 0,
          isOpen: true // 简化版本假设都开放
        });
      }
      
      const stageData = stagesMap.get(stage);
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
  
  const stages = Array.from(stagesMap.values());
  
  return {
    operators,
    materialHierarchy,
    stages,
    totalSanity,
    estimatedTime: Math.ceil(totalSanity / 240 * 60), // 假设每天240理智，转换为分钟
    warnings,
    mode
  };
}

/**
 * 应用养成计划到任务流程
 */
async function applyPlanToTasks(plan, settings = {}) {
  logger.info('开始应用养成计划');
  logger.debug('计划详情', { 
    stageCount: plan.stages?.length || 0,
    operatorCount: plan.operators?.length || 0
  });
  
  // 保存到作战任务配置
  const COMBAT_TASKS_PATH = path.join(__dirname, '../data/user-configs/automation-tasks.json');
  
  try {
    // 读取现有配置
    const config = await readJsonFile(COMBAT_TASKS_PATH, { 
      taskFlow: [], 
      schedule: { enabled: false, times: [] } 
    });
    
    logger.debug('成功读取现有配置', { taskCount: config.taskFlow?.length || 0 });
    
    // 查找或创建 fight 任务
    let fightTask = config.taskFlow.find(t => t.commandId === 'fight');
    
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
          medicine: settings.useMedicine || 0,
          expiringMedicine: 0,
          stone: settings.useStone || 0,
          series: 0
        }
      };
      config.taskFlow.push(fightTask);
      logger.info('创建了新的 fight 任务');
    }
    
    // 获取现有的 stages，并分类
    const existingStages = fightTask.params.stages || [];
    const pinnedStages = existingStages.filter(s => s.pinned);
    const normalStages = existingStages.filter(s => !s.pinned && !s.smart);
    
    logger.debug('现有关卡分类', { 
      total: existingStages.length,
      pinned: pinnedStages.length,
      normal: normalStages.length
    });
    
    // 构建新的智能养成关卡
    const smartStages = [];
    
    // 获取正在养成的干员名称
    let trainingOperatorNames = [];
    if (plan.operators && plan.operators.length > 0) {
      trainingOperatorNames = plan.operators.map(op => op.name);
    }
    
    logger.debug('养成干员', { operators: trainingOperatorNames });
    
    if (plan.stages && plan.stages.length > 0) {
      plan.stages.forEach(stage => {
        smartStages.push({
          stage: stage.stage,
          times: stage.totalTimes.toString(),
          smart: true,
          trainingOperators: trainingOperatorNames
        });
      });
      logger.info('生成智能关卡', { count: smartStages.length });
    }
    
    // 添加 fallback 关卡（理智用完后刷什么）
    if (settings.fallbackStage && settings.fallbackStage.trim()) {
      smartStages.push({
        stage: settings.fallbackStage.trim(),
        times: (settings.fallbackTimes || 999).toString(),
        smart: true,
        trainingOperators: trainingOperatorNames
      });
      logger.debug('添加 fallback 关卡', { stage: settings.fallbackStage });
    }
    
    // 重新组合关卡顺序：置顶 -> 智能 -> 普通
    const newStages = [...pinnedStages, ...smartStages, ...normalStages];
    
    logger.info('关卡重组完成', { 
      totalStages: newStages.length,
      smartStages: smartStages.length
    });
    
    // 更新任务参数
    fightTask.params = {
      ...fightTask.params,
      stages: newStages,
      medicine: settings.useMedicine || 0,
      expiringMedicine: 0,
      stone: settings.useStone || 0,
      series: fightTask.params.series || 0
    };
    
    // 保存配置
    await writeJsonFile(COMBAT_TASKS_PATH, config);
    logger.success('养成计划应用成功');
    
    return { 
      success: true, 
      stageCount: smartStages.length,
      totalStages: newStages.length,
      hasFallback: !!settings.fallbackStage
    };
  } catch (error) {
    logger.error('应用任务流程失败', { error: error.message });
    throw new Error('应用任务流程失败');
  }
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
  calculateOperatorMaterials
};
