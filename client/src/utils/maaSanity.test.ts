import { describe, expect, it } from 'vitest'
import { projectSanity } from './maaSanity'

const sixMinutes = 6 * 60_000

describe('projectSanity', () => {
  it('keeps the last reading before another point can regenerate', () => {
    const reportAt = Date.parse('2026-11-14T10:00:00Z')
    const sanity = projectSanity({ current: 45, max: 135, reportAt }, reportAt + 60_000)

    expect(sanity.value).toBe(45)
    expect(sanity.level).toBeCloseTo(45 / 135)
    expect(sanity.charging).toBe(true)
    expect(sanity.timeToFull).toBe((135 - 45) * sixMinutes)
  })

  it('regenerates one point per six minutes', () => {
    const reportAt = Date.parse('2026-11-14T10:00:00Z')
    const sanity = projectSanity({ current: 45, max: 135, reportAt }, reportAt + sixMinutes * 12)

    expect(sanity.value).toBe(57)
    expect(sanity.timeToFull).toBe((135 - 57) * sixMinutes)
  })

  it('caps the projected value at the account maximum', () => {
    const reportAt = Date.parse('2026-11-14T10:00:00Z')
    const sanity = projectSanity({ current: 132, max: 135, reportAt }, reportAt + sixMinutes * 20)

    expect(sanity.value).toBe(135)
    expect(sanity.level).toBe(1)
    expect(sanity.charging).toBe(false)
    expect(sanity.timeToFull).toBe(0)
  })

  it('does not rewind when the reading is stamped in the future', () => {
    const reportAt = Date.parse('2026-11-14T10:00:00Z')
    const sanity = projectSanity({ current: 45, max: 135, reportAt }, reportAt - 30_000)

    expect(sanity.value).toBe(45)
  })

  it('handles a zero maximum without dividing by it', () => {
    const reportAt = Date.parse('2026-11-14T10:00:00Z')
    const sanity = projectSanity({ current: 0, max: 0, reportAt }, reportAt)

    expect(sanity.level).toBe(0)
    expect(sanity.value).toBe(0)
  })
})
