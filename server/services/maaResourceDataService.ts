import { getErrorCode, isRecord } from '../utils/errors.ts';
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getMaaResourceDir, getItemTablePath } from '../config/paths.ts';

const CACHE_TTL_MS = 5 * 60 * 1000;
const TILE_POS_DIR = 'Arknights-Tile-Pos';
const TILE_POS_BATCH_SIZE = 32;
const STAGE_CATALOG_CACHE_VERSION = 1;
const STAGE_CATALOG_CACHE_PATH = fileURLToPath(new URL('../data/maa-stage-catalog-cache.json', import.meta.url));

export interface MaaMaterialItem {
  id: string;
  name: string;
  icon: string | null;
  iconId: string;
  rarity: number;
  classifyType: string;
  itemType: string | null;
  sortId: number;
  formula: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface MaaMaterialDatabase {
  items: Record<string, MaaMaterialItem>;
  materials: Record<string, MaaMaterialItem>;
  recipes: Record<string, { materials: Record<string, number> }>;
}

export type MaaStageRecord = Record<string, unknown>;

export interface MaaStageIndex {
  byCode: Map<string, MaaStageRecord>;
  byStageId: Map<string, MaaStageRecord>;
}

export interface MaaStageCatalogEntry {
  code: string;
  name: string;
  stageId: string;
  levelId: string | null;
}

export interface MaaStageCatalog {
  entries: MaaStageCatalogEntry[];
  byCode: Map<string, MaaStageCatalogEntry>;
  byName: Map<string, MaaStageCatalogEntry>;
  byStageId: Map<string, MaaStageCatalogEntry>;
}

export interface MaaParadoxOperator {
  id: string;
  name: string;
  stage_id: string;
  stage_name: string;
}

export interface MaaResourceOptions {
  resourceDir?: string;
  itemTablePath?: string;
  readdirFn?: (path: string) => Promise<string[]>;
  readFileFn?: (path: string, encoding: 'utf-8') => Promise<string>;
}

export interface MaaResourceData {
  resourceDir: string;
  materialDatabase: MaaMaterialDatabase;
  stages: unknown[];
  stageIndex: MaaStageIndex;
  battleData: unknown;
}

let cache: MaaResourceData | null = null;
let cacheAt = 0;
let pending: Promise<MaaResourceData> | null = null;
let stageCatalog: MaaStageCatalog | null = null;
let stageCatalogPending: Promise<MaaStageCatalog> | null = null;
let paradoxOperators: MaaParadoxOperator[] | null = null;
let paradoxOperatorsPending: Promise<MaaParadoxOperator[]> | null = null;
let itemAssetMap: Map<string, string> | null = null;
let itemAssetMapMaterials: MaaMaterialDatabase['materials'] | null = null;

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return fallback;
    throw error;
  }
}

export function buildMaaMaterialDatabase(itemIndex: unknown = {}, itemTable: unknown = {}): MaaMaterialDatabase {
  const source = isRecord(itemIndex) ? itemIndex : {};
  const table = isRecord(itemTable) ? itemTable : {};
  const tableItems = isRecord(table.items) ? table.items : {};
  const items: Record<string, MaaMaterialItem> = {};
  const materials: Record<string, MaaMaterialItem> = {};
  const recipes: Record<string, { materials: Record<string, number> }> = {};

  for (const [id, rawItem] of Object.entries(source)) {
    const item = isRecord(rawItem) ? rawItem : {};
    const rawTableItem = tableItems[id];
    const tableItem = isRecord(rawTableItem) ? rawTableItem : {};
    const normalized: MaaMaterialItem = {
      id,
      name: typeof item.name === 'string' && item.name ? item.name : typeof tableItem.name === 'string' && tableItem.name ? tableItem.name : `物品_${id}`,
      icon: typeof item.icon === 'string' ? item.icon : null,
      iconId: typeof tableItem.iconId === 'string' && tableItem.iconId ? tableItem.iconId : id,
      rarity: typeof item.rarity === 'number' ? item.rarity : typeof tableItem.rarity === 'number' ? tableItem.rarity : 0,
      classifyType: typeof item.classifyType === 'string' && item.classifyType ? item.classifyType : typeof tableItem.classifyType === 'string' && tableItem.classifyType ? tableItem.classifyType : 'UNKNOWN',
      itemType: typeof tableItem.itemType === 'string' ? tableItem.itemType : null,
      sortId: typeof item.sortId === 'number' ? item.sortId : typeof tableItem.sortId === 'number' ? tableItem.sortId : 999999,
      formula: isRecord(item.formula) ? item.formula : null
    };

    items[id] = normalized;
    materials[id] = normalized;

    const formula = normalized.formula;
    if (formula && Object.keys(formula).length > 0) {
      recipes[id] = {
        materials: Object.fromEntries(
          Object.entries(formula).map(([subId, count]) => [subId, Number(count) || 0])
        )
      };
    }
  }

  return { items, materials, recipes };
}

