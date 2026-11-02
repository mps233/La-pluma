import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecruitExecutionAction } from '../recruitResultService.ts';

const callback = (type: string, payload: Record<string, unknown>) =>
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

  it('reads RecruitPreservedTag.details.tag, RecruitNoPermit and permit-reserved events', () => {
    const preserved = parseRecruitExecutionAction('自动公招', { preserve_tags: ['支援机械'] }, [
      callback('SubTaskExtraInfo', { what: 'RecruitTagsDetected', details: { tags: ['支援机械', '先锋干员'] } }),
      callback('SubTaskExtraInfo', { what: 'RecruitPreservedTag', details: { tag: '支援机械' } }),
      callback('TaskChainCompleted', { details: {} })
    ].join('\n'));
    assert.equal(preserved.status, 'skipped');
    assert.deepEqual(preserved.preservedTags, ['支援机械']);

    const noPermit = parseRecruitExecutionAction('自动公招', {}, [
      callback('SubTaskExtraInfo', { what: 'RecruitNoPermit', details: { continue: false } }),
      callback('TaskChainCompleted', { details: {} })
    ].join('\n'));
    assert.equal(noPermit.status, 'skipped');
    assert.match(noPermit.message, /招聘许可不足/);

    const reserved = parseRecruitExecutionAction('自动公招', {}, [
      callback('SubTaskExtraInfo', { what: 'RecruitPermitReserved', details: { current: 2 } }),
      callback('TaskChainCompleted', { details: {} })
    ].join('\n'));
    assert.equal(reserved.status, 'skipped');
    assert.equal(reserved.permitReserved, true);
    assert.equal(reserved.permitReservedCount, 2);
    assert.match(reserved.message, /招聘许可已保留/);

    const recognitionFailed = parseRecruitExecutionAction('自动公招', {}, [
      callback('SubTaskExtraInfo', { what: 'RecruitPermitCountRecognitionFailed', details: {} }),
      callback('TaskChainCompleted', { details: {} })
    ].join('\n'));
    assert.equal(recognitionFailed.permitCountRecognitionFailed, true);
    assert.match(recognitionFailed.message, /识别失败/);
  });

  it('reports a recruit refresh-limit error as skipped', () => {
    const log = [
      callback('SubTaskExtraInfo', { what: 'RecruitError', details: { refresh_limit: 3 } }),
      callback('TaskChainCompleted', { details: {} })
    ].join('\n');

    const action = parseRecruitExecutionAction('自动公招', {}, log);
    assert.equal(action.status, 'skipped');
    assert.equal(action.refreshLimit, 3);
    assert.match(action.message, /刷新次数已达上限/);
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
