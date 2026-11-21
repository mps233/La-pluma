import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getCallbackDetails, parseMaaCallbackEvents } from '../maaCallbackService.ts';
import type { MaaCallbackEvent } from '../maaCallbackService.ts';
import {
  readBlackFlowMapSummary,
  readBlackFlowMilestone,
  readBlackFlowNodeResolution,
  readBlackFlowRoutingDecision,
  readBlackFlowStrategyResult,
  readBlackFlowStrategyStarted
} from '../blackFlowCallbackReaders.ts';
import {
  applyBlackFlowProgressEvents,
  buildBlackFlowProgressSnapshot,
  createBlackFlowProgressState
} from '../blackFlowProgressService.ts';
import type { RoguelikeBlackFlowProgress } from '../blackFlowProgressService.ts';

const BASE_TIME = new Date(2026, 10, 21, 21, 28, 27, 403).getTime();
const NODE_A = 281475010265088;
const NODE_B = 281475010265090;
const NODE_C = 281475010265092;
const NODE_D = 281475010265094;

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function fixtureTime(hour: number, minute: number, second: number, millisecond: number): number {
  return new Date(2026, 10, 21, hour, minute, second, millisecond).getTime();
}

function callbackEvent(
  what: string,
  details: Record<string, unknown>,
  atMs: number | null = BASE_TIME
): MaaCallbackEvent {
  return {
    callback: 'SubTaskExtraInfo',
    taskchain: 'Roguelike',
    what,
    details,
    ...(atMs === null ? {} : { atMs })
  };
}

function mapSummary(
  overrides: Record<string, unknown> = {},
  atMs: number | null = BASE_TIME
): MaaCallbackEvent {
  return callbackEvent('BlackFlowMapSummary', {
    run_revision: 2,
    map_revision: 1,
    observation_id: 'BF-O1',
    source: 'recognition',
    floor: 1,
    current_node: NODE_A,
    ...overrides
  }, atMs);
}

function routingDecision(
  overrides: Record<string, unknown> = {},
  atMs: number | null = BASE_TIME
): MaaCallbackEvent {
  return callbackEvent('BlackFlowRoutingDecision', {
    run_revision: 2,
    map_revision: 1,
    observation_id: 'BF-O1',
    floor: 1,
    decision_id: 'BF-D2-1',
    transaction_id: 'BF-T2-1',
    profile: 'burn_with_investment',
    source: NODE_A,
    target: NODE_B,
    landing: NODE_B,
    node_name: '作战',
    node_type: 'battle_normal',
    movement: 'walk',
    exact_cost: 1,
    predicted_cost: 1,
    action_points_before: 5,
    action_points_after: 4,
    ...overrides
  }, atMs);
}

function nodeResolution(
  overrides: Record<string, unknown> = {},
  atMs: number | null = BASE_TIME
): MaaCallbackEvent {
  return callbackEvent('BlackFlowNodeResolution', {
    run_revision: 2,
    floor: 1,
    decision_id: 'BF-D2-1',
    transaction_id: 'BF-T2-1',
    node: NODE_B,
    node_type: 'wish',
    event_name: '得偿所愿',
    progress: 'completed',
    page_revision: 2,
    ...overrides
  }, atMs);
}

function milestoneChanged(
  overrides: Record<string, unknown> = {},
  atMs: number | null = BASE_TIME
): MaaCallbackEvent {
  return callbackEvent('BlackFlowMilestoneChanged', {
    run_revision: 2,
    floor: 1,
    milestone_id: 'burn_floor1_final',
    progress: 0,
    status: 'available',
    ...overrides
  }, atMs);
}

function strategyStarted(
  profile: string | null = 'burn_with_investment',
  atMs: number | null = BASE_TIME
): MaaCallbackEvent {
  return callbackEvent('BlackFlowStrategyStarted', { profile }, atMs);
}

function strategyResult(
  overrides: Record<string, unknown> = {},
  atMs: number | null = BASE_TIME
): MaaCallbackEvent {
  return callbackEvent('BlackFlowStrategyResult', {
    profile: 'burn_with_investment',
    outcome: 'burn_completed',
    termination_reason: 'third_floor_reached',
    next_action: 'restart_current_run',
    succeeded: true,
    ...overrides
  }, atMs);
}

function snapshotOf(events: readonly MaaCallbackEvent[]): RoguelikeBlackFlowProgress | null {
  const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), events);
  return buildBlackFlowProgressSnapshot(state);
}

function detailOf(event: MaaCallbackEvent, field: string): unknown {
  return getCallbackDetails(event)?.[field];
}

