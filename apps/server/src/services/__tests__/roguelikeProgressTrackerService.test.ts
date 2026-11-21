import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { parseMaaCallbackEvents } from '../maaCallbackService.ts';
import type { MaaCallbackEvent } from '../maaCallbackService.ts';
import type { MaaLogCheckpoint, MaaLogChunk, MaaLogIncrementStatus } from '../maaLogFileService.ts';
import {
  configureRoguelikeProgressTrackerRuntimeForTests,
  finalizeRoguelikeProgressTracker,
  getRoguelikeProgress,
  releaseAllRoguelikeProgressTrackers,
  releaseRoguelikeProgressTracker,
  resetRoguelikeProgressTrackerForTests,
  startRoguelikeProgressTracker
} from '../roguelikeProgressTrackerService.ts';
import type {
  RoguelikeProgressTrackerInput,
  RoguelikeProgressTrackerRuntime
} from '../roguelikeProgressTrackerService.ts';

const START_MS = new Date(2026, 10, 4, 1, 35, 30, 0).getTime();
const LOG_PATH = '/tmp/maa-logs/asst.log';
const CHUNK_BYTES = 256 * 1024;

interface TimerEntry {
  callback: () => void;
  delayMs: number;
  cancelled: boolean;
  fired: boolean;
}

interface ChunkOptions {
  status?: MaaLogIncrementStatus;
  caughtUp?: boolean;
}

interface ReadCall {
  checkpoint: MaaLogCheckpoint;
  maxBytes: number;
}

interface ParseCall {
  text: string;
  taskchain: string;
}

