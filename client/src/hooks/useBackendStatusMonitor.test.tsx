// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useStatusStore } from '../store/statusStore'
import {
  invalidateBackendStatusProbe,
  probeBackendAvailability,
  useBackendStatusMonitor,
} from './useBackendStatusMonitor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const apiMocks = vi.hoisted(() => ({
  getTaskStatus: vi.fn(),
}))

vi.mock('../services/api', () => ({
  maaApi: {
    getTaskStatus: apiMocks.getTaskStatus,
    getErrorMessage: (result?: { message?: string; error?: string }) => result?.message || result?.error || '未知错误',
  },
}))

vi.mock('../components/Layout', () => ({
  default: ({ children }: { children: (props: { activeTab: string }) => React.ReactNode }) => (
    <div>{children({ activeTab: 'automation' })}</div>
  ),
}))

vi.mock('../components/PWAInstallPrompt', () => ({ default: () => null }))
vi.mock('../components/common', () => ({ Loading: () => null }))
vi.mock('../components/AutomationTasks', async () => {
  const { useStatusStore: useMockStatusStore } = await import('../store/statusStore')

  return {
    default: function MockAutomationTasks() {
      const backendStatus = useMockStatusStore(state => state.backendStatus)
      return <button disabled={backendStatus !== 'available'}>非首页执行入口</button>
    },
  }
})

interface ProbeResult {
  success: boolean
  message?: string
  data?: { isRunning: boolean }
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

function HookHarness() {
  useBackendStatusMonitor()
  return null
}

let online = true
let container: HTMLDivElement
let root: Root

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useBackendStatusMonitor', () => {
  beforeEach(() => {
    online = true
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
    apiMocks.getTaskStatus.mockReset()
    useStatusStore.getState().setBackendStatus('unknown')
    invalidateBackendStatusProbe()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    useStatusStore.getState().setBackendStatus('unknown')
    invalidateBackendStatusProbe()
  })

  it('probes immediately on mount and publishes availability', async () => {
    const request = deferred<ProbeResult>()
    apiMocks.getTaskStatus.mockReturnValueOnce(request.promise)

    act(() => root.render(<HookHarness />))

    expect(apiMocks.getTaskStatus).toHaveBeenCalledTimes(1)
    expect(apiMocks.getTaskStatus).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(useStatusStore.getState().backendStatus).toBe('checking')

    request.resolve({ success: true, data: { isRunning: false } })
    await flushEffects()

    expect(useStatusStore.getState().backendStatus).toBe('available')
  })

  it('switches to checking immediately when the browser comes back online', async () => {
    online = false
    useStatusStore.getState().setBackendStatus('unavailable', '后端服务不可用')
    const request = deferred<ProbeResult>()
    apiMocks.getTaskStatus.mockReturnValueOnce(request.promise)

    act(() => root.render(<HookHarness />))
    expect(apiMocks.getTaskStatus).not.toHaveBeenCalled()

    online = true
    act(() => window.dispatchEvent(new Event('online')))

    expect(apiMocks.getTaskStatus).toHaveBeenCalledTimes(1)
    expect(useStatusStore.getState().backendStatus).toBe('checking')
    expect(useStatusStore.getState().backendMessage).toBe('')

    request.resolve({ success: true, data: { isRunning: false } })
    await flushEffects()
  })

  it('does not let an older failed probe overwrite a newer success', async () => {
    const olderRequest = deferred<ProbeResult>()
    const newerRequest = deferred<ProbeResult>()
    apiMocks.getTaskStatus
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(newerRequest.promise)

    const olderProbe = probeBackendAvailability({ showChecking: false })
    const newerProbe = probeBackendAvailability({ showChecking: false })

    newerRequest.resolve({ success: true, data: { isRunning: false } })
    await expect(newerProbe).resolves.toBe(true)
    expect(useStatusStore.getState().backendStatus).toBe('available')

    olderRequest.reject(new Error('较旧请求失败'))
    await expect(olderProbe).resolves.toBe(true)

    expect(useStatusStore.getState().backendStatus).toBe('available')
    expect(useStatusStore.getState().backendMessage).toBe('')
  })

  it('keeps a restored non-dashboard page blocked during the global startup probe', async () => {
    const request = deferred<ProbeResult>()
    apiMocks.getTaskStatus.mockReturnValueOnce(request.promise)

    act(() => root.render(<App />))
    await flushEffects()

    const action = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '非首页执行入口')

    expect(apiMocks.getTaskStatus).toHaveBeenCalledTimes(1)
    expect(useStatusStore.getState().backendStatus).toBe('checking')
    expect(action?.disabled).toBe(true)

    request.reject(new Error('后端服务不可用'))
    await flushEffects()

    expect(useStatusStore.getState().backendStatus).toBe('unavailable')
    expect(action?.disabled).toBe(true)
  })
})
