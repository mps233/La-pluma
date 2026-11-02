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
}

export interface VideoStats {
  fps: string | number
  bitrate: string | number
  rtt: string | number
  connectionType: string
  lostCount: number
  width: number
  height: number
  videoReadyState: number
  videoLive: boolean
  iceState: RTCIceConnectionState | 'unknown'
  peerState: RTCPeerConnectionState | 'unknown'
  signalingState: RTCSignalingState | 'unknown'
  inputReady: boolean
}

const DEFAULT_SIGNALING_PATH = '/webrtc-signaling'
const SIGNALING_RETRY_DELAYS_MS = [300, 800]
const SIGNALING_ATTEMPT_TIMEOUT_MS = 4000
const INPUT_CHANNEL_BACKPRESSURE_BYTES = 64 * 1024
const HEARTBEAT_INTERVAL_MS = 20_000
const OFFER_TIMEOUT_MS = 15_000
const RECONNECT_DELAY_MS = 800
const COMMAND_TIMEOUT_MS = 12_000

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

export function bindInputChannelReadiness(channel: RTCDataChannel, onChange: (ready: boolean) => void) {
  channel.bufferedAmountLowThreshold = INPUT_CHANNEL_BACKPRESSURE_BYTES / 2
  const update = () => onChange(channel.readyState === 'open')
  channel.onopen = update
  channel.onclose = update
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

function normalizeSignalingUrl(websocketBase: string, token: string) {
  return `${websocketBase}/connect_client?token=${encodeURIComponent(token)}`
}

function candidateHasIpv6(candidate: string) {
  return candidate.split(/\s+/).some(part => !part.startsWith('candidate:') && part.includes(':') && part.split(':').length >= 3)
}

function candidateHasIpv4(candidate: string) {
  return candidate.split(/\s+/).some(part => part.split('.').length === 4)
}

function shouldKeepCandidate(candidate: string, connectionPath: 'auto' | 'relay' | 'direct', ipPreference: 'auto' | 'ipv4' | 'ipv6') {
  if (!candidate) return false
  const isRelay = candidate.includes(' typ relay')
  if (connectionPath === 'relay' && !isRelay) return false
  if (connectionPath === 'direct' && isRelay) return false
  if (ipPreference === 'ipv4' && candidateHasIpv6(candidate)) return false
  if (ipPreference === 'ipv6' && candidateHasIpv4(candidate)) return false
  return true
}

export function useScrcpyWebRTC({
  deviceId = 'mumu-la-pluma',
  signalingUrl = DEFAULT_SIGNALING_PATH,
  videoRef,
  connectionPath = 'relay',
  ipPreference = 'ipv4',
  scrcpyOptions = {}
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
  const pendingCommandsRef = useRef(new Map<string, {
    requestId: string
    resolve: (result: ScrcpyCommandResult) => void
    timer: number
  }>())
  const prevStatsRef = useRef({ timestamp: 0, bytesReceived: 0, framesDecoded: 0 })

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

  const filterSdpCandidates = useCallback((sdp: string) => {
    return sdp.split('\r\n').filter(line => {
      if (!line.startsWith('a=candidate:')) return true
      return shouldKeepCandidate(line, connectionPath, ipPreference)
    }).join('\r\n')
  }, [connectionPath, ipPreference])

  const sendAnswer = useCallback(() => {
    const pc = pcRef.current
    if (!pc?.localDescription) return
    sendForward({ type: 'answer', sdp: filterSdpCandidates(pc.localDescription.sdp || '') })
  }, [filterSdpCandidates, sendForward])

  const createPeerConnection = useCallback(() => {
    if (pcRef.current) return pcRef.current
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceTransportPolicy: connectionPath === 'relay' ? 'relay' : 'all'
    })
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
      })
    }

    pc.oniceconnectionstatechange = () => {
      if (pcRef.current !== pc) return
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') setStatus('connected')
      if (pc.iceConnectionState === 'failed') {
        setError('ICE connection failed')
        setStatus('error')
      }
    }

    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return
      if (pc.connectionState === 'connected') setStatus('connected')
      if (pc.connectionState === 'failed') {
        setError('WebRTC connection failed')
        setStatus('error')
      }
      if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') setStatus('disconnected')
    }

    return pc
  }, [connectionPath, ipPreference, sendForward, videoRef])

  const teardownConnection = useCallback(() => {
    stopHeartbeat()
    clearOfferTimeout()
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
  }, [clearOfferTimeout, resolvePendingCommands, stopHeartbeat, videoRef])

  const disconnect = useCallback(() => {
    connectionGenerationRef.current += 1
    teardownConnection()
    setError(null)
    setStatus('disconnected')
  }, [teardownConnection])

  const connect = useCallback((signalingUrlOverride?: string) => {
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
          const ws = new WebSocket(normalizeSignalingUrl(signalingEndpoints.websocketBase, token))
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
              if (Array.isArray(msg.ice_servers) && msg.ice_servers.length > 0) iceServersRef.current = msg.ice_servers
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
  }, [clearOfferTimeout, connectionPath, createPeerConnection, deviceId, filterSdpCandidates, ipPreference, resolvePendingCommands, sendAnswer, sendForward, signalingUrl, startHeartbeat, stopHeartbeat, teardownConnection, videoRef])

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
      let connectionType = 'UDP p2p'
      for (const report of reports.values()) {
        if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.selected || report.nominated)) {
          rtt = (report.currentRoundTripTime || 0) * 1000
          const local = reports.get(report.localCandidateId)
          if (local?.candidateType === 'relay') connectionType = `${(local.protocol || 'udp').toUpperCase()} relay`
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
            connectionType,
            lostCount: report.packetsLost || 0,
            width: video?.videoWidth || 0,
            height: video?.videoHeight || 0,
            videoReadyState: video?.readyState || 0,
            videoLive: track?.readyState === 'live' && !track.muted,
            iceState: pc.iceConnectionState || 'unknown',
            peerState: pc.connectionState || 'unknown',
            signalingState: pc.signalingState || 'unknown',
            inputReady
          })
          break
        }
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [inputReady, videoRef])

  useEffect(() => disconnect, [disconnect])

  return { status, error, stats, inputReady, mediaStream, connect, disconnect, sendTouch, sendCommand }
}