interface HarnessOptions {
  chunks?: Array<MaaLogChunk | Error>;
  parseEvents?: (text: string, taskchain: string) => MaaCallbackEvent[];
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function formatTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  return `[${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)} `
    + `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.`
    + `${pad(date.getMilliseconds(), 3)}]`;
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function callbackLine(
  type: string,
  payload: Record<string, unknown> = {},
  atMs = START_MS,
  taskchain = 'Roguelike'
): string {
  return `${formatTimestamp(atMs)}[INF] Assistant::append_callback | ${type} `
    + JSON.stringify({ taskchain, ...payload });
}

function subtaskStart(
  task: string,
  details: Record<string, unknown> = {},
  atMs = START_MS,
  taskchain = 'Roguelike'
): string {
  return callbackLine('SubTaskStart', { details: { task, ...details } }, atMs, taskchain);
}

function extra(
  what: string,
  details: Record<string, unknown> = {},
  atMs = START_MS,
  taskchain = 'Roguelike'
): string {
  return callbackLine('SubTaskExtraInfo', { what, details }, atMs, taskchain);
}

function checkpoint(size: number): MaaLogCheckpoint {
  return { logPath: LOG_PATH, size };
}

function makeChunk(text: string, nextSize: number, options: ChunkOptions = {}): MaaLogChunk {
  return {
    status: options.status ?? 'ok',
    text,
    nextCheckpoint: checkpoint(nextSize),
    caughtUp: options.caughtUp ?? false
  };
}

function trackerInput(overrides: Partial<RoguelikeProgressTrackerInput> = {}): RoguelikeProgressTrackerInput {
  return {
    runId: 'run-1',
    checkpoint: checkpoint(0),
    command: 'roguelike',
    theme: 'JieGarden',
    mode: null,
    targetRounds: null,
    settlementSupported: null,
    startedAtMs: START_MS,
    ...overrides
  };
}

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

function createHarness(options: HarnessOptions = {}) {
  const state = {
    nowMs: START_MS,
    chunks: [...(options.chunks ?? [])],
    reads: [] as ReadCall[],
    parseCalls: [] as ParseCall[]
  };
  const timers: TimerEntry[] = [];

  const runtime: RoguelikeProgressTrackerRuntime = {
    now: () => state.nowMs,
    schedule(callback, delayMs) {
      const entry: TimerEntry = { callback, delayMs, cancelled: false, fired: false };
      timers.push(entry);
      return {
        cancel() {
          if (entry.cancelled) throw new Error('timer cancelled twice');
          entry.cancelled = true;
        }
      };
    },
    async readChunk(source, maxBytes) {
      state.reads.push({ checkpoint: source, maxBytes });
      const next = state.chunks.shift();
      if (!next) return makeChunk('', source.size, { caughtUp: true });
      if (next instanceof Error) throw next;
      return next;
    },
    parseEvents(text, taskchain) {
      state.parseCalls.push({ text, taskchain });
      if (options.parseEvents) return options.parseEvents(text, taskchain);
      return parseMaaCallbackEvents(text, taskchain);
    }
  };

  configureRoguelikeProgressTrackerRuntimeForTests(runtime);

  return {
    state,
    timers,
    pendingTimers: () => timers.filter(timer => !timer.cancelled && !timer.fired),
    advance(ms: number) {
      state.nowMs += ms;
    },
    async fire(): Promise<void> {
      const timer = timers.find(candidate => !candidate.cancelled && !candidate.fired);
      assert.ok(timer, 'expected a scheduled tracker timer');
      timer.fired = true;
      timer.callback();
      await flushAsyncWork();
    }
  };
}

afterEach(() => {
  resetRoguelikeProgressTrackerForTests();
});

describe('roguelike progress tracker start', () => {
  it('caches an initial starting snapshot and schedules the first tick at zero delay', () => {
    const harness = createHarness();

    assert.equal(startRoguelikeProgressTracker(trackerInput()), true);

    assert.deepEqual(getRoguelikeProgress('run-1'), {
      command: 'roguelike',
      theme: 'JieGarden',
      mode: null,
      phase: 'starting',
      currentRound: null,
      roundStartedAt: null,
      targetRounds: null,
      roundsStarted: 0,
      roundsEnded: 0,
      roundsSettled: 0,
      roundsPassed: 0,
      settlementSupported: null,
      currentAction: null,
      lastEventKind: null,
      lastEventName: null,
      lastEventAt: null,
      combatCount: 0,
      investment: null,
      recentRounds: [],
      blackflow: null,
      updatedAt: iso(START_MS),
      degraded: false,
      observed: false
    });
    assert.equal(harness.pendingTimers().length, 1);
    assert.equal(harness.pendingTimers()[0].delayMs, 0);
    assert.equal(harness.state.reads.length, 0);
    assert.equal(getRoguelikeProgress('missing-run'), null);
  });

  it('keeps the input mode in the cached snapshot', () => {
    const harness = createHarness();

    assert.equal(startRoguelikeProgressTracker(trackerInput({ mode: 30001 })), true);

    assert.equal(getRoguelikeProgress('run-1')?.mode, 30001);
    assert.equal(harness.pendingTimers().length, 1);
  });

  it('rejects a second start for the same run without scheduling another timer', async () => {
    const harness = createHarness({
      chunks: [makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 100, { caughtUp: true })]
    });

    assert.equal(startRoguelikeProgressTracker(trackerInput()), true);
    assert.equal(startRoguelikeProgressTracker(trackerInput()), false);
    assert.equal(harness.pendingTimers().length, 1);

    await harness.fire();

    assert.equal(getRoguelikeProgress('run-1')?.roundsStarted, 1);
    assert.equal(startRoguelikeProgressTracker(trackerInput()), false);
    assert.equal(getRoguelikeProgress('run-1')?.roundsStarted, 1);
    assert.equal(harness.state.reads.length, 1);
    assert.equal(harness.pendingTimers().length, 1);
  });
});

