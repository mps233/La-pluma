import { describe, expect, it } from 'vitest'

import {
  activeScheduleTimes,
  formatScheduleTime,
  normalizeScheduleEntries,
  normalizeScheduleTimes,
  parseScheduleTime,
  readScheduleEntries,
  scheduleEntriesFromTimes,
} from './automationSchedule'

describe('automation schedule helpers', () => {
  it('normalizes and deduplicates times', () => {
    expect(normalizeScheduleTimes(['08:00', '08:00', '24:00', '7:00', '23:59'])).toEqual(['08:00', '23:59'])
  })

  it('formats and clamps parsed times', () => {
    expect(formatScheduleTime(7, 5)).toBe('07:05')
    expect(parseScheduleTime('23:59')).toEqual({ hour: 23, minute: 59 })
    expect(parseScheduleTime('99:99')).toEqual({ hour: 23, minute: 59 })
    expect(parseScheduleTime('nope')).toEqual({ hour: 0, minute: 0 })
  })

  it('normalizes entries and keeps the enabled flag', () => {
    expect(normalizeScheduleEntries([
      { time: '08:00', enabled: true },
      { time: '08:00', enabled: false },
      { time: 'bad', enabled: true },
      { time: '09:00', enabled: false },
    ])).toEqual([
      { time: '08:00', enabled: true },
      { time: '09:00', enabled: false },
    ])
  })

  it('builds entries from a legacy times list and filters active ones', () => {
    const entries = scheduleEntriesFromTimes(['08:00', '09:00'])
    expect(entries).toEqual([
      { time: '08:00', enabled: true },
      { time: '09:00', enabled: true },
    ])
    expect(activeScheduleTimes([...entries, { time: '10:00', enabled: false }])).toEqual(['08:00', '09:00'])
  })

  it('reads entries first and falls back to times', () => {
    expect(readScheduleEntries({
      entries: [{ time: '08:00', enabled: false }, '09:00', { time: 'bad' }],
      times: ['10:00'],
    })).toEqual([
      { time: '08:00', enabled: false },
      { time: '09:00', enabled: true },
    ])
    expect(readScheduleEntries({ times: ['10:00', 'bad'] })).toEqual([
      { time: '10:00', enabled: true },
    ])
    expect(readScheduleEntries(null)).toEqual([])
  })
})
