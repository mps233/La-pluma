import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCopilotDynamicTaskConfig,
  buildCopilotPlan,
  buildCurrentMapStageTasks,
  buildCopilotRepeatFiles,
  buildCopilotTaskParams,
  buildNativeCopilotCommand,
  canUseNativeCopilotSet,
  createCopilotSetProgressTracker,
  sanitizeCopilotPlanId,
  extractLoadedCopilotFiles,
  findCopilotStageProgress,
  getNavigationStage,
  parseCopilotBattleTotal,
  isPresetFormationCopilot,
  mergePresetFormationTasks,
  orderEntriesForNavigation
} from '../copilotPlanService.ts';

test('maps the latest loaded copilot file to the current activity stage', () => {
  const items = [
    { filename: '/tmp/1-101-normal-1.json', displayStage: 'TL-1' },
    { filename: '/tmp/2-102-normal-1.json', displayStage: 'TL-2' }
  ];
  const log = [
    '{"details":{"file_name":"/tmp/1-101-normal-1.json"},"what":"CopilotListLoadTaskFileSuccess"}',
    '{"details":{"file_name":"/tmp/2-102-normal-1.json"},"what":"CopilotListLoadTaskFileSuccess"}'
  ].join('\n');
  assert.deepEqual(findCopilotStageProgress(items, log), { index: 1, displayStage: 'TL-2' });
  assert.equal(findCopilotStageProgress(items, 'no stage events'), null);
});

test('reads the battle total after the latest copilot stage load', () => {
  const stageLoad = '{"details":{"file_name":"/tmp/2-102-normal-1.json"},"what":"CopilotListLoadTaskFileSuccess"}';
  const log = [
    'Kills: 0 / 22',
    '{"details":{"file_name":"/tmp/1-101-normal-1.json"},"what":"CopilotListLoadTaskFileSuccess"}',
    'Kills: 11 / 35',
    'Kills: 0 / 41',
    stageLoad,
    'Kills: 0 / 52'
  ].join('\n');

  assert.equal(parseCopilotBattleTotal(log), 52);
  assert.equal(parseCopilotBattleTotal('Kills: 0 / 41'), 41);
  assert.equal(parseCopilotBattleTotal('Kills: 0 / 0'), null);
  assert.equal(parseCopilotBattleTotal('no battle lines'), null);
});

test('preparation tasks run before the copilot task in one MAA task file', () => {
  const config = buildCopilotDynamicTaskConfig(
    [
      { name: '启动游戏', type: 'StartUp', params: { start_game_enabled: true } },
      { name: '进入终端', type: 'Custom', params: { task_names: ['Terminal-Entry'] } }
    ],
    { name: '活动作业', type: 'Copilot', params: { copilot_list: [] } }
  );

  assert.deepEqual(config.tasks.map(task => task.name), ['启动游戏', '进入终端', '活动作业']);
  assert.equal(config.tasks[2].type, 'Copilot');
});

test('missing preparation tasks leave the copilot task unchanged', () => {
  const config = buildCopilotDynamicTaskConfig(undefined, { name: '活动作业', type: 'Copilot', params: {} });
  assert.deepEqual(config.tasks, [{ name: '活动作业', type: 'Copilot', params: {} }]);
});

test('puts the stage opened by the preparation task first', () => {
  const entries: Array<{ displayStage: string; mode?: string }> = [
    { displayStage: 'TL-1' },
    { displayStage: 'TL-4' },
    { displayStage: 'tl-4', mode: 'raid' },
    { displayStage: 'TL-9' }
  ];

  assert.deepEqual(
    orderEntriesForNavigation(entries, 'TL-4').map(entry => `${entry.displayStage}:${entry.mode || 'normal'}`),
    ['TL-4:normal', 'tl-4:raid', 'TL-1:normal', 'TL-9:normal']
  );
  assert.deepEqual(orderEntriesForNavigation(entries, ''), entries);
});

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