describe('roguelike progress tracker polling', () => {
  it('accumulates multiple chunks in one tick and advances the checkpoint between reads', async () => {
    const harness = createHarness({
      chunks: [
        makeChunk(
          subtaskStart('StartExplore', { exec_times: 1, max_times: 5 }, START_MS + 1_000),
          100
        ),
        makeChunk(
          extra('RoguelikeSettlement', { game_pass: false, floor: 2, score: 50 }, START_MS + 2_000),
          200
        ),
        makeChunk(
          subtaskStart('MissionFailedFlag2', { exec_times: 1 }, START_MS + 3_000),
          300,
          { caughtUp: true }
        )
      ]
    });
    startRoguelikeProgressTracker(trackerInput());

    await harness.fire();

    assert.equal(harness.state.reads.length, 3);
    assert.deepEqual(harness.state.reads.map(read => read.checkpoint.size), [0, 100, 200]);
    assert.equal(harness.state.reads.every(read => read.maxBytes === CHUNK_BYTES), true);
    assert.deepEqual(
      harness.state.parseCalls.map(call => call.taskchain),
      ['Roguelike', 'Roguelike', 'Roguelike']
    );

    const snapshot = getRoguelikeProgress('run-1');
    assert.ok(snapshot);
    assert.equal(snapshot.phase, 'exploring');
    assert.equal(snapshot.targetRounds, 5);
    assert.equal(snapshot.roundsStarted, 1);
    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.roundsPassed, 0);
    assert.equal(snapshot.currentRound, null);
    assert.equal(snapshot.currentAction, 'MissionFailedFlag2');
    assert.equal(snapshot.lastEventKind, 'round');
    assert.equal(snapshot.lastEventAt, iso(START_MS + 3_000));
    assert.equal(snapshot.updatedAt, iso(START_MS + 3_000));
    assert.equal(snapshot.degraded, false);
    assert.equal(snapshot.observed, true);
    assert.deepEqual(snapshot.recentRounds, [{
      index: 1,
      outcome: 'not_passed',
      settled: true,
      floor: 2,
      score: 50,
      endedAt: iso(START_MS + 2_000)
    }]);
    assert.equal(harness.pendingTimers().length, 1);
    assert.equal(harness.pendingTimers()[0].delayMs, 1_000);
  });

  it('applies black flow events from the same chunk to the cached snapshot', async () => {
    const harness = createHarness({
      chunks: [makeChunk([
        extra('BlackFlowStrategyStarted', { profile: 'burn_with_investment' }, START_MS),
        subtaskStart('StartExplore', { exec_times: 1 }, START_MS + 1_000),
        extra('BlackFlowMapSummary', {
          run_revision: 2,
          map_revision: 1,
          observation_id: 'BF-O1',
          floor: 1,
          current_node: 281475010265088
        }, START_MS + 2_000),
        extra('BlackFlowRoutingDecision', {
          run_revision: 2,
          map_revision: 1,
          observation_id: 'BF-O1',
          floor: 1,
          decision_id: 'BF-D2-1',
          transaction_id: 'BF-T2-1',
          profile: 'burn_with_investment',
          source: 281475010265088,
          target: 281475010265090,
          landing: 281475010265090,
          node_name: '作战',
          node_type: 'battle_normal',
          movement: 'walk',
          exact_cost: 1,
          predicted_cost: 1,
          action_points_before: 5,
          action_points_after: 4
        }, START_MS + 3_000)
      ].join('\n'), 100, { caughtUp: true })]
    });
    startRoguelikeProgressTracker(trackerInput());

    await harness.fire();

    const snapshot = getRoguelikeProgress('run-1');
    assert.equal(snapshot?.blackflow?.floor, 1);
    assert.deepEqual(snapshot?.blackflow?.currentNode, {
      id: '281475010265088',
      name: null,
      type: null
    });
    assert.deepEqual(snapshot?.blackflow?.actionPoints, {
      before: 5,
      after: 4,
      at: iso(START_MS + 3_000)
    });
    assert.deepEqual(snapshot?.blackflow?.lastRoute?.target, {
      id: '281475010265090',
      name: '作战',
      type: 'battle_normal'
    });
    assert.equal(snapshot?.blackflow?.strategy?.profile, 'burn_with_investment');
    assert.equal(snapshot?.roundsStarted, 1);
    assert.equal(snapshot?.currentRound, 1);
  });

  it('stops reading once caught up and resumes from the saved checkpoint on the next tick', async () => {
    const harness = createHarness({
      chunks: [makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 100, { caughtUp: true })]
    });
    startRoguelikeProgressTracker(trackerInput());

    await harness.fire();

    assert.equal(harness.state.reads.length, 1);
    assert.equal(getRoguelikeProgress('run-1')?.roundsStarted, 1);
    assert.equal(harness.pendingTimers().length, 1);

    harness.state.chunks.push(
      makeChunk(subtaskStart('GamePass', { exec_times: 1 }, START_MS + 2_000), 200, { caughtUp: true })
    );
    await harness.fire();

    assert.equal(harness.state.reads.length, 2);
    assert.equal(harness.state.reads[1].checkpoint.size, 100);
    const snapshot = getRoguelikeProgress('run-1');
    assert.equal(snapshot?.roundsStarted, 1);
    assert.equal(snapshot?.roundsEnded, 1);
    assert.equal(snapshot?.roundsPassed, 1);
    assert.equal(snapshot?.phase, 'exploring');
    assert.equal(harness.pendingTimers().length, 1);
  });

  it('marks degraded when the per-tick budget is exhausted and keeps counting on the next tick', async () => {
    const harness = createHarness({
      chunks: [
        makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 100),
        makeChunk(extra('StageInfo', { name: '破岁阵祀' }, START_MS + 1_000), 200),
        makeChunk(extra('RoguelikeCombatEnd', {}, START_MS + 2_000), 300),
        makeChunk(extra('RoguelikeEvent', { name: '祠堂口' }, START_MS + 3_000), 400)
      ]
    });
    startRoguelikeProgressTracker(trackerInput());

    await harness.fire();

    assert.equal(harness.state.reads.length, 4);
    const degraded = getRoguelikeProgress('run-1');
    assert.equal(degraded?.degraded, true);
    assert.equal(degraded?.roundsStarted, 1);
    assert.equal(degraded?.combatCount, 1);
    assert.equal(degraded?.lastEventKind, 'event');
    assert.equal(degraded?.lastEventName, '祠堂口');
    assert.equal(harness.pendingTimers().length, 1);
    assert.equal(harness.pendingTimers()[0].delayMs, 1_000);

    harness.state.chunks.push(
      makeChunk(subtaskStart('GamePass', { exec_times: 1 }, START_MS + 4_000), 500, { caughtUp: true })
    );
    await harness.fire();

    assert.equal(harness.state.reads.length, 5);
    const recovered = getRoguelikeProgress('run-1');
    assert.equal(recovered?.roundsStarted, 1);
    assert.equal(recovered?.roundsEnded, 1);
    assert.equal(recovered?.roundsPassed, 1);
    assert.equal(recovered?.degraded, true);
  });

  it('records degraded and ends the tick after a truncated chunk, then resumes next tick', async () => {
    const harness = createHarness({
      chunks: [
        makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 100, { status: 'truncated' }),
        makeChunk(
          subtaskStart('GamePass', { exec_times: 1 }, START_MS + 1_000),
          200,
          { caughtUp: true }
        )
      ]
    });
    startRoguelikeProgressTracker(trackerInput());

    await harness.fire();

    assert.equal(harness.state.reads.length, 1);
    const truncated = getRoguelikeProgress('run-1');
    assert.equal(truncated?.roundsStarted, 1);
    assert.equal(truncated?.roundsEnded, 0);
    assert.equal(truncated?.degraded, true);
    assert.equal(harness.pendingTimers().length, 1);

    await harness.fire();

    assert.equal(harness.state.reads.length, 2);
    const snapshot = getRoguelikeProgress('run-1');
    assert.equal(snapshot?.roundsEnded, 1);
    assert.equal(snapshot?.roundsPassed, 1);
    assert.equal(snapshot?.degraded, true);
  });

  it('marks degraded on rotation even when the chunk reports caught up', async () => {
    const harness = createHarness({
      chunks: [makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 100, { caughtUp: true })]
    });
    startRoguelikeProgressTracker(trackerInput());
    await harness.fire();

    harness.state.chunks.push(makeChunk(
      extra('StageInfo', { name: '破岁阵祀' }, START_MS + 2_000),
      200,
      { status: 'rotated', caughtUp: true }
    ));
    await harness.fire();

    const rotated = getRoguelikeProgress('run-1');
    assert.equal(rotated?.degraded, true);
    assert.equal(rotated?.roundsStarted, 1);
    assert.equal(rotated?.lastEventName, '破岁阵祀');
    assert.equal(harness.state.reads.length, 2);
    assert.equal(harness.pendingTimers().length, 1);

    harness.state.chunks.push(
      makeChunk(subtaskStart('MissionFailedFlag2', { exec_times: 1 }), 300, { caughtUp: true })
    );
    await harness.fire();

    const recovered = getRoguelikeProgress('run-1');
    assert.equal(recovered?.roundsEnded, 1);
    assert.equal(recovered?.recentRounds[0].outcome, 'not_passed');
    assert.equal(recovered?.degraded, true);
  });

  it('keeps the last state and recovers after an unreadable chunk', async () => {
    const harness = createHarness({
      chunks: [makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 100, { caughtUp: true })]
    });
    startRoguelikeProgressTracker(trackerInput());
    await harness.fire();

    harness.state.chunks.push(makeChunk('', 100, { status: 'unreadable' }));
    await harness.fire();

    const unreadable = getRoguelikeProgress('run-1');
    assert.equal(unreadable?.degraded, true);
    assert.equal(unreadable?.roundsStarted, 1);
    assert.equal(unreadable?.currentRound, 1);
    assert.equal(harness.state.reads[1].checkpoint.size, 100);
    assert.equal(harness.pendingTimers().length, 1);

    harness.state.chunks.push(
      makeChunk(subtaskStart('GamePass', { exec_times: 1 }), 200, { caughtUp: true })
    );
    await harness.fire();

    const recovered = getRoguelikeProgress('run-1');
    assert.equal(recovered?.roundsEnded, 1);
    assert.equal(recovered?.roundsPassed, 1);
    assert.equal(recovered?.degraded, true);
  });

  it('marks degraded without rejecting when readChunk throws and recovers on the next tick', async () => {
    const harness = createHarness({
      chunks: [makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 100, { caughtUp: true })]
    });
    startRoguelikeProgressTracker(trackerInput());
    await harness.fire();

    harness.state.chunks.push(new Error('read failed'));
    await harness.fire();

    const failed = getRoguelikeProgress('run-1');
    assert.equal(failed?.degraded, true);
    assert.equal(failed?.roundsStarted, 1);
    assert.equal(failed?.currentRound, 1);
    assert.equal(harness.pendingTimers().length, 1);

    harness.state.chunks.push(
      makeChunk(subtaskStart('GamePass', { exec_times: 1 }), 200, { caughtUp: true })
    );
    await harness.fire();

    const recovered = getRoguelikeProgress('run-1');
    assert.equal(recovered?.roundsEnded, 1);
    assert.equal(recovered?.roundsPassed, 1);
    assert.equal(recovered?.degraded, true);
  });
});

