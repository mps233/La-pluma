import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildActivityCopilotRunPlan,
  getCombatCopilotPreferences,
  shouldRefreshActivityNavigation,
  summarizeActivityCompletion
} from '../activityCopilotRunService.js';

const candidatePlan = {
  state: 'candidates-ready',
  preflight: { activity: { code: 'BD', name: '丛林症结' } },
  stages: [
    { stage: 'BD-1', candidates: [{ id: 10, uri: 'maa://10', title: 'BD-1', presetFormation: false }] },
    { stage: 'BD-2', candidates: [{ id: 11, uri: 'maa://11', title: 'BD-2', presetFormation: false }] }
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
  assert.match(plan.reason, /BD-3/);
});

test('saved combat preferences map to the dynamic copilot options', () => {
  const preferences = getCombatCopilotPreferences({
    advancedParams: { copilot: { raid: 'both', loopTimes: '3', useSanityPotion: true, ignoreRequirements: false } },
    autoFormation: { copilot: 'off' }
  });
  assert.deepEqual(preferences, {
    raid: 'both', loopTimes: '3', ignoreRequirements: false, useSanityPotion: true,
    addTrust: false, formationIndex: undefined, supportUsage: undefined, supportName: undefined, formationMode: 'off'
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
