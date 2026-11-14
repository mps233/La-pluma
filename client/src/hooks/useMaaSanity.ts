import { useEffect, useState } from 'react'
import { maaApi } from '@/services/api'
import { projectSanity, type SanityProjection, type SanityReading } from '@/utils/maaSanity'

const SANITY_POLL_MS = 30_000
const SANITY_POLL_WHILE_RUNNING_MS = 15_000
const SANITY_TICK_MS = 30_000

const parseReportAt = (value: string): number => {
  const parsed = Date.parse(value.trim().replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : Date.now()
}

/**
 * The account's sanity, read from MaaCore's fight callbacks by the backend. Sanity only changes
 * while the game is driven, so the reading is polled slowly and projected forward at the natural
 * regeneration rate between callbacks. `enabled` stops both timers and the poll for narrow
 * viewports, which have no room to show the value.
 */
export function useMaaSanity(running: boolean, enabled = true): SanityProjection | null {
  const [reading, setReading] = useState<SanityReading | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), SANITY_TICK_MS)
    return () => window.clearInterval(timer)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return undefined
    let disposed = false
    let timer: number | null = null
    let controller: AbortController | null = null

    const tick = async () => {
      if (disposed) return
      controller = new AbortController()
      try {
        const result = await maaApi.getMaaCallbacks(500, controller.signal)
        if (disposed || !result.success) return
        const sanity = result.data?.sanity
        if (sanity && Number.isFinite(sanity.current) && Number.isFinite(sanity.max) && sanity.max > 0) {
          setReading({ current: sanity.current, max: sanity.max, reportAt: parseReportAt(sanity.reportAt ?? '') })
        }
      } catch {
        // Keep the last reading: a failed poll does not mean sanity changed.
      } finally {
        if (!disposed) {
          if (timer !== null) window.clearTimeout(timer)
          timer = window.setTimeout(tick, running ? SANITY_POLL_WHILE_RUNNING_MS : SANITY_POLL_MS)
        }
      }
    }

    void tick()
    return () => {
      disposed = true
      if (timer !== null) window.clearTimeout(timer)
      controller?.abort()
    }
  }, [enabled, running])

  return reading ? projectSanity(reading, now) : null
}
