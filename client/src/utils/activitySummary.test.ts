import { describe, expect, it } from 'vitest'
import { formatActivitySubtitle } from './activitySummary'

const NOW = Date.UTC(2026, 10, 2, 0, 0, 0)
const DAY_MS = 24 * 60 * 60 * 1000

describe('formatActivitySubtitle', () => {
  it('waits only when no activity is available', () => {
    expect(formatActivitySubtitle({ available: false }, NOW)).toBe('等待活动数据')
    expect(formatActivitySubtitle(undefined, NOW)).toBe('等待活动数据')
  })

  it('shows the remaining days before the activity ends', () => {
    expect(formatActivitySubtitle({ available: true, endTime: NOW + 3 * DAY_MS }, NOW)).toBe('剩余 3 天')
    expect(formatActivitySubtitle({ available: true, endTime: NOW + 3 * DAY_MS - 1 }, NOW)).toBe('剩余 3 天')
    expect(formatActivitySubtitle({ available: true, endTime: NOW + DAY_MS }, NOW)).toBe('剩余 1 天')
    expect(formatActivitySubtitle({ available: true, endTime: NOW + 1 }, NOW)).toBe('不足 1 天')
  })

  it('marks an activity window that already ended', () => {
    expect(formatActivitySubtitle({ available: true, endTime: NOW - 1 }, NOW)).toBe('活动已结束')
  })

  it('shows local completion progress when the end time is unavailable', () => {
    expect(formatActivitySubtitle({
      available: true,
      completion: {
        known: true,
        complete: false,
        completedStages: ['TL-9'],
        totalStages: 3,
      },
    }, NOW)).toBe('已通关 1/3 关')
  })

  it('clamps completion progress to the known stage count', () => {
    expect(formatActivitySubtitle({
      available: true,
      completion: {
        known: true,
        completedStages: ['TL-9', 'TL-8', 'TL-7', 'TL-6'],
        totalStages: 3,
      },
    }, NOW)).toBe('已通关 3/3 关')

    expect(formatActivitySubtitle({
      available: true,
      completion: {
        known: true,
        totalStages: 3,
      },
    }, NOW)).toBe('已通关 0/3 关')
  })

  it('falls back to an in-progress state when no time or trustworthy progress exists', () => {
    expect(formatActivitySubtitle({ available: true }, NOW)).toBe('活动进行中')
    expect(formatActivitySubtitle({
      available: true,
      completion: { known: false, complete: false, totalStages: 0, completedStages: [] },
    }, NOW)).toBe('活动进行中')
    expect(formatActivitySubtitle({ available: true, endTime: Number.NaN }, NOW)).toBe('活动进行中')
  })
})
