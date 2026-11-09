import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Clipboard, ClipboardPaste, Gauge, Home, Maximize2, Minimize2, Package, PanelsTopLeft, Plug, RotateCw, Server, SlidersHorizontal, Smartphone, Unplug } from 'lucide-react'
import { maaApi } from '../services/api'
import { Button, IconButton, TruncatedText } from './common'
import { keepNumberWithUnit } from '../utils/typography'
import { previewQualityPresets, usePreviewStore, type PreviewQuality } from '../stores'
import { usePreviewConnection } from '../contexts/previewSession'

interface ScrcpyDeviceViewProps {
  enabled: boolean
  automationAvailable?: boolean
  automationUnavailableMessage?: string
  variant?: 'full' | 'compact'
  deviceId?: string
  signalingUrl?: string
  onStartInfrastructure?: () => Promise<string | undefined> | string | undefined
  onCancelInfrastructure?: () => void
  autoConnect?: boolean
  infrastructureStatus?: {
    installed?: boolean
    built?: boolean
    serverRunning?: boolean
    agentRunning?: boolean
    serverVersion?: string | null
    agentVersion?: string | null
    agentVersionStatus?: 'ok' | 'outdated' | 'unknown'
    minimumAgentVersion?: string
    screenState?: string | null
    usingDefaultPassword?: boolean
  } | null
  infrastructureStatusState?: 'loading' | 'ready' | 'error'
  infrastructureLoading?: string | null
  infrastructureError?: string | null
  onInstall?: () => Promise<void> | void
  onToggleServer?: () => Promise<void> | void
  onToggleAgent?: () => Promise<void> | void
  onRedeployAgent?: () => Promise<void> | void
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

const qualityPresets = previewQualityPresets

const fpsOptions = [30, 60, 90, 120] as const

type QualityPreset = keyof typeof qualityPresets
type QualitySelection = PreviewQuality

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
  onCommand,
}: {
  connected: boolean
  automationAvailable: boolean
  automationUnavailableMessage: string
  immersive?: boolean
  onCommand: (command: string) => void
}) {
  return deviceNavigationActions.map(({ label, command, Icon }) => (
    <IconButton
      key={label}
      icon={<Icon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
      variant={immersive ? 'ghost' : 'secondary'}
      size="md"
      onClick={() => onCommand(command)}
      disabled={!connected || !automationAvailable}
      aria-label={label}
      title={immersive ? label : undefined}
      tooltip={immersive ? undefined : (!automationAvailable ? automationUnavailableMessage : label)}
      tooltipSide="top"
      className={immersive ? 'scrcpy-immersive-control' : 'scrcpy-preview-control'}
    />
  ))
}

interface TrackedPointer {
  clientX: number
  clientY: number
  target: HTMLVideoElement
}

export default function ScrcpyDeviceView({
  enabled,
  automationAvailable = true,
  automationUnavailableMessage = '后端服务暂不可用，请稍后重试',
  variant = 'full',
  deviceId = 'mumu-la-pluma',
  signalingUrl = '/webrtc-signaling',
  onStartInfrastructure,
  onCancelInfrastructure,
  autoConnect = false,
  infrastructureStatus,
  infrastructureStatusState,
  infrastructureLoading,
  infrastructureError,
  onInstall,
  onToggleServer,
  onToggleAgent,
  onRedeployAgent
}: ScrcpyDeviceViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const immersiveVideoRef = useRef<HTMLVideoElement | null>(null)
  const immersiveDialogRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const immersiveBackgroundStateRef = useRef(new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>())
  const immersiveHistoryEntryRef = useRef(false)
  const trackedPointersRef = useRef(new Map<number, TrackedPointer>())
  const pendingPointerMovesRef = useRef(new Map<number, TrackedPointer>())
  const pointerMoveFrameRef = useRef<number | null>(null)
  const lastPreviewGeometryRef = useRef({ width: 0, height: 0, status: 'idle' })
  const autoConnectStartedRef = useRef(false)
  const connectRequestGenerationRef = useRef(0)
  const quality = usePreviewStore(state => state.quality) as QualitySelection
  const customFps = usePreviewStore(state => state.fps)
  const customMaxSize = usePreviewStore(state => state.maxSize)
  const customBitrateMbps = usePreviewStore(state => state.bitrateMbps)
  const setQuality = usePreviewStore(state => state.setQuality)
  const setCustomFps = usePreviewStore(state => state.setCustomFps)
  const setCustomMaxSize = usePreviewStore(state => state.setCustomMaxSize)
  const setCustomBitrateMbps = usePreviewStore(state => state.setCustomBitrateMbps)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [commandError, setCommandError] = useState<string | null>(null)
  const commandErrorTimerRef = useRef<number | null>(null)
  const [immersiveMode, setImmersiveMode] = useState(false)
  const [compactControlsOpen, setCompactControlsOpen] = useState(false)
  const compactControlsId = `scrcpy-controls-${useId().replace(/:/g, '')}`
  const bitrateProgress = ((customBitrateMbps - 2) / (32 - 2)) * 100
  const selectedPreset = quality === 'custom' ? null : qualityPresets[quality]
  const scrcpyOptions = useMemo(() => ({
    max_fps: customFps,
    max_size: customMaxSize,
    bitrate: customBitrateMbps * 1000000,
    min_bitrate: Math.max(1000000, Math.round(customBitrateMbps * 0.35 * 1000000)),
    max_bitrate: Math.max(customBitrateMbps, selectedPreset?.maxBitrateMbps ?? customBitrateMbps) * 1000000,
    bwe: true,
    audio: false,
    snapshot_interval: 10,
    stay_awake: true
  }), [customBitrateMbps, customFps, customMaxSize, selectedPreset?.maxBitrateMbps])
  const webrtc = usePreviewConnection(videoRef, {
    deviceId,
    signalingUrl,
    connectionPath: 'auto',
    ipPreference: 'ipv4',
    scrcpyOptions
  })
  const connectWebrtc = webrtc.connect
  const sendTouchRef = useRef(webrtc.sendTouch)
  useEffect(() => {
    sendTouchRef.current = webrtc.sendTouch
  }, [webrtc.sendTouch])

  useEffect(() => {
    const width = webrtc.stats?.width ?? 0
    const height = webrtc.stats?.height ?? 0
    const previous = lastPreviewGeometryRef.current
    const geometryChanged = previous.width > 0 && previous.height > 0
      && width > 0 && height > 0
      && (previous.width !== width || previous.height !== height)
    const connectionEnded = previous.status === 'connected' && webrtc.status !== 'connected'
    lastPreviewGeometryRef.current = { width, height, status: webrtc.status }
    if (!geometryChanged && !connectionEnded) return
    // 旋转、重连或画面尺寸变化后，旧手势的坐标不再对应新画面，先发送取消。
    if (pointerMoveFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerMoveFrameRef.current)
      pointerMoveFrameRef.current = null
    }
    pendingPointerMovesRef.current.clear()
    trackedPointersRef.current.forEach((pointer, pointerId) => {
      sendTouchRef.current(3, pointer.clientX, pointer.clientY, pointerId, pointer.target)
    })
    trackedPointersRef.current.clear()
  }, [webrtc.stats?.height, webrtc.stats?.width, webrtc.status])
  const isCompact = variant === 'compact'
  const connectingStatuses = ['connecting', 'signaling', 'waiting_offer', 'connecting_webrtc']
  const isConnecting = connectingStatuses.includes(webrtc.status)
  const previewBusy = infrastructureLoading === 'preview' || isConnecting
  const canDisconnect = !['idle', 'disconnected'].includes(webrtc.status)
  const resolvedInfrastructureState = infrastructureStatusState || (infrastructureStatus ? 'ready' : 'loading')
  const infrastructureKnown = infrastructureStatus !== null && infrastructureStatus !== undefined
  const infrastructureBusy = infrastructureLoading !== null && infrastructureLoading !== undefined
  const needsInstall = infrastructureKnown && (!infrastructureStatus.installed || !infrastructureStatus.built)
  const visibleError = webrtc.error || infrastructureError
  const minimumAgentVersion = infrastructureStatus?.minimumAgentVersion || '0.4.3'
  const agentVersionOutdated = infrastructureStatus?.agentVersionStatus === 'outdated'
  const statusDotClass = visibleError
    ? 'bg-[var(--app-danger)]'
    : webrtc.status === 'connected'
    ? 'bg-[var(--app-success)]'
    : isConnecting
        ? 'bg-[var(--app-warning)]'
        : 'bg-[var(--app-text-soft)]'

  const applyPreset = (preset: QualityPreset) => {
    const next = qualityPresets[preset]
    setQuality(preset)
    setCustomFps(next.fps)
    setCustomMaxSize(next.maxSize)
    setCustomBitrateMbps(next.bitrateMbps)
    setSettingsDirty(true)
  }

  const connect = useCallback(async () => {
    if (!automationAvailable) return false
    const requestGeneration = ++connectRequestGenerationRef.current
    try {
      const freshSignalingUrl = await onStartInfrastructure?.()
      if (requestGeneration !== connectRequestGenerationRef.current) return false
      if (onStartInfrastructure && !freshSignalingUrl) return false
      connectWebrtc(freshSignalingUrl)
      return true
    } catch {
      // 基础设施错误由 ScreenMonitor 显示，连接流程到此停止。
      return false
    }
  }, [automationAvailable, connectWebrtc, onStartInfrastructure])

  const connectFromControl = async () => {
    if (await connect()) setSettingsDirty(false)
  }

  const runInfrastructureAction = (
    action: (() => Promise<void> | void) | undefined,
    allowWhenUnavailable = false
  ) => {
    if (!action || (!automationAvailable && !allowWhenUnavailable)) return
    void action()
  }

  const showCommandError = (message: string) => {
    if (commandErrorTimerRef.current !== null) {
      window.clearTimeout(commandErrorTimerRef.current)
      commandErrorTimerRef.current = null
    }
    setCommandError(message)
    commandErrorTimerRef.current = window.setTimeout(() => {
      commandErrorTimerRef.current = null
      setCommandError(null)
    }, 4000)
  }

  const sendDeviceCommand = (command: string) => {
    if (!automationAvailable) return
    void webrtc.sendCommand(command).then(result => {
      if (result.success) {
        setCommandError(null)
        return
      }
      showCommandError(result.error || '命令执行失败')
    })
  }

  const copyDeviceClipboard = () => {
    if (!automationAvailable || webrtc.status !== 'connected') return
    void maaApi.getClipboard().then(async result => {
      if (!result.success) {
        showCommandError(maaApi.getErrorMessage(result))
        return
      }
      const text = result.data?.text ?? ''
      if (!text) {
        showCommandError('设备剪贴板为空')
        return
      }
      try {
        await navigator.clipboard.writeText(text)
        setCommandError(null)
      } catch {
        showCommandError('无法写入本机剪贴板')
      }
    }).catch(() => showCommandError('读取设备剪贴板失败'))
  }

  const pasteLocalClipboard = () => {
    if (!automationAvailable || webrtc.status !== 'connected') return
    void navigator.clipboard.readText().then(async text => {
      if (!text) {
        showCommandError('本机剪贴板为空')
        return
      }
      const result = await maaApi.setClipboard(text, true)
      if (!result.success) {
        showCommandError(maaApi.getErrorMessage(result))
        return
      }
      setCommandError(null)
    }).catch(() => showCommandError('无法读取本机剪贴板'))
  }

  useEffect(() => {
    if (!autoConnect) {
      autoConnectStartedRef.current = false
      return
    }
    if (!enabled || !automationAvailable || autoConnectStartedRef.current) return
    autoConnectStartedRef.current = true
    void connect().then(started => {
      if (started) setSettingsDirty(false)
      else autoConnectStartedRef.current = false
    })
    return () => {
      autoConnectStartedRef.current = false
    }
  }, [autoConnect, automationAvailable, connect, enabled])

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

  const onWheel = (event: React.WheelEvent<HTMLVideoElement>) => {
    if (!automationAvailable || !webrtc.inputReady) return
    if (webrtc.sendScroll(event.deltaX, event.deltaY, event.clientX, event.clientY, event.currentTarget)) {
      event.preventDefault()
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
    connectRequestGenerationRef.current += 1
    if (pointerMoveFrameRef.current !== null) window.cancelAnimationFrame(pointerMoveFrameRef.current)
    pointerMoveFrameRef.current = null
    if (commandErrorTimerRef.current !== null) {
      window.clearTimeout(commandErrorTimerRef.current)
      commandErrorTimerRef.current = null
    }
    pendingPointerMovesRef.current.clear()
    trackedPointersRef.current.forEach((pointer, pointerId) => {
      sendTouchRef.current(3, pointer.clientX, pointer.clientY, pointerId, pointer.target)
    })
    trackedPointersRef.current.clear()
  }, [])

  const fullscreen = () => {
    // 不走浏览器真实 fullscreen，直接打开应用内“画面全屏”遮罩，手机上更可靠。
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

  useLayoutEffect(() => {
    if (!immersiveMode) return
    const dialog = immersiveDialogRef.current
    const previousOverflow = document.body.style.overflow
    const previousOverscrollBehavior = document.body.style.overscrollBehavior
    const backgroundStates = immersiveBackgroundStateRef.current
    dialog?.focus({ preventScroll: true })
    backgroundStates.clear()
    Array.from(document.body.children).forEach(child => {
      if (!(child instanceof HTMLElement) || child === dialog) return
      backgroundStates.set(child, {
        inert: child.inert,
        ariaHidden: child.getAttribute('aria-hidden')
      })
      child.inert = true
      child.setAttribute('aria-hidden', 'true')
    })
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'

    const handlePopState = () => {
      immersiveHistoryEntryRef.current = false
      setImmersiveMode(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        exitImmersive()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    window.addEventListener('popstate', handlePopState)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscrollBehavior
      backgroundStates.forEach((state, element) => {
        if (!element.isConnected) return
        element.inert = state.inert
        if (state.ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', state.ariaHidden)
      })
      backgroundStates.clear()
      previousFocusRef.current?.focus({ preventScroll: true })
      previousFocusRef.current = null
    }
  }, [exitImmersive, immersiveMode])

  useEffect(() => {
    const mainVideo = videoRef.current
    const overlayVideo = immersiveVideoRef.current
    if (!immersiveMode || !mainVideo || !overlayVideo) return

    const sourceStream = webrtc.mediaStream || mainVideo.srcObject as MediaStream | null
    if (sourceStream) {
      overlayVideo.srcObject = sourceStream
      void overlayVideo.play().catch(() => {})
    }

    return () => {
      if (overlayVideo) overlayVideo.srcObject = null
    }
  }, [immersiveMode, webrtc.mediaStream])

  const statusCards = [
    ['信令', statusLabel[webrtc.status] || webrtc.status],
    ['ICE', webrtc.stats?.iceState || '--'],
    ['视频', webrtc.stats?.videoLive ? 'live' : '--'],
    ['分辨率', webrtc.stats?.width ? `${webrtc.stats.width}×${webrtc.stats.height}` : '--'],
    ['FPS', webrtc.stats?.fps ?? '--'],
    ['码率', webrtc.stats?.bitrate ? `${webrtc.stats.bitrate} kbps` : '--'],
    ['延迟', webrtc.stats?.rtt ? `${webrtc.stats.rtt} ms` : '--'],
    ['触控', webrtc.inputReady ? 'ready' : webrtc.status === 'connected' ? '等待通道' : '--']
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
        <div className={`scrcpy-view-header flex items-start justify-between gap-3 flex-wrap ${isCompact ? 'is-compact' : ''}`}>
          <div className="min-w-0">
            <div className="scrcpy-view-title-row flex items-center gap-2">
              <span className={`scrcpy-view-status-dot h-2 w-2 rounded-full ${statusDotClass}`} />
              <span className="scrcpy-view-title text-sm font-semibold text-primary">{isCompact ? '模拟器画面' : '模拟器实时预览'}</span>
              <span className="scrcpy-view-status text-xs text-secondary" role="status" aria-live="polite">
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
              className="scrcpy-compact-disconnect control-surface flex h-7 min-h-11 w-7 min-w-11 items-center justify-center rounded-md text-secondary transition-colors hover:text-primary"
            >
              <Unplug className="h-4 w-4" strokeWidth={1.8} />
            </button>
          )}
          {!isCompact && <div className="flex flex-wrap gap-2 text-xs justify-end">
            <span className="surface-soft rounded-full px-2 py-1 text-secondary">
              组件：{componentStatusLabel}
            </span>
            <span className="surface-soft rounded-full px-2 py-1 text-secondary">
              服务：{serverStatusLabel}{infrastructureStatus?.serverVersion ? ` · ${infrastructureStatus.serverVersion}` : ''}
            </span>
            <span className="surface-soft rounded-full px-2 py-1 text-secondary">
              Agent：{agentStatusLabel}{infrastructureStatus?.agentVersion ? ` · ${infrastructureStatus.agentVersion}` : ''}
            </span>
            {infrastructureStatus?.screenState === 'off' && (
              <span className="status-warning rounded-full px-2 py-1">设备息屏</span>
            )}
            {infrastructureStatus?.usingDefaultPassword && (
              <span
                className="status-warning rounded-full px-2 py-1"
                title="建议设置访问令牌保护预览服务"
              >
                默认密码
              </span>
            )}
            {visibleError && (
              <span className="px-2 py-1 rounded-full status-danger">{visibleError}</span>
            )}
          </div>}
        </div>

        {agentVersionOutdated && (
          <div
            className="status-warning flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs leading-5"
            role="alert"
          >
            <span>
              设备端 Agent {infrastructureStatus?.agentVersion || '版本未知'} 低于 v{minimumAgentVersion}，旧版可能因到期限制无法启动。
              {onRedeployAgent ? '重新部署即可更新设备端 Agent。' : '请先停止 Agent，再重新连接以部署新版。'}
            </span>
            {onRedeployAgent && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void onRedeployAgent()}
                disabled={!automationAvailable || infrastructureBusy}
                loading={infrastructureLoading === 'agent'}
                loadingText="部署中"
                title={!automationAvailable ? automationUnavailableMessage : undefined}
              >
                重新部署 Agent
              </Button>
            )}
          </div>
        )}

        {!isCompact && <div className="scrcpy-status-grid">
          {statusCards.map(([label, value]) => (
            <div key={label} className="surface-soft rounded-lg px-2 py-1.5">
              <div className="text-tertiary">{label}</div>
              <TruncatedText as="div" tooltip={value} className="font-medium text-primary">{value}</TruncatedText>
            </div>
          ))}
        </div>}

        <div
          className={`scrcpy-video-frame status-border-beam relative aspect-video overflow-hidden flex items-center justify-center shadow-sm ${
            previewBusy ? 'is-active ' : ''
          }${
            webrtc.status === 'connected'
              ? 'is-connected bg-black'
              : 'is-empty ring-1 ring-inset ring-[var(--app-border)]'
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
            onWheel={onWheel}
            onPointerUp={(event) => finishPointer(event)}
            onPointerCancel={(event) => finishPointer(event, true)}
            onLostPointerCapture={onLostPointerCapture}
          />
          {webrtc.status === 'connected' && !webrtc.inputReady && (
            <div
              className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-2.5 py-1.5 text-xs text-white/90"
              role="status"
              aria-live="polite"
            >
              触控连接中，画面暂不可操作
            </div>
          )}
          {webrtc.status !== 'connected' && (
            <div
              className="scrcpy-empty-state absolute inset-0 flex items-center justify-center px-6 text-center"
              role={visibleError ? 'alert' : 'status'}
              aria-live="polite"
            >
              <div className="scrcpy-empty-content w-full max-w-sm">
                <div className="device-preview-empty-icon mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg">
                  <Smartphone className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
                </div>
                <div className="scrcpy-empty-title mb-1 text-sm font-semibold text-primary">
                  {visibleError ? '预览启动失败' : '等待实时画面'}
                </div>
                <div className="scrcpy-empty-description mx-auto max-w-md text-xs leading-5 text-secondary">
                  {visibleError || (!automationAvailable
                    ? automationUnavailableMessage
                    : isCompact
                    ? '预览服务尚未连接。'
                    : '点击“启动实时预览”后，La-pluma 会自动启动服务、连接 MuMu 并显示实时画面。')}
                </div>
                <div className="scrcpy-empty-actions mt-4 flex justify-center">
                  <Button
                    size="sm"
                    variant="primary"
                    className="scrcpy-empty-action min-w-32 px-4"
                    icon={needsInstall
                      ? <Package className="h-3.5 w-3.5" strokeWidth={1.8} />
                      : <Plug className="h-3.5 w-3.5" strokeWidth={1.8} />}
                    onClick={needsInstall
                      ? () => runInfrastructureAction(onInstall)
                      : connectFromControl}
                    disabled={!automationAvailable || infrastructureBusy || isConnecting}
                    title={!automationAvailable ? automationUnavailableMessage : undefined}
                    loading={infrastructureLoading === 'install' || infrastructureLoading === 'preview' || isConnecting}
                  >
                    {needsInstall
                      ? '安装预览组件'
                      : visibleError
                        ? '重试预览'
                        : '启动预览'}
                  </Button>
                  {previewBusy && onCancelInfrastructure && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="scrcpy-empty-action min-w-24 px-3"
                      onClick={() => {
                        webrtc.disconnect()
                        onCancelInfrastructure()
                      }}
                    >
                      取消启动
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="scrcpy-preview-toolbar flex items-center justify-center gap-2 bg-transparent px-2 py-1" role="toolbar" aria-label="模拟器导航">
          <DeviceNavigationButtons
            connected={webrtc.status === 'connected'}
            automationAvailable={automationAvailable}
            automationUnavailableMessage={automationUnavailableMessage}
            onCommand={sendDeviceCommand}
          />
          <IconButton
            icon={<Clipboard className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
            variant="secondary"
            size="md"
            onClick={copyDeviceClipboard}
            disabled={!automationAvailable || webrtc.status !== 'connected'}
            aria-label="读取设备剪贴板"
            tooltip="读取设备剪贴板"
            tooltipSide="top"
            className="scrcpy-preview-control"
          />
          <IconButton
            icon={<ClipboardPaste className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
            variant="secondary"
            size="md"
            onClick={pasteLocalClipboard}
            disabled={!automationAvailable || webrtc.status !== 'connected'}
            aria-label="发送本机剪贴板"
            tooltip="发送本机剪贴板"
            tooltipSide="top"
            className="scrcpy-preview-control"
          />
          <IconButton
            icon={<Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
            variant="secondary"
            size="md"
            onClick={fullscreen}
            disabled={webrtc.status !== 'connected'}
            aria-label="全屏"
            tooltip="全屏"
            tooltipSide="top"
            className="scrcpy-preview-control"
          />
          {isCompact && (
            <IconButton
              icon={<SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
              variant="secondary"
              size="md"
              onClick={() => setCompactControlsOpen(open => !open)}
              aria-label={compactControlsOpen ? '收起预览设置' : '打开预览设置'}
              aria-expanded={compactControlsOpen}
              aria-controls={compactControlsId}
              tooltip={compactControlsOpen ? '收起预览设置' : '打开预览设置'}
              tooltipSide="top"
              className={`scrcpy-preview-control${compactControlsOpen ? ' is-active' : ''}`}
            />
          )}
        </div>

        {commandError && (
          <p className="text-center text-xs text-[var(--app-danger-text)]" role="alert" aria-live="polite">
            {commandError}
          </p>
        )}

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
              {statusLabel[webrtc.status] || webrtc.status}
            </span>
          </div>

          {webrtc.status === 'connected' && (
            <Button
              size="sm"
              variant="secondary"
              fullWidth
              className="scrcpy-preview-action"
              icon={<RotateCw className="h-3.5 w-3.5" strokeWidth={1.8} />}
              onClick={connectFromControl}
              disabled={!automationAvailable || infrastructureBusy}
              title={!automationAvailable ? automationUnavailableMessage : undefined}
              loading={infrastructureLoading === 'preview'}
            >
              重连预览
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
              disabled={webrtc.status === 'idle' || webrtc.status === 'disconnected'}
              className="scrcpy-utility-action min-h-11"
            >
              <Unplug className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span>断开</span>
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
            <span className="scrcpy-quality-current">{quality === 'custom' ? '自定义 · ' : ''}{customMaxSize}p · {keepNumberWithUnit(`${customFps} FPS`)}</span>
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
                      className={`scrcpy-preset-option ${quality === key ? 'is-active' : ''}`}
                    >
                      <span>{preset.label}</span>
                      <small>{preset.maxSize}p · {keepNumberWithUnit(`${preset.fps} FPS`)} · {preset.bitrateMbps}M</small>
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
                      className={`${customFps === fps ? 'is-active ' : ''}!min-h-11`}
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
                    min={2}
                    max={32}
                    step={1}
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
              <p className={`text-xs leading-5 ${settingsDirty ? 'text-[var(--app-accent)]' : 'text-secondary'}`} role="status">
                {settingsDirty ? '画质已修改，重连预览后生效' : '画质调整会在下次连接时生效'}
              </p>
            </div>
          </div>
        </section>
      </aside>}
    </div>
    {immersiveMode && createPortal(
      <div
        ref={immersiveDialogRef}
        data-scrcpy-immersive-layer="true"
        role="dialog"
        aria-modal="true"
        aria-label="模拟器沉浸预览"
        tabIndex={-1}
        className="fixed inset-0 z-[9999] bg-black flex flex-col landscape:flex-row items-center justify-center gap-2 outline-none"
        style={{
          paddingTop: 'max(0.5rem, env(safe-area-inset-top))',
          paddingRight: 'max(0.5rem, env(safe-area-inset-right))',
          paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(0.5rem, env(safe-area-inset-left))'
        }}
      >
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch">
          <video
            ref={immersiveVideoRef}
            autoPlay
            playsInline
            muted
            aria-label="模拟器沉浸画面"
            aria-disabled={!webrtc.inputReady}
            className="h-full w-full object-contain touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onWheel={onWheel}
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
          <IconButton
            icon={<Minimize2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
            variant="ghost"
            size="md"
            onClick={exitImmersive}
            title="退出全屏"
            aria-label="退出全屏"
            className="scrcpy-immersive-control"
          />
        </div>
      </div>,
      document.body
    )}
    </>
  )
}
