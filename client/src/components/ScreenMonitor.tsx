/**
 * Screen Monitor Component
 * 模拟器监控组件 - WebRTC 实时预览
 */

import { useState, useEffect, useCallback } from 'react'
import { maaApi } from '../services/api'
import ScrcpyDeviceView from './ScrcpyDeviceView'

interface ScreenMonitorProps {
  variant?: 'full' | 'compact'
}

export default function ScreenMonitor({ variant = 'full' }: ScreenMonitorProps) {
  const [webrtcStatus, setWebrtcStatus] = useState<any>(null)
  const [webrtcLoading, setWebrtcLoading] = useState<string | null>(null)
  const [webrtcActionError, setWebrtcActionError] = useState<string | null>(null)

  const refreshWebrtcStatus = useCallback(async () => {
    try {
      const result = await maaApi.getWebrtcStatus()
      if (result.success) setWebrtcStatus(result.data)
    } catch {
      // WebRTC 不可用时只保留页面，不再回退到 ADB 截图监控
    }
  }, [])

  useEffect(() => {
    refreshWebrtcStatus()
  }, [refreshWebrtcStatus])

  const runWebrtcAction = async (action: string, fn: () => Promise<any>) => {
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

  const startWebrtcInfrastructure = async () => {
    setWebrtcLoading('preview')
    setWebrtcActionError(null)
    try {
      let status = webrtcStatus
      if (!status?.serverRunning) {
        const result = await maaApi.startWebrtcServer()
        if (!result.success) throw new Error(maaApi.getErrorMessage(result))
        status = result.data
        setWebrtcStatus(status)
      }
      if (!status?.agentRunning) {
        const result = await maaApi.startWebrtcAgent()
        if (!result.success) throw new Error(maaApi.getErrorMessage(result))
        status = result.data
        setWebrtcStatus(status)
      }
      await refreshWebrtcStatus()
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
        deviceId="mumu-la-pluma"
        signalingUrl={webrtcStatus?.signalingUrl || 'ws://127.0.0.1:8443'}
        onStartInfrastructure={startWebrtcInfrastructure}
        infrastructureStatus={webrtcStatus}
        infrastructureLoading={webrtcLoading}
        infrastructureError={webrtcActionError}
        onInstall={() => runWebrtcAction('install', () => maaApi.installWebrtc())}
        onToggleServer={() => runWebrtcAction('server', () => webrtcStatus?.serverRunning ? maaApi.stopWebrtcServer() : maaApi.startWebrtcServer())}
        onToggleAgent={() => runWebrtcAction('agent', () => webrtcStatus?.agentRunning ? maaApi.stopWebrtcAgent() : maaApi.startWebrtcAgent())}
      />
    </div>
  )
}
