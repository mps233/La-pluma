import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithAuth } from '../services/api'

type WebRTCStatus = 'idle' | 'connecting' | 'signaling' | 'waiting_offer' | 'connecting_webrtc' | 'connected' | 'disconnected' | 'error'

interface ScrcpyOptions {
  max_fps?: number
  max_size?: number
  bitrate?: number
  min_bitrate?: number
  max_bitrate?: number
  bwe?: boolean
  audio?: boolean
  audio_gain?: number
  audio_source?: string
  audio_dup?: boolean
  audio_low_latency?: boolean
  debug?: boolean
  snapshot_interval?: number
  power_off?: boolean
  stay_awake?: boolean
}

interface UseScrcpyWebRTCOptions {
  deviceId?: string
  signalingUrl?: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  connectionPath?: 'auto' | 'relay' | 'direct'
  ipPreference?: 'auto' | 'ipv4' | 'ipv6'
  scrcpyOptions?: ScrcpyOptions
  /** 由 App 级共享会话接管时禁用本实例的连接与定时器。 */
  passive?: boolean
}

export interface VideoStats {
  fps: string | number
  bitrate: string | number
  rtt: string | number
  width: number
  height: number
  videoLive: boolean
  iceState: RTCIceConnectionState | 'unknown'
}

const DEFAULT_SIGNALING_PATH = '/webrtc-signaling'
const SIGNALING_RETRY_DELAYS_MS = [300, 800]
const SIGNALING_ATTEMPT_TIMEOUT_MS = 4000
const INPUT_CHANNEL_BACKPRESSURE_BYTES = 64 * 1024
const HEARTBEAT_INTERVAL_MS = 5_000
const OFFER_TIMEOUT_MS = 15_000
const RECONNECT_DELAY_MS = 800
const COMMAND_TIMEOUT_MS = 12_000
/** 输入通道失效后的自动恢复退避；三次仍失败就交给用户手动重试。 */
const RECOVERY_DELAYS_MS = [800, 2_000, 5_000]
/** 可见状态下定期检查 PeerConnection / input channel 的健康度。 */
const CONNECTION_HEALTH_INTERVAL_MS = 4_000
/** ICE disconnected 可能只是网络切换，给短暂恢复留出时间。 */
const DISCONNECT_GRACE_MS = 8_000
/** 媒体已连上但 input channel 迟迟不 open 时，视为控制面失效。 */
const CONTROL_PLANE_GRACE_MS = 8_000
/** 通道连续保持 open 这么久才清空重连预算，避免短暂 open→close 无限重连。 */
const INPUT_STABLE_WINDOW_MS = 4_000
const IN_PROGRESS_STATUSES: WebRTCStatus[] = [
  'connecting',
  'signaling',
  'waiting_offer',
  'connecting_webrtc'
]

/** 离开工作区或页面隐藏后保留媒体连接的时间，与预览服务的 3 秒回收宽限区分。 */
const PREVIEW_HIDDEN_DISCONNECT_MS = 180_000;

export interface ScrcpyCommandResult {
  requestId: string
  success: boolean
  output?: string
  error?: string
  raw?: unknown
}

interface SignalingPayload {
  type: string
  success?: boolean
  output?: string
  result?: string
  error?: string
  request_id?: string
  message?: string
  sdp: string
  candidate: RTCIceCandidateInit
}

interface SignalingMessage {
  message_type?: string
  type?: string
  ice_servers?: RTCIceServer[]
  device_info?: {
    displays?: Array<{ x_res?: number; y_res?: number }>
  }
  error?: string
  payload?: SignalingPayload
}

function normalizeCommandResult(payload: SignalingPayload, requestId: string): ScrcpyCommandResult {
  const error = typeof payload.error === 'string' ? payload.error : ''
  const output = typeof payload.output === 'string'
    ? payload.output
    : typeof payload.result === 'string'
      ? payload.result
      : undefined
  return {
    requestId,
    success: payload.success !== false && !error,
    output,
    error: error || undefined,
    raw: payload
  }
}

interface SignalingEndpoints {
  httpBase: string
  websocketBase: string
}

interface RenderedVideoGeometry {
  actualW: number
  actualH: number
  offsetX: number
  offsetY: number
}

export function getRenderedVideoGeometry(
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number
): RenderedVideoGeometry | null {
  if (!containerWidth || !containerHeight || !videoWidth || !videoHeight) return null
  const videoRatio = videoWidth / videoHeight
  const clientRatio = containerWidth / containerHeight
  if (clientRatio > videoRatio) {
    const actualH = containerHeight
    const actualW = containerHeight * videoRatio
    return { actualW, actualH, offsetX: (containerWidth - actualW) / 2, offsetY: 0 }
  }
  const actualW = containerWidth
  const actualH = containerWidth / videoRatio
  return { actualW, actualH, offsetX: 0, offsetY: (containerHeight - actualH) / 2 }
}

export function isPointInsideRenderedVideo(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top'>,
  geometry: RenderedVideoGeometry
) {
  const relativeX = clientX - rect.left - geometry.offsetX
  const relativeY = clientY - rect.top - geometry.offsetY
  return relativeX >= 0 && relativeX <= geometry.actualW && relativeY >= 0 && relativeY <= geometry.actualH
}

export function resolveTouchTargetSize(
  deviceWidth: number,
  deviceHeight: number,
  videoWidth: number,
  videoHeight: number
) {
  if (!deviceWidth || !deviceHeight || !videoWidth || !videoHeight) {
    return { width: deviceWidth, height: deviceHeight }
  }
  const defaultLandscape = deviceWidth > deviceHeight
  const videoLandscape = videoWidth > videoHeight
  return videoLandscape !== defaultLandscape
    ? { width: deviceHeight, height: deviceWidth }
    : { width: deviceWidth, height: deviceHeight }
}

export function isTouchMoveBackpressured(action: number, bufferedAmount: number) {
  return action === 2 && bufferedAmount > INPUT_CHANNEL_BACKPRESSURE_BYTES
}

