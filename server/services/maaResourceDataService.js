import { readFile } from 'fs/promises';
import { join } from 'path';
import { getMaaResourceDir, getItemTablePath } from '../config/paths.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = null;
let cacheAt = 0;
let pending = null;

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== null) return fallback;
    throw error;
  }
}

export function buildMaaMaterialDatabase(itemIndex = {}, itemTable = {}) {
  const tableItems = itemTable?.items || {};
  const items = {};
  const materials = {};
  const recipes = {};

  for (const [id, item] of Object.entries(itemIndex)) {
    const tableItem = tableItems[id] || {};
    const normalized = {
      id,
      name: item.name || tableItem.name || `物品_${id}`,
      icon: item.icon || null,
      iconId: tableItem.iconId || id,
      rarity: item.rarity ?? tableItem.rarity ?? 0,
      classifyType: item.classifyType || tableItem.classifyType || 'UNKNOWN',
      itemType: tableItem.itemType || null,
      sortId: item.sortId ?? tableItem.sortId ?? 999999,
      formula: item.formula || null
    };

    items[id] = normalized;
    materials[id] = normalized;

    const formula = item.formula;
    if (formula && typeof formula === 'object' && Object.keys(formula).length > 0) {
      recipes[id] = {
        materials: Object.fromEntries(
          Object.entries(formula).map(([subId, count]) => [subId, Number(count) || 0])
        )
      };
    }
  }

  return { items, materials, recipes };
}

export function buildMaaStageIndex(stages = []) {
  const byCode = new Map();
  const byStageId = new Map();

  for (const stage of Array.isArray(stages) ? stages : []) {
    if (stage?.code) byCode.set(String(stage.code).toUpperCase(), stage);
    if (stage?.stageId) byStageId.set(String(stage.stageId), stage);
  }

  return { byCode, byStageId };
}

async function loadMaaResourceDataUncached({
  resourceDir = getMaaResourceDir(),
  itemTablePath = getItemTablePath()
} = {}) {
  const [itemIndex, itemTable, stages, battleData] = await Promise.all([
    readJson(join(resourceDir, 'item_index.json'), {}),
    readJson(itemTablePath, {}),
    readJson(join(resourceDir, 'stages.json'), []),
    readJson(join(resourceDir, 'battle_data.json'), {})
  ]);

  const materialDatabase = buildMaaMaterialDatabase(itemIndex, itemTable);
  return {
    resourceDir,
    materialDatabase,
    stages: Array.isArray(stages) ? stages : [],
    stageIndex: buildMaaStageIndex(stages),
    battleData
  };
}

export async function loadMaaResourceData(options = {}) {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;
  if (pending) return pending;

  pending = loadMaaResourceDataUncached(options)
    .then(data => {
      cache = data;
      cacheAt = Date.now();
      return data;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export function clearMaaResourceCache() {
  cache = null;
  cacheAt = 0;
  pending = null;
}

export async function getMaaMaterialDatabase(options = {}) {
  const data = await loadMaaResourceData(options);
  return data.materialDatabase;
}

export async function getMaaItemInfo(itemId, options = {}) {
  const data = await loadMaaResourceData(options);
  return data.materialDatabase.items[String(itemId)] || null;
}

export async function getMaaStageByCode(code, options = {}) {
  const data = await loadMaaResourceData(options);
  return data.stageIndex.byCode.get(String(code || '').toUpperCase()) || null;
}

export async function getMaaStageByStageId(stageId, options = {}) {
  const data = await loadMaaResourceData(options);
  return data.stageIndex.byStageId.get(String(stageId || '')) || null;
}
