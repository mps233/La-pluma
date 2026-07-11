import assert from 'node:assert/strict';
import test from 'node:test';
import { assessActivityNavigation } from '../activityNavigationService.js';

const activity = { code: 'BD', name: '丛林症结', source: 'maa' };

test('activity preflight is ready only with a complete home navigation chain', () => {
  const result = assessActivityNavigation(activity, {
    'BD-OpenOpt': { next: ['BD-OpenOcr', 'BD-Open'] },
    'BD-OpenOcr': { next: ['BDChapterToBD'] },
    'BD-Open': { next: ['BDChapterToBD'] },
    'BD-4': { sub: ['BD-OpenOpt'], next: ['BD-4@SideStoryStage'] }
  });

  assert.equal(result.state, 'ready');
  assert.equal(result.canPrepare, true);
  assert.equal(result.canRun, false);
  assert.equal(result.navigation.entryTask, 'BD-OpenOpt');
});

test('activity preflight blocks when fallback activity data lacks MAA navigation', () => {
  const result = assessActivityNavigation(
    { code: 'BD', name: '丛林症结', source: 'penguin', stages: ['BD-4'] },
    { 'BD-4': { next: ['BD-4@SideStoryStage'] } }
  );

  assert.equal(result.state, 'blocked');
  assert.equal(result.reasonCode, 'navigation-incomplete');
  assert.equal(result.canRun, false);
});

test('activity preflight blocks without a current activity', () => {
  const result = assessActivityNavigation({ code: null }, null);
  assert.equal(result.state, 'blocked');
  assert.equal(result.reasonCode, 'activity-unavailable');
});
