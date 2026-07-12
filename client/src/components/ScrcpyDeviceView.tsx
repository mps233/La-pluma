import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Gauge, Home, Maximize2, Minimize2, Package, PanelsTopLeft, Plug, RotateCw, Server, SlidersHorizontal, Smartphone, Unplug } from 'lucide-react'
import { Button } from './common'
import { useScrcpyWebRTC } from '../hooks/useScrcpyWebRTC'
import { maaApi } from '../services/api'

interface ScrcpyDeviceViewProps {
  enabled: boolean
  variant?: 'full' | 'compact'
  deviceId?: string
  signalingUrl?: string
  onStartInfrastructure?: () => Promise<string | undefined> | string | undefined
  autoConnect?: boolean
  onStatusChange?: (status: string, stats: any, error: string | null) => void
  infrastructureStatus?: {
    installed?: boolean
    built?: boolean
    serverRunning?: boolean
    agentRunning?: boolean
  } | null
  infrastructureLoading?: string | null
  infrastructureError?: string | null
  onInstall?: () => Promise<void> | void
  onToggleServer?: () => Promise<void> | void
  onToggleAgent?: () => Promise<void> | void
}

const statusLabel: Record<string, string> = {
  idle: '未连接',
  connecting: '连接中',
  signaling: '信令中',
  waiting_offer: '等待画面',
  connecting_webrtc: '建立 WebRTC',
  connected: '已连接',
  disconnected: '已断开',
  error: '连接失败'
}

const qualityPresets = {
  smooth: { label: '流畅', fps: 30, maxSize: 960, bitrateMbps: 4, maxBitrateMbps: 8 },
  balanced: { label: '均衡', fps: 45, maxSize: 1280, bitrateMbps: 8, maxBitrateMbps: 16 },
  crisp: { label: '清晰', fps: 60, maxSize: 1600, bitrateMbps: 14, maxBitrateMbps: 24 },
  ultra: { label: '超清', fps: 60, maxSize: 1920, bitrateMbps: 20, maxBitrateMbps: 32 }
} as const

const fpsOptions = [30, 60, 90, 120] as const

type QualityPreset = keyof typeof qualityPresets

