// @vitest-environment jsdom

import { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoSave, type AutoSaveState } from './useAutoSave'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface TestOwner {
  getState: () => AutoSaveState
  set: (patch: Partial<AutoSaveState>) => void
  subscribe: (listener: () => void) => () => void
}

const createOwner = (initial: Partial<AutoSaveState> = {}): TestOwner => {
  let state: AutoSaveState = {
    loaded: true,
    dirty: false,
    saving: false,
    revision: 0,
    ...initial,
  }
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    set: (patch) => {
      state = { ...state, ...patch }
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

interface HarnessProps {
  readonly owner: TestOwner
  readonly save: () => Promise<unknown>
  readonly locked?: boolean
  readonly paused?: boolean
  readonly saveBlocked?: boolean
  readonly delayMs?: number
  readonly canSave?: (state: AutoSaveState) => boolean
  readonly onBlocked?: (state: AutoSaveState) => void
  readonly onFlush?: (flush: () => void) => void
}

function Harness({ owner, save, onFlush, ...options }: HarnessProps) {
  const state = useSyncExternalStore(owner.subscribe, owner.getState, owner.getState)
  const { flush } = useAutoSave({ state, getState: owner.getState, save, ...options })
  onFlush?.(flush)
  return null
}

let container: HTMLDivElement
let root: Root

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
}

const renderHarness = async (props: HarnessProps) => {
  await act(async () => {
    root.render(<Harness {...props} />)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('useAutoSave', () => {
  it('debounces edits and submits only the latest revision', async () => {
    const owner = createOwner()
    const save = vi.fn(async () => undefined)
    await renderHarness({ owner, save })

    await act(async () => owner.set({ revision: 1, dirty: true }))
    await advance(599)
    expect(save).not.toHaveBeenCalled()

    await act(async () => owner.set({ revision: 2, dirty: true }))
    await advance(599)
    expect(save).not.toHaveBeenCalled()

    await advance(1)
    expect(save).toHaveBeenCalledOnce()
  })

  it('does not schedule while the draft is not dirty or not loaded', async () => {
    const owner = createOwner({ revision: 1 })
    const save = vi.fn(async () => undefined)
    await renderHarness({ owner, save })

    await advance(1000)
    expect(save).not.toHaveBeenCalled()

    await act(async () => owner.set({ loaded: false, dirty: true }))
    await advance(1000)
    expect(save).not.toHaveBeenCalled()
  })

  it('skips drafts with revision zero, such as a restored local fallback', async () => {
    const owner = createOwner({ dirty: true })
    const save = vi.fn(async () => undefined)
    await renderHarness({ owner, save })

    await advance(1000)
    expect(save).not.toHaveBeenCalled()
  })

  it('flushes immediately and cancels the pending debounce', async () => {
    const owner = createOwner({ revision: 1, dirty: true })
    const save = vi.fn(async () => undefined)
    let flush = () => {}
    await renderHarness({ owner, save, onFlush: next => { flush = next } })

    await act(async () => flush())
    expect(save).toHaveBeenCalledOnce()

    await advance(1000)
    expect(save).toHaveBeenCalledOnce()
  })

  it('blocks both debounce and flush while locked', async () => {
    const owner = createOwner({ revision: 1, dirty: true })
    const save = vi.fn(async () => undefined)
    let flush = () => {}
    await renderHarness({ owner, save, locked: true, onFlush: next => { flush = next } })

    await advance(1000)
    await act(async () => flush())
    expect(save).not.toHaveBeenCalled()
  })

  it('lets an explicit flush through while only paused', async () => {
    const owner = createOwner({ revision: 1, dirty: true })
    const save = vi.fn(async () => undefined)
    let flush = () => {}
    await renderHarness({ owner, save, paused: true, onFlush: next => { flush = next } })

    await advance(1000)
    expect(save).not.toHaveBeenCalled()

    await act(async () => flush())
    expect(save).toHaveBeenCalledOnce()
  })

  it('does not retry a failed save until the revision changes', async () => {
    const owner = createOwner({ revision: 1, dirty: true })
    const save = vi.fn(async () => undefined)
    await renderHarness({ owner, save, saveBlocked: true })

    await advance(1000)
    expect(save).not.toHaveBeenCalled()

    await act(async () => {
      owner.set({ revision: 2 })
      root.render(<Harness owner={owner} save={save} saveBlocked={false} />)
    })
    await advance(600)
    expect(save).toHaveBeenCalledOnce()
  })

  it('reports a blocked draft once per revision without submitting', async () => {
    const owner = createOwner({ revision: 1, dirty: true })
    const save = vi.fn(async () => undefined)
    const onBlocked = vi.fn()
    await renderHarness({ owner, save, canSave: () => false, onBlocked })

    await advance(1000)
    expect(save).not.toHaveBeenCalled()
    expect(onBlocked).toHaveBeenCalledOnce()

    await act(async () => owner.set({ revision: 2 }))
    await advance(1000)
    expect(onBlocked).toHaveBeenCalledTimes(2)
  })

  it('flushes on unmount before the debounce elapses', async () => {
    const owner = createOwner({ revision: 1, dirty: true })
    const save = vi.fn(async () => undefined)
    await renderHarness({ owner, save })
    expect(save).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    expect(save).toHaveBeenCalledOnce()
    root = createRoot(container)
  })
})
