import type { MaaCallbackEvent } from './maaCallbackService.ts';
import {
  readBlackFlowMapSummary,
  readBlackFlowMilestone,
  readBlackFlowNodeResolution,
  readBlackFlowRoutingDecision,
  readBlackFlowStrategyResult,
  readBlackFlowStrategyStarted
} from './blackFlowCallbackReaders.ts';
import type { BlackFlowNodeResolutionProgress } from './blackFlowCallbackReaders.ts';

export interface RoguelikeBlackFlowNode {
  id: string;
  name: string | null;
  type: string | null;
}

export interface RoguelikeBlackFlowActionPoints {
  before: number | null;
  after: number | null;
  at: string | null;
}

export interface RoguelikeBlackFlowRoute {
  at: string | null;
  floor: number | null;
  target: RoguelikeBlackFlowNode | null;
  landing: RoguelikeBlackFlowNode | null;
  movement: string | null;
  actionPointsBefore: number | null;
  actionPointsAfter: number | null;
  exactCost: number | null;
  predictedCost: number | null;
  arrived: boolean;
}

export interface RoguelikeBlackFlowNodeResolution {
  at: string | null;
  floor: number | null;
  node: RoguelikeBlackFlowNode | null;
  eventName: string | null;
  progress: BlackFlowNodeResolutionProgress | null;
}

export interface RoguelikeBlackFlowMilestone {
  id: string;
  floor: number | null;
  progress: number | null;
  status: string;
  at: string | null;
}

export interface RoguelikeBlackFlowStrategy {
  at: string | null;
  profile: string | null;
  outcome: string | null;
  terminationReason: string | null;
  nextAction: string | null;
  succeeded: boolean | null;
}

export interface RoguelikeBlackFlowProgress {
  floor: number | null;
  floorAt: string | null;
  currentNode: RoguelikeBlackFlowNode | null;
  currentNodeAt: string | null;
  actionPoints: RoguelikeBlackFlowActionPoints | null;
  lastRoute: RoguelikeBlackFlowRoute | null;
  lastNodeResolution: RoguelikeBlackFlowNodeResolution | null;
  milestones: RoguelikeBlackFlowMilestone[];
  strategy: RoguelikeBlackFlowStrategy | null;
  updatedAt: string | null;
}

export interface BlackFlowProgressNodeIdentity {
  name: string | null;
  type: string | null;
}

export interface BlackFlowProgressActionPoints {
  before: number | null;
  after: number | null;
  atMs: number | null;
}

export interface BlackFlowProgressRoute {
  atMs: number | null;
  floor: number | null;
  target: RoguelikeBlackFlowNode | null;
  landingId: string | null;
  movement: string | null;
  actionPointsBefore: number | null;
  actionPointsAfter: number | null;
  exactCost: number | null;
  predictedCost: number | null;
  arrived: boolean;
  decisionId: string;
  transactionId: string | null;
  sequence: number;
}

export interface BlackFlowProgressResolution {
  atMs: number | null;
  floor: number | null;
  nodeId: string | null;
  nodeType: string | null;
  eventName: string | null;
  progress: BlackFlowNodeResolutionProgress | null;
}

export interface BlackFlowProgressMilestone {
  id: string;
  floor: number | null;
  progress: number | null;
  status: string;
  atMs: number | null;
}

export interface BlackFlowProgressStrategy {
  atMs: number | null;
  profile: string | null;
  outcome: string | null;
  terminationReason: string | null;
  nextAction: string | null;
  succeeded: boolean | null;
}

export type BlackFlowFloorSource = 'map' | 'route' | 'milestone';

export interface BlackFlowProgressState {
  observed: boolean;
  profile: string | null;
  runRevision: number | null;
  floor: number | null;
  floorAtMs: number | null;
  floorSource: BlackFlowFloorSource | null;
  mapRevision: number | null;
  lastObservationSeq: number | null;
  currentNode: string | null;
  currentNodeAtMs: number | null;
  nodeIdentity: Map<string, BlackFlowProgressNodeIdentity>;
  actionPoints: BlackFlowProgressActionPoints | null;
  lastRoute: BlackFlowProgressRoute | null;
  lastResolution: BlackFlowProgressResolution | null;
  milestones: BlackFlowProgressMilestone[];
  strategy: BlackFlowProgressStrategy | null;
  strategyAtMs: number | null;
  strategyEnded: boolean;
  updatedAtMs: number | null;
  lastDecisionSeq: number | null;
  seenTransactions: Set<string>;
}

