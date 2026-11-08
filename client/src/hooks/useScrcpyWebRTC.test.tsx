// @vitest-environment jsdom

import { Activity, act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindInputChannelReadiness,
  getRenderedVideoGeometry,
  isPointInsideRenderedVideo,
  isTouchMoveBackpressured,
  resolveSignalingEndpoints,
  resolveTouchTargetSize,
  normalizeIceServers,
  filterSdpCandidatesForPolicy,
  shouldKeepCandidate,
  useScrcpyWebRTC,
  type ScrcpyCommandResult,
} from './useScrcpyWebRTC'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: MockWebSocket[] = []

  readonly url: string
  readyState = MockWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  send = vi.fn()

  constructor(url: string | URL) {
    this.url = String(url)
    MockWebSocket.instances.push(this)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
  }

  open() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  failBeforeOpen(code = 1006) {
    const queuedCloseHandler = this.onclose
    this.onerror?.(new Event('error'))
    this.readyState = MockWebSocket.CLOSED
    queuedCloseHandler?.(new CloseEvent('close', { code }))
  }
}

type WebrtcHook = ReturnType<typeof useScrcpyWebRTC>

let hook: WebrtcHook | null = null
let root: Root
let container: HTMLDivElement

function Harness({ signalingUrl = 'ws://old-host:8443' }: { signalingUrl?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const currentHook = useScrcpyWebRTC({ signalingUrl, videoRef })
  useEffect(() => {
    hook = currentHook
  }, [currentHook])
  return <video ref={videoRef} />
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function connectAndOpenSocket() {
  act(() => hook!.connect())
  await flushAsyncWork()
  const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!
  act(() => socket.open())
  return socket
}

describe('useScrcpyWebRTC startup', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ token: 'fresh-token' })
    }))
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    hook = null
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('routes a direct signaling URL override through the same-origin gateway without persisting the ticket', async () => {
    act(() => hook!.connect('ws://fresh-host:8443'))
    await flushAsyncWork()

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/webrtc-signaling/api/login', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
    }))
    const requestInit = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(requestInit?.body).toBeUndefined()
    const gatewayHeaders = new Headers(requestInit?.headers)
    expect(gatewayHeaders.has('Authorization')).toBe(false)
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]!.url).toBe('ws://localhost:3000/webrtc-signaling/connect_client?token=fresh-token&deviceId=mumu-la-pluma')
    expect(window.localStorage.getItem('scrcpy_webrtc_auth_token')).toBeNull()
  })

  it('uses an authenticated same-origin ticket request when API auth is configured', async () => {
    window.localStorage.setItem('laPlumaToken', 'la-pluma-secret')

    act(() => hook!.connect('/webrtc-signaling'))
    await flushAsyncWork()

    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(url).toBe('http://localhost:3000/webrtc-signaling/api/login')
    expect(headers.get('Authorization')).toBe('Bearer la-pluma-secret')
    expect(MockWebSocket.instances[0]!.url).toBe('ws://localhost:3000/webrtc-signaling/connect_client?token=fresh-token&deviceId=mumu-la-pluma')
  })

  it('retries one transient startup failure without creating duplicate sockets', async () => {
    act(() => hook!.connect())
    await flushAsyncWork()

    act(() => MockWebSocket.instances[0]!.failBeforeOpen())
    expect(hook!.status).toBe('connecting')

    await act(async () => vi.advanceTimersByTimeAsync(300))
    await flushAsyncWork()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(MockWebSocket.instances).toHaveLength(2)

    act(() => MockWebSocket.instances[1]!.open())
    expect(hook!.status).toBe('signaling')
    expect(MockWebSocket.instances[1]!.send).toHaveBeenCalledTimes(1)
  })

  it('times out a pending WebSocket handshake and retries it', async () => {
    act(() => hook!.connect())
    await flushAsyncWork()

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]!.readyState).toBe(MockWebSocket.CONNECTING)

    await act(async () => vi.advanceTimersByTimeAsync(4000))
    expect(MockWebSocket.instances[0]!.readyState).toBe(MockWebSocket.CLOSED)
    expect(hook!.status).toBe('connecting')

    await act(async () => vi.advanceTimersByTimeAsync(300))
    await flushAsyncWork()

    expect(MockWebSocket.instances).toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('clears the attempt timeout after the WebSocket opens', async () => {
    act(() => hook!.connect())
    await flushAsyncWork()

    const authSignal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal
    act(() => MockWebSocket.instances[0]!.open())
    expect(authSignal?.aborted).toBe(true)

    await act(async () => vi.advanceTimersByTimeAsync(5000))

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(hook!.status).toBe('signaling')
    expect(hook!.error).toBeNull()
  })

  it('keeps the signaling socket alive with a 20s heartbeat', async () => {
    const socket = await connectAndOpenSocket()
    socket.send.mockClear()

    await act(async () => vi.advanceTimersByTimeAsync(20_000))
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }))

    act(() => hook!.disconnect())
    socket.send.mockClear()
    await act(async () => vi.advanceTimersByTimeAsync(20_000))
    expect(socket.send).not.toHaveBeenCalled()
  })

  it('surfaces a scrcpy_error instead of waiting forever', async () => {
    const socket = await connectAndOpenSocket()

    act(() => {
      socket.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          message_type: 'device_msg',
          payload: { type: 'scrcpy_error', message: 'MediaCodec failed' },
        }),
      }))
    })

    expect(hook!.status).toBe('error')
    expect(hook!.error).toBe('MediaCodec failed')
  })

  it('times out when the signaling config never arrives', async () => {
    await connectAndOpenSocket()

    await act(async () => vi.advanceTimersByTimeAsync(15_000))

    expect(hook!.status).toBe('error')
    expect(hook!.error).toContain('等待信令配置超时')
  })

  it('times out when no offer arrives after config', async () => {
    const socket = await connectAndOpenSocket()

    act(() => {
      socket.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ message_type: 'config', ice_servers: [] }),
      }))
    })
    expect(hook!.status).toBe('waiting_offer')

    await act(async () => vi.advanceTimersByTimeAsync(15_000))

    expect(hook!.status).toBe('error')
    expect(hook!.error).toContain('等待设备画面超时')
  })

  it('resolves command results and reports command failures', async () => {
    const socket = await connectAndOpenSocket()
    let successPromise: Promise<ScrcpyCommandResult>
    let failurePromise: Promise<ScrcpyCommandResult>

    act(() => {
      successPromise = hook!.sendCommand('input keyevent 4')
    })
    const successCommand = JSON.parse(socket.send.mock.calls[socket.send.mock.calls.length - 1]![0] as string)
    expect(successCommand.message_type).toBe('command')

    act(() => {
      socket.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          message_type: 'device_msg',
          payload: {
            type: 'command_result',
            request_id: successCommand.request_id,
            success: true,
            output: 'ok',
          },
        }),
      }))
    })
    await expect(successPromise!).resolves.toMatchObject({ success: true, output: 'ok' })

    act(() => {
      failurePromise = hook!.sendCommand('bad command')
    })
    const failureCommand = JSON.parse(socket.send.mock.calls[socket.send.mock.calls.length - 1]![0] as string)

    act(() => {
      socket.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          message_type: 'device_msg',
          payload: {
            type: 'command_result',
            request_id: failureCommand.request_id,
            success: false,
            error: 'boom',
          },
        }),
      }))
    })
    await expect(failurePromise!).resolves.toMatchObject({ success: false, error: 'boom' })
  })

  it('times out a command that never receives a result', async () => {
    await connectAndOpenSocket()
    let commandPromise: Promise<ScrcpyCommandResult>

    act(() => {
      commandPromise = hook!.sendCommand('input keyevent 3')
    })
    await act(async () => vi.advanceTimersByTimeAsync(15_000))

    await expect(commandPromise!).resolves.toMatchObject({
      success: false,
      error: '命令执行超时',
    })
  })

  it('waits for the previous session to release before reconnecting', async () => {
    await connectAndOpenSocket()
    expect(MockWebSocket.instances).toHaveLength(1)

    act(() => hook!.connect())
    await flushAsyncWork()
    expect(hook!.status).toBe('connecting')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(MockWebSocket.instances).toHaveLength(1)

    await act(async () => vi.advanceTimersByTimeAsync(799))
    expect(fetch).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTimeAsync(1))
    await flushAsyncWork()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('aborts a pending token request when an attempt times out', async () => {
    const signals: AbortSignal[] = []
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) return
      signals.push(signal)
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))

    act(() => hook!.connect())
    await flushAsyncWork()
    await act(async () => vi.advanceTimersByTimeAsync(4000))

    expect(signals[0]?.aborted).toBe(true)
    expect(hook!.status).toBe('connecting')

    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops after the bounded number of startup retries', async () => {
    act(() => hook!.connect())
    await flushAsyncWork()
    act(() => MockWebSocket.instances[0]!.failBeforeOpen())

    await act(async () => vi.advanceTimersByTimeAsync(300))
    await flushAsyncWork()
    act(() => MockWebSocket.instances[1]!.failBeforeOpen())

    await act(async () => vi.advanceTimersByTimeAsync(800))
    await flushAsyncWork()
    act(() => MockWebSocket.instances[2]!.failBeforeOpen())

    expect(MockWebSocket.instances).toHaveLength(3)
    expect(hook!.status).toBe('error')
    expect(hook!.error).toBe('信令连接暂时不可用，请稍后重试')
  })

  it('cancels a pending retry after a manual disconnect', async () => {
    act(() => hook!.connect())
    await flushAsyncWork()
    act(() => MockWebSocket.instances[0]!.failBeforeOpen())

    act(() => hook!.disconnect())
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await flushAsyncWork()

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(hook!.status).toBe('disconnected')
    expect(hook!.error).toBeNull()
  })

  it('cancels a pending handshake timeout after a manual disconnect', async () => {
    act(() => hook!.connect())
    await flushAsyncWork()

    act(() => hook!.disconnect())
    await act(async () => vi.advanceTimersByTimeAsync(10000))
    await flushAsyncWork()

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]!.readyState).toBe(MockWebSocket.CLOSED)
    expect(hook!.status).toBe('disconnected')
    expect(hook!.error).toBeNull()
  })

  it('ignores stale SDP failures after disconnecting the old connection', async () => {
    let rejectRemoteDescription: ((reason?: unknown) => void) | undefined
    class MockMediaStream {
      private tracks: MediaStreamTrack[] = []
      getTracks() { return this.tracks }
      getVideoTracks() { return this.tracks }
      addTrack(track: MediaStreamTrack) { this.tracks.push(track) }
    }
    class MockPeerConnection {
      localDescription: RTCSessionDescription | null = null
      iceConnectionState = 'new'
      connectionState = 'new'
      signalingState = 'stable'
      iceGatheringState = 'new'
      ontrack = null
      onicecandidate = null
      ondatachannel = null
      oniceconnectionstatechange = null
      onconnectionstatechange = null
      setRemoteDescription = vi.fn(() => new Promise<void>((_resolve, reject) => {
        rejectRemoteDescription = reject
      }))
      createAnswer = vi.fn()
      setLocalDescription = vi.fn()
      addIceCandidate = vi.fn()
      addEventListener = vi.fn()
      removeEventListener = vi.fn()
      close = vi.fn()
      getStats = vi.fn()
    }
    vi.stubGlobal('MediaStream', MockMediaStream)
    vi.stubGlobal('RTCPeerConnection', MockPeerConnection)
    vi.stubGlobal('RTCSessionDescription', class {
      constructor(init: RTCSessionDescriptionInit) { Object.assign(this, init) }
    })

    act(() => hook!.connect())
    await flushAsyncWork()
    act(() => MockWebSocket.instances[0]!.open())
    act(() => {
      MockWebSocket.instances[0]!.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          message_type: 'device_msg',
          payload: { type: 'offer', sdp: 'v=0\r\n' },
        }),
      }))
    })
    expect(hook!.status).toBe('connecting_webrtc')

    act(() => hook!.disconnect())
    await act(async () => rejectRemoteDescription?.(new Error('old SDP failed')))
    await flushAsyncWork()

    expect(hook!.status).toBe('disconnected')
    expect(hook!.error).toBeNull()
  })
})