export default function ScrcpyDeviceView({
  enabled,
  variant = 'full',
  deviceId = 'mumu-la-pluma',
  signalingUrl = 'ws://127.0.0.1:8443',
  onStartInfrastructure,
  autoConnect = false,
  onStatusChange,
  infrastructureStatus,
  infrastructureLoading,
  infrastructureError,
  onInstall,
  onToggleServer,
  onToggleAgent
}: ScrcpyDeviceViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const immersiveVideoRef = useRef<HTMLVideoElement | null>(null)
  const immersiveStreamRef = useRef<MediaStream | null>(null)
  const pointerDownRef = useRef(false)
  const autoConnectStartedRef = useRef(false)
  const [quality, setQuality] = useState<QualityPreset>('smooth')
  const [customFps, setCustomFps] = useState<number>(qualityPresets.smooth.fps)
  const [customMaxSize, setCustomMaxSize] = useState<number>(qualityPresets.smooth.maxSize)
  const [customBitrateMbps, setCustomBitrateMbps] = useState<number>(qualityPresets.smooth.bitrateMbps)
  const [immersiveMode, setImmersiveMode] = useState(false)
  const [previewOrientation, setPreviewOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [orientationLoading, setOrientationLoading] = useState(false)
  const bitrateProgress = ((customBitrateMbps - 2) / (32 - 2)) * 100
  const scrcpyOptions = useMemo(() => ({
    max_fps: customFps,
    max_size: customMaxSize,
    bitrate: customBitrateMbps * 1000000,
    min_bitrate: Math.max(1000000, Math.round(customBitrateMbps * 0.35 * 1000000)),
    max_bitrate: Math.max(customBitrateMbps, qualityPresets[quality].maxBitrateMbps) * 1000000,
    bwe: true,
    audio: false,
    snapshot_interval: 10
  }), [customBitrateMbps, customFps, customMaxSize, quality])
  const webrtc = useScrcpyWebRTC({
    deviceId,
    signalingUrl,
    videoRef,
    connectionPath: 'auto',
    ipPreference: 'ipv4',
    scrcpyOptions
  })
  const isCompact = variant === 'compact'
  const connectingStatuses = ['connecting', 'signaling', 'waiting_offer', 'connecting_webrtc']
  const isConnecting = connectingStatuses.includes(webrtc.status)
  const canDisconnect = !['idle', 'disconnected'].includes(webrtc.status)
  const needsInstall = !!infrastructureStatus && (!infrastructureStatus.installed || !infrastructureStatus.built)
  const visibleError = webrtc.error || infrastructureError
  const statusDotClass = visibleError
    ? 'bg-red-400'
    : webrtc.status === 'connected'
    ? 'bg-emerald-400'
    : isConnecting
        ? 'bg-amber-400'
        : 'bg-gray-400'

  const applyPreset = (preset: QualityPreset) => {
    const next = qualityPresets[preset]
    setQuality(preset)
    setCustomMaxSize(next.maxSize)
    setCustomBitrateMbps(next.bitrateMbps)
  }

  const connect = useCallback(async () => {
    try {
      const freshSignalingUrl = await onStartInfrastructure?.()
      webrtc.connect(freshSignalingUrl)
    } catch {
      // 基础设施错误由 ScreenMonitor 显示，连接流程到此停止。
    }
  }, [onStartInfrastructure, webrtc])

  useEffect(() => {
    onStatusChange?.(webrtc.status, webrtc.stats, webrtc.error)
  }, [onStatusChange, webrtc.error, webrtc.stats, webrtc.status])

  useEffect(() => {
    if (!autoConnect) {
      autoConnectStartedRef.current = false
      return
    }
    if (!enabled || autoConnectStartedRef.current) return
    autoConnectStartedRef.current = true
    void connect()
  }, [autoConnect, connect, enabled])

  const onPointerDown = (event: React.PointerEvent<HTMLVideoElement>) => {
    pointerDownRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    webrtc.sendTouch(0, event.clientX, event.clientY, event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLVideoElement>) => {
    if (!pointerDownRef.current) return
    webrtc.sendTouch(2, event.clientX, event.clientY, event.pointerId)
  }

  const finishPointer = (event: React.PointerEvent<HTMLVideoElement>) => {
    if (!pointerDownRef.current) return
    pointerDownRef.current = false
    webrtc.sendTouch(1, event.clientX, event.clientY, event.pointerId, event.currentTarget)
  }

  const onImmersivePointerDown = (event: React.PointerEvent<HTMLVideoElement>) => {
    pointerDownRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    webrtc.sendTouch(0, event.clientX, event.clientY, event.pointerId, event.currentTarget)
  }

  const onImmersivePointerMove = (event: React.PointerEvent<HTMLVideoElement>) => {
    if (!pointerDownRef.current) return
    webrtc.sendTouch(2, event.clientX, event.clientY, event.pointerId, event.currentTarget)
  }

  const finishImmersivePointer = (event: React.PointerEvent<HTMLVideoElement>) => {
    if (!pointerDownRef.current) return
    pointerDownRef.current = false
    webrtc.sendTouch(1, event.clientX, event.clientY, event.pointerId, event.currentTarget)
  }

  const fullscreen = () => {
    // 不走浏览器真实 fullscreen，直接打开应用内“画面全屏”遮罩，手机上更可靠。
    setImmersiveMode(true)
  }
  const exitImmersive = () => setImmersiveMode(false)

  const togglePreviewOrientation = async () => {
    if (orientationLoading) return
    const next = previewOrientation === 'portrait' ? 'landscape' : 'portrait'
    setOrientationLoading(true)
    try {
      const result = await maaApi.setPreviewOrientation(next)
      if (result.success) setPreviewOrientation(next)
    } finally {
      setOrientationLoading(false)
    }
  }

  useEffect(() => {
    const mainVideo = videoRef.current
    const overlayVideo = immersiveVideoRef.current
    if (!immersiveMode || !mainVideo || !overlayVideo) return

    const sourceStream = mainVideo.srcObject as MediaStream | null
    if (sourceStream) {
      const cloned = new MediaStream(sourceStream.getVideoTracks().map(track => track.clone()))
      immersiveStreamRef.current = cloned
      overlayVideo.srcObject = cloned
      void overlayVideo.play().catch(() => {})
    }

    return () => {
      immersiveStreamRef.current?.getTracks().forEach(track => track.stop())
      immersiveStreamRef.current = null
      if (overlayVideo) overlayVideo.srcObject = null
    }
  }, [immersiveMode])

  const statusCards = [
    ['信令', statusLabel[webrtc.status] || webrtc.status],
    ['ICE', webrtc.stats?.iceState || '--'],
    ['视频', webrtc.stats?.videoLive ? 'live' : '--'],
    ['分辨率', webrtc.stats?.width ? `${webrtc.stats.width}×${webrtc.stats.height}` : '--'],
    ['FPS', webrtc.stats?.fps ?? '--'],
    ['码率', webrtc.stats?.bitrate ? `${webrtc.stats.bitrate} kbps` : '--'],
    ['延迟', webrtc.stats?.rtt ? `${webrtc.stats.rtt} ms` : '--'],
    ['触控', webrtc.stats?.inputReady ? 'ready' : '--']
  ]

  return (
    <>
    <div className={`scrcpy-device-layout ${isCompact ? 'is-compact' : ''}`}>
      <div className="space-y-3 min-w-0">
        <div className={`scrcpy-view-header flex items-start justify-between gap-3 flex-wrap ${isCompact ? 'is-compact' : ''}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${statusDotClass}`} />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">{isCompact ? '模拟器画面' : '模拟器实时预览'}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400" role="status" aria-live="polite">
                {statusLabel[webrtc.status] || webrtc.status}
              </span>
            </div>

          </div>
          {isCompact && canDisconnect && (
            <button
              type="button"
              onClick={webrtc.disconnect}
              title="断开预览"
              aria-label="断开预览"
              className="scrcpy-compact-disconnect control-surface flex h-7 w-7 items-center justify-center rounded-md text-secondary transition-colors hover:text-primary"
            >
              <Unplug className="h-4 w-4" strokeWidth={1.8} />
            </button>
          )}
          {!isCompact && <div className="flex flex-wrap gap-2 text-xs justify-end">
            <span className="surface-soft rounded-full px-2 py-1 text-secondary">
              组件：{infrastructureStatus?.built ? '已安装' : infrastructureStatus?.installed ? '待构建' : '未安装'}
            </span>
            <span className="surface-soft rounded-full px-2 py-1 text-secondary">
              服务：{infrastructureStatus?.serverRunning ? '运行中' : '已停止'}
            </span>
            <span className="surface-soft rounded-full px-2 py-1 text-secondary">
              Agent：{infrastructureStatus?.agentRunning ? '运行中' : '已停止'}
            </span>
            {visibleError && (
              <span className="px-2 py-1 rounded-full bg-red-100 dark:bg-red-500/10 dark:text-red-300 text-red-600">{visibleError}</span>
            )}
          </div>}
        </div>

        {!isCompact && <div className="scrcpy-status-grid">
          {statusCards.map(([label, value]) => (
            <div key={label} className="surface-soft rounded-lg px-2 py-1.5">
              <div className="text-tertiary">{label}</div>
              <div className="truncate font-medium text-primary">{value}</div>
            </div>
          ))}
        </div>}

        <div className="scrcpy-video-frame relative aspect-video rounded-2xl bg-black overflow-hidden flex items-center justify-center shadow-sm">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label="模拟器实时画面"
            className="w-full h-full object-contain touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={finishPointer}
            onPointerLeave={finishPointer}
          />
          {webrtc.status !== 'connected' && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/60 text-center px-6"
              role={visibleError ? 'alert' : 'status'}
              aria-live="polite"
            >
              <div>
                <div className="text-sm font-semibold text-white mb-1">
                  {visibleError ? '预览启动失败' : '等待实时画面'}
                </div>
                <div className="text-xs text-gray-300 max-w-md">
                  {visibleError || (isCompact
                    ? '点击按钮连接模拟器。'
                    : '点击“启动实时预览”后，La-pluma 会自动启动服务、连接 MuMu 并显示实时画面。')}
                </div>
                {isCompact && (
                  <div className="mt-4 flex justify-center">
                    <Button
                      size="sm"
                      variant="gradient"
                      className="min-w-32 px-4"
                      icon={needsInstall
                        ? <Package className="h-3.5 w-3.5" strokeWidth={1.8} />
                        : <Plug className="h-3.5 w-3.5" strokeWidth={1.8} />}
                      onClick={needsInstall ? onInstall : connect}
                      disabled={infrastructureLoading !== null || isConnecting}
                      loading={infrastructureLoading === 'install' || infrastructureLoading === 'preview' || isConnecting}
                    >
                      {needsInstall
                        ? '安装预览组件'
                        : visibleError
                          ? '重试预览'
                          : '启动预览'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="scrcpy-preview-toolbar flex items-center justify-center gap-2 bg-transparent px-2 py-1">
          {[
            {
              label: '返回',
              disabled: webrtc.status !== 'connected',
              onClick: () => webrtc.sendCommand('input keyevent 4'),
              icon: <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            },
            {
              label: 'Home',
              disabled: webrtc.status !== 'connected',
              onClick: () => webrtc.sendCommand('input keyevent 3'),
              icon: <Home className="h-3.5 w-3.5" strokeWidth={1.8} />
            },
            {
              label: '全屏',
              disabled: webrtc.status !== 'connected',
              onClick: fullscreen,
              icon: <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            },
            {
              label: previewOrientation === 'portrait' ? '横屏' : '竖屏',
              disabled: orientationLoading,
              onClick: togglePreviewOrientation,
              icon: <RotateCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            },
            {
              label: '后台任务',
              disabled: webrtc.status !== 'connected',
              onClick: () => webrtc.sendCommand('input keyevent 187'),
              icon: <PanelsTopLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            }
          ].filter(action => !isCompact || action.label !== '后台任务').map(action => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              title={action.label}
              aria-label={action.label}
              className={`control-surface flex items-center justify-center rounded-full text-secondary transition-colors hover:text-[var(--app-accent)] disabled:cursor-not-allowed disabled:opacity-35 ${isCompact ? 'h-10 w-10' : 'h-8 w-8'}`}
            >
              {action.icon}
            </button>
          ))}
        </div>

      </div>

      {!isCompact && <aside className="scrcpy-control-rail surface-soft">
        <section className="scrcpy-control-section">
          <div className="scrcpy-control-header">
            <div className="scrcpy-control-title">
              <Plug className="h-4 w-4" strokeWidth={1.8} />
              <span>连接与服务</span>
            </div>
            <span className="scrcpy-inline-status" role="status" aria-live="polite">
              <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`} />
              {statusLabel[webrtc.status] || webrtc.status}
            </span>
          </div>

          <Button
            size="sm"
            variant="gradient"
            fullWidth
            className="scrcpy-preview-action"
            icon={webrtc.status === 'connected'
              ? <RotateCw className="h-3.5 w-3.5" strokeWidth={1.8} />
              : <Plug className="h-3.5 w-3.5" strokeWidth={1.8} />}
            onClick={connect}
            disabled={infrastructureLoading !== null || isConnecting}
            loading={infrastructureLoading === 'preview' || isConnecting}
          >
            {webrtc.status === 'connected' ? '重连预览' : '启动预览'}
          </Button>

          <div className="scrcpy-service-grid">
            {[
              { label: infrastructureStatus?.serverRunning ? '停止服务' : '启动服务', icon: Server, onClick: onToggleServer, disabled: false, loading: infrastructureLoading === 'server' },
              { label: infrastructureStatus?.agentRunning ? '停止 Agent' : '连接 Agent', icon: Smartphone, onClick: onToggleAgent, disabled: !infrastructureStatus?.serverRunning, loading: infrastructureLoading === 'agent' }
            ].map(action => {
              const Icon = action.icon
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  disabled={action.disabled || action.loading}
                  className="scrcpy-service-action control-surface"
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
                  <span>{action.loading ? '处理中' : action.label}</span>
                </button>
              )
            })}
          </div>

          <div className="scrcpy-service-utilities">
            <button
              type="button"
              onClick={webrtc.disconnect}
              disabled={webrtc.status === 'idle' || webrtc.status === 'disconnected'}
              className="scrcpy-utility-action"
            >
              <Unplug className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span>断开</span>
            </button>
            <button
              type="button"
              onClick={onInstall}
              disabled={infrastructureLoading !== null}
              className="scrcpy-utility-action"
            >
              <Package className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span>{infrastructureLoading === 'install' ? '安装中' : infrastructureStatus?.built ? '重装组件' : '安装组件'}</span>
            </button>
          </div>
        </section>

        <section className="scrcpy-control-section">
          <div className="scrcpy-quality-header">
            <div className="scrcpy-control-title">
              <SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} />
              <span>画质设置</span>
            </div>
            <span className="scrcpy-quality-current">{customMaxSize}p · {customFps} FPS</span>
          </div>

          <div className="scrcpy-quality-content">
            <div className="scrcpy-quality-body">
              <div className="scrcpy-setting-group">
                <div className="scrcpy-setting-label">画质预设</div>
                <div className="scrcpy-preset-grid">
                  {Object.entries(qualityPresets).map(([key, preset]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applyPreset(key as QualityPreset)}
                      aria-pressed={quality === key}
                      className={`scrcpy-preset-option ${quality === key ? 'is-active' : ''}`}
                    >
                      <span>{preset.label}</span>
                      <small>{preset.maxSize}p · {preset.bitrateMbps}M</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="scrcpy-setting-group">
                <div className="scrcpy-setting-label">帧率</div>
                <div className="scrcpy-fps-segment">
                  {fpsOptions.map(fps => (
                    <button
                      key={fps}
                      type="button"
                      onClick={() => setCustomFps(fps)}
                      aria-pressed={customFps === fps}
                      className={customFps === fps ? 'is-active' : ''}
                    >
                      {fps}
                    </button>
                  ))}
                </div>
              </div>

              <div className="scrcpy-bitrate-control">
                <div className="scrcpy-bitrate-header">
                  <span className="scrcpy-bitrate-label">
                    <Gauge className="h-3.5 w-3.5" strokeWidth={1.8} />码率
                  </span>
                  <output htmlFor="scrcpy-bitrate" className="scrcpy-bitrate-value">
                    <strong>{customBitrateMbps}</strong>
                    <span>Mbps</span>
                  </output>
                </div>
                <div
                  className="scrcpy-bitrate-slider"
                  style={{ '--scrcpy-range-progress': `${bitrateProgress}%` } as CSSProperties}
                >
                  <div className="scrcpy-bitrate-track" aria-hidden="true">
                    <span className="scrcpy-bitrate-fill" />
                    <span className="scrcpy-bitrate-handle" />
                  </div>
                  <input
                    id="scrcpy-bitrate"
                    type="range"
                    min={2}
                    max={32}
                    step={1}
                    value={customBitrateMbps}
                    aria-label="视频码率"
                    onChange={(event) => setCustomBitrateMbps(Number(event.target.value))}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </aside>}
    </div>
    {immersiveMode && createPortal(
      <div className="fixed inset-0 z-[9999] bg-black flex flex-col landscape:flex-row items-center justify-center gap-2 p-2">
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch">
          <video
            ref={immersiveVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-contain touch-none select-none"
          onPointerDown={onImmersivePointerDown}
          onPointerMove={onImmersivePointerMove}
          onPointerUp={finishImmersivePointer}
          onPointerCancel={finishImmersivePointer}
          onPointerLeave={finishImmersivePointer}
          />
        </div>
        <div className="flex shrink-0 items-center justify-center gap-2 landscape:flex-col">
          {[
            {
              label: '返回',
              disabled: webrtc.status !== 'connected',
              onClick: () => webrtc.sendCommand('input keyevent 4'),
              icon: <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            },
            {
              label: 'Home',
              disabled: webrtc.status !== 'connected',
              onClick: () => webrtc.sendCommand('input keyevent 3'),
              icon: <Home className="h-3.5 w-3.5" strokeWidth={1.8} />
            },
            {
              label: '退出全屏',
              disabled: false,
              onClick: exitImmersive,
              icon: <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            },
            {
              label: previewOrientation === 'portrait' ? '横屏' : '竖屏',
              disabled: orientationLoading,
              onClick: togglePreviewOrientation,
              icon: <RotateCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            },
            {
              label: '后台任务',
              disabled: webrtc.status !== 'connected',
              onClick: () => webrtc.sendCommand('input keyevent 187'),
              icon: <PanelsTopLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            }
          ].map(action => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              title={action.label}
              aria-label={action.label}
              className="group flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition hover:bg-white/20 disabled:opacity-35 disabled:cursor-not-allowed"
            >
              {action.icon}
            </button>
          ))}
        </div>
      </div>,
      document.body
    )}
    </>
  )
}
