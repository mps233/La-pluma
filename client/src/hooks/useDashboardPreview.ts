import { useEffect, useRef, useState } from 'react'
import { maaApi } from '../services/api'
import { useScrcpyWebRTC } from './useScrcpyWebRTC'

const DEFAULT_SIGNALING_URL = 'ws://127.0.0.1:8443'
const DEFAULT_DEVICE_ID = 'mumu-la-pluma'
const FRAME_SAMPLE_SIZE = 8
const BLACK_FRAME_THRESHOLD = 18
const LIVE_STALE_MS = 1500
const FRAME_SAMPLE_INTERVAL_MS = 500
const STATUS_POLL_INTERVAL_MS = 5000
const FALLBACK_SNAPSHOT_INTERVAL_MS = 10000
const CONNECTING_STATUSES = new Set(['connecting', 'signaling', 'waiting_offer', 'connecting_webrtc'])

export function useDashboardPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const autoConnectRef = useRef(false)
  const lastVisibleLiveFrameAtRef = useRef(0)
  const [webrtcStatus, setWebrtcStatus] = useState<any>(null)
  const [fallbackSnapshot, setFallbackSnapshot] = useState<string | null>(null)
  const [showLivePreview, setShowLivePreview] = useState(false)

  const preview = useScrcpyWebRTC({
    videoRef,
    deviceId: DEFAULT_DEVICE_ID,
    signalingUrl: webrtcStatus?.signalingUrl || DEFAULT_SIGNALING_URL,
    connectionPath: 'auto',
    ipPreference: 'ipv4',
    scrcpyOptions: {
      max_fps: 30,
      max_size: 960,
      bitrate: 2500000,
      min_bitrate: 1000000,
      max_bitrate: 5000000,
      bwe: true,
      audio: false,
      snapshot_interval: 10
    }
  })

  useEffect(() => {
    const fetch = () => {
      maaApi.getWebrtcStatus()
        .then(response => {
          if (response.success) setWebrtcStatus(response.data)
        })
        .catch(() => {})
    }

    fetch()
    const timer = setInterval(fetch, STATUS_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!webrtcStatus?.serverRunning || !webrtcStatus?.agentRunning || autoConnectRef.current) return
    autoConnectRef.current = true
    preview.connect()
  }, [preview, webrtcStatus?.agentRunning, webrtcStatus?.serverRunning])

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
  }, [])

  useEffect(() => {
    if (showLivePreview) return

    let cancelled = false
    const fetchSnapshot = async () => {
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
  }, [showLivePreview])

  return {
    videoRef,
    fallbackSnapshot,
    showLivePreview,
    isConnecting: CONNECTING_STATUSES.has(preview.status),
    statusText: showLivePreview ? 'Live' : fallbackSnapshot ? '画面快照 · 10s' : preview.error || preview.status,
    headerStatusText: showLivePreview ? `${preview.stats?.width || 0}×${preview.stats?.height || 0}` : fallbackSnapshot ? '画面快照' : '自动连接中'
  }
}
