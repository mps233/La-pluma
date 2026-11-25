// @vitest-environment jsdom

import { Activity, act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutomationAvailability } from '@/features/runtime-status'
import { usePreviewInfrastructure } from './usePreviewInfrastructure'
import { usePreviewSessionOwner } from './usePreviewSessionOwner'
import { usePreviewStore } from '../store/previewStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const availabilityMock = vi.hoisted(() => ({
  isAvailable: false,
  unavailableMessage: '正在检查后端服务，请稍候',
}))

const apiMocks = vi.hoisted(() => ({
  getWebrtcStatus: vi.fn(),
  startWebrtc: vi.fn(),
  installWebrtc: vi.fn(),
  startWebrtcServer: vi.fn(),
  stopWebrtcServer: vi.fn(),
  startWebrtcAgent: vi.fn(),
  stopWebrtcAgent: vi.fn(),
}))

const transportMock = vi.hoisted(() => ({
  status: 'idle',
  error: null as string | null,
  inputReady: false,
  mediaStream: null as MediaStream | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendTouch: vi.fn(),
  sendCommand: vi.fn(),
}))

vi.mock('@/features/runtime-status', () => ({
  useAutomationAvailability: () => availabilityMock,
}))

vi.mock('../api', () => apiMocks)

vi.mock('./useScrcpyWebRTC', () => ({
  useScrcpyWebRTC: () => ({
    status: transportMock.status,
    error: transportMock.error,
    stats: null,
    inputReady: transportMock.inputReady,
    mediaStream: transportMock.mediaStream,
    connect: transportMock.connect,
    disconnect: transportMock.disconnect,
    sendTouch: transportMock.sendTouch,
    sendCommand: transportMock.sendCommand,
    setStatsEnabled: vi.fn(),
  }),
}))

let latestSession: ReturnType<typeof usePreviewSessionOwner> | null = null

function PreviewSessionHarness() {
  const { isAvailable } = useAutomationAvailability()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const infrastructure = usePreviewInfrastructure()
  const view = infrastructure.view
  const session = usePreviewSessionOwner({
    videoRef,
    deviceId: 'mumu-la-pluma',
    signalingUrl: '/webrtc-signaling',
    automationAvailable: isAvailable,
    infrastructureBusy: view.infrastructureLoading !== null && view.infrastructureLoading !== 'preview',
    connectionPath: 'auto',
    ipPreference: 'ipv4',
    startInfrastructure: infrastructure.start,
    cancelInfrastructure: infrastructure.cancel,
  })
  useEffect(() => { latestSession = session })
  return (
    <div
      data-view
      data-available={String(view.automationAvailable)}
      data-message={view.automationUnavailableMessage}
      data-status-state={view.infrastructureStatusState}
      data-loading={view.infrastructureLoading || ''}
      data-error={view.infrastructureError || ''}
      data-has-status={String(Boolean(view.infrastructureStatus))}
      data-server-running={String(Boolean(view.infrastructureStatus?.serverRunning))}
      data-agent-running={String(Boolean(view.infrastructureStatus?.agentRunning))}
    >
      <video ref={videoRef} />
      <button type="button" onClick={() => void view.onInstall()}>install</button>
      <button type="button" onClick={() => void view.onToggleServer()}>server</button>
      <button type="button" onClick={() => void view.onToggleAgent()}>agent</button>
    </div>
  )
}

let container: HTMLDivElement
let root: Root
let visibility: DocumentVisibilityState

const viewData = (name: string) => container.querySelector('[data-view]')?.getAttribute(name)

const click = async (label: string) => {
  const button = Array.from(container.querySelectorAll('button'))
    .find(candidate => candidate.textContent === label)
  await act(async () => button?.click())
}

const flush = async () => {
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve()
  })
}

const currentSession = () => {
  if (!latestSession) throw new Error('preview session is not mounted')
  return latestSession
}

const connectPreview = async () => {
  await act(async () => currentSession().connect())
  await flush()
}

