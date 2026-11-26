import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from 'cn'
import { ArrowLeft, Home, Maximize2, Minimize2, PanelsTopLeft, SlidersHorizontal, Smartphone } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { EmptyState } from '@/shared/components'
import { usePreviewSession } from '../hooks/usePreviewSession'
import { usePreviewSnapshot } from '../hooks/usePreviewSnapshot'
import { derivePreviewStatus, type PreviewLiveStatus } from '../model/previewStatus'
import type { usePreviewInfrastructureView } from '../hooks/usePreviewInfrastructureView'
import { PreviewModeSegmented } from './PreviewModeSegmented'
import { PreviewSettingsDialog } from './PreviewSettingsDialog'

interface ScrcpyDeviceViewProps {
  infrastructure: ReturnType<typeof usePreviewInfrastructureView>
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
  onCommand,
}: {
  connected: boolean
  automationAvailable: boolean
  automationUnavailableMessage: string
  immersive?: boolean
  onCommand: (command: string) => void
}) {
  return deviceNavigationActions.map(({ label, command, Icon }) => (
    <Tooltip key={label}>
      <TooltipTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onCommand(command)}
            disabled={!connected || !automationAvailable}
            aria-label={label}
            className={immersive
              ? 'size-11 rounded-full border border-white/30 bg-black/50 text-white hover:bg-black/70'
              : 'size-11 rounded-full text-muted-foreground hover:text-primary'}
          >
            <Icon aria-hidden="true" strokeWidth={1.8} />
          </Button>
        )}
      />
      <TooltipContent>{!automationAvailable ? automationUnavailableMessage : label}</TooltipContent>
    </Tooltip>
  ))
}

interface TrackedPointer {
  clientX: number
  clientY: number
  target: HTMLVideoElement
}

