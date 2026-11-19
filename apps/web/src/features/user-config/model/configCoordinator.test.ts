import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RESTORED_MESSAGE,
  UserConfigCoordinator,
  type ConfigCommitResult,
  type ConfigKeyStorage,
  type ConfigLoadResult,
  type ConfigPersistenceAdapter,
} from './configCoordinator'
import { USER_CONFIG_KEYS, USER_CONFIG_PENDING_KEYS } from './configKeys'

// 协调器必须能脱离 React 验证竞态：这里只用内存存储与可控 Promise。
// 每个用例显式驱动 microtask/timer，不依赖页面渲染或 Activity。

interface Draft {
  value: string
  mode: 'normal' | 'raid'
}

type Wire = Draft

const PENDING_KEY = 'demoConfigSyncPending'

const ok: ConfigCommitResult = { ok: true }
const failed = (message: string): ConfigCommitResult => ({ ok: false, message })

function memoryStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial))
  const storage: ConfigKeyStorage & { snapshot: () => Record<string, string> } = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
    removeItem: (key) => {
      entries.delete(key)
    },
    snapshot: () => Object.fromEntries(entries),
  }
  return storage
}

function memoryDraftStore(initial: Draft | null = null) {
  let value = initial
  return {
    read: () => value,
    write: (draft: Draft) => {
      value = draft
    },
    corrupt: () => {
      value = null
    },
  }
}

function decodeDraft(payload: unknown): Draft | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as { value?: unknown; mode?: unknown }
  if (typeof record.value !== 'string') return null
  if (record.mode === undefined || record.mode === 'normal') return { value: record.value, mode: 'normal' }
  if (record.mode === '1' || record.mode === 'raid') return { value: record.value, mode: 'raid' }
  return null
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

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

interface Harness {
  coordinator: UserConfigCoordinator
  adapter: ConfigPersistenceAdapter<Draft, Wire>
  storage: ReturnType<typeof memoryStorage>
  local: ReturnType<typeof memoryDraftStore>
  fetchMock: ReturnType<typeof vi.fn<(options: { signal: AbortSignal }) => Promise<ConfigLoadResult>>>
  commitMock: ReturnType<typeof vi.fn<(wire: Wire) => Promise<ConfigCommitResult>>>
}

function createHarness(options: Partial<ConfigPersistenceAdapter<Draft, Wire>> = {}): Harness {
  const storage = memoryStorage()
  const local = memoryDraftStore()
  const fetchMock = vi.fn<(options: { signal: AbortSignal }) => Promise<ConfigLoadResult>>(
    async () => ({ ok: true, payload: null }),
  )
  const commitMock = vi.fn<(wire: Wire) => Promise<ConfigCommitResult>>(async () => ok)
  const adapter: ConfigPersistenceAdapter<Draft, Wire> = {
    key: 'demo-tasks',
    pendingKey: PENDING_KEY,
    commitDelayMs: 0,
    encodeDraft: (draft) => ({ ...draft }),
    decodeDraft,
    readLocalDraft: () => local.read(),
    writeLocalDraft: (draft) => local.write(draft),
    commit: commitMock,
    fetch: fetchMock,
    ...options,
  }
  const coordinator = new UserConfigCoordinator({ storage, now: () => 1_000 })
  return { coordinator, adapter, storage, local, fetchMock, commitMock }
}

let harness: Harness

beforeEach(() => {
  harness = createHarness()
})

afterEach(() => {
  harness.coordinator.dispose()
  vi.useRealTimers()
})