describe('roguelike progress tracker finalize', () => {
  it('drains remaining chunks without a timer, returns the final snapshot, and keeps it readable', async () => {
    const harness = createHarness({
      chunks: [
        makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 100),
        makeChunk(
          extra('RoguelikeSettlement', { game_pass: true, floor: 4, score: 128 }, START_MS + 1_000),
          200
        ),
        makeChunk(
          subtaskStart('GamePass', { exec_times: 1 }, START_MS + 2_000),
          300,
          { caughtUp: true }
        )
      ]
    });
    startRoguelikeProgressTracker(trackerInput());
    assert.equal(harness.pendingTimers().length, 1);

    const snapshot = await finalizeRoguelikeProgressTracker('run-1');

    assert.ok(snapshot);
    assert.equal(snapshot.roundsStarted, 1);
    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.roundsPassed, 1);
    assert.deepEqual(snapshot.recentRounds, [{
      index: 1,
      outcome: 'passed',
      settled: true,
      floor: 4,
      score: 128,
      endedAt: iso(START_MS + 1_000)
    }]);
    assert.equal(harness.state.reads.length, 3);
    assert.equal(harness.pendingTimers().length, 0);
    assert.deepEqual(getRoguelikeProgress('run-1'), snapshot);

    const second = await finalizeRoguelikeProgressTracker('run-1');
    assert.deepEqual(second, snapshot);
    assert.equal(harness.state.reads.length, 3);
    assert.equal(harness.pendingTimers().length, 0);

    releaseRoguelikeProgressTracker('run-1');
    assert.equal(getRoguelikeProgress('run-1'), null);
    assert.equal(await finalizeRoguelikeProgressTracker('run-1'), null);
  });

  it('keeps draining truncated chunks during finalize until caught up', async () => {
    const harness = createHarness({
      chunks: [
        makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 100, { status: 'truncated' }),
        makeChunk(
          extra('RoguelikeSettlement', { game_pass: true, floor: 3, score: 60 }, START_MS + 1_000),
          200,
          { status: 'truncated' }
        ),
        makeChunk(
          subtaskStart('GamePass', { exec_times: 1 }, START_MS + 2_000),
          300,
          { status: 'truncated', caughtUp: true }
        )
      ]
    });
    startRoguelikeProgressTracker(trackerInput());

    const snapshot = await finalizeRoguelikeProgressTracker('run-1');

    assert.ok(snapshot);
    assert.equal(harness.state.reads.length, 3);
    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsSettled, 1);
    assert.equal(snapshot.roundsPassed, 1);
    assert.equal(snapshot.degraded, true);
    assert.equal(harness.pendingTimers().length, 0);
  });

  it('keeps draining after a rotated chunk during finalize so later events reach the final snapshot', async () => {
    const harness = createHarness({
      chunks: [
        makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 100, { status: 'rotated' }),
        makeChunk(
          [
            extra('StageInfo', { name: '破岁阵祀' }, START_MS + 1_000),
            extra('RoguelikeCombatEnd', {}, START_MS + 1_500),
            subtaskStart('GamePass', { exec_times: 1 }, START_MS + 2_000)
          ].join('\n'),
          200,
          { caughtUp: true }
        )
      ]
    });
    startRoguelikeProgressTracker(trackerInput());

    const snapshot = await finalizeRoguelikeProgressTracker('run-1');

    assert.ok(snapshot);
    assert.deepEqual(harness.state.reads.map(read => read.checkpoint.size), [0, 100]);
    assert.equal(snapshot.degraded, true);
    assert.equal(snapshot.roundsStarted, 1);
    assert.equal(snapshot.roundsEnded, 1);
    assert.equal(snapshot.roundsPassed, 1);
    assert.equal(snapshot.combatCount, 1);
    assert.equal(snapshot.lastEventKind, 'round');
    assert.equal(snapshot.lastEventName, null);
    assert.equal(snapshot.lastEventAt, iso(START_MS + 2_000));
    assert.equal(harness.pendingTimers().length, 0);
  });

  it('stops finalize at an unreadable chunk and leaves later events unread', async () => {
    const harness = createHarness({
      chunks: [
        makeChunk('', 100, { status: 'unreadable' }),
        makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 200, { caughtUp: true })
      ]
    });
    startRoguelikeProgressTracker(trackerInput());

    const snapshot = await finalizeRoguelikeProgressTracker('run-1');

    assert.ok(snapshot);
    assert.equal(harness.state.reads.length, 1);
    assert.equal(snapshot.degraded, true);
    assert.equal(snapshot.roundsStarted, 0);
    assert.equal(snapshot.observed, false);
    assert.equal(harness.pendingTimers().length, 0);
  });

  it('cancels the pending tick and never schedules another timer', async () => {
    const harness = createHarness({
      chunks: [makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 100, { caughtUp: true })]
    });
    startRoguelikeProgressTracker(trackerInput());

    await finalizeRoguelikeProgressTracker('run-1');
    await flushAsyncWork();

    assert.equal(harness.pendingTimers().length, 0);
    assert.equal(harness.state.reads.length, 1);

    harness.advance(5_000);
    await flushAsyncWork();
    assert.equal(harness.state.reads.length, 1);
    assert.equal(harness.pendingTimers().length, 0);
  });

  it('marks degraded when the finalize budget is exhausted', async () => {
    const chunks: MaaLogChunk[] = [];
    for (let index = 0; index < 16; index += 1) {
      chunks.push(makeChunk(
        subtaskStart('StartExplore', { exec_times: index + 1 }, START_MS + index * 1_000),
        100 * (index + 1)
      ));
    }
    const harness = createHarness({ chunks });
    startRoguelikeProgressTracker(trackerInput());

    const snapshot = await finalizeRoguelikeProgressTracker('run-1');

    assert.ok(snapshot);
    assert.equal(harness.state.reads.length, 16);
    assert.equal(snapshot.degraded, true);
    assert.equal(snapshot.roundsStarted, 16);
    assert.equal(harness.pendingTimers().length, 0);
  });

  it('returns null for an unknown run', async () => {
    createHarness();
    assert.equal(await finalizeRoguelikeProgressTracker('missing-run'), null);
  });
});

