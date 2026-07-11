import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseCurrentMapFallback, coversActivityStages, rankActivityCopilots } from '../activityCopilotDiscoveryService.js';

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
