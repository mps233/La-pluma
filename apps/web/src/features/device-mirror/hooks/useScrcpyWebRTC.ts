import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithAuth } from '@/shared/api'
import { createTouchInput } from '../model/touchInput'
export { getRenderedVideoGeometry, isPointInsideRenderedVideo, isTouchMoveBackpressured } from '../model/touchInput'
import { sampleWebRTCStats, type WebRTCStatsCounters, type WebRTCStatsMetrics } from '../model/webrtcStats'

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
}

interface UseScrcpyWebRTCOptions {
  deviceId?: string
  signalingUrl?: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  connectionPath?: 'auto' | 'relay' | 'direct'
  ipPreference?: 'auto' | 'ipv4' | 'ipv6'
  scrcpyOptions?: ScrcpyOptions
  statsEnabled?: boolean
}

interface VideoStats extends WebRTCStatsMetrics {
  width: number
  height: number
  videoReadyState: number
  videoLive: boolean
  iceState: RTCIceConnectionState | 'unknown'
  peerState: RTCPeerConnectionState | 'unknown'
  signalingState: RTCSignalingState | 'unknown'
  inputReady: boolean
}

function isSameVideoStats(previous: VideoStats | null, next: VideoStats): boolean {
  if (!previous) return false
  return previous.fps === next.fps
    && previous.bitrate === next.bitrate
    && previous.rtt === next.rtt
    && previous.connectionType === next.connectionType
    && previous.lostCount === next.lostCount
    && previous.jitterBufferMs === next.jitterBufferMs
    && previous.decodeMs === next.decodeMs
    && previous.width === next.width
    && previous.height === next.height
    && previous.videoReadyState === next.videoReadyState
    && previous.videoLive === next.videoLive
    && previous.iceState === next.iceState
    && previous.peerState === next.peerState
    && previous.signalingState === next.signalingState
    && previous.inputReady === next.inputReady
}

const SIGNALING_TOKEN_KEY = 'scrcpy_webrtc_auth_token'
const DEFAULT_SIGNALING_PATH = '/webrtc-signaling'
const SIGNALING_RETRY_DELAYS_MS = [300, 800]
const SIGNALING_ATTEMPT_TIMEOUT_MS = 4000
const SIGNALING_PHASE_TIMEOUT_MS = 12000
const WEBRTC_MEDIA_TIMEOUT_MS = 20000
const INPUT_CHANNEL_BACKPRESSURE_BYTES = 64 * 1024
const SCRCPY_ERROR_FALLBACK = 'scrcpy 预览服务返回错误，请重新启动预览'
const SCRCPY_ERROR_MAX_LENGTH = 300

interface SignalingEndpoints {
  httpBase: string
  websocketBase: string
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

function usesSameOriginGateway(httpBase: string) {
  return new URL(`${httpBase}/api/login`).toString()
    === new URL(`${DEFAULT_SIGNALING_PATH}/api/login`, window.location.href).toString()
}

async function getSignalingToken(httpBase: string, signal: AbortSignal) {
  // The signaling server can restart between previews, invalidating its old token.
  window.localStorage.removeItem(SIGNALING_TOKEN_KEY)
  const loginUrl = `${httpBase}/api/login`
  let response: Response
  try {
    response = usesSameOriginGateway(httpBase)
      ? await fetchWithAuth(loginUrl, {
          method: 'POST',
          cache: 'no-store',
          signal
        })
      : await fetch(loginUrl, {
          method: 'POST',
          cache: 'no-store',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'admin123' })
        })
  } catch {
    throw new Error('暂时无法连接信令服务')
  }
  if (!response.ok) throw new Error(`信令服务登录失败 (HTTP ${response.status})`)
  const data = await response.json().catch(() => null)
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (typeof data?.token !== 'string' || !data.token.trim()) throw new Error('信令服务返回了无效凭证')
  window.localStorage.setItem(SIGNALING_TOKEN_KEY, data.token)
  return data.token as string
}

