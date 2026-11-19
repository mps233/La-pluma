import {
  isActiveRunState,
  isTerminalRunState,
  type AgentRun,
  type RunSnapshot,
} from '@/features/task-execution'
import type { TaskExecutionResult, TaskExecutionState } from '../utils/automationTaskProgress'

export interface GameTaskDetail {
  name: string
  role?: string
  result: 'Success' | 'Failed' | 'Skipped'
  resultDetail: string
  elite?: number
  skillLevel?: number
  skillMastery?: [number, number, number]
}

export interface GameTaskDeferredMastery {
  name: string
  role?: string
  skillMastery: [number, number, number]
}

export interface AutomationExecutionSummary {
  taskResults?: TaskExecutionResult[]
  successCount: number
  failedCount: number
  skippedCount: number
  durationMs: number
  summaries: Array<{
    task: string
    stage?: string
    times?: string
    drops?: string
    duration?: string
  }>
  reports: Array<{
    provider: 'penguin' | 'yituliu'
    stage?: string
    status: 'success' | 'failed'
    message: string
  }>
  actions: Array<{
    task: string
    action: 'startup' | 'closedown' | 'depot' | 'operbox' | 'award' | 'recruit' | 'infrast' | 'mall' | 'fight' | 'operprogress' | 'switchtheme'
    status: 'success' | 'skipped' | 'failed'
    message: string
    observed?: boolean
    details?: GameTaskDetail[]
    deferredMastery?: GameTaskDeferredMastery[]
    deferredCount?: number
    startedCount?: number
    collectedCount?: number
    expeditedCount?: number
    refreshCount?: number
    highestLevel?: number
    detectedTags?: string[]
    finalTags?: string[]
    preservedTags?: string[]
    configuredFacilities?: string[]
    observedFacilities?: string[]
    rewardCollected?: boolean
    rotationApplied?: boolean
    droneUsed?: boolean
    cluesReceived?: number
    cluesSent?: number
    clueExchange?: boolean
    trainingContinued?: boolean
    trainingCompleted?: boolean
    trainingProcessing?: boolean
    visitedCount?: number
    creditCollected?: boolean
    purchasedCount?: number
    noMoney?: boolean
    visitLimited?: boolean
    noFriends?: boolean
    stage?: string
    times?: number
    dropCount?: number
    drops?: string
    medicine?: number
    stone?: number
    duration?: string
    sanityDepleted?: boolean
  }>
  errors: Array<string | { task: string; error: string }>
  warnings: string[]
}

export interface AutomationFlowProgress {
  /** 服务端 enabled 任务序号；`-1` 表示流程尚未进入第一项。 */
  currentStep: number | null
  currentTaskId: string | null
  currentTask: string | null
  totalSteps: number | null
  taskResults: TaskExecutionResult[]
  message: string | null
  shouldStop: boolean
}

const TASK_EXECUTION_STATES: ReadonlySet<string> = new Set([
  'pending',
  'running',
  'success',
  'failed',
  'skipped',
  'stopped',
])

function isTaskExecutionState(value: unknown): value is TaskExecutionState {
  return typeof value === 'string' && TASK_EXECUTION_STATES.has(value)
}

function readScheduleTaskResults(value: unknown): TaskExecutionResult[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    if (typeof record.taskId !== 'string'
      || typeof record.task !== 'string'
      || !isTaskExecutionState(record.status)) return []
    return [{ taskId: record.taskId, task: record.task, status: record.status }]
  })
}

export function executionSummaryHasFailure(summary: AutomationExecutionSummary | null) {
  if (!summary) return false
  return Boolean(
    summary.failedCount > 0
    || summary.errors?.length
    || summary.actions?.some(action => action.status === 'failed')
    || summary.reports?.some(report => report.status === 'failed'),
  )
}

export function isAutomationExecutionSummary(value: unknown): value is AutomationExecutionSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.successCount === 'number'
    && typeof record.failedCount === 'number'
    && typeof record.skippedCount === 'number'
    && typeof record.durationMs === 'number'
    && Array.isArray(record.summaries)
    && Array.isArray(record.reports)
    && Array.isArray(record.warnings)
}

