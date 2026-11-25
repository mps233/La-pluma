// @vitest-environment jsdom

import { Activity, act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreviewStore } from '../store/previewStore'
import { usePreviewSessionOwner } from './usePreviewSessionOwner'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  startWebrtc: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendTouch: vi.fn(),
  sendCommand: vi.fn(),
}))

vi.mock('../api', () => ({
  startWebrtc: mocks.startWebrtc,
}))

vi.mock('./useScrcpyWebRTC', () => ({
  useScrcpyWebRTC: () => ({
    status: 'idle',
    error: null,
    stats: null,
    inputReady: false,
    mediaStream: null,
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    sendTouch: mocks.sendTouch,
    sendCommand: mocks.sendCommand,
  }),
}))

const started = () => ({ success: true, data: { signalingUrl: '/webrtc-signaling' } })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

let session: ReturnType<typeof usePreviewSessionOwner>
let visibility: DocumentVisibilityState
let container: HTMLDivElement
let root: Root

function Harness({ available = true }: { available?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const current = usePreviewSessionOwner({ videoRef, deviceId: 'preview-device', automationAvailable: available })
  useEffect(() => { session = current })
  return <video ref={videoRef} data-preview-error={current.error} data-starting={current.starting} />
}

async function renderActivity(mode: 'visible' | 'hidden' = 'visible', available = true) {
  await act(async () => root.render(<Activity mode={mode}><Harness available={available} /></Activity>))
}

async function selectMode(mode: 'off' | 'snapshot' | 'live') {
  await act(async () => usePreviewStore.getState().setMode(mode))
}

describe('usePreviewSessionOwner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.startWebrtc.mockReset().mockResolvedValue(started())
    usePreviewStore.setState({ mode: 'off', quality: 'smooth', customFps: 30, customMaxSize: 640, customBitrateMbps: 4 })
    window.localStorage.clear()
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('does not start infrastructure until live mode is explicitly selected and available', async () => {
    await renderActivity()
    await act(async () => vi.advanceTimersByTimeAsync(60000))
    expect(mocks.startWebrtc).not.toHaveBeenCalled()
    expect(mocks.connect).not.toHaveBeenCalled()

    await selectMode('snapshot')
    expect(mocks.startWebrtc).not.toHaveBeenCalled()

    await renderActivity('visible', false)
    await selectMode('live')
    expect(mocks.startWebrtc).not.toHaveBeenCalled()

    await renderActivity()
    expect(mocks.startWebrtc).toHaveBeenCalledWith('default', 'preview-device', expect.any(AbortSignal))
    expect(mocks.connect).toHaveBeenCalledWith('/webrtc-signaling')
  })

  it('aborts startup when switched off and ignores a late successful response', async () => {
    const pending = deferred<ReturnType<typeof started>>()
    mocks.startWebrtc.mockReturnValue(pending.promise)
    await renderActivity()
    await selectMode('live')
    const signal = mocks.startWebrtc.mock.calls[0]?.[2] as AbortSignal
    expect(session.starting).toBe(true)

    await selectMode('off')
    expect(signal.aborted).toBe(true)
    expect(mocks.disconnect).toHaveBeenCalled()
    await act(async () => pending.resolve(started()))

    expect(mocks.connect).not.toHaveBeenCalled()
    expect(session).toMatchObject({ mode: 'off', starting: false, error: null })
  })

  it('disconnects and aborts startup while the browser page is hidden', async () => {
    const pending = deferred<ReturnType<typeof started>>()
    mocks.startWebrtc.mockReturnValue(pending.promise)
    await renderActivity()
    await selectMode('live')
    const signal = mocks.startWebrtc.mock.calls[0]?.[2] as AbortSignal

    visibility = 'hidden'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(signal.aborted).toBe(true)
    expect(session.paused).toBe(true)
    expect(mocks.disconnect).toHaveBeenCalled()
    await act(async () => pending.resolve(started()))
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('keeps a connected preview through a short page hide and stops it after the grace period', async () => {
    await renderActivity()
    await selectMode('live')
    expect(mocks.connect).toHaveBeenCalledOnce()

    visibility = 'hidden'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(session.paused).toBe(true)
    expect(mocks.disconnect).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(179_000))
    expect(mocks.disconnect).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(mocks.disconnect).toHaveBeenCalledOnce()
  })

  it('reuses the connection when the page returns within the grace period', async () => {
    await renderActivity()
    await selectMode('live')

    visibility = 'hidden'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => vi.advanceTimersByTimeAsync(60_000))

    visibility = 'visible'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(session.paused).toBe(false)
    expect(mocks.disconnect).not.toHaveBeenCalled()
    expect(mocks.startWebrtc).toHaveBeenCalledOnce()
    expect(mocks.connect).toHaveBeenCalledOnce()

    await act(async () => vi.advanceTimersByTimeAsync(180_000))
    expect(mocks.disconnect).not.toHaveBeenCalled()
  })

  it('reconnects after the hidden grace period expired', async () => {
    await renderActivity()
    await selectMode('live')

    visibility = 'hidden'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => vi.advanceTimersByTimeAsync(180_000))
    expect(mocks.disconnect).toHaveBeenCalledOnce()

    visibility = 'visible'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(session.paused).toBe(false)
    expect(mocks.startWebrtc).toHaveBeenCalledTimes(2)
    expect(mocks.connect).toHaveBeenCalledTimes(2)
  })

  it('resumes live mode when Activity returns and remains stopped if mode changed while hidden', async () => {
    await renderActivity()
    await selectMode('live')
    expect(mocks.connect).toHaveBeenCalledTimes(1)

    await renderActivity('hidden')
    expect(mocks.disconnect).toHaveBeenCalled()
    await renderActivity('visible')
    expect(mocks.startWebrtc).toHaveBeenCalledTimes(2)
    expect(mocks.connect).toHaveBeenCalledTimes(2)

    await renderActivity('hidden')
    await selectMode('off')
    await renderActivity('visible')
    expect(mocks.startWebrtc).toHaveBeenCalledTimes(2)
    expect(mocks.connect).toHaveBeenCalledTimes(2)
    expect(session.mode).toBe('off')
  })

  it('reports a bounded startup timeout and lets the user retry', async () => {
    mocks.startWebrtc.mockImplementation(() => new Promise(() => {}))
    await renderActivity()
    await selectMode('live')
    const signal = mocks.startWebrtc.mock.calls[0]?.[2] as AbortSignal

    await act(async () => vi.advanceTimersByTimeAsync(45000))
    expect(signal.aborted).toBe(true)
    expect(session.starting).toBe(false)
    expect(session.error).toMatch(/启动超时.*重试/)
    expect(container.querySelector('video')?.getAttribute('data-preview-error')).toMatch(/启动超时/)
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.disconnect).toHaveBeenCalled()

    mocks.startWebrtc.mockResolvedValue(started())
    await act(async () => session.connect())
    expect(mocks.startWebrtc).toHaveBeenCalledTimes(2)
    expect(mocks.connect).toHaveBeenCalledWith('/webrtc-signaling')
    expect(session.error).toBeNull()
  })
})
