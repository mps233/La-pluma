import { useEffect, useMemo, useRef, useState } from 'react'
import { maaApi, type WebrtcStatusData } from '../services/api'
import { buildPreviewScrcpyOptions, usePreviewStore } from '../stores'
import { usePreviewConnection } from '../contexts/previewSession'

const DEFAULT_SIGNALING_URL = '/webrtc-signaling'
const DEFAULT_DEVICE_ID = 'mumu-la-pluma'
const FRAME_SAMPLE_SIZE = 8
const BLACK_FRAME_THRESHOLD = 18
const LIVE_STALE_MS = 1500
const FRAME_SAMPLE_INTERVAL_MS = 500
const STATUS_POLL_INTERVAL_MS = 10000
const FALLBACK_SNAPSHOT_INTERVAL_MS = 10000
const CONNECTING_STATUSES = new Set(['connecting', 'signaling', 'waiting_offer', 'connecting_webrtc'])

export function useDashboardPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const autoConnectRef = useRef(false)
  const infrastructureStartingRef = useRef(false)
  const lastVisibleLiveFrameAtRef = useRef(0)
  const mode = usePreviewStore(state => state.mode)
  const quality = usePreviewStore(state => state.quality)
  const fps = usePreviewStore(state => state.fps)
  const maxSize = usePreviewStore(state => state.maxSize)
  const bitrateMbps = usePreviewStore(state => state.bitrateMbps)
  const [webrtcStatus, setWebrtcStatus] = useState<WebrtcStatusData | null>(null)
  const [fallbackSnapshot, setFallbackSnapshot] = useState<string | null>(null)
  const [showLivePreview, setShowLivePreview] = useState(false)
  const [statusSettled, setStatusSettled] = useState(false)
  const [previewStartError, setPreviewStartError] = useState<string | null>(null)
  const serverRunning = Boolean(webrtcStatus?.serverRunning)
  const agentRunning = Boolean(webrtcStatus?.agentRunning)
  const scrcpyOptions = useMemo(
    () => buildPreviewScrcpyOptions({ quality, fps, maxSize, bitrateMbps }),
    [bitrateMbps, fps, maxSize, quality]
  )

  const preview = usePreviewConnection(videoRef, {
    deviceId: DEFAULT_DEVICE_ID,
    signalingUrl: webrtcStatus?.signalingUrl || DEFAULT_SIGNALING_URL,
    connectionPath: 'auto',
    ipPreference: 'ipv4',
    scrcpyOptions
  })
  const connectPreview = preview.connect
  const disconnectPreview = preview.disconnect

  const reconnectPreview = () => {
    autoConnectRef.current = false
    disconnectPreview()
    if (!serverRunning || !agentRunning) {
      void maaApi.startWebrtc()
        .then(result => {
          if (!result.success) throw new Error(maaApi.getErrorMessage(result))
          setPreviewStartError(null)
          if (result.data) setWebrtcStatus(result.data)
        })
        .catch((error: unknown) => {
          setPreviewStartError(error instanceof Error ? error.message : '无法启动实时预览')
        })
      return
    }
    autoConnectRef.current = true
    connectPreview()
  }

  useEffect(() => {
    let cancelled = false
    const fetchStatus = () => {
      maaApi.getWebrtcStatus()
        .then(response => {
          if (!cancelled && response.success) setWebrtcStatus(response.data ?? null)
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setStatusSettled(true)
        })
    }

    fetchStatus()
    const timer = setInterval(fetchStatus, STATUS_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (mode !== 'live') {
      autoConnectRef.current = false
      disconnectPreview()
      return
    }
    if (!serverRunning || !agentRunning || autoConnectRef.current) return
    autoConnectRef.current = true
    connectPreview()
  }, [agentRunning, connectPreview, disconnectPreview, mode, serverRunning])

  useEffect(() => {
    if (mode !== 'live' || !statusSettled || (serverRunning && agentRunning) || infrastructureStartingRef.current) return
    infrastructureStartingRef.current = true
    void maaApi.startWebrtc()
      .then(result => {
        if (!result.success) throw new Error(maaApi.getErrorMessage(result))
        setPreviewStartError(null)
        if (result.data) setWebrtcStatus(result.data)
      })
      .catch((error: unknown) => {
        setPreviewStartError(error instanceof Error ? error.message : '无法启动实时预览')
      })
      .finally(() => {
        infrastructureStartingRef.current = false
      })
  }, [agentRunning, mode, serverRunning, statusSettled])

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = FRAME_SAMPLE_SIZE
    canvas.height = FRAME_SAMPLE_SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const hasVisibleFrame = () => {
      const video = videoRef.current
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return false

      try {
        ctx.drawImage(video, 0, 0, FRAME_SAMPLE_SIZE, FRAME_SAMPLE_SIZE)
        const data = ctx.getImageData(0, 0, FRAME_SAMPLE_SIZE, FRAME_SAMPLE_SIZE).data
        let total = 0
        for (let i = 0; i < data.length; i += 4) {
          total += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)
        }
        return total / (FRAME_SAMPLE_SIZE * FRAME_SAMPLE_SIZE * 3) > BLACK_FRAME_THRESHOLD
      } catch {
        return false
      }
    }

    const timer = setInterval(() => {
      if (mode !== 'live') {
        setShowLivePreview(false)
        return
      }
      if (hasVisibleFrame()) {
        lastVisibleLiveFrameAtRef.current = Date.now()
        setShowLivePreview(true)
        return
      }

      if (!lastVisibleLiveFrameAtRef.current || Date.now() - lastVisibleLiveFrameAtRef.current > LIVE_STALE_MS) {
        setShowLivePreview(false)
      }
    }, FRAME_SAMPLE_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [mode])

  const shouldShowSnapshot = mode === 'snapshot' || (mode === 'live' && !showLivePreview)
  useEffect(() => {
    if (!statusSettled || !shouldShowSnapshot) return

    let cancelled = false
    const fetchSnapshot = async () => {
      if (document.hidden) return
      if (serverRunning) {
        try {
          const snapshot = await maaApi.getWebrtcSnapshot(DEFAULT_DEVICE_ID)
          const snapshotData = snapshot?.data
          const image = snapshotData?.image
          if (!cancelled && image && snapshotData) {
            const mediaType = snapshotData.mediaType || 'image/jpeg'
            setFallbackSnapshot(`data:${mediaType};base64,${image}`)
            return
          }
        } catch {
          // Fall back to an ADB screenshot when the preview service has no snapshot.
        }
      }

      try {
        const result = await maaApi.captureScreen()
        const image = result?.data?.image
        if (!cancelled && image) {
          setFallbackSnapshot(`data:image/png;base64,${image}`)
        }
      } catch {
        // Keep the last usable frame.
      }
    }

    fetchSnapshot()
    const timer = setInterval(fetchSnapshot, FALLBACK_SNAPSHOT_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [serverRunning, shouldShowSnapshot, statusSettled])

  const previewError = previewStartError || preview.error
  const visibleFallback = shouldShowSnapshot ? fallbackSnapshot : null
  return {
    mode,
    videoRef,
    fallbackSnapshot: visibleFallback,
    showLivePreview: mode === 'live' ? showLivePreview : false,
    isConnecting: mode === 'live' && CONNECTING_STATUSES.has(preview.status),
    connectionStatus: preview.status,
    connectionError: preview.error,
    reconnectPreview,
    statusText: mode === 'off'
      ? '预览已关闭'
      : mode === 'snapshot'
        ? visibleFallback ? '画面快照 · 10s' : '等待画面快照'
        : showLivePreview
          ? 'Live'
          : webrtcStatus?.screenState === 'off'
            ? '设备息屏'
            : previewError
              ? `实时连接失败 · 快照占位`
              : visibleFallback
                ? '正在连接实时画面 · 快照占位'
                : preview.status,
    headerStatusText: mode === 'off'
      ? '已关闭'
      : mode === 'snapshot'
        ? visibleFallback ? '画面快照' : '等待快照'
        : showLivePreview
          ? `${preview.stats?.width || 0}×${preview.stats?.height || 0}`
          : webrtcStatus?.screenState === 'off'
            ? '设备息屏'
            : visibleFallback
              ? '快照占位 · 实时连接中'
              : '连接中'
  }
}
