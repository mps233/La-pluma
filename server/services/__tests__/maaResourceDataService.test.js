import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildMaaMaterialDatabase,
  buildMaaStageIndex,
  clearMaaResourceCache,
  getMaaItemInfo,
  getMaaMaterialDatabase,
  getMaaStageByCode,
  getMaaStageByStageId,
  loadMaaResourceData
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