export function buildMaaStageIndex(stages: unknown = []): MaaStageIndex {
  const byCode = new Map<string, MaaStageRecord>();
  const byStageId = new Map<string, MaaStageRecord>();

  for (const stage of Array.isArray(stages) ? stages : []) {
    if (!isRecord(stage)) continue;
    if (stage.code) byCode.set(String(stage.code).toUpperCase(), stage);
    if (stage.stageId) byStageId.set(String(stage.stageId), stage);
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
export function buildMaaStageCatalog(entries: unknown = []): MaaStageCatalog {
  const byCode = new Map<string, MaaStageCatalogEntry>();
  const byName = new Map<string, MaaStageCatalogEntry>();
  const byStageId = new Map<string, MaaStageCatalogEntry>();

  for (const raw of Array.isArray(entries) ? entries : []) {
    if (!isRecord(raw)) continue;
    const stageId = String(raw.stageId || '').trim();
    if (!stageId) continue;

    const entry: MaaStageCatalogEntry = {
      code: String(raw.code || '').trim(),
      name: String(raw.name || '').trim(),
      stageId,
      levelId: raw.levelId ? String(raw.levelId) : null
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

export function buildMaaParadoxOperators(battleData: unknown = {}, catalog: unknown = null): MaaParadoxOperator[] {
  const chars = isRecord(battleData) && isRecord(battleData.chars) ? battleData.chars : {};
  const byStageId = catalog instanceof Map
    ? catalog
    : isRecord(catalog) && catalog.byStageId instanceof Map
      ? catalog.byStageId
      : null;
  if (!(byStageId instanceof Map)) return [];

  const operators: MaaParadoxOperator[] = [];
  for (const [id, rawChar] of Object.entries(chars)) {
    if (!id.startsWith('char_')) continue;
    const char = isRecord(rawChar) ? rawChar : {};

    const parts = id.split('_');
    const suffix = parts.length > 2 ? parts.slice(2).join('_') : '';
    if (!suffix) continue;

    const stageId = `mem_${suffix}_1`;
    const rawStage = byStageId.get(stageId);
    if (!isRecord(rawStage)) continue;
    const stage = rawStage;

    operators.push({
      id,
      name: String(char.name || stage.name || id),
      stage_id: stageId,
      stage_name: String(stage.name || '')
    });
  }

  return operators.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

export function buildMaaItemAssetMap(materials: unknown = {}): Map<string, string> {
  const byIconId = new Map<string, string>();
  const source = isRecord(materials) ? materials : {};

  for (const [id, rawItem] of Object.entries(source)) {
    const item = isRecord(rawItem) ? rawItem : {};
    const iconId = item.iconId ? String(item.iconId) : '';
    if (iconId && !byIconId.has(iconId)) byIconId.set(iconId, String(id));
  }

  return byIconId;
}

async function loadMaaStageCatalogUncached(options: MaaResourceOptions = {}) {
  const resourceDir = options.resourceDir ?? getMaaResourceDir();
  const readdirFn = options.readdirFn ?? readdir;
  const readFileFn = options.readFileFn ?? readFile;
  const useDiskCache = !options.resourceDir && !options.readdirFn && !options.readFileFn;
  const tileDir = join(resourceDir, TILE_POS_DIR);
  let filenames: string[];

  try {
    filenames = (await readdirFn(tileDir)).filter(name => name.endsWith('.json'));
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return buildMaaStageCatalog([]);
    throw error;
  }

  let tileDirMtimeMs: number | null = null;
  if (useDiskCache && filenames.length > 0) {
    tileDirMtimeMs = (await stat(tileDir).catch(() => null))?.mtimeMs ?? null;
    const cached = await readJson<unknown>(STAGE_CATALOG_CACHE_PATH, null).catch(() => null);
    if (isRecord(cached)
      && cached.version === STAGE_CATALOG_CACHE_VERSION
      && cached.resourceDir === resourceDir
      && cached.fileCount === filenames.length
      && cached.tileDirMtimeMs === tileDirMtimeMs
      && Array.isArray(cached.entries)) {
      return buildMaaStageCatalog(cached.entries);
    }
  }

  const entries: unknown[] = [];
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

  const catalog = buildMaaStageCatalog(entries);
  if (useDiskCache && filenames.length > 0) {
    try {
      await mkdir(dirname(STAGE_CATALOG_CACHE_PATH), { recursive: true });
      await writeFile(STAGE_CATALOG_CACHE_PATH, JSON.stringify({
        version: STAGE_CATALOG_CACHE_VERSION,
        resourceDir,
        fileCount: filenames.length,
        tileDirMtimeMs,
        entries: catalog.entries
      }), 'utf-8');
    } catch {
      // A cache write failure must not fail stage lookup.
    }
  }
  return catalog;
}

export async function loadMaaStageCatalog(options: MaaResourceOptions = {}): Promise<MaaStageCatalog> {
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

export async function prewarmMaaStageCatalog(options: MaaResourceOptions = {}): Promise<number> {
  const catalog = await loadMaaStageCatalog(options);
  return catalog.entries.length;
}

export async function findMaaStage(input: unknown, options: MaaResourceOptions = {}): Promise<MaaStageCatalogEntry | null> {
  const value = String(input || '').trim();
  if (!value) return null;

  const catalog = await loadMaaStageCatalog(options);
  return catalog.byStageId.get(value)
    || catalog.byCode.get(value.toUpperCase())
    || catalog.byName.get(value)
    || null;
}

export async function getMaaParadoxOperators(options: MaaResourceOptions = {}): Promise<MaaParadoxOperator[]> {
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

export async function getMaaItemAssetMap(options: MaaResourceOptions = {}): Promise<Map<string, string>> {
  const { materials } = await getMaaMaterialDatabase(options);
  if (itemAssetMap && itemAssetMapMaterials === materials) return itemAssetMap;

  itemAssetMap = buildMaaItemAssetMap(materials);
  itemAssetMapMaterials = materials;
  return itemAssetMap;
}

async function loadMaaResourceDataUncached({
  resourceDir = getMaaResourceDir(),
  itemTablePath = getItemTablePath()
}: MaaResourceOptions = {}): Promise<MaaResourceData> {
  const [itemIndex, itemTable, stages, battleData] = await Promise.all([
    readJson<unknown>(join(resourceDir, 'item_index.json'), {}),
    readJson<unknown>(itemTablePath, {}),
    readJson<unknown>(join(resourceDir, 'stages.json'), []),
    readJson<unknown>(join(resourceDir, 'battle_data.json'), {})
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

export async function loadMaaResourceData(options: MaaResourceOptions = {}): Promise<MaaResourceData> {
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


/**
 * Collect the main numeric stages for an activity from MaaResource's stage
 * table. StageActivityV2 only lists drop/efficiency highlights (for example
 * TL-9, TL-8, TL-7, TL-4), not every playable stage. The full stage table is
 * needed when the activity runner falls back to the complete stage sequence.
 */
export function collectMaaActivityStageCodes(stages: unknown, activityCode: string): string[] {
  const prefix = `${String(activityCode || '').trim().toUpperCase()}-`;
  if (!prefix || prefix === '-') return [];
  const byCode = new Map<string, number>();
  for (const raw of Array.isArray(stages) ? stages : []) {
    if (!isRecord(raw) || typeof raw.code !== 'string') continue;
    const code = raw.code.trim().toUpperCase();
    if (!code.startsWith(prefix)) continue;
    const suffix = code.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const number = Number(suffix);
    if (!Number.isSafeInteger(number) || number < 0) continue;
    if (!byCode.has(code)) byCode.set(code, number);
  }
  return [...byCode.entries()]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([code]) => code);
}

export async function listMaaActivityStageCodes(activityCode: string): Promise<string[]> {
  const data = await loadMaaResourceData();
  return collectMaaActivityStageCodes(data.stages, activityCode);
}

export async function getMaaMaterialDatabase(options: MaaResourceOptions = {}): Promise<MaaMaterialDatabase> {
  const data = await loadMaaResourceData(options);
  return data.materialDatabase;
}

export async function getMaaItemInfo(itemId: unknown, options: MaaResourceOptions = {}): Promise<MaaMaterialItem | null> {
  const data = await loadMaaResourceData(options);
  return data.materialDatabase.items[String(itemId)] || null;
}

export async function getMaaStageByCode(code: unknown, options: MaaResourceOptions = {}): Promise<MaaStageRecord | null> {
  const data = await loadMaaResourceData(options);
  return data.stageIndex.byCode.get(String(code || '').toUpperCase()) || null;
}

export async function getMaaStageByStageId(stageId: unknown, options: MaaResourceOptions = {}): Promise<MaaStageRecord | null> {
  const data = await loadMaaResourceData(options);
  return data.stageIndex.byStageId.get(String(stageId || '')) || null;
}
