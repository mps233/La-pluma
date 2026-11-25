// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreviewStore } from '../store/previewStore'
import { usePreviewSnapshotOwner } from './usePreviewSnapshotOwner'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ captureScreen: vi.fn() }))

vi.mock('@/shared/api', () => ({
  getErrorMessage: () => '无法获取设备截图',
}))

vi.mock('../api', () => ({
  captureScreen: mocks.captureScreen,
}))

const captured = (image = 'fresh-image') => ({ success: true, data: { image } })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

let snapshot: ReturnType<typeof usePreviewSnapshotOwner>
let visibility: DocumentVisibilityState
let container: HTMLDivElement
let root: Root

function Harness({ available = true }: { available?: boolean }) {
  const current = usePreviewSnapshotOwner(available)
  useEffect(() => { snapshot = current })
  return <span data-image={current.image} data-error={current.error} />
}

async function render(available = true) {
  await act(async () => root.render(<Harness available={available} />))
}

async function selectMode(mode: 'off' | 'snapshot' | 'live') {
  await act(async () => usePreviewStore.getState().setMode(mode))
}

describe('usePreviewSnapshotOwner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.captureScreen.mockReset().mockResolvedValue(captured())
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

  it('captures only when snapshot mode is explicitly selected and available', async () => {
    await render()
    await act(async () => vi.advanceTimersByTimeAsync(60000))
    expect(mocks.captureScreen).not.toHaveBeenCalled()
    expect(snapshot.image).toBeNull()

    await selectMode('live')
    expect(mocks.captureScreen).not.toHaveBeenCalled()

    await render(false)
    await selectMode('snapshot')
    expect(mocks.captureScreen).not.toHaveBeenCalled()

    await render(true)
    expect(mocks.captureScreen).toHaveBeenCalledWith('default', expect.any(AbortSignal))
    expect(snapshot.image).toBe('data:image/png;base64,fresh-image')
  })

  it('waits for each response before scheduling the next capture', async () => {
    const first = deferred<ReturnType<typeof captured>>()
    const second = deferred<ReturnType<typeof captured>>()
    mocks.captureScreen.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await render()
    await selectMode('snapshot')

    await act(async () => vi.advanceTimersByTimeAsync(15000))
    expect(mocks.captureScreen).toHaveBeenCalledTimes(1)

    await act(async () => first.resolve(captured('first')))
    expect(snapshot.image).toBe('data:image/png;base64,first')
    await act(async () => vi.advanceTimersByTimeAsync(9999))
    expect(mocks.captureScreen).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(mocks.captureScreen).toHaveBeenCalledTimes(2)

    await act(async () => vi.advanceTimersByTimeAsync(15000))
    expect(mocks.captureScreen).toHaveBeenCalledTimes(2)
    await act(async () => second.resolve(captured('second')))
    expect(snapshot.image).toBe('data:image/png;base64,second')
  })

  it('clears its refresh timer when snapshot mode is switched off', async () => {
    await render()
    await selectMode('snapshot')
    expect(snapshot.image).not.toBeNull()

    await selectMode('off')
    expect(snapshot.image).toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(30000))
    expect(mocks.captureScreen).toHaveBeenCalledTimes(1)
  })

  it.each(['off', 'hidden'] as const)('ignores an unfinished capture after %s and resumes with a fresh image', async (pause) => {
    const pending = deferred<ReturnType<typeof captured>>()
    mocks.captureScreen.mockReturnValueOnce(pending.promise)
    await render()
    await selectMode('snapshot')
    const signal = mocks.captureScreen.mock.calls[0]?.[1] as AbortSignal

    if (pause === 'off') {
      await selectMode('off')
    } else {
      visibility = 'hidden'
      await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    }
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(captured('stale')))
    expect(snapshot.image).toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(30000))
    expect(mocks.captureScreen).toHaveBeenCalledTimes(1)

    if (pause === 'off') {
      await selectMode('snapshot')
    } else {
      visibility = 'visible'
      await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    }
    expect(mocks.captureScreen).toHaveBeenCalledTimes(2)
    expect(snapshot.image).toBe('data:image/png;base64,fresh-image')
  })

  it('shows capture failures and recovers on the next scheduled request', async () => {
    mocks.captureScreen.mockResolvedValueOnce({ success: false })
    await render()
    await selectMode('snapshot')
    expect(snapshot.error).toBe('无法获取设备截图')
    expect(snapshot.image).toBeNull()

    await act(async () => vi.advanceTimersByTimeAsync(10000))
    expect(snapshot.image).toBe('data:image/png;base64,fresh-image')
    expect(snapshot.error).toBeNull()
  })

  it('retries immediately when retry is requested', async () => {
    mocks.captureScreen.mockResolvedValueOnce({ success: false })
    await render()
    await selectMode('snapshot')
    expect(snapshot.error).toBe('无法获取设备截图')
    expect(mocks.captureScreen).toHaveBeenCalledTimes(1)

    await act(async () => snapshot.retry())

    expect(mocks.captureScreen).toHaveBeenCalledTimes(2)
    expect(snapshot.image).toBe('data:image/png;base64,fresh-image')
    expect(snapshot.error).toBeNull()
  })
  it('aborts a stalled capture, reports timeout, and retries without accepting its late image', async () => {
    const stalled = deferred<ReturnType<typeof captured>>()
    mocks.captureScreen.mockReturnValueOnce(stalled.promise)
    await render()
    await selectMode('snapshot')
    const signal = mocks.captureScreen.mock.calls[0]?.[1] as AbortSignal
    await act(async () => vi.advanceTimersByTimeAsync(20000))
    expect(signal.aborted).toBe(true)
    expect(snapshot.error).toContain('截图超时')
    await act(async () => vi.advanceTimersByTimeAsync(10000))
    expect(mocks.captureScreen).toHaveBeenCalledTimes(2)
    expect(snapshot.image).toBe('data:image/png;base64,fresh-image')
    await act(async () => stalled.resolve(captured('late-image')))
    expect(snapshot.image).toBe('data:image/png;base64,fresh-image')
    expect(snapshot.error).toBeNull()
  })

})
