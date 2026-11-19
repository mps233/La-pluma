// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UserConfigCoordinator,
  type ConfigCommitResult,
  type ConfigKeyStorage,
  type ConfigLoadResult,
  type ConfigPersistenceAdapter,
} from '../model/configCoordinator'
import { useUserConfig } from './useUserConfig'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface Draft {
  value: string
}

type Wire = Draft

const ok: ConfigCommitResult = { ok: true }

function memoryStorage(): ConfigKeyStorage {
  const entries = new Map<string, string>()
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
    removeItem: (key) => {
      entries.delete(key)
    },
  }
}

function createAdapter(
  fetchMock: ReturnType<typeof vi.fn<(options: { signal: AbortSignal }) => Promise<ConfigLoadResult>>>,
  commitMock: ReturnType<typeof vi.fn<(wire: Wire) => Promise<ConfigCommitResult>>>,
): ConfigPersistenceAdapter<Draft, Wire> {
  return {
    key: 'demo-tasks',
    pendingKey: 'demoConfigSyncPending',
    commitDelayMs: 0,
    encodeDraft: (draft) => ({ ...draft }),
    decodeDraft: (payload) => {
      if (!payload || typeof payload !== 'object') return null
      const value = (payload as { value?: unknown }).value
      return typeof value === 'string' ? { value } : null
    },
    readLocalDraft: () => null,
    writeLocalDraft: () => undefined,
    commit: commitMock,
    fetch: fetchMock,
  }
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

let coordinator: UserConfigCoordinator
let fetchMock: ReturnType<typeof vi.fn<(options: { signal: AbortSignal }) => Promise<ConfigLoadResult>>>
let commitMock: ReturnType<typeof vi.fn<(wire: Wire) => Promise<ConfigCommitResult>>>
let adapter: ConfigPersistenceAdapter<Draft, Wire>
let container: HTMLDivElement
let root: Root

function Harness({ autoHydrate = true }: { autoHydrate?: boolean }) {
  const {
    draft,
    hydrated,
    pending,
    syncState,
    error,
    loadState,
    loadError,
    update,
    retry,
    reload,
  } = useUserConfig(adapter, { coordinator, autoHydrate })
  return (
    <div>
      <span data-testid="draft">{draft?.value ?? 'empty'}</span>
      <span data-testid="hydrated">{String(hydrated)}</span>
      <span data-testid="pending">{String(pending)}</span>
      <span data-testid="sync">{syncState}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="load-state">{loadState}</span>
      <span data-testid="load-error">{loadError ?? ''}</span>
      <button data-testid="update" type="button" onClick={() => update({ value: 'edited' })}>update</button>
      <button data-testid="retry" type="button" onClick={() => { void retry() }}>retry</button>
      <button data-testid="reload" type="button" onClick={() => { void reload() }}>reload</button>
    </div>
  )
}

function text(testId: string): string {
  return container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? ''
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function click(testId: string) {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click()
  })
  await flush()
}

beforeEach(() => {
  fetchMock = vi.fn<(options: { signal: AbortSignal }) => Promise<ConfigLoadResult>>()
  commitMock = vi.fn<(wire: Wire) => Promise<ConfigCommitResult>>(async () => ok)
  adapter = createAdapter(fetchMock, commitMock)
  coordinator = new UserConfigCoordinator({ storage: memoryStorage(), now: () => 1_000 })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  coordinator.dispose()
  container.remove()
})

describe('useUserConfig', () => {
  it('hydrates once on mount and renders the subscribed draft', async () => {
    fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server' } })

    await act(async () => {
      root.render(<Harness />)
    })
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(text('hydrated')).toBe('true')
    expect(text('draft')).toBe('server')

    await act(async () => {
      root.render(<Harness />)
    })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('exposes the loading and failed read states before a draft is available', async () => {
    const load = deferred<ConfigLoadResult>()
    fetchMock.mockReturnValueOnce(load.promise)

    await act(async () => {
      root.render(<Harness />)
    })
    await flush()

    expect(text('load-state')).toBe('loading')
    expect(text('load-error')).toBe('')
    expect(text('hydrated')).toBe('false')
    expect(text('draft')).toBe('empty')

    load.resolve({ ok: false, message: '后端不可用' })
    await flush()

    expect(text('load-state')).toBe('failed')
    expect(text('load-error')).toBe('后端不可用')
    expect(text('hydrated')).toBe('false')

    fetchMock.mockResolvedValueOnce({ ok: true, payload: { value: 'server' } })
    await click('reload')

    expect(text('load-state')).toBe('ready')
    expect(text('load-error')).toBe('')
    expect(text('hydrated')).toBe('true')
    expect(text('draft')).toBe('server')
  })

  it('pushes accepted edits into the coordinator and re-renders subscribers', async () => {
    fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server' } })

    await act(async () => {
      root.render(<Harness />)
    })
    await flush()

    await click('update')

    expect(text('draft')).toBe('edited')
    expect(text('pending')).toBe('false')
    expect(text('sync')).toBe('idle')
    expect(commitMock).toHaveBeenCalledWith({ value: 'edited' })
  })

  it('leaves hydration to the caller when autoHydrate is disabled', async () => {
    fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server' } })

    await act(async () => {
      root.render(<Harness autoHydrate={false} />)
    })
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(text('hydrated')).toBe('false')
    expect(text('draft')).toBe('empty')

    await click('reload')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(text('draft')).toBe('server')
  })

  it('surfaces retry failures and keeps the draft editable', async () => {
    fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server' } })
    commitMock.mockResolvedValueOnce({ ok: false, message: '定时设置失败' })

    await act(async () => {
      root.render(<Harness />)
    })
    await flush()

    await click('update')

    expect(text('sync')).toBe('failed')
    expect(text('pending')).toBe('true')
    expect(text('error')).toBe('配置已保存在此设备，但尚未同步到服务器：定时设置失败')

    await click('retry')

    expect(text('sync')).toBe('idle')
    expect(text('pending')).toBe('false')
    expect(text('error')).toBe('')
  })
})
