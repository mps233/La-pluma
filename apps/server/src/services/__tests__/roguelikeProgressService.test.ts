import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMaaCallbackEvents } from '../maaCallbackService.ts';
import type { MaaCallbackEvent } from '../maaCallbackService.ts';
import {
  readRoguelikeEvent,
  readRoguelikeInvestment,
  readRoguelikeSettlement,
  readRoguelikeTaskName
} from '../roguelikeCallbackReaders.ts';
import {
  applyRoguelikeProgressEvents,
  buildRoguelikeProgressSnapshot,
  createRoguelikeProgressState,
  markRoguelikeProgressDegraded
} from '../roguelikeProgressService.ts';
import type { RoguelikeProgressSeed } from '../roguelikeProgressService.ts';

const BASE_TIME = new Date(2026, 10, 4, 1, 35, 30, 0).getTime();
const SETTLEMENT_ONE_TIME = new Date(2026, 10, 4, 1, 35, 42, 0).getTime();
const SETTLEMENT_TWO_TIME = new Date(2026, 10, 4, 1, 36, 0, 0).getTime();
const STOPPED_TIME = new Date(2026, 10, 4, 1, 36, 30, 0).getTime();

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function formatTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  return `[${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)} ${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}]`;
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function callback(
  type: string,
  payload: Record<string, unknown> = {},
  atMs: number | null = BASE_TIME,
  taskchain = 'Roguelike'
): string {
  const prefix = atMs === null ? '[INF]' : formatTimestamp(atMs);
  return `${prefix} Assistant::append_callback | ${type} ${JSON.stringify({ taskchain, ...payload })}`;
}

function subtaskStart(
  task: string,
  details: Record<string, unknown> = {},
  atMs: number | null = BASE_TIME,
  taskchain = 'Roguelike'
): string {
  return callback('SubTaskStart', { details: { task, ...details } }, atMs, taskchain);
}

function extra(
  what: string,
  details: Record<string, unknown> = {},
  atMs: number | null = BASE_TIME,
  taskchain = 'Roguelike'
): string {
  return callback('SubTaskExtraInfo', { what, details }, atMs, taskchain);
}

function event(
  type: string,
  payload: Record<string, unknown> = {},
  taskchain = 'Roguelike'
): MaaCallbackEvent {
  return { callback: type, taskchain, ...payload };
}

function seed(overrides: Partial<RoguelikeProgressSeed> = {}): RoguelikeProgressSeed {
  return {
    command: 'roguelike',
    theme: 'JieGarden',
    mode: null,
    targetRounds: null,
    settlementSupported: null,
    startedAtMs: BASE_TIME,
    ...overrides
  };
}

function snapshotFor(
  lines: readonly string[],
  overrides: Partial<RoguelikeProgressSeed> = {},
  taskchain = 'Roguelike',
  nowMs?: number
) {
  const events = parseMaaCallbackEvents(lines.join('\n'), taskchain);
  const state = applyRoguelikeProgressEvents(createRoguelikeProgressState(seed(overrides)), events);
  return buildRoguelikeProgressSnapshot(state, nowMs);
}

function snapshotForLog(
  log: string,
  overrides: Partial<RoguelikeProgressSeed> = {},
  taskchain = 'Roguelike'
) {
  const events = parseMaaCallbackEvents(log, taskchain);
  const state = applyRoguelikeProgressEvents(createRoguelikeProgressState(seed(overrides)), events);
  return buildRoguelikeProgressSnapshot(state);
}

