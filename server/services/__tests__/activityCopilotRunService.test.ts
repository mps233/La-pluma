import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildActivityCopilotRunPlan,
  buildActivityPreparationTasks,
  getCombatCopilotPreferences,
  hasCompletedActivityNavigation,
  shouldRefreshActivityNavigation,
  summarizeActivityCompletion
} from '../activityCopilotRunService.ts';

const candidatePlan = {
  state: 'candidates-ready',
  preflight: { activity: { code: 'BD', name: '丛林症结' } },
  stages: [
    { stage: 'BD-1', candidates: [{ id: 10, uri: 'prts://10', title: 'BD-1', presetFormation: false }] },
    { stage: 'BD-2', candidates: [{ id: 11, uri: 'prts://11', title: 'BD-2', presetFormation: false }] }
  ]
};

test('activity run plan selects the top reliable candidate for every known stage in order', () => {
  const plan = buildActivityCopilotRunPlan(candidatePlan, { raid: 'normal' });
  assert.equal(plan.state, 'ready');
  assert.deepEqual(plan.entries.map(entry => [entry.displayStage, entry.copilotId, entry.mode]), [
    ['BD-1', 10, 'normal'],
    ['BD-2', 11, 'normal']
  ]);
});

test('activity run plan refuses to silently omit a known stage', () => {
  const plan = buildActivityCopilotRunPlan({ ...candidatePlan, stages: [...candidatePlan.stages, { stage: 'BD-3', candidates: [] }] }, {});
  assert.equal(plan.state, 'blocked');
  assert.match(plan.reason || '', /BD-3/);
});

test('saved combat preferences map to the dynamic copilot options', () => {
  const preferences = getCombatCopilotPreferences({
    advancedParams: { copilot: { raid: 'both', loopTimes: '3', useSanityPotion: true, ignoreRequirements: false } },
    autoFormation: { copilot: 'off' }
  });
  assert.deepEqual(preferences, {
    raid: 'both', loopTimes: '3', ignoreRequirements: false, useSanityPotion: true,
    addTrust: false, formationIndex: undefined, supportUsage: undefined, supportName: undefined,
    allowOneMissingOperator: true, formationMode: 'off'
  });
});

test('activity completion requires every known main stage', () => {
  const activity = { code: 'BD', stages: ['BD-1', 'BD-2', 'BD-3'] };
  assert.deepEqual(
    summarizeActivityCompletion(activity, { BD: { stages: ['BD-1', 'BD-2'] } }),
    {
      known: true,
      complete: false,
      completedStages: ['BD-1', 'BD-2'],
      totalStages: 3,
      source: 'local-activity-progress'
    }
  );
  assert.equal(
    summarizeActivityCompletion(activity, { BD: { stages: ['BD-1', 'BD-2', 'BD-3'] } }).complete,
    true
  );
});

test('missing navigation resources trigger a throttled resource refresh', () => {
  const preflight = { reasonCode: 'navigation-resource-unavailable', activity: { code: 'BD' } };
  assert.equal(shouldRefreshActivityNavigation(preflight, 0, 24 * 60 * 60 * 1000), true);
  assert.equal(shouldRefreshActivityNavigation(preflight, 10_000, 10_000 + 60_000), false);
  assert.equal(shouldRefreshActivityNavigation({ reasonCode: 'activity-unavailable' }, 0, 24 * 60 * 60 * 1000), false);
});

test('home navigation restarts the game and selects the first known activity stage', () => {
  const tasks = buildActivityPreparationTasks({
    navigationMode: 'home-navigation',
    preflight: {
      navigation: { entryTask: 'BD-OpenOpt' },
      activity: { stages: ['BD-4', 'BD-7'] }
    }
  }, 'Official', 'BD-4');

  assert.deepEqual(tasks, [
    { name: '关闭游戏', type: 'CloseDown', params: { client_type: 'Official' } },
    { name: '启动游戏', type: 'StartUp', params: { client_type: 'Official', start_game_enabled: true } },
    { name: '进入终端', type: 'Custom', params: { task_names: ['Terminal-Entry'] } },
    { name: '等待终端加载', type: 'Custom', params: { task_names: ['SleepThenStop'] } },
    { name: '等待终端加载 2', type: 'Custom', params: { task_names: ['SleepThenStop'] } },
    { name: '选择活动关卡 BD-4', type: 'Custom', params: { task_names: ['BD-4'] } }
  ]);
});

test('home navigation falls back to the generic activity entry for an unknown stage', () => {
  const tasks = buildActivityPreparationTasks({
    navigationMode: 'home-navigation',
    preflight: {
      navigation: { entryTask: 'BD-OpenOpt' },
      activity: { stages: ['BD-4'] }
    }
  }, 'Official', 'BD-9');

  assert.deepEqual(tasks[5], { name: '打开活动页', type: 'Custom', params: { task_names: ['BD-OpenOpt'] } });
});

test('current-map fallback keeps the user on the activity map', () => {
  assert.deepEqual(buildActivityPreparationTasks({
    navigationMode: 'current-map-fallback',
    preflight: { navigation: { entryTask: 'BD-OpenOpt' } }
  }), []);
});

test('missing navigation entry does not start the game without a destination', () => {
  assert.deepEqual(buildActivityPreparationTasks({
    navigationMode: 'home-navigation',
    preflight: { navigation: null }
  }), []);
});

test('activity navigation gate requires the final stage task to complete', () => {
  const log = [
    '[INF] Assistant::append_callback | TaskChainCompleted {"taskchain":"Custom","taskid":3}',
    '[INF] Assistant::append_callback | TaskChainCompleted {"taskchain":"Custom","taskid":4}'
  ].join('\n');
  assert.equal(hasCompletedActivityNavigation(log, 4), true);
  assert.equal(hasCompletedActivityNavigation(log, 5), false);
  assert.equal(hasCompletedActivityNavigation('[INF] TaskChainError {"taskchain":"Custom","taskid":4}', 4), false);
});
