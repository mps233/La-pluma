import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachRoguelikeErrorSummary,
  attachRoguelikeResultSummary,
  buildRoguelikeResultSummary,
  isRoguelikeCommand
} from '../roguelikeResultService.ts';
import type { RoguelikeProgressSnapshot } from '../roguelikeProgressService.ts';
import type { RoguelikeBlackFlowProgress } from '../blackFlowProgressService.ts';

function callback(taskchain: string, type: string, payload: Record<string, unknown> = {}): string {
  return `[2026-11-06 09:00:00.000][INF] Assistant::append_callback | ${type} ${JSON.stringify({
    taskchain,
    ...payload
  })}`;
}

function extra(taskchain: string, what: string, details: Record<string, unknown> = {}): string {
  return callback(taskchain, 'SubTaskExtraInfo', { what, details });
}

function progressSnapshot(overrides: Partial<RoguelikeProgressSnapshot> = {}): RoguelikeProgressSnapshot {
  return {
    command: 'roguelike',
    theme: 'Sarkaz',
    mode: 0,
    phase: 'exploring',
    currentRound: 1,
    roundStartedAt: new Date(0).toISOString(),
    targetRounds: 3,
    roundsStarted: 1,
    roundsEnded: 0,
    roundsSettled: 0,
    roundsPassed: 0,
    settlementSupported: true,
    currentAction: 'StartExplore',
    lastEventKind: 'round',
    lastEventName: null,
    lastEventAt: new Date(0).toISOString(),
    combatCount: 0,
    investment: null,
    recentRounds: [],
    blackflow: null,
    updatedAt: new Date(0).toISOString(),
    degraded: false,
    observed: true,
    ...overrides
  };
}

