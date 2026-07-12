import { useCallback, useEffect, useRef, useState } from 'react'

export type WebRTCStatus = 'idle' | 'connecting' | 'signaling' | 'waiting_offer' | 'connecting_webrtc' | 'connected' | 'disconnected' | 'error'

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

function signalingHttpBase(url: string) {
  return url.replace(/^ws/, 'http').replace(/\/$/, '')
}

const SIGNALING_TOKEN_KEY = 'scrcpy_webrtc_auth_token'
const SIGNALING_RETRY_DELAYS_MS = [300, 800]
const SIGNALING_ATTEMPT_TIMEOUT_MS = 4000

async function getSignalingToken(signalingUrl: string, signal: AbortSignal) {
  // The signaling server can restart between previews, invalidating its old token.
  window.localStorage.removeItem(SIGNALING_TOKEN_KEY)
  let response: Response
  try {
    response = await fetch(`${signalingHttpBase(signalingUrl)}/api/login`, {
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
  if (typeof data?.token !== 'string' || !data.token.trim()) throw new Error('信令服务返回了无效凭证')
  window.localStorage.setItem(SIGNALING_TOKEN_KEY, data.token)
  return data.token as string
}

function normalizeSignalingUrl(url: string, token: string) {
  const trimmed = url.replace(/\/$/, '')
  return `${trimmed}/connect_client?token=${encodeURIComponent(token)}`
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
  signalingUrl = 'ws://127.0.0.1:8443',
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
  const [deviceSize, setDeviceSize] = useState({ width: 1080, height: 1920 })
  const wsRef = useRef<WebSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const inputChannelRef = useRef<RTCDataChannel | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }])
  const touchSeqRef = useRef(0)
  const connectionGenerationRef = useRef(0)
  const retryTimerRef = useRef<number | null>(null)
  const attemptTimeoutRef = useRef<number | null>(null)
  const authAbortControllerRef = useRef<AbortController | null>(null)
  const prevStatsRef = useRef({ timestamp: 0, bytesReceived: 0, framesDecoded: 0 })

  const sendForward = useCallback((payload: unknown) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ message_type: 'forward', device_id: deviceId, payload }))
    }
  }, [deviceId])

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
    streamRef.current = new MediaStream()

    pc.ontrack = evt => {
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
      if (evt.channel.label === 'input-channel') inputChannelRef.current = evt.channel
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') setStatus('connected')
      if (pc.iceConnectionState === 'failed') {
        setError('ICE connection failed')
        setStatus('error')
      }
    }

    pc.onconnectionstatechange = () => {
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
    if (videoRef.current) videoRef.current.srcObject = null
    prevStatsRef.current = { timestamp: 0, bytesReceived: 0, framesDecoded: 0 }
    setStats(null)
  }, [videoRef])

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

        setError(reason instanceof Error ? reason.message : '信令服务暂时不可用，请稍后重试')
        setStatus('error')
      }

      attemptTimeout = window.setTimeout(() => {
        finishStartupFailure(new Error('信令连接超时，请稍后重试'))
      }, SIGNALING_ATTEMPT_TIMEOUT_MS)
      attemptTimeoutRef.current = attemptTimeout

      void getSignalingToken(targetSignalingUrl, authAbortController.signal)
        .then(token => {
          if (attemptFinished || connectionGenerationRef.current !== generation) return
          const ws = new WebSocket(normalizeSignalingUrl(targetSignalingUrl, token))
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
            ws.send(JSON.stringify({ message_type: 'connect', device_id: deviceId }))
          }

          ws.onmessage = event => {
            if (connectionGenerationRef.current !== generation) return
            let msg: any
            try {
              msg = JSON.parse(event.data)
            } catch {
              setError('收到无效的信令消息')
              setStatus('error')
              return
            }
            const type = msg.message_type || msg.type
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
              return
            }
            if (type === 'device_info' && msg.device_info?.displays?.[0]) {
              const display = msg.device_info.displays[0]
              setDeviceSize({ width: display.x_res || 1080, height: display.y_res || 1920 })
              return
            }
            if (type === 'error') {
              setError(msg.error || '信令服务返回错误')
              setStatus('error')
              return
            }
            if (type !== 'device_msg' || !msg.payload?.type) return
            const payload = msg.payload
            if (payload.type === 'offer') {
              setStatus('connecting_webrtc')
              const pc = createPeerConnection()
              void pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: filterSdpCandidates(payload.sdp) }))
                .then(() => pc.createAnswer())
                .then(answer => {
                  let sdp = answer.sdp || ''
                  const answerBitrateKbps = Math.max(1000, Math.round((scrcpyOptionsRef.current.max_bitrate || scrcpyOptionsRef.current.bitrate || 8000000) / 1000))
                  sdp = sdp.replace(/m=video (.*)\r\n/g, `m=video $1\r\nb=AS:${answerBitrateKbps}\r\n`)
                  return pc.setLocalDescription(new RTCSessionDescription({ type: 'answer', sdp }))
                })
                .then(() => {
                  if (pc.iceGatheringState === 'complete') {
                    sendAnswer()
                    return
                  }
                  let sent = false
                  const finish = () => {
                    if (sent) return
                    sent = true
                    pc.removeEventListener('icegatheringstatechange', finish)
                    sendAnswer()
                  }
                  pc.addEventListener('icegatheringstatechange', () => {
                    if (pc.iceGatheringState === 'complete') finish()
                  })
                  window.setTimeout(finish, 2000)
                })
                .catch(err => {
                  setError(`SDP 处理失败: ${err.message}`)
                  setStatus('error')
                })
            } else if (payload.type === 'ice-candidate' && payload.candidate) {
              const candidate = payload.candidate.candidate
              if (!shouldKeepCandidate(candidate, connectionPath, ipPreference)) return
              void pcRef.current?.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {})
            }
          }

          ws.onerror = () => {
            if (!opened) finishStartupFailure(new Error('信令连接暂时不可用，请稍后重试'))
          }
          ws.onclose = event => {
            if (connectionGenerationRef.current !== generation) return
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

    attemptConnection(0)
  }, [connectionPath, createPeerConnection, deviceId, filterSdpCandidates, ipPreference, sendAnswer, sendForward, signalingUrl, teardownConnection])

  const sendTouch = useCallback((action: number, clientX: number, clientY: number, id = 0, targetVideo?: HTMLVideoElement | null) => {
    const channel = inputChannelRef.current
    const video = targetVideo || videoRef.current
    if (!channel || channel.readyState !== 'open' || !video || !video.videoWidth || !video.videoHeight) return false

    const rect = video.getBoundingClientRect()
    const videoRatio = video.videoWidth / video.videoHeight
    const clientRatio = rect.width / rect.height
    let actualW: number, actualH: number, offsetX: number, offsetY: number
    if (clientRatio > videoRatio) {
      actualH = rect.height
      actualW = rect.height * videoRatio
      offsetX = (rect.width - actualW) / 2
      offsetY = 0
    } else {
      actualW = rect.width
      actualH = rect.width / videoRatio
      offsetX = 0
      offsetY = (rect.height - actualH) / 2
    }

    const isLandscape = video.videoWidth > video.videoHeight
    const targetW = isLandscape ? deviceSize.height : deviceSize.width
    const targetH = isLandscape ? deviceSize.width : deviceSize.height
    const x = Math.max(0, Math.min(targetW, Math.round((clientX - rect.left - offsetX) / actualW * targetW)))
    const y = Math.max(0, Math.min(targetH, Math.round((clientY - rect.top - offsetY) / actualH * targetH)))
    channel.send(JSON.stringify({ type: 'touch', id, seq: ++touchSeqRef.current, client_ts_ms: Date.now(), action, x, y, w: targetW, h: targetH }))
    return true
  }, [deviceSize.height, deviceSize.width, videoRef])

  const sendCommand = useCallback((command: string) => {
    const ws = wsRef.current
    if (ws?.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify({ message_type: 'command', device_id: deviceId, request_id: Math.random().toString(36).slice(2), command }))
    return true
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
            inputReady: inputChannelRef.current?.readyState === 'open'
          })
          break
        }
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [videoRef])

  useEffect(() => disconnect, [disconnect])

  return { status, error, stats, connect, disconnect, sendTouch, sendCommand }
}
