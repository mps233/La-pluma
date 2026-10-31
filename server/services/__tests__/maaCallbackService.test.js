import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMaaCallbackEvents, summarizeFightCallbacks } from '../maaCallbackService.js';

describe('Maa callback parsing', () => {
  it('parses matching callbacks from structured payloads regardless of JSON spacing', () => {
    const log = [
      '[INF] Assistant::append_callback | SubTaskStart { "taskchain": "Recruit", "details": { "task": "RecruitConfirm" } }',
      '[INF] Assistant::append_callback | TaskChainCompleted {"taskchain":"Recruit","details":{}}'
    ].join('\n');

    assert.deepEqual(parseMaaCallbackEvents(log, 'Recruit'), [
      {
        taskchain: 'Recruit',
        details: { task: 'RecruitConfirm' },
        callback: 'SubTaskStart'
      },
      {
        taskchain: 'Recruit',
        details: {},
        callback: 'TaskChainCompleted'
      }
    ]);
  });

  it('ignores callbacks for other task chains and unrelated log lines', () => {
    const log = [
      '[INF] ordinary log line',
      '[INF] Assistant::append_callback | SubTaskStart {"taskchain":"Mall","details":{}}',
      '[INF] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit","details":{}}'
    ].join('\n');

    const events = parseMaaCallbackEvents(log, 'Recruit');
    assert.equal(events.length, 1);
    assert.equal(events[0].taskchain, 'Recruit');
  });

  it('summarizes StageDrops with addQuantity and FightTimes sanity cost', () => {
    const log = [
      '[INF] Assistant::append_callback | SubTaskExtraInfo ' + JSON.stringify({
        what: 'StageDrops',
        taskchain: 'Fight',
        details: {
          stage: { stageCode: '1-7', stageId: 'main_01-07' },
          stats: [
            { addQuantity: 2, itemId: '30012', itemName: '固源岩', quantity: 2 },
            { addQuantity: 1, itemId: '30041', itemName: '异铁碎片', quantity: 1 },
            { addQuantity: 72, itemId: '4001', itemName: '龙门币', quantity: 72 }
          ]
        }
      }),
      '[INF] Assistant::append_callback | SubTaskExtraInfo ' + JSON.stringify({
        what: 'FightTimes',
        taskchain: 'Fight',
        details: { sanity_cost: 6, series: 1, times_finished: 0 }
      })
    ].join('\n');

    const summary = summarizeFightCallbacks(log);
    assert.equal(summary.stage, '1-7');
    assert.equal(summary.sanityUsed, 6);
    assert.deepEqual(summary.items, [
      { itemId: '30012', name: '固源岩', count: 2 },
      { itemId: '30041', name: '异铁碎片', count: 1 },
      { itemId: '4001', name: '龙门币', count: 72 }
    ]);
  });

  it('falls back to SanityBeforeStage when FightTimes is absent', () => {
    const log = [
      '[INF] Assistant::append_callback | SubTaskExtraInfo ' + JSON.stringify({
        what: 'SanityBeforeStage',
        taskchain: 'Fight',
        details: { current_sanity: 45, max_sanity: 210 }
      }),
      '[INF] Assistant::append_callback | SubTaskExtraInfo ' + JSON.stringify({
        what: 'SanityBeforeStage',
        taskchain: 'Fight',
        details: { current_sanity: 39, max_sanity: 210 }
      })
    ].join('\n');

    const summary = summarizeFightCallbacks(log);
    assert.equal(summary.sanityUsed, 6);
  });

  it('skips incomplete and malformed callback lines from incremental logs', () => {
    const log = [
      '[INF] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit"',
      '[INF] Assistant::append_callback | SubTaskStart not-json',
      '[INF] Assistant::append_callback | TaskChainCompleted {"taskchain":"Recruit"}'
    ].join('\n');

    assert.deepEqual(parseMaaCallbackEvents(log, 'Recruit'), [{
      taskchain: 'Recruit',
      callback: 'TaskChainCompleted'
    }]);
  });
});
