import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseInfrastExecutionAction } from '../infrastResultService.js';

const callback = (type, payload) =>
  `[2026-07-10 20:00:00.000][INF] Assistant::append_callback | ${type} ${JSON.stringify({
    taskchain: 'Infrast',
    ...payload
  })}`;

describe('infrast execution results', () => {
  it('summarizes only operations observed in MaaCore callbacks', () => {
    const log = [
      callback('SubTaskStart', { class: 'asst::InfrastMfgTask', details: {} }),
      callback('SubTaskStart', { details: { task: 'InfrastReward' } }),
      callback('SubTaskStart', { details: { task: 'InfrastConfirmButton' } }),
      callback('SubTaskStart', { details: { task: 'DroneConfirm' } }),
      callback('TaskChainCompleted', { details: {} })
    ].join('\n');

    const action = parseInfrastExecutionAction('基建换班', { facility: ['Mfg', 'Trade'] }, log);
    assert.equal(action.status, 'success');
    assert.deepEqual(action.observedFacilities, ['Mfg']);
    assert.equal(action.rewardCollected, true);
    assert.equal(action.rotationApplied, true);
    assert.equal(action.droneUsed, true);
    assert.match(action.message, /已收取产物/);
  });

  it('does not invent facility details when only completion is observable', () => {
    const log = callback('TaskChainCompleted', { details: {} });
    const action = parseInfrastExecutionAction('基建换班', { facility: ['Mfg', 'Trade'] }, log);
    assert.equal(action.status, 'success');
    assert.deepEqual(action.observedFacilities, []);
    assert.match(action.message, /按配置处理 2 类设施/);
  });

  it('reports entry recognition failures explicitly', () => {
    const log = [
      callback('SubTaskStart', { details: { task: 'InfrastBegin' } }),
      callback('SubTaskError', { details: {} }),
      callback('TaskChainError', { details: {} })
    ].join('\n');

    const action = parseInfrastExecutionAction('基建换班', { facility: ['Mfg'] }, log);
    assert.equal(action.status, 'failed');
    assert.match(action.message, /未能进入或识别/);
  });

  it('skips an empty facility selection', () => {
    const action = parseInfrastExecutionAction('基建换班', { facility: [] }, '');
    assert.equal(action.status, 'skipped');
  });
});