describe('black flow callback readers', () => {
  it('reads native JSON fields from a map summary', () => {
    assert.deepEqual(
      readBlackFlowMapSummary(mapSummary({
        current_node: NODE_A,
        updated_node: NODE_B,
        floor_from_ocr: true,
        supplemented_exits: [[0, 4], [2, 4]]
      })),
      {
        runRevision: 2,
        mapRevision: 1,
        observationId: 'BF-O1',
        source: 'recognition',
        floor: 1,
        currentNode: String(NODE_A),
        updatedNode: String(NODE_B)
      }
    );
  });

  it('returns null for invalid or missing map summary fields', () => {
    assert.equal(readBlackFlowMapSummary(callbackEvent('RoguelikeSettlement', {})), null);
    assert.equal(readBlackFlowMapSummary(callbackEvent('BlackFlowMapSummary', {})), null);
    assert.equal(
      readBlackFlowMapSummary({
        callback: 'SubTaskExtraInfo',
        taskchain: 'Roguelike',
        what: 'BlackFlowMapSummary'
      }),
      null
    );

    assert.deepEqual(
      readBlackFlowMapSummary(mapSummary({
        run_revision: 2,
        map_revision: 1.5,
        observation_id: 42,
        source: false,
        floor: '1',
        current_node: String(NODE_A),
        updated_node: 18446744073709551615
      })),
      {
        runRevision: 2,
        mapRevision: null,
        observationId: null,
        source: null,
        floor: null,
        currentNode: null,
        updatedNode: null
      }
    );

    assert.equal(
      readBlackFlowMapSummary(mapSummary({
        run_revision: '2',
        map_revision: '1',
        observation_id: 42,
        source: false,
        floor: '1',
        current_node: String(NODE_A),
        updated_node: 18446744073709551615
      })),
      null
    );
  });

  it('reads routing decisions and normalizes node ids to strings', () => {
    assert.deepEqual(
      readBlackFlowRoutingDecision(routingDecision({
        source: NODE_A,
        target: NODE_B,
        landing: NODE_C,
        decision_id: 'BF-D2-7',
        transaction_id: 'BF-T2-8',
        exact_cost: null,
        predicted_cost: 2
      })),
      {
        runRevision: 2,
        decisionId: 'BF-D2-7',
        transactionId: 'BF-T2-8',
        profile: 'burn_with_investment',
        mapRevision: 1,
        floor: 1,
        source: String(NODE_A),
        target: String(NODE_B),
        landing: String(NODE_C),
        nodeName: '作战',
        nodeType: 'battle_normal',
        movement: 'walk',
        exactCost: null,
        predictedCost: 2,
        actionPointsBefore: 5,
        actionPointsAfter: 4
      }
    );
  });

  it('rejects invalid routing decision node ids and field types', () => {
    const decision = readBlackFlowRoutingDecision(routingDecision({
      source: -1,
      target: 1.5,
      landing: '281475010265088',
      action_points_before: '5',
      action_points_after: null,
      exact_cost: '1',
      predicted_cost: 2.5,
      movement: 7,
      node_name: '',
      node_type: false,
      decision_id: 'BF-D2-1',
      transaction_id: null,
      profile: {},
      map_revision: '2',
      floor: 0.5
    }));

    assert.deepEqual(decision, {
      runRevision: 2,
      decisionId: 'BF-D2-1',
      transactionId: null,
      profile: null,
      mapRevision: null,
      floor: null,
      source: null,
      target: null,
      landing: null,
      nodeName: null,
      nodeType: null,
      movement: null,
      exactCost: null,
      predictedCost: null,
      actionPointsBefore: null,
      actionPointsAfter: null
    });

    assert.equal(
      readBlackFlowRoutingDecision(routingDecision({
        run_revision: '2',
        decision_id: 12,
        transaction_id: null,
        profile: {},
        map_revision: '2',
        floor: 0.5,
        source: -1,
        target: 1.5,
        landing: '281475010265088',
        node_name: '',
        node_type: false,
        movement: 7,
        exact_cost: '1',
        predicted_cost: 2.5,
        action_points_before: '5',
        action_points_after: null
      })),
      null
    );
    assert.equal(
      readBlackFlowRoutingDecision(callbackEvent('BlackFlowRoutingDecision', {})),
      null
    );
  });

  it('rejects node ids outside the safe integer range', () => {
    const invalidIds = [
      18446744073709551615,
      2 ** 64 - 1,
      -1,
      -NODE_A,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      String(NODE_A),
      null
    ];

    for (const invalidId of invalidIds) {
      const decision = readBlackFlowRoutingDecision(routingDecision({ target: invalidId }));
      assert.equal(decision?.target, null, `target ${String(invalidId)}`);
    }

    const maxSafe = readBlackFlowRoutingDecision(routingDecision({ target: Number.MAX_SAFE_INTEGER }));
    assert.equal(maxSafe?.target, String(Number.MAX_SAFE_INTEGER));
  });

  it('reads node resolutions with a known progress value', () => {
    assert.deepEqual(
      readBlackFlowNodeResolution(nodeResolution({
        decision_id: 'BF-D2-1',
        transaction_id: 'BF-T2-2',
        node: NODE_C,
        node_type: 'wish',
        event_name: '得偿所愿',
        progress: 'completed',
        floor: 2,
        page_revision: 3
      })),
      {
        runRevision: 2,
        decisionId: 'BF-D2-1',
        transactionId: 'BF-T2-2',
        node: String(NODE_C),
        nodeType: 'wish',
        eventName: '得偿所愿',
        progress: 'completed',
        floor: 2,
        pageRevision: 3
      }
    );

    assert.equal(
      readBlackFlowNodeResolution(nodeResolution({ progress: 'unknown' }))?.progress,
      null
    );
    assert.equal(
      readBlackFlowNodeResolution(callbackEvent('BlackFlowNodeResolution', {})),
      null
    );
  });

  it('requires milestone id and status', () => {
    assert.deepEqual(
      readBlackFlowMilestone(milestoneChanged({
        floor: 2,
        milestone_id: 'burn_floor2_final',
        progress: 3,
        status: 'satisfied'
      })),
      {
        runRevision: 2,
        milestoneId: 'burn_floor2_final',
        floor: 2,
        status: 'satisfied',
        progress: 3
      }
    );

    assert.equal(readBlackFlowMilestone(milestoneChanged({ milestone_id: null })), null);
    assert.equal(readBlackFlowMilestone(milestoneChanged({ status: '' })), null);
    assert.deepEqual(
      readBlackFlowMilestone(milestoneChanged({ floor: '1', progress: '0' })),
      {
        runRevision: 2,
        milestoneId: 'burn_floor1_final',
        floor: null,
        status: 'available',
        progress: null
      }
    );
  });

  it('returns null when recognized events have no details payload', () => {
    for (const what of [
      'BlackFlowMapSummary',
      'BlackFlowRoutingDecision',
      'BlackFlowNodeResolution',
      'BlackFlowMilestoneChanged',
      'BlackFlowStrategyStarted',
      'BlackFlowStrategyResult'
    ]) {
      const event: MaaCallbackEvent = { callback: 'SubTaskExtraInfo', taskchain: 'Roguelike', what };
      assert.equal(readBlackFlowMapSummary(event), null);
      assert.equal(readBlackFlowRoutingDecision(event), null);
      assert.equal(readBlackFlowNodeResolution(event), null);
      assert.equal(readBlackFlowMilestone(event), null);
      assert.equal(readBlackFlowStrategyStarted(event), null);
      assert.equal(readBlackFlowStrategyResult(event), null);
    }
  });

  it('reads strategy started profiles and strategy results', () => {
    assert.equal(readBlackFlowStrategyStarted(strategyStarted('burn_with_investment')), 'burn_with_investment');
    assert.equal(readBlackFlowStrategyStarted(strategyStarted('')), null);
    assert.equal(readBlackFlowStrategyStarted(callbackEvent('BlackFlowStrategyResult', {})), null);

    assert.deepEqual(
      readBlackFlowStrategyResult(strategyResult()),
      {
        profile: 'burn_with_investment',
        outcome: 'burn_completed',
        terminationReason: 'third_floor_reached',
        nextAction: 'restart_current_run',
        succeeded: true
      }
    );

    assert.deepEqual(
      readBlackFlowStrategyResult(strategyResult({
        profile: 'burn_with_investment',
        outcome: null,
        termination_reason: false,
        next_action: {},
        succeeded: 'true'
      })),
      {
        profile: 'burn_with_investment',
        outcome: null,
        terminationReason: null,
        nextAction: null,
        succeeded: null
      }
    );

    assert.equal(
      readBlackFlowStrategyResult(strategyResult({
        profile: 1,
        outcome: null,
        termination_reason: false,
        next_action: {},
        succeeded: 'true'
      })),
      null
    );
    assert.equal(readBlackFlowStrategyResult(callbackEvent('BlackFlowStrategyResult', {})), null);
  });
});

