import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocalDateString, normalizeDropDays } from '../dropRecordService.ts';

test('drop records use the Shanghai calendar date around UTC midnight', () => {
  assert.equal(getLocalDateString(new Date('2026-07-10T16:30:00.000Z'), 'Asia/Shanghai'), '2026-07-11');
  assert.equal(getLocalDateString(new Date('2026-07-10T15:30:00.000Z'), 'Asia/Shanghai'), '2026-07-10');
});

test('clamps drop statistics ranges to a bounded day count', () => {
  assert.equal(normalizeDropDays(undefined, 7), 7);
  assert.equal(normalizeDropDays('abc', 7), 7);
  assert.equal(normalizeDropDays(0), 1);
  assert.equal(normalizeDropDays(-5), 1);
  assert.equal(normalizeDropDays('30'), 30);
  assert.equal(normalizeDropDays(100000), 365);
});