describe('hydrate', () => {
  it('starts idle and exposes loading before the first draft is available', async () => {
    const pending = deferred<ConfigLoadResult>()
    harness.fetchMock.mockReturnValue(pending.promise)
    const channel = harness.coordinator.channel(harness.adapter)

    expect(channel.getState()).toMatchObject({
      hydrated: false,
      loadState: 'idle',
      loadError: null,
    })

    const loading = channel.reload()
    expect(channel.getState()).toMatchObject({
      draft: null,
      hydrated: false,
      loadState: 'loading',
      loadError: null,
    })

    pending.resolve({ ok: true, payload: { value: 'server', mode: 'normal' } })
    await expect(loading).resolves.toEqual({ reason: 'loaded' })
    expect(channel.getState()).toMatchObject({
      hydrated: true,
      loadState: 'ready',
      loadError: null,
    })
  })

  it('reports a failed read without hydrating and recovers on the next load', async () => {
    harness.fetchMock.mockResolvedValueOnce({ ok: false, message: '后端暂不可用' })
    const channel = harness.coordinator.channel(harness.adapter)

    await expect(channel.reload()).resolves.toEqual({ reason: 'failed' })
    expect(channel.getState()).toMatchObject({
      draft: null,
      hydrated: false,
      loadState: 'failed',
      loadError: '后端暂不可用',
    })

    harness.fetchMock.mockResolvedValueOnce({ ok: true, payload: { value: 'server', mode: 'normal' } })
    await expect(channel.reload()).resolves.toEqual({ reason: 'loaded' })
    expect(channel.getState()).toMatchObject({
      draft: { value: 'server', mode: 'normal' },
      hydrated: true,
      loadState: 'ready',
      loadError: null,
    })
  })

  it('keeps an in-memory draft hydrated when a failed reload has no local fallback', async () => {
    const channel = harness.coordinator.channel({
      ...harness.adapter,
      readLocalDraft: () => null,
      writeLocalDraft: () => {},
    })
    harness.fetchMock.mockResolvedValueOnce({ ok: false, message: 'offline' })
    channel.setDraft({ value: 'edited', mode: 'normal' })

    await expect(channel.reload()).resolves.toEqual({ reason: 'failed' })
    expect(channel.getState()).toMatchObject({
      draft: { value: 'edited', mode: 'normal' },
      hydrated: true,
      loadState: 'ready',
      loadError: null,
      pending: true,
    })
  })

  it('keeps the restored local draft ready even when the server read would fail', async () => {
    harness.storage.setItem(PENDING_KEY, 'pending-token')
    harness.local.write({ value: 'local', mode: 'normal' })
    const channel = harness.coordinator.channel(harness.adapter)

    await expect(channel.reload()).resolves.toEqual({ reason: 'local-draft' })
    expect(harness.fetchMock).not.toHaveBeenCalled()
    expect(channel.getState()).toMatchObject({
      draft: { value: 'local', mode: 'normal' },
      hydrated: true,
      loadState: 'ready',
      loadError: null,
      syncState: 'failed',
    })
  })

  it('loads the server draft, migrates it, and mirrors it locally without committing', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: '1' } })
    const channel = harness.coordinator.channel(harness.adapter)

    const outcome = await channel.reload()

    expect(outcome).toEqual({ reason: 'loaded' })
    expect(channel.getState()).toMatchObject({
      draft: { value: 'server', mode: 'raid' },
      hydrated: true,
      pending: false,
      syncState: 'idle',
      error: null,
      loadState: 'ready',
      loadError: null,
      revision: 0,
    })
    expect(harness.local.read()).toEqual({ value: 'server', mode: 'raid' })
    expect(harness.commitMock).not.toHaveBeenCalled()
  })

  it('prefers an unsynced local draft and never reads the server', async () => {
    harness.storage.setItem(PENDING_KEY, 'token-from-previous-session')
    harness.local.write({ value: 'local', mode: 'normal' })
    const channel = harness.coordinator.channel(harness.adapter)

    const outcome = await channel.reload()

    expect(outcome).toEqual({ reason: 'local-draft' })
    expect(harness.fetchMock).not.toHaveBeenCalled()
    expect(channel.getState()).toMatchObject({
      draft: { value: 'local', mode: 'normal' },
      hydrated: true,
      pending: true,
      syncState: 'failed',
      error: DEFAULT_RESTORED_MESSAGE,
    })

    await expect(channel.commitNow()).resolves.toBe(true)
    expect(harness.commitMock).toHaveBeenCalledWith({ value: 'local', mode: 'normal' })
    expect(harness.storage.getItem(PENDING_KEY)).toBeNull()
    expect(channel.getState()).toMatchObject({ pending: false, syncState: 'idle', error: null })
  })

  it('drops a pending marker whose local draft is unreadable and falls back to the server', async () => {
    harness.storage.setItem(PENDING_KEY, 'broken-token')
    harness.local.corrupt()
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const channel = harness.coordinator.channel(harness.adapter)

    const outcome = await channel.reload()

    expect(outcome).toEqual({ reason: 'loaded' })
    expect(harness.storage.getItem(PENDING_KEY)).toBeNull()
    expect(channel.getState().draft).toEqual({ value: 'server', mode: 'normal' })
  })

  it('adopts a pending marker that appears after a confirmed load', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    harness.local.write({ value: 'unconfirmed', mode: 'normal' })
    harness.storage.setItem(PENDING_KEY, 'leftover-token')

    await expect(channel.reload({ force: true })).resolves.toEqual({ reason: 'local-draft' })
    expect(channel.getState()).toMatchObject({
      draft: { value: 'unconfirmed', mode: 'normal' },
      pending: true,
      syncState: 'failed',
      error: DEFAULT_RESTORED_MESSAGE,
    })
    expect(harness.fetchMock).toHaveBeenCalledTimes(1)

    await expect(channel.commitNow()).resolves.toBe(true)
    expect(harness.storage.getItem(PENDING_KEY)).toBeNull()
  })

  it('falls back to the local draft when the server payload cannot be decoded', async () => {
    harness.local.write({ value: 'local-only', mode: 'normal' })
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { unexpected: true } })
    const channel = harness.coordinator.channel(harness.adapter)

    const outcome = await channel.reload()

    expect(outcome).toEqual({ reason: 'loaded' })
    expect(channel.getState().draft).toEqual({ value: 'local-only', mode: 'normal' })
    expect(channel.getState().pending).toBe(false)
  })

  it('retries on the next hydrate after a total load failure', async () => {
    harness.fetchMock.mockRejectedValue(new Error('offline'))
    const channel = harness.coordinator.channel(harness.adapter)

    await expect(channel.reload()).resolves.toEqual({ reason: 'failed' })
    await expect(channel.reload()).resolves.toEqual({ reason: 'failed' })
    expect(harness.fetchMock).toHaveBeenCalledTimes(2)

    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    await expect(channel.reload()).resolves.toEqual({ reason: 'loaded' })
    expect(channel.getState().hydrated).toBe(true)
  })

  it('skips reloading once hydrated and single-flights concurrent hydrates', async () => {
    const pending = deferred<ConfigLoadResult>()
    harness.fetchMock.mockReturnValue(pending.promise)
    const channel = harness.coordinator.channel(harness.adapter)

    const first = channel.hydrate()
    const second = channel.hydrate()
    pending.resolve({ ok: true, payload: { value: 'server', mode: 'normal' } })

    await expect(first).resolves.toEqual({ reason: 'loaded' })
    await expect(second).resolves.toEqual({ reason: 'loaded' })
    await expect(channel.hydrate()).resolves.toEqual({ reason: 'skipped' })
    expect(harness.fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('late loads', () => {
  it('does not let a late server load overwrite an edit made before hydration', async () => {
    const pending = deferred<ConfigLoadResult>()
    harness.fetchMock.mockReturnValue(pending.promise)
    // 提交保持挂起，确保断言看到的是“加载返回”而不是“提交成功”。
    harness.commitMock.mockReturnValue(new Promise<ConfigCommitResult>(() => {}))
    const channel = harness.coordinator.channel(harness.adapter)

    const loading = channel.reload()
    channel.setDraft({ value: 'edited', mode: 'normal' })
    pending.resolve({ ok: true, payload: { value: 'server', mode: 'normal' } })

    await expect(loading).resolves.toEqual({ reason: 'stale' })
    expect(channel.getState().draft).toEqual({ value: 'edited', mode: 'normal' })
    expect(channel.getState().pending).toBe(true)
    expect(channel.getState().hydrated).toBe(true)
    expect(harness.local.read()).toEqual({ value: 'edited', mode: 'normal' })
  })

  it('aborts the previous load when a forced reload starts', async () => {
    const slow = deferred<ConfigLoadResult>()
    harness.fetchMock.mockReturnValueOnce(slow.promise)
    harness.fetchMock.mockResolvedValueOnce({ ok: true, payload: { value: 'fresh', mode: 'normal' } })
    const channel = harness.coordinator.channel(harness.adapter)

    const first = channel.reload()
    const second = channel.reload({ force: true })

    await expect(second).resolves.toEqual({ reason: 'loaded' })
    expect(channel.getState().draft).toEqual({ value: 'fresh', mode: 'normal' })
    slow.resolve({ ok: true, payload: { value: 'stale', mode: 'normal' } })
    await expect(first).resolves.toEqual({ reason: 'stale' })
    expect(channel.getState().draft).toEqual({ value: 'fresh', mode: 'normal' })
  })
})

describe('commit ordering', () => {
  it('serializes saves so the latest draft reaches the server last', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const first = deferred<ConfigCommitResult>()
    const second = deferred<ConfigCommitResult>()
    harness.commitMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'first', mode: 'normal' })
    await tick()
    channel.setDraft({ value: 'second', mode: 'normal' })

    expect(harness.commitMock).toHaveBeenCalledTimes(1)
    expect(harness.commitMock).toHaveBeenLastCalledWith({ value: 'first', mode: 'normal' })

    first.resolve(ok)
    await tick()

    // 旧提交的成功不能确认新草稿。
    expect(harness.commitMock).toHaveBeenLastCalledWith({ value: 'second', mode: 'normal' })
    expect(channel.getState().pending).toBe(true)
    expect(harness.storage.getItem(PENDING_KEY)).not.toBeNull()

    second.resolve(ok)
    await channel.flush()

    expect(channel.getState()).toMatchObject({
      draft: { value: 'second', mode: 'normal' },
      pending: false,
      syncState: 'idle',
      lastSavedAt: 1_000,
    })
    expect(harness.storage.getItem(PENDING_KEY)).toBeNull()
  })

  it('keeps the latest pending marker when an older commit resolves successfully', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const first = deferred<ConfigCommitResult>()
    const second = deferred<ConfigCommitResult>()
    harness.commitMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'first', mode: 'normal' })
    await tick()
    channel.setDraft({ value: 'second', mode: 'normal' })
    const secondToken = harness.storage.getItem(PENDING_KEY)

    first.resolve(ok)
    await tick()

    expect(harness.storage.getItem(PENDING_KEY)).toBe(secondToken)
    expect(channel.getState().pending).toBe(true)

    second.resolve(ok)
    await channel.flush()
  })

  it('does not confirm a draft when another writer replaced the pending marker', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const commit = deferred<ConfigCommitResult>()
    harness.commitMock.mockReturnValue(commit.promise)
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'mine', mode: 'normal' })
    await tick()
    harness.storage.setItem(PENDING_KEY, 'other-writer')

    commit.resolve(ok)
    await channel.flush()

    expect(channel.getState().pending).toBe(true)
    expect(harness.storage.getItem(PENDING_KEY)).toBe('other-writer')
  })

  it('coalesces rapid edits under the debounce policy and sends only the last one', async () => {
    vi.useFakeTimers()
    harness = createHarness({ commitDelayMs: 300 })
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'a', mode: 'normal' })
    channel.setDraft({ value: 'b', mode: 'normal' })
    channel.setDraft({ value: 'c', mode: 'normal' })
    expect(channel.getState().syncState).toBe('queued')

    await vi.advanceTimersByTimeAsync(299)
    expect(harness.commitMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await channel.flush()

    expect(harness.commitMock).toHaveBeenCalledTimes(1)
    expect(harness.commitMock).toHaveBeenCalledWith({ value: 'c', mode: 'normal' })
    expect(channel.getState().pending).toBe(false)
  })

  it('skips submissions whose wire content did not change', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'server', mode: 'normal' })
    await channel.flush()
    channel.setDraft({ value: 'server', mode: 'normal' })
    await channel.flush()

    expect(harness.commitMock).not.toHaveBeenCalled()
    expect(channel.getState().pending).toBe(false)
  })

  it('honours an adapter fingerprint that covers fields omitted from the wire', async () => {
    // 领域适配器可以把本地专有字段纳入等价判断；wire 未变化时仍要接受并写回草稿。
    const adapterWithLocalField: ConfigPersistenceAdapter<Draft, Wire> = {
      ...harness.adapter,
      encodeDraft: (draft) => ({ value: draft.value, mode: 'normal' }),
      fingerprint: (draft) => JSON.stringify(draft),
    }
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const channel = harness.coordinator.channel(adapterWithLocalField)
    await channel.hydrate()

    channel.setDraft({ value: 'server', mode: 'raid' })
    await channel.flush()

    expect(channel.getState().draft).toEqual({ value: 'server', mode: 'raid' })
    expect(harness.local.read()).toEqual({ value: 'server', mode: 'raid' })
    expect(harness.commitMock).toHaveBeenCalledOnce()
  })
})

