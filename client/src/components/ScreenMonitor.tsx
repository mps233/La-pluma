/**
 * Screen Monitor Component
 * 模拟器监控组件 - WebRTC 实时预览
 */

import { useState, useEffect, useCallback } from 'react'
import { maaApi, type WebrtcStatusData } from '../services/api'
import { useAutomationAvailability } from '../hooks/useBackendStatusMonitor'
import ScrcpyDeviceView from './ScrcpyDeviceView'

interface ScreenMonitorProps {
  variant?: 'full' | 'compact'
}

export default function ScreenMonitor({ variant = 'full' }: ScreenMonitorProps) {
  const { isAvailable: automationAvailable, unavailableMessage } = useAutomationAvailability()
  const [webrtcStatus, setWebrtcStatus] = useState<WebrtcStatusData | null>(null)
  const [webrtcLoading, setWebrtcLoading] = useState<string | null>(null)
  const [webrtcActionError, setWebrtcActionError] = useState<string | null>(null)

  const refreshWebrtcStatus = useCallback(async () => {
    try {
      const result = await maaApi.getWebrtcStatus()
      if (result.success && result.data) setWebrtcStatus(result.data)
    } catch {
      // WebRTC 不可用时只保留页面，不再回退到 ADB 截图监控
    }
  }, [])

  useEffect(() => {
    refreshWebrtcStatus()
  }, [refreshWebrtcStatus])

  const runWebrtcAction = async (action: string, fn: () => Promise<any>, allowWhenUnavailable = false) => {
    if (!automationAvailable && !allowWhenUnavailable) {
      setWebrtcActionError(unavailableMessage)
      return
    }
    setWebrtcLoading(action)
    setWebrtcActionError(null)
    try {
      const result = await fn()
      if (result?.success === false) throw new Error(maaApi.getErrorMessage(result))
      if (result?.data) setWebrtcStatus(result.data)
      await refreshWebrtcStatus()
    } catch (error) {
      setWebrtcActionError(error instanceof Error ? error.message : '预览操作失败')
    } finally {
      setWebrtcLoading(null)
    }
  }

  const startWebrtcInfrastructure = async (): Promise<string | undefined> => {
    if (!automationAvailable) {
      setWebrtcActionError(unavailableMessage)
      return undefined
    }
    setWebrtcLoading('preview')
    setWebrtcActionError(null)
    try {
      const result = await maaApi.startWebrtc()
      if (!result.success) throw new Error(maaApi.getErrorMessage(result))
      if (!result.data?.signalingUrl) throw new Error('预览服务未返回信令地址')
      setWebrtcStatus(result.data)
      return result.data.signalingUrl
    } catch (error) {
      setWebrtcActionError(error instanceof Error ? error.message : '无法启动实时预览')
      throw error
    } finally {
      setWebrtcLoading(null)
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
