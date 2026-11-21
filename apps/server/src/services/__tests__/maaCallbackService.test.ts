import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCallbackDetails,
  getCallbackStringField,
  getCallbackStringList,
  getCallbackTaskName,
  getStartedTaskNames,
  parseMaaCallbackEvents
} from '../maaCallbackService.ts';

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

  it('skips payloads that are not target-taskchain objects', () => {
    const log = [
      '[INF] Assistant::append_callback | SubTaskStart null',
      '[INF] Assistant::append_callback | SubTaskStart []',
      '[INF] Assistant::append_callback | SubTaskStart "Recruit"',
      '[INF] Assistant::append_callback | SubTaskStart {"taskchain":42}',
      '[INF] Assistant::append_callback | SubTaskStart {"details":{"task":"RecruitConfirm"}}',
      '[INF] Assistant::append_callback | TaskChainCompleted {"taskchain":"Recruit"}'
    ].join('\n');

    assert.deepEqual(
      parseMaaCallbackEvents(log, 'Recruit').map(event => event.callback),
      ['TaskChainCompleted']
    );
  });

  it('keeps unknown payload fields and the logged callback name', () => {
    const log = [
      '[INF] Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Recruit","callback":"PayloadName",',
      '  "what":"RecruitTagsDetected","class":"asst::RecruitTask","details":{"tags":["先锋干员"],"extra":{"attempt":1}}}'
    ].join('');

    const [event] = parseMaaCallbackEvents(log, 'Recruit');
    assert.equal(event.callback, 'SubTaskExtraInfo');
    assert.equal(getCallbackStringField(event, 'class'), 'asst::RecruitTask');
    assert.deepEqual(getCallbackDetails(event)?.extra, { attempt: 1 });
    assert.deepEqual(getCallbackStringList(event, 'tags'), ['先锋干员']);
  });

  it('returns no events for empty or missing logs', () => {
    assert.deepEqual(parseMaaCallbackEvents('', 'Recruit'), []);
    assert.deepEqual(parseMaaCallbackEvents(undefined, 'Recruit'), []);
    assert.deepEqual(parseMaaCallbackEvents(null, 'Recruit'), []);
  });
});

describe('Maa callback timestamps', () => {
  it('attaches local epoch milliseconds from a complete line timestamp', () => {
    const log = '[2026-11-06 09:00:00.123][INF][Px1][Tx2] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit","details":{}}';

    const [event] = parseMaaCallbackEvents(log, 'Recruit');

    assert.equal(event.atMs, new Date(2026, 10, 6, 9, 0, 0, 123).getTime());
  });

  it('keeps the event shape unchanged without a timestamp', () => {
    const log = '[INF] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit","details":{}}';

    const [event] = parseMaaCallbackEvents(log, 'Recruit');

    assert.deepEqual(event, {
      taskchain: 'Recruit',
      details: {},
      callback: 'SubTaskStart'
    });
    assert.equal('atMs' in event, false);
  });

  it('ignores invalid, incomplete, or unprefixed timestamps', () => {
    const lines = [
      '[2026-02-30 09:00:00.000][INF] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit","details":{}}',
      '[2026-13-01 09:00:00.000][INF] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit","details":{}}',
      '[2026-11-06 25:00:00.000][INF] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit","details":{}}',
      '[2026-11-06 09:00:00.00][INF] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit","details":{}}',
      '[INF] [2026-11-06 09:00:00.000] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit","details":{}}'
    ];

    const events = parseMaaCallbackEvents(lines.join('\n'), 'Recruit');

    assert.equal(events.length, lines.length);
    for (const event of events) {
      assert.equal('atMs' in event, false);
    }
  });
});

describe('Maa callback accessors', () => {
  it('treats missing or mistyped fields as absent', () => {
    const [event] = parseMaaCallbackEvents(
      '[INF] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit","details":{"task":42,"tags":"先锋干员"}}',
      'Recruit'
    );

    assert.equal(getCallbackTaskName(event), undefined);
    assert.deepEqual(getCallbackStringList(event, 'tags'), []);
    assert.deepEqual(getStartedTaskNames([event]), []);
  });

  it('ignores non-object details and keeps string task names in order', () => {
    const log = [
      '[INF] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit","details":[]}',
      '[INF] Assistant::append_callback | SubTaskStart {"taskchain":"Recruit","details":{"task":"RecruitConfirm"}}',
      '[INF] Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Recruit","what":"RecruitTagsDetected"}'
    ].join('\n');

    const events = parseMaaCallbackEvents(log, 'Recruit');
    assert.equal(getCallbackDetails(events[0]), undefined);
    assert.deepEqual(getStartedTaskNames(events), ['RecruitConfirm']);
  });

  it('filters non-string tag entries', () => {
    const [event] = parseMaaCallbackEvents(
      '[INF] Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Recruit","details":{"tags":["先锋干员",3,null]}}',
      'Recruit'
    );

    assert.deepEqual(getCallbackStringList(event, 'tags'), ['先锋干员']);
  });
});
