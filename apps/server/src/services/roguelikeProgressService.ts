import { getCallbackDetails } from './maaCallbackService.ts';
import type { MaaCallbackEvent } from './maaCallbackService.ts';
import {
  applyBlackFlowProgressEvents,
  buildBlackFlowProgressSnapshot,
  createBlackFlowProgressState
} from './blackFlowProgressService.ts';
import type {
  BlackFlowProgressState,
  RoguelikeBlackFlowProgress
} from './blackFlowProgressService.ts';
import {
  readRoguelikeEvent,
  readRoguelikeInvestment,
  readRoguelikeSettlement,
  readRoguelikeTaskName
} from './roguelikeCallbackReaders.ts';
import type { RoguelikeInvestmentSummary } from './roguelikeCallbackReaders.ts';

export type RoguelikeCommand = 'roguelike' | 'reclamation';

export type RoguelikeRoundOutcome = 'passed' | 'not_passed' | 'unknown';

export type RoguelikeProgressPhase = 'starting' | 'exploring' | 'ended' | 'unknown';

export type RoguelikeLastEventKind = 'round' | 'combat' | 'event' | 'investment' | 'task';

export interface RoguelikeProgressRound {
  index: number | null;
  outcome: RoguelikeRoundOutcome;
  settled: boolean;
  floor: number | null;
  score: number | null;
  endedAt: string | null;
}

export interface RoguelikeProgressInvestment {
  rounds: number;
  count: number;
  total: number | null;
  deposit: number | null;
}

export interface RoguelikeProgressSnapshot {
  command: RoguelikeCommand;
  theme: string;
  mode: number | null;
  phase: RoguelikeProgressPhase;
  currentRound: number | null;
  roundStartedAt: string | null;
  targetRounds: number | null;
  roundsStarted: number;
  roundsEnded: number;
  roundsSettled: number;
  roundsPassed: number;
  settlementSupported: boolean | null;
  currentAction: string | null;
  lastEventKind: RoguelikeLastEventKind | null;
  lastEventName: string | null;
  lastEventAt: string | null;
  combatCount: number;
  investment: RoguelikeProgressInvestment | null;
  recentRounds: RoguelikeProgressRound[];
  blackflow: RoguelikeBlackFlowProgress | null;
  updatedAt: string;
  degraded: boolean;
  observed: boolean;
}

export interface RoguelikeProgressSeed {
  command: RoguelikeCommand;
  theme: string;
  mode: number | null;
  targetRounds: number | null;
  settlementSupported: boolean | null;
  startedAtMs: number | null;
}

export interface RoguelikeProgressRoundState {
  index: number | null;
  outcome: RoguelikeRoundOutcome;
  settled: boolean;
  floor: number | null;
  score: number | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
  endedByMarker: boolean;
  endedCounted: boolean;
  passedCounted: boolean;
}

export interface RoguelikeProgressState {
  command: RoguelikeCommand;
  theme: string;
  mode: number | null;
  targetRounds: number | null;
  settlementSupported: boolean | null;
  startedAtMs: number | null;
  phase: RoguelikeProgressPhase;
  currentRound: RoguelikeProgressRoundState | null;
  closedRounds: RoguelikeProgressRoundState[];
  roundsStarted: number;
  roundsEnded: number;
  roundsSettled: number;
  roundsPassed: number;
  currentAction: string | null;
  lastEventKind: RoguelikeLastEventKind | null;
  lastEventName: string | null;
  lastEventAtMs: number | null;
  combatCount: number;
  investment: RoguelikeInvestmentSummary | null;
  blackflow: BlackFlowProgressState;
  updatedAtMs: number | null;
  degraded: boolean;
  observed: boolean;
}

const START_EXPLORE_TASK = 'StartExplore';
const GAME_PASS_TASK = 'GamePass';
const MISSION_FAILED_TASK = 'MissionFailedFlag2';
const EXIT_THEN_ABANDON_TASK = 'ExitThenAbandon';
const UNBOUNDED_MAX_TIMES = 2147483647;