export function bindInputChannelReadiness(
  channel: RTCDataChannel,
  onChange: (ready: boolean) => void,
  onClosed?: () => void
) {
  channel.bufferedAmountLowThreshold = INPUT_CHANNEL_BACKPRESSURE_BYTES / 2
  const update = () => onChange(channel.readyState === 'open')
  const handleClose = () => {
    update()
    onClosed?.()
  }
  channel.onopen = update
  channel.onclose = handleClose
  channel.onerror = update
  update()
  return () => {
    channel.onopen = null
    channel.onclose = null
    channel.onerror = null
  }
}

function endpointBase(url: URL) {
  const pathname = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${pathname === '/' ? '' : pathname}`
}

export function resolveSignalingEndpoints(
  signalingUrl: string,
  pageUrl = window.location.href
): SignalingEndpoints {
  const page = new URL(pageUrl)
  const fallback = new URL(DEFAULT_SIGNALING_PATH, page)
  let endpoint: URL
  try {
    endpoint = new URL(signalingUrl || DEFAULT_SIGNALING_PATH, page)
  } catch {
    endpoint = fallback
  }

  if (!['http:', 'https:', 'ws:', 'wss:'].includes(endpoint.protocol)) endpoint = fallback
  if (page.protocol === 'https:' && (endpoint.protocol === 'http:' || endpoint.protocol === 'ws:')) {
    endpoint = fallback
  }
  endpoint.search = ''
  endpoint.hash = ''

  const httpEndpoint = new URL(endpoint)
  httpEndpoint.protocol = endpoint.protocol === 'wss:' ? 'https:'
    : endpoint.protocol === 'ws:' ? 'http:'
      : endpoint.protocol
  const websocketEndpoint = new URL(endpoint)
  websocketEndpoint.protocol = endpoint.protocol === 'https:' ? 'wss:'
    : endpoint.protocol === 'http:' ? 'ws:'
      : endpoint.protocol

  return {
    httpBase: endpointBase(httpEndpoint),
    websocketBase: endpointBase(websocketEndpoint)
  }
}

async function getSignalingToken(httpBase: string, signal: AbortSignal) {
  const loginUrl = `${httpBase}/api/login`
  let response: Response
  try {
    response = await fetchWithAuth(loginUrl, {
      method: 'POST',
      cache: 'no-store',
      signal
    })
  } catch {
    throw new Error('暂时无法连接信令服务')
  }
  if (!response.ok) throw new Error(`信令服务登录失败 (HTTP ${response.status})`)
  const data = await response.json().catch(() => null)
  if (typeof data?.token !== 'string' || !data.token.trim()) throw new Error('信令服务返回了无效凭证')
  return data.token as string
}

function normalizeSignalingUrl(websocketBase: string, token: string, deviceId?: string) {
  const deviceQuery = deviceId ? `&deviceId=${encodeURIComponent(deviceId)}` : ''
  return `${websocketBase}/connect_client?token=${encodeURIComponent(token)}${deviceQuery}`
}

function normalizeIceServerUrls(value: unknown): string[] {
  const urls = Array.isArray(value) ? value : [value]
  return urls
    .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    .map(url => url.trim().replace(/^(turns?):@/i, '$1:'))
}

function normalizeIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const urls = normalizeIceServerUrls(record.urls)
    if (!urls.length) return []
    const server: RTCIceServer = { urls: urls.length === 1 ? urls[0]! : urls }
    if (typeof record.username === 'string' && record.username) server.username = record.username
    if (typeof record.credential === 'string' && record.credential) server.credential = record.credential
    return [server]
  })
}

export { normalizeIceServers }

function candidateAddress(candidate: string): string {
  // SDP uses `a=candidate:...` while trickle messages use `candidate:...`.
  // The address is the fifth token (foundation, component, protocol, priority,
  // address, port, typ, ...).
  const tokens = String(candidate || '').trim().replace(/^a=/, '').split(/\s+/)
  return tokens[4] || ''
}

function candidateHasIpv6(candidate: string) {
  const address = candidateAddress(candidate)
  return address.includes(':') && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)
}

function candidateHasIpv4(candidate: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidateAddress(candidate))
}

export function candidateIsLoopback(candidate: string) {
  const address = candidateAddress(candidate)
  return address.startsWith('127.') || address === '::1'
}

function filterCandidateLine(candidate: string, connectionPath: 'auto' | 'relay' | 'direct', ipPreference: 'auto' | 'ipv4' | 'ipv6') {
  const isRelay = candidate.includes(' typ relay')
  if (connectionPath === 'relay' && !isRelay) return false
  if (connectionPath === 'direct' && isRelay) return false
  if (ipPreference === 'ipv4' && candidateHasIpv6(candidate)) return false
  if (ipPreference === 'ipv6' && candidateHasIpv4(candidate)) return false
  return true
}

export function shouldKeepCandidate(candidate: string, connectionPath: 'auto' | 'relay' | 'direct', ipPreference: 'auto' | 'ipv4' | 'ipv6') {
  if (!candidate) return false
  return filterCandidateLine(candidate, connectionPath, ipPreference)
}

// WebKit can advertise 127.0.0.1 while sending from the LAN address; Pion
// then discards the STUN response and ICE never starts. Drop loopback only
// when the SDP also offers a real address, so a loopback-only setup still works.
export function filterSdpCandidatesForPolicy(
  sdp: string,
  connectionPath: 'auto' | 'relay' | 'direct',
  ipPreference: 'auto' | 'ipv4' | 'ipv6',
  forceDropLoopback = false
) {
  const lines = sdp.split('\r\n')
  const candidates = lines.filter(line => line.startsWith('a=candidate:'))
  const hasNonLoopback = candidates.some(line => !candidateIsLoopback(line))
  const dropLoopback = forceDropLoopback || hasNonLoopback
  return lines.filter(line => {
    if (!line.startsWith('a=candidate:')) return true
    if (dropLoopback && candidateIsLoopback(line)) return false
    return filterCandidateLine(line, connectionPath, ipPreference)
  }).join('\r\n')
}

export function useScrcpyWebRTC({
  deviceId = 'mumu-la-pluma',
  signalingUrl = DEFAULT_SIGNALING_PATH,
  videoRef,
  connectionPath = 'relay',
  ipPreference = 'ipv4',
  scrcpyOptions = {},
  passive = false
}: UseScrcpyWebRTCOptions) {
  const scrcpyOptionsRef = useRef(scrcpyOptions)
  useEffect(() => {
    scrcpyOptionsRef.current = scrcpyOptions
  }, [scrcpyOptions])
  const [status, setStatus] = useState<WebRTCStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<VideoStats | null>(null)
  const [inputReady, setInputReady] = useState(false)
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null)
  const [deviceSize, setDeviceSize] = useState({ width: 1080, height: 1920 })
  const wsRef = useRef<WebSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const inputChannelRef = useRef<RTCDataChannel | null>(null)
  const inputChannelCleanupRef = useRef<(() => void) | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }])
  const touchSeqRef = useRef(0)
  const connectionGenerationRef = useRef(0)
  const retryTimerRef = useRef<number | null>(null)
  const attemptTimeoutRef = useRef<number | null>(null)
  const authAbortControllerRef = useRef<AbortController | null>(null)
  const heartbeatTimerRef = useRef<number | null>(null)
  const offerTimeoutRef = useRef<number | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const hiddenDisconnectTimerRef = useRef<number | null>(null)
  const disconnectedByHiddenRef = useRef(false)
  const connectionIntentRef = useRef(false)
  const recoveryTimerRef = useRef<number | null>(null)
  const recoveryAttemptRef = useRef(0)
  const recoveryExhaustedRef = useRef(false)
  const recoveryInFlightRef = useRef(false)
  const disconnectGraceTimerRef = useRef<number | null>(null)
  const controlPlaneTimerRef = useRef<number | null>(null)
  const controlPlaneExpiredRef = useRef(false)
  const inputStableTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const connectRef = useRef<((signalingUrlOverride?: string) => void) | null>(null)
  const statusRef = useRef<WebRTCStatus>('idle')
  const pendingCommandsRef = useRef(new Map<string, {
    requestId: string
    resolve: (result: ScrcpyCommandResult) => void
    timer: number
  }>())
  const prevStatsRef = useRef({ timestamp: 0, bytesReceived: 0, framesDecoded: 0 })

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const sendForward = useCallback((payload: unknown) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ message_type: 'forward', device_id: deviceId, payload }))
    }
  }, [deviceId])

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
  }, [])

  const startHeartbeat = useCallback((ws: WebSocket) => {
    stopHeartbeat()
    heartbeatTimerRef.current = window.setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify({ type: 'ping' }))
      } catch {
        // The close handler will surface a failed signaling connection.
      }
    }, HEARTBEAT_INTERVAL_MS)
  }, [stopHeartbeat])

  const clearOfferTimeout = useCallback(() => {
    if (offerTimeoutRef.current !== null) {
      window.clearTimeout(offerTimeoutRef.current)
      offerTimeoutRef.current = null
    }
  }, [])

  const resolvePendingCommands = useCallback((error: string) => {
    const pending = pendingCommandsRef.current
    pendingCommandsRef.current = new Map()
    pending.forEach(entry => {
      window.clearTimeout(entry.timer)
      entry.resolve({ requestId: entry.requestId, success: false, error })
    })
  }, [])

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current !== null) {
      window.clearTimeout(recoveryTimerRef.current)
      recoveryTimerRef.current = null
    }
  }, [])

  const clearDisconnectGrace = useCallback(() => {
    if (disconnectGraceTimerRef.current !== null) {
      window.clearTimeout(disconnectGraceTimerRef.current)
      disconnectGraceTimerRef.current = null
    }
  }, [])

  const clearControlPlaneGrace = useCallback(() => {
    controlPlaneExpiredRef.current = false
    if (controlPlaneTimerRef.current !== null) {
      window.clearTimeout(controlPlaneTimerRef.current)
      controlPlaneTimerRef.current = null
    }
  }, [])

  const clearInputStableTimer = useCallback(() => {
    if (inputStableTimerRef.current !== null) {
      window.clearTimeout(inputStableTimerRef.current)
      inputStableTimerRef.current = null
    }
  }, [])

  const resetRecoveryBudget = useCallback(() => {
    recoveryAttemptRef.current = 0
    recoveryExhaustedRef.current = false
  }, [])

  const resetRecoveryState = useCallback(() => {
    resetRecoveryBudget()
    controlPlaneExpiredRef.current = false
    clearRecoveryTimer()
    clearDisconnectGrace()
    clearControlPlaneGrace()
    clearInputStableTimer()
  }, [clearControlPlaneGrace, clearDisconnectGrace, clearInputStableTimer, clearRecoveryTimer, resetRecoveryBudget])

  const scheduleRecovery = useCallback((force = false) => {
    if (!mountedRef.current || passive || !connectionIntentRef.current || document.hidden) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    if (recoveryTimerRef.current !== null) return
    if (IN_PROGRESS_STATUSES.includes(statusRef.current)) return
    if (!force && inputChannelRef.current?.readyState === 'open') {
      clearRecoveryTimer()
      clearControlPlaneGrace()
      return
    }
    if (recoveryExhaustedRef.current) return
    const attempt = recoveryAttemptRef.current
    if (attempt >= RECOVERY_DELAYS_MS.length) {
      recoveryExhaustedRef.current = true
      setError('预览连接已断开，请重新连接预览')
      setStatus('error')
      return
    }
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null
      if (!mountedRef.current || passive || !connectionIntentRef.current || document.hidden) return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      if (IN_PROGRESS_STATUSES.includes(statusRef.current)) return
      const pc = pcRef.current
      const channel = inputChannelRef.current
      const signalingHealthy = wsRef.current?.readyState === WebSocket.OPEN
      if (pc?.connectionState === 'connected' && pc.iceConnectionState !== 'failed' && signalingHealthy) {
        if (channel?.readyState === 'open') {
          clearRecoveryTimer()
          clearControlPlaneGrace()
          return
        }
        // The peer connection is healthy but the control plane is still being
        // negotiated; the control-plane grace decides instead of tearing down
        // a session that is about to become usable.
        if ((channel === null || channel.readyState === 'connecting') && !controlPlaneExpiredRef.current) return
      }
      if (pc && (pc.connectionState === 'new' || pc.connectionState === 'connecting')) return
      if (!force && channel?.readyState === 'open') {
        clearRecoveryTimer()
        clearControlPlaneGrace()
        return
      }
      recoveryAttemptRef.current += 1
      recoveryInFlightRef.current = true
      try {
        connectRef.current?.()
      } finally {
        recoveryInFlightRef.current = false
      }
    }, RECOVERY_DELAYS_MS[attempt])
  }, [clearControlPlaneGrace, clearRecoveryTimer, passive])

  const armControlPlaneGrace = useCallback(() => {
    if (!mountedRef.current || passive || !connectionIntentRef.current || document.hidden) return
    if (controlPlaneExpiredRef.current) {
      scheduleRecovery(true)
      return
    }
    if (controlPlaneTimerRef.current !== null) return
    controlPlaneTimerRef.current = window.setTimeout(() => {
      controlPlaneTimerRef.current = null
      if (!mountedRef.current || passive || !connectionIntentRef.current || document.hidden) return
      const pc = pcRef.current
      if (pc?.connectionState !== 'connected') return
      if (inputChannelRef.current?.readyState === 'open') return
      controlPlaneExpiredRef.current = true
      scheduleRecovery(true)
    }, CONTROL_PLANE_GRACE_MS)
  }, [passive, scheduleRecovery])

  const ensureConnectionHealth = useCallback(() => {
    if (passive || !connectionIntentRef.current || document.hidden) return
    if (IN_PROGRESS_STATUSES.includes(statusRef.current)) return
    if (statusRef.current === 'error' && inputChannelRef.current?.readyState !== 'open') {
      scheduleRecovery(true)
      return
    }
    // Permanent signaling/scrcpy errors set recoveryExhaustedRef, so a
    // transient transport failure can still recover after the page resumes.
    const pc = pcRef.current
    const channel = inputChannelRef.current
    if (!pc) {
      scheduleRecovery(true)
      return
    }
    if (pc.connectionState === 'connected') {
      if (pc.iceConnectionState === 'failed') {
        scheduleRecovery(true)
        return
      }
      const ws = wsRef.current
      if (ws?.readyState !== WebSocket.OPEN) {
        scheduleRecovery(true)
        return
      }
      if (channel?.readyState === 'open') return
      if (channel?.readyState === 'closed') {
        scheduleRecovery()
        return
      }
      armControlPlaneGrace()
      return
    }
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
      scheduleRecovery(true)
    }
  }, [armControlPlaneGrace, passive, scheduleRecovery])

  const filterSdpCandidates = useCallback((sdp: string, forceDropLoopback = false) => {
    return filterSdpCandidatesForPolicy(sdp, connectionPath, ipPreference, forceDropLoopback)
  }, [connectionPath, ipPreference])

  const sendAnswer = useCallback(() => {
    const pc = pcRef.current
    if (!pc?.localDescription) return
    sendForward({ type: 'answer', sdp: filterSdpCandidates(pc.localDescription.sdp || '', true) })
  }, [filterSdpCandidates, sendForward])

  const createPeerConnection = useCallback(() => {
    if (pcRef.current) return pcRef.current
    let pc: RTCPeerConnection
    try {
      pc = new RTCPeerConnection({
        iceServers: iceServersRef.current,
        iceTransportPolicy: connectionPath === 'relay' ? 'relay' : 'all'
      })
    } catch (error) {
      setError(`实时连接初始化失败: ${error instanceof Error ? error.message : String(error)}`)
      setStatus('error')
      throw error
    }
    pcRef.current = pc
    const stream = new MediaStream()
    streamRef.current = stream
    setMediaStream(stream)

    pc.ontrack = evt => {
      if (pcRef.current !== pc) return
      if (evt.track.kind !== 'video') return
      const stream = streamRef.current || new MediaStream()
      streamRef.current = stream
      if (!stream.getTracks().some(track => track.id === evt.track.id)) stream.addTrack(evt.track)
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        void video.play().catch(() => {})
      }
    }

    pc.onicecandidate = evt => {
      if (pcRef.current !== pc) return
      if (!evt.candidate) return
      const candidate = evt.candidate.candidate
      if (candidateIsLoopback(candidate)) return
      if (!shouldKeepCandidate(candidate, connectionPath, ipPreference)) return
      sendForward({
        type: 'ice-candidate',
        candidate: {
          candidate,
          sdpMid: evt.candidate.sdpMid,
          sdpMLineIndex: evt.candidate.sdpMLineIndex
        }
      })
    }

    pc.ondatachannel = evt => {
      if (pcRef.current !== pc) return
      if (evt.channel.label !== 'input-channel') return

      const channel = evt.channel
      inputChannelCleanupRef.current?.()
      inputChannelRef.current = channel
      inputChannelCleanupRef.current = bindInputChannelReadiness(channel, ready => {
        if (inputChannelRef.current !== channel) return
        setInputReady(ready)
        if (ready) {
          clearRecoveryTimer()
          clearControlPlaneGrace()
          clearInputStableTimer()
          // A brief open must not zero the retry budget; only a channel that
          // stays usable for a stability window counts as a successful recovery.
          inputStableTimerRef.current = window.setTimeout(() => {
            inputStableTimerRef.current = null
            if (inputChannelRef.current !== channel || channel.readyState !== 'open') return
            resetRecoveryBudget()
            clearRecoveryTimer()
            clearControlPlaneGrace()
          }, INPUT_STABLE_WINDOW_MS)
          if (pc.connectionState === 'connected') {
            setError(null)
            setStatus('connected')
          }
        } else {
          clearInputStableTimer()
        }
      }, () => {
        if (inputChannelRef.current !== channel) return
        scheduleRecovery()
      })
    }

    pc.oniceconnectionstatechange = () => {
      if (pcRef.current !== pc) return
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') setStatus('connected')
      if (pc.iceConnectionState === 'failed') {
        setError('ICE connection failed')
        setStatus('error')
        clearControlPlaneGrace()
        clearInputStableTimer()
        scheduleRecovery(true)
      }
    }

    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return
      if (pc.connectionState === 'connected') {
        clearDisconnectGrace()
        setStatus('connected')
        const channel = inputChannelRef.current
        if (channel?.readyState === 'open') {
          clearControlPlaneGrace()
          clearRecoveryTimer()
        } else if (channel?.readyState === 'closed') {
          clearControlPlaneGrace()
          scheduleRecovery()
        } else {
          armControlPlaneGrace()
        }
        return
      }
      if (pc.connectionState === 'failed') {
        setError('WebRTC connection failed')
        setStatus('error')
        clearControlPlaneGrace()
        clearInputStableTimer()
        scheduleRecovery(true)
        return
      }
      if (pc.connectionState === 'closed') {
        setStatus('disconnected')
        clearControlPlaneGrace()
        clearInputStableTimer()
        scheduleRecovery(true)
        return
      }
      if (pc.connectionState === 'disconnected') {
        setStatus('disconnected')
        clearControlPlaneGrace()
        clearInputStableTimer()
        if (disconnectGraceTimerRef.current === null) {
          disconnectGraceTimerRef.current = window.setTimeout(() => {
            disconnectGraceTimerRef.current = null
            if (pcRef.current !== pc || pc.connectionState === 'connected') return
            scheduleRecovery(true)
          }, DISCONNECT_GRACE_MS)
        }
      }
    }

    return pc
  }, [armControlPlaneGrace, clearControlPlaneGrace, clearDisconnectGrace, clearInputStableTimer, clearRecoveryTimer, connectionPath, ipPreference, resetRecoveryBudget, scheduleRecovery, sendForward, videoRef])

  const teardownConnection = useCallback(() => {
    stopHeartbeat()
    clearOfferTimeout()
    clearRecoveryTimer()
    clearDisconnectGrace()
    clearControlPlaneGrace()
    clearInputStableTimer()
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    resolvePendingCommands('连接已断开')
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (attemptTimeoutRef.current !== null) {
      window.clearTimeout(attemptTimeoutRef.current)
      attemptTimeoutRef.current = null
    }
    authAbortControllerRef.current?.abort()
    authAbortControllerRef.current = null
    inputChannelRef.current = null
    inputChannelCleanupRef.current?.()
    inputChannelCleanupRef.current = null
    setInputReady(false)
    const pc = pcRef.current
    pcRef.current = null
    if (pc) {
      pc.oniceconnectionstatechange = null
      pc.onconnectionstatechange = null
      pc.close()
    }
    const ws = wsRef.current
    wsRef.current = null
    if (ws && ws.readyState < WebSocket.CLOSING) ws.close()
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setMediaStream(null)
    if (videoRef.current) videoRef.current.srcObject = null
    prevStatsRef.current = { timestamp: 0, bytesReceived: 0, framesDecoded: 0 }
    setStats(null)
  }, [clearControlPlaneGrace, clearDisconnectGrace, clearInputStableTimer, clearOfferTimeout, clearRecoveryTimer, resolvePendingCommands, stopHeartbeat, videoRef])

  const disconnect = useCallback(() => {
    if (passive) return
    connectionIntentRef.current = false
    resetRecoveryState()
    disconnectedByHiddenRef.current = false
    if (hiddenDisconnectTimerRef.current !== null) {
      window.clearTimeout(hiddenDisconnectTimerRef.current)
      hiddenDisconnectTimerRef.current = null
    }
    connectionGenerationRef.current += 1
    teardownConnection()
    setError(null)
    setStatus('disconnected')
  }, [passive, resetRecoveryState, teardownConnection])

  const connect = useCallback((signalingUrlOverride?: string) => {
    if (passive) return
    connectionIntentRef.current = true
    // A user-initiated connect resets the recovery budget; an automatic
    // recovery keeps it so repeated failures still stop after three tries.
    if (!recoveryInFlightRef.current) resetRecoveryState()
    connectionGenerationRef.current += 1
    const generation = connectionGenerationRef.current
    const hadActiveConnection = Boolean(wsRef.current || pcRef.current)
    teardownConnection()
    const targetSignalingUrl = signalingUrlOverride || signalingUrl
    const requestedEndpoints = resolveSignalingEndpoints(targetSignalingUrl)
    const gatewayEndpoints = resolveSignalingEndpoints(DEFAULT_SIGNALING_PATH)
    let signalingEndpoints = requestedEndpoints
    try {
      if (new URL(requestedEndpoints.httpBase).origin !== window.location.origin) {
        signalingEndpoints = gatewayEndpoints
      }
    } catch {
      signalingEndpoints = gatewayEndpoints
    }
    setStatus('connecting')
    setError(null)

    const armProtocolTimeout = (message: string) => {
      clearOfferTimeout()
      offerTimeoutRef.current = window.setTimeout(() => {
        offerTimeoutRef.current = null
        if (connectionGenerationRef.current !== generation) return
        setError(message)
        setStatus('error')
        resolvePendingCommands(message)
      }, OFFER_TIMEOUT_MS)
    }

    const attemptConnection = (attemptIndex: number) => {
      if (connectionGenerationRef.current !== generation) return
      let attemptFinished = false
      let socket: WebSocket | null = null
      let attemptTimeout: number | null = null
      const authAbortController = new AbortController()
      authAbortControllerRef.current = authAbortController

      const clearAttemptResources = () => {
        if (attemptTimeout !== null) {
          window.clearTimeout(attemptTimeout)
          if (attemptTimeoutRef.current === attemptTimeout) attemptTimeoutRef.current = null
          attemptTimeout = null
        }
        if (authAbortControllerRef.current === authAbortController) authAbortControllerRef.current = null
        authAbortController.abort()
      }

      const finishStartupFailure = (reason: unknown) => {
        if (attemptFinished || connectionGenerationRef.current !== generation) return
        attemptFinished = true
        clearAttemptResources()
        stopHeartbeat()
        clearOfferTimeout()
        resolvePendingCommands('信令连接未建立')
        if (socket) {
          socket.onopen = null
          socket.onmessage = null
          socket.onerror = null
          socket.onclose = null
          if (wsRef.current === socket) wsRef.current = null
          if (socket.readyState < WebSocket.CLOSING) socket.close()
        }

        const retryDelay = SIGNALING_RETRY_DELAYS_MS[attemptIndex]
        if (retryDelay !== undefined) {
          setError(null)
          setStatus('connecting')
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null
            attemptConnection(attemptIndex + 1)
          }, retryDelay)
          return
        }

        setError(reason instanceof Error ? reason.message : '信令服务暂时不可用，请稍后重试')
        setStatus('error')
      }

      attemptTimeout = window.setTimeout(() => {
        finishStartupFailure(new Error('信令连接超时，请稍后重试'))
      }, SIGNALING_ATTEMPT_TIMEOUT_MS)
      attemptTimeoutRef.current = attemptTimeout

      void getSignalingToken(signalingEndpoints.httpBase, authAbortController.signal)
        .then(token => {
          if (attemptFinished || connectionGenerationRef.current !== generation) return
          const ws = new WebSocket(normalizeSignalingUrl(signalingEndpoints.websocketBase, token, deviceId))
          socket = ws
          wsRef.current = ws
          let opened = false

          ws.onopen = () => {
            if (connectionGenerationRef.current !== generation) {
              ws.close()
              return
            }
            opened = true
            attemptFinished = true
            clearAttemptResources()
            setError(null)
            setStatus('signaling')
            startHeartbeat(ws)
            ws.send(JSON.stringify({ message_type: 'connect', device_id: deviceId }))
            armProtocolTimeout('等待信令配置超时，请重新连接预览')
          }

          ws.onmessage = event => {
            if (connectionGenerationRef.current !== generation) return
            let msg: SignalingMessage
            try {
              msg = JSON.parse(event.data)
            } catch {
              setError('收到无效的信令消息')
              setStatus('error')
              return
            }
            const type = msg.message_type || msg.type
            if (type === 'pong') return
            if (type === 'config') {
              if (Array.isArray(msg.ice_servers) && msg.ice_servers.length > 0) iceServersRef.current = normalizeIceServers(msg.ice_servers)
              setStatus('waiting_offer')
              sendForward({
                type: 'request-offer',
                ip_preference: ipPreference,
                scrcpy_options: {
                  max_fps: 30,
                  max_size: 1280,
                  bitrate: 4000000,
                  min_bitrate: 1000000,
                  max_bitrate: 8000000,
                  bwe: true,
                  audio: false,
                  snapshot_interval: 10,
                  ...scrcpyOptionsRef.current
                }
              })
              clearOfferTimeout()
              armProtocolTimeout('等待设备画面超时，请重新连接预览')
              return
            }
            const display = msg.device_info?.displays?.[0]
            if (type === 'device_info' && display) {
              setDeviceSize({ width: display.x_res || 1080, height: display.y_res || 1920 })
              return
            }
            if (type === 'error') {
              clearOfferTimeout()
              clearRecoveryTimer()
              const message = msg.error || '信令服务返回错误'
              setError(message)
              setStatus('error')
              resolvePendingCommands(message)
              return
            }
            if (type !== 'device_msg' || !msg.payload?.type) return
            const payload = msg.payload
            if (payload.type === 'command_result') {
              const requestId = typeof payload.request_id === 'string' ? payload.request_id : ''
              const pending = pendingCommandsRef.current.get(requestId)
              if (pending) {
                window.clearTimeout(pending.timer)
                pendingCommandsRef.current.delete(requestId)
                pending.resolve(normalizeCommandResult(payload, requestId))
              }
              return
            }
            if (payload.type === 'scrcpy_error') {
              clearOfferTimeout()
              clearRecoveryTimer()
              const message = typeof payload.message === 'string' && payload.message
                ? payload.message
                : '设备端视频服务启动失败'
              setError(message)
              setStatus('error')
              resolvePendingCommands(message)
              const pc = pcRef.current
              pcRef.current = null
              if (pc) {
                pc.oniceconnectionstatechange = null
                pc.onconnectionstatechange = null
                pc.close()
              }
              inputChannelRef.current = null
              inputChannelCleanupRef.current?.()
              inputChannelCleanupRef.current = null
              setInputReady(false)
              streamRef.current?.getTracks().forEach(track => track.stop())
              streamRef.current = null
              setMediaStream(null)
              if (videoRef.current) videoRef.current.srcObject = null
              prevStatsRef.current = { timestamp: 0, bytesReceived: 0, framesDecoded: 0 }
              setStats(null)
              return
            }
            if (payload.type === 'offer') {
              clearOfferTimeout()
              setError(null)
              setStatus('connecting_webrtc')
              const pc = createPeerConnection()
              const isCurrentConnection = () => connectionGenerationRef.current === generation && pcRef.current === pc
              void (async () => {
                try {
                  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: filterSdpCandidates(payload.sdp) }))
                  if (!isCurrentConnection()) return
                  const answer = await pc.createAnswer()
                  if (!isCurrentConnection()) return
                  let sdp = answer.sdp || ''
                  if (/m=video 0/i.test(sdp)) {
                    setError('浏览器未接受视频流，请尝试其他浏览器或重新连接预览')
                    setStatus('error')
                    return
                  }
                  const answerBitrateBps = Math.max(
                    1_000_000,
                    scrcpyOptionsRef.current.max_bitrate || scrcpyOptionsRef.current.bitrate || 8_000_000
                  )
                  const answerBitrateKbps = Math.round(answerBitrateBps / 1000)
                  sdp = sdp.replace(/m=video ([1-9]\d* .*)\r\n/g, `m=video $1\r\nb=AS:${answerBitrateKbps}\r\n`)
                  sdp = sdp.replace(
                    /a=fmtp:(\d+) (.*)\r\n/g,
                    `a=fmtp:$1 $2;x-google-start-bitrate=${answerBitrateBps};x-google-max-bitrate=${answerBitrateBps}\r\n`
                  )
                  await pc.setLocalDescription(new RTCSessionDescription({ type: 'answer', sdp }))
                  if (!isCurrentConnection()) return
                  sendAnswer()
                } catch (err) {
                  if (!isCurrentConnection()) return
                  setError(`SDP 处理失败: ${err instanceof Error ? err.message : String(err)}`)
                  setStatus('error')
                }
              })()
            } else if (payload.type === 'ice-candidate' && payload.candidate) {
              const candidate = payload.candidate.candidate ?? ''
              if (candidateIsLoopback(candidate)) return
              if (!shouldKeepCandidate(candidate, connectionPath, ipPreference)) return
              void pcRef.current?.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {})
            }
          }

          ws.onerror = () => {
            if (!opened) finishStartupFailure(new Error('信令连接暂时不可用，请稍后重试'))
          }
          ws.onclose = event => {
            if (connectionGenerationRef.current !== generation) return
            stopHeartbeat()
            clearOfferTimeout()
            resolvePendingCommands('信令连接已中断')
            if (!opened) {
              finishStartupFailure(new Error(event.code === 1008 ? '信令认证失败，请稍后重试' : '信令连接暂时不可用，请稍后重试'))
              return
            }
            if (wsRef.current === ws) wsRef.current = null
            if (event.code === 1000) {
              setError(null)
              setStatus('disconnected')
            } else {
              setError('信令连接已中断，请重新启动预览')
              setStatus('error')
            }
          }
        })
        .catch(finishStartupFailure)
    }

    const beginConnection = () => {
      if (connectionGenerationRef.current !== generation) return
      attemptConnection(0)
    }

    if (hadActiveConnection) {
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        beginConnection()
      }, RECONNECT_DELAY_MS)
    } else {
      beginConnection()
    }
  }, [clearOfferTimeout, clearRecoveryTimer, connectionPath, createPeerConnection, deviceId, filterSdpCandidates, ipPreference, passive, resetRecoveryState, resolvePendingCommands, sendAnswer, sendForward, signalingUrl, startHeartbeat, stopHeartbeat, teardownConnection, videoRef])

  // Recovery timers run outside React's render cycle; keep them pointed at the
  // latest connect closure without threading it through every peer callback.
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const sendTouch = useCallback((action: number, clientX: number, clientY: number, id = 0, targetVideo?: HTMLVideoElement | null) => {
    const channel = inputChannelRef.current
    const video = targetVideo || videoRef.current
    if (!channel || channel.readyState !== 'open') return false
    if (isTouchMoveBackpressured(action, channel.bufferedAmount)) return false

    const isRelease = action === 1 || action === 3
    const sendTouchPacket = (x: number, y: number, w: number, h: number) => {
      try {
        channel.send(JSON.stringify({
          type: 'touch',
          id,
          seq: ++touchSeqRef.current,
          client_ts_ms: Date.now(),
          action,
          x,
          y,
          w,
          h
        }))
        return true
      } catch {
        return false
      }
    }
    const sendReleaseFallback = () => sendTouchPacket(0, 0, deviceSize.width, deviceSize.height)

    if (!video || !video.videoWidth || !video.videoHeight) {
      return isRelease ? sendReleaseFallback() : false
    }

    const rect = video.getBoundingClientRect()
    if (!rect.width || !rect.height) return isRelease ? sendReleaseFallback() : false
    const geometry = getRenderedVideoGeometry(rect.width, rect.height, video.videoWidth, video.videoHeight)
    if (!geometry) return isRelease ? sendReleaseFallback() : false
    const { actualW, actualH, offsetX, offsetY } = geometry

    const { width: targetW, height: targetH } = resolveTouchTargetSize(
      deviceSize.width,
      deviceSize.height,
      video.videoWidth,
      video.videoHeight
    )
    const relativeX = clientX - rect.left - offsetX
    const relativeY = clientY - rect.top - offsetY
    if (action === 0 && !isPointInsideRenderedVideo(clientX, clientY, rect, geometry)) return false

    const x = Math.max(0, Math.min(targetW - 1, Math.round(relativeX / actualW * targetW)))
    const y = Math.max(0, Math.min(targetH - 1, Math.round(relativeY / actualH * targetH)))
    return sendTouchPacket(x, y, targetW, targetH)
  }, [deviceSize.height, deviceSize.width, videoRef])

  const sendScroll = useCallback((deltaX: number, deltaY: number, clientX: number, clientY: number, targetVideo?: HTMLVideoElement | null) => {
    const channel = inputChannelRef.current
    const video = targetVideo || videoRef.current
    if (!channel || channel.readyState !== 'open') return false
    if (!video || !video.videoWidth || !video.videoHeight) return false
    const rect = video.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    const geometry = getRenderedVideoGeometry(rect.width, rect.height, video.videoWidth, video.videoHeight)
    if (!geometry) return false
    if (!isPointInsideRenderedVideo(clientX, clientY, rect, geometry)) return false
    const { actualW, actualH, offsetX, offsetY } = geometry
    const { width: targetW, height: targetH } = resolveTouchTargetSize(
      deviceSize.width,
      deviceSize.height,
      video.videoWidth,
      video.videoHeight
    )
    const x = Math.max(0, Math.min(targetW - 1, Math.round((clientX - rect.left - offsetX) / actualW * targetW)))
    const y = Math.max(0, Math.min(targetH - 1, Math.round((clientY - rect.top - offsetY) / actualH * targetH)))
    try {
      channel.send(JSON.stringify({
        type: 'scroll',
        x,
        y,
        w: targetW,
        h: targetH,
        hscroll: deltaX,
        vscroll: deltaY,
        buttons: 0,
        client_ts_ms: Date.now()
      }))
      return true
    } catch {
      return false
    }
  }, [deviceSize.height, deviceSize.width, videoRef])

  const sendCommand = useCallback((command: string): Promise<ScrcpyCommandResult> => {
    const ws = wsRef.current
    if (ws?.readyState !== WebSocket.OPEN) {
      return Promise.resolve({
        requestId: '',
        success: false,
        error: '信令连接未就绪'
      })
    }

    const requestId = Math.random().toString(36).slice(2)
    return new Promise<ScrcpyCommandResult>(resolve => {
      const timer = window.setTimeout(() => {
        pendingCommandsRef.current.delete(requestId)
        resolve({ requestId, success: false, error: '命令执行超时' })
      }, COMMAND_TIMEOUT_MS)
      pendingCommandsRef.current.set(requestId, { requestId, resolve, timer })

      try {
        ws.send(JSON.stringify({
          message_type: 'command',
          device_id: deviceId,
          request_id: requestId,
          command
        }))
      } catch {
        window.clearTimeout(timer)
        pendingCommandsRef.current.delete(requestId)
        resolve({ requestId, success: false, error: '命令发送失败' })
      }
    })
  }, [deviceId])

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const pc = pcRef.current
      if (!pc) return
      const reports = await pc.getStats().catch(() => null)
      if (!reports) return
      let rtt = 0
      for (const report of reports.values()) {
        if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.selected || report.nominated)) {
          rtt = (report.currentRoundTripTime || 0) * 1000
          break
        }
      }
      for (const report of reports.values()) {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          const previous = prevStatsRef.current
          const dt = previous.timestamp ? (report.timestamp - previous.timestamp) / 1000 : 0
          const fps = dt > 0 ? ((report.framesDecoded - previous.framesDecoded) / dt).toFixed(0) : 0
          const bitrate = dt > 0 ? (((report.bytesReceived - previous.bytesReceived) * 8) / dt / 1000).toFixed(0) : 0
          prevStatsRef.current = { timestamp: report.timestamp, bytesReceived: report.bytesReceived, framesDecoded: report.framesDecoded }
          const video = videoRef.current
          const track = streamRef.current?.getVideoTracks()[0]
          setStats({
            fps,
            bitrate,
            rtt: rtt.toFixed(0),
            width: video?.videoWidth || 0,
            height: video?.videoHeight || 0,
            videoLive: track?.readyState === 'live' && !track.muted,
            iceState: pc.iceConnectionState || 'unknown'
          })
          break
        }
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [inputReady, videoRef])

  const suspendForHidden = useCallback(() => {
    if (!connectionIntentRef.current) return
    connectionGenerationRef.current += 1
    teardownConnection()
    setError(null)
    setStatus('disconnected')
  }, [teardownConnection])

  const scheduleHiddenDisconnect = useCallback(() => {
    if (!connectionIntentRef.current) return
    if (hiddenDisconnectTimerRef.current !== null) return
    hiddenDisconnectTimerRef.current = window.setTimeout(() => {
      hiddenDisconnectTimerRef.current = null
      if (!connectionIntentRef.current) return
      disconnectedByHiddenRef.current = true
      suspendForHidden()
    }, PREVIEW_HIDDEN_DISCONNECT_MS)
  }, [suspendForHidden])

  const cancelHiddenDisconnect = useCallback(() => {
    if (hiddenDisconnectTimerRef.current !== null) {
      window.clearTimeout(hiddenDisconnectTimerRef.current)
      hiddenDisconnectTimerRef.current = null
    }
  }, [])

  // 工作区被 Activity 隐藏或浏览器切到后台时不要立刻断开：保留媒体
  // 连接三分钟，返回时取消回收；超过宽限才释放，避免频繁重启设备 Agent。
  useEffect(() => {
    if (passive) return undefined
    cancelHiddenDisconnect()
    if (disconnectedByHiddenRef.current) {
      disconnectedByHiddenRef.current = false
      queueMicrotask(() => connect())
    }
    return () => scheduleHiddenDisconnect()
  }, [cancelHiddenDisconnect, connect, passive, scheduleHiddenDisconnect])

  useEffect(() => {
    if (passive) return undefined
    const handleResume = () => {
      if (document.hidden) return
      cancelHiddenDisconnect()
      if (!connectionIntentRef.current) return
      if (disconnectedByHiddenRef.current) {
        disconnectedByHiddenRef.current = false
        connect()
        return
      }
      // iOS/Android 可能冻结后台页面，visibilitychange 和 3 分钟定时器
      // 都不可靠；回到前台时主动验证控制通道，失效就重新协商。
      ensureConnectionHealth()
    }
    const handleVisibility = () => {
      if (document.hidden) {
        scheduleHiddenDisconnect()
        return
      }
      handleResume()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pageshow', handleResume)
    window.addEventListener('online', handleResume)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pageshow', handleResume)
      window.removeEventListener('online', handleResume)
    }
  }, [cancelHiddenDisconnect, connect, ensureConnectionHealth, passive, scheduleHiddenDisconnect])

  useEffect(() => {
    if (passive) return undefined
    const timer = window.setInterval(() => {
      if (!mountedRef.current || document.hidden || !connectionIntentRef.current) return
      if (IN_PROGRESS_STATUSES.includes(statusRef.current)) return
      const pc = pcRef.current
      const channel = inputChannelRef.current
      if (statusRef.current === 'error' && channel?.readyState !== 'open') {
        scheduleRecovery(true)
        return
      }
      if (!pc) {
        // A failed recovery that stops before creating a PeerConnection leaves
        // status in 'error'; keep retrying until the shared budget is spent.
        if (statusRef.current === 'disconnected' || (statusRef.current === 'error' && !recoveryExhaustedRef.current)) {
          scheduleRecovery(true)
        }
        return
      }
      if (pc.connectionState === 'connected') {
        if (pc.iceConnectionState === 'failed') {
          scheduleRecovery(true)
          return
        }
        const ws = wsRef.current
        if (ws?.readyState !== WebSocket.OPEN) {
          scheduleRecovery(true)
          return
        }
        if (channel?.readyState === 'closed') {
          scheduleRecovery()
          return
        }
        if (channel?.readyState !== 'open') armControlPlaneGrace()
        return
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        scheduleRecovery(true)
      }
    }, CONNECTION_HEALTH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [armControlPlaneGrace, passive, scheduleRecovery])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearRecoveryTimer()
      clearDisconnectGrace()
      clearControlPlaneGrace()
      clearInputStableTimer()
    }
  }, [clearControlPlaneGrace, clearDisconnectGrace, clearInputStableTimer, clearRecoveryTimer])

  return { status, error, stats, inputReady, mediaStream, connect, disconnect, sendTouch, sendScroll, sendCommand }
}
