import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { getMaaResourceDir, getItemTablePath } from '../config/paths.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const TILE_POS_DIR = 'Arknights-Tile-Pos';
const TILE_POS_BATCH_SIZE = 32;

let cache = null;
let cacheAt = 0;
let pending = null;
let stageCatalog = null;
let stageCatalogPending = null;
let paradoxOperators = null;
let paradoxOperatorsPending = null;
let itemAssetMap = null;
let itemAssetMapMaterials = null;

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

/**
 * Build a searchable stage catalog from Arknights-Tile-Pos entries.
 *
 * Tile-Pos is the only MaaResource file that carries both the display name and
 * the internal stage id for every supported stage. The catalog keeps the first
 * entry for duplicate codes/names (for example, ISW-NO or #f# variants).
 */
export function buildMaaStageCatalog(entries = []) {
  const byCode = new Map();
  const byName = new Map();
  const byStageId = new Map();

  for (const raw of Array.isArray(entries) ? entries : []) {
    const stageId = String(raw?.stageId || '').trim();
    if (!stageId) continue;

    const entry = {
      code: String(raw?.code || '').trim(),
      name: String(raw?.name || '').trim(),
      stageId,
      levelId: raw?.levelId ? String(raw.levelId) : null
    };

    if (!byStageId.has(stageId)) byStageId.set(stageId, entry);
    if (entry.code && !byCode.has(entry.code.toUpperCase())) {
      byCode.set(entry.code.toUpperCase(), entry);
    }
    if (entry.name && !byName.has(entry.name)) byName.set(entry.name, entry);
  }

  return {
    entries: [...byStageId.values()],
    byCode,
    byName,
    byStageId
  };
}

export function buildMaaParadoxOperators(battleData = {}, catalog = null) {
  const chars = battleData?.chars && typeof battleData.chars === 'object' ? battleData.chars : {};
  const byStageId = catalog instanceof Map ? catalog : catalog?.byStageId;
  if (!(byStageId instanceof Map)) return [];

  const operators = [];
  for (const [id, char] of Object.entries(chars)) {
    if (!id.startsWith('char_')) continue;

    const parts = id.split('_');
    const suffix = parts.length > 2 ? parts.slice(2).join('_') : '';
    if (!suffix) continue;

    const stageId = `mem_${suffix}_1`;
    const stage = byStageId.get(stageId);
    if (!stage) continue;

    operators.push({
      id,
      name: String(char?.name || stage.name || id),
      stage_id: stageId,
      stage_name: String(stage.name || '')
    });
  }

  return operators.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

export function buildMaaItemAssetMap(materials = {}) {
  const byIconId = new Map();

  for (const [id, item] of Object.entries(materials || {})) {
    const iconId = item?.iconId ? String(item.iconId) : '';
    if (iconId && !byIconId.has(iconId)) byIconId.set(iconId, String(id));
  }

  return byIconId;
}

async function loadMaaStageCatalogUncached({
  resourceDir = getMaaResourceDir(),
  readdirFn = readdir,
  readFileFn = readFile
} = {}) {
  const tileDir = join(resourceDir, TILE_POS_DIR);
  let filenames;

  try {
    filenames = (await readdirFn(tileDir)).filter(name => name.endsWith('.json'));
  } catch (error) {
    if (error.code === 'ENOENT') return buildMaaStageCatalog([]);
    throw error;
  }

  const entries = [];
  for (let index = 0; index < filenames.length; index += TILE_POS_BATCH_SIZE) {
    const batch = filenames.slice(index, index + TILE_POS_BATCH_SIZE);
    const parsed = await Promise.all(batch.map(async name => {
      try {
        const value = JSON.parse(await readFileFn(join(tileDir, name), 'utf-8'));
        return value && typeof value === 'object' ? value : null;
      } catch {
        return null;
      }
    }));
    entries.push(...parsed.filter(Boolean));
  }

  return buildMaaStageCatalog(entries);
}

export async function loadMaaStageCatalog(options = {}) {
  if (stageCatalog) return stageCatalog;
  if (stageCatalogPending) return stageCatalogPending;

  stageCatalogPending = loadMaaStageCatalogUncached(options)
    .then(catalog => {
      stageCatalog = catalog;
      return catalog;
    })
    .finally(() => {
      stageCatalogPending = null;
    });

  return stageCatalogPending;
}

export async function findMaaStage(input, options = {}) {
  const value = String(input || '').trim();
  if (!value) return null;

  const catalog = await loadMaaStageCatalog(options);
  return catalog.byStageId.get(value)
    || catalog.byCode.get(value.toUpperCase())
    || catalog.byName.get(value)
    || null;
}

export async function getMaaParadoxOperators(options = {}) {
  if (paradoxOperators) return paradoxOperators;
  if (paradoxOperatorsPending) return paradoxOperatorsPending;

  paradoxOperatorsPending = Promise.all([
    loadMaaResourceData(options),
    loadMaaStageCatalog(options)
  ])
    .then(([data, catalog]) => {
      paradoxOperators = buildMaaParadoxOperators(data.battleData, catalog);
      return paradoxOperators;
    })
    .finally(() => {
      paradoxOperatorsPending = null;
    });

  return paradoxOperatorsPending;
}

export async function getMaaItemAssetMap(options = {}) {
  const { materials } = await getMaaMaterialDatabase(options);
  if (itemAssetMap && itemAssetMapMaterials === materials) return itemAssetMap;

  itemAssetMap = buildMaaItemAssetMap(materials);
  itemAssetMapMaterials = materials;
  return itemAssetMap;
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
  stageCatalog = null;
  stageCatalogPending = null;
  paradoxOperators = null;
  paradoxOperatorsPending = null;
  itemAssetMap = null;
  itemAssetMapMaterials = null;
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