describe('roguelike callback readers', () => {
  it('normalizes task names after the last theme prefix', () => {
    assert.equal(
      readRoguelikeTaskName(event('SubTaskStart', { details: { task: 'JieGarden@Roguelike@StartExplore' } })),
      'StartExplore'
    );
    assert.equal(
      readRoguelikeTaskName(event('SubTaskStart', { details: { task: 'StartExplore' } })),
      'StartExplore'
    );
    assert.equal(
      readRoguelikeTaskName(event('SubTaskStart', { details: { task: 'JieGarden@Roguelike@' } })),
      null
    );
    assert.equal(readRoguelikeTaskName(event('SubTaskStart', { details: { task: 42 } })), null);
  });

  it('maps settlement fields without coercing invalid values', () => {
    const settlement = readRoguelikeSettlement(event('SubTaskExtraInfo', {
      what: 'RoguelikeSettlement',
      details: {
        game_pass: true,
        floor: 3,
        step: '18',
        combat: 3,
        recruit: 4,
        collection: 1,
        boss: 0,
        emergency: 0,
        difficulty: 1,
        score: 221,
        exp: '+243',
        skill: '+2'
      }
    }));

    assert.deepEqual(settlement, {
      gamePass: true,
      floor: 3,
      step: null,
      combat: 3,
      recruit: 4,
      collection: 1,
      boss: 0,
      emergency: 0,
      difficulty: 1,
      score: 221,
      exp: 243,
      skill: '+2'
    });
  });

  it('returns null for non-settlement callbacks and empty settlement payloads', () => {
    assert.equal(
      readRoguelikeSettlement(event('SubTaskExtraInfo', {
        what: 'RoguelikeEvent',
        details: { name: '祠堂口' }
      })),
      null
    );
    assert.equal(
      readRoguelikeSettlement(event('SubTaskExtraInfo', {
        what: 'RoguelikeSettlement',
        details: {}
      })),
      null
    );
  });

  it('reads event names and selected options', () => {
    assert.deepEqual(
      readRoguelikeEvent(event('SubTaskExtraInfo', {
        what: 'RoguelikeEvent',
        details: { name: '祠堂口', choose_option: 2, default_choose: 2 }
      })),
      { name: '祠堂口', option: '选项 2' }
    );
    assert.deepEqual(
      readRoguelikeEvent(event('SubTaskExtraInfo', {
        what: 'RoguelikeEventSelected',
        details: { name: '祠堂口', choose_option: 2, option_text: '行仪' }
      })),
      { name: '祠堂口', option: '行仪' }
    );
    assert.equal(
      readRoguelikeEvent(event('SubTaskExtraInfo', {
        what: 'RoguelikeEvent',
        details: { choose_option: 2 }
      })),
      null
    );
    assert.equal(
      readRoguelikeEvent(event('SubTaskExtraInfo', {
        what: 'StageInfo',
        details: { name: '破岁阵祀' }
      })),
      null
    );
  });

  it('accumulates investment rounds with type-checked fields', () => {
    const first = readRoguelikeInvestment(
      event('SubTaskExtraInfo', {
        what: 'RoguelikeInvestment',
        details: { count: 11, deposit: 290, total: 19 }
      }),
      null
    );
    assert.deepEqual(first, {
      rounds: 1,
      count: 11,
      total: 19,
      deposit: 290,
      reachedLimit: false,
      reachedFull: false
    });

    const second = readRoguelikeInvestment(
      event('SubTaskExtraInfo', {
        what: 'RoguelikeInvestment',
        details: { count: '2', deposit: -1, total: 'unknown' }
      }),
      first
    );
    assert.deepEqual(second, {
      rounds: 2,
      count: 11,
      total: 19,
      deposit: 290,
      reachedLimit: false,
      reachedFull: false
    });
  });
});

