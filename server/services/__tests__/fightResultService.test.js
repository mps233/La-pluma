import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFightExecutionAction, isFightSanityDepleted } from '../fightResultService.js';

describe('fight execution results', () => {
  it('summarizes completed runs and observed drops', () => {
    const action = createFightExecutionAction('理智作战', '1-7', {
      summary: {
        stage: '1-7',
        times: '3',
        drops: '固源岩 × 3, 龙门币 × 360',
        dropItems: [{ name: '固源岩', count: 3 }, { name: '龙门币', count: 360 }]
      },
      output: 'Fight 1-7 3 times'
    });

    assert.equal(action.status, 'success');
    assert.equal(action.times, 3);
    assert.equal(action.dropCount, 2);
    assert.match(action.message, /1-7 × 3/);
  });

  it('marks a zero-run completed command as skipped for depleted sanity', () => {
    const output = '[Fight] Completed\nSummary\nFight 1-7 0 times';
    const action = createFightExecutionAction('理智作战', '1-7', { output });

    assert.equal(isFightSanityDepleted(output, '1-7'), true);
    assert.equal(action.status, 'skipped');
    assert.equal(action.sanityDepleted, true);
  });

  it('keeps completed runs successful when sanity runs out afterward', () => {
    const action = createFightExecutionAction('理智作战', '1-7', {
      summary: { stage: '1-7', times: '2' },
      output: 'Fight 1-7 2 times\nsanity is not enough'
    });

    assert.equal(action.status, 'success');
    assert.equal(action.sanityDepleted, true);
  });

  it('distinguishes unavailable stages from real failures', () => {
    const skipped = createFightExecutionAction('理智作战', 'PR-A-1', {
      error: new Error('stage not open')
    });
    const failed = createFightExecutionAction('理智作战', '1-7', {
      error: new Error('ADB connection lost')
    });

    assert.equal(skipped.status, 'skipped');
    assert.equal(failed.status, 'failed');
  });
});
