import { getCallbackDetails } from './maaCallbackService.ts';
import type { MaaCallbackEvent } from './maaCallbackService.ts';

export interface BlackFlowMapSummary {
  runRevision: number | null;
  mapRevision: number | null;
  observationId: string | null;
  source: string | null;
  floor: number | null;
  currentNode: string | null;
  updatedNode: string | null;
}

export interface BlackFlowRoutingDecision {
  runRevision: number | null;
  decisionId: string | null;
  transactionId: string | null;
  profile: string | null;
  mapRevision: number | null;
  floor: number | null;
  source: string | null;
  target: string | null;
  landing: string | null;
  nodeName: string | null;
  nodeType: string | null;
  movement: string | null;
  exactCost: number | null;
  predictedCost: number | null;
  actionPointsBefore: number | null;
  actionPointsAfter: number | null;
}

export type BlackFlowNodeResolutionProgress = 'active' | 'completed' | 'removed';

export interface BlackFlowNodeResolution {
  runRevision: number | null;
  decisionId: string | null;
  transactionId: string | null;
  node: string | null;
  nodeType: string | null;
  eventName: string | null;
  progress: BlackFlowNodeResolutionProgress | null;
  floor: number | null;
  pageRevision: number | null;
}

export interface BlackFlowMilestone {
  runRevision: number | null;
  milestoneId: string;
  floor: number | null;
  status: string;
  progress: number | null;
}

export interface BlackFlowStrategyResult {
  profile: string | null;
  outcome: string | null;
  terminationReason: string | null;
  nextAction: string | null;
  succeeded: boolean | null;
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function readNodeId(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readProgress(value: unknown): BlackFlowNodeResolutionProgress | null {
  return value === 'active' || value === 'completed' || value === 'removed' ? value : null;
}

function hasValue(record: object): boolean {
  return Object.values(record).some(value => value !== null);
}

export function readBlackFlowMapSummary(event: MaaCallbackEvent): BlackFlowMapSummary | null {
  if (event.what !== 'BlackFlowMapSummary') return null;

  const details = getCallbackDetails(event);
  if (!details) return null;

  const summary: BlackFlowMapSummary = {
    runRevision: readInteger(details.run_revision),
    mapRevision: readInteger(details.map_revision),
    observationId: readText(details.observation_id),
    source: readText(details.source),
    floor: readInteger(details.floor),
    currentNode: readNodeId(details.current_node),
    updatedNode: readNodeId(details.updated_node)
  };

  return hasValue(summary) ? summary : null;
}

export function readBlackFlowRoutingDecision(event: MaaCallbackEvent): BlackFlowRoutingDecision | null {
  if (event.what !== 'BlackFlowRoutingDecision') return null;

  const details = getCallbackDetails(event);
  if (!details) return null;

  const decision: BlackFlowRoutingDecision = {
    runRevision: readInteger(details.run_revision),
    decisionId: readText(details.decision_id),
    transactionId: readText(details.transaction_id),
    profile: readText(details.profile),
    mapRevision: readInteger(details.map_revision),
    floor: readInteger(details.floor),
    source: readNodeId(details.source),
    target: readNodeId(details.target),
    landing: readNodeId(details.landing),
    nodeName: readText(details.node_name),
    nodeType: readText(details.node_type),
    movement: readText(details.movement),
    exactCost: readInteger(details.exact_cost),
    predictedCost: readInteger(details.predicted_cost),
    actionPointsBefore: readInteger(details.action_points_before),
    actionPointsAfter: readInteger(details.action_points_after)
  };

  return hasValue(decision) ? decision : null;
}

export function readBlackFlowNodeResolution(event: MaaCallbackEvent): BlackFlowNodeResolution | null {
  if (event.what !== 'BlackFlowNodeResolution') return null;

  const details = getCallbackDetails(event);
  if (!details) return null;

  const resolution: BlackFlowNodeResolution = {
    runRevision: readInteger(details.run_revision),
    decisionId: readText(details.decision_id),
    transactionId: readText(details.transaction_id),
    node: readNodeId(details.node),
    nodeType: readText(details.node_type),
    eventName: readText(details.event_name),
    progress: readProgress(details.progress),
    floor: readInteger(details.floor),
    pageRevision: readInteger(details.page_revision)
  };

  return hasValue(resolution) ? resolution : null;
}

export function readBlackFlowMilestone(event: MaaCallbackEvent): BlackFlowMilestone | null {
  if (event.what !== 'BlackFlowMilestoneChanged') return null;

  const details = getCallbackDetails(event);
  if (!details) return null;

  const milestoneId = readText(details.milestone_id);
  const status = readText(details.status);
  if (milestoneId === null || status === null) return null;

  return {
    runRevision: readInteger(details.run_revision),
    milestoneId,
    floor: readInteger(details.floor),
    status,
    progress: readInteger(details.progress)
  };
}

export function readBlackFlowStrategyStarted(event: MaaCallbackEvent): string | null {
  if (event.what !== 'BlackFlowStrategyStarted') return null;
  return readText(getCallbackDetails(event)?.profile);
}

export function readBlackFlowStrategyResult(event: MaaCallbackEvent): BlackFlowStrategyResult | null {
  if (event.what !== 'BlackFlowStrategyResult') return null;

  const details = getCallbackDetails(event);
  if (!details) return null;

  const result: BlackFlowStrategyResult = {
    profile: readText(details.profile),
    outcome: readText(details.outcome),
    terminationReason: readText(details.termination_reason),
    nextAction: readText(details.next_action),
    succeeded: readBoolean(details.succeeded)
  };

  return hasValue(result) ? result : null;
}
