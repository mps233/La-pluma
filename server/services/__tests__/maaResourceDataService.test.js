import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildMaaItemAssetMap,
  buildMaaMaterialDatabase,
  buildMaaParadoxOperators,
  buildMaaStageCatalog,
  buildMaaStageIndex,
  clearMaaResourceCache,
  findMaaStage,
  getMaaItemInfo,
  getMaaMaterialDatabase,
  getMaaParadoxOperators,
  getMaaStageByCode,
  getMaaStageByStageId,
  loadMaaResourceData,
  loadMaaStageCatalog
} from '../maaResourceDataService.js';

const itemIndex = {
  30012: {
    name: '固源岩',
    icon: '30012.png',
    rarity: 1,
    classifyType: 'MATERIAL',
    sortId: 100039,
    formula: { 30011: 3 }
  },
  4001: {
    name: '龙门币',
    icon: '4001.png',
    classifyType: 'NORMAL',
    sortId: 10201
  }
};

const itemTable = {
  items: {
    30012: { iconId: 'MTL_SL_G2', rarity: 1, classifyType: 'MATERIAL', sortId: 100039 },
    4001: { iconId: 'GOLD', rarity: 3, classifyType: 'NORMAL', sortId: 10201 }
  }
};

test('builds a material dictionary and recipes from MaaResource data', () => {
  const database = buildMaaMaterialDatabase(itemIndex, itemTable);

  assert.equal(database.materials['30012'].name, '固源岩');
  assert.equal(database.materials['30012'].iconId, 'MTL_SL_G2');
  assert.equal(database.materials['30012'].rarity, 1);
  assert.deepEqual(database.recipes['30012'], { materials: { 30011: 3 } });
  assert.equal(database.recipes['4001'], undefined);
});

test('builds a stage index by code and internal stage id', () => {
  const index = buildMaaStageIndex([
    { code: '1-7', stageId: 'main_01-07', apCost: 6 },
    { code: 'CE-6', stageId: 'wk_melee_6', apCost: 30 }
  ]);

  assert.equal(index.byCode.get('1-7').apCost, 6);
  assert.equal(index.byStageId.get('main_01-07').code, '1-7');
  assert.equal(index.byCode.get('CE-6').apCost, 30);
});

test('loads item and stage data from a MaaResource directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'la-pluma-maa-resource-'));
  const itemTablePath = join(root, 'item_table.json');
  await mkdir(join(root, 'gamedata', 'excel'), { recursive: true });
  await Promise.all([
    writeFile(join(root, 'item_index.json'), JSON.stringify(itemIndex)),
    writeFile(join(root, 'stages.json'), JSON.stringify([{ code: '1-7', stageId: 'main_01-07', apCost: 6 }])),
    writeFile(join(root, 'battle_data.json'), JSON.stringify({ chars: {} })),
    writeFile(itemTablePath, JSON.stringify(itemTable))
  ]);

  clearMaaResourceCache();
  try {
    const data = await loadMaaResourceData({ resourceDir: root, itemTablePath });
    assert.equal(data.materialDatabase.materials['30012'].iconId, 'MTL_SL_G2');
    assert.equal(data.stageIndex.byCode.get('1-7').apCost, 6);

    const item = await getMaaItemInfo('30012', { resourceDir: root, itemTablePath });
    assert.equal(item.name, '固源岩');
    assert.equal((await getMaaStageByCode('1-7', { resourceDir: root, itemTablePath })).apCost, 6);
    assert.equal((await getMaaStageByStageId('main_01-07', { resourceDir: root, itemTablePath })).code, '1-7');
    assert.equal((await getMaaMaterialDatabase({ resourceDir: root, itemTablePath })).materials['4001'].name, '龙门币');
  } finally {
    clearMaaResourceCache();
    await rm(root, { recursive: true, force: true });
  }
});

