import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, Gauge, Home, LoaderCircle, Maximize2, Minimize2, Package, PanelsTopLeft, Plug, RotateCw, Server, SlidersHorizontal, Smartphone, Unplug } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import { usePreviewSession } from '../hooks/usePreviewSession'
import { usePreviewSnapshot } from '../hooks/usePreviewSnapshot'
import { usePreviewStore } from '../store/previewStore'
import { qualityPresets, fpsOptions, type QualityPreset } from '../constants'
import PreviewModeControls, { PreviewModeSegmented } from './PreviewModeControls'

interface ScrcpyDeviceViewProps {
  enabled: boolean
  automationAvailable?: boolean
  automationUnavailableMessage?: string
  variant?: 'full' | 'compact'
  autoConnect?: boolean
  onStatusChange?: (status: string, stats: any, error: string | null) => void
  infrastructureStatus?: {
    installed?: boolean
    built?: boolean
    serverRunning?: boolean
    agentRunning?: boolean
  } | null
  infrastructureStatusState?: 'loading' | 'ready' | 'error'
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

const deviceNavigationActions = [
  { label: '返回', command: 'input keyevent 4', Icon: ArrowLeft },
  { label: 'Home', command: 'input keyevent 3', Icon: Home },
  { label: '后台任务', command: 'input keyevent 187', Icon: PanelsTopLeft },
] as const

function DeviceNavigationButtons({
  connected,
  automationAvailable,
  automationUnavailableMessage,
  immersive = false,
  compact = false,
  onCommand,
}: {
  connected: boolean
  automationAvailable: boolean
  automationUnavailableMessage: string
  immersive?: boolean
  compact?: boolean
  onCommand: (command: string) => void
}) {
  return deviceNavigationActions.map(({ label, command, Icon }) => (
    <button
      key={label}
      type="button"
      onClick={() => onCommand(command)}
      disabled={!connected || !automationAvailable}
      title={!automationAvailable ? automationUnavailableMessage : label}
      aria-label={label}
      className={immersive
        ? 'group flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-xs transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-35'
        : `control-surface flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-35 ${compact ? 'automation-preview-glass-button' : ''}`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
    </button>
  ))
}

interface TrackedPointer {
  clientX: number
  clientY: number
  target: HTMLVideoElement
}

function formatStatistic(value: number | null | undefined, unit: string) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '--'
  return `${value} ${unit}`
}

export default function ScrcpyDeviceView({
  automationAvailable = true,
  automationUnavailableMessage = '后端服务暂不可用，请稍后重试',
  variant = 'full',
  onStatusChange,
  infrastructureStatus,
  infrastructureStatusState,
  infrastructureLoading,
  infrastructureError,
  onInstall,
  onToggleServer,
  onToggleAgent
}: ScrcpyDeviceViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const immersiveVideoRef = useRef<HTMLVideoElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const immersiveHistoryEntryRef = useRef(false)
  const trackedPointersRef = useRef(new Map<number, TrackedPointer>())
  const pendingPointerMovesRef = useRef(new Map<number, TrackedPointer>())
  const pointerMoveFrameRef = useRef<number | null>(null)
  const quality = usePreviewStore(state => state.quality)
  const customFps = usePreviewStore(state => state.fps)
  const customMaxSize = usePreviewStore(state => state.maxSize)
  const customBitrateMbps = usePreviewStore(state => state.bitrateMbps)
  const setQuality = usePreviewStore(state => state.setQuality)
  const setCustomFps = usePreviewStore(state => state.setCustomFps)
  const setCustomMaxSize = usePreviewStore(state => state.setCustomMaxSize)
  const setCustomBitrateMbps = usePreviewStore(state => state.setCustomBitrateMbps)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [immersiveMode, setImmersiveMode] = useState(false)
  const [immersiveVideoMounted, setImmersiveVideoMounted] = useState(false)
  const [compactControlsOpen, setCompactControlsOpen] = useState(false)
  const compactControlsId = `scrcpy-controls-${useId().replace(/:/g, '')}`
  const bitrateProgress = ((customBitrateMbps - 1) / (32 - 1)) * 100
  const webrtc = usePreviewSession({
    videoRef,
  })
  const snapshot = usePreviewSnapshot(automationAvailable)
  const sendTouchRef = useRef(webrtc.sendTouch)
  useEffect(() => {
    sendTouchRef.current = webrtc.sendTouch
  }, [webrtc.sendTouch])
  const isCompact = variant === 'compact'
  const isConnecting = webrtc.isConnecting
  const previewBusy = infrastructureLoading === 'preview' || isConnecting
  const canDisconnect = webrtc.mode !== 'off' || previewBusy || !['idle', 'disconnected'].includes(webrtc.status)
  const resolvedInfrastructureState = infrastructureStatusState || (infrastructureStatus ? 'ready' : 'loading')
  const infrastructureKnown = infrastructureStatus !== null && infrastructureStatus !== undefined
  const infrastructureBusy = infrastructureLoading !== null && infrastructureLoading !== undefined
  const visibleError = (webrtc.mode === 'live' ? webrtc.error : snapshot.error) || infrastructureError
  const previewStatusLabel = webrtc.mode === 'off' ? '预览已关闭' : webrtc.paused ? '后台已暂停' : webrtc.mode === 'snapshot' ? '画面快照 · 10s' : webrtc.starting ? '正在启动' : statusLabel[webrtc.status] || webrtc.status
  const statusDotClass = visibleError
    ? 'bg-red-400'
    : webrtc.status === 'connected'
    ? 'bg-emerald-400'
    : isConnecting
        ? 'bg-amber-400'
        : 'bg-gray-400'

  const applyPreset = (preset: QualityPreset) => {
    setQuality(preset)
    setSettingsDirty(true)
  }

  const connectFromControl = () => {
    if (!automationAvailable) return
    webrtc.connect()
    setSettingsDirty(false)
  }

  const runInfrastructureAction = (
    action: (() => Promise<void> | void) | undefined,
    allowWhenUnavailable = false
  ) => {
    if (!action || (!automationAvailable && !allowWhenUnavailable)) return
    void action()
  }

  const sendDeviceCommand = (command: string) => {
    if (!automationAvailable) return
    webrtc.sendCommand(command)
  }

  useEffect(() => {
    onStatusChange?.(webrtc.status, webrtc.stats, webrtc.error)
  }, [onStatusChange, webrtc.error, webrtc.stats, webrtc.status])

  const flushPointerMoves = useCallback(() => {
    pointerMoveFrameRef.current = null
    const pendingMoves = Array.from(pendingPointerMovesRef.current.entries())
    pendingPointerMovesRef.current.clear()
    pendingMoves.forEach(([pointerId, pointer]) => {
      if (!trackedPointersRef.current.has(pointerId)) return
      sendTouchRef.current(2, pointer.clientX, pointer.clientY, pointerId, pointer.target)
    })
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLVideoElement>) => {
    if (!automationAvailable || !webrtc.inputReady) return
    const pointer = { clientX: event.clientX, clientY: event.clientY, target: event.currentTarget }
    if (!webrtc.sendTouch(0, pointer.clientX, pointer.clientY, event.pointerId, pointer.target)) return

    trackedPointersRef.current.set(event.pointerId, pointer)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // The pointer may already have ended between the down event and capture.
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLVideoElement>) => {
    if (!automationAvailable || !trackedPointersRef.current.has(event.pointerId)) return
    const pointer = { clientX: event.clientX, clientY: event.clientY, target: event.currentTarget }
    trackedPointersRef.current.set(event.pointerId, pointer)
    pendingPointerMovesRef.current.set(event.pointerId, pointer)
    if (pointerMoveFrameRef.current === null) {
      pointerMoveFrameRef.current = window.requestAnimationFrame(flushPointerMoves)
    }
  }

  const finishPointer = (event: React.PointerEvent<HTMLVideoElement>, cancelled = false) => {
    const trackedPointer = trackedPointersRef.current.get(event.pointerId)
    if (!trackedPointer) return

    pendingPointerMovesRef.current.delete(event.pointerId)
    trackedPointersRef.current.delete(event.pointerId)
    webrtc.sendTouch(
      cancelled ? 3 : 1,
      cancelled ? trackedPointer.clientX : event.clientX,
      cancelled ? trackedPointer.clientY : event.clientY,
      event.pointerId,
      trackedPointer.target
    )
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Losing capture is already equivalent to finishing this local gesture.
    }
  }

  const onLostPointerCapture = (event: React.PointerEvent<HTMLVideoElement>) => {
    const trackedPointer = trackedPointersRef.current.get(event.pointerId)
    if (!trackedPointer) return
    pendingPointerMovesRef.current.delete(event.pointerId)
    trackedPointersRef.current.delete(event.pointerId)
    webrtc.sendTouch(3, trackedPointer.clientX, trackedPointer.clientY, event.pointerId, trackedPointer.target)
  }

  useEffect(() => () => {
    if (pointerMoveFrameRef.current !== null) window.cancelAnimationFrame(pointerMoveFrameRef.current)
    pointerMoveFrameRef.current = null
    pendingPointerMovesRef.current.clear()
    trackedPointersRef.current.forEach((pointer, pointerId) => {
      sendTouchRef.current(3, pointer.clientX, pointer.clientY, pointerId, pointer.target)
    })
    trackedPointersRef.current.clear()
  }, [])

  const fullscreen = () => {
    // 不走浏览器真实 fullscreen，直接打开应用内“画面全屏”对话框，手机上更可靠。
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!immersiveHistoryEntryRef.current) {
      const currentState = window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {}
      window.history.pushState({ ...currentState, scrcpyImmersive: true }, '')
      immersiveHistoryEntryRef.current = true
    }
    setImmersiveMode(true)
  }
  const exitImmersive = useCallback(() => {
    setImmersiveMode(false)
    if (immersiveHistoryEntryRef.current) {
      immersiveHistoryEntryRef.current = false
      window.history.back()
    }
  }, [])

