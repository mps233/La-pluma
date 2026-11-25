// @vitest-environment jsdom

import { Activity, act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewSessionProvider } from './PreviewSessionProvider'
import { usePreviewSession } from '../hooks/usePreviewSession'
import { usePreviewSnapshot } from '../hooks/usePreviewSnapshot'
import { usePreviewStore } from '../store/previewStore'
import { usePreviewSessionContext } from '../hooks/previewSessionContext'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  available: true,
  startWebrtc: vi.fn(),
  captureScreen: vi.fn(),
  getWebrtcStatus: vi.fn(),
  installWebrtc: vi.fn(),
  startWebrtcServer: vi.fn(),
  stopWebrtcServer: vi.fn(),
  startWebrtcAgent: vi.fn(),
  stopWebrtcAgent: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendTouch: vi.fn(),
  sendCommand: vi.fn(),
  stream: null as MediaStream | null,
}))

vi.mock('@/features/runtime-status', () => ({
  useAutomationAvailability: () => ({ isAvailable: mocks.available }),
}))
vi.mock('../api', () => ({
  startWebrtc: mocks.startWebrtc,
  captureScreen: mocks.captureScreen,
  getWebrtcStatus: mocks.getWebrtcStatus,
  installWebrtc: mocks.installWebrtc,
  startWebrtcServer: mocks.startWebrtcServer,
  stopWebrtcServer: mocks.stopWebrtcServer,
  startWebrtcAgent: mocks.startWebrtcAgent,
  stopWebrtcAgent: mocks.stopWebrtcAgent,
}))
vi.mock('../hooks/useScrcpyWebRTC', () => ({
  useScrcpyWebRTC: () => ({
    status: mocks.stream ? 'connected' : 'idle',
    error: null,
    stats: null,
    inputReady: false,
    mediaStream: mocks.stream,
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    sendTouch: mocks.sendTouch,
    sendCommand: mocks.sendCommand,
  }),
}))

const started = () => ({ success: true, data: { signalingUrl: '/webrtc-signaling' } })
const captured = () => ({ success: true, data: { image: 'shared-snapshot' } })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

let session: ReturnType<typeof usePreviewSession>
let infrastructure: ReturnType<typeof usePreviewSessionContext>['infrastructure']
let visibility: DocumentVisibilityState
let container: HTMLDivElement
let root: Root

