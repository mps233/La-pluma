import { availableParallelism } from 'node:os'

const DEFAULT_TEST_WORKERS = 4

export const normalizeBasePath = (value = '/'): string => {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '/') return '/'

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return `${withLeadingSlash.replace(/\/+$/, '')}/`
}

export const resolveTestWorkers = (
  value: string | undefined,
  parallelism: number = availableParallelism()
): number => {
  const trimmed = value?.trim()
  if (!trimmed) return Math.max(1, Math.min(DEFAULT_TEST_WORKERS, parallelism))
  if (!/^[1-9]\d*$/.test(trimmed)) throw new Error('LA_PLUMA_TEST_WORKERS must be a positive integer')
  return Number(trimmed)
}