describe('black flow progress reducer', () => {
  it('returns null until a black flow event is observed', () => {
    assert.equal(snapshotOf([]), null);
    assert.equal(snapshotOf([callbackEvent('BlackFlowRoutingWarning', {})]), null);
    assert.equal(snapshotOf([callbackEvent('RoguelikeSettlement', { game_pass: true })]), null);
    assert.equal(
      snapshotOf([{
        callback: 'TaskChainStart',
        taskchain: 'Roguelike',
        what: 'BlackFlowMapSummary',
        details: { run_revision: 2, map_revision: 1, floor: 1 }
      }]),
      null
    );
  });

  it('keeps a snapshot for a malformed recognized black flow event', () => {
    assert.deepEqual(snapshotOf([callbackEvent('BlackFlowMapSummary', {})]), {
      floor: null,
      floorAt: null,
      currentNode: null,
      currentNodeAt: null,
      actionPoints: null,
      lastRoute: null,
      lastNodeResolution: null,
      milestones: [],
      strategy: null,
      updatedAt: null
    });
  });

  it('tracks the map summary floor and current node', () => {
    const later = BASE_TIME + 5_000;
    const snapshot = snapshotOf([
      mapSummary({ current_node: NODE_A }, BASE_TIME),
      mapSummary({ observation_id: 'BF-O2', current_node: NODE_B }, later)
    ]);

    assert.equal(snapshot?.floor, 1);
    assert.equal(snapshot?.floorAt, iso(later));
    assert.deepEqual(snapshot?.currentNode, { id: String(NODE_B), name: null, type: null });
    assert.equal(snapshot?.currentNodeAt, iso(later));
    assert.equal(snapshot?.updatedAt, iso(later));
  });

  it('drops stale map revisions and duplicate observations', () => {
    const first = BASE_TIME;
    const second = BASE_TIME + 1_000;
    const third = BASE_TIME + 2_000;
    const fourth = BASE_TIME + 3_000;
    const snapshot = snapshotOf([
      mapSummary({ map_revision: 1, observation_id: 'BF-O1', current_node: NODE_A }, first),
      mapSummary({ map_revision: 1, observation_id: 'BF-O1', current_node: NODE_B }, second),
      mapSummary({ map_revision: 1, observation_id: 'BF-O2', current_node: NODE_B }, third),
      mapSummary({ map_revision: 1, observation_id: 'BF-O3', current_node: NODE_C }, fourth)
    ]);

    assert.deepEqual(snapshot?.currentNode, { id: String(NODE_C), name: null, type: null });
    assert.equal(snapshot?.updatedAt, iso(fourth));

    const stale = snapshotOf([
      mapSummary({ map_revision: 2, observation_id: 'BF-O4', current_node: NODE_A }, first),
      mapSummary({ map_revision: 1, observation_id: 'BF-O5', current_node: NODE_B }, second)
    ]);

    assert.deepEqual(stale?.currentNode, { id: String(NODE_A), name: null, type: null });
    assert.equal(stale?.updatedAt, iso(first));
  });

  it('accepts preview observations and never treats updated_node as the current node', () => {
    const previewTime = BASE_TIME + 2_000;
    const snapshot = snapshotOf([
      mapSummary({ map_revision: 9, observation_id: 'BF-O9', current_node: NODE_A }, BASE_TIME),
      mapSummary({
        map_revision: 10,
        observation_id: 'BF-O9',
        source: 'preview',
        current_node: NODE_A,
        updated_node: NODE_B
      }, previewTime)
    ]);

    assert.deepEqual(snapshot?.currentNode, { id: String(NODE_A), name: null, type: null });
    assert.equal(snapshot?.updatedAt, iso(previewTime));
  });

  it('resets run data when run_revision increases and drops lower revisions', () => {
    const resetTime = BASE_TIME + 3_000;
    const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({ run_revision: 2, map_revision: 1, current_node: NODE_A }, BASE_TIME),
      routingDecision({ run_revision: 2, map_revision: 1 }),
      milestoneChanged({ run_revision: 2 }, BASE_TIME + 1_000),
      mapSummary({ run_revision: 3, map_revision: 1, current_node: NODE_B }, resetTime)
    ]);
    const snapshot = buildBlackFlowProgressSnapshot(state);

    assert.equal(state.runRevision, 3);
    assert.equal(state.lastRoute, null);
    assert.deepEqual(state.milestones, []);
    assert.equal(state.actionPoints, null);
    assert.deepEqual(snapshot?.currentNode, { id: String(NODE_B), name: null, type: null });
    assert.equal(snapshot?.actionPoints, null);
    assert.equal(snapshot?.lastRoute, null);
    assert.deepEqual(snapshot?.milestones, []);

    const stale = applyBlackFlowProgressEvents(state, [
      routingDecision({ run_revision: 2, decision_id: 'BF-D2-9', transaction_id: 'BF-T2-9' }, resetTime + 1_000)
    ]);

    assert.equal(stale.lastRoute, null);
    assert.equal(buildBlackFlowProgressSnapshot(stale)?.updatedAt, iso(resetTime));
  });

  it('drops lower run revisions for map, milestone and resolution events', () => {
    const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({ run_revision: 3, floor: 1, current_node: NODE_A }, BASE_TIME)
    ]);
    const stale = applyBlackFlowProgressEvents(state, [
      mapSummary({ run_revision: 2, observation_id: 'BF-O2', current_node: NODE_B }, BASE_TIME + 1_000),
      milestoneChanged({ run_revision: 2, milestone_id: 'stale-milestone' }, BASE_TIME + 2_000),
      nodeResolution({ run_revision: 2, transaction_id: 'BF-T2-9', node: NODE_C }, BASE_TIME + 3_000)
    ]);
    const snapshot = buildBlackFlowProgressSnapshot(stale);

    assert.equal(snapshot?.floor, 1);
    assert.deepEqual(snapshot?.currentNode, { id: String(NODE_A), name: null, type: null });
    assert.deepEqual(snapshot?.milestones, []);
    assert.equal(snapshot?.lastNodeResolution, null);
    assert.equal(snapshot?.updatedAt, iso(BASE_TIME));
  });

  it('clears current node identity and action points when the floor changes', () => {
    const routeTime = BASE_TIME + 1_000;
    const floorTwoTime = BASE_TIME + 2_000;
    const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({ floor: 1, current_node: NODE_A }, BASE_TIME),
      routingDecision({
        floor: 1,
        target: NODE_A,
        landing: NODE_A,
        node_name: '作战',
        node_type: 'battle_normal'
      }, routeTime),
      mapSummary({ floor: 2, observation_id: 'BF-O2', current_node: NODE_B }, floorTwoTime)
    ]);
    const snapshot = buildBlackFlowProgressSnapshot(state);

    assert.equal(snapshot?.floor, 2);
    assert.equal(snapshot?.floorAt, iso(floorTwoTime));
    assert.deepEqual(snapshot?.currentNode, { id: String(NODE_B), name: null, type: null });
    assert.equal(snapshot?.actionPoints, null);
    assert.equal(snapshot?.lastRoute?.floor, 1);
    assert.equal(snapshot?.lastRoute?.target?.name, '作战');

    const stale = applyBlackFlowProgressEvents(state, [
      mapSummary({ floor: 1, observation_id: 'BF-O9', current_node: NODE_C }, floorTwoTime + 1_000)
    ]);

    assert.deepEqual(
      buildBlackFlowProgressSnapshot(stale)?.currentNode,
      { id: String(NODE_B), name: null, type: null }
    );
  });

  it('deduplicates routing decisions and keeps targets separate from the current node', () => {
    const firstTime = BASE_TIME;
    const duplicateTime = BASE_TIME + 1_000;
    const laterTime = BASE_TIME + 2_000;
    const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({ current_node: NODE_A }, firstTime),
      routingDecision({ decision_id: 'BF-D2-1', transaction_id: 'BF-T2-1', target: NODE_B }, firstTime),
      routingDecision({ decision_id: 'BF-D2-1', transaction_id: 'BF-T2-2', target: NODE_C }, duplicateTime),
      routingDecision({
        decision_id: 'BF-D2-2',
        transaction_id: 'BF-T2-5',
        target: NODE_C,
        node_name: '得偿所愿',
        node_type: 'wish',
        action_points_before: 4,
        action_points_after: 3
      }, laterTime),
      routingDecision({ decision_id: 'BF-D2-1', transaction_id: 'BF-T2-9', target: NODE_D }, laterTime + 1_000)
    ]);
    const snapshot = buildBlackFlowProgressSnapshot(state);

    assert.deepEqual(snapshot?.currentNode, { id: String(NODE_A), name: null, type: null });
    assert.deepEqual(snapshot?.lastRoute?.target, { id: String(NODE_C), name: '得偿所愿', type: 'wish' });
    assert.equal(snapshot?.lastRoute?.at, iso(laterTime));
    assert.deepEqual(snapshot?.actionPoints, { before: 4, after: 3, at: iso(laterTime) });
    assert.equal(snapshot?.updatedAt, iso(laterTime));
  });

  it('marks arrival with transaction ids and map current_node confirmation', () => {
    const routeTime = BASE_TIME;
    const resolutionTime = BASE_TIME + 1_000;
    const confirmed = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({ current_node: NODE_A }, BASE_TIME),
      routingDecision({ target: NODE_B, transaction_id: 'BF-T2-1' }, routeTime),
      nodeResolution({ transaction_id: 'BF-T2-1', node: NODE_B }, resolutionTime)
    ]);

    assert.equal(buildBlackFlowProgressSnapshot(confirmed)?.lastRoute?.arrived, true);

    const byMap = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({ current_node: NODE_A }, BASE_TIME),
      routingDecision({ target: NODE_B, transaction_id: 'BF-T2-1' }, routeTime),
      mapSummary({ observation_id: 'BF-O2', current_node: NODE_B }, resolutionTime)
    ]);

    assert.equal(buildBlackFlowProgressSnapshot(byMap)?.lastRoute?.arrived, true);

    const staleDecisionId = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({ current_node: NODE_A }, BASE_TIME),
      routingDecision({ decision_id: 'BF-D2-2', target: NODE_B, transaction_id: 'BF-T2-2' }, routeTime),
      nodeResolution({
        decision_id: 'BF-D2-1',
        transaction_id: 'BF-T2-9',
        node: NODE_C
      }, resolutionTime)
    ]);

    assert.equal(buildBlackFlowProgressSnapshot(staleDecisionId)?.lastRoute?.arrived, false);
    assert.deepEqual(
      buildBlackFlowProgressSnapshot(staleDecisionId)?.lastNodeResolution?.node,
      { id: String(NODE_C), name: '得偿所愿', type: 'wish' }
    );
  });

  it('deduplicates node resolutions by transaction id', () => {
    const firstTime = BASE_TIME;
    const duplicateTime = BASE_TIME + 1_000;
    const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({ current_node: NODE_A }, BASE_TIME),
      nodeResolution({ transaction_id: 'BF-T2-1', node: NODE_B }, firstTime),
      nodeResolution({ transaction_id: 'BF-T2-1', node: NODE_C }, duplicateTime)
    ]);
    const snapshot = buildBlackFlowProgressSnapshot(state);

    assert.deepEqual(snapshot?.lastNodeResolution?.node, { id: String(NODE_B), name: '得偿所愿', type: 'wish' });
    assert.equal(snapshot?.lastNodeResolution?.at, iso(firstTime));
    assert.equal(snapshot?.updatedAt, iso(firstTime));
  });

  it('keeps the latest milestone state and returns at most five newest entries', () => {
    const events: MaaCallbackEvent[] = [];
    for (let index = 1; index <= 6; index += 1) {
      events.push(milestoneChanged({
        milestone_id: `milestone-${index}`,
        status: 'available',
        progress: 0
      }, BASE_TIME + index * 1_000));
    }

    const initial = snapshotOf(events);
    assert.deepEqual(
      initial?.milestones.map(milestone => milestone.id),
      ['milestone-6', 'milestone-5', 'milestone-4', 'milestone-3', 'milestone-2']
    );

    const updatedEvents = [
      ...events,
      milestoneChanged({ milestone_id: 'milestone-3', status: 'satisfied', progress: 0 }, BASE_TIME + 7_000)
    ];
    const updated = snapshotOf(updatedEvents);
    assert.deepEqual(
      updated?.milestones.map(milestone => milestone.id),
      ['milestone-3', 'milestone-6', 'milestone-5', 'milestone-4', 'milestone-2']
    );
    assert.equal(updated?.milestones[0]?.status, 'satisfied');
    assert.equal(updated?.milestones[0]?.at, iso(BASE_TIME + 7_000));

    const duplicate = snapshotOf([
      ...updatedEvents,
      milestoneChanged({ milestone_id: 'milestone-3', status: 'satisfied', progress: 5 }, BASE_TIME + 8_000)
    ]);
    assert.deepEqual(duplicate?.milestones[0], updated?.milestones[0]);
    assert.equal(duplicate?.updatedAt, iso(BASE_TIME + 7_000));
  });

  it('keeps lower-floor milestones without lowering the current floor', () => {
    const milestoneTime = BASE_TIME + 1_000;
    const snapshot = snapshotOf([
      mapSummary({ floor: 2, current_node: NODE_A }, BASE_TIME),
      milestoneChanged({
        floor: 1,
        milestone_id: 'burn_floor1_final',
        status: 'satisfied',
        progress: 0
      }, milestoneTime)
    ]);

    assert.equal(snapshot?.floor, 2);
    assert.equal(snapshot?.floorAt, iso(BASE_TIME));
    assert.deepEqual(snapshot?.currentNode, { id: String(NODE_A), name: null, type: null });
    assert.deepEqual(snapshot?.milestones, [{
      id: 'burn_floor1_final',
      floor: 1,
      progress: 0,
      status: 'satisfied',
      at: iso(milestoneTime)
    }]);
    assert.equal(snapshot?.updatedAt, iso(milestoneTime));
  });

  it('resets on strategy started and exposes the profile', () => {
    const startedTime = BASE_TIME + 3_000;
    const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({ current_node: NODE_A }, BASE_TIME),
      routingDecision({}, BASE_TIME + 1_000),
      milestoneChanged({}, BASE_TIME + 2_000),
      strategyStarted('investment', startedTime)
    ]);
    const snapshot = buildBlackFlowProgressSnapshot(state);

    assert.equal(state.runRevision, null);
    assert.equal(snapshot?.floor, null);
    assert.equal(snapshot?.currentNode, null);
    assert.equal(snapshot?.actionPoints, null);
    assert.equal(snapshot?.lastRoute, null);
    assert.deepEqual(snapshot?.milestones, []);
    assert.deepEqual(snapshot?.strategy, {
      at: iso(startedTime),
      profile: 'investment',
      outcome: null,
      terminationReason: null,
      nextAction: null,
      succeeded: null
    });
    assert.equal(snapshot?.updatedAt, iso(startedTime));
  });

  it('resets on strategy started even without a usable profile', () => {
    const startedTime = BASE_TIME + 3_000;
    const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({ floor: 2, current_node: NODE_A }, BASE_TIME),
      routingDecision({ floor: 2 }, BASE_TIME + 1_000),
      milestoneChanged({ floor: 2 }, BASE_TIME + 2_000),
      strategyStarted(null, startedTime)
    ]);
    const snapshot = buildBlackFlowProgressSnapshot(state);

    assert.equal(state.observed, true);
    assert.equal(state.profile, null);
    assert.equal(state.floor, null);
    assert.equal(state.currentNode, null);
    assert.equal(state.actionPoints, null);
    assert.equal(state.lastRoute, null);
    assert.deepEqual(state.milestones, []);
    assert.equal(state.strategy, null);
    assert.equal(snapshot?.floor, null);
    assert.equal(snapshot?.currentNode, null);
    assert.equal(snapshot?.actionPoints, null);
    assert.equal(snapshot?.lastRoute, null);
    assert.deepEqual(snapshot?.milestones, []);
    assert.equal(snapshot?.strategy, null);
    assert.equal(snapshot?.updatedAt, iso(startedTime));
  });

  it('keeps the started profile when the first run revision arrives later', () => {
    const startedTime = BASE_TIME;
    const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      strategyStarted('burn_with_investment', startedTime),
      mapSummary({ run_revision: 2, current_node: NODE_A }, startedTime + 1_000)
    ]);
    const snapshot = buildBlackFlowProgressSnapshot(state);

    assert.equal(state.runRevision, 2);
    assert.deepEqual(snapshot?.strategy, {
      at: iso(startedTime),
      profile: 'burn_with_investment',
      outcome: null,
      terminationReason: null,
      nextAction: null,
      succeeded: null
    });
    assert.deepEqual(snapshot?.currentNode, { id: String(NODE_A), name: null, type: null });
  });

  it('freezes floor, current node and action points after a strategy result', () => {
    const routeTime = BASE_TIME + 1_000;
    const resultTime = BASE_TIME + 2_000;
    const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({ floor: 2, current_node: NODE_A }, BASE_TIME),
      routingDecision({
        floor: 2,
        target: NODE_B,
        transaction_id: 'BF-T2-1',
        action_points_before: 3,
        action_points_after: 2
      }, routeTime),
      strategyResult({}, resultTime),
      mapSummary({ floor: 3, observation_id: 'BF-O2', current_node: NODE_C }, resultTime + 1_000),
      routingDecision({
        floor: 3,
        decision_id: 'BF-D2-2',
        transaction_id: 'BF-T2-2',
        target: NODE_D
      }, resultTime + 2_000),
      nodeResolution({ floor: 3, transaction_id: 'BF-T2-3', node: NODE_D }, resultTime + 3_000)
    ]);
    const snapshot = buildBlackFlowProgressSnapshot(state);

    assert.equal(snapshot?.floor, 2);
    assert.deepEqual(snapshot?.currentNode, { id: String(NODE_A), name: null, type: null });
    assert.deepEqual(snapshot?.actionPoints, { before: 3, after: 2, at: iso(routeTime) });
    assert.deepEqual(snapshot?.lastRoute?.target, { id: String(NODE_B), name: '作战', type: 'battle_normal' });
    assert.deepEqual(snapshot?.strategy, {
      at: iso(resultTime),
      profile: 'burn_with_investment',
      outcome: 'burn_completed',
      terminationReason: 'third_floor_reached',
      nextAction: 'restart_current_run',
      succeeded: true
    });
    assert.equal(snapshot?.updatedAt, iso(resultTime));

    const restarted = applyBlackFlowProgressEvents(state, [strategyStarted('burn', resultTime + 4_000)]);
    assert.equal(buildBlackFlowProgressSnapshot(restarted)?.floor, null);
    assert.equal(buildBlackFlowProgressSnapshot(restarted)?.lastRoute, null);
    assert.equal(buildBlackFlowProgressSnapshot(restarted)?.strategy?.profile, 'burn');
  });

  it('uses the latest parsed black flow event for updatedAt', () => {
    const routeTime = BASE_TIME + 1_000;
    const later = BASE_TIME + 2_000;
    const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({}, BASE_TIME),
      routingDecision({}, routeTime),
      callbackEvent('RoguelikeSettlement', { game_pass: true }, later),
      callbackEvent('BlackFlowRoutingWarning', { reason: 'stale' }, later + 1_000),
      mapSummary({ map_revision: 1, observation_id: 'BF-O1', current_node: NODE_C }, later + 2_000)
    ]);

    assert.equal(buildBlackFlowProgressSnapshot(state)?.updatedAt, iso(routeTime));
  });

  it('clears updatedAt when a parsed event carries no timestamp', () => {
    const timed = applyBlackFlowProgressEvents(createBlackFlowProgressState(), [
      mapSummary({}, BASE_TIME)
    ]);
    assert.equal(buildBlackFlowProgressSnapshot(timed)?.updatedAt, iso(BASE_TIME));

    const next = applyBlackFlowProgressEvents(timed, [
      routingDecision({ decision_id: 'BF-D2-2', transaction_id: 'BF-T2-2' }, null)
    ]);
    const snapshot = buildBlackFlowProgressSnapshot(next);

    assert.deepEqual(snapshot?.lastRoute?.target, {
      id: String(NODE_B),
      name: '作战',
      type: 'battle_normal'
    });
    assert.equal(snapshot?.updatedAt, null);
  });

  it('leaves timestamps null when events carry no atMs', () => {
    const snapshot = snapshotOf([
      mapSummary({}, null),
      routingDecision({}, null)
    ]);

    assert.equal(snapshot?.floor, 1);
    assert.deepEqual(snapshot?.currentNode, { id: String(NODE_A), name: null, type: null });
    assert.equal(snapshot?.floorAt, null);
    assert.equal(snapshot?.currentNodeAt, null);
    assert.deepEqual(snapshot?.actionPoints, { before: 5, after: 4, at: null });
    assert.equal(snapshot?.lastRoute?.at, null);
    assert.equal(snapshot?.updatedAt, null);
  });

  it('fills current node identity from routing targets and node resolutions', () => {
    const snapshot = snapshotOf([
      mapSummary({ current_node: NODE_A }, BASE_TIME),
      routingDecision({
        target: NODE_A,
        landing: NODE_A,
        node_name: '作战',
        node_type: 'battle_normal'
      }, BASE_TIME + 1_000),
      nodeResolution({
        node: NODE_A,
        node_type: 'shop',
        event_name: '诡意行商'
      }, BASE_TIME + 2_000)
    ]);

    assert.deepEqual(snapshot?.currentNode, { id: String(NODE_A), name: '诡意行商', type: 'shop' });
  });

  it('bounds the node identity cache', () => {
    const events: MaaCallbackEvent[] = [mapSummary({ current_node: NODE_A }, BASE_TIME)];
    const firstTarget = 1_000;
    const lastTarget = 1_032;

    for (let index = 0; index <= 32; index += 1) {
      events.push(routingDecision({
        decision_id: `BF-D2-${index + 1}`,
        transaction_id: `BF-T2-${index + 1}`,
        target: firstTarget + index,
        landing: firstTarget + index,
        node_name: `node-${index}`,
        node_type: 'empty'
      }, BASE_TIME + index * 1_000));
    }

    const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), events);

    assert.equal(state.nodeIdentity.size, 32);
    assert.equal(state.nodeIdentity.has(String(firstTarget)), false);
    assert.equal(state.nodeIdentity.has(String(lastTarget)), true);
  });

  it('keeps the floor timestamp on the highest-priority source', () => {
    const mapTime = BASE_TIME;
    const routeTime = BASE_TIME + 1_000;
    const milestoneTime = BASE_TIME + 2_000;
    const resolutionTime = BASE_TIME + 3_000;
    const withMap = snapshotOf([
      mapSummary({ floor: 2, current_node: NODE_A }, mapTime),
      routingDecision({ floor: 2, target: NODE_B }, routeTime),
      milestoneChanged({ floor: 2, milestone_id: 'milestone-1' }, milestoneTime),
      nodeResolution({ floor: 2, transaction_id: 'BF-T2-1', node: NODE_B }, resolutionTime)
    ]);

    assert.equal(withMap?.floor, 2);
    assert.equal(withMap?.floorAt, iso(mapTime));

    const upgraded = snapshotOf([
      routingDecision({ floor: 2, target: NODE_B }, routeTime),
      mapSummary({ floor: 2, current_node: NODE_A }, resolutionTime)
    ]);

    assert.equal(upgraded?.floorAt, iso(resolutionTime));
  });

  it('does not let milestones override a map or routing floor', () => {
    const milestoneTime = BASE_TIME + 1_000;
    const withMap = snapshotOf([
      mapSummary({ floor: 1, current_node: NODE_A }, BASE_TIME),
      milestoneChanged({ floor: 3, milestone_id: 'burn_floor3_final' }, milestoneTime)
    ]);

    assert.equal(withMap?.floor, 1);
    assert.equal(withMap?.floorAt, iso(BASE_TIME));
    assert.deepEqual(withMap?.currentNode, { id: String(NODE_A), name: null, type: null });
    assert.equal(withMap?.milestones[0]?.id, 'burn_floor3_final');

    const withRoute = snapshotOf([
      routingDecision({ floor: 2, target: NODE_B }, BASE_TIME),
      milestoneChanged({ floor: 3, milestone_id: 'burn_floor3_final' }, milestoneTime)
    ]);

    assert.equal(withRoute?.floor, 2);
    assert.equal(withRoute?.floorAt, iso(BASE_TIME));
  });

  it('falls back to routing decisions and milestones when no map summary exists', () => {
    const routeTime = BASE_TIME;
    const milestoneTime = BASE_TIME + 1_000;
    const routing = snapshotOf([
      routingDecision({ floor: 2, target: NODE_B }, routeTime)
    ]);
    const milestone = snapshotOf([
      milestoneChanged({ floor: 3, milestone_id: 'burn_floor3_final' }, milestoneTime)
    ]);

    assert.equal(routing?.floor, 2);
    assert.equal(routing?.floorAt, iso(routeTime));
    assert.equal(milestone?.floor, 3);
    assert.equal(milestone?.floorAt, iso(milestoneTime));
  });
});

