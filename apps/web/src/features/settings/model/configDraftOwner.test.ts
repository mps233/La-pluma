// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { isRecord, type ApiResponse } from '@/shared/api'
import {
  ConfigDraftOwner,
  type ConfigDraftOwnerOptions,
} from './configDraftOwner'

interface TestConfig extends Record<string, unknown> {
  address: string
  preset: string
  auto_reconnect: boolean
}

const DEFAULT_TEST_CONFIG: TestConfig = {
  address: '127.0.0.1:16384',
  preset: 'ADB',
  auto_reconnect: true,
}

const normalizeTestConfig = (value: unknown): TestConfig | null => {
  if (!isRecord(value)) return null
  return {
    ...value,
    address: typeof value.address === 'string' ? value.address : DEFAULT_TEST_CONFIG.address,
    preset: typeof value.preset === 'string' ? value.preset : DEFAULT_TEST_CONFIG.preset,
    auto_reconnect: typeof value.auto_reconnect === 'boolean'
      ? value.auto_reconnect
      : DEFAULT_TEST_CONFIG.auto_reconnect,
  }
}

type WriteRequest = NonNullable<ConfigDraftOwnerOptions<TestConfig>['write']>

const createOwner = (
  write: WriteRequest = vi.fn(async () => ({ success: true })),
) => new ConfigDraftOwner<TestConfig>({
  write,
  normalize: normalizeTestConfig,
  defaultValue: () => ({ ...DEFAULT_TEST_CONFIG }),
  failureMessage: '保存配置失败',
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const adoptServer = (owner: ConfigDraftOwner<TestConfig>, config: unknown): boolean => (
  owner.adoptServer({ config: config as TestConfig, readToken: owner.beginRead() })
)

describe('config draft owner save prerequisites', () => {
  it('refuses to save before the first server read is adopted', async () => {
    const write = vi.fn<WriteRequest>(async () => ({ success: true }))
    const owner = createOwner(write)

    const outcome = await owner.save()

    expect(outcome).toMatchObject({
      status: 'ignored',
      config: DEFAULT_TEST_CONFIG,
      superseded: false,
    })
    expect(outcome.message).toBeTruthy()
    expect(write).not.toHaveBeenCalled()
    expect(owner.getState()).toMatchObject({
      draft: DEFAULT_TEST_CONFIG,
      syncState: 'idle',
      loaded: false,
      lastSavedAt: null,
    })
  })

  it('ignores edits until the first server read is adopted', () => {
    const write = vi.fn<WriteRequest>(async () => ({ success: true }))
    const owner = createOwner(write)
    const readToken = owner.beginRead()

    expect(owner.update({ address: '10.0.0.2:5555' })).toBe(false)
    expect(owner.getState()).toMatchObject({
      draft: DEFAULT_TEST_CONFIG,
      revision: 0,
      dirty: false,
      syncState: 'idle',
      loaded: false,
    })

    expect(owner.adoptServer({
      config: { ...DEFAULT_TEST_CONFIG, address: '10.0.0.2:5555' },
      readToken,
    })).toBe(true)
    expect(owner.getState()).toMatchObject({
      draft: { ...DEFAULT_TEST_CONFIG, address: '10.0.0.2:5555' },
      revision: 1,
      dirty: false,
      loaded: true,
    })
  })

  it('accepts edits after the first read is adopted', () => {
    const owner = createOwner()
    adoptServer(owner, { ...DEFAULT_TEST_CONFIG })

    expect(owner.update({ address: '10.0.0.2:5555' })).toBe(true)
    expect(owner.getState()).toMatchObject({
      draft: { ...DEFAULT_TEST_CONFIG, address: '10.0.0.2:5555' },
      dirty: true,
      loaded: true,
    })
  })

  it('saves the normalized server draft once adoption completes', async () => {
    const write = vi.fn<WriteRequest>(async () => ({ success: true }))
    const owner = createOwner(write)
    const normalized = {
      address: '10.0.0.2:5555',
      preset: 'MuMuPro',
      auto_reconnect: true,
      extra_flag: 'kept',
    }

    expect(adoptServer(owner, {
      address: '10.0.0.2:5555',
      preset: 'MuMuPro',
      auto_reconnect: 'unexpected',
      extra_flag: 'kept',
    })).toBe(true)

    const outcome = await owner.save()

    expect(outcome).toMatchObject({ status: 'saved', superseded: false })
    expect(write).toHaveBeenCalledWith('default', normalized)
    expect(owner.getState()).toMatchObject({
      draft: normalized,
      persisted: normalized,
      syncState: 'idle',
      loaded: true,
      lastSavedAt: expect.any(Number),
    })
  })

  it('still ignores a save while another save is in flight', async () => {
    const pending = deferred<ApiResponse<unknown>>()
    const write = vi.fn<WriteRequest>(() => pending.promise)
    const owner = createOwner(write)
    adoptServer(owner, { ...DEFAULT_TEST_CONFIG })

    const first = owner.save()
    const second = await owner.save()

    expect(second).toMatchObject({ status: 'ignored', superseded: false })
    expect(write).toHaveBeenCalledOnce()

    pending.resolve({ success: true })
    await expect(first).resolves.toMatchObject({ status: 'saved', superseded: false })
  })
})
