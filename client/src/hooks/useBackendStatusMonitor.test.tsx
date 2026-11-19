// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useStatusStore } from '../store/statusStore'
import {
  invalidateBackendStatusProbe,
  probeBackendAvailability,
  useBackendStatusMonitor,
} from './useBackendStatusMonitor'

afterEach(cleanup)

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
vi.mock('../components/common', () => ({
  PageSkeleton: () => null,
  Modal: () => null,
  Button: () => null,
  Input: () => null,
}))
vi.mock('./useRunStatusMonitor', () => ({ useRunStatusMonitor: () => undefined }))
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

let online = true

describe('useBackendStatusMonitor', () => {
  beforeEach(() => {
    online = true
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
    apiMocks.getTaskStatus.mockReset()
    useStatusStore.getState().setBackendStatus('unknown')
    useStatusStore.getState().setActive(false)
    invalidateBackendStatusProbe()
  })

  afterEach(() => {
    useStatusStore.getState().setBackendStatus('unknown')
    useStatusStore.getState().setActive(false)
    invalidateBackendStatusProbe()
  })

  it('probes immediately on mount and publishes availability', async () => {
    const request = deferred<ProbeResult>()
    apiMocks.getTaskStatus.mockReturnValueOnce(request.promise)

    renderHook(() => useBackendStatusMonitor())

    expect(apiMocks.getTaskStatus).toHaveBeenCalledTimes(1)
    expect(apiMocks.getTaskStatus).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(useStatusStore.getState().backendStatus).toBe('checking')

    request.resolve({ success: true, data: { isRunning: false } })
    await waitFor(() => expect(useStatusStore.getState().backendStatus).toBe('available'))
  })

  it('switches to checking immediately when the browser comes back online', async () => {
    online = false
    useStatusStore.getState().setBackendStatus('unavailable', '后端服务不可用')
    const request = deferred<ProbeResult>()
    apiMocks.getTaskStatus.mockReturnValueOnce(request.promise)

    renderHook(() => useBackendStatusMonitor())
    expect(apiMocks.getTaskStatus).not.toHaveBeenCalled()

    online = true
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(apiMocks.getTaskStatus).toHaveBeenCalledTimes(1)
    expect(useStatusStore.getState().backendStatus).toBe('checking')
    expect(useStatusStore.getState().backendMessage).toBe('')

    request.resolve({ success: true, data: { isRunning: false } })
    await waitFor(() => expect(useStatusStore.getState().backendStatus).toBe('available'))
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

  it('publishes the backend task lifecycle to the global status store', async () => {
    apiMocks.getTaskStatus
      .mockResolvedValueOnce({ success: true, data: { isRunning: true } })
      .mockResolvedValueOnce({ success: true, data: { isRunning: false } })

    await expect(probeBackendAvailability({ showChecking: false })).resolves.toBe(true)
    expect(useStatusStore.getState().isActive).toBe(true)

    await expect(probeBackendAvailability({ showChecking: false })).resolves.toBe(true)
    expect(useStatusStore.getState().isActive).toBe(false)
  })

  it('keeps a restored non-dashboard page blocked during the global startup probe', async () => {
    const request = deferred<ProbeResult>()
    apiMocks.getTaskStatus.mockReturnValueOnce(request.promise)

    render(<App />)

    const action = await screen.findByRole('button', { name: '非首页执行入口' })

    expect(apiMocks.getTaskStatus).toHaveBeenCalledTimes(1)
    expect(useStatusStore.getState().backendStatus).toBe('checking')
    expect((action as HTMLButtonElement).disabled).toBe(true)

    request.reject(new Error('后端服务不可用'))
    await waitFor(() => expect(useStatusStore.getState().backendStatus).toBe('unavailable'))

    expect((action as HTMLButtonElement).disabled).toBe(true)
  })
})