test('maps user_additional only when auto formation is enabled', () => {
  const params = buildCopilotTaskParams([{ filename: '/tmp/a.json' }], false, {
    formationMode: 'auto',
    userAdditional: '逻各斯:3，维什戴尔:9, , 斑点'
  });
  assert.deepEqual(params.user_additional, [
    { name: '逻各斯', skill: 3 },
    { name: '维什戴尔', skill: 0 },
    { name: '斑点', skill: 0 }
  ]);
  const off = buildCopilotTaskParams([{ filename: '/tmp/a.json' }], false, {
    formationMode: 'off',
    userAdditional: '逻各斯:3'
  });
  assert.equal(off.user_additional, undefined);
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

test('rejects copilot set ids that could escape the plan directory', () => {
  assert.equal(sanitizeCopilotPlanId('48990'), '48990');
  assert.equal(sanitizeCopilotPlanId('set-1_A'), 'set-1_A');
  assert.throws(() => sanitizeCopilotPlanId('../outside'), /不合法/);
  assert.throws(() => sanitizeCopilotPlanId(''), /不合法/);
});

test('delegates only full, non-preset, non-resumed copilot sets', () => {
  const entries: Array<{ key: string; presetFormation: boolean }> = [
    { key: '0:1:normal', presetFormation: false },
    { key: '1:2:normal', presetFormation: false }
  ];

  assert.equal(canUseNativeCopilotSet({ entries }), true);
  assert.equal(canUseNativeCopilotSet({ entries, raid: 'both' }), true);
  assert.equal(canUseNativeCopilotSet({ entries: [entries[0]] }), false);
  assert.equal(canUseNativeCopilotSet({ entries: [entries[0]], formationMode: 'off' }), true);
  assert.equal(canUseNativeCopilotSet({ entries, formationMode: 'off' }), false);
  assert.equal(canUseNativeCopilotSet({ entries, formationMode: 'on' }), true);
  assert.equal(canUseNativeCopilotSet({ entries, userAdditional: [{ name: '史都华德' }] }), false);
  assert.equal(canUseNativeCopilotSet({ entries: [entries[0]], raid: 'raid' }), false);
  assert.equal(canUseNativeCopilotSet({
    entries: [{ ...entries[0], presetFormation: true }]
  }), false);
  assert.equal(canUseNativeCopilotSet({ entries, selectedIndexes: [0] }), false);
  assert.equal(canUseNativeCopilotSet({ entries, selectedIndexes: [0, 1], totalItems: 2 }), true);
  assert.equal(canUseNativeCopilotSet({ entries, selectedIndexes: [0, 0], totalItems: 2 }), false);
  assert.equal(canUseNativeCopilotSet({ entries, selectedIndexes: [0, 2], totalItems: 2 }), false);
  assert.equal(canUseNativeCopilotSet({ entries, loopTimes: 2 }), false);
  assert.equal(canUseNativeCopilotSet({ entries, completedKeys: ['0:1:normal'] }), false);
  assert.equal(canUseNativeCopilotSet({ entries: [] }), false);
});

test('single-item raid=both keeps formation semantics from the set size', () => {
  const entries: Array<{ key: string; itemIndex: number; presetFormation: boolean }> = [
    { key: '0:1:normal', itemIndex: 0, presetFormation: false },
    { key: '0:1:raid', itemIndex: 0, presetFormation: false }
  ];

  assert.equal(canUseNativeCopilotSet({
    entries,
    totalItems: 1,
    selectedIndexes: [0],
    raid: 'both',
    formationMode: 'auto'
  }), false);
  assert.equal(canUseNativeCopilotSet({
    entries,
    totalItems: 1,
    selectedIndexes: [0],
    raid: 'both',
    formationMode: 'off'
  }), true);
  assert.equal(canUseNativeCopilotSet({
    entries,
    totalItems: 1,
    selectedIndexes: [0],
    raid: 'both',
    formationMode: 'on'
  }), true);
});

test('raid both does not turn a full selection into a partial one', () => {
  const expanded: Array<{ key: string; itemIndex: number; presetFormation: boolean }> = [
    { key: '0:1:normal', itemIndex: 0, presetFormation: false },
    { key: '0:1:raid', itemIndex: 0, presetFormation: false },
    { key: '1:2:normal', itemIndex: 1, presetFormation: false },
    { key: '1:2:raid', itemIndex: 1, presetFormation: false }
  ];

  assert.equal(canUseNativeCopilotSet({
    entries: expanded,
    totalItems: 2,
    selectedIndexes: [0, 1],
    raid: 'both'
  }), true);
  assert.equal(canUseNativeCopilotSet({
    entries: expanded,
    totalItems: 2,
    selectedIndexes: [0],
    raid: 'both'
  }), false);
  assert.equal(canUseNativeCopilotSet({
    entries: expanded,
    totalItems: 2,
    selectedIndexes: [0, 1, 2],
    raid: 'both'
  }), false);
});

test('preset formation blocks native delegation even when raid filters its entry', () => {
  // 第三个作业是预设编队，raid 过滤后不会出现在 entries 里，只能靠 hasPresetFormation 拦截。
  const entries: Array<{ key: string; itemIndex: number; presetFormation: boolean }> = [
    { key: '0:1:raid', itemIndex: 0, presetFormation: false },
    { key: '1:2:raid', itemIndex: 1, presetFormation: false }
  ];
  assert.equal(canUseNativeCopilotSet({
    entries,
    totalItems: 3,
    selectedIndexes: [0, 1, 2],
    hasPresetFormation: true,
    raid: 'raid'
  }), false);
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
  assert.deepEqual(buildNativeCopilotCommand(48990, 'normal', {
    formationMode: 'on',
    formationIndex: 3,
    addTrust: true,
    ignoreRequirements: true,
    useSanityPotion: true,
    supportUsage: 2,
    supportName: '史都华德'
  }), [
    'prts://s48990', '--batch', '--formation', '--formation-index', '3',
    '--add-trust', '--ignore-requirements', '--use-sanity-potion',
    '--support-unit-usage', '2', '--support-unit-name', '史都华德'
  ]);
});

test('projects per-entry progress as the set advances', () => {
  const entries = [
    { key: '0:101:normal', itemIndex: 0, copilotId: 101, displayStage: 'TL-1', mode: 'normal' },
    { key: '1:102:normal', itemIndex: 1, copilotId: 102, displayStage: 'TL-2', mode: 'normal' },
    { key: '2:103:normal', itemIndex: 2, copilotId: 103, displayStage: 'TL-3', mode: 'normal' }
  ];
  const tracker = createCopilotSetProgressTracker(entries);
  assert.deepEqual(tracker.snapshot().map(item => item.status), ['pending', 'pending', 'pending']);

  tracker.markRunning(entries[1]);
  assert.deepEqual(tracker.snapshot().map(item => item.status), ['success', 'running', 'pending']);

  tracker.markGroupSuccess([entries[1]]);
  assert.deepEqual(tracker.snapshot().map(item => item.status), ['success', 'success', 'pending']);

  tracker.markRunning(entries[2]);
  tracker.settleRunning('failed', '测试失败');
  assert.deepEqual(tracker.snapshot().map(item => [item.stage, item.status, item.error]), [
    ['TL-1', 'success', undefined],
    ['TL-2', 'success', undefined],
    ['TL-3', 'failed', '测试失败']
  ]);
});

test('both mode skips raid for preset formation stages', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const text = String(input);
    const data = text.includes('/set/get')
      ? { id: 1, name: 'set', copilot_ids: [10, 10, 11] }
      : text.endsWith('/10')
        ? { content: JSON.stringify({ stage_name: 'act_test_01', doc: { title: 'T-1' }, opers: [{ name: 'A' }], groups: [] }) }
        : { content: JSON.stringify({ stage_name: 'act_test_s01', doc: { title: 'T-S-1' }, opers: [], groups: [] }) };
    return new Response(JSON.stringify({ status_code: 200, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
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
