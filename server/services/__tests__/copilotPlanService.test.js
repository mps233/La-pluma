import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCopilotPlan,
  buildCurrentMapStageTasks,
  buildCopilotRepeatFiles,
  buildCopilotTaskParams,
  buildNativeCopilotCommand,
  canUseNativeCopilotSet,
  extractLoadedCopilotFiles,
  getNavigationStage,
  isPresetFormationCopilot,
  mergePresetFormationTasks
} from '../copilotPlanService.js';

test('preset formation stages are normal-only candidates', () => {
  assert.equal(isPresetFormationCopilot({
    stage_name: 'act21mini_s01',
    opers: [],
    groups: []
  }), true);
  assert.equal(isPresetFormationCopilot({
    stage_name: 'act21mini_04',
    opers: [{ name: '德克萨斯' }],
    groups: []
  }), false);
});

test('current map resource maps stages directly to OCR without navigation tasks', () => {
  assert.deepEqual(buildCurrentMapStageTasks(['bd-1', 'BD-2', 'BD-1']), {
    'BD-1': { text: ['BD-1'] },
    'BD-2': { text: ['BD-2'] }
  });
});

test('navigation uses the visible stage code instead of the internal stage id', () => {
  assert.equal(getNavigationStage({ stage_name: 'act21mini_04', doc: { title: 'BD-4 低配挂机' } }), 'BD-4');
  assert.equal(getNavigationStage({ stage_name: 'main_01-07', doc: { title: '1-7' } }), '1-7');
});

test('native copilot plans keep all advanced execution options', () => {
  const params = buildCopilotTaskParams([{ filename: '/tmp/a.json' }], false, {
    formationMode: 'off',
    ignoreRequirements: false,
    useSanityPotion: true,
    addTrust: true,
    formationIndex: '3',
    supportUsage: '2',
    supportName: '逻各斯'
  });
  assert.deepEqual(params, {
    copilot_list: [{ filename: '/tmp/a.json' }],
    formation: false,
    ignore_requirements: false,
    use_sanity_potion: true,
    add_trust: true,
    formation_index: 3,
    support_unit_usage: 2,
    support_unit_name: '逻各斯'
  });
});

test('multi-copilot loop count expands into repeated native entries', () => {
  const files = buildCopilotRepeatFiles({ itemIndex: 2, copilotId: 99, mode: 'raid' }, 3, '/tmp/plan');
  assert.equal(files.length, 3);
  assert.ok(files[0].filename.endsWith('2-99-raid-1.json'));
  assert.ok(files[2].filename.endsWith('2-99-raid-3.json'));
});

test('copilot recovery finds MAA loaded files in callback field order', () => {
  const log = '{"details":{"file_name":"/tmp/6-97353-normal-1.json"},"what":"CopilotListLoadTaskFileSuccess"}';
  assert.deepEqual(extractLoadedCopilotFiles(log), ['/tmp/6-97353-normal-1.json']);
});

test('preset resource merge preserves existing user BattleStart settings', () => {
  const merged = mergePresetFormationTasks(
    { BattleStart: { roi: [1, 2, 3, 4], postDelay: 1000 } },
    { BattleStart: { postDelay: 4321, custom: true }, ExistingTask: { action: 'DoNothing' } }
  );
  assert.equal(merged.BattleStart.postDelay, 4321);
  assert.equal(merged.BattleStart.custom, true);
  assert.deepEqual(merged.ExistingTask, { action: 'DoNothing' });
  assert.ok(merged.BattleStart.next.includes('LaPlumaPresetBattleConfirm'));
});

test('delegates only full, non-preset, non-resumed copilot sets', () => {
  const entries = [{ key: '0:1:normal', presetFormation: false }, { key: '1:2:normal', presetFormation: false }];

  assert.equal(canUseNativeCopilotSet({ entries }), true);
  assert.equal(canUseNativeCopilotSet({ entries, raid: 'both' }), true);
  assert.equal(canUseNativeCopilotSet({ entries: [entries[0]] }), true);
  assert.equal(canUseNativeCopilotSet({ entries: [entries[0]], raid: 'raid' }), false);
  assert.equal(canUseNativeCopilotSet({
    entries: [{ ...entries[0], presetFormation: true }]
  }), false);
  assert.equal(canUseNativeCopilotSet({ entries, selectedIndexes: [0] }), false);
  assert.equal(canUseNativeCopilotSet({ entries, selectedIndexes: [0, 1], totalEntries: 2 }), true);
  assert.equal(canUseNativeCopilotSet({ entries, loopTimes: 2 }), false);
  assert.equal(canUseNativeCopilotSet({ entries, completedKeys: ['0:1:normal'] }), false);
  assert.equal(canUseNativeCopilotSet({ entries: [] }), false);
});

test('builds the native maa copilot command', () => {
  assert.deepEqual(buildNativeCopilotCommand(48990, 'normal'), [
    'prts://s48990', '--batch'
  ]);
  assert.deepEqual(buildNativeCopilotCommand(48990, 'both', {
    profile: 'daily',
    address: '127.0.0.1:16384',
    userResource: true
  }), [
    'prts://s48990', '--batch', '--raid', 'both', '--user-resource',
    '-p', 'daily', '-a', '127.0.0.1:16384'
  ]);
});

test('both mode skips raid for preset formation stages', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const text = String(url);
    const data = text.includes('/set/get')
      ? { id: 1, name: 'set', copilot_ids: [10, 10, 11] }
      : text.endsWith('/10')
        ? { content: JSON.stringify({ stage_name: 'act_test_01', doc: { title: 'T-1' }, opers: [{ name: 'A' }], groups: [] }) }
        : { content: JSON.stringify({ stage_name: 'act_test_s01', doc: { title: 'T-S-1' }, opers: [], groups: [] }) };
    return { ok: true, json: async () => ({ status_code: 200, data }) };
  };
  try {
    const plan = await buildCopilotPlan('1', 'both');
    assert.deepEqual(plan.entries.map(entry => entry.key), [
      '0:10:normal', '0:10:raid',
      '1:10:normal', '1:10:raid',
      '2:11:normal'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