describe('black flow progress fixture', () => {
  const log = readFileSync(
    new URL('./fixtures/blackflow-session.fixture.txt', import.meta.url),
    'utf8'
  );
  const events = parseMaaCallbackEvents(log, 'Roguelike');

  it('parses the anonymized real session in order', () => {
    assert.equal(events.length, 30);
    assert.equal(log.includes('anon-bf-0001'), true);
    assert.equal(log.includes('3f2c9532958d356b'), false);
    assert.equal(log.includes('Px12213'), false);
    assert.equal(log.includes('Tx50880'), false);
    assert.equal(log.includes('Tx33216'), false);
  });

  it('associates the stale-decision node resolution by transaction id', () => {
    const resolutionIndex = events.findIndex(event =>
      event.what === 'BlackFlowNodeResolution' && detailOf(event, 'transaction_id') === 'BF-T2-2'
    );
    assert.notEqual(resolutionIndex, -1);

    const snapshot = snapshotOf(events.slice(0, resolutionIndex + 1));

    assert.equal(detailOf(events[resolutionIndex], 'decision_id'), 'BF-D2-1');
    assert.deepEqual(snapshot?.lastRoute?.target, {
      id: '281475010265092',
      name: '得偿所愿',
      type: 'wish'
    });
    assert.equal(snapshot?.lastRoute?.arrived, true);
    assert.deepEqual(snapshot?.lastNodeResolution?.node, {
      id: '281475010265092',
      name: '得偿所愿',
      type: 'wish'
    });
  });

  it('keeps the non-walk routing decision while it is the latest route', () => {
    const decisionIndex = events.findIndex(event =>
      event.what === 'BlackFlowRoutingDecision' && detailOf(event, 'decision_id') === 'BF-D2-5'
    );
    assert.notEqual(decisionIndex, -1);

    const snapshot = snapshotOf(events.slice(0, decisionIndex + 1));

    assert.equal(snapshot?.lastRoute?.movement, 'rogue_6_scrap_M_03');
    assert.deepEqual(snapshot?.lastRoute?.target, {
      id: '562950020530182',
      name: '林间空地',
      type: 'empty'
    });
    assert.equal(snapshot?.lastRoute?.actionPointsBefore, 6);
    assert.equal(snapshot?.lastRoute?.actionPointsAfter, 5);
    assert.equal(snapshot?.lastRoute?.arrived, false);
  });

  it('reduces the full session to the black flow contract snapshot', () => {
    const state = applyBlackFlowProgressEvents(createBlackFlowProgressState(), events);
    const snapshot = buildBlackFlowProgressSnapshot(state);
    const floorTwoMilestoneTime = fixtureTime(21, 34, 31, 349);
    const shopSatisfiedTime = fixtureTime(21, 33, 48, 115);
    const routeTime = fixtureTime(21, 36, 26, 402);
    const resolutionTime = fixtureTime(21, 36, 45, 82);
    const resultTime = fixtureTime(21, 36, 50, 56);

    assert.equal(state.runRevision, 2);
    assert.equal(state.mapRevision, 15);
    assert.equal(state.lastObservationSeq, 14);
    assert.equal(state.strategyEnded, true);
    assert.deepEqual(snapshot, {
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
          at: iso(fixtureTime(21, 29, 44, 554))
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
  });
});