describe('WebRTC signaling endpoint normalization', () => {
  it('derives HTTPS and WSS endpoints from the same-origin proxy path', () => {
    expect(resolveSignalingEndpoints('/webrtc-signaling', 'https://console.example/settings')).toEqual({
      httpBase: 'https://console.example/webrtc-signaling',
      websocketBase: 'wss://console.example/webrtc-signaling'
    })
  })

  it('replaces an insecure legacy address when the application is on HTTPS', () => {
    expect(resolveSignalingEndpoints('ws://192.168.1.2:8443', 'https://console.example/')).toEqual({
      httpBase: 'https://console.example/webrtc-signaling',
      websocketBase: 'wss://console.example/webrtc-signaling'
    })
  })

  it('preserves direct signaling compatibility on an HTTP page', () => {
    expect(resolveSignalingEndpoints('ws://192.168.1.2:8443', 'http://console.local/')).toEqual({
      httpBase: 'http://192.168.1.2:8443',
      websocketBase: 'ws://192.168.1.2:8443'
    })
  })
})

describe('WebRTC touch transport safeguards', () => {
  it('reports input-channel readiness immediately and on channel changes', () => {
    const channel = {
      readyState: 'connecting',
      bufferedAmountLowThreshold: 0,
      onopen: null,
      onclose: null,
      onerror: null,
    } as unknown as RTCDataChannel
    const readiness: boolean[] = []
    const cleanup = bindInputChannelReadiness(channel, ready => readiness.push(ready))

    expect(readiness).toEqual([false])
    Object.defineProperty(channel, 'readyState', { value: 'open', configurable: true })
    channel.onopen?.(new Event('open'))
    expect(readiness).toEqual([false, true])

    Object.defineProperty(channel, 'readyState', { value: 'closed', configurable: true })
    channel.onclose?.(new Event('close'))
    expect(readiness).toEqual([false, true, false])

    cleanup()
    expect(channel.onopen).toBeNull()
    expect(channel.onclose).toBeNull()
  })

  it('maps touch coordinates against the device default orientation', () => {
    expect(resolveTouchTargetSize(1080, 1920, 1920, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(resolveTouchTargetSize(1920, 1080, 1920, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(resolveTouchTargetSize(1920, 1080, 1080, 1920)).toEqual({ width: 1080, height: 1920 })
  })

  it('recognizes letterboxing and excludes pointer-down outside the rendered video', () => {
    const geometry = getRenderedVideoGeometry(1600, 900, 1080, 1920)

    expect(geometry).toEqual({ actualW: 506.25, actualH: 900, offsetX: 546.875, offsetY: 0 })
    expect(isPointInsideRenderedVideo(100, 450, { left: 0, top: 0 }, geometry!)).toBe(false)
    expect(isPointInsideRenderedVideo(800, 450, { left: 0, top: 0 }, geometry!)).toBe(true)
  })

  it('drops only move packets under backpressure so release packets still get sent', () => {
    expect(isTouchMoveBackpressured(2, 64 * 1024 + 1)).toBe(true)
    expect(isTouchMoveBackpressured(1, 64 * 1024 + 1)).toBe(false)
    expect(isTouchMoveBackpressured(3, 64 * 1024 + 1)).toBe(false)
  })

})


describe('useScrcpyWebRTC preview grace', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ token: 'fresh-token' })
    }))
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    hook = null
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps a live connection through a short Activity hide and reconnects after the hidden grace', async () => {
    const socket = await connectAndOpenSocket()
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(<Activity mode={mode}><Harness /></Activity>)
      })
      await flushAsyncWork()
    }

    await renderMode('hidden')
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(socket.readyState).toBe(MockWebSocket.OPEN)

    await renderMode('visible')
    await renderMode('hidden')
    await act(async () => {
      vi.advanceTimersByTime(180_000)
    })
    expect(socket.readyState).toBe(MockWebSocket.CLOSED)

    await renderMode('visible')
    await flushAsyncWork()
    expect(MockWebSocket.instances.length).toBeGreaterThan(1)
  })
})


