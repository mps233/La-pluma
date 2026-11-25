import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@/shared/api'
import { startWebrtc } from '../api'
import { buildScrcpyOptions, usePreviewStore } from '../store/previewStore'
import { isPageHidden, usePageVisible } from '@/shared/hooks/usePageVisible'
import { useScrcpyWebRTC } from './useScrcpyWebRTC'

type Options = Parameters<typeof useScrcpyWebRTC>[0] & {
  automationAvailable?: boolean
  infrastructureBusy?: boolean
  startInfrastructure?: (signal: AbortSignal) => Promise<string | undefined>
  cancelInfrastructure?: () => void
}

const CONNECTING_STATUSES = new Set(['connecting', 'signaling', 'waiting_offer', 'connecting_webrtc'])
const HIDDEN_PREVIEW_STOP_DELAY_MS = 180_000

/** The application owns one preview independently of workspace Activity effects. */
export function usePreviewSessionOwner({ automationAvailable = true, infrastructureBusy = false, startInfrastructure, cancelInfrastructure, ...options }: Options) {
  const mode = usePreviewStore(state => state.mode)
  const quality = usePreviewStore(state => state.quality)
  const customFps = usePreviewStore(state => state.customFps)
  const customMaxSize = usePreviewStore(state => state.customMaxSize)
  const customBitrateMbps = usePreviewStore(state => state.customBitrateMbps)
  const visible = usePageVisible()
  const [attempt, setAttempt] = useState(0)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [statsEnabled, setStatsEnabled] = useState(false)
  const hiddenStopTimerRef = useRef<number | null>(null)
  const connectionActiveRef = useRef(false)
  const scrcpyOptions = useMemo(
    () => buildScrcpyOptions({ quality, customFps, customMaxSize, customBitrateMbps }),
    [quality, customFps, customMaxSize, customBitrateMbps],
  )
  const transport = useScrcpyWebRTC({ ...options, scrcpyOptions, statsEnabled })
  const disconnectTransport = transport.disconnect
  const transportStatus = transport.status

  const start = useEffectEvent(async (signal: AbortSignal) => {
    setStarting(true)
    setStartError(null)
    try {
      let signalingUrl: string | undefined
      if (startInfrastructure) {
        signalingUrl = await startInfrastructure(signal)
      } else {
        const result = await startWebrtc('default', options.deviceId, signal)
        if (!result.success) throw new Error(getErrorMessage(result))
        signalingUrl = result.data?.signalingUrl
      }
      if (signal.aborted) return
      if (!signalingUrl) throw new Error('预览服务未就绪，请重试')
      transport.connect(signalingUrl)
      connectionActiveRef.current = true
    } catch (error) {
      if (!signal.aborted) setStartError(error instanceof Error ? error.message : '无法启动实时预览')
    } finally {
      if (!signal.aborted) setStarting(false)
    }
  })
  const release = useEffectEvent(() => {
    connectionActiveRef.current = false
    transport.disconnect()
    cancelInfrastructure?.()
  })

  useEffect(() => {
    if (transportStatus !== 'error' && transportStatus !== 'disconnected') return
    connectionActiveRef.current = false
  }, [transportStatus])

  useEffect(() => {
    setStarting(false)
    setStartError(null)
    if (mode !== 'live' || !automationAvailable || infrastructureBusy) {
      if (hiddenStopTimerRef.current !== null) {
        window.clearTimeout(hiddenStopTimerRef.current)
        hiddenStopTimerRef.current = null
      }
      if (connectionActiveRef.current) release()
      return
    }
    if (!visible) {
      if (hiddenStopTimerRef.current === null && connectionActiveRef.current) {
        hiddenStopTimerRef.current = window.setTimeout(() => {
          hiddenStopTimerRef.current = null
          release()
        }, HIDDEN_PREVIEW_STOP_DELAY_MS)
      }
      return
    }
    if (hiddenStopTimerRef.current !== null) {
      window.clearTimeout(hiddenStopTimerRef.current)
      hiddenStopTimerRef.current = null
      if (connectionActiveRef.current) return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      controller.abort()
      setStarting(false)
      setStartError('预览服务启动超时，请重试或关闭预览')
      release()
    }, 45000)
    void start(controller.signal).finally(() => clearTimeout(timeout))
    return () => {
      controller.abort()
      clearTimeout(timeout)
      if (connectionActiveRef.current && isPageHidden()) {
        hiddenStopTimerRef.current = window.setTimeout(() => {
          hiddenStopTimerRef.current = null
          release()
        }, HIDDEN_PREVIEW_STOP_DELAY_MS)
        return
      }
      release()
    }
  }, [mode, visible, automationAvailable, infrastructureBusy, attempt, options.deviceId, options.signalingUrl, options.connectionPath, options.ipPreference])

  useEffect(() => () => {
    if (hiddenStopTimerRef.current !== null) window.clearTimeout(hiddenStopTimerRef.current)
  }, [])

  const connect = useCallback(() => {
    usePreviewStore.getState().setMode('live')
    setAttempt(value => value + 1)
  }, [])
  const disconnect = useCallback(() => {
    if (hiddenStopTimerRef.current !== null) {
      window.clearTimeout(hiddenStopTimerRef.current)
      hiddenStopTimerRef.current = null
    }
    connectionActiveRef.current = false
    disconnectTransport()
    cancelInfrastructure?.()
    usePreviewStore.getState().setMode('off')
  }, [cancelInfrastructure, disconnectTransport])

  return {
    ...transport,
    connect,
    disconnect,
    mode,
    paused: !visible && mode !== 'off',
    starting,
    isConnecting: starting || (mode === 'live' && visible && automationAvailable && infrastructureBusy) || CONNECTING_STATUSES.has(transport.status),
    error: startError || transport.error,
    setStatsEnabled,
  }
}