/**
 * 旧 `schedules/execution.lastResult` 只用于“最近执行”展示，字段可能不完整。
 * 缺失的明细列表归一为空数组，但必须带齐四项计数，否则不当作摘要。
 */
export function readAutomationScheduleSummary(snapshot: RunSnapshot | null): AutomationExecutionSummary | null {
  const value = snapshot?.schedule?.lastResult
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  if (typeof record.successCount !== 'number'
    || typeof record.failedCount !== 'number'
    || typeof record.skippedCount !== 'number'
    || typeof record.durationMs !== 'number') return null

  const arrayOf = <T,>(key: string): T[] => Array.isArray(record[key]) ? record[key] as T[] : []
  return {
    successCount: record.successCount,
    failedCount: record.failedCount,
    skippedCount: record.skippedCount,
    durationMs: record.durationMs,
    ...(Array.isArray(record.taskResults)
      ? { taskResults: readScheduleTaskResults(record.taskResults) }
      : {}),
    summaries: arrayOf('summaries'),
    reports: arrayOf('reports'),
    actions: arrayOf('actions'),
    errors: arrayOf('errors'),
    warnings: arrayOf('warnings'),
  }
}

function readRunResult(run: AgentRun): Record<string, unknown> | null {
  if (!run.result || typeof run.result !== 'object' || Array.isArray(run.result)) return null
  return run.result as Record<string, unknown>
}

export function readAutomationRunMessage(run: AgentRun | null): string | null {
  if (!run) return null
  const result = readRunResult(run)
  return typeof result?.message === 'string' && result.message.trim() ? result.message : null
}

export function readAutomationExecutionSummary(run: AgentRun | null): AutomationExecutionSummary | null {
  if (!run || !isTerminalRunState(run.state)) return null
  if (run.state === 'failed' || run.state === 'interrupted') return null
  const summary = readRunResult(run)?.summary
  return isAutomationExecutionSummary(summary) ? summary : null
}

/**
 * 活动 run 的流程投影。逐项结果只在流程发布并持有同一 runId 时读取：
 * `schedule` 是全局投影，不能把其它流程的步骤借给当前 run。
 */
export function readAutomationFlowProgress(
  run: AgentRun | null,
  snapshot: RunSnapshot | null,
): AutomationFlowProgress | null {
  if (!run || !isActiveRunState(run.state)) return null

  const progress = run.progress ?? {}
  const schedule = snapshot?.schedule
  const matchedSchedule = schedule?.isRunning
    && typeof schedule.runId === 'string'
    && schedule.runId === run.runId
    ? schedule
    : null

  return {
    currentStep: matchedSchedule ? matchedSchedule.currentStep ?? null : progress.currentStep ?? null,
    currentTaskId: matchedSchedule && typeof matchedSchedule.currentTaskId === 'string'
      ? matchedSchedule.currentTaskId
      : null,
    currentTask: (matchedSchedule ? matchedSchedule.currentTask : progress.currentTask) ?? null,
    totalSteps: progress.totalSteps ?? (matchedSchedule ? matchedSchedule.totalSteps ?? null : null),
    taskResults: matchedSchedule ? readScheduleTaskResults(matchedSchedule.taskResults) : [],
    message: progress.message
      || (matchedSchedule ? matchedSchedule.message ?? null : null),
    shouldStop: Boolean(progress.shouldStop || (matchedSchedule && matchedSchedule.shouldStop)),
  }
}

export function describeAutomationRunTerminal(
  run: AgentRun,
  summary: AutomationExecutionSummary | null,
): { message: string; type: 'success' | 'warning' | 'error' } {
  const resultMessage = readAutomationRunMessage(run)

  if (run.state === 'succeeded') {
    const message = resultMessage || '任务流程执行完成'
    const warning = executionSummaryHasFailure(summary) || /终止|取消|失败/.test(message)
    return { message, type: warning ? 'warning' : 'success' }
  }
  if (run.state === 'stopped') {
    return { message: resultMessage || '任务流程已终止', type: 'warning' }
  }
  if (run.state === 'failed') {
    return { message: `执行失败: ${run.error?.message || '任务流程未能完成'}`, type: 'error' }
  }
  return {
    message: `任务已中断: ${run.error?.message || '服务重启后无法确认执行结果'}`,
    type: 'warning',
  }
}
