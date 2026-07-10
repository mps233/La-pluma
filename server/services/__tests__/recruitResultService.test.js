import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecruitExecutionAction } from '../recruitResultService.js';

const callback = (type, payload) =>
  `[2026-07-10 19:55:00.000][INF] Assistant::append_callback | ${type} ${JSON.stringify({
    taskchain: 'Recruit',
    ...payload
  })}`;

describe('recruit execution results', () => {
  it('summarizes refreshes, detected tags and started recruitments', () => {
    const log = [
      callback('SubTaskExtraInfo', { what: 'RecruitTagsDetected', details: { tags: ['近卫干员', '输出'] } }),
      callback('SubTaskExtraInfo', { what: 'RecruitTagsRefreshed', details: {} }),
      callback('SubTaskExtraInfo', { what: 'RecruitTagsDetected', details: { tags: ['先锋干员', '费用回复'] } }),
      callback('SubTaskExtraInfo', { what: 'RecruitResult', details: { level: 4, tags: ['先锋干员', '费用回复'] } }),
      callback('SubTaskStart', { details: { task: 'RecruitConfirm' } }),
      callback('TaskChainCompleted', { details: {} })
    ].join('\n');

    const action = parseRecruitExecutionAction('自动公招', {}, log);
    assert.equal(action.status, 'success');
    assert.equal(action.startedCount, 1);
    assert.equal(action.refreshCount, 1);
    assert.equal(action.highestLevel, 4);
    assert.deepEqual(action.finalTags, ['先锋干员', '费用回复']);
    assert.match(action.message, /开始 1 次招募/);
  });

  it('reports preserved tags as a skipped but intentional result', () => {
    const log = [
      callback('SubTaskExtraInfo', { what: 'RecruitTagsDetected', details: { tags: ['支援机械', '先锋干员'] } }),
      callback('SubTaskExtraInfo', { what: 'RecruitPreservedTag', details: { tags: ['支援机械', '先锋干员'] } }),
      callback('TaskChainCompleted', { details: {} })
    ].join('\n');

    const action = parseRecruitExecutionAction('自动公招', { preserve_tags: ['支援机械'] }, log);
    assert.equal(action.status, 'skipped');
    assert.deepEqual(action.preservedTags, ['支援机械']);
    assert.match(action.message, /已保留该槽位/);
  });

  it('turns MaaCore task-chain errors into an explicit failure', () => {
    const log = [
      callback('SubTaskError', { details: {}, subtask: 'AutoRecruitTask' }),
      callback('TaskChainError', { details: {} })
    ].join('\n');

    const action = parseRecruitExecutionAction('自动公招', {}, log);
    assert.equal(action.status, 'failed');
    assert.match(action.message, /未能进入或识别/);
  });

  it('marks an idle completed run as skipped', () => {
    const log = callback('TaskChainCompleted', { details: {} });
    const action = parseRecruitExecutionAction('自动公招', {}, log);
    assert.equal(action.status, 'skipped');
    assert.match(action.message, /没有可处理/);
  });
});
