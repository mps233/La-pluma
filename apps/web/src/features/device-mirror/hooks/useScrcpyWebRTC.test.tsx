// @vitest-environment jsdom

import { Activity, act, useEffect, useRef } from 'react'
import { clearAuthToken, setAuthToken } from '@/shared/api'
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

class MockMediaStream {
  private tracks: MediaStreamTrack[] = []
  getTracks() { return this.tracks }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video') }
  addTrack(track: MediaStreamTrack) { this.tracks.push(track) }
}

class MockMediaTrack extends EventTarget {
  readonly id = 'video-track'
  readonly kind = 'video'
  readyState: MediaStreamTrackState = 'live'
  muted = false
  stop = vi.fn(() => { this.readyState = 'ended' })
}

class MockPeerConnection extends EventTarget {
  static instances: MockPeerConnection[] = []
  localDescription: RTCSessionDescription | null = null
  iceConnectionState: RTCIceConnectionState = 'new'
  connectionState: RTCPeerConnectionState = 'new'
  signalingState: RTCSignalingState = 'stable'
  iceGatheringState: RTCIceGatheringState = 'complete'
  canTrickleIceCandidates = true
  ontrack: ((event: RTCTrackEvent) => void) | null = null
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  setRemoteDescription = vi.fn(async (_description: RTCSessionDescriptionInit) => {})
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'v=0\r\n' }))
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description as RTCSessionDescription
  })
  addIceCandidate = vi.fn(async () => {})
  getReceivers = vi.fn((): RTCRtpReceiver[] => [])
  close = vi.fn(() => { this.connectionState = 'closed' })
  getStats = vi.fn(async () => new Map())

  constructor() {
    super()
    MockPeerConnection.instances.push(this)
  }
}

type WebrtcHook = ReturnType<typeof useScrcpyWebRTC>

let hook: WebrtcHook | null = null
let root: Root
let container: HTMLDivElement

function Harness({ signalingUrl = 'ws://old-host:8443', statsEnabled = true }: { signalingUrl?: string; statsEnabled?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const currentHook = useScrcpyWebRTC({ signalingUrl, videoRef, statsEnabled })
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

function sendSocketMessage(message: unknown, socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!) {
  act(() => socket.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) })))
}

async function openSignalingConnection() {
  act(() => hook!.connect())
  await flushAsyncWork()
  act(() => MockWebSocket.instances[MockWebSocket.instances.length - 1]!.open())
}

async function receiveOffer() {
  sendSocketMessage({ message_type: 'device_msg', payload: { type: 'offer', sdp: 'v=0\r\n' } })
  await flushAsyncWork()
  return MockPeerConnection.instances[MockPeerConnection.instances.length - 1]!
}

