/**
 * Screen Monitor Component
 * 模拟器监控组件 - WebRTC 实时预览
 */

import { useState, useEffect, useCallback } from 'react'
import { maaApi } from '../services/api'
import ScrcpyDeviceView from './ScrcpyDeviceView'

interface ScreenMonitorProps {
  adbPath?: string
  address?: string
}

export default function ScreenMonitor({
  address = '127.0.0.1:16384'
}: ScreenMonitorProps) {
  const [webrtcStatus, setWebrtcStatus] = useState<any>(null)
  const [webrtcLoading, setWebrtcLoading] = useState<string | null>(null)
  const [autoConnectPreview, setAutoConnectPreview] = useState(false)
  const [maaControlLoading, setMaaControlLoading] = useState<string | null>(null)

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
    try {
      const result = await fn()
      if (result?.data) setWebrtcStatus(result.data)
      await refreshWebrtcStatus()
    } finally {
      setWebrtcLoading(null)
    }
  }

  const startWebrtcInfrastructure = async () => {
    let status = webrtcStatus
    if (!status?.serverRunning) {
      const result = await maaApi.startWebrtcServer()
      status = result.data
      setWebrtcStatus(status)
    }
    if (!status?.agentRunning) {
      const result = await maaApi.startWebrtcAgent(address)
      status = result.data
      setWebrtcStatus(status)
    }
    await refreshWebrtcStatus()
  }

  const startRealtimePreview = async () => {
    setWebrtcLoading('preview')
    try {
      setAutoConnectPreview(true)
      await startWebrtcInfrastructure()
    } finally {
      setWebrtcLoading(null)
    }
  }

  const runMaaControl = async (action: string, command: string, args: string[]) => {
    setMaaControlLoading(action)
    try {
      await maaApi.executeCommand(command, args, null, null, action, 'preview-control', false)
    } finally {
      setMaaControlLoading(null)
    }
  }

  return (
    <ScrcpyDeviceView
      enabled={!!webrtcStatus?.serverRunning}
      deviceId="mumu-la-pluma"
      signalingUrl={webrtcStatus?.url?.replace(/^http/, 'ws') || 'ws://127.0.0.1:8443'}
      onStartInfrastructure={startWebrtcInfrastructure}
      autoConnect={autoConnectPreview}
      infrastructureStatus={webrtcStatus}
      infrastructureLoading={webrtcLoading}
      maaControlLoading={maaControlLoading}
      onInstall={() => runWebrtcAction('install', () => maaApi.installWebrtc())}
      onToggleServer={() => runWebrtcAction('server', () => webrtcStatus?.serverRunning ? maaApi.stopWebrtcServer() : maaApi.startWebrtcServer())}
      onToggleAgent={() => runWebrtcAction('agent', () => webrtcStatus?.agentRunning ? maaApi.stopWebrtcAgent() : maaApi.startWebrtcAgent(address))}
      onStartPreview={startRealtimePreview}
      onStartGame={() => runMaaControl('启动游戏', 'startup', ['Official', '-a', address])}
      onCloseGame={() => runMaaControl('关闭游戏', 'closedown', ['Official', '-a', address])}
    />
  )
}
