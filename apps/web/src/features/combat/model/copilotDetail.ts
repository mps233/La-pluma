import type {
  CopilotDetailOperator,
  CopilotDifficulty,
  CopilotSetItem,
} from '../types'
import { parseCopilotUri } from '../utils/copilotUri'

export type { CopilotDetailOperator } from '../types'

export type CopilotDetailTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger'

export interface CopilotDetailTarget {
  title: string
  details?: string
  stage?: string
  stageId?: string
  apCost?: number | null
  sourceLabel?: string
  uri?: string
  presetFormation?: boolean
  supportsRaid?: boolean
  recommendedMode?: CopilotDifficulty
  completedModes?: Array<'normal' | 'raid'>
  operators?: CopilotDetailOperator[]
  groups?: string[]
  statusLabel?: string
  statusTone?: CopilotDetailTone
  error?: string
}

export interface CopilotDetailFailure {
  itemIndex: number | null
  stage: string | null
  error: string
}

export interface CopilotDetailState {
  isCurrent: boolean
  isSuccess: boolean
  isFailed: boolean
  isStopped: boolean
  isSkipped: boolean
  isHistoryDone: boolean
}

export interface BuildCopilotDetailTargetInput {
  copilot: CopilotSetItem
  sourceLabel: string
  statusLabel?: string
  error?: string
}

export function deriveCopilotDetailState({
  status,
  runCompleted,
  historyCompleted,
}: {
  status: string | undefined
  runCompleted: boolean
  historyCompleted: boolean
}): CopilotDetailState {
  const isFailed = status === 'failed'
  const isStopped = status === 'stopped'
  return {
    isCurrent: status === 'running',
    isFailed,
    isStopped,
    isSuccess: runCompleted && !isFailed && !isStopped,
    isSkipped: status === 'skipped',
    isHistoryDone: !runCompleted
      && !isFailed
      && !isStopped
      && status !== 'running'
      && status !== 'skipped'
      && historyCompleted,
  }
}

export function describeCopilotDetailStatus(state: CopilotDetailState): string {
  if (state.isCurrent) return '执行中'
  if (state.isSkipped) return '已跳过'
  if (state.isFailed) return '待重试'
  if (state.isStopped) return '已终止'
  if (state.isSuccess) return '已完成'
  if (state.isHistoryDone) return '历史已通关'
  return '待执行'
}

export function describeCopilotDetailTitle(copilot: {
  id: number
  name?: string
  stage?: string
}): string {
  return copilot.name && copilot.name !== copilot.stage
    ? copilot.name
    : `作业 #${copilot.id}`
}

export function buildCopilotDetailTarget({
  copilot,
  sourceLabel,
  statusLabel,
  error,
}: BuildCopilotDetailTargetInput): CopilotDetailTarget {
  const title = describeCopilotDetailTitle(copilot)
  const uri = copilot.uri ?? `prts://${copilot.id}`
  return {
    title,
    ...(copilot.details ? { details: copilot.details } : {}),
    ...(copilot.stage ? { stage: copilot.stage } : {}),
    ...(copilot.stageId ? { stageId: copilot.stageId } : {}),
    ...(typeof copilot.apCost === 'number' ? { apCost: copilot.apCost } : {}),
    sourceLabel,
    uri,
    ...(copilot.presetFormation !== undefined ? { presetFormation: copilot.presetFormation } : {}),
    ...(copilot.supportsRaid !== undefined ? { supportsRaid: copilot.supportsRaid } : {}),
    ...(copilot.completedModes?.length ? { completedModes: [...copilot.completedModes] } : {}),
    ...(copilot.operatorDetails?.length ? { operators: copilot.operatorDetails } : {}),
    ...(copilot.groupNames?.length ? { groups: copilot.groupNames } : {}),
    ...(statusLabel ? { statusLabel } : {}),
    ...(error ? { error } : {}),
  }
}

export function readMissingDetailCopilotId(target: CopilotDetailTarget | null): string | null {
  if (!target || target.details || !target.uri) return null
  const parsed = parseCopilotUri(target.uri)
  return parsed && !parsed.isSet ? parsed.id : null
}

export function firstErrorLine(error: string | undefined): string | null {
  if (!error) return null
  return error.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? null
}

export function collectCopilotItemErrors(
  failures: readonly CopilotDetailFailure[],
  summaryErrors: readonly CopilotDetailFailure[] = [],
): Map<number, string> {
  const errors = new Map<number, string>()
  for (const failure of [...summaryErrors, ...failures]) {
    if (failure.itemIndex === null || !failure.error) continue
    if (!errors.has(failure.itemIndex)) errors.set(failure.itemIndex, failure.error)
  }
  return errors
}