describe('local draft writes', () => {
  it('debounces local writes and flushes the last draft before the commit', async () => {
    vi.useFakeTimers()
    harness = createHarness({ commitDelayMs: 300, localWriteDelayMs: 250 })
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'a', mode: 'normal' })
    channel.setDraft({ value: 'b', mode: 'normal' })

    expect(harness.local.read()).toEqual({ value: 'server', mode: 'normal' })
    await vi.advanceTimersByTimeAsync(249)
    expect(harness.local.read()).toEqual({ value: 'server', mode: 'normal' })

    await vi.advanceTimersByTimeAsync(1)
    expect(harness.local.read()).toEqual({ value: 'b', mode: 'normal' })

    await vi.advanceTimersByTimeAsync(50)
    expect(harness.commitMock).toHaveBeenCalledWith({ value: 'b', mode: 'normal' })
  })

  it('flushes a debounced local draft before an immediate commit', async () => {
    vi.useFakeTimers()
    harness = createHarness({ localWriteDelayMs: 250 })
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'latest', mode: 'normal' })
    expect(harness.local.read()).toEqual({ value: 'server', mode: 'normal' })

    await channel.commitNow()

    expect(harness.local.read()).toEqual({ value: 'latest', mode: 'normal' })
    expect(harness.commitMock).toHaveBeenCalledWith({ value: 'latest', mode: 'normal' })
  })

  it('flushes a debounced local draft when the channel is disposed', async () => {
    vi.useFakeTimers()
    harness = createHarness({ localWriteDelayMs: 250 })
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'latest', mode: 'normal' })
    channel.dispose()

    expect(harness.local.read()).toEqual({ value: 'latest', mode: 'normal' })
  })
})