describe('WebRTC candidate filtering', () => {
  const ipv4Line = 'a=candidate:1 1 UDP 2122260223 192.168.50.14 54321 typ host'
  const relayLine = 'a=candidate:2 1 UDP 16777215 192.168.50.14 49152 typ relay raddr 10.0.2.15 rport 50000'
  const ipv6Line = 'a=candidate:3 1 UDP 2122260223 2001:db8::1 54321 typ host'
  const loopbackLine = 'a=candidate:4 1 UDP 2122260223 127.0.0.1 54321 typ host'
  const loopback6Line = 'a=candidate:5 1 UDP 2122260223 ::1 54321 typ host'

  it('keeps IPv4 candidates in SDP lines with the a= prefix', () => {
    expect(shouldKeepCandidate(ipv4Line, 'auto', 'ipv4')).toBe(true)
    expect(shouldKeepCandidate(relayLine, 'auto', 'ipv4')).toBe(true)
    expect(shouldKeepCandidate(ipv6Line, 'auto', 'ipv4')).toBe(false)
    expect(shouldKeepCandidate(loopbackLine, 'auto', 'ipv4')).toBe(true)
  })

  it('keeps IPv6 candidates when requested and filters relay/direct policy', () => {
    expect(shouldKeepCandidate(ipv6Line, 'auto', 'ipv6')).toBe(true)
    expect(shouldKeepCandidate(ipv4Line, 'auto', 'ipv6')).toBe(false)
    expect(shouldKeepCandidate(ipv4Line, 'relay', 'ipv4')).toBe(false)
    expect(shouldKeepCandidate(relayLine, 'relay', 'ipv4')).toBe(true)
    expect(shouldKeepCandidate(loopback6Line, 'auto', 'ipv6')).toBe(true)
  })
})