describe('roguelike progress tracker cleanup', () => {
  it('releases one tracker idempotently and leaves other runs untouched', async () => {
    const harness = createHarness({
      chunks: [
        makeChunk(subtaskStart('StartExplore', { exec_times: 1 }), 100, { caughtUp: true }),
        makeChunk(subtaskStart('StartExplore', { exec_times: 1 }, START_MS, 'Reclamation'), 100, { caughtUp: true })
      ]
    });
    startRoguelikeProgressTracker(trackerInput({ runId: 'run-1' }));
    startRoguelikeProgressTracker(trackerInput({ runId: 'run-2', command: 'reclamation', theme: 'Tales' }));
    assert.equal(harness.pendingTimers().length, 2);

    await harness.fire();
    await harness.fire();

    assert.equal(getRoguelikeProgress('run-1')?.roundsStarted, 1);
    assert.equal(getRoguelikeProgress('run-2')?.roundsStarted, 0);

    releaseRoguelikeProgressTracker('run-1');
    releaseRoguelikeProgressTracker('run-1');

    assert.equal(getRoguelikeProgress('run-1'), null);
    assert.ok(getRoguelikeProgress('run-2'));
    assert.equal(harness.pendingTimers().length, 1);

    releaseAllRoguelikeProgressTrackers();
    releaseAllRoguelikeProgressTrackers();

    assert.equal(getRoguelikeProgress('run-2'), null);
    assert.equal(harness.pendingTimers().length, 0);
  });

  it('keeps trackers for separate runs isolated by state and taskchain', async () => {
    const harness = createHarness({
      chunks: [
        makeChunk(
          subtaskStart('StartExplore', { exec_times: 1, max_times: 3 }),
          100,
          { caughtUp: true }
        ),
        makeChunk(
          [
            callbackLine('TaskChainStart', {}, START_MS + 1_000, 'Reclamation'),
            subtaskStart('Reclamation@BaseTask', {}, START_MS + 2_000, 'Reclamation')
          ].join('\n'),
          200,
          { caughtUp: true }
        )
      ]
    });
    startRoguelikeProgressTracker(trackerInput({ runId: 'run-1', targetRounds: 3 }));
    startRoguelikeProgressTracker(trackerInput({ runId: 'run-2', command: 'reclamation', theme: 'Tales' }));

    await harness.fire();
    await harness.fire();

    const roguelike = getRoguelikeProgress('run-1');
    const reclamation = getRoguelikeProgress('run-2');
    assert.equal(roguelike?.command, 'roguelike');
    assert.equal(roguelike?.roundsStarted, 1);
    assert.equal(roguelike?.targetRounds, 3);
    assert.equal(roguelike?.lastEventKind, 'round');
    assert.equal(reclamation?.command, 'reclamation');
    assert.equal(reclamation?.theme, 'Tales');
    assert.equal(reclamation?.roundsStarted, 0);
    assert.equal(reclamation?.roundsEnded, 0);
    assert.equal(reclamation?.lastEventKind, 'task');
    assert.equal(reclamation?.currentAction, null);
    assert.equal(harness.state.parseCalls.some(call => call.taskchain === 'Reclamation'), true);
  });

  it('restores the default runtime on reset', () => {
    const harness = createHarness();
    startRoguelikeProgressTracker(trackerInput());
    assert.equal(harness.pendingTimers().length, 1);
    assert.equal(harness.timers.length, 1);

    resetRoguelikeProgressTrackerForTests();

    assert.equal(getRoguelikeProgress('run-1'), null);
    assert.equal(harness.pendingTimers().length, 0);
    assert.equal(startRoguelikeProgressTracker(trackerInput()), true);
    assert.equal(harness.timers.length, 1);
    assert.ok(getRoguelikeProgress('run-1'));
    releaseAllRoguelikeProgressTrackers();
  });
});