export default function ScrcpyDeviceView({ infrastructure }: ScrcpyDeviceViewProps) {
  const {
    automationAvailable,
    automationUnavailableMessage = '后端服务暂不可用，请稍后重试',
    infrastructureError,
  } = infrastructure
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const immersiveVideoRef = useRef<HTMLVideoElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const immersiveHistoryEntryRef = useRef(false)
  const trackedPointersRef = useRef(new Map<number, TrackedPointer>())
  const pendingPointerMovesRef = useRef(new Map<number, TrackedPointer>())
  const pointerMoveFrameRef = useRef<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [immersiveMode, setImmersiveMode] = useState(false)
  const [immersiveVideoMounted, setImmersiveVideoMounted] = useState(false)
  const webrtc = usePreviewSession({
    videoRef,
  })
  const snapshot = usePreviewSnapshot(automationAvailable)
  const sendTouchRef = useRef(webrtc.sendTouch)
  useEffect(() => {
    sendTouchRef.current = webrtc.sendTouch
  }, [webrtc.sendTouch])
  const previewBusy = infrastructure.infrastructureLoading === 'preview' || webrtc.isConnecting
  const status = derivePreviewStatus({
    mode: webrtc.mode,
    available: automationAvailable,
    paused: webrtc.paused,
    liveStatus: webrtc.status as PreviewLiveStatus,
    liveError: webrtc.error,
    snapshotHasImage: Boolean(snapshot.image),
    snapshotError: snapshot.error,
    infrastructureError: infrastructureError ?? null,
  })
  const setStatsEnabled = webrtc.setStatsEnabled

  useEffect(() => {
    setStatsEnabled(settingsOpen)
    return () => setStatsEnabled(false)
  }, [setStatsEnabled, settingsOpen])

  const retryPreview = () => {
    switch (status.retry?.target) {
      case 'snapshot':
        snapshot.retry()
        break
      case 'live':
        webrtc.connect()
        break
      case 'infrastructure':
        setSettingsOpen(true)
        break
    }
  }

  const retryLabel = status.retry?.target === 'infrastructure' ? '打开设置' : status.retry?.label

  const sendDeviceCommand = (command: string) => {
    if (!automationAvailable) return
    webrtc.sendCommand(command)
  }

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

  return (
    <>
    <div className="flex min-w-0 flex-col">
      <div className="scrcpy-view-header flex items-center justify-between gap-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`preview-status-light is-${status.tone}`}
            aria-hidden="true"
          />
          <h2 className="truncate text-base font-semibold text-foreground">设备画面</h2>
          {status.phase !== 'off' && (
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {status.label}
            </span>
          )}
        </div>
        <PreviewModeSegmented unavailable={!automationAvailable} />
      </div>

      {status.error && status.hasFrame && (
        <Alert variant="destructive" className="mx-4 mb-3">
          <AlertTitle>{status.error.title}</AlertTitle>
          <AlertDescription>{status.error.message}</AlertDescription>
          {status.retry && (
            <div className="mt-1.5">
              <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={retryPreview}>
                {retryLabel}
              </Button>
            </div>
          )}
        </Alert>
      )}

      <div
        className={cn(
          'scrcpy-video-frame status-border-beam relative flex aspect-video items-center justify-center overflow-hidden',
          previewBusy && 'is-active',
          status.hasFrame ? 'is-connected bg-black' : 'is-empty ring-1 ring-inset ring-border',
        )}
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
          {status.snapshotStale && (
            <Badge variant="secondary" className="absolute left-2 top-2 border-white/20 bg-black/70 text-white">
              上次成功画面 · 可能已过期
            </Badge>
          )}
          {webrtc.status === 'connected' && !webrtc.inputReady && !immersiveMode && (
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-2.5 py-1.5 text-xs text-white/90">
              触控连接中，画面暂不可操作
            </div>
          )}
          {!status.hasFrame && (
            <EmptyState
              compact
              role={status.error ? 'alert' : undefined}
              icon={<Smartphone className="size-5" strokeWidth={1.6} />}
              title={status.emptyTitle}
              description={status.error?.message ?? (!automationAvailable ? automationUnavailableMessage : undefined)}
              action={status.retry ? (
                <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={retryPreview}>
                  {retryLabel}
                </Button>
              ) : undefined}
              className="scrcpy-empty-state absolute inset-0"
            />
          )}
        </div>
        <div className="scrcpy-preview-toolbar flex items-center justify-center" role="toolbar" aria-label="模拟器导航">
          <DeviceNavigationButtons
            connected={webrtc.status === 'connected'}
            automationAvailable={automationAvailable}
            automationUnavailableMessage={automationUnavailableMessage}
            onCommand={sendDeviceCommand}
          />
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={fullscreen}
                  disabled={webrtc.status !== 'connected'}
                  aria-label="全屏"
                  className="size-11 rounded-full text-muted-foreground hover:text-primary"
                >
                  <Maximize2 aria-hidden="true" strokeWidth={1.8} />
                </Button>
              )}
            />
            <TooltipContent>全屏</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="打开预览设置"
                  aria-haspopup="dialog"
                  className="size-11 rounded-full text-muted-foreground hover:text-primary"
                >
                  <SlidersHorizontal aria-hidden="true" strokeWidth={1.8} />
                </Button>
              )}
            />
            <TooltipContent>预览设置</TooltipContent>
          </Tooltip>
        </div>

      </div>
    <PreviewSettingsDialog
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      session={webrtc}
      infrastructure={infrastructure}
    />
    <Dialog open={immersiveMode} onOpenChange={open => { if (!open) exitImmersive() }}>
      <DialogContent
        data-scrcpy-immersive-layer="true"
        aria-modal="true"
        showCloseButton={false}
        finalFocus={previousFocusRef}
        className="fixed top-0 right-0 bottom-0 left-0 z-(--layout-z-immersive) flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-2 rounded-none bg-black p-0 text-white outline-hidden landscape:flex-row sm:max-w-none"
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
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={exitImmersive}
                  aria-label="退出全屏"
                  className="size-11 rounded-full border border-white/30 bg-black/50 text-white hover:bg-black/70"
                >
                  <Minimize2 aria-hidden="true" strokeWidth={1.8} />
                </Button>
              )}
            />
            <TooltipContent>退出全屏</TooltipContent>
          </Tooltip>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
