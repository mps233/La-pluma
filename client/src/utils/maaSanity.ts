/**
 * Sanity is read from MaaCore's fight callbacks by the backend (`GET /api/agent/logs/maa-callbacks`
 * returns the newest reading). Between callbacks the value regenerates at one point per six minutes.
 */

export interface SanityReading {
  /** Sanity at the callback's report_time. */
  current: number
  /** The account's cap at that time. */
  max: number
  /** report_time as epoch milliseconds (the log writes local wall time). */
  reportAt: number
}

export interface SanityProjection extends SanityReading {
  /** Sanity now, regenerated from the last reading. */
  value: number
  /** value / max, clamped to 0..1. */
  level: number
  /** Still below the cap, so the battery reads as charging. */
  charging: boolean
  /** Milliseconds until the bar reaches max at six minutes per point. */
  timeToFull: number
}

const SANITY_POINT_MS = 6 * 60_000

/** Projects the last reading to `now` and derives the battery's state. */
export function projectSanity(reading: SanityReading, now: number = Date.now()): SanityProjection {
  const elapsed = Math.max(0, now - reading.reportAt)
  const regenerated = Math.floor(elapsed / SANITY_POINT_MS)
  const value = Math.min(reading.max, reading.current + regenerated)
  const level = reading.max > 0 ? value / reading.max : 0
  return {
    ...reading,
    value,
    level,
    charging: value < reading.max,
    timeToFull: Math.max(0, (reading.max - value) * SANITY_POINT_MS),
  }
}