const TASKCHAIN_CALLBACKS = new Set([
  'TaskChainStart',
  'TaskChainCompleted',
  'TaskChainError',
  'TaskChainStopped'
]);

function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function readTargetRounds(value: unknown): number | null {
  const maxTimes = readPositiveInteger(value);
  return maxTimes !== null && maxTimes !== UNBOUNDED_MAX_TIMES ? maxTimes : null;
}

function readDetailText(event: MaaCallbackEvent, field: string): string | null {
  const value = getCallbackDetails(event)?.[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function eventTime(event: MaaCallbackEvent): number | null {
  return finiteTime(event.atMs);
}

function toIso(atMs: number | null): string | null {
  const time = finiteTime(atMs);
  return time === null ? null : new Date(time).toISOString();
}

function resolvePhase(
  state: RoguelikeProgressState,
  phase: RoguelikeProgressPhase | null
): RoguelikeProgressPhase {
  if (phase === null) return state.phase;
  if (phase === 'starting') return 'starting';
  return state.phase === 'ended' ? 'ended' : phase;
}

function withObservedEvent(
  state: RoguelikeProgressState,
  event: MaaCallbackEvent,
  phase: RoguelikeProgressPhase | null
): RoguelikeProgressState {
  const atMs = eventTime(event);
  return {
    ...state,
    phase: resolvePhase(state, phase),
    observed: true,
    updatedAtMs: atMs ?? state.updatedAtMs,
    lastEventAtMs: atMs
  };
}

function withActionEvent(
  state: RoguelikeProgressState,
  event: MaaCallbackEvent,
  kind: RoguelikeLastEventKind,
  name: string | null,
  action: string | null,
  phase: RoguelikeProgressPhase | null = 'exploring'
): RoguelikeProgressState {
  return {
    ...withObservedEvent(state, event, phase),
    lastEventKind: kind,
    lastEventName: name,
    currentAction: action
  };
}

function openRound(state: RoguelikeProgressState, event: MaaCallbackEvent): RoguelikeProgressState {
  const details = getCallbackDetails(event);
  const closedRounds = state.currentRound
    ? [...state.closedRounds, { ...state.currentRound, endedAtMs: null, endedByMarker: false }]
    : state.closedRounds;
  const roundsStarted = state.roundsStarted + 1;
  const execTimes = readPositiveInteger(details?.exec_times);

  return {
    ...state,
    targetRounds: state.targetRounds ?? readTargetRounds(details?.max_times),
    closedRounds,
    currentRound: {
      index: execTimes ?? roundsStarted,
      outcome: 'unknown',
      settled: false,
      floor: null,
      score: null,
      startedAtMs: eventTime(event),
      endedAtMs: null,
      endedByMarker: false,
      endedCounted: false,
      passedCounted: false
    },
    roundsStarted
  };
}

function applyMarkerToRound(
  round: RoguelikeProgressRoundState,
  passed: boolean,
  atMs: number | null
): { round: RoguelikeProgressRoundState; endedIncrement: number; passedIncrement: number } | null {
  if (round.endedByMarker) return null;

  const outcome: RoguelikeRoundOutcome = passed ? 'passed' : round.outcome === 'passed' ? 'passed' : 'not_passed';

  return {
    round: {
      ...round,
      outcome,
      endedAtMs: round.endedAtMs ?? atMs,
      endedByMarker: true,
      endedCounted: true,
      passedCounted: round.passedCounted || outcome === 'passed'
    },
    endedIncrement: round.endedCounted ? 0 : 1,
    passedIncrement: !round.passedCounted && outcome === 'passed' ? 1 : 0
  };
}

function applyMarkerToClosed(
  state: RoguelikeProgressState,
  roundIndex: number,
  passed: boolean,
  atMs: number | null
): RoguelikeProgressState {
  const applied = applyMarkerToRound(state.closedRounds[roundIndex], passed, atMs);
  if (!applied) return state;

  return {
    ...state,
    closedRounds: state.closedRounds.map((round, index) => index === roundIndex ? applied.round : round),
    roundsEnded: state.roundsEnded + applied.endedIncrement,
    roundsPassed: state.roundsPassed + applied.passedIncrement
  };
}

function closeRoundByMarker(
  state: RoguelikeProgressState,
  event: MaaCallbackEvent,
  taskName: string
): RoguelikeProgressState {
  const atMs = eventTime(event);
  const passed = taskName === GAME_PASS_TASK;
  const execTimes = readPositiveInteger(getCallbackDetails(event)?.exec_times);

  if (execTimes !== null) {
    const uncountedIndex = state.closedRounds.findIndex(
      round => round.index === execTimes && !round.endedCounted
    );
    if (uncountedIndex !== -1) return applyMarkerToClosed(state, uncountedIndex, passed, atMs);

    const unconfirmedIndex = state.closedRounds.findIndex(
      round => round.index === execTimes && !round.endedByMarker
    );
    if (unconfirmedIndex !== -1) return applyMarkerToClosed(state, unconfirmedIndex, passed, atMs);

    if (state.closedRounds.some(round => round.index === execTimes)) return state;
  }

  const current = state.currentRound;
  if (current) {
    const applied = applyMarkerToRound(current, passed, atMs);
    if (!applied) return state;

    return {
      ...state,
      currentRound: null,
      closedRounds: [...state.closedRounds, applied.round],
      roundsEnded: state.roundsEnded + applied.endedIncrement,
      roundsPassed: state.roundsPassed + applied.passedIncrement
    };
  }

  const earliestUncounted = state.closedRounds.findIndex(round => !round.endedCounted);
  if (earliestUncounted !== -1) return applyMarkerToClosed(state, earliestUncounted, passed, atMs);

  const unconfirmed = state.closedRounds.findLastIndex(round => !round.endedByMarker);
  if (unconfirmed !== -1) return applyMarkerToClosed(state, unconfirmed, passed, atMs);

  if (state.closedRounds.length > 0) return state;

  return {
    ...state,
    closedRounds: [{
      index: null,
      outcome: passed ? 'passed' : 'not_passed',
      settled: false,
      floor: null,
      score: null,
      startedAtMs: null,
      endedAtMs: atMs,
      endedByMarker: true,
      endedCounted: true,
      passedCounted: passed
    }],
    roundsEnded: state.roundsEnded + 1,
    roundsPassed: state.roundsPassed + (passed ? 1 : 0)
  };
}

function settleRound(
  round: RoguelikeProgressRoundState,
  gamePass: boolean | null,
  floor: number | null,
  score: number | null
): RoguelikeProgressRoundState {
  const outcome: RoguelikeRoundOutcome = gamePass === true
    ? 'passed'
    : gamePass === false && round.outcome === 'unknown'
      ? 'not_passed'
      : round.outcome;

  return {
    ...round,
    outcome,
    settled: true,
    floor: floor ?? round.floor,
    score: score ?? round.score,
    passedCounted: round.passedCounted || outcome === 'passed'
  };
}

function applySettlement(
  state: RoguelikeProgressState,
  event: MaaCallbackEvent
): RoguelikeProgressState {
  const settlement = readRoguelikeSettlement(event);
  const atMs = eventTime(event);
  const gamePass = settlement?.gamePass ?? null;
  const floor = settlement?.floor ?? null;
  const score = settlement?.score ?? null;
  const current = state.currentRound;

  if (current) {
    const closed = {
      ...settleRound(
        { ...current, endedAtMs: current.endedAtMs ?? atMs },
        gamePass,
        floor,
        score
      ),
      endedCounted: true
    };
    return {
      ...state,
      currentRound: null,
      closedRounds: [...state.closedRounds, closed],
      roundsEnded: state.roundsEnded + 1,
      roundsSettled: state.roundsSettled + 1,
      roundsPassed: state.roundsPassed + (!current.passedCounted && closed.outcome === 'passed' ? 1 : 0)
    };
  }

  const pendingIndex = state.closedRounds.findLastIndex(round => !round.settled);
  if (pendingIndex !== -1) {
    const pending = state.closedRounds[pendingIndex];
    const settled = {
      ...settleRound(
        { ...pending, endedAtMs: pending.endedAtMs ?? atMs },
        gamePass,
        floor,
        score
      ),
      endedCounted: true
    };
    return {
      ...state,
      closedRounds: state.closedRounds.map((round, index) => index === pendingIndex ? settled : round),
      roundsEnded: state.roundsEnded + (pending.endedCounted ? 0 : 1),
      roundsSettled: state.roundsSettled + 1,
      roundsPassed: state.roundsPassed + (!pending.passedCounted && settled.outcome === 'passed' ? 1 : 0)
    };
  }

  if (state.closedRounds.length > 0) return state;

  const created = {
    ...settleRound({
      index: null,
      outcome: 'unknown',
      settled: false,
      floor: null,
      score: null,
      startedAtMs: null,
      endedAtMs: atMs,
      endedByMarker: false,
      endedCounted: false,
      passedCounted: false
    }, gamePass, floor, score),
    endedCounted: true
  };

  return {
    ...state,
    closedRounds: [created],
    roundsEnded: state.roundsEnded + 1,
    roundsSettled: 1,
    roundsPassed: created.passedCounted ? 1 : 0
  };
}

function handleTaskChain(
  state: RoguelikeProgressState,
  event: MaaCallbackEvent
): RoguelikeProgressState {
  if (event.callback === 'TaskChainStart') {
    return withActionEvent(state, event, 'task', null, event.callback, 'starting');
  }
  return withActionEvent(state, event, 'task', null, event.callback, 'ended');
}

function handleSubTaskStart(
  state: RoguelikeProgressState,
  event: MaaCallbackEvent
): RoguelikeProgressState {
  const taskName = readRoguelikeTaskName(event);

  if (state.command === 'reclamation') {
    return withActionEvent(state, event, 'task', readDetailText(event, 'task'), null, null);
  }

  if (taskName === START_EXPLORE_TASK) {
    return withActionEvent(openRound(state, event), event, 'round', null, START_EXPLORE_TASK);
  }
  if (taskName === GAME_PASS_TASK || taskName === MISSION_FAILED_TASK) {
    return withActionEvent(
      closeRoundByMarker(state, event, taskName),
      event,
      'round',
      null,
      taskName
    );
  }
  if (taskName === EXIT_THEN_ABANDON_TASK) {
    return withActionEvent(state, event, 'round', null, EXIT_THEN_ABANDON_TASK);
  }

  return withObservedEvent(state, event, 'exploring');
}

function handleSubTaskExtraInfo(
  state: RoguelikeProgressState,
  event: MaaCallbackEvent
): RoguelikeProgressState {
  if (state.command !== 'roguelike') return state;

  const what = typeof event.what === 'string' ? event.what : '';
  if (what === 'RoguelikeSettlement') {
    return withObservedEvent(applySettlement(state, event), event, 'exploring');
  }
  if (what === 'StageInfo') {
    return withActionEvent(state, event, 'combat', readDetailText(event, 'name'), 'StageInfo');
  }
  if (what === 'RoguelikeCombatEnd') {
    return withActionEvent(
      { ...state, combatCount: state.combatCount + 1 },
      event,
      'combat',
      null,
      'RoguelikeCombatEnd'
    );
  }
  if (what === 'RoguelikeEvent' || what === 'RoguelikeEventSelected') {
    return withActionEvent(state, event, 'event', readRoguelikeEvent(event)?.name ?? null, what);
  }
  if (what === 'RoguelikeInvestment') {
    return withActionEvent(
      { ...state, investment: readRoguelikeInvestment(event, state.investment) },
      event,
      'investment',
      null,
      'RoguelikeInvestment'
    );
  }

  return state;
}

function applyEvent(
  state: RoguelikeProgressState,
  event: MaaCallbackEvent
): RoguelikeProgressState {
  if (TASKCHAIN_CALLBACKS.has(event.callback)) return handleTaskChain(state, event);
  if (event.callback === 'SubTaskStart') return handleSubTaskStart(state, event);
  if (event.callback === 'SubTaskExtraInfo') return handleSubTaskExtraInfo(state, event);
  return state;
}

export function createRoguelikeProgressState(seed: RoguelikeProgressSeed): RoguelikeProgressState {
  return {
    command: seed.command,
    theme: seed.theme,
    mode: seed.mode,
    targetRounds: seed.targetRounds,
    settlementSupported: seed.settlementSupported,
    startedAtMs: finiteTime(seed.startedAtMs),
    phase: 'starting',
    currentRound: null,
    closedRounds: [],
    roundsStarted: 0,
    roundsEnded: 0,
    roundsSettled: 0,
    roundsPassed: 0,
    currentAction: null,
    lastEventKind: null,
    lastEventName: null,
    lastEventAtMs: null,
    combatCount: 0,
    investment: null,
    blackflow: createBlackFlowProgressState(),
    updatedAtMs: null,
    degraded: false,
    observed: false
  };
}

export function applyRoguelikeProgressEvents(
  state: RoguelikeProgressState,
  events: readonly MaaCallbackEvent[]
): RoguelikeProgressState {
  let next = state;
  for (const event of events) {
    next = applyEvent(next, event);
    if (next.command === 'roguelike') {
      const blackflow = applyBlackFlowProgressEvents(next.blackflow, [event]);
      if (blackflow !== next.blackflow) next = { ...next, blackflow };
    }
  }
  return next;
}

export function buildRoguelikeProgressSnapshot(
  state: RoguelikeProgressState,
  nowMs?: number
): RoguelikeProgressSnapshot {
  const current = state.currentRound;
  const providedNowMs = finiteTime(nowMs);
  const updatedAtMs = finiteTime(state.updatedAtMs) ?? finiteTime(state.startedAtMs) ?? providedNowMs ?? Date.now();

  return {
    command: state.command,
    theme: state.theme,
    mode: state.mode,
    phase: state.phase,
    currentRound: current?.index ?? null,
    roundStartedAt: toIso(current?.startedAtMs ?? null),
    targetRounds: state.targetRounds,
    roundsStarted: state.roundsStarted,
    roundsEnded: state.roundsEnded,
    roundsSettled: state.roundsSettled,
    roundsPassed: state.roundsPassed,
    settlementSupported: state.settlementSupported,
    currentAction: state.currentAction,
    lastEventKind: state.lastEventKind,
    lastEventName: state.lastEventName,
    lastEventAt: toIso(state.lastEventAtMs),
    combatCount: state.combatCount,
    investment: state.investment
      ? {
          rounds: state.investment.rounds,
          count: state.investment.count,
          total: state.investment.total,
          deposit: state.investment.deposit
        }
      : null,
    recentRounds: state.closedRounds.slice(-5).reverse().map(round => ({
      index: round.index,
      outcome: round.outcome,
      settled: round.settled,
      floor: round.floor,
      score: round.score,
      endedAt: toIso(round.endedAtMs)
    })),
    blackflow: buildBlackFlowProgressSnapshot(state.blackflow),
    updatedAt: new Date(updatedAtMs).toISOString(),
    degraded: state.degraded,
    observed: state.observed
  };
}

export function markRoguelikeProgressDegraded(
  state: RoguelikeProgressState
): RoguelikeProgressState {
  return state.degraded ? state : { ...state, degraded: true };
}