describe('roguelike result summary', () => {
  it('builds a settlement summary from structured callbacks', () => {
    const log = [
      callback('Roguelike', 'TaskChainStart'),
      extra('Roguelike', 'RoguelikeSettlement', {
        game_pass: true,
        floor: 4,
        step: 23,
        combat: 9,
        recruit: 6,
        collection: 12,
        boss: 1,
        emergency: 2,
        difficulty: 12,
        score: 128,
        exp: '45',
        skill: '静默'
      }),
      callback('Roguelike', 'TaskChainCompleted')
    ].join('\n');

    const summary = buildRoguelikeResultSummary(log, { command: 'roguelike', args: ['Mizuki'] });

    assert.equal(summary.command, 'roguelike');
    assert.equal(summary.theme, 'Mizuki');
    assert.equal(summary.status, 'success');
    assert.equal(summary.observed, true);
    assert.equal(summary.settlement?.floor, 4);
    assert.equal(summary.settlement?.step, 23);
    assert.equal(summary.settlement?.score, 128);
    assert.equal(summary.settlement?.gamePass, true);
    assert.equal(summary.settlement?.exp, 45);
    assert.equal(summary.settlement?.skill, '静默');
    assert.match(summary.message, /肉鸽结算/);
    assert.match(summary.message, /第 4 层/);
    assert.match(summary.message, /得分 128/);
  });

  it('keeps settlements with only a failed game result observable', () => {
    const summary = buildRoguelikeResultSummary(
      extra('Roguelike', 'RoguelikeSettlement', { game_pass: false, floor: 2 }),
      { command: 'roguelike', args: ['Sarkaz'] }
    );

    assert.equal(summary.status, 'incomplete');
    assert.equal(summary.settlement?.gamePass, false);
    assert.match(summary.message, /未通关/);
  });

  it('aggregates investment rounds and reach-limit warnings', () => {
    const log = [
      extra('Roguelike', 'RoguelikeInvestment', { count: 2, total: 5, deposit: 433 }),
      extra('Roguelike', 'RoguelikeInvestment', { count: 3, total: 8, deposit: 999 }),
      extra('Roguelike', 'RoguelikeInvestmentReachLimit', { limit: 8 }),
      callback('Roguelike', 'TaskChainCompleted')
    ].join('\n');

    const summary = buildRoguelikeResultSummary(log, { command: 'roguelike', args: ['Phantom'] });

    assert.equal(summary.status, 'success');
    assert.equal(summary.investment?.rounds, 2);
    assert.equal(summary.investment?.count, 5);
    assert.equal(summary.investment?.total, 8);
    assert.equal(summary.investment?.deposit, 999);
    assert.equal(summary.investment?.reachedLimit, true);
    assert.ok(summary.warnings.some(warning => warning.includes('投资上限')));
  });

  it('records events, combat ends, coppers and milestones', () => {
    const log = [
      extra('Roguelike', 'RoguelikeEvent', { name: '不和谐之音' }),
      extra('Roguelike', 'RoguelikeEventSelected', { name: '不和谐之音', option_text: '接受' }),
      extra('Roguelike', 'RoguelikeCombatEnd'),
      extra('Roguelike', 'RoguelikeCombatEnd'),
      extra('Roguelike', 'RoguelikeCoppersExchangeInfo', { to_discard: '小棕', to_pickup: '大棕' }),
      extra('Roguelike', 'DeepExplorationCompleted'),
      extra('Roguelike', 'MonthlySquadCompleted'),
      extra('Roguelike', 'BlackFlowStrategyStarted', { profile: 'balanced' }),
      callback('Roguelike', 'TaskChainCompleted')
    ].join('\n');

    const summary = buildRoguelikeResultSummary(log, { command: 'roguelike', args: ['JieGarden'] });

    assert.deepEqual(summary.events, [{ name: '不和谐之音', option: '接受' }]);
    assert.equal(summary.combats, 2);
    assert.deepEqual(summary.coppers, [{ toDiscard: '小棕', toPickup: '大棕' }]);
    assert.deepEqual(summary.milestones, ['深入调查已完成', '月度小队已完成']);
    assert.equal(summary.strategy?.profile, 'balanced');
  });

  it('records the planned numeric choice when the theme never reports selected text', () => {
    const log = [
      extra('Roguelike', 'RoguelikeEvent', { name: '不和谐之音', default_choose: 2, choose_option: 2 }),
      callback('Roguelike', 'TaskChainCompleted')
    ].join('\n');

    const summary = buildRoguelikeResultSummary(log, { command: 'roguelike', args: ['Sarkaz'] });

    assert.deepEqual(summary.events, [{ name: '不和谐之音', option: '选项 2' }]);
  });

  it('upgrades the planned numeric choice with the selected option text', () => {
    const log = [
      extra('Roguelike', 'RoguelikeEvent', { name: '不和谐之音', choose_option: 2 }),
      extra('Roguelike', 'RoguelikeEventSelected', { name: '不和谐之音', option_text: '接受' }),
      callback('Roguelike', 'TaskChainCompleted')
    ].join('\n');

    const summary = buildRoguelikeResultSummary(log, { command: 'roguelike', args: ['JieGarden'] });

    assert.deepEqual(summary.events, [{ name: '不和谐之音', option: '接受' }]);
  });

  it('keeps the recorded option when a selected event carries no readable text', () => {
    const log = [
      extra('Roguelike', 'RoguelikeEvent', { name: '不和谐之音', choose_option: 2 }),
      extra('Roguelike', 'RoguelikeEventSelected', { name: '不和谐之音', choose_option: null }),
      callback('Roguelike', 'TaskChainCompleted')
    ].join('\n');

    const summary = buildRoguelikeResultSummary(log, { command: 'roguelike', args: ['Sarkaz'] });

    assert.deepEqual(summary.events, [{ name: '不和谐之音', option: '选项 2' }]);
  });

  it('reports task chain failure with the callback error text', () => {
    const log = [
      callback('Roguelike', 'TaskChainStart'),
      callback('Roguelike', 'TaskChainError', { details: { error: 'ResourceLoadFailed' } })
    ].join('\n');

    const summary = buildRoguelikeResultSummary(log, { command: 'roguelike', args: ['Sami'] });

    assert.equal(summary.status, 'failed');
    assert.equal(summary.taskChain.failed, true);
    assert.match(summary.message, /执行失败/);
    assert.match(summary.message, /ResourceLoadFailed/);
  });

  it('reports a stopped task chain without claiming success', () => {
    const summary = buildRoguelikeResultSummary(
      callback('Roguelike', 'TaskChainStopped'),
      { command: 'roguelike', args: ['Sami'] }
    );

    assert.equal(summary.status, 'stopped');
    assert.equal(summary.taskChain.stopped, true);
    assert.match(summary.message, /已停止/);
  });

  it('uses the last observed task chain terminal state', () => {
    const log = [
      callback('Roguelike', 'TaskChainCompleted'),
      callback('Roguelike', 'TaskChainError')
    ].join('\n');

    assert.equal(buildRoguelikeResultSummary(log, { command: 'roguelike', args: ['Mizuki'] }).status, 'failed');
  });

  it('stays incomplete when no callback belongs to the run', () => {
    const summary = buildRoguelikeResultSummary('unrelated log line\n', { command: 'roguelike', args: ['Mizuki'] });

    assert.equal(summary.status, 'incomplete');
    assert.equal(summary.observed, false);
    assert.equal(summary.settlement, null);
    assert.match(summary.message, /无法确认执行结果/);
  });

  it('ignores callbacks from other task chains and malformed lines', () => {
    const log = [
      extra('Reclamation', 'RoguelikeSettlement', { floor: 9 }),
      'Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Roguelike","what"',
      extra('Roguelike', 'RoguelikeSettlement', { floor: 3 }),
      callback('Roguelike', 'TaskChainCompleted')
    ].join('\n');

    const summary = buildRoguelikeResultSummary(log, { command: 'roguelike', args: ['Mizuki'] });

    assert.equal(summary.settlement?.floor, 3);
    assert.equal(summary.status, 'success');
  });

  it('summarizes reclamation through the Reclamation task chain', () => {
    const log = [
      callback('Reclamation', 'TaskChainStart'),
      callback('Reclamation', 'TaskChainCompleted')
    ].join('\n');

    const summary = buildRoguelikeResultSummary(log, { command: 'reclamation', args: ['Tales'] });

    assert.equal(summary.command, 'reclamation');
    assert.equal(summary.theme, 'Tales');
    assert.equal(summary.status, 'success');
    assert.match(summary.message, /生息演算执行完成/);
    assert.equal(summary.settlement, null);
    assert.equal(summary.taskChain.completed, true);
  });

  it('does not treat a Roguelike callback as a reclamation result', () => {
    const summary = buildRoguelikeResultSummary(
      callback('Roguelike', 'TaskChainCompleted'),
      { command: 'reclamation', args: ['Tales'] }
    );

    assert.equal(summary.status, 'incomplete');
    assert.equal(summary.observed, false);
  });

  it('recognizes only the two supported commands', () => {
    assert.equal(isRoguelikeCommand('roguelike'), true);
    assert.equal(isRoguelikeCommand('reclamation'), true);
    assert.equal(isRoguelikeCommand('fight'), false);
    assert.equal(isRoguelikeCommand(undefined), false);
  });

  it('keeps progress null and the legacy fields unchanged without a tracker snapshot', () => {
    const log = [
      extra('Roguelike', 'RoguelikeSettlement', { floor: 2, score: 64 }),
      callback('Roguelike', 'TaskChainCompleted')
    ].join('\n');

    const summary = buildRoguelikeResultSummary(log, { command: 'roguelike', args: ['Mizuki'] });

    assert.equal(summary.progress, null);
    assert.equal(summary.settlement?.floor, 2);
    assert.equal(summary.settlement?.score, 64);
    assert.equal(summary.status, 'success');
  });

  it('writes the final progress snapshot and keeps its observation', () => {
    const progress = progressSnapshot();
    const summary = buildRoguelikeResultSummary('', { command: 'roguelike', args: ['Sarkaz'] }, progress);

    assert.equal(summary.progress, progress);
    assert.equal(summary.observed, true);
    assert.equal(summary.status, 'incomplete');
    assert.equal(summary.settlement, null);
  });

  it('keeps the black flow projection on the final snapshot without changing observation', () => {
    const blackflow: RoguelikeBlackFlowProgress = {
      floor: 2,
      floorAt: new Date(0).toISOString(),
      currentNode: { id: '281475010265088', name: '作战', type: 'battle_normal' },
      currentNodeAt: new Date(0).toISOString(),
      actionPoints: { before: 5, after: 4, at: new Date(0).toISOString() },
      lastRoute: null,
      lastNodeResolution: null,
      milestones: [],
      strategy: null,
      updatedAt: new Date(0).toISOString()
    };
    const progress = progressSnapshot({ blackflow });
    const summary = buildRoguelikeResultSummary('', { command: 'roguelike', args: ['Sarkaz'] }, progress);

    assert.deepEqual(summary.progress?.blackflow, blackflow);
    assert.equal(summary.observed, true);

    const unobserved = buildRoguelikeResultSummary(
      '',
      { command: 'roguelike', args: ['Sarkaz'] },
      progressSnapshot({ observed: false, blackflow })
    );
    assert.equal(unobserved.observed, false);
    assert.deepEqual(unobserved.progress?.blackflow, blackflow);
  });

  it('describes a progress-only incomplete run without claiming no callbacks were read', () => {
    const log = callback('Roguelike', 'SubTaskStart', {
      details: { task: 'StartExplore', exec_times: 1 }
    });
    const observed = buildRoguelikeResultSummary(
      log,
      { command: 'roguelike', args: ['Sarkaz'] },
      progressSnapshot({ observed: true })
    );

    assert.equal(observed.status, 'incomplete');
    assert.equal(observed.settlement, null);
    assert.equal(observed.observed, true);
    assert.equal(observed.message, '已观察到执行进度，但未读取到任务链终态');

    const unobserved = buildRoguelikeResultSummary(log, { command: 'roguelike', args: ['Sarkaz'] });
    assert.equal(unobserved.observed, false);
    assert.equal(unobserved.message, '未读取到任务回调，无法确认执行结果');

    const notObservedProgress = buildRoguelikeResultSummary(
      log,
      { command: 'roguelike', args: ['Sarkaz'] },
      progressSnapshot({ observed: false })
    );
    assert.equal(notObservedProgress.observed, false);
    assert.equal(notObservedProgress.message, '未读取到任务回调，无法确认执行结果');
  });

  it('merges progress observation into an otherwise empty log summary', () => {
    const progress = progressSnapshot({ observed: true });
    const summary = buildRoguelikeResultSummary('unrelated log line\n', { command: 'roguelike', args: ['Sarkaz'] }, progress);
    const result = attachRoguelikeResultSummary({ stdout: '' }, summary);

    assert.equal(summary.observed, true);
    assert.equal((result as { summary?: unknown }).summary, summary);
  });

  it('does not observe a progress snapshot that has not seen any callback', () => {
    const progress = progressSnapshot({ observed: false });
    const summary = buildRoguelikeResultSummary('', { command: 'roguelike', args: ['Sarkaz'] }, progress);
    const result = { stdout: '' };

    assert.equal(summary.observed, false);
    assert.equal(summary.progress, progress);
    assert.equal(attachRoguelikeResultSummary(result, summary), result);
  });
});

