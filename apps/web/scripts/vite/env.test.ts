import { describe, expect, it } from 'vitest'
import { normalizeBasePath, resolveTestWorkers } from './env.ts'

describe('normalizeBasePath', () => {
  it('normalizes a configured deployment path', () => {
    expect(normalizeBasePath()).toBe('/')
    expect(normalizeBasePath('la-pluma')).toBe('/la-pluma/')
    expect(normalizeBasePath('/la-pluma/')).toBe('/la-pluma/')
    expect(normalizeBasePath(' /la-pluma/ ')).toBe('/la-pluma/')
  })
})

describe('resolveTestWorkers', () => {
  it('caps the default worker count and follows lower parallelism', () => {
    expect(resolveTestWorkers(undefined, 16)).toBe(4)
    expect(resolveTestWorkers(undefined, 2)).toBe(2)
    expect(resolveTestWorkers(undefined, 1)).toBe(1)
  })

  it('accepts an explicit override and rejects invalid values', () => {
    expect(resolveTestWorkers('6', 16)).toBe(6)
    expect(resolveTestWorkers(' 3 ', 16)).toBe(3)

    for (const value of ['0', '-1', '1.5', 'abc']) {
      expect(() => resolveTestWorkers(value, 16)).toThrow('LA_PLUMA_TEST_WORKERS')
    }
  })
})
