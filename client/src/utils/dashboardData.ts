import type { DashboardBusinessSnapshot } from '@/state'

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export const firstString = (...values: unknown[]) => values.find(
  (value): value is string => typeof value === 'string' && value.trim().length > 0
)

export const toOptionalTimestamp = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
)

export const asRecordArray = (value: unknown): Array<Record<string, unknown>> | null => (
  Array.isArray(value) && value.every(isRecord) ? value : null
)

export const asStageSummaryArray = (value: unknown): Array<{ stage: string; name: string }> | null => {
  if (!Array.isArray(value) || value.length > 100) return null
  if (!value.every(item => isRecord(item) && typeof item.stage === 'string' && typeof item.name === 'string')) {
    return null
  }
  return value.map(item => ({ stage: item.stage as string, name: item.name as string }))
}

export const isValidActivityCompletion = (value: unknown) => {
  if (value == null) return true
  if (!isRecord(value)) return false

  return (value.known === undefined || typeof value.known === 'boolean')
    && (value.complete === undefined || typeof value.complete === 'boolean')
    && (value.completedStages === undefined
      || (Array.isArray(value.completedStages)
        && value.completedStages.length <= 500
        && value.completedStages.every(stage => typeof stage === 'string')))
    && (value.totalStages === undefined
      || (typeof value.totalStages === 'number'
        && Number.isSafeInteger(value.totalStages)
        && value.totalStages >= 0))
}

export const normalizeActivityCompletion = (
  value: unknown,
): DashboardBusinessSnapshot['activitySummary']['completion'] => {
  if (!isRecord(value)) return undefined
  return {
    known: typeof value.known === 'boolean' ? value.known : undefined,
    complete: typeof value.complete === 'boolean' ? value.complete : undefined,
    completedStages: Array.isArray(value.completedStages)
      ? value.completedStages.filter((stage): stage is string => typeof stage === 'string')
      : undefined,
    totalStages: typeof value.totalStages === 'number' ? value.totalStages : undefined,
  }
}

export const getUsageBarClass = (pct?: number | null) => {
  if (pct == null) return 'bg-[var(--app-accent)]'
  if (pct >= 90) return 'bg-[var(--app-danger)]'
  if (pct >= 75) return 'bg-[var(--app-warning)]'
  return 'bg-[var(--app-accent)]'
}

export const getUsageValueClass = (pct?: number | null) => {
  if (pct == null) return 'text-primary'
  if (pct >= 90) return 'text-[var(--app-danger-text)]'
  if (pct >= 75) return 'text-[var(--app-warning-text)]'
  return 'text-primary'
}