describe('roguelike result attachments', () => {
  const summary = buildRoguelikeResultSummary(
    [
      extra('Roguelike', 'RoguelikeSettlement', { floor: 2 }),

      callback('Roguelike', 'TaskChainCompleted')
    ].join('\n'),
    { command: 'roguelike', args: ['Mizuki'] }
  );

  it('attaches the summary to command results', () => {
    const result = attachRoguelikeResultSummary({ stdout: '', command: 'roguelike' }, summary);
    assert.equal((result as { summary?: unknown }).summary, summary);
    assert.equal((result as { stdout?: string }).stdout, '');
  });

  it('wraps non-record results so the summary is not lost', () => {
    const result = attachRoguelikeResultSummary(null, summary);
    assert.deepEqual(result, { summary });
  });

  it('attaches the summary to error details without replacing existing details', () => {
    const error = Object.assign(new Error('执行失败'), { details: { code: 'MAA_FAILED' } });
    const attached = attachRoguelikeErrorSummary(error, summary);

    assert.equal(attached, error);
    assert.equal((error as Error & { details?: Record<string, unknown> }).details?.code, 'MAA_FAILED');
    assert.equal((error as Error & { details?: Record<string, unknown> }).details?.summary, summary);
  });

  it('keeps results untouched when no callback was observed', () => {
    const empty = buildRoguelikeResultSummary('', { command: 'roguelike', args: ['Mizuki'] });
    const result = { stdout: 'x' };
    assert.equal(attachRoguelikeResultSummary(result, empty), result);

    const error = new Error('失败');
    assert.equal(attachRoguelikeErrorSummary(error, empty), error);
  });
});