test('returns null for unknown items and stages', async () => {
  clearMaaResourceCache();
  assert.equal(await getMaaItemInfo('missing', { resourceDir: '/tmp/la-pluma-missing-resource', itemTablePath: '/tmp/la-pluma-missing-item-table.json' }), null);
  assert.equal(await getMaaStageByCode('missing', { resourceDir: '/tmp/la-pluma-missing-resource', itemTablePath: '/tmp/la-pluma-missing-item-table.json' }), null);
});

test('builds a stage catalog from Tile-Pos entries', () => {
  const catalog = buildMaaStageCatalog([
    { code: '1-7', name: '暴君', stageId: 'main_01-07' },
    { code: '1-7', name: '暴君', stageId: 'main_01-07#f#' },
    { code: 'GT-1', name: '坍塌', stageId: 'a001_01_perm' },
    { stageId: 'ignored-without-code-or-name' }
  ]);

  assert.equal(catalog.byCode.get('1-7').stageId, 'main_01-07');
  assert.equal(catalog.byName.get('暴君').stageId, 'main_01-07');
  assert.equal(catalog.byStageId.get('main_01-07#f#').code, '1-7');
  assert.equal(catalog.entries.length, 4);
});

test('derives paradox operators from battle data and Tile-Pos stages', () => {
  const catalog = buildMaaStageCatalog([
    { code: 'mem_12fce_1', name: '生还者', stageId: 'mem_12fce_1' },
    { code: 'mem_other_1', name: '训练成果', stageId: 'mem_other_1' }
  ]);

  const operators = buildMaaParadoxOperators({
    chars: {
      char_009_12fce: { name: '12F' },
      char_002_amiya: { name: '阿米娅' },
      token_10000_silent_healrb: { name: '治疗探针' }
    }
  }, catalog);

  assert.deepEqual(operators, [
    { id: 'char_009_12fce', name: '12F', stage_id: 'mem_12fce_1', stage_name: '生还者' }
  ]);
});

test('loads Tile-Pos stage names and paradox operators from a MaaResource directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'la-pluma-maa-tile-'));
  const itemTablePath = join(root, 'item_table.json');
  await mkdir(join(root, 'Arknights-Tile-Pos'), { recursive: true });
  await Promise.all([
    writeFile(join(root, 'item_index.json'), JSON.stringify({})),
    writeFile(join(root, 'stages.json'), JSON.stringify([])),
    writeFile(join(root, 'battle_data.json'), JSON.stringify({
      chars: { char_009_12fce: { name: '12F' } }
    })),
    writeFile(itemTablePath, JSON.stringify({ items: {} })),
    writeFile(join(root, 'Arknights-Tile-Pos', 'main_01-07.json'), JSON.stringify({
      code: '1-7',
      name: '暴君',
      stageId: 'main_01-07'
    })),
    writeFile(join(root, 'Arknights-Tile-Pos', 'mem_12fce_1.json'), JSON.stringify({
      code: 'mem_12fce_1',
      name: '生还者',
      stageId: 'mem_12fce_1'
    }))
  ]);

  clearMaaResourceCache();
  try {
    const catalog = await loadMaaStageCatalog({ resourceDir: root });
    assert.equal(catalog.byName.get('暴君').stageId, 'main_01-07');
    assert.equal((await findMaaStage('1-7', { resourceDir: root })).name, '暴君');

    const paradox = await getMaaParadoxOperators({ resourceDir: root, itemTablePath });
    assert.deepEqual(paradox, [
      { id: 'char_009_12fce', name: '12F', stage_id: 'mem_12fce_1', stage_name: '生还者' }
    ]);
  } finally {
    clearMaaResourceCache();
    await rm(root, { recursive: true, force: true });
  }
});

test('builds an iconId to item id map for local asset lookup', () => {
  const map = buildMaaItemAssetMap({
    30012: { iconId: 'MTL_SL_G2' },
    4001: { iconId: 'GOLD' },
    9999: { iconId: null }
  });

  assert.equal(map.get('MTL_SL_G2'), '30012');
  assert.equal(map.get('GOLD'), '4001');
  assert.equal(map.size, 2);
});
