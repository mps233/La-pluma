import { useEffect, useState } from 'react'
import { getSklandStatus, maaApi } from '@/services/api'
import { projectSanity, type SanityProjection, type SanityReading } from '@/utils/maaSanity'

const SANITY_POLL_MS = 30_000
const SANITY_POLL_WHILE_RUNNING_MS = 15_000
const SANITY_TICK_MS = 30_000

const parseReportAt = (value: string): number => {
  const parsed = Date.parse(value.trim().replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : Date.now()
}

/**
 * The account's sanity. While a task runs it comes from MaaCore's fight callbacks; otherwise the
 * newest of that reading and the Skland `player/info` snapshot wins. Both are projected forward at
 * the natural regeneration rate between reads. `enabled` stops both timers and the poll for narrow
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
        const [maaResult, sklandResult] = await Promise.all([
          maaApi.getMaaCallbacks(500, controller.signal),
          getSklandStatus().catch(() => null),
        ])
        if (disposed) return
        let next: SanityReading | null = null
        const maaSanity = maaResult.success ? maaResult.data?.sanity : null
        if (maaSanity && Number.isFinite(maaSanity.current) && Number.isFinite(maaSanity.max) && maaSanity.max > 0) {
          next = {
            current: maaSanity.current,
            max: maaSanity.max,
            reportAt: parseReportAt(maaSanity.reportAt ?? ''),
          }
        }
        const sklandSanity = sklandResult?.success ? sklandResult.data?.sanity : null
        if (sklandSanity && Number.isFinite(sklandSanity.current) && Number.isFinite(sklandSanity.max) && sklandSanity.max > 0) {
          const parsedReportAt = Date.parse(sklandSanity.reportAt)
          const reportAt = Number.isFinite(parsedReportAt) ? parsedReportAt : Date.now()
          let current = sklandSanity.current
          // Skland's raw current can lag completeRecoveryTime by several points (the
          // same mismatch Mower corrects). Trust the countdown when they disagree.
          if (sklandSanity.completeRecoveryTime && sklandSanity.completeRecoveryTime > 0) {
            const remaining = sklandSanity.completeRecoveryTime * 1000 - reportAt
            if (remaining > 0) {
              const computed = Math.max(0, sklandSanity.max - Math.ceil(remaining / 360_000))
              if (Math.abs(current - computed) > 1) current = computed
            } else {
              current = sklandSanity.max
            }
          }
          const candidate: SanityReading = {
            current,
            max: sklandSanity.max,
            reportAt,
          }
          if (!next || candidate.reportAt >= next.reportAt) next = candidate
        }
        if (next) setReading(next)
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
