/**
 * Screen Monitor Component
 * 模拟器监控组件 - WebRTC 实时预览
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { maaApi, type WebrtcStatusData } from '../services/api'
import { useAutomationAvailability } from '../hooks/useBackendStatusMonitor'
import ScrcpyDeviceView from './ScrcpyDeviceView'

interface ScreenMonitorProps {
  variant?: 'full' | 'compact'
}

export default function ScreenMonitor({ variant = 'full' }: ScreenMonitorProps) {
  const { isAvailable: automationAvailable, unavailableMessage } = useAutomationAvailability()
  const [webrtcStatus, setWebrtcStatus] = useState<WebrtcStatusData | null>(null)
  const [webrtcStatusState, setWebrtcStatusState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [webrtcLoading, setWebrtcLoading] = useState<string | null>(null)
  const [webrtcActionError, setWebrtcActionError] = useState<string | null>(null)
  const operationInFlightRef = useRef<string | null>(null)
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
    return () => {
      mountedRef.current = false
      statusRequestRevisionRef.current += 1
    }
  }, [refreshWebrtcStatus])

  const runWebrtcAction = async (action: string, fn: () => Promise<any>, allowWhenUnavailable = false) => {
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
        setWebrtcStatus(result.data)
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
    try {
      const result = await maaApi.startWebrtc()
      if (!result.success) throw new Error(maaApi.getErrorMessage(result))
      if (!result.data?.signalingUrl) throw new Error('预览服务未返回信令地址')
      if (!mountedRef.current) return undefined
      setWebrtcStatus(result.data)
      setWebrtcStatusState('ready')
      return result.data.signalingUrl
    } catch (error) {
      if (!mountedRef.current) return undefined
      setWebrtcStatusState('error')
      setWebrtcActionError(error instanceof Error ? error.message : '无法启动实时预览')
      throw error
    } finally {
      operationInFlightRef.current = null
      if (mountedRef.current) setWebrtcLoading(null)
    }
  }

  return (
    <div className="scrcpy-device-container">
      <ScrcpyDeviceView
        variant={variant}
        enabled={!!webrtcStatus?.serverRunning}
        automationAvailable={automationAvailable}
        automationUnavailableMessage={unavailableMessage}
        deviceId="mumu-la-pluma"
        signalingUrl={webrtcStatus?.signalingUrl || 'ws://127.0.0.1:8443'}
        onStartInfrastructure={startWebrtcInfrastructure}
        infrastructureStatus={webrtcStatus}
        infrastructureStatusState={webrtcStatusState}
        infrastructureLoading={webrtcLoading}
        infrastructureError={webrtcActionError}
        onInstall={() => runWebrtcAction('install', () => maaApi.installWebrtc())}
        onToggleServer={() => runWebrtcAction(
          'server',
          () => webrtcStatus?.serverRunning ? maaApi.stopWebrtcServer() : maaApi.startWebrtcServer(),
          !!webrtcStatus?.serverRunning
        )}
        onToggleAgent={() => runWebrtcAction(
          'agent',
          () => webrtcStatus?.agentRunning ? maaApi.stopWebrtcAgent() : maaApi.startWebrtcAgent(),
          !!webrtcStatus?.agentRunning
        )}
      />
    </div>
  )
}
