import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocalDateString } from '../dropRecordService.js';

test('drop records use the Shanghai calendar date around UTC midnight', () => {
  assert.equal(getLocalDateString(new Date('2026-07-10T16:30:00.000Z'), 'Asia/Shanghai'), '2026-07-11');
  assert.equal(getLocalDateString(new Date('2026-07-10T15:30:00.000Z'), 'Asia/Shanghai'), '2026-07-10');
});
