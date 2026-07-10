import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMallExecutionAction } from '../mallResultService.js';

const callback = (type, payload) =>
  `[2026-07-10 20:10:00.000][INF] Assistant::append_callback | ${type} ${JSON.stringify({
    taskchain: 'Mall',
    ...payload
  })}`;

describe('mall execution results', () => {
  it('summarizes visits, collected credit and confirmed purchases', () => {
    const log = [
      callback('SubTaskStart', { details: { task: 'StartToVisit' } }),
      callback('SubTaskStart', { details: { task: 'VisitNext' } }),
      callback('SubTaskStart', { details: { task: 'VisitNextOcr' } }),
      callback('SubTaskStart', { details: { task: 'CollectCredit' } }),
      callback('SubTaskStart', { details: { task: 'CreditShop-Bought', exec_times: 1 } }),
      callback('SubTaskStart', { details: { task: 'CreditShop-Bought', exec_times: 2 } }),
      callback('TaskChainCompleted', { details: {} })
    ].join('\n');

    const action = parseMallExecutionAction('信用收支', {}, log);
    assert.equal(action.status, 'success');
    assert.equal(action.visitedCount, 2);
    assert.equal(action.creditCollected, true);
    assert.equal(action.purchasedCount, 1);
    assert.match(action.message, /访问 2 位好友/);
    assert.match(action.message, /购买 1 件商品/);
  });

  it('treats insufficient credit as a completed outcome', () => {
    const log = [
      callback('SubTaskStart', { class: 'asst::CreditShoppingTask', details: {} }),
      callback('SubTaskError', { class: 'asst::CreditShoppingTask', details: {} }),
      callback('SubTaskStart', { details: { task: 'CreditShop-NoMoney' } }),
      callback('TaskChainCompleted', { details: {} })
    ].join('\n');

    const action = parseMallExecutionAction('信用收支', {}, log);
    assert.equal(action.status, 'success');
    assert.equal(action.noMoney, true);
    assert.match(action.message, /信用不足/);
  });

  it('turns only a task-chain error into an overall failure', () => {
    const log = [
      callback('SubTaskStart', { details: { task: 'Mall' } }),
      callback('SubTaskError', { details: {} }),
      callback('TaskChainError', { details: {} })
    ].join('\n');

    const action = parseMallExecutionAction('信用收支', {}, log);
    assert.equal(action.status, 'failed');
    assert.match(action.message, /处理过程中失败/);
  });

  it('skips a configuration with every Mall operation disabled', () => {
    const action = parseMallExecutionAction('信用收支', {
      visit_friends: false,
      shopping: false,
      credit_fight: false
    });

    assert.equal(action.status, 'skipped');
    assert.match(action.message, /已跳过/);
  });
});
