import { useEffect } from 'react'

import { maaApi } from '../services/api'
import type { StatusMessageType } from '../utils/statusMessage'
import { keepNumberWithUnit } from '../utils/typography'

const POLL_INTERVAL_MS = 2_000
const STALE_AFTER_MINUTES = 5
const WARN_AFTER_FAILURES = 3

export interface TaskRestoreMonitorOptions {
  /** Backend `taskType` this page owns, for example `combat`. */
  taskType: string
  setRunning: (running: boolean) => void
  setActiveStatus: (active: boolean) => void
  setStatusMessage: (message: string, type?: StatusMessageType) => unknown
  /** Shown after three consecutive failed status polls. */
  unreachableWarning: string
}

/**
 * Restores the page's running flag from the backend task status and keeps it
 * fresh with a 2 s poll while the matching task runs. Pages keep their own
 * submit-in-flight state; this hook only mirrors the server fact.
 */
export function useTaskRestoreMonitor({
  taskType,
  setRunning,
  setActiveStatus,
  setStatusMessage,
  unreachableWarning,
}: TaskRestoreMonitorOptions) {
  useEffect(() => {
    let cancelled = false
    let pollInterval: ReturnType<typeof setInterval> | null = null
    let pollFailures = 0
    let pollRequestInFlight = false
    const controller = new AbortController()

    const stopStatusPolling = () => {
      if (!pollInterval) return
      clearInterval(pollInterval)
      pollInterval = null
    }

    const checkBackendStatus = async () => {
      try {
        const result = await maaApi.getTaskStatus(controller.signal)
        if (cancelled) return
        const taskStatus = result.data
        if (!result.success) return

        const backendRunning = Boolean(taskStatus?.isRunning)
        setActiveStatus(backendRunning)

        if (!backendRunning || taskStatus?.taskType !== taskType) {
          setRunning(false)
          return
        }

        const { taskName, startTime } = taskStatus
        const elapsedMinutes = (Date.now() - (startTime ?? 0)) / 1000 / 60
        setRunning(true)
        if (elapsedMinutes > STALE_AFTER_MINUTES) {
          setStatusMessage(`${taskName} 可能已完成（${keepNumberWithUnit(`已运行 ${Math.floor(elapsedMinutes)} 分钟`)}）`)
        } else {
          setStatusMessage(`正在执行: ${taskName}`)
        }

        pollInterval = setInterval(async () => {
          if (pollRequestInFlight || document.hidden) return
          pollRequestInFlight = true
          try {
            const statusResult = await maaApi.getTaskStatus(controller.signal)
            if (cancelled) return
            if (statusResult.success) {
              setActiveStatus(Boolean(statusResult.data?.isRunning))
            }
            if (statusResult.success && statusResult.data?.isRunning === false) {
              setRunning(false)
              setStatusMessage('任务已完成')
              stopStatusPolling()
            } else if (statusResult.success) {
              pollFailures = 0
            }
          } catch (error) {
            if (cancelled || (error instanceof Error && error.name === 'AbortError')) return
            pollFailures += 1
            if (pollFailures === WARN_AFTER_FAILURES) {
              setStatusMessage(unreachableWarning, 'warning')
            }
          } finally {
            pollRequestInFlight = false
          }
        }, POLL_INTERVAL_MS)
      } catch {
        // A failed restore probe is silent; the global backend monitor owns
        // connectivity messaging.
      }
    }

    void checkBackendStatus()

    return () => {
      cancelled = true
      controller.abort()
      stopStatusPolling()
    }
  }, [setActiveStatus, setRunning, setStatusMessage, taskType, unreachableWarning])
}
