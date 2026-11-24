import { describe, expect, it } from 'vitest'
import { formatLogFileSize } from './logFileSize'

describe('formatLogFileSize', () => {
  it('uses the largest readable unit without dropping small values', () => {
    expect(formatLogFileSize(0)).toBe('0 B')
    expect(formatLogFileSize(512)).toBe('512 B')
    expect(formatLogFileSize(1024)).toBe('1.00 KB')
    expect(formatLogFileSize(1536)).toBe('1.50 KB')
    expect(formatLogFileSize(49_289_370)).toBe('47.0 MB')
    expect(formatLogFileSize(1024 ** 3)).toBe('1.00 GB')
  })

  it('rejects invalid sizes', () => {
    expect(formatLogFileSize(-1)).toBe('-')
    expect(formatLogFileSize(Number.NaN)).toBe('-')
    expect(formatLogFileSize(Number.POSITIVE_INFINITY)).toBe('-')
  })
})