describe('SDP loopback filtering', () => {
  const lanLine = 'a=candidate:1 1 UDP 2122260223 192.168.50.14 54321 typ host'
  const loopbackLine = 'a=candidate:4 1 UDP 2122260223 127.0.0.1 54321 typ host'

  it('drops loopback when the SDP also offers a LAN address', () => {
    const filtered = filterSdpCandidatesForPolicy(`${lanLine}\r\n${loopbackLine}`, 'auto', 'ipv4')
    expect(filtered).toContain('192.168.50.14')
    expect(filtered).not.toContain('127.0.0.1')
  })

  it('keeps loopback when it is the only candidate in an offer', () => {
    const filtered = filterSdpCandidatesForPolicy(loopbackLine, 'auto', 'ipv4')
    expect(filtered).toContain('127.0.0.1')
  })

  it('drops loopback from a local answer even when it is the only candidate so far', () => {
    const filtered = filterSdpCandidatesForPolicy(loopbackLine, 'auto', 'ipv4', true)
    expect(filtered).not.toContain('127.0.0.1')
  })
})

describe('WebRTC ICE server normalization', () => {
  it('removes the empty userinfo marker emitted by the signaling server', () => {
    assertDeepEqual(normalizeIceServers([
      { urls: ['turn:@192.168.50.14:3478?transport=udp'], username: 'user', credential: 'pass' },
      { urls: 'stun:192.168.50.14:3478' }
    ]), [
      { urls: 'turn:192.168.50.14:3478?transport=udp', username: 'user', credential: 'pass' },
      { urls: 'stun:192.168.50.14:3478' }
    ])
  })
})

function assertDeepEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