function PreviewView({ name }: { name: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const current = usePreviewSession({
    videoRef,
  })
  const snapshot = usePreviewSnapshot()
  const context = usePreviewSessionContext()
  useEffect(() => {
    session = current
    infrastructure = context.infrastructure
  })
  return <video aria-label={name} ref={videoRef} data-image={snapshot.image} data-error={current.error} data-service-loading={context.infrastructure.view.infrastructureLoading} />
}

async function renderWorkspace(active: 'first' | 'second' | null = 'first') {
  await act(async () => root.render(
    <PreviewSessionProvider>
      <Activity mode={active === 'first' ? 'visible' : 'hidden'}><PreviewView name="first" /></Activity>
      <Activity mode={active === 'second' ? 'visible' : 'hidden'}><PreviewView name="second" /></Activity>
    </PreviewSessionProvider>,
  ))
}

async function selectMode(mode: 'off' | 'snapshot' | 'live') {
  await act(async () => usePreviewStore.getState().setMode(mode))
}

describe('PreviewSessionProvider workspace lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.available = true
    mocks.stream = null
    mocks.startWebrtc.mockReset().mockResolvedValue(started())
    mocks.captureScreen.mockReset().mockResolvedValue(captured())
    mocks.getWebrtcStatus.mockReset().mockResolvedValue({ success: true, data: { serverRunning: true, agentRunning: true } })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    usePreviewStore.setState({ mode: 'off' })
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps one pending startup while Activity consumers change or all become hidden', async () => {
    const pending = deferred<ReturnType<typeof started>>()
    mocks.startWebrtc.mockReturnValueOnce(pending.promise)
    await selectMode('live')
    await renderWorkspace()
    const signal = mocks.startWebrtc.mock.calls[0]?.[2] as AbortSignal

    await renderWorkspace('second')
    await renderWorkspace(null)
    await renderWorkspace('first')
    expect(signal.aborted).toBe(false)
    expect(mocks.startWebrtc).toHaveBeenCalledOnce()
    expect(mocks.disconnect).not.toHaveBeenCalled()

    await act(async () => pending.resolve(started()))
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('/webrtc-signaling')
  })

  it('recovers known infrastructure after backend recovery triggers a failed live startup', async () => {
    mocks.available = false
    mocks.getWebrtcStatus.mockRejectedValueOnce(new Error('状态读取失败'))
    await selectMode('live')
    await renderWorkspace()
    expect(infrastructure.view.infrastructureStatus).toBeNull()
    expect(infrastructure.view.infrastructureError).toBe('状态读取失败')
    expect(mocks.startWebrtc).not.toHaveBeenCalled()

    const status = { success: true, data: { installed: true, built: true, serverRunning: true, agentRunning: false } }
    const recoveryStatus = deferred<typeof status>()
    const startup = deferred<{ success: boolean; message: string }>()
    mocks.getWebrtcStatus.mockReturnValueOnce(recoveryStatus.promise).mockResolvedValue(status)
    mocks.startWebrtc.mockReturnValueOnce(startup.promise)
    mocks.available = true
    await renderWorkspace('second')
    expect(mocks.getWebrtcStatus).toHaveBeenCalledTimes(2)
    expect(mocks.startWebrtc).toHaveBeenCalledOnce()

    await act(async () => recoveryStatus.resolve(status))
    expect(infrastructure.view.infrastructureStatus).toBeNull()
    await act(async () => startup.resolve({ success: false, message: 'Agent 启动失败' }))

    expect(infrastructure.view.infrastructureStatus).toEqual(status.data)
    expect(infrastructure.view.infrastructureStatusState).toBe('ready')
    expect(infrastructure.view.infrastructureLoading).toBeNull()
    expect(infrastructure.view.infrastructureError).toBe('Agent 启动失败')
    expect(session.error).toBe('Agent 启动失败')
    expect(mocks.getWebrtcStatus).toHaveBeenCalledTimes(3)
    expect(mocks.startWebrtc).toHaveBeenCalledOnce()
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('attaches the same connected media stream to the next visible view without reconnecting', async () => {
    const stop = vi.fn()
    mocks.stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
    await selectMode('live')
    await renderWorkspace()
    const first = container.querySelector<HTMLVideoElement>('[aria-label="first"]')!
    expect(first.srcObject).toBe(mocks.stream)

    await renderWorkspace('second')
    const second = container.querySelector<HTMLVideoElement>('[aria-label="second"]')!
    expect(first.srcObject).toBeNull()
    expect(second.srcObject).toBe(mocks.stream)
    await renderWorkspace('first')
    expect(container.querySelector<HTMLVideoElement>('[aria-label="first"]')!.srcObject).toBe(mocks.stream)
    expect(mocks.startWebrtc).toHaveBeenCalledOnce()
    expect(mocks.connect).toHaveBeenCalledOnce()
    expect(mocks.disconnect).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  it('shares an in-flight snapshot and its refresh timer between workspaces', async () => {
    const pending = deferred<ReturnType<typeof captured>>()
    mocks.captureScreen.mockReturnValueOnce(pending.promise)
    await selectMode('snapshot')
    await renderWorkspace()
    const signal = mocks.captureScreen.mock.calls[0]?.[1] as AbortSignal
    await renderWorkspace('second')
    expect(signal.aborted).toBe(false)
    expect(mocks.captureScreen).toHaveBeenCalledOnce()

    await act(async () => pending.resolve(captured()))
    expect(container.querySelector('[aria-label="second"]')?.getAttribute('data-image')).toBe('data:image/png;base64,shared-snapshot')
    await renderWorkspace('first')
    expect(container.querySelector('[aria-label="first"]')?.getAttribute('data-image')).toBe('data:image/png;base64,shared-snapshot')
    await act(async () => vi.advanceTimersByTimeAsync(10000))
    expect(mocks.captureScreen).toHaveBeenCalledTimes(2)
  })

  it('keeps infrastructure actions serialized while their initiating workspace hides', async () => {
    const pending = deferred<{ success: boolean }>()
    mocks.installWebrtc.mockReturnValueOnce(pending.promise)
    await renderWorkspace()
    await act(async () => { void infrastructure.view.onInstall() })
    await renderWorkspace('second')
    expect(container.querySelector('[aria-label="second"]')?.getAttribute('data-service-loading')).toBe('install')
    await act(async () => { void infrastructure.view.onToggleServer() })
    expect(mocks.stopWebrtcServer).not.toHaveBeenCalled()

    await act(async () => pending.resolve({ success: true }))
    expect(container.querySelector('[aria-label="second"]')?.getAttribute('data-service-loading')).toBeNull()
    expect(mocks.getWebrtcStatus).toHaveBeenCalledTimes(2)
  })

  it.each(['install', 'agent'] as const)('waits for a pending %s operation before starting selected live mode', async operation => {
    const pending = deferred<{ success: boolean }>()
    mocks.getWebrtcStatus.mockResolvedValue({ success: true, data: { serverRunning: true, agentRunning: false } })
    const request = operation === 'install' ? mocks.installWebrtc : mocks.startWebrtcAgent
    request.mockReturnValueOnce(pending.promise)
    await renderWorkspace()
    await act(async () => {
      void (operation === 'install' ? infrastructure.view.onInstall() : infrastructure.view.onToggleAgent())
    })
    await renderWorkspace('second')
    await selectMode('live')
    expect(session.isConnecting).toBe(true)
    expect(session.error).toBeNull()
    expect(mocks.startWebrtc).not.toHaveBeenCalled()

    await act(async () => pending.resolve({ success: true }))
    expect(mocks.startWebrtc).toHaveBeenCalledOnce()
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('/webrtc-signaling')
    expect(session.error).toBeNull()
  })

  it('stays off if live mode is cancelled while waiting for another infrastructure operation', async () => {
    const pending = deferred<{ success: boolean }>()
    mocks.installWebrtc.mockReturnValueOnce(pending.promise)
    await renderWorkspace()
    await act(async () => { void infrastructure.view.onInstall() })
    await selectMode('live')
    expect(session.isConnecting).toBe(true)
    await act(async () => session.disconnect())
    await renderWorkspace('second')
    await act(async () => pending.resolve({ success: true }))
    expect(usePreviewStore.getState().mode).toBe('off')
    expect(mocks.startWebrtc).not.toHaveBeenCalled()
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(session.error).toBeNull()
  })

  it('aborts startup on actual provider unmount and ignores its late response', async () => {
    const pending = deferred<ReturnType<typeof started>>()
    mocks.startWebrtc.mockReturnValueOnce(pending.promise)
    await selectMode('live')
    await renderWorkspace()
    const signal = mocks.startWebrtc.mock.calls[0]?.[2] as AbortSignal
    await act(async () => root.render(null))
    expect(signal.aborted).toBe(true)
    expect(mocks.disconnect).toHaveBeenCalledOnce()
    await act(async () => pending.resolve(started()))
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('keeps an explicitly closed preview off after switching workspaces', async () => {
    await selectMode('live')
    await renderWorkspace()
    await act(async () => session.disconnect())
    await renderWorkspace('second')
    expect(usePreviewStore.getState().mode).toBe('off')
    expect(mocks.disconnect).toHaveBeenCalled()
    expect(mocks.startWebrtc).toHaveBeenCalledOnce()
    expect(mocks.connect).toHaveBeenCalledOnce()
  })

  it('reconnects once when quality settings are explicitly applied from the current view', async () => {
    await selectMode('live')
    await renderWorkspace()
    await act(async () => usePreviewStore.getState().setQuality('hd'))
    expect(mocks.startWebrtc).toHaveBeenCalledOnce()
    await act(async () => session.connect())
    expect(mocks.startWebrtc).toHaveBeenCalledTimes(2)
    expect(mocks.connect).toHaveBeenCalledTimes(2)
    await renderWorkspace('second')
    expect(mocks.startWebrtc).toHaveBeenCalledTimes(2)
  })

  it('pauses the shared preview for actual document visibility and stops it after the grace period', async () => {
    await selectMode('live')
    await renderWorkspace()
    visibility = 'hidden'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(session.paused).toBe(true)
    expect(mocks.disconnect).not.toHaveBeenCalled()
    await renderWorkspace('second')
    expect(mocks.startWebrtc).toHaveBeenCalledOnce()

    await act(async () => vi.advanceTimersByTimeAsync(180_000))
    expect(mocks.disconnect).toHaveBeenCalledOnce()
  })

  it('keeps the shared connection when the page returns within the grace period', async () => {
    await selectMode('live')
    await renderWorkspace()
    visibility = 'hidden'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => vi.advanceTimersByTimeAsync(60_000))

    visibility = 'visible'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(session.paused).toBe(false)
    expect(mocks.disconnect).not.toHaveBeenCalled()
    expect(mocks.startWebrtc).toHaveBeenCalledOnce()
    expect(mocks.connect).toHaveBeenCalledOnce()
  })

  it('reconnects after the hidden grace period expired', async () => {
    await selectMode('live')
    await renderWorkspace()
    visibility = 'hidden'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => vi.advanceTimersByTimeAsync(180_000))
    expect(mocks.disconnect).toHaveBeenCalledOnce()

    visibility = 'visible'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(mocks.startWebrtc).toHaveBeenCalledTimes(2)
    expect(mocks.connect).toHaveBeenCalledTimes(2)
  })
})
