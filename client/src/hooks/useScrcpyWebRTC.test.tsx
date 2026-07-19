// @vitest-environment jsdom

import { act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindInputChannelReadiness,
  getRenderedVideoGeometry,
  isPointInsideRenderedVideo,
  isTouchMoveBackpressured,
  resolveSignalingEndpoints,
  useScrcpyWebRTC,
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

  it('uses the same-click URL override and refreshes a stale cached token', async () => {
    window.localStorage.setItem('scrcpy_webrtc_auth_token', 'stale-token')

    act(() => hook!.connect('ws://fresh-host:8443'))
    await flushAsyncWork()

    expect(fetch).toHaveBeenCalledWith('http://fresh-host:8443/api/login', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    }))
    const directHeaders = new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers)
    expect(directHeaders.has('Authorization')).toBe(false)
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]!.url).toBe('ws://fresh-host:8443/connect_client?token=fresh-token')
    expect(window.localStorage.getItem('scrcpy_webrtc_auth_token')).toBe('fresh-token')
  })

  it('uses an authenticated same-origin ticket request when API auth is configured', async () => {
    window.localStorage.setItem('laPlumaToken', 'la-pluma-secret')

    act(() => hook!.connect('/webrtc-signaling'))
    await flushAsyncWork()

    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(url).toBe('http://localhost:3000/webrtc-signaling/api/login')
    expect(headers.get('Authorization')).toBe('Bearer la-pluma-secret')
    expect(MockWebSocket.instances[0]!.url).toBe('ws://localhost:3000/webrtc-signaling/connect_client?token=fresh-token')
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
