import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canUseCurrentMapFallback,
  coversActivityStages,
  rankActivityCopilots,
  scoreCopilotSetMembers
} from '../activityCopilotDiscoveryService.ts';

test('activity candidate ranking keeps only exact current-stage titles', () => {
  const candidates = rankActivityCopilots([
    { id: 1, rating_level: 10, rating_ratio: 1, upload_time: '2026-07-10T10:00:00', content: JSON.stringify({ doc: { title: 'BD-4 高配' } }) },
    { id: 2, rating_level: 9, rating_ratio: 1, upload_time: '2026-07-11T10:00:00', content: JSON.stringify({ doc: { title: 'BD-4 低配' } }) },
    { id: 3, rating_level: 10, rating_ratio: 1, upload_time: '2026-07-12T10:00:00', content: JSON.stringify({ doc: { title: 'BD-5 高配' } }) },
    { id: 4, rating_level: 10, rating_ratio: 1, upload_time: '2026-07-12T10:00:00', content: JSON.stringify({ doc: { title: 'BD-40 高配' } }) }
  ], 'BD-4');

  assert.deepEqual(candidates.map(candidate => candidate.id), [1, 2]);
  assert.ok(candidates.every(candidate => candidate.stage === 'BD-4'));
});

test('activity candidate filtering allows one missing operator only with support fill', () => {
  const items = [
    { id: 21, rating_level: 10, content: JSON.stringify({ doc: { title: 'BD-4 单核' }, opers: [{ name: '黑角' }] }) },
    { id: 22, rating_level: 10, content: JSON.stringify({ doc: { title: 'BD-4 双核' }, opers: [{ name: '黑角' }, { name: '斑点' }] }) },
    { id: 23, rating_level: 10, content: JSON.stringify({ doc: { title: 'BD-4 齐全' }, opers: [{ name: '圣聆初雪' }] }) }
  ];
  const ownedOperators = new Set(['圣聆初雪']);
  const withoutSupport = rankActivityCopilots(items, 'BD-4', {
    ownedOperators,
    preferences: { allowOneMissingOperator: true, supportUsage: 0 }
  });
  assert.deepEqual(withoutSupport.map(candidate => candidate.id), [23]);

  const withSupport = rankActivityCopilots(items, 'BD-4', {
    ownedOperators,
    preferences: { allowOneMissingOperator: true, supportUsage: 1 }
  });
  assert.deepEqual(withSupport.map(candidate => candidate.id), [21, 23]);
  assert.equal(withSupport[0].missingOperators[0], '黑角');
  assert.equal(withSupport[0].requiresSupport, true);
});

test('activity set rating ignores optional stages and counts unrated main stages', () => {
  const score = scoreCopilotSetMembers([
    { stage: 'BD-1', ratingLevel: 10, ratingRatio: 1 },
    { stage: 'BD-2', ratingLevel: 0, ratingRatio: 0 },
    { stage: null, ratingLevel: 10, ratingRatio: 1 }
  ]);
  assert.equal(score.ratingScore, 5);
  assert.equal(score.ratingRatio, 0.5);
  assert.equal(score.unratedMainStages, 1);
});

test('activity candidate marks preset formations so raid planning can reject them', () => {
  const [candidate] = rankActivityCopilots([{
    id: 12,
    rating_level: 10,
    content: JSON.stringify({ stage_name: 'act21mini_s01', doc: { title: 'BD-1' }, opers: [], groups: [] })
  }], 'BD-1');
  assert.equal(candidate.presetFormation, true);
});

test('activity set may include optional same-event stages while covering all main stages', () => {
  const mainStages = ['BD-1', 'BD-2', 'BD-3'];
  assert.equal(coversActivityStages([
    { doc: { title: 'BD-1' } },
    { doc: { title: 'BD-2' } },
    { doc: { title: 'BD-3' } },
    { doc: { title: 'BD-S-1' } }
  ], 'BD', mainStages), true);

  assert.equal(coversActivityStages([
    { doc: { title: '时间啊，向前！ - TL-1 - 庸俗的实践' } },
    { doc: { title: '时间啊，向前！ - TL-2 - 孑遗的道路' } },
    { doc: { title: '时间啊，向前！ - TL-3 - 苦难的历程' } },
    { doc: { title: '【时间啊，向前！】TL-S-1 - 突袭' } }
  ], 'TL', ['TL-1', 'TL-2', 'TL-3']), true);

  assert.equal(coversActivityStages([
    { doc: { title: 'BD-1' } },
    { doc: { title: 'BD-2' } },
    { doc: { title: 'BD-3' } },
    { doc: { title: 'CV-1' } }
  ], 'BD', mainStages), false);
});

test('current-map fallback requires a recognized activity with explicit stages', () => {
  assert.equal(canUseCurrentMapFallback({
    state: 'blocked', reasonCode: 'navigation-resource-unavailable', activity: { code: 'BD', stages: ['BD-1'] }
  }), true);
  assert.equal(canUseCurrentMapFallback({
    state: 'blocked', reasonCode: 'activity-unavailable', activity: { code: 'BD', stages: ['BD-1'] }
  }), false);
});
