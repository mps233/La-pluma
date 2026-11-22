import { useEffect } from 'react'
import { getMasteryStatus } from '../services/api'
import { useMasteryStore } from '../store/masteryStore'
import type { MasteryCampaignStatus, MasteryQueueStatus } from '../types/components'

const RUNNING_POLL_MS = 5_000
const IDLE_POLL_MS = 30_000
const HIDDEN_POLL_MS = 30_000

const SETTLED: ReadonlySet<MasteryCampaignStatus> = new Set(['idle', 'paused', 'blocked', 'completed', 'interrupted'])

/** The campaign state the island should hold briefly after it ends. */
function settledOutcome(status: MasteryQueueStatus): string | null {
  if (status.campaign.status === 'completed') return '所有专精目标已处理完成'
  if (status.campaign.status === 'blocked') return status.campaign.pausedReason || '专精队列需要人工处理'
  if (status.campaign.status === 'interrupted') return '服务重启，专精状态需要复核'
  return null
}

/**
 * 应用级技能专精观察器：只把 /operator-mastery/status 的快照投影到 store，
 * 不做副作用。岛和养成页读同一份事实，所以切换页面或刷新后仍然一致。
 */
export function useMasteryStatusMonitor() {
  useEffect(() => {
    let disposed = false
    let timer: number | null = null
    let controller: AbortController | null = null
    let inFlight = false
    let lastCampaign: MasteryCampaignStatus | null = null
    // Only an outcome the user saw happen while this page was open is announced; a campaign that
    // finished before the app opened must not pop the island on every load.
    let sawRunning = false

    const clearTimer = () => {
      if (timer === null) return
      window.clearTimeout(timer)
      timer = null
    }

    const schedule = (delay: number) => {
      if (disposed) return
      clearTimer()
      timer = window.setTimeout(() => void request(), delay)
    }

    const request = async () => {
      if (disposed || inFlight) return
      if (typeof document !== 'undefined' && document.hidden) {
        schedule(HIDDEN_POLL_MS)
        return
      }

      inFlight = true
      const requestController = new AbortController()
      controller = requestController

      try {
        const result = await getMasteryStatus()
        if (disposed) return
        if (!result.success || !result.data) throw new Error(result.message || '获取专精状态失败')

        const status = result.data
        useMasteryStore.getState().applyStatus(status)

        const previous = lastCampaign
        const next = status.campaign.status
        lastCampaign = next
        if (next === 'running') sawRunning = true
        if (sawRunning && previous !== null && previous === 'running' && next !== 'running' && SETTLED.has(next)) {
          sawRunning = false
          const message = settledOutcome(status)
          if (message) useMasteryStore.getState().setLastOutcome({ status: next, at: Date.now(), message })
        }
      } catch (error) {
        if (disposed || (error instanceof Error && error.name === 'AbortError')) return
        useMasteryStore.getState().applyError(error instanceof Error ? error.message : '网络错误')
      } finally {
        if (!disposed) {
          inFlight = false
          controller = null
          const campaign = useMasteryStore.getState().status?.campaign.status
          schedule(campaign === 'running' ? RUNNING_POLL_MS : IDLE_POLL_MS)
        }
      }
    }

    const handleVisibilityChange = () => {
      clearTimer()
      if (typeof document !== 'undefined' && document.hidden) {
        schedule(HIDDEN_POLL_MS)
        return
      }
      void request()
    }

    const handleOnline = () => {
      clearTimer()
      void request()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleOnline)
    void request()

    return () => {
      disposed = true
      clearTimer()
      controller?.abort()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
    }
  }, [])
}