describe('failure and retry', () => {
  it('keeps the draft pending with a retryable message when the full commit fails', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    harness.commitMock.mockResolvedValueOnce(failed('定时设置失败'))
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'edited', mode: 'normal' })
    await channel.flush()

    expect(channel.getState()).toMatchObject({
      draft: { value: 'edited', mode: 'normal' },
      pending: true,
      syncState: 'failed',
      error: '配置已保存在此设备，但尚未同步到服务器：定时设置失败',
    })
    expect(harness.storage.getItem(PENDING_KEY)).not.toBeNull()
    expect(harness.local.read()).toEqual({ value: 'edited', mode: 'normal' })

    await expect(channel.commitNow()).resolves.toBe(true)
    expect(channel.getState()).toMatchObject({ pending: false, syncState: 'idle', error: null })
  })

  it('treats a thrown transport error as a retryable failure without losing the draft', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    harness.commitMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'edited', mode: 'normal' })
    await channel.flush()

    expect(channel.getState().error).toBe('配置已保存在此设备，但尚未同步到服务器：Failed to fetch')
    expect(channel.getState().pending).toBe(true)
  })

  it('runs one network request when retries overlap', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    harness.commitMock.mockResolvedValueOnce(failed('offline'))
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'edited', mode: 'normal' })
    await channel.flush()
    expect(harness.commitMock).toHaveBeenCalledTimes(1)

    const commit = deferred<ConfigCommitResult>()
    harness.commitMock.mockReturnValueOnce(commit.promise)
    const first = channel.commitNow()
    const second = channel.commitNow()
    await tick()
    commit.resolve(ok)

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(harness.commitMock).toHaveBeenCalledTimes(2)
    expect(channel.getState().pending).toBe(false)
  })

  it('does not confirm the current revision when an edit arrives during a retry', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    harness.commitMock.mockResolvedValueOnce(failed('offline'))
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'edited', mode: 'normal' })
    await channel.flush()

    const followUp = deferred<ConfigCommitResult>()
    harness.commitMock.mockReturnValueOnce(followUp.promise)
    const retry = channel.commitNow()
    channel.setDraft({ value: 'edited-again', mode: 'normal' })

    // 旧 revision 的重试在入队后被新编辑取代，不重复提交旧草稿，也不确认新草稿。
    await expect(retry).resolves.toBe(false)
    expect(harness.commitMock.mock.calls.filter(([wire]) => wire.value === 'edited')).toHaveLength(1)
    expect(harness.commitMock).toHaveBeenLastCalledWith({ value: 'edited-again', mode: 'normal' })
    expect(channel.getState().draft).toEqual({ value: 'edited-again', mode: 'normal' })
    expect(channel.getState().pending).toBe(true)

    followUp.resolve(ok)
    await channel.flush()
    expect(channel.getState().pending).toBe(false)
  })
})