describe('roguelike progress reducer', () => {
  it('counts a passed round closed by GamePass', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1, max_times: 2147483647 }, BASE_TIME),
      subtaskStart('GamePass', { exec_times: 1 }, BASE_TIME + 1_000)
    ]);

    assert.deepEqual(snapshot, {
      command: 'roguelike',
      theme: 'JieGarden',
      mode: null,
      phase: 'exploring',
      currentRound: null,
      roundStartedAt: null,
      targetRounds: null,
      roundsStarted: 1,
      roundsEnded: 1,
      roundsSettled: 0,
      roundsPassed: 1,
      settlementSupported: null,
      currentAction: 'GamePass',
      lastEventKind: 'round',
      lastEventName: null,
      lastEventAt: iso(BASE_TIME + 1_000),
      combatCount: 0,
      investment: null,
      recentRounds: [{
        index: 1,
        outcome: 'passed',
        settled: false,
        floor: null,
        score: null,
        endedAt: iso(BASE_TIME + 1_000)
      }],
      blackflow: null,
      updatedAt: iso(BASE_TIME + 1_000),
      degraded: false,
      observed: true
    });
  });

  it('counts a failed round as not passed without failing the execution', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      subtaskStart('MissionFailedFlag2', { exec_times: 1 }, BASE_TIME + 1_000)
    ]);

    assert.equal(snapshot.roundsStarted, 1);
    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsPassed, 0);
    assert.equal(snapshot.recentRounds[0].outcome, 'not_passed');
    assert.equal(snapshot.currentAction, 'MissionFailedFlag2');
  });

  it('lets a settlement close the round before the end marker arrives', () => {
    const settlementTime = BASE_TIME + 1_000;
    const markerTime = BASE_TIME + 1_001;
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      extra('RoguelikeSettlement', { game_pass: false, floor: 2, score: 50 }, settlementTime),
      subtaskStart('MissionFailedFlag2', { exec_times: 1 }, markerTime)
    ]);

    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.roundsPassed, 0);
    assert.equal(snapshot.currentRound, null);
    assert.deepEqual(snapshot.recentRounds, [{
      index: 1,
      outcome: 'not_passed',
      settled: true,
      floor: 2,
      score: 50,
      endedAt: iso(settlementTime)
    }]);
    assert.equal(snapshot.lastEventAt, iso(markerTime));
    assert.equal(snapshot.currentAction, 'MissionFailedFlag2');
  });

  it('does not count a duplicate end marker or a duplicate settlement twice', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      extra('RoguelikeSettlement', { game_pass: false, floor: 2, score: 50 }, BASE_TIME + 1_000),
      subtaskStart('MissionFailedFlag2', { exec_times: 1 }, BASE_TIME + 2_000),
      subtaskStart('MissionFailedFlag2', { exec_times: 1 }, BASE_TIME + 3_000),
      extra('RoguelikeSettlement', { game_pass: false, floor: 2, score: 50 }, BASE_TIME + 4_000)
    ]);

    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.recentRounds.length, 1);
    assert.equal(snapshot.recentRounds[0].floor, 2);
    assert.equal(snapshot.recentRounds[0].endedAt, iso(BASE_TIME + 1_000));
    assert.equal(snapshot.lastEventAt, iso(BASE_TIME + 4_000));
  });

  it('counts delayed markers against their matching closed rounds', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      subtaskStart('StartExplore', { exec_times: 2 }, BASE_TIME + 1_000),
      subtaskStart('MissionFailedFlag2', { exec_times: 2 }, BASE_TIME + 2_000),
      subtaskStart('GamePass', { exec_times: 1 }, BASE_TIME + 3_000)
    ]);

    assert.equal(snapshot.roundsStarted, 2);
    assert.equal(snapshot.roundsEnded, 2);
    assert.equal(snapshot.roundsPassed, 1);
    assert.equal(snapshot.currentRound, null);
    assert.equal(snapshot.recentRounds.find(round => round.index === 1)?.outcome, 'passed');
    assert.equal(snapshot.recentRounds.find(round => round.index === 2)?.outcome, 'not_passed');
  });

  it('does not close the open round for a delayed earlier marker', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      subtaskStart('StartExplore', { exec_times: 2 }, BASE_TIME + 1_000),
      subtaskStart('MissionFailedFlag2', { exec_times: 1 }, BASE_TIME + 2_000),
      subtaskStart('MissionFailedFlag2', { exec_times: 1 }, BASE_TIME + 3_000)
    ]);

    assert.equal(snapshot.roundsStarted, 2);
    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.currentRound, 2);
    assert.equal(snapshot.roundStartedAt, iso(BASE_TIME + 1_000));
    assert.deepEqual(snapshot.recentRounds, [{
      index: 1,
      outcome: 'not_passed',
      settled: false,
      floor: null,
      score: null,
      endedAt: iso(BASE_TIME + 2_000)
    }]);
  });

  it('ignores a duplicate marker for a fully closed round without closing another closed round', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      subtaskStart('StartExplore', { exec_times: 2 }, BASE_TIME + 1_000),
      subtaskStart('GamePass', { exec_times: 2 }, BASE_TIME + 2_000),
      subtaskStart('GamePass', { exec_times: 2 }, BASE_TIME + 3_000)
    ]);

    assert.equal(snapshot.roundsStarted, 2);
    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsPassed, 1);
    assert.equal(snapshot.recentRounds.find(round => round.index === 1)?.outcome, 'unknown');
    assert.equal(snapshot.recentRounds.find(round => round.index === 2)?.outcome, 'passed');
    assert.equal(snapshot.lastEventAt, iso(BASE_TIME + 3_000));
  });

  it('does not let a delayed marker for a confirmed round fill another settlement round', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      subtaskStart('GamePass', { exec_times: 1 }, BASE_TIME + 1_000),
      subtaskStart('StartExplore', { exec_times: 2 }, BASE_TIME + 2_000),
      extra('RoguelikeSettlement', { floor: 2, score: 10 }, BASE_TIME + 3_000),
      subtaskStart('GamePass', { exec_times: 1 }, BASE_TIME + 4_000)
    ]);

    assert.equal(snapshot.roundsStarted, 2);
    assert.equal(snapshot.roundsEnded, 2);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.roundsPassed, 1);
    assert.equal(snapshot.recentRounds.find(round => round.index === 1)?.outcome, 'passed');
    assert.equal(snapshot.recentRounds.find(round => round.index === 2)?.outcome, 'unknown');
  });

  it('keeps a settlement-confirmed not-passed round when a delayed marker matches another round', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      subtaskStart('GamePass', { exec_times: 1 }, BASE_TIME + 1_000),
      subtaskStart('StartExplore', { exec_times: 2 }, BASE_TIME + 2_000),
      extra('RoguelikeSettlement', { game_pass: false, floor: 2, score: 10 }, BASE_TIME + 3_000),
      subtaskStart('GamePass', { exec_times: 1 }, BASE_TIME + 4_000)
    ]);

    assert.equal(snapshot.roundsStarted, 2);
    assert.equal(snapshot.roundsEnded, 2);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.roundsPassed, 1);
    assert.equal(snapshot.recentRounds.find(round => round.index === 1)?.outcome, 'passed');
    assert.equal(snapshot.recentRounds.find(round => round.index === 2)?.outcome, 'not_passed');
  });

  it('fills a passed outcome after a settlement without game_pass', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      extra('RoguelikeSettlement', { floor: 2, score: 10 }, BASE_TIME + 1_000),
      subtaskStart('GamePass', { exec_times: 1 }, BASE_TIME + 2_000)
    ]);

    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.roundsPassed, 1);
    assert.equal(snapshot.recentRounds[0].outcome, 'passed');
    assert.equal(snapshot.recentRounds[0].endedAt, iso(BASE_TIME + 1_000));
  });

  it('fills a not-passed outcome after a settlement without game_pass', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      extra('RoguelikeSettlement', { floor: 2, score: 10 }, BASE_TIME + 1_000),
      subtaskStart('MissionFailedFlag2', {}, BASE_TIME + 2_000)
    ]);

    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.roundsPassed, 0);
    assert.equal(snapshot.recentRounds[0].outcome, 'not_passed');
  });

  it('keeps the ended phase when a settlement follows a task chain stop', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      callback('TaskChainStopped', {}, BASE_TIME + 1_000),
      extra('RoguelikeSettlement', { game_pass: true, floor: 2, score: 10 }, BASE_TIME + 2_000)
    ]);

    assert.equal(snapshot.phase, 'ended');
    assert.equal(snapshot.currentRound, null);
    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsSettled, 1);
  });

  it('keeps the ended phase for exit and generic task events', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      callback('TaskChainCompleted', {}, BASE_TIME + 1_000),
      subtaskStart('ExitThenAbandon', {}, BASE_TIME + 2_000),
      subtaskStart('ChooseOper', {}, BASE_TIME + 3_000)
    ]);

    assert.equal(snapshot.phase, 'ended');
    assert.equal(snapshot.currentRound, 1);
    assert.equal(snapshot.roundsEnded, 0);
  });

  it('restarts the phase only through TaskChainStart', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      callback('TaskChainStopped', {}, BASE_TIME + 1_000),
      callback('TaskChainStart', {}, BASE_TIME + 2_000)
    ]);

    assert.equal(snapshot.phase, 'starting');
  });

  it('keeps the ended phase when StartExplore arrives after the task chain stopped', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      callback('TaskChainStopped', {}, BASE_TIME + 1_000),
      subtaskStart('StartExplore', { exec_times: 2 }, BASE_TIME + 2_000)
    ]);

    assert.equal(snapshot.phase, 'ended');
    assert.equal(snapshot.roundsStarted, 2);
    assert.equal(snapshot.currentRound, 2);
    assert.equal(snapshot.roundsEnded, 0);
  });

  it('ignores a new marker after every closed round has ended', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      subtaskStart('GamePass', { exec_times: 1 }, BASE_TIME + 1_000),
      subtaskStart('MissionFailedFlag2', { exec_times: 1 }, BASE_TIME + 2_000)
    ]);

    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsPassed, 1);
    assert.equal(snapshot.recentRounds[0].outcome, 'passed');
    assert.equal(snapshot.currentRound, null);
  });

  it('keeps a round passed when a later settlement reports a failed game', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      subtaskStart('GamePass', { exec_times: 1 }, BASE_TIME + 1_000),
      extra('RoguelikeSettlement', { game_pass: false, floor: 4, score: 128 }, BASE_TIME + 2_000)
    ]);

    assert.equal(snapshot.roundsPassed, 1);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.recentRounds[0].outcome, 'passed');
    assert.equal(snapshot.recentRounds[0].settled, true);
    assert.equal(snapshot.recentRounds[0].floor, 4);
    assert.equal(snapshot.recentRounds[0].score, 128);
  });

  it('counts a settlement game pass once even when GamePass follows', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      extra('RoguelikeSettlement', { game_pass: true, floor: 5, score: 300 }, BASE_TIME + 1_000),
      subtaskStart('GamePass', { exec_times: 1 }, BASE_TIME + 2_000)
    ]);

    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.roundsPassed, 1);
    assert.equal(snapshot.recentRounds[0].outcome, 'passed');
    assert.equal(snapshot.recentRounds[0].floor, 5);
    assert.equal(snapshot.recentRounds[0].endedAt, iso(BASE_TIME + 1_000));
  });

  it('does not invent settlements when the mode has no settlement support', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      subtaskStart('GamePass', { exec_times: 1 }, BASE_TIME + 1_000)
    ], { settlementSupported: false });

    assert.equal(snapshot.settlementSupported, false);
    assert.equal(snapshot.roundsSettled, 0);
    assert.deepEqual(snapshot.recentRounds, [{
      index: 1,
      outcome: 'passed',
      settled: false,
      floor: null,
      score: null,
      endedAt: iso(BASE_TIME + 1_000)
    }]);
  });

  it('settles a displaced uncounted round and counts its end once', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      subtaskStart('StartExplore', { exec_times: 2 }, BASE_TIME + 1_000),
      subtaskStart('GamePass', { exec_times: 2 }, BASE_TIME + 2_000),
      extra('RoguelikeSettlement', { game_pass: true, floor: 2, score: 20 }, BASE_TIME + 3_000),
      extra('RoguelikeSettlement', { game_pass: true, floor: 1, score: 10 }, BASE_TIME + 4_000)
    ]);

    assert.equal(snapshot.roundsStarted, 2);
    assert.equal(snapshot.roundsEnded, 2);
    assert.equal(snapshot.roundsSettled, 2);
    assert.equal(snapshot.roundsPassed, 2);
    assert.equal(snapshot.recentRounds.find(round => round.index === 1)?.outcome, 'passed');
    assert.equal(snapshot.recentRounds.find(round => round.index === 1)?.settled, true);
    assert.equal(snapshot.recentRounds.find(round => round.index === 1)?.floor, 1);
    assert.equal(snapshot.recentRounds.find(round => round.index === 2)?.floor, 2);
  });

  it('retires an open round as unknown when the next StartExplore arrives', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      subtaskStart('StartExplore', { exec_times: 2 }, BASE_TIME + 1_000)
    ]);

    assert.equal(snapshot.roundsStarted, 2);
    assert.equal(snapshot.roundsEnded, 0);
    assert.equal(snapshot.currentRound, 2);
    assert.equal(snapshot.roundStartedAt, iso(BASE_TIME + 1_000));
    assert.deepEqual(snapshot.recentRounds, [{
      index: 1,
      outcome: 'unknown',
      settled: false,
      floor: null,
      score: null,
      endedAt: null
    }]);
  });

  it('creates an unknown-index round when observation starts mid-run', () => {
    const snapshot = snapshotFor([
      subtaskStart('MissionFailedFlag2', { exec_times: 1 }, BASE_TIME)
    ]);

    assert.equal(snapshot.roundsStarted, 0);
    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.currentRound, null);
    assert.deepEqual(snapshot.recentRounds, [{
      index: null,
      outcome: 'not_passed',
      settled: false,
      floor: null,
      score: null,
      endedAt: iso(BASE_TIME)
    }]);
  });

  it('creates an unknown-index round for a settlement observed without a start', () => {
    const snapshot = snapshotFor([
      extra('RoguelikeSettlement', { game_pass: true, floor: 1, score: 10 }, BASE_TIME)
    ]);

    assert.equal(snapshot.roundsStarted, 0);
    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.roundsPassed, 1);
    assert.deepEqual(snapshot.recentRounds, [{
      index: null,
      outcome: 'passed',
      settled: true,
      floor: 1,
      score: 10,
      endedAt: iso(BASE_TIME)
    }]);
  });

  it('does not treat non-boundary task names as round endings', () => {
    for (const task of [
      'MissionCompletedFlag',
      'MissionFailedFlag',
      'MissionFailedFlag3',
      'ExitThenAbandon',
      'StartExplore-EnterCheck',
      'StartExploreWithSeed-1'
    ]) {
      const snapshot = snapshotFor([
        subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
        subtaskStart(task, { exec_times: 1 }, BASE_TIME + 1_000)
      ]);

      assert.equal(snapshot.roundsEnded, 0);
      assert.equal(snapshot.currentRound, 1);
      assert.deepEqual(snapshot.recentRounds, []);
    }
  });

  it('keeps the current round open when the task chain stops', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      callback('TaskChainStopped', {}, BASE_TIME + 1_000)
    ]);

    assert.equal(snapshot.currentRound, 1);
    assert.equal(snapshot.roundsEnded, 0);
    assert.deepEqual(snapshot.recentRounds, []);
    assert.equal(snapshot.phase, 'ended');
    assert.equal(snapshot.currentAction, 'TaskChainStopped');
  });

  it('ignores a settlement repeated immediately after the first one', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      extra('RoguelikeSettlement', { game_pass: true, floor: 2, score: 40 }, BASE_TIME + 1_000),
      extra('RoguelikeSettlement', { game_pass: true, floor: 2, score: 40 }, BASE_TIME + 2_000)
    ]);

    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.roundsPassed, 1);
    assert.equal(snapshot.recentRounds.length, 1);
  });

  it('reads target rounds from StartExplore only when the seed has none', () => {
    assert.equal(
      snapshotFor([subtaskStart('StartExplore', { exec_times: 1, max_times: 5 })]).targetRounds,
      5
    );
    assert.equal(
      snapshotFor(
        [subtaskStart('StartExplore', { exec_times: 1, max_times: 5 })],
        { targetRounds: 7 }
      ).targetRounds,
      7
    );
    assert.equal(
      snapshotFor([subtaskStart('StartExplore', { exec_times: 1, max_times: 2147483647 })]).targetRounds,
      null
    );
  });

  it('ignores unusable max_times values', () => {
    for (const maxTimes of [0, -1, 1.5, '5', null, undefined]) {
      const snapshot = snapshotFor([
        subtaskStart('StartExplore', { exec_times: 1, max_times: maxTimes })
      ]);
      assert.equal(snapshot.targetRounds, null);
    }
  });

  it('keeps the five most recently closed rounds in the snapshot while retaining all closed rounds in state', () => {
    const lines: string[] = [];
    for (let index = 1; index <= 6; index += 1) {
      const start = BASE_TIME + index * 10_000;
      lines.push(subtaskStart('StartExplore', { exec_times: index }, start));
      lines.push(subtaskStart('GamePass', { exec_times: index }, start + 1_000));
    }

    const state = applyRoguelikeProgressEvents(
      createRoguelikeProgressState(seed()),
      parseMaaCallbackEvents(lines.join('\n'), 'Roguelike')
    );
    const snapshot = buildRoguelikeProgressSnapshot(state);
    assert.equal(state.closedRounds.length, 6);
    assert.equal(snapshot.roundsStarted, 6);
    assert.equal(snapshot.roundsEnded, 6);
    assert.equal(snapshot.roundsPassed, 6);
    assert.deepEqual(snapshot.recentRounds.map(round => round.index), [6, 5, 4, 3, 2]);
  });

  it('exposes the seed mode without inferring it from the theme', () => {
    assert.equal(snapshotFor([], { mode: 30001 }).mode, 30001);
    assert.equal(snapshotFor([], { mode: 1 }).mode, 1);
    assert.equal(snapshotFor([], { mode: null }).mode, null);
  });

  it('keeps reclamation to task-level events without rounds or settlements', () => {
    const snapshot = snapshotFor([
      callback('TaskChainStart', {}, BASE_TIME, 'Reclamation'),
      callback('SubTaskStart', { details: { task: 'Reclamation@BaseTask' } }, BASE_TIME + 1_000, 'Reclamation'),
      extra('RoguelikeSettlement', { game_pass: true, floor: 3 }, BASE_TIME + 2_000, 'Reclamation')
    ], { command: 'reclamation', theme: 'Tales' }, 'Reclamation');

    assert.equal(snapshot.phase, 'starting');
    assert.equal(snapshot.currentRound, null);
    assert.equal(snapshot.roundsStarted, 0);
    assert.equal(snapshot.roundsEnded, 0);
    assert.equal(snapshot.roundsSettled, 0);
    assert.deepEqual(snapshot.recentRounds, []);
    assert.equal(snapshot.lastEventKind, 'task');
    assert.equal(snapshot.lastEventName, 'Reclamation@BaseTask');
    assert.equal(snapshot.currentAction, null);
    assert.equal(snapshot.lastEventAt, iso(BASE_TIME + 1_000));
    assert.equal(snapshot.updatedAt, iso(BASE_TIME + 1_000));
  });

  it('treats StartExplore as a generic task in reclamation', () => {
    const snapshot = snapshotFor([
      callback('SubTaskStart', { details: { task: 'StartExplore' } }, BASE_TIME, 'Reclamation'),
      callback('TaskChainStopped', {}, BASE_TIME + 1_000, 'Reclamation')
    ], { command: 'reclamation', theme: 'Tales' }, 'Reclamation');

    assert.equal(snapshot.roundsStarted, 0);
    assert.equal(snapshot.roundsEnded, 0);
    assert.equal(snapshot.recentRounds.length, 0);
    assert.equal(snapshot.phase, 'ended');
    assert.equal(snapshot.lastEventKind, 'task');
    assert.equal(snapshot.currentAction, 'TaskChainStopped');
  });

  it('keeps missing OCR fields and invalid numbers as null instead of zero', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 0, max_times: 0 }, BASE_TIME),
      extra('StageInfo', {}, BASE_TIME + 1_000),
      extra('RoguelikeEvent', { choose_option: 1 }, BASE_TIME + 2_000),
      extra('RoguelikeInvestment', { count: '2', deposit: -1, total: 'unknown' }, BASE_TIME + 3_000),
      extra('RoguelikeSettlement', { game_pass: 'yes', floor: '3', score: null }, BASE_TIME + 4_000)
    ]);

    assert.equal(snapshot.roundsStarted, 1);
    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.roundsPassed, 0);
    assert.deepEqual(snapshot.recentRounds, [{
      index: 1,
      outcome: 'unknown',
      settled: true,
      floor: null,
      score: null,
      endedAt: iso(BASE_TIME + 4_000)
    }]);
    assert.deepEqual(snapshot.investment, {
      rounds: 1,
      count: 0,
      total: null,
      deposit: null
    });
    assert.equal(snapshot.combatCount, 0);
  });

  it('does not use the current clock for event times without timestamps', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, null),
      subtaskStart('GamePass', { exec_times: 1 }, null)
    ], {}, 'Roguelike', BASE_TIME + 50_000);

    assert.equal(snapshot.roundStartedAt, null);
    assert.equal(snapshot.recentRounds[0].endedAt, null);
    assert.equal(snapshot.lastEventAt, null);
    assert.equal(snapshot.updatedAt, iso(BASE_TIME));
  });

  it('uses the tracker start time before any reducer update', () => {
    const snapshot = buildRoguelikeProgressSnapshot(
      createRoguelikeProgressState(seed()),
      BASE_TIME + 1_000
    );

    assert.equal(snapshot.phase, 'starting');
    assert.equal(snapshot.observed, false);
    assert.equal(snapshot.degraded, false);
    assert.equal(snapshot.updatedAt, iso(BASE_TIME));
    assert.equal(snapshot.currentRound, null);
    assert.equal(snapshot.roundStartedAt, null);
    assert.equal(snapshot.lastEventAt, null);
  });

  it('falls back to the provided now when the tracker start is unknown', () => {
    const snapshot = buildRoguelikeProgressSnapshot(
      createRoguelikeProgressState(seed({ startedAtMs: null })),
      BASE_TIME + 1_000
    );

    assert.equal(snapshot.updatedAt, iso(BASE_TIME + 1_000));
  });

  it('ignores invalid tracker start times', () => {
    for (const startedAtMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const snapshot = buildRoguelikeProgressSnapshot(
        createRoguelikeProgressState(seed({ startedAtMs })),
        BASE_TIME
      );

      assert.equal(snapshot.updatedAt, iso(BASE_TIME));
    }
    const negative = buildRoguelikeProgressSnapshot(
      createRoguelikeProgressState(seed({ startedAtMs: -1 })),
      BASE_TIME
    );
    assert.equal(negative.updatedAt, iso(BASE_TIME));
  });

  it('keeps the last reducer update time ahead of the provided now', () => {
    const events = parseMaaCallbackEvents(
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME + 1_000),
      'Roguelike'
    );
    const state = applyRoguelikeProgressEvents(createRoguelikeProgressState(seed()), events);
    const snapshot = buildRoguelikeProgressSnapshot(state, BASE_TIME + 5_000);

    assert.equal(snapshot.updatedAt, iso(BASE_TIME + 1_000));
  });

  it('marks progress degraded irreversibly', () => {
    const initial = createRoguelikeProgressState(seed());
    const degraded = markRoguelikeProgressDegraded(initial);

    assert.equal(degraded.degraded, true);
    assert.equal(markRoguelikeProgressDegraded(degraded).degraded, true);
    assert.equal(buildRoguelikeProgressSnapshot(degraded, BASE_TIME).degraded, true);
  });
});

