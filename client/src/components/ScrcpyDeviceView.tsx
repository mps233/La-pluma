import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Home, Maximize2, Minimize2, PanelsTopLeft } from 'lucide-react'
import { Button } from './common'
import { useScrcpyWebRTC } from '../hooks/useScrcpyWebRTC'

interface ScrcpyDeviceViewProps {
  enabled: boolean
  deviceId?: string
  signalingUrl?: string
  onStartInfrastructure?: () => Promise<void> | void
  autoConnect?: boolean
  onStatusChange?: (status: string, stats: any, error: string | null) => void
  infrastructureStatus?: {
    installed?: boolean
    built?: boolean
    serverRunning?: boolean
    agentRunning?: boolean
  } | null
  infrastructureLoading?: string | null
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
  deviceId = 'mumu-la-pluma',
  signalingUrl = 'ws://127.0.0.1:8443',
  onStartInfrastructure,
  autoConnect = false,
  onStatusChange,
  infrastructureStatus,
  infrastructureLoading,
  onInstall,
  onToggleServer,
  onToggleAgent
}: ScrcpyDeviceViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const immersiveVideoRef = useRef<HTMLVideoElement | null>(null)
  const immersiveStreamRef = useRef<MediaStream | null>(null)
  const pointerDownRef = useRef(false)
  const autoConnectStartedRef = useRef(false)
  const [quality, setQuality] = useState<QualityPreset>('crisp')
  const [customFps, setCustomFps] = useState<number>(qualityPresets.crisp.fps)
  const [customMaxSize, setCustomMaxSize] = useState<number>(qualityPresets.crisp.maxSize)
  const [customBitrateMbps, setCustomBitrateMbps] = useState<number>(qualityPresets.crisp.bitrateMbps)
  const [immersiveMode, setImmersiveMode] = useState(false)
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

  const applyPreset = (preset: QualityPreset) => {
    const next = qualityPresets[preset]
    setQuality(preset)
    setCustomMaxSize(next.maxSize)
    setCustomBitrateMbps(next.bitrateMbps)
  }

  const connect = useCallback(async () => {
    if (onStartInfrastructure) await onStartInfrastructure()
    webrtc.connect()
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
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_200px] 2xl:grid-cols-[minmax(0,1fr)_220px] gap-4 items-start">
      <div className="space-y-3 min-w-0">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${webrtc.status === 'connected' ? 'bg-emerald-400' : webrtc.status === 'error' ? 'bg-red-400' : 'bg-amber-400'}`} />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">模拟器实时预览</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{statusLabel[webrtc.status] || webrtc.status}</span>
            </div>

          </div>
          <div className="flex flex-wrap gap-2 text-xs justify-end">
            <span className="px-2 py-1 rounded-full bg-cyan-50 dark:bg-white/5 text-gray-700 dark:text-gray-300">
              组件：{infrastructureStatus?.built ? '已安装' : infrastructureStatus?.installed ? '待构建' : '未安装'}
            </span>
            <span className="px-2 py-1 rounded-full bg-cyan-50 dark:bg-white/5 text-gray-700 dark:text-gray-300">
              服务：{infrastructureStatus?.serverRunning ? '运行中' : '已停止'}
            </span>
            <span className="px-2 py-1 rounded-full bg-cyan-50 dark:bg-white/5 text-gray-700 dark:text-gray-300">
              Agent：{infrastructureStatus?.agentRunning ? '运行中' : '已停止'}
            </span>
            {webrtc.error && (
              <span className="px-2 py-1 rounded-full bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-300">{webrtc.error}</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 lg:grid-cols-8 gap-2 text-[11px]">
          {statusCards.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-white/70 dark:bg-black/25 border border-cyan-100 dark:border-white/10 px-2 py-1.5">
              <div className="text-gray-500 dark:text-gray-500">{label}</div>
              <div className="font-medium text-gray-800 dark:text-gray-200 truncate">{value}</div>
            </div>
          ))}
        </div>

        <div className="relative aspect-video rounded-2xl bg-black overflow-hidden flex items-center justify-center shadow-sm">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-contain touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={finishPointer}
            onPointerLeave={finishPointer}
          />
          {webrtc.status !== 'connected' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-center px-6">
              <div>
                <div className="text-sm font-semibold text-white mb-1">
                  {webrtc.status === 'error' ? 'WebRTC 连接失败' : '等待实时画面'}
                </div>
                <div className="text-xs text-gray-300 max-w-md">
                  {webrtc.error || '点击“启动实时预览”后，La-pluma 会自动启动服务、连接 MuMu 并显示实时画面。'}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-center gap-2 bg-transparent px-2 py-1">
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
              className="group flex h-8 w-8 items-center justify-center rounded-full border border-gray-200/60 dark:border-white/10 bg-white/25 dark:bg-white/[0.03] text-gray-500 dark:text-gray-400 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-cyan-400/50 hover:bg-cyan-500/10 hover:text-cyan-500 disabled:opacity-35 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
            >
              {action.icon}
            </button>
          ))}
        </div>
      </div>

      <aside className="space-y-4 xl:pt-0">
        <section className="space-y-3">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">连接与服务</div>
          <div className="space-y-2">
            <Button
              size="sm"
              variant="gradient"
              gradientFrom="cyan"
              gradientTo="blue"
              fullWidth
              onClick={connect}
              disabled={infrastructureLoading !== null || ['connecting', 'signaling', 'waiting_offer', 'connecting_webrtc'].includes(webrtc.status)}
              loading={infrastructureLoading === 'preview'}
            >
              {webrtc.status === 'connected' ? '重连预览' : '启动预览'}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={webrtc.disconnect} disabled={webrtc.status === 'idle' || webrtc.status === 'disconnected'}>断开</Button>
              <Button size="sm" variant="outline" onClick={onInstall} loading={infrastructureLoading === 'install'}>安装组件</Button>
              <Button size="sm" variant="outline" onClick={onToggleServer} loading={infrastructureLoading === 'server'}>{infrastructureStatus?.serverRunning ? '停止服务' : '启动服务'}</Button>
              <Button size="sm" variant="outline" onClick={onToggleAgent} loading={infrastructureLoading === 'agent'} disabled={!infrastructureStatus?.serverRunning}>{infrastructureStatus?.agentRunning ? '停止 Agent' : '连接 Agent'}</Button>
            </div>
          </div>
        </section>

        <section className="space-y-3 pt-3 border-t border-gray-200 dark:border-white/10 text-xs">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">画质设置</div>
          <label className="space-y-1 block">
            <span className="text-gray-500 dark:text-gray-400">画质预设</span>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(qualityPresets).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key as QualityPreset)}
                  className={`rounded-lg border px-2 py-1.5 text-left transition-all ${quality === key
                    ? 'border-cyan-400 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300'
                    : 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/30 text-gray-600 dark:text-gray-300 hover:border-cyan-400/60'
                  }`}
                >
                  <div className="text-xs font-semibold">{preset.label}</div>
                  <div className="mt-0.5 text-[10px] opacity-70">{preset.maxSize}p · {preset.bitrateMbps}Mbps</div>
                </button>
              ))}
            </div>
          </label>
          <label className="space-y-1 block">
            <span className="text-gray-500 dark:text-gray-400">帧率</span>
            <div className="grid grid-cols-2 gap-1.5">
              {fpsOptions.map(fps => (
                <button
                  key={fps}
                  type="button"
                  onClick={() => setCustomFps(fps)}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-all ${customFps === fps
                    ? 'border-cyan-400 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300'
                    : 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/30 text-gray-600 dark:text-gray-300 hover:border-cyan-400/60'
                  }`}
                >
                  {fps}
                </button>
              ))}
            </div>
          </label>
          <label className="space-y-2 block rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-black/20 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-500 dark:text-gray-400">码率</span>
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-600 dark:text-violet-300">{customBitrateMbps} Mbps</span>
            </div>
            <input
              type="range"
              min={2}
              max={32}
              step={1}
              value={customBitrateMbps}
              onChange={(event) => setCustomBitrateMbps(Number(event.target.value))}
              style={{ background: `linear-gradient(to right, #8b5cf6 ${((customBitrateMbps - 2) / (32 - 2)) * 100}%, rgba(148,163,184,0.28) ${((customBitrateMbps - 2) / (32 - 2)) * 100}%)` }}
              className="h-2 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-violet-400 [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(139,92,246,0.18)] [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-violet-400"
            />
          </label>
          <div className="text-[11px] text-gray-500">修改后点“重连”生效。</div>
        </section>
      </aside>
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