describe('channel lifetime', () => {
  it('keeps state, queue, and hydration across a remount with a new adapter instance', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const firstCommit = deferred<ConfigCommitResult>()
    const firstAdapter: ConfigPersistenceAdapter<Draft, Wire> = {
      ...harness.adapter,
      commit: () => firstCommit.promise,
    }
    const first = harness.coordinator.channel(firstAdapter)
    await first.hydrate()

    first.setDraft({ value: 'first', mode: 'normal' })
    await tick()

    const remountCommit = vi.fn<(wire: Wire) => Promise<ConfigCommitResult>>(async () => ok)
    const second = harness.coordinator.channel({ ...harness.adapter, commit: remountCommit })
    expect(second).toBe(first)
    expect(second.getState().draft).toEqual({ value: 'first', mode: 'normal' })
    await expect(second.hydrate()).resolves.toEqual({ reason: 'skipped' })
    expect(harness.fetchMock).toHaveBeenCalledTimes(1)

    second.setDraft({ value: 'second', mode: 'normal' })
    firstCommit.resolve(ok)
    await second.flush()

    expect(remountCommit).toHaveBeenCalledWith({ value: 'second', mode: 'normal' })
    expect(second.getState()).toMatchObject({
      draft: { value: 'second', mode: 'normal' },
      pending: false,
    })
  })

  it('keeps an unsynced draft across remounts and rejects a heterogeneous adapter', async () => {
    harness.commitMock.mockRejectedValueOnce(new Error('offline'))
    const channel = harness.coordinator.channel(harness.adapter)
    channel.setDraft({ value: 'local', mode: 'normal' })
    await channel.flush()

    const remounted = harness.coordinator.channel({ ...harness.adapter, commitDelayMs: 300 })
    expect(remounted).toBe(channel)
    expect(remounted.getState()).toMatchObject({
      draft: { value: 'local', mode: 'normal' },
      pending: true,
      syncState: 'failed',
    })

    expect(() => harness.coordinator.channel({
      ...harness.adapter,
      pendingKey: 'differentConfigSyncPending',
    })).toThrow(/异构适配器/)
  })

  it('does not delete the local draft when disposing a channel', async () => {
    harness.storage.setItem(PENDING_KEY, 'token')
    harness.local.write({ value: 'local', mode: 'normal' })
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.dispose()

    expect(harness.storage.getItem(PENDING_KEY)).toBe('token')
    expect(harness.local.read()).toEqual({ value: 'local', mode: 'normal' })
  })
})