describe('roguelike progress fixture', () => {
  it('reduces a real anonymized session snapshot', () => {
    const log = readFileSync(
      new URL('./fixtures/roguelike-session.fixture.txt', import.meta.url),
      'utf8'
    );
    const snapshot = snapshotForLog(log, { settlementSupported: true });

    assert.deepEqual(snapshot, {
      command: 'roguelike',
      theme: 'JieGarden',
      mode: null,
      phase: 'ended',
      currentRound: null,
      roundStartedAt: null,
      targetRounds: null,
      roundsStarted: 2,
      roundsEnded: 2,
      roundsSettled: 2,
      roundsPassed: 0,
      settlementSupported: true,
      currentAction: 'TaskChainStopped',
      lastEventKind: 'task',
      lastEventName: null,
      lastEventAt: iso(STOPPED_TIME),
      combatCount: 3,
      investment: {
        rounds: 2,
        count: 22,
        total: 19,
        deposit: 290
      },
      recentRounds: [
        {
          index: 2,
          outcome: 'not_passed',
          settled: true,
          floor: 3,
          score: 221,
          endedAt: iso(SETTLEMENT_TWO_TIME)
        },
        {
          index: 1,
          outcome: 'not_passed',
          settled: true,
          floor: null,
          score: null,
          endedAt: iso(SETTLEMENT_ONE_TIME)
        }
      ],
      blackflow: null,
      updatedAt: iso(STOPPED_TIME),
      degraded: false,
      observed: true
    });
  });
});

