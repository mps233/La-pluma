import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEnabledAwardItems, parseAwardExecutionActions } from '../awardResultService.ts';

describe('award execution results', () => {
  it('keeps all six MaaCore Award switches', () => {
    const params = {
      award: true,
      mail: true,
      recruit: true,
      orundum: true,
      mining: true,
      specialaccess: true
    } satisfies Record<string, boolean>;

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

  it('reports the signinevent switch and detects SignInEvent', () => {
    assert.equal(getEnabledAwardItems({ signinevent: true }).length, 1);

    const claimed = parseAwardExecutionActions('领取奖励', { signinevent: true }, [
      'SubTaskStart {"details":{"task":"SignInEvent"},"first":["SignInEvent"]}',
      'SubTaskStart {"details":{"task":"SignInEventAllClaimed"},"first":["SignInEvent"]}'
    ].join('\n'));
    assert.equal(claimed[0].status, 'success');
    assert.match(claimed[0].message, /限时签到奖励已领取/);

    const missing = parseAwardExecutionActions('领取奖励', { signinevent: true }, '');
    assert.equal(missing[0].status, 'skipped');
    assert.match(missing[0].message, /未检测到/);
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