const NODE_IDENTITY_LIMIT = 32;
const BLACK_FLOW_WHAT = new Set([
  'BlackFlowMapSummary',
  'BlackFlowRoutingDecision',
  'BlackFlowNodeResolution',
  'BlackFlowMilestoneChanged',
  'BlackFlowStrategyStarted',
  'BlackFlowStrategyResult'
]);

function finiteTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function eventTime(event: MaaCallbackEvent): number | null {
  return finiteTime(event.atMs);
}

function toIso(atMs: number | null): string | null {
  return atMs === null ? null : new Date(atMs).toISOString();
}

function parseObservationSequence(observationId: string | null): number | null {
  if (observationId === null) return null;
  const match = /^BF-O(\d+)$/.exec(observationId);
  if (!match) return null;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

function parseDecisionSequence(decisionId: string | null): number | null {
  if (decisionId === null) return null;
  const match = /(?:^|[-_])(\d+)$/.exec(decisionId);
  if (!match) return null;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

function withUpdatedAt(state: BlackFlowProgressState, atMs: number | null): BlackFlowProgressState {
  return { ...state, updatedAtMs: atMs };
}

function resetRunState(
  state: BlackFlowProgressState,
  runRevision: number | null
): BlackFlowProgressState {
  return {
    ...state,
    runRevision,
    floor: null,
    floorAtMs: null,
    floorSource: null,
    mapRevision: null,
    lastObservationSeq: null,
    currentNode: null,
    currentNodeAtMs: null,
    nodeIdentity: new Map(),
    actionPoints: null,
    lastRoute: null,
    lastResolution: null,
    milestones: [],
    strategy: null,
    strategyAtMs: null,
    strategyEnded: false,
    lastDecisionSeq: null,
    seenTransactions: new Set()
  };
}

function applyRunRevision(
  state: BlackFlowProgressState,
  runRevision: number | null
): BlackFlowProgressState | null {
  if (runRevision === null) return state;
  if (state.runRevision === null) return { ...state, runRevision };
  if (runRevision < state.runRevision) return null;
  if (runRevision > state.runRevision) return resetRunState(state, runRevision);
  return state;
}

function refreshesFloorTimestamp(
  current: BlackFlowFloorSource | null,
  next: BlackFlowFloorSource
): boolean {
  if (next === 'map') return true;
  if (next === 'route') return current !== 'map';
  return current === null || current === 'milestone';
}

function withFloor(
  state: BlackFlowProgressState,
  floor: number,
  atMs: number | null,
  source: BlackFlowFloorSource
): BlackFlowProgressState {
  if (state.floor !== null && floor < state.floor) return state;
  if (state.floor === floor) {
    if (!refreshesFloorTimestamp(state.floorSource, source)) return state;
    return { ...state, floorAtMs: atMs, floorSource: source };
  }
  return {
    ...state,
    floor,
    floorAtMs: atMs,
    floorSource: source,
    currentNode: null,
    currentNodeAtMs: null,
    nodeIdentity: new Map(),
    actionPoints: null
  };
}

function rememberNodeIdentity(
  identities: Map<string, BlackFlowProgressNodeIdentity>,
  id: string | null,
  name: string | null,
  type: string | null
): Map<string, BlackFlowProgressNodeIdentity> {
  if (id === null) return identities;

  const existing = identities.get(id);
  const nextName = name ?? existing?.name ?? null;
  const nextType = type ?? existing?.type ?? null;
  if (existing && existing.name === nextName && existing.type === nextType) return identities;
  if (!existing && nextName === null && nextType === null) return identities;

  const next = new Map(identities);
  next.delete(id);
  next.set(id, { name: nextName, type: nextType });
  while (next.size > NODE_IDENTITY_LIMIT) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}

function markRouteArrived(
  route: BlackFlowProgressRoute | null,
  nodeId: string | null
): BlackFlowProgressRoute | null {
  if (route === null || nodeId === null || route.arrived) return route;
  if (route.target?.id === nodeId || route.landingId === nodeId) {
    return { ...route, arrived: true };
  }
  return route;
}

function applyMapSummary(
  state: BlackFlowProgressState,
  event: MaaCallbackEvent
): BlackFlowProgressState {
  const summary = readBlackFlowMapSummary(event);
  if (summary === null) return state;

  let next = applyRunRevision(state, summary.runRevision);
  if (next === null) return state;
  if (next.strategyEnded) return next;

  if (summary.floor !== null && next.floor !== null && summary.floor < next.floor) return next;
  if (summary.mapRevision !== null && next.mapRevision !== null) {
    if (summary.mapRevision < next.mapRevision) return next;
    if (summary.mapRevision === next.mapRevision) {
      const sequence = parseObservationSequence(summary.observationId);
      if (
        sequence !== null &&
        next.lastObservationSeq !== null &&
        sequence <= next.lastObservationSeq
      ) {
        return next;
      }
    }
  }

  const atMs = eventTime(event);
  if (summary.floor !== null) next = withFloor(next, summary.floor, atMs, 'map');
  if (summary.mapRevision !== null) next = { ...next, mapRevision: summary.mapRevision };

  const sequence = parseObservationSequence(summary.observationId);
  if (sequence !== null) next = { ...next, lastObservationSeq: sequence };

  if (summary.updatedNode !== null) {
    next = {
      ...next,
      nodeIdentity: rememberNodeIdentity(next.nodeIdentity, summary.updatedNode, null, null)
    };
  }

  if (summary.currentNode !== null) {
    next = {
      ...next,
      currentNode: summary.currentNode,
      currentNodeAtMs: atMs,
      lastRoute: markRouteArrived(next.lastRoute, summary.currentNode)
    };
  }

  return withUpdatedAt(next, atMs);
}

function applyRoutingDecision(
  state: BlackFlowProgressState,
  event: MaaCallbackEvent
): BlackFlowProgressState {
  const decision = readBlackFlowRoutingDecision(event);
  if (decision === null) return state;

  let next = applyRunRevision(state, decision.runRevision);
  if (next === null) return state;
  if (next.strategyEnded) return next;

  if (decision.floor !== null && next.floor !== null && decision.floor < next.floor) return next;

  if (decision.decisionId === null) return next;
  const sequence = parseDecisionSequence(decision.decisionId);
  if (sequence === null) return next;
  if (next.lastDecisionSeq !== null && sequence <= next.lastDecisionSeq) return next;

  const atMs = eventTime(event);
  if (decision.floor !== null) next = withFloor(next, decision.floor, atMs, 'route');

  const target: RoguelikeBlackFlowNode | null = decision.target === null
    ? null
    : { id: decision.target, name: decision.nodeName, type: decision.nodeType };
  const actionPoints = decision.actionPointsBefore === null && decision.actionPointsAfter === null
    ? null
    : {
        before: decision.actionPointsBefore,
        after: decision.actionPointsAfter,
        atMs
      };
  const route: BlackFlowProgressRoute = {
    atMs,
    floor: decision.floor,
    target,
    landingId: decision.landing,
    movement: decision.movement,
    actionPointsBefore: decision.actionPointsBefore,
    actionPointsAfter: decision.actionPointsAfter,
    exactCost: decision.exactCost,
    predictedCost: decision.predictedCost,
    arrived: false,
    decisionId: decision.decisionId,
    transactionId: decision.transactionId,
    sequence
  };

  next = {
    ...next,
    lastDecisionSeq: sequence,
    nodeIdentity: rememberNodeIdentity(
      next.nodeIdentity,
      decision.target,
      decision.nodeName,
      decision.nodeType
    ),
    lastRoute: route,
    actionPoints,
    updatedAtMs: atMs
  };

  return next;
}

function applyNodeResolution(
  state: BlackFlowProgressState,
  event: MaaCallbackEvent
): BlackFlowProgressState {
  const resolution = readBlackFlowNodeResolution(event);
  if (resolution === null) return state;

  let next = applyRunRevision(state, resolution.runRevision);
  if (next === null) return state;
  if (next.strategyEnded) return next;

  if (resolution.floor !== null && next.floor !== null && resolution.floor < next.floor) return next;
  if (resolution.transactionId !== null && next.seenTransactions.has(resolution.transactionId)) {
    return next;
  }

  const atMs = eventTime(event);

  let seenTransactions = next.seenTransactions;
  if (resolution.transactionId !== null) {
    seenTransactions = new Set(next.seenTransactions);
    seenTransactions.add(resolution.transactionId);
  }

  const route = next.lastRoute;
  const lastRoute = route !== null &&
    resolution.transactionId !== null &&
    route.transactionId === resolution.transactionId
    ? { ...route, arrived: true }
    : route;

  return {
    ...next,
    seenTransactions,
    nodeIdentity: rememberNodeIdentity(
      next.nodeIdentity,
      resolution.node,
      resolution.eventName,
      resolution.nodeType
    ),
    lastRoute,
    lastResolution: {
      atMs,
      floor: resolution.floor,
      nodeId: resolution.node,
      nodeType: resolution.nodeType,
      eventName: resolution.eventName,
      progress: resolution.progress
    },
    updatedAtMs: atMs
  };
}

function applyMilestone(
  state: BlackFlowProgressState,
  event: MaaCallbackEvent
): BlackFlowProgressState {
  const milestone = readBlackFlowMilestone(event);
  if (milestone === null) return state;

  let next = applyRunRevision(state, milestone.runRevision);
  if (next === null) return state;

  const existing = next.milestones.find(item => item.id === milestone.milestoneId);
  if (existing && existing.status === milestone.status) return next;

  const atMs = eventTime(event);
  const usesMilestoneFloor = next.floorSource === null || next.floorSource === 'milestone';
  if (!next.strategyEnded && usesMilestoneFloor && milestone.floor !== null) {
    next = withFloor(next, milestone.floor, atMs, 'milestone');
  }

  const updated: BlackFlowProgressMilestone = {
    id: milestone.milestoneId,
    floor: milestone.floor ?? existing?.floor ?? null,
    progress: milestone.progress ?? existing?.progress ?? null,
    status: milestone.status,
    atMs: atMs ?? existing?.atMs ?? null
  };

  return withUpdatedAt({
    ...next,
    milestones: [...next.milestones.filter(item => item.id !== milestone.milestoneId), updated]
  }, atMs);
}

function applyStrategyStarted(
  state: BlackFlowProgressState,
  event: MaaCallbackEvent
): BlackFlowProgressState {
  const profile = readBlackFlowStrategyStarted(event);
  const atMs = eventTime(event);
  const reset = resetRunState(state, null);

  if (profile === null) {
    return {
      ...reset,
      profile: null,
      updatedAtMs: atMs
    };
  }

  return {
    ...reset,
    profile,
    strategy: {
      atMs,
      profile,
      outcome: null,
      terminationReason: null,
      nextAction: null,
      succeeded: null
    },
    strategyAtMs: atMs,
    updatedAtMs: atMs
  };
}

function applyStrategyResult(
  state: BlackFlowProgressState,
  event: MaaCallbackEvent
): BlackFlowProgressState {
  const result = readBlackFlowStrategyResult(event);
  if (result === null) return state;

  const atMs = eventTime(event);
  const profile = result.profile ?? state.profile;
  const strategy: BlackFlowProgressStrategy = {
    atMs: atMs ?? state.strategy?.atMs ?? state.strategyAtMs,
    profile,
    outcome: result.outcome,
    terminationReason: result.terminationReason,
    nextAction: result.nextAction,
    succeeded: result.succeeded
  };

  return {
    ...state,
    profile,
    strategy,
    strategyAtMs: strategy.atMs,
    strategyEnded: true,
    updatedAtMs: atMs
  };
}

function applyEvent(
  state: BlackFlowProgressState,
  event: MaaCallbackEvent
): BlackFlowProgressState {
  if (event.callback !== 'SubTaskExtraInfo') return state;

  const what = typeof event.what === 'string' ? event.what : '';
  if (!what.startsWith('BlackFlow') || !BLACK_FLOW_WHAT.has(what)) return state;

  const observed = state.observed ? state : { ...state, observed: true };

  switch (what) {
    case 'BlackFlowMapSummary':
      return applyMapSummary(observed, event);
    case 'BlackFlowRoutingDecision':
      return applyRoutingDecision(observed, event);
    case 'BlackFlowNodeResolution':
      return applyNodeResolution(observed, event);
    case 'BlackFlowMilestoneChanged':
      return applyMilestone(observed, event);
    case 'BlackFlowStrategyStarted':
      return applyStrategyStarted(observed, event);
    case 'BlackFlowStrategyResult':
      return applyStrategyResult(observed, event);
    default:
      return observed;
  }
}

function nodeFromId(
  id: string | null,
  identities: Map<string, BlackFlowProgressNodeIdentity>
): RoguelikeBlackFlowNode | null {
  if (id === null) return null;
  const identity = identities.get(id);
  return {
    id,
    name: identity?.name ?? null,
    type: identity?.type ?? null
  };
}

function mergeNodeIdentity(
  node: RoguelikeBlackFlowNode,
  identities: Map<string, BlackFlowProgressNodeIdentity>
): RoguelikeBlackFlowNode {
  const identity = identities.get(node.id);
  return {
    id: node.id,
    name: node.name ?? identity?.name ?? null,
    type: node.type ?? identity?.type ?? null
  };
}

export function createBlackFlowProgressState(): BlackFlowProgressState {
  return {
    observed: false,
    profile: null,
    runRevision: null,
    floor: null,
    floorAtMs: null,
    floorSource: null,
    mapRevision: null,
    lastObservationSeq: null,
    currentNode: null,
    currentNodeAtMs: null,
    nodeIdentity: new Map(),
    actionPoints: null,
    lastRoute: null,
    lastResolution: null,
    milestones: [],
    strategy: null,
    strategyAtMs: null,
    strategyEnded: false,
    updatedAtMs: null,
    lastDecisionSeq: null,
    seenTransactions: new Set()
  };
}

export function applyBlackFlowProgressEvents(
  state: BlackFlowProgressState,
  events: readonly MaaCallbackEvent[]
): BlackFlowProgressState {
  let next = state;
  for (const event of events) {
    next = applyEvent(next, event);
  }
  return next;
}

export function buildBlackFlowProgressSnapshot(
  state: BlackFlowProgressState
): RoguelikeBlackFlowProgress | null {
  if (!state.observed) return null;

  const route = state.lastRoute;
  const resolution = state.lastResolution;

  return {
    floor: state.floor,
    floorAt: toIso(state.floorAtMs),
    currentNode: nodeFromId(state.currentNode, state.nodeIdentity),
    currentNodeAt: toIso(state.currentNodeAtMs),
    actionPoints: state.actionPoints
      ? {
          before: state.actionPoints.before,
          after: state.actionPoints.after,
          at: toIso(state.actionPoints.atMs)
        }
      : null,
    lastRoute: route
      ? {
          at: toIso(route.atMs),
          floor: route.floor,
          target: route.target ? mergeNodeIdentity(route.target, state.nodeIdentity) : null,
          landing: nodeFromId(route.landingId, state.nodeIdentity),
          movement: route.movement,
          actionPointsBefore: route.actionPointsBefore,
          actionPointsAfter: route.actionPointsAfter,
          exactCost: route.exactCost,
          predictedCost: route.predictedCost,
          arrived: route.arrived
        }
      : null,
    lastNodeResolution: resolution
      ? {
          at: toIso(resolution.atMs),
          floor: resolution.floor,
          node: nodeFromId(resolution.nodeId, state.nodeIdentity),
          eventName: resolution.eventName,
          progress: resolution.progress
        }
      : null,
    milestones: state.milestones.slice(-5).reverse().map(milestone => ({
      id: milestone.id,
      floor: milestone.floor,
      progress: milestone.progress,
      status: milestone.status,
      at: toIso(milestone.atMs)
    })),
    strategy: state.strategy
      ? {
          at: toIso(state.strategy.atMs),
          profile: state.strategy.profile,
          outcome: state.strategy.outcome,
          terminationReason: state.strategy.terminationReason,
          nextAction: state.strategy.nextAction,
          succeeded: state.strategy.succeeded
        }
      : null,
    updatedAt: toIso(state.updatedAtMs)
  };
}