function normalizeSignalingUrl(websocketBase: string, token: string, deviceId?: string) {
  const deviceQuery = deviceId ? `&deviceId=${encodeURIComponent(deviceId)}` : ''
  return `${websocketBase}/connect_client?token=${encodeURIComponent(token)}${deviceQuery}`
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

function readScrcpyErrorMessage(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return SCRCPY_ERROR_FALLBACK
  const message = (payload as { message?: unknown }).message
  if (typeof message !== 'string') return SCRCPY_ERROR_FALLBACK
  const firstLine = message.trim().split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (!firstLine) return SCRCPY_ERROR_FALLBACK
  return firstLine.length > SCRCPY_ERROR_MAX_LENGTH
    ? `${firstLine.slice(0, SCRCPY_ERROR_MAX_LENGTH)}…`
    : firstLine
}

export function useScrcpyWebRTC({
  deviceId = 'mumu-la-pluma',
  signalingUrl = DEFAULT_SIGNALING_PATH,
  videoRef,
  connectionPath = 'relay',
  ipPreference = 'ipv4',
  scrcpyOptions = {},
  statsEnabled = true
}: UseScrcpyWebRTCOptions) {
  const scrcpyOptionsRef = useRef(scrcpyOptions)
  useEffect(() => {
    scrcpyOptionsRef.current = scrcpyOptions
  }, [scrcpyOptions])
  const [status, setStatus] = useState<WebRTCStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<VideoStats | null>(null)
  const [channelReady, setChannelReady] = useState(false)
  const [deviceInfoReady, setDeviceInfoReady] = useState(false)
  const inputReady = channelReady && deviceInfoReady
  const [touchInput] = useState(createTouchInput)
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const inputChannelRef = useRef<RTCDataChannel | null>(null)
  const inputChannelCleanupRef = useRef<(() => void) | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const attachedVideoRef = useRef<HTMLVideoElement | null>(null)
  const trackCleanupRef = useRef<(() => void)[]>([])
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }])
  const connectionGenerationRef = useRef(0)
  const retryTimerRef = useRef<number | null>(null)
  const attemptTimeoutRef = useRef<number | null>(null)
  const connectionTimeoutRef = useRef<number | null>(null)
  const authAbortControllerRef = useRef<AbortController | null>(null)
  const prevStatsRef = useRef<WebRTCStatsCounters | null>(null)

  const sendForward = useCallback((payload: unknown) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ message_type: 'forward', device_id: deviceId, payload }))
        return true
      } catch {
        return false
      }
    }
    return false
  }, [deviceId])

  const filterSdpCandidates = useCallback((sdp: string) => {
    return sdp.split('\r\n').filter(line => {
      if (!line.startsWith('a=candidate:')) return true
      return shouldKeepCandidate(line, connectionPath, ipPreference)
    }).join('\r\n')
  }, [connectionPath, ipPreference])

  const sendAnswer = useCallback((pc: RTCPeerConnection) => {
    if (pcRef.current !== pc || !pc.localDescription) return false
    return sendForward({ type: 'answer', sdp: filterSdpCandidates(pc.localDescription.sdp || '') })
  }, [filterSdpCandidates, sendForward])

  const teardownConnection = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (attemptTimeoutRef.current !== null) {
      window.clearTimeout(attemptTimeoutRef.current)
      attemptTimeoutRef.current = null
    }
    if (connectionTimeoutRef.current !== null) {
      window.clearTimeout(connectionTimeoutRef.current)
      connectionTimeoutRef.current = null
    }
    authAbortControllerRef.current?.abort()
    authAbortControllerRef.current = null
    inputChannelCleanupRef.current?.()
    inputChannelCleanupRef.current = null
    touchInput.reset()
    setDeviceInfoReady(false)
    const channel = inputChannelRef.current
    inputChannelRef.current = null
    channel?.close()
    setChannelReady(false)
    trackCleanupRef.current.forEach(cleanup => cleanup())
    trackCleanupRef.current = []
    const pc = pcRef.current
    pcRef.current = null
    const tracks = new Set(streamRef.current?.getTracks())
    if (pc) {
      pc.ontrack = null
      pc.onicecandidate = null
      pc.ondatachannel = null
      pc.oniceconnectionstatechange = null
      pc.onconnectionstatechange = null
      pc.getReceivers().forEach(receiver => {
        if (receiver.track) tracks.add(receiver.track)
      })
      pc.close()
    }
    const ws = wsRef.current
    wsRef.current = null
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      if (ws.readyState < WebSocket.CLOSING) ws.close()
    }
    tracks.forEach(track => track.stop())
    streamRef.current = null
    setMediaStream(null)
    if (attachedVideoRef.current) attachedVideoRef.current.srcObject = null
    attachedVideoRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    prevStatsRef.current = null
    setStats(null)
  }, [touchInput, videoRef])

  const finishConnection = useCallback((generation: number, nextStatus: 'error' | 'disconnected', message: string | null) => {
    if (connectionGenerationRef.current !== generation) return
    connectionGenerationRef.current += 1
    teardownConnection()
    setError(message)
    setStatus(nextStatus)
  }, [teardownConnection])

  const armConnectionTimeout = useCallback((generation: number, delay: number, message: string) => {
    if (connectionTimeoutRef.current !== null) window.clearTimeout(connectionTimeoutRef.current)
    connectionTimeoutRef.current = window.setTimeout(() => {
      connectionTimeoutRef.current = null
      finishConnection(generation, 'error', message)
    }, delay)
  }, [finishConnection])

  const createPeerConnection = useCallback((generation: number) => {
    if (pcRef.current) return pcRef.current
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceTransportPolicy: connectionPath === 'relay' ? 'relay' : 'all'
    })
    pcRef.current = pc
    const stream = new MediaStream()
    streamRef.current = stream
    setMediaStream(stream)
    const isCurrentConnection = () => connectionGenerationRef.current === generation && pcRef.current === pc
    const markConnected = () => {
      if (!isCurrentConnection()) return
      const peerConnected = pc.connectionState === 'connected' || ['connected', 'completed'].includes(pc.iceConnectionState)
      const hasLiveVideo = stream.getVideoTracks().some(track => track.readyState === 'live' && !track.muted)
      if (!peerConnected || !hasLiveVideo) return
      if (connectionTimeoutRef.current !== null) window.clearTimeout(connectionTimeoutRef.current)
      connectionTimeoutRef.current = null
      setStatus('connected')
    }

    pc.ontrack = evt => {
      if (!isCurrentConnection() || evt.track.kind !== 'video') {
        evt.track.stop()
        return
      }
      if (!stream.getTracks().some(track => track.id === evt.track.id)) {
        stream.addTrack(evt.track)
        const onEnded = () => finishConnection(generation, 'error', '预览视频流已中断，请重新启动预览')
        evt.track.addEventListener('unmute', markConnected)
        evt.track.addEventListener('ended', onEnded)
        trackCleanupRef.current.push(() => {
          evt.track.removeEventListener('unmute', markConnected)
          evt.track.removeEventListener('ended', onEnded)
        })
      }
      const video = videoRef.current
      if (video) {
        attachedVideoRef.current = video
        video.srcObject = stream
        void video.play().catch(() => {})
      }
      markConnected()
    }

    pc.onicecandidate = evt => {
      if (!isCurrentConnection() || !evt.candidate) return
      const candidate = evt.candidate.candidate
      if (!shouldKeepCandidate(candidate, connectionPath, ipPreference)) return
      if (!sendForward({
        type: 'ice-candidate',
        candidate: {
          candidate,
          sdpMid: evt.candidate.sdpMid,
          sdpMLineIndex: evt.candidate.sdpMLineIndex
        }
      })) finishConnection(generation, 'error', '信令连接已中断，请重新启动预览')
    }

    pc.ondatachannel = evt => {
      if (!isCurrentConnection() || evt.channel.label !== 'input-channel') {
        evt.channel.close()
        return
      }
      const channel = evt.channel
      inputChannelCleanupRef.current?.()
      touchInput.setChannel(channel)
      if (inputChannelRef.current !== channel) inputChannelRef.current?.close()
      inputChannelRef.current = channel
      inputChannelCleanupRef.current = bindInputChannelReadiness(channel, ready => {
        if (!isCurrentConnection() || inputChannelRef.current !== channel) return
        setChannelReady(ready)
      })
    }

    pc.oniceconnectionstatechange = () => {
      if (!isCurrentConnection()) return
      if (pc.iceConnectionState === 'failed') {
        finishConnection(generation, 'error', 'ICE connection failed')
        return
      }
      markConnected()
    }
    pc.onconnectionstatechange = () => {
      if (!isCurrentConnection()) return
      if (pc.connectionState === 'failed') {
        finishConnection(generation, 'error', 'WebRTC connection failed')
        return
      }
      if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        finishConnection(generation, 'disconnected', null)
        return
      }
      markConnected()
    }
    return pc
  }, [connectionPath, finishConnection, ipPreference, sendForward, touchInput, videoRef])

  const disconnect = useCallback(() => {
    connectionGenerationRef.current += 1
    teardownConnection()
    setError(null)
    setStatus('disconnected')
  }, [teardownConnection])

  const connect = useCallback((signalingUrlOverride?: string) => {
    connectionGenerationRef.current += 1
    const generation = connectionGenerationRef.current
    teardownConnection()
    const targetSignalingUrl = signalingUrlOverride || signalingUrl
    const signalingEndpoints = resolveSignalingEndpoints(targetSignalingUrl)
    setStatus('connecting')
    setError(null)

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
        if (socket) {
          socket.onopen = null
          socket.onmessage = null
          socket.onerror = null
          socket.onclose = null
          if (wsRef.current === socket) wsRef.current = null
          if (socket.readyState < WebSocket.CLOSING) socket.close()
        }
        window.localStorage.removeItem(SIGNALING_TOKEN_KEY)

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

        finishConnection(generation, 'error', reason instanceof Error ? reason.message : '信令服务暂时不可用，请稍后重试')
      }

      attemptTimeout = window.setTimeout(() => {
        finishStartupFailure(new Error('信令连接超时，请稍后重试'))
      }, SIGNALING_ATTEMPT_TIMEOUT_MS)
      attemptTimeoutRef.current = attemptTimeout

      void getSignalingToken(signalingEndpoints.httpBase, authAbortController.signal)
        .then(token => {
          if (attemptFinished || connectionGenerationRef.current !== generation) return
          const ws = new WebSocket(normalizeSignalingUrl(
            signalingEndpoints.websocketBase,
            token,
            usesSameOriginGateway(signalingEndpoints.httpBase) ? deviceId : undefined
          ))
          socket = ws
          wsRef.current = ws
          let opened = false
          const isCurrentSocket = () => connectionGenerationRef.current === generation && wsRef.current === ws

          ws.onopen = () => {
            if (attemptFinished || !isCurrentSocket()) {
              ws.close()
              return
            }
            opened = true
            attemptFinished = true
            clearAttemptResources()
            setError(null)
            setStatus('signaling')
            armConnectionTimeout(generation, SIGNALING_PHASE_TIMEOUT_MS, '等待信令配置超时，请重新启动预览')
            try {
              ws.send(JSON.stringify({ message_type: 'connect', device_id: deviceId }))
            } catch {
              finishConnection(generation, 'error', '信令连接已中断，请重新启动预览')
            }
          }

          ws.onmessage = event => {
            if (!opened || !isCurrentSocket()) return
            let msg: any
            try {
              msg = JSON.parse(event.data)
              if (!msg || typeof msg !== 'object') throw new Error('Invalid signaling message')
            } catch {
              finishConnection(generation, 'error', '收到无效的信令消息')
              return
            }
            const type = msg.message_type || msg.type
            if (type === 'config') {
              if (Array.isArray(msg.ice_servers) && msg.ice_servers.length > 0) iceServersRef.current = msg.ice_servers
              setStatus('waiting_offer')
              armConnectionTimeout(generation, SIGNALING_PHASE_TIMEOUT_MS, '等待设备预览响应超时，请重新启动预览')
              if (!sendForward({
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
              })) finishConnection(generation, 'error', '信令连接已中断，请重新启动预览')
              return
            }
            if (type === 'device_info') {
              const display = msg.device_info?.displays?.[0]
              setDeviceInfoReady(touchInput.setDeviceSize(display?.x_res, display?.y_res))
              return
            }
            if (type === 'error') {
              finishConnection(generation, 'error', msg.error || '信令服务返回错误')
              return
            }
            if (type !== 'device_msg' || !msg.payload?.type) return
            const payload = msg.payload
            if (payload.type === 'offer') {
              setStatus('connecting_webrtc')
              armConnectionTimeout(generation, WEBRTC_MEDIA_TIMEOUT_MS, '建立预览视频连接超时，请重新启动预览')
              let pc: RTCPeerConnection
              try {
                pc = createPeerConnection(generation)
              } catch (err) {
                finishConnection(generation, 'error', `无法创建 WebRTC 连接: ${err instanceof Error ? err.message : String(err)}`)
                return
              }
              const isCurrentConnection = () => connectionGenerationRef.current === generation && pcRef.current === pc

              void (async () => {
                try {
                  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: filterSdpCandidates(payload.sdp) }))
                  if (!isCurrentConnection()) return
                  const answer = await pc.createAnswer()
                  if (!isCurrentConnection()) return
                  let sdp = answer.sdp || ''
                  const answerBitrateKbps = Math.max(1000, Math.round((scrcpyOptionsRef.current.max_bitrate || scrcpyOptionsRef.current.bitrate || 8000000) / 1000))
                  sdp = sdp.replace(/m=video (.*)\r\n/g, `m=video $1\r\nb=AS:${answerBitrateKbps}\r\n`)
                  await pc.setLocalDescription(new RTCSessionDescription({ type: 'answer', sdp }))
                  if (!isCurrentConnection()) return
                  // Scrcpy's signaling protocol forwards ICE candidates separately,
                  // including when the device SDP omits ice-options:trickle.
                  if (!sendAnswer(pc)) finishConnection(generation, 'error', '信令连接已中断，请重新启动预览')
                } catch (err) {
                  if (!isCurrentConnection()) return
                  finishConnection(generation, 'error', `SDP 处理失败: ${err instanceof Error ? err.message : String(err)}`)
                }
              })()
            } else if (payload.type === 'ice-candidate' && payload.candidate) {
              const candidate = payload.candidate.candidate
              if (!shouldKeepCandidate(candidate, connectionPath, ipPreference)) return
              void pcRef.current?.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {})
            } else if (payload.type === 'scrcpy_error') {
              finishConnection(generation, 'error', readScrcpyErrorMessage(payload))
            }
          }

          ws.onerror = () => {
            if (!isCurrentSocket()) return
            if (!opened) finishStartupFailure(new Error('信令连接暂时不可用，请稍后重试'))
            else finishConnection(generation, 'error', '信令连接已中断，请重新启动预览')
          }
          ws.onclose = event => {
            if (!isCurrentSocket()) return
            if (!opened) {
              finishStartupFailure(new Error(event.code === 1008 ? '信令认证失败，请稍后重试' : '信令连接暂时不可用，请稍后重试'))
              return
            }
            if (event.code === 1000) {
              finishConnection(generation, 'disconnected', null)
            } else {
              finishConnection(generation, 'error', '信令连接已中断，请重新启动预览')
            }
          }
        })
        .catch(finishStartupFailure)
    }

    attemptConnection(0)
  }, [armConnectionTimeout, connectionPath, createPeerConnection, deviceId, filterSdpCandidates, finishConnection, ipPreference, sendAnswer, sendForward, signalingUrl, teardownConnection, touchInput])

  const sendTouch = useCallback((action: number, clientX: number, clientY: number, id = 0, targetVideo?: HTMLVideoElement | null) => {
    return touchInput.sendTouch(action, clientX, clientY, id, targetVideo || videoRef.current)
  }, [touchInput, videoRef])

  const sendCommand = useCallback((command: string) => {
    const keycode = command === 'input keyevent 3' ? 3
      : command === 'input keyevent 4' ? 4
        : command === 'input keyevent 187' ? 187 : null
    const channel = inputChannelRef.current
    if (keycode !== null && channel?.readyState === 'open') {
      const sendKey = (action: number) => channel.send(JSON.stringify({ type: 'inject_keycode', action, keycode, repeat: 0, meta: 0 }))
      let downSent = false
      try {
        sendKey(0)
        downSent = true
        sendKey(1)
        return true
      } catch {
        if (downSent) {
          try { sendKey(1) } catch { /* Best effort release; do not replay an uncertain key down. */ }
        }
        return false
      }
    }
    const ws = wsRef.current
    if (ws?.readyState !== WebSocket.OPEN) return false
    try {
      ws.send(JSON.stringify({ message_type: 'command', device_id: deviceId, request_id: Math.random().toString(36).slice(2), command }))
      return true
    } catch {
      return false
    }
  }, [deviceId])

  useEffect(() => {
    if (!statsEnabled || !mediaStream) {
      prevStatsRef.current = null
      setStats(null)
      return
    }
    let cancelled = false
    let sampling = false
    const sample = async () => {
      const pc = pcRef.current
      if (!pc || sampling) return
      sampling = true
      const reports = await pc.getStats().catch(() => null)
      sampling = false
      if (!reports || cancelled || pcRef.current !== pc) return
      const video = videoRef.current
      const track = streamRef.current?.getVideoTracks()[0]
      const sample = sampleWebRTCStats(reports, prevStatsRef.current, track?.id)
      prevStatsRef.current = sample.counters
      const nextStats: VideoStats = {
        ...sample.metrics,
        width: video?.videoWidth || 0,
        height: video?.videoHeight || 0,
        videoReadyState: video?.readyState || 0,
        videoLive: track?.readyState === 'live' && !track.muted,
        iceState: pc.iceConnectionState || 'unknown',
        peerState: pc.connectionState || 'unknown',
        signalingState: pc.signalingState || 'unknown',
        inputReady
      }
      // 每秒采样通常只有计数器变化而展示值不变：值相等时保留旧对象，
      // 避免宿主组件与面板按固定频率重渲染。
      setStats(previous => isSameVideoStats(previous, nextStats) ? previous : nextStats)
    }
    const timer = window.setInterval(() => { void sample() }, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [inputReady, mediaStream, statsEnabled, videoRef])

  useEffect(() => disconnect, [disconnect])

  return { status, error, stats, inputReady, mediaStream, connect, disconnect, sendTouch, sendCommand }
}
