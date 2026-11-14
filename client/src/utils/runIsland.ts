import type { AgentRun, RunTaskResult, RunTaskResultStatus } from '@/types/run'
import { isActiveRunState } from '@/types/run'

/**
 * The server writes task results with `state` ("succeeded", "failed", …) while the copilot path
 * writes `status` ("success", "running", …). Normalize both; progress counts any terminal result,
 * while the summary below distinguishes success from failure and skips.
 */
function statusOf(result: RunTaskResult): 'success' | 'failed' | 'skipped' | 'stopped' | 'running' | 'pending' {
  const status: RunTaskResultStatus | string | undefined = result.status
  const state = typeof result.state === 'string' ? result.state : undefined
  if (status === 'success' || status === 'failed' || status === 'skipped' || status === 'stopped') return status
  if (state === 'succeeded' || state === 'success') return 'success'
  if (state === 'failed') return 'failed'
  if (state === 'skipped') return 'skipped'
  if (state === 'stopped') return 'stopped'
  if (status === 'running' || state === 'running') return 'running'
  return 'pending'
}

const failedStatuses = new Set(['failed'])
const skippedStatuses = new Set(['skipped', 'stopped'])

function taskResultsOf(run: AgentRun | null): RunTaskResult[] {
  if (!run) return []
  return run.taskResults ?? run.progress?.taskResults ?? []
}

/**
 * Progress for the island's ring. The schedule's step count is the source when present; task
 * results only tell success from the rest, so they are used only when no step count exists.
 */
export function runProgressOf(run: AgentRun | null): number {
  if (!run) return 0
  const step = run.progress?.currentStep ?? null
  const total = run.progress?.totalSteps ?? null
  if (step !== null && total !== null && total > 0) {
    return Math.min(1, Math.max(0, step / total))
  }
  const results = taskResultsOf(run)
  if (results.length === 0) return 0
  const finished = results.filter(result => {
    const status = statusOf(result)
    return status !== 'pending' && status !== 'running'
  }).length
  return finished / results.length
}

/** The expanded title: the step count, with the stage only when it adds something new. */
export function runStepText(task: string, stage: string, step: number | null, total: number | null): string {
  const stageLabel = stage && stage !== task ? stage : ''
  if (step !== null && total !== null && total > 0) {
    return `第 ${step} / ${total} 项${stageLabel ? ` · ${stageLabel}` : ''}`
  }
  return stageLabel || '自动化任务流程'
}

/** The task name a person recognises, from the active snapshot or the last named result. */
export function runTaskName(run: AgentRun | null): string {
  const currentTask = typeof run?.progress?.currentTask === 'string'
    ? run.progress.currentTask.trim()
    : ''
  if (currentTask) return currentTask
  const stage = typeof run?.progress?.currentStage === 'string'
    ? run.progress.currentStage.trim()
    : ''
  if (stage) return stage
  const results = taskResultsOf(run)
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index]
    const name = typeof result?.name === 'string' ? result.name.trim() : ''
    if (name) return name
  }
  return '自动化任务'
}

/** A short, honest result line for the expanded view, such as "成功 3，跳过 1 / 4 项". */
export function runResultSummary(run: AgentRun | null): string {
  const results = taskResultsOf(run)
  if (results.length === 0) return ''
  const statuses = results.map(statusOf)
  const succeeded = statuses.filter(status => status === 'success').length
  const failed = statuses.filter(status => failedStatuses.has(status)).length
  const skipped = statuses.filter(status => skippedStatuses.has(status)).length
  if (succeeded === results.length) return `全部 ${results.length} 项完成`
  const parts = [
    succeeded > 0 ? `成功 ${succeeded}` : '',
    failed > 0 ? `失败 ${failed}` : '',
    skipped > 0 ? `跳过 ${skipped}` : '',
  ].filter(Boolean)
  return `${parts.join('，')} / ${results.length} 项`
}

/** Whether a terminal Run finished recently enough for its outcome to still be on the island. */
export function runFinishedWithin(run: AgentRun | null, now: number, holdMs: number): boolean {
  if (!run || isActiveRunState(run.state) || !run.finishedAt) return false
  const finishedAt = Date.parse(run.finishedAt)
  if (!Number.isFinite(finishedAt)) return false
  // A small future skew is a clock difference, not a finished run; a large one is bad data.
  const age = now - finishedAt
  return age >= -5_000 && age < holdMs
}

/** A compact duration for the expanded view, or null when the timestamps are unusable. */
export function formatRunDuration(startedAt?: string | null, finishedAt?: string | null): string | null {
  if (!startedAt || !finishedAt) return null
  const start = Date.parse(startedAt)
  const end = Date.parse(finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return formatDurationMs(end - start)
}

/** "48 秒", "3 分 20 秒", "1 小时 5 分". */
export function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  if (minutes > 0) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`
  return `${seconds} 秒`
}
