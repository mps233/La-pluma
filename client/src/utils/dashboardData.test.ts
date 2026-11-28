import { describe, expect, it } from 'vitest'

import {
  asRecordArray,
  asStageSummaryArray,
  firstString,
  getUsageBarClass,
  getUsageValueClass,
  isRecord,
  isValidActivityCompletion,
  normalizeActivityCompletion,
  toOptionalTimestamp,
} from './dashboardData'

describe('dashboard data helpers', () => {
  it('narrows records and picks the first non-empty string', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(firstString(undefined, '', ' ', 'x', 'y')).toBe('x')
    expect(firstString(null)).toBeUndefined()
  })

  it('accepts only positive safe integer timestamps', () => {
    expect(toOptionalTimestamp(1)).toBe(1)
    expect(toOptionalTimestamp(0)).toBeUndefined()
    expect(toOptionalTimestamp(1.5)).toBeUndefined()
    expect(toOptionalTimestamp('1')).toBeUndefined()
  })

  it('validates record and stage arrays', () => {
    expect(asRecordArray([{ a: 1 }])).toEqual([{ a: 1 }])
    expect(asRecordArray([{} as Record<string, unknown>, null])).toBeNull()
    expect(asStageSummaryArray([{ stage: '1-7', name: '坍塌' }])).toEqual([{ stage: '1-7', name: '坍塌' }])
    expect(asStageSummaryArray([{ stage: '1-7' }])).toBeNull()
    expect(asStageSummaryArray(Array.from({ length: 101 }, () => ({ stage: 'x', name: 'y' })))).toBeNull()
  })

  it('validates and normalizes activity completion payloads', () => {
    expect(isValidActivityCompletion(undefined)).toBe(true)
    expect(isValidActivityCompletion({ known: true, totalStages: 4 })).toBe(true)
    expect(isValidActivityCompletion({ known: 'yes' })).toBe(false)
    expect(isValidActivityCompletion({ totalStages: -1 })).toBe(false)
    expect(isValidActivityCompletion({ completedStages: [1] })).toBe(false)

    expect(normalizeActivityCompletion({ known: true, completedStages: ['1-7', 2], totalStages: 4 })).toEqual({
      known: true,
      complete: undefined,
      completedStages: ['1-7'],
      totalStages: 4,
    })
    expect(normalizeActivityCompletion('nope')).toBeUndefined()
  })

  it('maps usage thresholds to semantic classes', () => {
    expect(getUsageBarClass(null)).toBe('bg-[var(--app-accent)]')
    expect(getUsageBarClass(74)).toBe('bg-[var(--app-accent)]')
    expect(getUsageBarClass(75)).toBe('bg-[var(--app-warning)]')
    expect(getUsageBarClass(90)).toBe('bg-[var(--app-danger)]')
    expect(getUsageValueClass(74)).toBe('text-primary')
    expect(getUsageValueClass(75)).toBe('text-[var(--app-warning-text)]')
    expect(getUsageValueClass(90)).toBe('text-[var(--app-danger-text)]')
  })
})