describe('force reload', () => {
  it('bypasses the hydrated guard and applies the newer server draft', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'v1', mode: 'normal' } })
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'v2', mode: 'raid' } })
    await expect(channel.reload()).resolves.toEqual({ reason: 'skipped' })
    await expect(channel.reload({ force: true })).resolves.toEqual({ reason: 'loaded' })

    expect(channel.getState().draft).toEqual({ value: 'v2', mode: 'raid' })
    expect(harness.fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the loaded draft editable when a forced refresh fails and local storage is unreadable', async () => {
    harness.fetchMock.mockResolvedValueOnce({ ok: true, payload: { value: 'server', mode: 'normal' } })
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    harness.fetchMock.mockResolvedValueOnce({ ok: false, message: 'offline' })
    const failing = harness.coordinator.channel({
      ...harness.adapter,
      readLocalDraft: () => {
        throw new Error('disk')
      },
    })

    await expect(failing.reload({ force: true })).resolves.toEqual({ reason: 'failed' })
    expect(failing.getState()).toMatchObject({
      draft: { value: 'server', mode: 'normal' },
      hydrated: true,
      loadState: 'ready',
      loadError: null,
    })
  })

  it('keeps an unsynced draft and an in-flight save when forced', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'v1', mode: 'normal' } })
    harness.commitMock.mockReturnValue(new Promise<ConfigCommitResult>(() => {}))
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'edited', mode: 'normal' })
    await tick()

    await expect(channel.reload({ force: true })).resolves.toEqual({ reason: 'local-draft' })
    expect(harness.fetchMock).toHaveBeenCalledTimes(1)
    expect(channel.getState().draft).toEqual({ value: 'edited', mode: 'normal' })
    expect(channel.getState().pending).toBe(true)
  })
})