function receiveTrack(pc: MockPeerConnection, track = new MockMediaTrack()) {
  act(() => pc.ontrack?.({ track } as unknown as RTCTrackEvent))
  return track
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useScrcpyWebRTC startup', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    MockPeerConnection.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('MediaStream', MockMediaStream)
    vi.stubGlobal('RTCPeerConnection', MockPeerConnection)
    vi.stubGlobal('RTCSessionDescription', class {
      constructor(init: RTCSessionDescriptionInit) { Object.assign(this, init) }
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ token: 'fresh-token' })
    }))
    window.localStorage.clear()
    clearAuthToken()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<Activity mode="visible"><Harness /></Activity>))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    hook = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  async function openTouchConnection(width?: number, height?: number) {
    await openSignalingConnection()
    if (width !== undefined) sendSocketMessage({
      message_type: 'device_info', device_info: { displays: [{ x_res: width, y_res: height }] }
    })
    const pc = await receiveOffer()
    const channel = {
      label: 'input-channel', readyState: 'open', bufferedAmount: 0,
      send: vi.fn(), close: vi.fn(), onopen: null, onclose: null, onerror: null,
    }
    act(() => pc.ondatachannel?.({ channel } as unknown as RTCDataChannelEvent))
    const video = container.querySelector('video')!
    Object.defineProperties(video, {
      videoWidth: { value: 640, configurable: true },
      videoHeight: { value: 360, configurable: true },
    })
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({
      left: 100, top: 50, width: 640, height: 360
    } as DOMRect)
    return { channel, video }
  }

  it('maps native landscape metadata to the landscape input space', async () => {
    const { channel } = await openTouchConnection(1280, 720)
    expect(hook!.sendTouch(0, 580, 140, 7)).toBe(true)
    expect(JSON.parse(channel.send.mock.calls[0]![0])).toMatchObject({
      action: 0, id: 7, x: 960, y: 180, w: 1280, h: 720
    })
  })

  it('waits for valid device metadata before accepting a new gesture', async () => {
    const { channel } = await openTouchConnection()
    expect(hook!.inputReady).toBe(false)
    expect(hook!.sendTouch(0, 580, 140, 7)).toBe(false)
    expect(channel.send).not.toHaveBeenCalled()
  })

  it('cancels a held gesture before closing its channel and waits for fresh metadata after reconnecting', async () => {
    const { channel } = await openTouchConnection(1280, 720)
    expect(hook!.sendTouch(0, 580, 140, 7)).toBe(true)

    act(() => hook!.disconnect())

    expect(channel.send.mock.calls.map(([raw]) => JSON.parse(raw).action)).toEqual([0, 3])
    expect(JSON.parse(channel.send.mock.calls[1]![0])).toMatchObject({
      id: 7, x: 960, y: 180, w: 1280, h: 720
    })
    expect(channel.send.mock.invocationCallOrder[1]).toBeLessThan(channel.close.mock.invocationCallOrder[0]!)

    const { channel: nextChannel } = await openTouchConnection()

    expect(hook!.inputReady).toBe(false)
    expect(hook!.sendTouch(0, 580, 140, 8)).toBe(false)
    expect(hook!.sendTouch(1, 580, 140, 7)).toBe(false)
    expect(nextChannel.send).not.toHaveBeenCalled()
  })

  it.each([3, 4, 187])('sends paired navigation key %s through the open input channel without shell replay', async keycode => {
    const { channel } = await openTouchConnection()
    const socket = MockWebSocket.instances[0]!
    socket.send.mockClear()

    expect(hook!.sendCommand(`input keyevent ${keycode}`)).toBe(true)

    expect(channel.send.mock.calls.map(([raw]) => JSON.parse(raw))).toEqual([
      { type: 'inject_keycode', action: 0, keycode, repeat: 0, meta: 0 },
      { type: 'inject_keycode', action: 1, keycode, repeat: 0, meta: 0 }
    ])
    expect(socket.send).not.toHaveBeenCalled()
  })

  it('falls back to the shell navigation command when the input channel is closed', async () => {
    const { channel } = await openTouchConnection()
    const socket = MockWebSocket.instances[0]!
    socket.send.mockClear()
    channel.readyState = 'closed'

    expect(hook!.sendCommand('input keyevent 4')).toBe(true)

    expect(channel.send).not.toHaveBeenCalled()
    expect(socket.send).toHaveBeenCalledOnce()
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({ message_type: 'command', command: 'input keyevent 4' })
  })

  it('falls back to the shell navigation command before an input channel arrives', async () => {
    await openSignalingConnection()
    const socket = MockWebSocket.instances[0]!
    socket.send.mockClear()

    expect(hook!.sendCommand('input keyevent 3')).toBe(true)

    expect(socket.send).toHaveBeenCalledOnce()
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({ message_type: 'command', command: 'input keyevent 3' })
  })

  it.each(['input keyevent 26', 'input keyevent 3 ', ' input keyevent 4', 'input keyevent 4; echo done', 'input keyevent 187\n'])(
    'keeps other or non-exact commands on the shell path: %j', async command => {
      const { channel } = await openTouchConnection()
      const socket = MockWebSocket.instances[0]!
      socket.send.mockClear()

      expect(hook!.sendCommand(command)).toBe(true)

      expect(channel.send).not.toHaveBeenCalled()
      expect(socket.send).toHaveBeenCalledOnce()
      expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({ message_type: 'command', command })
    }
  )

  it('does not replay a navigation command through the shell when key down cannot be sent', async () => {
    const { channel } = await openTouchConnection()
    const socket = MockWebSocket.instances[0]!
    socket.send.mockClear()
    channel.send.mockImplementationOnce(() => { throw new Error('input send failed') })

    expect(hook!.sendCommand('input keyevent 4')).toBe(false)

    expect(channel.send).toHaveBeenCalledOnce()
    expect(JSON.parse(channel.send.mock.calls[0]![0])).toMatchObject({ action: 0, keycode: 4 })
    expect(socket.send).not.toHaveBeenCalled()
  })

  it.each([false, true])('retries navigation key release once after a failed up without shell replay (retry fails: %s)', async retryFails => {
    const { channel } = await openTouchConnection()
    const socket = MockWebSocket.instances[0]!
    socket.send.mockClear()
    channel.send.mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new Error('key up send failed') })
      .mockImplementationOnce(() => { if (retryFails) throw new Error('retry send failed') })

    expect(hook!.sendCommand('input keyevent 187')).toBe(false)

    expect(channel.send.mock.calls.map(([raw]) => JSON.parse(raw))).toEqual([
      { type: 'inject_keycode', action: 0, keycode: 187, repeat: 0, meta: 0 },
      { type: 'inject_keycode', action: 1, keycode: 187, repeat: 0, meta: 0 },
      { type: 'inject_keycode', action: 1, keycode: 187, repeat: 0, meta: 0 }
    ])
    expect(socket.send).not.toHaveBeenCalled()
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
    setAuthToken('la-pluma-secret')

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

  it('ignores token responses that arrive after cancelling a connection', async () => {
    const response = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(response.promise)
    act(() => hook!.connect())
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal

    act(() => hook!.disconnect())
    await act(async () => response.resolve({
      ok: true,
      json: async () => ({ token: 'cancelled-token' })
    } as Response))
    await flushAsyncWork()

    expect(signal?.aborted).toBe(true)
    expect(MockWebSocket.instances).toHaveLength(0)
    expect(window.localStorage.getItem('scrcpy_webrtc_auth_token')).toBeNull()
    expect(hook!.status).toBe('disconnected')
  })

  it('ignores queued events from a cancelled socket after another preview starts', async () => {
    act(() => hook!.connect())
    await flushAsyncWork()
    const oldSocket = MockWebSocket.instances[0]!
    const queuedOpen = oldSocket.onopen!
    const queuedMessage = oldSocket.onmessage!
    act(() => hook!.disconnect())
    await openSignalingConnection()

    act(() => {
      queuedOpen(new Event('open'))
      queuedMessage(new MessageEvent('message', {
        data: JSON.stringify({ message_type: 'device_msg', payload: { type: 'offer', sdp: 'v=0\r\n' } })
      }))
    })

    expect(oldSocket.send).not.toHaveBeenCalled()
    expect(MockPeerConnection.instances).toHaveLength(0)
    expect(hook!.status).toBe('signaling')
  })

  it('does not continue an old offer after disconnect while remote SDP is pending', async () => {
    const remoteDescription = deferred<void>()
    vi.stubGlobal('RTCPeerConnection', class extends MockPeerConnection {
      override setRemoteDescription = vi.fn(() => remoteDescription.promise)
    })
    await openSignalingConnection()
    const pc = await receiveOffer()

    act(() => hook!.disconnect())
    await act(async () => remoteDescription.resolve())
    await flushAsyncWork()

    expect(pc.createAnswer).not.toHaveBeenCalled()
    expect(pc.close).toHaveBeenCalledOnce()
    expect(hook!.status).toBe('disconnected')
  })

  it('stops a queued remote video track after disconnect without attaching it', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    const queuedTrack = pc.ontrack!
    act(() => hook!.disconnect())
    const track = new MockMediaTrack()

    act(() => queuedTrack({ track } as unknown as RTCTrackEvent))

    expect(track.stop).toHaveBeenCalledOnce()
    expect(container.querySelector('video')!.srcObject).toBeNull()
    expect(hook!.mediaStream).toBeNull()
    expect(hook!.status).toBe('disconnected')
  })

  it('samples statistics only while enabled and clears them when disabled', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    receiveTrack(pc)

    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(pc.getStats).toHaveBeenCalledTimes(1)
    expect(hook!.stats).not.toBeNull()

    await act(async () => root.render(<Activity mode="visible"><Harness statsEnabled={false} /></Activity>))
    expect(hook!.stats).toBeNull()
    const callsWhenDisabled = pc.getStats.mock.calls.length
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(pc.getStats).toHaveBeenCalledTimes(callsWhenDisabled)

    await act(async () => root.render(<Activity mode="visible"><Harness statsEnabled /></Activity>))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(pc.getStats).toHaveBeenCalledTimes(callsWhenDisabled + 1)
  })

  it('does not overlap slow statistics requests', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    receiveTrack(pc)
    const pending = deferred<Map<string, object>>()
    pc.getStats.mockReturnValue(pending.promise)

    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(pc.getStats).toHaveBeenCalledOnce()

    await act(async () => pending.resolve(new Map()))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(pc.getStats).toHaveBeenCalledTimes(2)
  })

  it('keeps the previous stats object when sampled values are unchanged', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    receiveTrack(pc)
    pc.getStats.mockResolvedValue(new Map([
      ['video', { id: 'video', type: 'inbound-rtp', kind: 'video', timestamp: 1000, framesDecoded: 100, bytesReceived: 10000 }]
    ]))

    await act(async () => vi.advanceTimersByTimeAsync(1000))
    const firstStats = hook!.stats
    expect(firstStats).not.toBeNull()

    await act(async () => vi.advanceTimersByTimeAsync(1000))

    expect(hook!.stats).toBe(firstStats)
  })

  it('stops sampling after the preview disconnects', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    receiveTrack(pc)
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    const callsWhileConnected = pc.getStats.mock.calls.length

    act(() => hook!.disconnect())
    await act(async () => vi.advanceTimersByTimeAsync(3000))

    expect(pc.getStats.mock.calls.length).toBe(callsWhileConnected)
  })

  it('ignores statistics that arrive after disconnect', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    const pending = deferred<Map<string, object>>()
    pc.getStats.mockReturnValue(pending.promise)
    await act(async () => vi.advanceTimersByTimeAsync(1000))

    act(() => hook!.disconnect())
    await act(async () => pending.resolve(new Map([
      ['video', { id: 'video', type: 'inbound-rtp', kind: 'video', timestamp: 1000, framesDecoded: 100, bytesReceived: 10000 }]
    ])))

    expect(hook!.stats).toBeNull()
  })

  it('starts a new statistics baseline after reconnecting', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    receiveTrack(pc)
    const report = (timestamp: number, framesDecoded: number) => new Map([
      ['video', { id: 'video', type: 'inbound-rtp', kind: 'video', timestamp, framesDecoded, bytesReceived: framesDecoded * 100 }]
    ])
    pc.getStats.mockResolvedValueOnce(report(1000, 100)).mockResolvedValueOnce(report(2000, 110))
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(hook!.stats?.fps).toBe(10)

    act(() => hook!.disconnect())
    await openSignalingConnection()
    const nextPc = await receiveOffer()
    receiveTrack(nextPc)
    nextPc.getStats.mockResolvedValue(report(3000, 500))
    await act(async () => vi.advanceTimersByTimeAsync(1000))

    expect(hook!.stats?.fps).toBeNull()
    expect(hook!.stats?.bitrate).toBeNull()
  })

  it('stops receiver tracks even when their ontrack event has not arrived', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    const track = new MockMediaTrack()
    pc.getReceivers.mockReturnValue([{ track } as unknown as RTCRtpReceiver])

    act(() => hook!.disconnect())

    expect(track.stop).toHaveBeenCalledOnce()
    expect(pc.close).toHaveBeenCalledOnce()
  })

  it('closes transport and input resources when SDP negotiation fails', async () => {
    const remoteDescription = deferred<void>()
    vi.stubGlobal('RTCPeerConnection', class extends MockPeerConnection {
      override setRemoteDescription = vi.fn(() => remoteDescription.promise)
    })
    await openSignalingConnection()
    const socket = MockWebSocket.instances[0]!
    const pc = await receiveOffer()
    const track = receiveTrack(pc)
    const channel = {
      label: 'input-channel', readyState: 'open', close: vi.fn(),
      onopen: null, onclose: null, onerror: null,
    }
    act(() => pc.ondatachannel?.({ channel } as unknown as RTCDataChannelEvent))
    sendSocketMessage({ message_type: 'device_info', device_info: { displays: [{ x_res: 1280, y_res: 720 }] } })
    expect(hook!.inputReady).toBe(true)

    await act(async () => remoteDescription.reject(new Error('invalid SDP')))
    await flushAsyncWork()

    expect(hook!.status).toBe('error')
    expect(hook!.error).toBe('SDP 处理失败: invalid SDP')
    expect(pc.close).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(channel.close).toHaveBeenCalledOnce()
    expect(channel.onopen).toBeNull()
    expect(hook!.inputReady).toBe(false)
    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
    expect(socket.onmessage).toBeNull()
    expect(container.querySelector('video')!.srcObject).toBeNull()
    expect(hook!.mediaStream).toBeNull()
  })

  it.each([
    'invalid message', 'signaling error', 'socket error', 'socket close', 'ICE failure', 'peer failure', 'track ended'
  ])('releases live transport resources after %s', async failure => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    const track = receiveTrack(pc)
    const socket = MockWebSocket.instances[0]!
    act(() => {
      if (failure === 'invalid message') socket.onmessage?.(new MessageEvent('message', { data: 'broken' }))
      if (failure === 'signaling error') socket.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ message_type: 'error', error: 'device unavailable' })
      }))
      if (failure === 'socket error') socket.onerror?.(new Event('error'))
      if (failure === 'socket close') socket.onclose?.(new CloseEvent('close', { code: 1006 }))
      if (failure === 'ICE failure') {
        pc.iceConnectionState = 'failed'
        pc.oniceconnectionstatechange?.()
      }
      if (failure === 'peer failure') {
        pc.connectionState = 'failed'
        pc.onconnectionstatechange?.()
      }
      if (failure === 'track ended') track.dispatchEvent(new Event('ended'))
    })

    expect(hook!.status).toBe('error')
    expect(pc.close).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
    expect(hook!.mediaStream).toBeNull()
    expect(container.querySelector('video')!.srcObject).toBeNull()
  })

  it('surfaces a device scrcpy error with its first line and releases the transport', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    const track = receiveTrack(pc)
    const socket = MockWebSocket.instances[0]!
    sendSocketMessage({
      message_type: 'device_msg',
      payload: {
        type: 'scrcpy_error',
        message: 'android.media.MediaCodec$CodecException: Error 0x80001001\n\tat android.media.MediaCodec.native_configure(Native Method)'
      }
    })

    expect(hook!.status).toBe('error')
    expect(hook!.error).toBe('android.media.MediaCodec$CodecException: Error 0x80001001')
    expect(pc.close).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
    expect(hook!.mediaStream).toBeNull()
  })

  it('falls back to a stable message when a device scrcpy error has no message', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    sendSocketMessage({ message_type: 'device_msg', payload: { type: 'scrcpy_error' } })

    expect(hook!.status).toBe('error')
    expect(hook!.error).toBe('scrcpy 预览服务返回错误，请重新启动预览')
    expect(pc.close).toHaveBeenCalledOnce()
  })

  it('caps a long device scrcpy error to one bounded line', async () => {
    await openSignalingConnection()
    await receiveOffer()
    sendSocketMessage({ message_type: 'device_msg', payload: { type: 'scrcpy_error', message: 'E'.repeat(400) } })

    expect(hook!.error).toBe(`${'E'.repeat(300)}…`)
  })

  it('times out an open socket that never sends signaling configuration', async () => {
    await openSignalingConnection()
    await act(async () => vi.advanceTimersByTimeAsync(12000))

    expect(hook!.status).toBe('error')
    expect(hook!.error).toContain('等待信令配置超时')
    expect(MockWebSocket.instances[0]!.readyState).toBe(MockWebSocket.CLOSED)
  })

  it('times out waiting for an offer with a new deadline after configuration', async () => {
    await openSignalingConnection()
    await act(async () => vi.advanceTimersByTimeAsync(10000))
    sendSocketMessage({ message_type: 'config', ice_servers: [] })
    await act(async () => vi.advanceTimersByTimeAsync(11999))
    expect(hook!.status).toBe('waiting_offer')

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(hook!.status).toBe('error')
    expect(hook!.error).toContain('等待设备预览响应超时')
  })

  it('times out a connected peer that never receives video', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    act(() => {
      pc.connectionState = 'connected'
      pc.onconnectionstatechange?.()
    })
    expect(hook!.status).toBe('connecting_webrtc')

    await act(async () => vi.advanceTimersByTimeAsync(20000))

    expect(hook!.status).toBe('error')
    expect(hook!.error).toContain('建立预览视频连接超时')
    expect(pc.close).toHaveBeenCalledOnce()
    expect(MockWebSocket.instances[0]!.readyState).toBe(MockWebSocket.CLOSED)
  })

  it.each([true, false])('sends an immediate answer and trickles candidates when SDP advertises trickle=%s', async (advertisesTrickle) => {
    vi.stubGlobal('RTCPeerConnection', class extends MockPeerConnection {
      override iceGatheringState = 'gathering' as const
      override canTrickleIceCandidates = advertisesTrickle
    })
    await openSignalingConnection()
    const pc = await receiveOffer()
    const socket = MockWebSocket.instances[0]!
    const answers = () => socket.send.mock.calls
      .map(([message]) => JSON.parse(message as string))
      .filter(message => message.payload?.type === 'answer')

    expect(answers()).toHaveLength(1)
    expect(pc.iceGatheringState).toBe('gathering')
    act(() => pc.onicecandidate?.({
      candidate: { candidate: 'candidate:1 1 udp 1 192.168.1.2 5000 typ relay', sdpMid: '0', sdpMLineIndex: 0 },
    } as RTCPeerConnectionIceEvent))
    expect(JSON.parse(socket.send.mock.calls[socket.send.mock.calls.length - 1]![0] as string).payload.type).toBe('ice-candidate')
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(answers()).toHaveLength(1)
  })

  it('times out a stalled answer and ignores its eventual result', async () => {
    const answer = deferred<{ type: 'answer'; sdp: string }>()
    vi.stubGlobal('RTCPeerConnection', class extends MockPeerConnection {
      override createAnswer = vi.fn(() => answer.promise)
    })
    await openSignalingConnection()
    const pc = await receiveOffer()
    expect(pc.createAnswer).toHaveBeenCalledOnce()

    await act(async () => vi.advanceTimersByTimeAsync(20000))
    await act(async () => answer.resolve({ type: 'answer', sdp: 'v=0\r\n' }))
    await flushAsyncWork()

    expect(hook!.status).toBe('error')
    expect(pc.close).toHaveBeenCalledOnce()
    expect(pc.setLocalDescription).not.toHaveBeenCalled()
  })

  it('finishes connecting when the remote video becomes live and clears its deadline', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    const track = new MockMediaTrack()
    track.muted = true
    receiveTrack(pc, track)
    act(() => {
      pc.connectionState = 'connected'
      pc.onconnectionstatechange?.()
    })
    expect(hook!.status).toBe('connecting_webrtc')

    act(() => {
      track.muted = false
      track.dispatchEvent(new Event('unmute'))
    })
    expect(hook!.status).toBe('connected')
    await act(async () => vi.advanceTimersByTimeAsync(21000))
    expect(hook!.status).toBe('connected')
    expect(pc.close).not.toHaveBeenCalled()
  })

  it('tears down a hidden React Activity and does not resume its preview on reveal', async () => {
    await openSignalingConnection()
    const pc = await receiveOffer()
    const track = receiveTrack(pc)
    const video = container.querySelector('video')!

    await act(async () => root.render(<Activity mode="hidden"><Harness /></Activity>))
    expect(pc.close).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(MockWebSocket.instances[0]!.readyState).toBe(MockWebSocket.CLOSED)
    expect(video.srcObject).toBeNull()

    await act(async () => root.render(<Activity mode="visible"><Harness /></Activity>))
    await act(async () => vi.advanceTimersByTimeAsync(21000))
    expect(hook!.status).toBe('disconnected')
    expect(hook!.mediaStream).toBeNull()
    expect(MockWebSocket.instances).toHaveLength(1)
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
      getReceivers = vi.fn(() => [])
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
