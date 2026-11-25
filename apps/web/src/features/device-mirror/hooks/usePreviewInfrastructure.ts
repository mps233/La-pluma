import { useState, useEffect, useCallback, useRef } from 'react'
import { getErrorMessage } from '@/shared/api'
import {
  getWebrtcStatus,
  installWebrtc,
  startWebrtc,
  startWebrtcAgent,
  startWebrtcServer,
  stopWebrtcAgent,
  stopWebrtcServer,
} from '../api'
import type { WebrtcStatusData } from '../types'
import { useAutomationAvailability } from '@/features/runtime-status'
import { usePreviewStore } from '../store/previewStore'
import { usePageVisible } from '@/shared/hooks/usePageVisible'

export function usePreviewInfrastructure() {
  const { isAvailable: automationAvailable, unavailableMessage } = useAutomationAvailability()
  const previewMode = usePreviewStore(state => state.mode)
  const pageVisible = usePageVisible()
  const [webrtcStatus, setWebrtcStatus] = useState<WebrtcStatusData | null>(null)
  const [webrtcStatusState, setWebrtcStatusState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [webrtcStatusError, setWebrtcStatusError] = useState<string | null>(null)
  const [webrtcLoading, setWebrtcLoading] = useState<string | null>(null)
  const [webrtcActionError, setWebrtcActionError] = useState<string | null>(null)
  const operationInFlightRef = useRef<string | null>(null)
  const statusRequestRevisionRef = useRef(0)
  const mountedRef = useRef(true)
  const actionRevisionRef = useRef(0)
  const previousAvailabilityRef = useRef(automationAvailable)
  const previousVisibilityRef = useRef(pageVisible)

  const refreshWebrtcStatus = useCallback(async () => {
    const revision = ++statusRequestRevisionRef.current
    try {
      const result = await getWebrtcStatus()
      if (!result.success || !result.data) throw new Error(getErrorMessage(result))
      if (!mountedRef.current || revision !== statusRequestRevisionRef.current) return false
      setWebrtcStatus(result.data)
      setWebrtcStatusState('ready')
      setWebrtcStatusError(null)
      return true
    } catch (error) {
      if (!mountedRef.current || revision !== statusRequestRevisionRef.current) return false
      setWebrtcStatusState('error')
      setWebrtcStatusError(error instanceof Error ? error.message : '无法读取预览服务状态')
      return false
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    if (!operationInFlightRef.current) {
      setWebrtcLoading(null)
      void refreshWebrtcStatus()
    }
    return () => {
      mountedRef.current = false
      statusRequestRevisionRef.current += 1
      actionRevisionRef.current += 1
      operationInFlightRef.current = null
    }
  }, [refreshWebrtcStatus])

  useEffect(() => {
    const backendRecovered = !previousAvailabilityRef.current && automationAvailable
    const becameVisible = !previousVisibilityRef.current && pageVisible
    previousAvailabilityRef.current = automationAvailable
    previousVisibilityRef.current = pageVisible
    if (!pageVisible || (!backendRecovered && !becameVisible) || operationInFlightRef.current) return
    void refreshWebrtcStatus()
  }, [automationAvailable, pageVisible, refreshWebrtcStatus])

  useEffect(() => {
    if (!pageVisible || previewMode === 'live' || !webrtcStatus?.agentRunning) return
    // Reconcile the service badge after idle cleanup, without permanent polling.
    const refreshWhenIdle = () => {
      if (!operationInFlightRef.current) void refreshWebrtcStatus()
    }
    const timers = [4000, 18000].map(delay => setTimeout(refreshWhenIdle, delay))
    return () => timers.forEach(clearTimeout)
  }, [pageVisible, previewMode, webrtcStatus?.agentRunning, refreshWebrtcStatus])

  const runWebrtcAction = async (action: string, fn: () => Promise<any>, allowWhenUnavailable = false) => {
    if (operationInFlightRef.current) return
    if (!automationAvailable && !allowWhenUnavailable) {
      setWebrtcActionError(unavailableMessage)
      return
    }
    const actionRevision = ++actionRevisionRef.current
    operationInFlightRef.current = action
    statusRequestRevisionRef.current += 1
    setWebrtcLoading(action)
    setWebrtcActionError(null)
    try {
      const result = await fn()
      if (result?.success === false) throw new Error(getErrorMessage(result))
      if (!mountedRef.current || actionRevision !== actionRevisionRef.current) return
      if (result?.data) {
        setWebrtcStatus(result.data)
        setWebrtcStatusState('ready')
        setWebrtcStatusError(null)
      }
      await refreshWebrtcStatus()
    } catch (error) {
      if (!mountedRef.current || actionRevision !== actionRevisionRef.current) return
      setWebrtcActionError(error instanceof Error ? error.message : '预览操作失败')
      await refreshWebrtcStatus()
    } finally {
      if (actionRevision === actionRevisionRef.current) {
        operationInFlightRef.current = null
        if (mountedRef.current) setWebrtcLoading(null)
      }
    }
  }

  const cancelWebrtcStartup = useCallback(() => {
    if (operationInFlightRef.current !== 'preview') return
    actionRevisionRef.current += 1
    statusRequestRevisionRef.current += 1
    operationInFlightRef.current = null
    if (mountedRef.current) setWebrtcLoading(null)
  }, [])

  const startWebrtcInfrastructure = async (signal?: AbortSignal): Promise<string | undefined> => {
    if (operationInFlightRef.current) return undefined
    if (!automationAvailable) {
      setWebrtcActionError(unavailableMessage)
      return undefined
    }
    const actionRevision = ++actionRevisionRef.current
    operationInFlightRef.current = 'preview'
    statusRequestRevisionRef.current += 1
    setWebrtcLoading('preview')
    setWebrtcActionError(null)
    try {
      const result = await startWebrtc('default', 'mumu-la-pluma', signal)
      if (!result.success) throw new Error(getErrorMessage(result))
      if (!result.data?.signalingUrl) throw new Error('预览服务未返回信令地址')
      if (!mountedRef.current || signal?.aborted || actionRevision !== actionRevisionRef.current) return undefined
      statusRequestRevisionRef.current += 1
      setWebrtcStatus(result.data)
      setWebrtcStatusState('ready')
      setWebrtcStatusError(null)
      return result.data.signalingUrl
    } catch (error) {
      if (!mountedRef.current || signal?.aborted || actionRevision !== actionRevisionRef.current) return undefined
      setWebrtcStatusState('error')
      setWebrtcActionError(error instanceof Error ? error.message : '无法启动实时预览')
      await refreshWebrtcStatus()
      throw error
    } finally {
      if (actionRevision === actionRevisionRef.current) {
        operationInFlightRef.current = null
        if (mountedRef.current) setWebrtcLoading(null)
      }
    }
  }

  return {
    start: startWebrtcInfrastructure,
    cancel: cancelWebrtcStartup,
    view: {
      automationAvailable,
      automationUnavailableMessage: unavailableMessage,
      infrastructureStatus: webrtcStatus,
      infrastructureStatusState: webrtcStatusState,
      infrastructureLoading: webrtcLoading,
      infrastructureError: webrtcActionError || webrtcStatusError,
      onRefreshInfrastructure: () => { void refreshWebrtcStatus() },
      onInstall: () => runWebrtcAction('install', () => installWebrtc()),
      onToggleServer: () => runWebrtcAction(
        'server',
        () => {
          if (webrtcStatus?.serverRunning) {
            usePreviewStore.getState().setMode('off')
            return stopWebrtcServer()
          }
          return startWebrtcServer()
        },
        !!webrtcStatus?.serverRunning,
      ),
      onToggleAgent: () => runWebrtcAction(
        'agent',
        () => {
          if (webrtcStatus?.agentRunning) {
            usePreviewStore.getState().setMode('off')
            return stopWebrtcAgent()
          }
          return startWebrtcAgent()
        },
        !!webrtcStatus?.agentRunning,
      ),
    },
  }
}
