import { useEffect } from 'react'
import { maaApi } from '../services/api'
import { useStatusStore } from '../store/statusStore'
import { useOnlineStatus } from './useOnlineStatus'

const BACKEND_PROBE_INTERVAL_MS = 30_000
const ACTIVE_TASK_PROBE_INTERVAL_MS = 2_000
let latestProbeRevision = 0

export function invalidateBackendStatusProbe() {
  latestProbeRevision += 1
}

export async function probeBackendAvailability({
  signal,
  showChecking = true,
}: {
  signal?: AbortSignal
  showChecking?: boolean
} = {}) {
  const revision = ++latestProbeRevision
  const store = useStatusStore.getState()

  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  if (showChecking) store.setBackendStatus('checking')

  try {
    const result = await maaApi.getTaskStatus(signal)
    if (revision !== latestProbeRevision) {
      return useStatusStore.getState().backendStatus === 'available'
    }

    if (result.success) {
      store.setBackendStatus('available')
      store.setActive(Boolean(result.data?.isRunning))
      return true
    }

    store.setBackendStatus('unavailable', maaApi.getErrorMessage(result) || '后端服务暂不可用，请确认服务已启动')
    return false
  } catch (error) {
    if (revision !== latestProbeRevision || (error instanceof Error && error.name === 'AbortError')) {
      return useStatusStore.getState().backendStatus === 'available'
    }
    store.setBackendStatus('unavailable', error instanceof Error ? error.message : '后端服务暂不可用，请确认服务已启动')
    return false
  }
}

export function useBackendStatusMonitor() {
  useEffect(() => {
    let controller: AbortController | null = null
    let timer: number | null = null
    let disposed = false

    const clearTimer = () => {
      if (timer === null) return
      window.clearTimeout(timer)
      timer = null
    }
    const scheduleNextProbe = () => {
      if (disposed || !navigator.onLine) return
      clearTimer()
      const delay = useStatusStore.getState().isActive
        ? ACTIVE_TASK_PROBE_INTERVAL_MS
        : BACKEND_PROBE_INTERVAL_MS
      timer = window.setTimeout(() => void runProbe(false), delay)
    }
    const runProbe = async (showChecking: boolean) => {
      clearTimer()
      controller?.abort()
      const requestController = new AbortController()
      controller = requestController
      await probeBackendAvailability({ signal: requestController.signal, showChecking })
      if (disposed || controller !== requestController) return
      controller = null
      scheduleNextProbe()
    }

    const handleOnline = () => void runProbe(true)
    const handleOffline = () => {
      clearTimer()
      controller?.abort()
      controller = null
      invalidateBackendStatusProbe()
    }
    const handleFocus = () => {
      if (navigator.onLine) void runProbe(false)
    }
    const unsubscribeStatus = useStatusStore.subscribe((state, previousState) => {
      if (state.isActive !== previousState.isActive) scheduleNextProbe()
    })

    if (navigator.onLine) void runProbe(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('focus', handleFocus)

    return () => {
      disposed = true
      clearTimer()
      unsubscribeStatus()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('focus', handleFocus)
      controller?.abort()
      invalidateBackendStatusProbe()
    }
  }, [])
}

export function useAutomationAvailability() {
  const isOnline = useOnlineStatus()
  const backendStatus = useStatusStore(state => state.backendStatus)
  const backendMessage = useStatusStore(state => state.backendMessage)
  const isAvailable = isOnline && backendStatus === 'available'

  const unavailableMessage = !isOnline
    ? '当前网络已断开，请恢复连接后重试'
    : backendStatus === 'unavailable'
      ? (backendMessage || '后端服务暂不可用，请确认服务已启动')
      : '正在检查后端服务，请稍候'

  return { isAvailable, unavailableMessage }
}