describe('write barrier', () => {
  it('returns no pending keys when the named channel was never mounted', async () => {
    await expect(harness.coordinator.settle(['missing-tasks'])).resolves.toEqual({ pendingKeys: [] })
  })

  it('waits for an in-flight save before reporting the channel clean', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'v1', mode: 'normal' } })
    const pendingSave = deferred<ConfigCommitResult>()
    harness.commitMock.mockReturnValueOnce(pendingSave.promise)
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'edited', mode: 'normal' })
    await tick()
    expect(channel.getState().syncState).toBe('saving')

    let settled = false
    const barrier = harness.coordinator.settle([harness.adapter.key]).then(result => {
      settled = true
      return result
    })
    await tick()
    expect(settled).toBe(false)

    pendingSave.resolve(ok)
    await expect(barrier).resolves.toEqual({ pendingKeys: [] })
    expect(channel.getState().pending).toBe(false)
  })

  it('reports a persistent pending token even when the channel was never mounted', async () => {
    const key = USER_CONFIG_KEYS.automationTasks
    harness.storage.setItem(USER_CONFIG_PENDING_KEYS[key], 'pending-from-a-previous-session')

    await expect(harness.coordinator.settle([key])).resolves.toEqual({ pendingKeys: [key] })
    expect(harness.commitMock).not.toHaveBeenCalled()
  })

  it('ignores a pending token once the mounted channel confirms its save', async () => {
    const key = USER_CONFIG_KEYS.automationTasks
    harness.storage.setItem(USER_CONFIG_PENDING_KEYS[key], 'pending')
    const adapter = {
      ...harness.adapter,
      key,
      pendingKey: USER_CONFIG_PENDING_KEYS[key],
    }
    const channel = harness.coordinator.channel(adapter)

    await expect(harness.coordinator.settle([key])).resolves.toEqual({ pendingKeys: [key] })

    channel.setDraft({ value: 'edited', mode: 'normal' })
    await tick()
    await expect(harness.coordinator.settle([key])).resolves.toEqual({ pendingKeys: [] })
  })

  it('reports a failed save instead of retrying it', async () => {
    harness.fetchMock.mockResolvedValue({ ok: true, payload: { value: 'v1', mode: 'normal' } })
    harness.commitMock.mockResolvedValueOnce(failed('暂时无法连接服务器'))
    const channel = harness.coordinator.channel(harness.adapter)
    await channel.hydrate()

    channel.setDraft({ value: 'edited', mode: 'normal' })
    await tick()

    await expect(harness.coordinator.settle([harness.adapter.key]))
      .resolves.toEqual({ pendingKeys: [harness.adapter.key] })
    expect(harness.commitMock).toHaveBeenCalledTimes(1)
    expect(channel.getState().syncState).toBe('failed')
  })
})
