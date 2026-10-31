import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTaskSummary } from '../schedulerService.js';

test('parses the maa-cli 0.7.x Fight summary', () => {
  const output = `Summary
----------------------------------------
[Fight] 13:35:39 - 13:37:17 (1m 38s) Completed
Fight 1-7 1 times, used 2 medicine, used 1 stone, drops:
1. 固源岩 × 2, 基础作战记录 × 1
total drops: 固源岩 × 2, 基础作战记录 × 1`;

  const summary = parseTaskSummary('理智作战', output);
  assert.equal(summary.stage, '1-7');
  assert.equal(summary.times, '1');
  assert.equal(summary.medicine, '2');
  assert.equal(summary.stone, '1');
  assert.equal(summary.duration, '1m 38s');
  assert.deepEqual(summary.dropItems, [
    { name: '固源岩', count: 2 },
    { name: '基础作战记录', count: 1 }
  ]);
});

test('parses the Detected tags recruit summary', () => {
  const output = `Summary
----------------------------------------
[Recruit] 13:00:00 - 13:01:00 (1m) Completed
Detected tags:
1. ★★★★ 近战位, 输出, Recruited
2. ★★★ 远程位, 治疗
Recruited 1 times
Refreshed 2 times`;

  const summary = parseTaskSummary('自动公招', output);
  assert.deepEqual(summary.recruits, [
    { stars: 4, tags: ['近战位', '输出'], state: 'Recruited' },
    { stars: 3, tags: ['远程位', '治疗'], state: null }
  ]);
  assert.equal(summary.recruitCount, 1);
  assert.equal(summary.refreshCount, 2);
});

test('parses the facility detail lines in an Infrast summary', () => {
  const output = `Summary
----------------------------------------
[Infrast] 13:00:00 - 13:01:00 (1m) Completed
Mfg(Room 1) with operators: 芬, 克洛丝
Trade(Room 2) with operators: 德克萨斯`;

  const summary = parseTaskSummary('基建换班', output);
  assert.match(summary.infrast, /Mfg\(Room 1\)/);
  assert.match(summary.infrast, /Trade\(Room 2\)/);
});

test('returns null when the output has no recognizable summary', () => {
  assert.equal(parseTaskSummary('仓库识别', 'ordinary output'), null);
});