  useEffect(() => {
    if (!immersiveMode) return
    const handlePopState = () => {
      immersiveHistoryEntryRef.current = false
      setImmersiveMode(false)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [immersiveMode])

  useEffect(() => {
    if (!immersiveMode || !immersiveVideoMounted) return

    const mainVideo = videoRef.current
    const overlayVideo = immersiveVideoRef.current
    if (!mainVideo || !overlayVideo) return

    const sourceStream = webrtc.mediaStream || mainVideo.srcObject as MediaStream | null
    if (sourceStream) {
      overlayVideo.srcObject = sourceStream
      void overlayVideo.play().catch(() => {})
    }
    const pendingPointerMoves = pendingPointerMovesRef.current
    const trackedPointers = trackedPointersRef.current

    return () => {
      pendingPointerMoves.forEach((pointer, pointerId) => {
        if (pointer.target === overlayVideo) pendingPointerMoves.delete(pointerId)
      })
      trackedPointers.forEach((pointer, pointerId) => {
        if (pointer.target !== overlayVideo) return
        trackedPointers.delete(pointerId)
        sendTouchRef.current(3, pointer.clientX, pointer.clientY, pointerId, overlayVideo)
        try {
          if (overlayVideo.hasPointerCapture(pointerId)) overlayVideo.releasePointerCapture(pointerId)
        } catch {
          // The overlay may already be detached and have lost capture.
        }
      })
      if (pendingPointerMoves.size === 0 && pointerMoveFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerMoveFrameRef.current)
        pointerMoveFrameRef.current = null
      }
      overlayVideo.srcObject = null
    }
  }, [immersiveMode, immersiveVideoMounted, webrtc.mediaStream])

  const attachImmersiveVideo = useCallback((node: HTMLVideoElement | null) => {
    immersiveVideoRef.current = node
    setImmersiveVideoMounted(node !== null)
  }, [])

  const statusCards: [string, string | number, string?][] = [
    ['信令', statusLabel[webrtc.status] || webrtc.status],
    ['ICE', webrtc.stats?.iceState || '--'],
    ['视频', webrtc.stats?.videoLive ? 'live' : '--'],
    ['分辨率', webrtc.stats?.width ? `${webrtc.stats.width}×${webrtc.stats.height}` : '--'],
    ['FPS', webrtc.stats?.fps ?? '--'],
    ['码率', formatStatistic(webrtc.stats?.bitrate, 'kbps')],
    ['网络 RTT', formatStatistic(webrtc.stats?.rtt, 'ms'), 'ICE 网络往返时间，不含设备输入处理与画面反馈时间'],
    ['触控', webrtc.inputReady ? 'ready' : webrtc.status === 'connected' ? '等待触控信息' : '--']
  ]
  const unavailableInfrastructureLabel = resolvedInfrastructureState === 'loading' ? '检查中' : '未知'
  const componentStatusLabel = infrastructureKnown
    ? infrastructureStatus.built ? '已安装' : infrastructureStatus.installed ? '待构建' : '未安装'
    : unavailableInfrastructureLabel
  const serverStatusLabel = infrastructureKnown
    ? infrastructureStatus.serverRunning ? '运行中' : '已停止'
    : unavailableInfrastructureLabel
  const agentStatusLabel = infrastructureKnown
    ? infrastructureStatus.agentRunning ? '运行中' : '已停止'
    : unavailableInfrastructureLabel

  return (
    <>
    <div className={`scrcpy-device-layout ${isCompact ? 'is-compact' : ''}`}>
      <div className="space-y-3 min-w-0">
        <div className={`scrcpy-view-header flex items-center justify-between gap-3.5 ${isCompact ? 'is-compact' : 'flex-wrap'}`}>
          <div className="min-w-0">
            <div className="scrcpy-view-title-row flex items-center gap-2">
              <span
                className={`scrcpy-view-status-dot h-2 w-2 rounded-full ${statusDotClass}`}
                role="img"
                aria-label={previewStatusLabel}
                title={previewStatusLabel}
              />
              <span className="scrcpy-view-title text-sm font-semibold text-gray-900 dark:text-white!">设备画面</span>
              {!isCompact && (
                <span className="scrcpy-view-status text-xs text-gray-500 dark:text-gray-400" role="status" aria-live="polite">
                  {previewStatusLabel}
                </span>
              )}
            </div>
          </div>
          {isCompact ? (
            <PreviewModeSegmented unavailable={!automationAvailable} />
          ) : (
            <div className="flex flex-wrap gap-2 text-xs justify-end">
              <span className="surface-soft rounded-full px-2 py-1 text-muted-foreground">
                组件：{componentStatusLabel}
              </span>
              <span className="surface-soft rounded-full px-2 py-1 text-muted-foreground">
                服务：{serverStatusLabel}
              </span>
              <span className="surface-soft rounded-full px-2 py-1 text-muted-foreground">
                Agent：{agentStatusLabel}
              </span>
              {visibleError && (
                <span className="px-2 py-1 rounded-full bg-red-100 dark:bg-red-500/10 dark:text-red-300 text-red-600">{visibleError}</span>
              )}
            </div>
          )}
        </div>

        {!isCompact && <PreviewModeControls unavailable={!automationAvailable} />}

        {!isCompact && <div className="scrcpy-status-grid">
          {statusCards.map(([label, value, description]) => (
            <div key={label} title={description} className="surface-soft rounded-lg px-2 py-1.5">
              <div className="text-tertiary">{label}</div>
              <div className="truncate font-medium text-foreground">{value}</div>
            </div>
          ))}
        </div>}

        <div
          className={`scrcpy-video-frame status-border-beam relative aspect-video overflow-hidden flex items-center justify-center shadow-xs ${
            previewBusy ? 'is-active ' : ''
          }${
            webrtc.status === 'connected'
              ? 'is-connected bg-black'
              : 'is-empty ring-1 ring-inset ring-border'
          }`}
          aria-busy={previewBusy}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label="模拟器实时画面"
            aria-disabled={!webrtc.inputReady}
            className="w-full h-full object-contain touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => finishPointer(event)}
            onPointerCancel={(event) => finishPointer(event, true)}
            onLostPointerCapture={onLostPointerCapture}
          />
          {snapshot.image && <img src={snapshot.image} alt="模拟器画面快照" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />}
          {webrtc.status === 'connected' && !webrtc.inputReady && (
            <div
              className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-2.5 py-1.5 text-xs text-white/90"
              role="status"
              aria-live="polite"
            >
              触控连接中，画面暂不可操作
            </div>
          )}
          {webrtc.status !== 'connected' && !snapshot.image && (
            <div
              className="scrcpy-empty-state absolute inset-0 flex items-center justify-center px-6 text-center"
              role={visibleError ? 'alert' : 'status'}
              aria-live="polite"
            >
              <div className="scrcpy-empty-content w-full max-w-sm">
                <div className="device-preview-empty-icon mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg">
                  <Smartphone className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
                </div>
                <div className="scrcpy-empty-title mb-1 text-sm font-semibold text-foreground">
                  {webrtc.mode === 'off' ? '预览已关闭' : visibleError ? '预览启动失败' : previewBusy ? '正在连接实时画面' : webrtc.mode === 'snapshot' ? '正在获取快照' : '等待实时画面'}
                </div>
                {(visibleError || !automationAvailable) && (
                  <div className="scrcpy-empty-description mx-auto max-w-md text-xs leading-5 text-muted-foreground">
                    {visibleError || automationUnavailableMessage}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="scrcpy-preview-toolbar flex items-center justify-center gap-2 bg-transparent px-2 py-1" role="toolbar" aria-label="模拟器导航">
          <DeviceNavigationButtons
            connected={webrtc.status === 'connected'}
            automationAvailable={automationAvailable}
            automationUnavailableMessage={automationUnavailableMessage}
            compact={isCompact}
            onCommand={sendDeviceCommand}
          />
          <button
            type="button"
            onClick={fullscreen}
            disabled={webrtc.status !== 'connected'}
            title="全屏"
            aria-label="全屏"
            className={`control-surface flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-35 ${isCompact ? 'automation-preview-glass-button' : ''}`}
          >
            <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          {isCompact && (
            <button
              type="button"
              onClick={() => setCompactControlsOpen(open => !open)}
              title={compactControlsOpen ? '收起预览设置' : '预览设置'}
              aria-label={compactControlsOpen ? '收起预览设置' : '打开预览设置'}
              aria-expanded={compactControlsOpen}
              aria-controls={compactControlsId}
              className={`automation-preview-glass-button control-surface flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-full text-muted-foreground${compactControlsOpen ? ' is-active' : ''}`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
        </div>

      </div>

      {(!isCompact || compactControlsOpen) && <aside id={compactControlsId} className={`scrcpy-control-rail surface-soft${isCompact ? ' is-compact' : ''}`}>
        <section className="scrcpy-control-section">
          <div className="scrcpy-control-header">
            <div className="scrcpy-control-title">
              <Plug className="h-4 w-4" strokeWidth={1.8} />
              <span>连接与服务</span>
            </div>
            <span className="scrcpy-inline-status" role="status" aria-live="polite">
              <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`} />
              {previewStatusLabel}
            </span>
          </div>

          <p className="text-xs leading-5 text-muted-foreground">停止服务或 Agent 会断开其他观看者。</p>

          {webrtc.status === 'connected' && (
            <Button
              size="sm"
              variant="secondary"
              className="scrcpy-preview-action w-full"
              onClick={connectFromControl}
              disabled={!automationAvailable || infrastructureBusy}
              title={!automationAvailable ? automationUnavailableMessage : undefined}
              aria-busy={infrastructureLoading === 'preview' || undefined}
            >
              {infrastructureLoading === 'preview'
                ? <><LoaderCircle className="animate-spin" aria-hidden="true" />加载中...</>
                : (
                  <>
                    <RotateCw className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                    重连预览
                  </>
                )}
            </Button>
          )}

          <div className="scrcpy-service-grid">
            {[
              { label: infrastructureStatus?.serverRunning ? '停止服务' : '启动服务', icon: Server, onClick: onToggleServer, disabled: !infrastructureKnown || infrastructureBusy || (!infrastructureStatus?.serverRunning && !automationAvailable), allowWhenUnavailable: !!infrastructureStatus?.serverRunning, loading: infrastructureLoading === 'server' },
              { label: infrastructureStatus?.agentRunning ? '停止 Agent' : '连接 Agent', icon: Smartphone, onClick: onToggleAgent, disabled: !infrastructureKnown || infrastructureBusy || (infrastructureStatus?.agentRunning ? false : !infrastructureStatus?.serverRunning || !automationAvailable), allowWhenUnavailable: !!infrastructureStatus?.agentRunning, loading: infrastructureLoading === 'agent' }
            ].map(action => {
              const Icon = action.icon
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => runInfrastructureAction(action.onClick, action.allowWhenUnavailable)}
                  disabled={action.disabled}
                  title={action.disabled && !automationAvailable ? automationUnavailableMessage : action.label}
                  className="scrcpy-service-action control-surface min-h-11"
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
              disabled={!canDisconnect}
              className="scrcpy-utility-action min-h-11"
            >
              <Unplug className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span>{previewBusy ? '取消启动' : '断开'}</span>
            </button>
            <button
              type="button"
              onClick={() => runInfrastructureAction(onInstall)}
              disabled={!automationAvailable || infrastructureBusy || !infrastructureKnown}
              title={!automationAvailable ? automationUnavailableMessage : undefined}
              className="scrcpy-utility-action min-h-11"
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
            <span className="scrcpy-quality-current">{quality === 'custom' ? '自定义 · ' : ''}最长边 {customMaxSize}px · {customFps} FPS</span>
          </div>

          <div className="scrcpy-quality-content">
            <div className="scrcpy-quality-body">
              <div className="scrcpy-setting-group">
                <div className="scrcpy-setting-label">画质预设</div>
                <div className="scrcpy-preset-grid" role="group" aria-label="画质预设">
                  {Object.entries(qualityPresets).map(([key, preset]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applyPreset(key as QualityPreset)}
                      aria-pressed={quality === key}
                      aria-label={`${preset.label}画质`}
                      title={`最长边 ${preset.maxSize}px · ${preset.fps} FPS · 码率 ${preset.bitrateMbps} Mbps`}
                      className={`scrcpy-preset-option ${quality === key ? 'is-active' : ''}`}
                    >
                      <span>{preset.label}</span>
                      <small>{preset.maxSize}px · {preset.fps} FPS · {preset.bitrateMbps}M</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="scrcpy-setting-group">
                <div className="scrcpy-setting-label">帧率</div>
                <div className="scrcpy-fps-segment" role="group" aria-label="视频帧率">
                  {fpsOptions.map(fps => (
                    <button
                      key={fps}
                      type="button"
                      onClick={() => {
                        setCustomFps(fps)
                        setQuality('custom')
                        setSettingsDirty(true)
                      }}
                      aria-pressed={customFps === fps}
                      aria-label={`${fps} FPS`}
                      className={`${customFps === fps ? 'is-active ' : ''}min-h-11!`}
                    >
                      {fps}
                    </button>
                  ))}
                </div>
              </div>

              <label className="scrcpy-setting-group text-xs text-muted-foreground">
                最长边
                <select aria-label="视频最长边" value={customMaxSize} className="control-surface min-h-11 rounded-md px-3 text-foreground" onChange={event => {
                  setCustomMaxSize(Number(event.target.value))
                  setSettingsDirty(true)
                }}>
                  {[640, 960, 1280, 1600, 1920].map(size => <option key={size} value={size}>{size}px</option>)}
                </select>
              </label>

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
                  className="scrcpy-bitrate-slider min-h-11"
                  style={{ '--scrcpy-range-progress': `${bitrateProgress}%` } as CSSProperties}
                >
                  <div className="scrcpy-bitrate-track" aria-hidden="true">
                    <span className="scrcpy-bitrate-fill" />
                    <span className="scrcpy-bitrate-handle" />
                  </div>
                  <input
                    id="scrcpy-bitrate"
                    type="range"
                    min={1}
                    max={32}
                    step={0.5}
                    value={customBitrateMbps}
                    aria-label="视频码率"
                    onChange={(event) => {
                      setCustomBitrateMbps(Number(event.target.value))
                      setQuality('custom')
                      setSettingsDirty(true)
                    }}
                  />
                </div>
              </div>
              <p className={`text-xs leading-5 ${settingsDirty ? 'text-primary' : 'text-muted-foreground'}`} role="status">
                {settingsDirty ? '画质已修改，重连预览后生效' : '画质调整会在下次连接时生效'}
              </p>
            </div>
          </div>
        </section>
      </aside>}
    </div>
    <Dialog open={immersiveMode} onOpenChange={open => { if (!open) exitImmersive() }}>
      <DialogContent
        data-scrcpy-immersive-layer="true"
        aria-modal="true"
        showCloseButton={false}
        finalFocus={previousFocusRef}
        className="fixed top-0 right-0 bottom-0 left-0 z-9999 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-2 rounded-none bg-black p-0 text-white outline-hidden landscape:flex-row sm:max-w-none"
        style={{
          animation: 'none',
          paddingTop: 'max(0.5rem, env(safe-area-inset-top))',
          paddingRight: 'max(0.5rem, env(safe-area-inset-right))',
          paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(0.5rem, env(safe-area-inset-left))'
        }}
      >
        <DialogTitle className="sr-only">模拟器沉浸预览</DialogTitle>
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch">
          <video
            ref={attachImmersiveVideo}
            autoPlay
            playsInline
            muted
            aria-label="模拟器沉浸画面"
            aria-disabled={!webrtc.inputReady}
            className="h-full w-full object-contain touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => finishPointer(event)}
            onPointerCancel={(event) => finishPointer(event, true)}
            onLostPointerCapture={onLostPointerCapture}
          />
          {!webrtc.inputReady && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-2.5 py-1.5 text-xs text-white/90" role="status">
              触控连接中，画面暂不可操作
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-center gap-2 landscape:flex-col" role="toolbar" aria-label="沉浸预览控制">
          <DeviceNavigationButtons
            connected={webrtc.status === 'connected'}
            automationAvailable={automationAvailable}
            automationUnavailableMessage={automationUnavailableMessage}
            immersive
            onCommand={sendDeviceCommand}
          />
          <button
            type="button"
            onClick={exitImmersive}
            title="退出全屏"
            aria-label="退出全屏"
            className="group flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-xs transition hover:bg-white/20 disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
