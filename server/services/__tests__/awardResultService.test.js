import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEnabledAwardItems, parseAwardExecutionActions } from '../awardResultService.js';

describe('award execution results', () => {
  it('keeps all six MaaCore Award switches', () => {
    const params = {
      award: true,
      mail: true,
      recruit: true,
      orundum: true,
      mining: true,
      specialaccess: true
    };

    assert.deepEqual(getEnabledAwardItems(params).map(item => item.key), Object.keys(params));
  });

  it('distinguishes claimed and unavailable Award items from MaaCore events', () => {
    const log = [
      'run subtask 1 / 6 {"first":["AwardBegin"],"taskchain":"Award"}',
      'SubTaskStart {"details":{"task":"ReceiveAward"},"first":["AwardBegin"]}',
      'run subtask 2 / 6 {"first":["MailBegin"],"taskchain":"Award"}',
      'SubTaskStart {"details":{"task":"MailWithoutAward"},"first":["MailBegin"]}',
      'run subtask 3 / 6 {"first":["RecruitingActivitiesBegin"],"taskchain":"Award"}'
    ].join('\n');

    const actions = parseAwardExecutionActions('领取奖励', {
      award: true,
      mail: true
    }, log);

    assert.deepEqual(actions.map(action => action.status), ['success', 'skipped']);
    assert.match(actions[0].message, /已领取/);
    assert.match(actions[1].message, /已跳过/);
  });

  it('falls back to a completed check when incremental MaaCore logs are unavailable', () => {
    const actions = parseAwardExecutionActions('领取奖励', { award: true, mail: true }, '');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].status, 'success');
    assert.match(actions[0].message, /共检查 2 项/);
  });

  it('skips execution when no Award item is enabled', () => {
    const actions = parseAwardExecutionActions('领取奖励', {}, '');
    assert.equal(actions[0].status, 'skipped');
  });
});
