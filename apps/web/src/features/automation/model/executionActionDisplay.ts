import { isUnconfirmedGameAction } from '@/shared/lib/executionSummary'
import type { AutomationExecutionSummary } from './automationRun'

type ExecutionActions = AutomationExecutionSummary['actions']
type ExecutionAction = ExecutionActions[number]

interface InfrastDisplayFields {
  skippedRooms?: unknown
  roomCandidates?: unknown
}

const isPositiveNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0
const hasEntries = (value: unknown) => Array.isArray(value) && value.length > 0

function fightHasDetails(action: ExecutionAction) {
  return Boolean(action.stage)
    || isPositiveNumber(action.times)
    || isPositiveNumber(action.dropCount)
    || action.sanityDepleted === true
}

function recruitHasDetails(action: ExecutionAction) {
  return isPositiveNumber(action.startedCount)
    || isPositiveNumber(action.collectedCount)
    || isPositiveNumber(action.expeditedCount)
    || isPositiveNumber(action.refreshCount)
    || isPositiveNumber(action.highestLevel)
    || hasEntries(action.preservedTags)
}

function infrastHasDetails(action: ExecutionAction) {
  const extras = action as ExecutionAction & InfrastDisplayFields
  return action.rewardCollected === true
    || action.rotationApplied === true
    || action.droneUsed === true
    || isPositiveNumber(action.cluesReceived)
    || isPositiveNumber(action.cluesSent)
    || action.clueExchange === true
    || action.trainingContinued === true
    || action.trainingCompleted === true
    || action.trainingProcessing === true
    || hasEntries(action.observedFacilities)
    || hasEntries(extras.skippedRooms)
    || hasEntries(extras.roomCandidates)
}

function mallHasDetails(action: ExecutionAction) {
  return isPositiveNumber(action.visitedCount)
    || isPositiveNumber(action.purchasedCount)
    || action.creditCollected === true
    || action.noMoney === true
    || action.visitLimited === true
    || action.noFriends === true
}

function successActionHasDetail(action: ExecutionAction) {
  switch (action.action) {
    case 'award':
    case 'depot':
    case 'operbox':
    case 'operprogress':
    case 'switchtheme':
      return true
    case 'startup':
    case 'closedown':
      return false
    case 'fight':
      return fightHasDetails(action)
    case 'recruit':
      return recruitHasDetails(action)
    case 'infrast':
      return infrastHasDetails(action)
    case 'mall':
      return mallHasDetails(action)
  }
}

export function filterExecutionActionsForDisplay(
  actions: ExecutionActions | undefined,
): ExecutionActions {
  return (actions ?? []).filter(action => {
    if (action.status !== 'success') return true
    if (isUnconfirmedGameAction(action)) return true
    return successActionHasDetail(action)
  })
}

function isErrorCoveredByFailedAction(
  error: string | { task: string; error: string },
  actions: ExecutionActions | undefined,
) {
  const task = typeof error === 'string' ? error : error.task
  return (actions ?? []).some(action => action.status === 'failed' && action.task === task)
}

export function hasExecutionDetailContent(
  summary: AutomationExecutionSummary,
  visibleActions: ExecutionActions,
): boolean {
  if (visibleActions.length > 0) return true
  if (summary.summaries.some(entry => entry.stage || entry.drops)) return true
  if (summary.reports.length > 0) return true
  if ((summary.errors ?? []).some(error => !isErrorCoveredByFailedAction(error, summary.actions))) return true
  return summary.warnings.length > 0
}
