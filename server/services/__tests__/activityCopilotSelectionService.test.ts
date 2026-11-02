import assert from 'node:assert/strict';
import test from 'node:test';
import {
  averageRatingLevel,
  canRunWithOperators,
  findMissingOperators
} from '../activityCopilotSelectionService.ts';

const owned = new Set(['圣聆初雪', 'Lancet-2', '凛御银灰']);

test('counts missing required operators and missing alternative groups', () => {
  const missing = findMissingOperators({
    opers: [{ name: '圣聆初雪' }, { name: '黑角' }],
    groups: [{ opers: [{ name: '斑点' }, { name: '卡缇' }] }]
  }, owned);

  assert.deepEqual(missing.names, ['黑角']);
  assert.equal(missing.missingGroups, 1);
  assert.equal(missing.count, 2);
});

test('an owned alternative satisfies a group slot', () => {
  const missing = findMissingOperators({
    opers: [{ name: '圣聆初雪' }],
    groups: [{ opers: [{ name: '斑点' }, { name: 'Lancet-2' }] }]
  }, owned);

  assert.deepEqual(missing.names, []);
  assert.equal(missing.missingGroups, 0);
  assert.equal(missing.count, 0);
});

test('does not filter when OperBox is unavailable', () => {
  const missing = findMissingOperators({ opers: [{ name: '不存在的干员' }] }, null);
  assert.equal(missing.unknown, true);
  assert.equal(missing.count, 0);
  assert.equal(canRunWithOperators(missing, {}), true);
});

test('allows exactly one missing operator only when support can fill it', () => {
  const missing = findMissingOperators({ opers: [{ name: '黑角' }] }, owned);
  assert.equal(canRunWithOperators(missing, { allowOneMissingOperator: false, supportUsage: 1 }), false);
  assert.equal(canRunWithOperators(missing, { allowOneMissingOperator: true, supportUsage: 0 }), false);
  assert.equal(canRunWithOperators(missing, { allowOneMissingOperator: true, supportUsage: 1 }), true);
  assert.equal(canRunWithOperators(missing, { allowOneMissingOperator: true, supportUsage: 2, supportName: '黑角' }), true);
  assert.equal(canRunWithOperators(missing, { allowOneMissingOperator: true, supportUsage: 2, supportName: '其他干员' }), false);
});

test('rejects two missing operators even with support enabled', () => {
  const missing = findMissingOperators({ opers: [{ name: '黑角' }, { name: '不存在的干员' }] }, owned);
  assert.equal(missing.count, 2);
  assert.equal(canRunWithOperators(missing, { allowOneMissingOperator: true, supportUsage: 1 }), false);
});

test('averages candidate rating levels', () => {
  assert.equal(averageRatingLevel([{ ratingLevel: 10 }, { ratingLevel: 0 }, { ratingLevel: 5 }]), 5);
  assert.equal(averageRatingLevel([]), 0);
});
