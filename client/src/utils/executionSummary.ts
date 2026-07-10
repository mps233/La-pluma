interface ExecutionSummaryLike {
  successCount?: unknown
  failedCount?: unknown
  skippedCount?: unknown
  durationMs?: unknown
  actions?: unknown
  summaries?: unknown
  errors?: unknown
}

const toFiniteNumber = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const getLastTaskFromEntries = (entries: unknown) => {
  if (!Array.isArray(entries)) return undefined

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry && typeof entry === 'object' && 'task' in entry && typeof entry.task === 'string') {
      return entry.task
    }
  }
  return undefined
}

export function formatExecutionSummary(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (!value || typeof value !== 'object') return undefined

  const summary = value as ExecutionSummaryLike
  const successCount = toFiniteNumber(summary.successCount)
  const failedCount = toFiniteNumber(summary.failedCount)
  const skippedCount = toFiniteNumber(summary.skippedCount)
  const durationMs = toFiniteNumber(summary.durationMs)
  const parts: string[] = []

  if (successCount !== null) parts.push(`成功 ${successCount}`)
  if (failedCount !== null && failedCount > 0) parts.push(`失败 ${failedCount}`)
  if (skippedCount !== null && skippedCount > 0) parts.push(`跳过 ${skippedCount}`)
  if (durationMs !== null) parts.push(`${Math.max(1, Math.round(durationMs / 1000))} 秒`)

  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function getExecutionLastTask(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const summary = value as ExecutionSummaryLike

  return getLastTaskFromEntries(summary.actions)
    || getLastTaskFromEntries(summary.summaries)
    || getLastTaskFromEntries(summary.errors)
}
