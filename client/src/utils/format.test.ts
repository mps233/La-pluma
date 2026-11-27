// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  formatClockDuration,
  formatDateTime,
  formatDateTimeCompact,
  formatDurationMs,
  formatElapsedDuration,
  formatRemainingDuration,
  parseTimestamp,
} from './format'

describe('formatDurationMs', () => {
  it('rounds and uses the compact Chinese copy', () => {
    expect(formatDurationMs(48_000)).toBe('48 秒')
    expect(formatDurationMs(200_000)).toBe('3 分 20 秒')
    expect(formatDurationMs(180_000)).toBe('3 分钟')
    expect(formatDurationMs(3_900_000)).toBe('1 小时 5 分')
    expect(formatDurationMs(3_725_000)).toBe('1 小时 2 分')
    expect(formatDurationMs(-1)).toBe('0 秒')
  })
})

describe('formatElapsedDuration', () => {
  it('floors, keeps zero seconds, and rejects invalid values', () => {
    expect(formatElapsedDuration(null)).toBeNull()
    expect(formatElapsedDuration(-1)).toBeNull()
    expect(formatElapsedDuration(Number.NaN)).toBeNull()
    expect(formatElapsedDuration(200_000)).toBe('3 分 20 秒')
    expect(formatElapsedDuration(180_000)).toBe('3 分 0 秒')
    expect(formatElapsedDuration(3_900_000)).toBe('1 小时 5 分')
  })
})

describe('formatClockDuration', () => {
  it('pads minutes and seconds and grows the hour field', () => {
    expect(formatClockDuration(5_000)).toBe('00:05')
    expect(formatClockDuration(65_000)).toBe('01:05')
    expect(formatClockDuration(3_665_000)).toBe('1:01:05')
  })
})

describe('formatDateTime', () => {
  it('formats a valid timestamp with a year and preserves invalid input', () => {
    expect(formatDateTime('2026-11-28T10:00:00Z')).toContain('2026')
    expect(formatDateTime('not-a-date')).toBe('not-a-date')
  })
})

describe('formatDateTimeCompact', () => {
  it('uses a dash for missing values and omits the current year', () => {
    expect(formatDateTimeCompact(null)).toBe('—')
    expect(formatDateTimeCompact('bad')).toBe('—')
    const now = new Date()
    expect(formatDateTimeCompact(now.toISOString())).not.toContain(String(now.getFullYear()))
    expect(formatDateTimeCompact('2020-01-02T03:04:05Z')).toContain('2020')
  })
})

describe('formatRemainingDuration', () => {
  it('handles idle, minutes, and hours', () => {
    expect(formatRemainingDuration(0)).toBe('已完成或空闲')
    expect(formatRemainingDuration(300)).toBe('5 分钟')
    expect(formatRemainingDuration(3_900)).toBe('1 小时 5 分')
  })
})

describe('parseTimestamp', () => {
  it('accepts only parseable strings', () => {
    expect(parseTimestamp('2026-11-28T00:00:00Z')).toBe(Date.parse('2026-11-28T00:00:00Z'))
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('bad')).toBeNull()
    expect(parseTimestamp(123)).toBeNull()
  })
})