describe('roguelike black flow progress', () => {
  const blackFlowLog = readFileSync(
    new URL('./fixtures/blackflow-session.fixture.txt', import.meta.url),
    'utf8'
  );
  const routeTime = new Date(2026, 10, 21, 21, 36, 26, 402).getTime();
  const resolutionTime = new Date(2026, 10, 21, 21, 36, 45, 82).getTime();
  const resultTime = new Date(2026, 10, 21, 21, 36, 50, 56).getTime();
  const floorTwoMilestoneTime = new Date(2026, 10, 21, 21, 34, 31, 349).getTime();
  const shopSatisfiedTime = new Date(2026, 10, 21, 21, 33, 48, 115).getTime();

  it('merges black flow events into the progress snapshot without changing round counters', () => {
    const snapshot = snapshotForLog(blackFlowLog, { settlementSupported: true });

    assert.deepEqual(snapshot.blackflow, {
      floor: 2,
      floorAt: iso(routeTime),
      currentNode: { id: '562949986975748', name: '应急助力', type: 'employ' },
      currentNodeAt: iso(routeTime),
      actionPoints: { before: 3, after: 2, at: iso(routeTime) },
      lastRoute: {
        at: iso(routeTime),
        floor: 2,
        target: { id: '562949986975746', name: '险路尽头', type: 'final' },
        landing: { id: '562949986975746', name: '险路尽头', type: 'final' },
        movement: 'walk',
        actionPointsBefore: 3,
        actionPointsAfter: 2,
        exactCost: 1,
        predictedCost: 1,
        arrived: true
      },
      lastNodeResolution: {
        at: iso(resolutionTime),
        floor: 2,
        node: { id: '562949986975746', name: '险路尽头', type: 'final' },
        eventName: '险路尽头',
        progress: 'completed'
      },
      milestones: [
        {
          id: 'burn_floor2_final',
          floor: 2,
          progress: 0,
          status: 'available',
          at: iso(floorTwoMilestoneTime)
        },
        {
          id: 'burn_floor1_shop',
          floor: 1,
          progress: 0,
          status: 'satisfied',
          at: iso(shopSatisfiedTime)
        },
        {
          id: 'burn_floor1_final',
          floor: 1,
          progress: 0,
          status: 'available',
          at: iso(new Date(2026, 10, 21, 21, 29, 44, 554).getTime())
        }
      ],
      strategy: {
        at: iso(resultTime),
        profile: 'burn_with_investment',
        outcome: 'burn_completed',
        terminationReason: 'third_floor_reached',
        nextAction: 'restart_current_run',
        succeeded: true
      },
      updatedAt: iso(resultTime)
    });

    assert.equal(snapshot.roundsStarted, 1);
    assert.equal(snapshot.roundsEnded, 0);
    assert.equal(snapshot.roundsSettled, 0);
    assert.equal(snapshot.roundsPassed, 0);
    assert.equal(snapshot.currentRound, 1);
    assert.equal(snapshot.phase, 'ended');
    assert.equal(snapshot.currentAction, 'TaskChainError');
  });

  it('keeps black flow in the active snapshot and the terminal snapshot', () => {
    const lines = blackFlowLog.trimEnd().split('\n');
    const active = snapshotForLog(lines.slice(0, -2).join('\n') + '\n');
    const terminal = snapshotForLog(blackFlowLog);

    assert.ok(active.blackflow);
    assert.equal(active.phase, 'exploring');
    assert.equal(active.currentRound, 1);
    assert.equal(active.blackflow.strategy?.outcome, 'burn_completed');

    assert.ok(terminal.blackflow);
    assert.equal(terminal.phase, 'ended');
    assert.equal(terminal.currentRound, 1);
    assert.equal(terminal.blackflow.strategy?.nextAction, 'restart_current_run');
  });

  it('keeps blackflow null for roguelike events without black flow callbacks', () => {
    const snapshot = snapshotFor([
      subtaskStart('StartExplore', { exec_times: 1 }, BASE_TIME),
      extra('StageInfo', { name: '破岁阵祀' }, BASE_TIME + 1_000),
      subtaskStart('GamePass', { exec_times: 1 }, BASE_TIME + 2_000)
    ]);

    assert.equal(snapshot.blackflow, null);
  });
});