const setMode = async (mode: 'off' | 'snapshot' | 'live') => {
  await act(async () => usePreviewStore.getState().setMode(mode))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('usePreviewInfrastructure automation availability guard', () => {
  beforeEach(() => {
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    usePreviewStore.setState({ mode: 'off', quality: 'smooth', customFps: 30, customMaxSize: 640, customBitrateMbps: 4 })
    availabilityMock.isAvailable = false
    availabilityMock.unavailableMessage = '正在检查后端服务，请稍候'
    transportMock.status = 'idle'
    transportMock.error = null
    transportMock.inputReady = false
    transportMock.mediaStream = null
    vi.resetAllMocks()
    apiMocks.getWebrtcStatus.mockResolvedValue({
      success: true,
      data: { installed: true, built: true, serverRunning: false, agentRunning: false },
    })
    apiMocks.startWebrtc.mockResolvedValue({ success: true, data: { signalingUrl: '/webrtc-signaling' } })
    apiMocks.installWebrtc.mockResolvedValue({ success: true })
    apiMocks.startWebrtcServer.mockResolvedValue({ success: true })
    apiMocks.stopWebrtcServer.mockResolvedValue({ success: true })
    apiMocks.startWebrtcAgent.mockResolvedValue({ success: true })
    apiMocks.stopWebrtcAgent.mockResolvedValue({ success: true })
    window.localStorage.clear()
    latestSession = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it.each([
    ['checking', '正在检查后端服务，请稍候'],
    ['unavailable', '后端服务暂不可用，请确认服务已启动'],
  ])('blocks API side effects while backend is %s', async (_state, message) => {
    availabilityMock.unavailableMessage = message
    await act(async () => root.render(<PreviewSessionHarness />))
    await flush()

    expect(viewData('data-available')).toBe('false')
    expect(viewData('data-message')).toBe(message)

    await connectPreview()
    await click('install')
    await click('agent')
    await click('server')

    expect(apiMocks.startWebrtc).not.toHaveBeenCalled()
    expect(transportMock.connect).not.toHaveBeenCalled()
    expect(apiMocks.installWebrtc).not.toHaveBeenCalled()
    expect(apiMocks.startWebrtcServer).not.toHaveBeenCalled()
    expect(apiMocks.startWebrtcAgent).not.toHaveBeenCalled()
  })

  it('allows stop actions while unavailable so an existing preview can recover', async () => {
    apiMocks.getWebrtcStatus.mockResolvedValueOnce({
      success: true,
      data: { installed: true, built: true, serverRunning: true, agentRunning: true },
    }).mockResolvedValueOnce({
      success: true,
      data: { installed: true, built: true, serverRunning: true, agentRunning: false },
    })
    await act(async () => root.render(<PreviewSessionHarness />))
    await flush()

    await setMode('live')
    await click('agent')
    expect(usePreviewStore.getState().mode).toBe('off')
    await setMode('live')
    await click('server')
    expect(usePreviewStore.getState().mode).toBe('off')

    expect(apiMocks.stopWebrtcServer).toHaveBeenCalledOnce()
    expect(apiMocks.stopWebrtcAgent).toHaveBeenCalledOnce()
    expect(apiMocks.startWebrtcServer).not.toHaveBeenCalled()
    expect(apiMocks.startWebrtcAgent).not.toHaveBeenCalled()
    expect(apiMocks.startWebrtc).not.toHaveBeenCalled()
  })

  it('reports an explicit error state instead of treating an unknown status as stopped', async () => {
    availabilityMock.isAvailable = true
    apiMocks.getWebrtcStatus.mockRejectedValueOnce(new Error('状态读取失败'))
    await act(async () => root.render(<PreviewSessionHarness />))
    await flush()

    expect(viewData('data-status-state')).toBe('error')
    expect(viewData('data-has-status')).toBe('false')
    expect(viewData('data-error')).toBe('状态读取失败')
  })

  it.each(['unknown', 'stopped'] as const)('resynchronizes %s infrastructure when the document becomes visible', async status => {
    availabilityMock.isAvailable = true
    if (status === 'unknown') apiMocks.getWebrtcStatus.mockRejectedValueOnce(new Error('状态读取失败'))
    await act(async () => root.render(<PreviewSessionHarness />))
    await flush()
    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledOnce()

    visibility = 'hidden'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledOnce()
    apiMocks.getWebrtcStatus.mockResolvedValue({
      success: true,
      data: { installed: true, built: true, serverRunning: true, agentRunning: false },
    })
    visibility = 'visible'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await flush()

    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledTimes(2)
    expect(viewData('data-status-state')).toBe('ready')
    expect(viewData('data-server-running')).toBe('true')
    expect(viewData('data-error')).toBe('')
  })

  it('preserves an action failure across a successful background status refresh', async () => {
    vi.useFakeTimers()
    availabilityMock.isAvailable = true
    apiMocks.getWebrtcStatus.mockResolvedValue({
      success: true,
      data: { installed: true, built: true, serverRunning: true, agentRunning: true },
    })
    apiMocks.installWebrtc.mockRejectedValueOnce(new Error('安装失败'))
    await act(async () => root.render(<PreviewSessionHarness />))
    await click('install')
    expect(viewData('data-error')).toBe('安装失败')
    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledTimes(2)

    await act(async () => vi.advanceTimersByTimeAsync(4000))

    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledTimes(3)
    expect(viewData('data-status-state')).toBe('ready')
    expect(viewData('data-error')).toBe('安装失败')
  })

  it('keeps an in-flight operation intact through backend and foreground recovery', async () => {
    availabilityMock.isAvailable = true
    const pending = deferred<{ success: boolean }>()
    apiMocks.installWebrtc.mockReturnValueOnce(pending.promise)
    await act(async () => root.render(<PreviewSessionHarness />))
    await click('install')
    availabilityMock.isAvailable = false
    await act(async () => root.render(<PreviewSessionHarness />))
    visibility = 'hidden'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    availabilityMock.isAvailable = true
    await act(async () => root.render(<PreviewSessionHarness />))
    visibility = 'visible'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))

    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledOnce()
    expect(viewData('data-loading')).toBe('install')
    await click('server')
    expect(apiMocks.startWebrtcServer).not.toHaveBeenCalled()

    await act(async () => pending.resolve({ success: true }))
    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledTimes(2)
    expect(viewData('data-loading')).toBe('')
    expect(viewData('data-status-state')).toBe('ready')
  })

  it('serializes service operations so a second action cannot overtake the first', async () => {
    availabilityMock.isAvailable = true
    let resolveInstall: ((value: { success: boolean }) => void) | undefined
    apiMocks.installWebrtc.mockImplementationOnce(() => new Promise(resolve => {
      resolveInstall = resolve
    }))
    await act(async () => root.render(<PreviewSessionHarness />))
    await flush()

    await click('install')
    await click('server')

    expect(apiMocks.installWebrtc).toHaveBeenCalledOnce()
    expect(apiMocks.startWebrtcServer).not.toHaveBeenCalled()

    await act(async () => resolveInstall?.({ success: true }))
    await flush()
    await click('server')
    await flush()

    expect(apiMocks.startWebrtcServer).toHaveBeenCalledOnce()
  })

  it('does not start preview while another infrastructure action is pending', async () => {
    availabilityMock.isAvailable = true
    let resolveAgent: ((value: { success: boolean }) => void) | undefined
    apiMocks.startWebrtcAgent.mockImplementationOnce(() => new Promise(resolve => {
      resolveAgent = resolve
    }))
    apiMocks.getWebrtcStatus.mockResolvedValue({
      success: true,
      data: { installed: true, built: true, serverRunning: true, agentRunning: false },
    })
    await act(async () => root.render(<PreviewSessionHarness />))
    await flush()

    await click('agent')
    await connectPreview()

    expect(apiMocks.startWebrtcAgent).toHaveBeenCalledOnce()
    expect(apiMocks.startWebrtc).not.toHaveBeenCalled()
    expect(transportMock.connect).not.toHaveBeenCalled()

    await act(async () => resolveAgent?.({ success: true }))
    await flush()

    expect(apiMocks.startWebrtc).toHaveBeenCalledOnce()
    expect(transportMock.connect).toHaveBeenCalledWith('/webrtc-signaling')
  })

  it('ignores an initial status response that resolves after preview startup', async () => {
    availabilityMock.isAvailable = true
    let resolveInitial: ((value: { success: boolean; data: { serverRunning: boolean } }) => void) | undefined
    apiMocks.getWebrtcStatus.mockImplementationOnce(() => new Promise(resolve => {
      resolveInitial = resolve
    }))
    apiMocks.startWebrtc.mockResolvedValueOnce({
      success: true,
      data: { signalingUrl: '/webrtc-signaling', serverRunning: true, agentRunning: true },
    })

    await act(async () => root.render(<PreviewSessionHarness />))
    await connectPreview()
    expect(viewData('data-server-running')).toBe('true')

    await act(async () => resolveInitial?.({ success: true, data: { serverRunning: false } }))
    await flush()

    expect(viewData('data-server-running')).toBe('true')
  })

  it('ignores a stale stopped status requested before an already-live startup completes', async () => {
    availabilityMock.isAvailable = true
    await setMode('live')
    const statusPending = deferred<{ success: boolean; data: { installed: boolean; built: boolean; serverRunning: boolean; agentRunning: boolean } }>()
    apiMocks.getWebrtcStatus.mockReturnValueOnce(statusPending.promise)
    const startPending = deferred<{
      success: boolean
      data: { signalingUrl: string; serverRunning: boolean; agentRunning: boolean }
    }>()
    apiMocks.startWebrtc.mockReturnValueOnce(startPending.promise)

    await act(async () => root.render(<PreviewSessionHarness />))
    await flush()
    expect(apiMocks.startWebrtc).toHaveBeenCalledOnce()
    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledOnce()

    await act(async () => startPending.resolve({
      success: true,
      data: { signalingUrl: '/webrtc-signaling', serverRunning: true, agentRunning: true },
    }))
    await flush()
    expect(viewData('data-server-running')).toBe('true')
    expect(viewData('data-status-state')).toBe('ready')

    await act(async () => statusPending.resolve({
      success: true,
      data: { installed: true, built: true, serverRunning: false, agentRunning: false },
    }))
    await flush()
    expect(viewData('data-server-running')).toBe('true')
    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledOnce()
  })

  it('clears pending preview startup across an Activity hide and ignores its hidden response', async () => {
    availabilityMock.isAvailable = true
    const pending = deferred<{ success: boolean; data: { signalingUrl: string; serverRunning: boolean } }>()
    apiMocks.startWebrtc.mockReturnValueOnce(pending.promise)
    await act(async () => root.render(<Activity mode="visible"><PreviewSessionHarness /></Activity>))
    await flush()

    await connectPreview()
    expect(viewData('data-loading')).toBe('preview')
    expect(apiMocks.startWebrtc).toHaveBeenCalledOnce()

    await act(async () => root.render(<Activity mode="hidden"><PreviewSessionHarness /></Activity>))
    await act(async () => pending.resolve({
      success: true,
      data: { signalingUrl: 'ws://stale-hidden-start', serverRunning: true },
    }))
    await flush()
    expect(transportMock.connect).not.toHaveBeenCalled()

    await act(async () => root.render(<Activity mode="visible"><PreviewSessionHarness /></Activity>))
    await flush()
    expect(viewData('data-loading')).toBe('')
    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledTimes(2)
    expect(apiMocks.startWebrtc).toHaveBeenCalledTimes(2)
    expect(transportMock.connect).toHaveBeenCalledOnce()
    expect(transportMock.connect).toHaveBeenCalledWith('/webrtc-signaling')
  })

  it('cancels startup immediately and prevents an old response from replacing a new preview', async () => {
    availabilityMock.isAvailable = true
    const pending = deferred<{ success: boolean; data: { signalingUrl: string; serverRunning: boolean } }>()
    apiMocks.startWebrtc.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
      success: true,
      data: { signalingUrl: 'ws://new-preview', serverRunning: true },
    })
    await act(async () => root.render(<PreviewSessionHarness />))
    await flush()

    await connectPreview()
    expect(apiMocks.startWebrtc).toHaveBeenCalledWith('default', 'mumu-la-pluma', expect.any(AbortSignal))
    const firstSignal = apiMocks.startWebrtc.mock.calls[0]?.[2] as AbortSignal
    expect(viewData('data-loading')).toBe('preview')

    await act(async () => currentSession().disconnect())
    await flush()
    expect(firstSignal.aborted).toBe(true)
    expect(viewData('data-loading')).toBe('')
    expect(transportMock.disconnect).toHaveBeenCalled()

    await connectPreview()
    expect(transportMock.connect).toHaveBeenCalledWith('ws://new-preview')
    expect(viewData('data-server-running')).toBe('true')

    await act(async () => pending.resolve({
      success: true,
      data: { signalingUrl: 'ws://cancelled-preview', serverRunning: false },
    }))
    await flush()

    expect(transportMock.connect).toHaveBeenCalledOnce()
    expect(viewData('data-server-running')).toBe('true')
    expect(viewData('data-loading')).toBe('')
    expect(viewData('data-error')).toBe('')
    expect(currentSession().error).toBeNull()
  })

  it('aborts a timed-out startup and releases the pending infrastructure operation', async () => {
    vi.useFakeTimers()
    availabilityMock.isAvailable = true
    apiMocks.startWebrtc.mockImplementationOnce(() => new Promise(() => {}))
    await act(async () => root.render(<PreviewSessionHarness />))
    await flush()

    await connectPreview()
    const signal = apiMocks.startWebrtc.mock.calls[0]?.[2] as AbortSignal
    expect(viewData('data-loading')).toBe('preview')

    await act(async () => vi.advanceTimersByTimeAsync(45000))

    expect(signal.aborted).toBe(true)
    expect(viewData('data-loading')).toBe('')
    expect(currentSession().starting).toBe(false)
    expect(currentSession().error).toMatch(/启动超时.*重试/)
    expect(transportMock.disconnect).toHaveBeenCalled()
  })

  it('refreshes the agent badge after live preview closes without starting infrastructure', async () => {
    vi.useFakeTimers()
    availabilityMock.isAvailable = true
    await setMode('live')
    apiMocks.getWebrtcStatus.mockResolvedValueOnce({
      success: true,
      data: { installed: true, built: true, serverRunning: true, agentRunning: true },
    }).mockResolvedValue({
      success: true,
      data: { installed: true, built: true, serverRunning: true, agentRunning: false },
    })
    apiMocks.startWebrtc.mockResolvedValueOnce({
      success: true,
      data: { signalingUrl: '/webrtc-signaling', serverRunning: true, agentRunning: true },
    })
    await act(async () => root.render(<PreviewSessionHarness />))
    await flush()
    expect(viewData('data-agent-running')).toBe('true')
    await act(async () => vi.advanceTimersByTimeAsync(20000))
    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledOnce()

    await act(async () => currentSession().disconnect())
    await act(async () => vi.advanceTimersByTimeAsync(4000))
    await flush()

    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledTimes(2)
    expect(viewData('data-agent-running')).toBe('false')
    expect(viewData('data-server-running')).toBe('true')
    await act(async () => vi.advanceTimersByTimeAsync(18000))
    expect(apiMocks.getWebrtcStatus).toHaveBeenCalledTimes(2)
    expect(apiMocks.startWebrtc).toHaveBeenCalledOnce()
    expect(apiMocks.startWebrtcServer).not.toHaveBeenCalled()
    expect(apiMocks.startWebrtcAgent).not.toHaveBeenCalled()
  })
})
