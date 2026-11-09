/**
 * Screen Monitor Component
 * 模拟器监控组件 - WebRTC 实时预览
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { maaApi, type WebrtcStatusData } from '../services/api'
import type { ApiResponse } from '../types/api'
import { useAutomationAvailability } from '../hooks/useBackendStatusMonitor'
import { buildPreviewScrcpyOptions, usePreviewStore } from '../stores'
import ScrcpyDeviceView from './ScrcpyDeviceView'

interface ScreenMonitorProps {
  variant?: 'full' | 'compact'
}

export default function ScreenMonitor({ variant = 'full' }: ScreenMonitorProps) {
  const { isAvailable: automationAvailable, unavailableMessage } = useAutomationAvailability()
  const quality = usePreviewStore(state => state.quality)
  const fps = usePreviewStore(state => state.fps)
  const maxSize = usePreviewStore(state => state.maxSize)
  const bitrateMbps = usePreviewStore(state => state.bitrateMbps)
  const scrcpyOptions = useMemo(
    () => buildPreviewScrcpyOptions({ quality, fps, maxSize, bitrateMbps }),
    [bitrateMbps, fps, maxSize, quality]
  )
  const [webrtcStatus, setWebrtcStatus] = useState<WebrtcStatusData | null>(null)
  const [webrtcStatusState, setWebrtcStatusState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [webrtcLoading, setWebrtcLoading] = useState<string | null>(null)
  const [webrtcActionError, setWebrtcActionError] = useState<string | null>(null)
  const operationInFlightRef = useRef<string | null>(null)
  const startAbortRef = useRef<AbortController | null>(null)
  const statusRequestRevisionRef = useRef(0)
  const mountedRef = useRef(true)

  const refreshWebrtcStatus = useCallback(async () => {
    const revision = ++statusRequestRevisionRef.current
    try {
      const result = await maaApi.getWebrtcStatus()
      if (!result.success || !result.data) throw new Error(maaApi.getErrorMessage(result))
      if (!mountedRef.current || revision !== statusRequestRevisionRef.current) return false
      setWebrtcStatus(result.data)
      setWebrtcStatusState('ready')
      return true
    } catch (error) {
      if (!mountedRef.current || revision !== statusRequestRevisionRef.current) return false
      setWebrtcStatusState('error')
      setWebrtcActionError(current => current || (error instanceof Error ? error.message : '无法读取预览服务状态'))
      return false
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refreshWebrtcStatus()
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshWebrtcStatus()
    }, 15_000)
    const handleVisibility = () => {
      if (!document.hidden) void refreshWebrtcStatus()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      mountedRef.current = false
      statusRequestRevisionRef.current += 1
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refreshWebrtcStatus])

  const runWebrtcAction = async (action: string, fn: () => Promise<ApiResponse<unknown> | void>, allowWhenUnavailable = false) => {
    if (operationInFlightRef.current) return
    if (!automationAvailable && !allowWhenUnavailable) {
      setWebrtcActionError(unavailableMessage)
      return
    }
    operationInFlightRef.current = action
    statusRequestRevisionRef.current += 1
    setWebrtcLoading(action)
    setWebrtcActionError(null)
    try {
      const result = await fn()
      if (result?.success === false) throw new Error(maaApi.getErrorMessage(result))
      if (!mountedRef.current) return
      if (result?.data) {
        setWebrtcStatus(result.data as WebrtcStatusData)
        setWebrtcStatusState('ready')
      }
      await refreshWebrtcStatus()
    } catch (error) {
      if (!mountedRef.current) return
      setWebrtcActionError(error instanceof Error ? error.message : '预览操作失败')
    } finally {
      operationInFlightRef.current = null
      if (mountedRef.current) setWebrtcLoading(null)
    }
  }

  const startWebrtcInfrastructure = async (): Promise<string | undefined> => {
    if (operationInFlightRef.current) return undefined
    if (!automationAvailable) {
      setWebrtcActionError(unavailableMessage)
      return undefined
    }
    operationInFlightRef.current = 'preview'
    statusRequestRevisionRef.current += 1
    setWebrtcLoading('preview')
    setWebrtcActionError(null)
    const controller = new AbortController()
    startAbortRef.current = controller
    try {
      const result = await maaApi.startWebrtc('default', 'mumu-la-pluma', controller.signal, scrcpyOptions)
      if (!result.success) throw new Error(maaApi.getErrorMessage(result))
      if (!result.data?.signalingUrl) throw new Error('预览服务未返回信令地址')
      if (!mountedRef.current) return undefined
      setWebrtcStatus(result.data)
      setWebrtcStatusState('ready')
      return result.data.signalingUrl
    } catch (error) {
      if (controller.signal.aborted) return undefined
      if (!mountedRef.current) return undefined
      setWebrtcStatusState('error')
      setWebrtcActionError(error instanceof Error ? error.message : '无法启动实时预览')
      throw error
    } finally {
      if (startAbortRef.current === controller) startAbortRef.current = null
      operationInFlightRef.current = null
      if (mountedRef.current) setWebrtcLoading(null)
    }
  }

  const stopWebrtcPreview = () => runWebrtcAction('stop', async () => {
    const result = await maaApi.stopWebrtc()
    if (result?.success === false) throw new Error(maaApi.getErrorMessage(result))
    return result
  }, true)

  const cancelWebrtcStart = () => {
    startAbortRef.current?.abort()
    startAbortRef.current = null
    operationInFlightRef.current = null
    setWebrtcLoading(null)
    setWebrtcActionError('已取消启动')
    void refreshWebrtcStatus()
  }

  return (
    <div className="scrcpy-device-container">
      <ScrcpyDeviceView
        variant={variant}
        enabled={!!webrtcStatus?.serverRunning}
        automationAvailable={automationAvailable}
        automationUnavailableMessage={unavailableMessage}
        deviceId="mumu-la-pluma"
        signalingUrl={webrtcStatus?.signalingUrl || '/webrtc-signaling'}
        onStartInfrastructure={startWebrtcInfrastructure}
        onCancelInfrastructure={cancelWebrtcStart}
        infrastructureStatus={webrtcStatus}
        infrastructureStatusState={webrtcStatusState}
        infrastructureLoading={webrtcLoading}
        infrastructureError={webrtcActionError}
        onStopPreview={stopWebrtcPreview}
      />
    </div>
  )
}
