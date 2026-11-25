// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, type ApiResponse } from '@/shared/api'
import { createQueryClient } from '@/shared/query'
import type { MaaConnectionConfig } from '../types'
import {
  ConnectionConfigOwner,
  connectionConfigQueryOptions,
  type ConnectionConfigOwnerOptions,
} from './connectionConfig'
import { DEFAULT_CONNECTION_CONFIG } from './configNormalization'
import { settingsKeys } from './queryKeys'

const apiMocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
}))

vi.mock('../api', () => ({
  getConfig: apiMocks.getConfig,
  saveConfig: apiMocks.saveConfig,
}))

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

const connection = (overrides: Partial<MaaConnectionConfig> = {}): MaaConnectionConfig => ({
  ...DEFAULT_CONNECTION_CONFIG,
  ...overrides,
})

type WriteRequest = NonNullable<ConnectionConfigOwnerOptions['write']>

const createOwner = (
  write: WriteRequest = vi.fn(async () => ({ success: true })),
) => new ConnectionConfigOwner({ write })

const adoptDefaultServer = (owner: ConnectionConfigOwner): void => {
  owner.adoptServer({ config: connection(), readToken: owner.beginRead() })
}

describe('connection config owner', () => {
  it('starts from the settings page defaults without marking the draft dirty', () => {
    const owner = createOwner()

    expect(owner.getState()).toEqual({
      draft: DEFAULT_CONNECTION_CONFIG,
      persisted: DEFAULT_CONNECTION_CONFIG,
      revision: 0,
      dirty: false,
      syncState: 'idle',
      error: null,
      loaded: false,
      lastSavedAt: null,
    })
  })

  it('tracks edits and ignores content-equivalent updates', () => {
    const owner = createOwner()
    adoptDefaultServer(owner)

    expect(owner.update({ address: '127.0.0.1:5555' })).toBe(true)
    expect(owner.getState()).toMatchObject({
      draft: connection({ address: '127.0.0.1:5555' }),
      revision: 1,
      dirty: true,
      syncState: 'idle',
    })

    expect(owner.update({ address: '127.0.0.1:5555' })).toBe(false)
    expect(owner.getState().revision).toBe(1)
  })

  it('adopts a server read only while the draft is still pristine', () => {
    const owner = createOwner()
    const token = owner.beginRead()

    expect(owner.adoptServer({
      config: connection({ address: '10.0.0.2:5555' }),
      readToken: token,
    })).toBe(true)
    expect(owner.getState()).toMatchObject({
      draft: connection({ address: '10.0.0.2:5555' }),
      persisted: connection({ address: '10.0.0.2:5555' }),
      revision: 1,
      dirty: false,
      loaded: true,
    })
  })

  it('drops a late read that started before a user edit', () => {
    const owner = createOwner()
    adoptDefaultServer(owner)
    const token = owner.beginRead()

    owner.update({ address: '127.0.0.1:5555' })
    expect(owner.adoptServer({
      config: connection({ address: '10.0.0.2:5555' }),
      readToken: token,
    })).toBe(false)
    expect(owner.getState().draft.address).toBe('127.0.0.1:5555')
  })

  it('does not adopt a read that was requested while a local draft was pending', () => {
    const owner = createOwner()
    adoptDefaultServer(owner)
    owner.update({ address: '127.0.0.1:5555' })
    const token = owner.beginRead()

    expect(token.dirty).toBe(true)
    expect(owner.adoptServer({
      config: connection({ address: '10.0.0.2:5555' }),
      readToken: token,
    })).toBe(false)
    expect(owner.getState().draft.address).toBe('127.0.0.1:5555')
  })

  it('drops a read that started before a successful save', async () => {
    const owner = createOwner()
    adoptDefaultServer(owner)
    const token = owner.beginRead()

    await owner.save()

    expect(owner.adoptServer({
      config: connection({ address: '10.0.0.2:5555' }),
      readToken: token,
    })).toBe(false)
    expect(owner.getState().draft).toEqual(DEFAULT_CONNECTION_CONFIG)
  })

  it('does not adopt a read requested while a save is in flight', async () => {
    const pending = deferred<ApiResponse<unknown>>()
    const owner = createOwner(() => pending.promise)
    adoptDefaultServer(owner)
    const saving = owner.save()
    const token = owner.beginRead()

    expect(token.saving).toBe(true)
    expect(owner.adoptServer({
      config: connection({ address: '10.0.0.2:5555' }),
      readToken: token,
    })).toBe(false)

    pending.resolve({ success: true })
    await saving
  })

  it('serializes saves and ignores a second request while one is in flight', async () => {
    const pending = deferred<ApiResponse<unknown>>()
    const write = vi.fn<WriteRequest>(() => pending.promise)
    const owner = createOwner(write)
    adoptDefaultServer(owner)

    const first = owner.save()
    const second = await owner.save()

    expect(second.status).toBe('ignored')
    expect(write).toHaveBeenCalledOnce()

    pending.resolve({ success: true })
    await expect(first).resolves.toMatchObject({ status: 'saved', superseded: false })
  })

  it('keeps edits made during a save and reports the earlier snapshot as saved', async () => {
    const pending = deferred<ApiResponse<unknown>>()
    const write = vi.fn<WriteRequest>(() => pending.promise)
    const owner = createOwner(write)
    adoptDefaultServer(owner)

    owner.update({ address: '127.0.0.1:5555' })
    const saving = owner.save()
    owner.update({ address: '127.0.0.1:6666' })

    pending.resolve({ success: true })
    const outcome = await saving

    expect(outcome).toMatchObject({ status: 'saved', superseded: true })
    expect(write).toHaveBeenCalledWith('default', connection({ address: '127.0.0.1:5555' }))
    expect(owner.getState()).toMatchObject({
      draft: connection({ address: '127.0.0.1:6666' }),
      persisted: connection({ address: '127.0.0.1:5555' }),
      revision: 3,
      dirty: true,
      syncState: 'idle',
    })
  })

  it('keeps the draft on failure and allows a later retry', async () => {
    const write = vi.fn<WriteRequest>()
      .mockResolvedValueOnce({ success: false, message: '磁盘只读' })
      .mockResolvedValueOnce({ success: true })
    const owner = createOwner(write)
    adoptDefaultServer(owner)

    owner.update({ address: '127.0.0.1:5555' })
    const failed = await owner.save()

    expect(failed).toMatchObject({ status: 'failed', superseded: false, message: '磁盘只读' })
    expect(owner.getState()).toMatchObject({
      draft: connection({ address: '127.0.0.1:5555' }),
      syncState: 'failed',
      error: '磁盘只读',
      dirty: true,
    })

    const saved = await owner.save()
    expect(saved).toMatchObject({ status: 'saved', superseded: false })
    expect(owner.getState()).toMatchObject({
      persisted: connection({ address: '127.0.0.1:5555' }),
      syncState: 'idle',
      error: null,
      dirty: false,
    })
  })

  it('turns a thrown write into a failed outcome with the original message', async () => {
    const owner = createOwner(vi.fn(async () => {
      throw new Error('网络中断')
    }))
    adoptDefaultServer(owner)

    owner.update({ address: '127.0.0.1:5555' })
    await expect(owner.save()).resolves.toMatchObject({
      status: 'failed',
      message: '网络中断',
    })
    expect(owner.getState()).toMatchObject({ syncState: 'failed', error: '网络中断' })
  })

  it('preserves unknown connection fields through edits and saves', async () => {
    const write = vi.fn<WriteRequest>(async () => ({ success: true }))
    const owner = createOwner(write)
    const token = owner.beginRead()

    owner.adoptServer({
      config: connection({ touch_mode: 'minitouch' }),
      readToken: token,
    })
    owner.update({ address: '127.0.0.1:5555' })
    await owner.save()

    expect(write).toHaveBeenCalledWith('default', connection({
      address: '127.0.0.1:5555',
      touch_mode: 'minitouch',
    }))
  })

  it('resets all owner state for a new session', () => {
    const owner = createOwner()
    adoptDefaultServer(owner)
    owner.update({ address: '127.0.0.1:5555' })

    owner.reset()

    expect(owner.getState()).toMatchObject({
      draft: DEFAULT_CONNECTION_CONFIG,
      revision: 0,
      dirty: false,
      loaded: false,
      lastSavedAt: null,
    })
  })
})

describe('connection config query', () => {
  beforeEach(() => {
    apiMocks.getConfig.mockReset()
  })

  it('uses the reserved settings maa-config key and forwards the query signal', async () => {
    apiMocks.getConfig.mockResolvedValue({
      success: true,
      data: connection({ address: '10.0.0.2:5555' }),
    })
    const owner = createOwner()
    const options = connectionConfigQueryOptions('default', owner)

    expect(options.queryKey).toEqual(settingsKeys.query('maa-config', 'default'))
    expect(options.queryKey).toEqual(['settings', 'maa-config', 'default'])

    const data = await createQueryClient().fetchQuery(options)

    expect(apiMocks.getConfig).toHaveBeenCalledWith('default', expect.any(AbortSignal))
    expect(data.config.address).toBe('10.0.0.2:5555')
    expect(data.readToken).toEqual(owner.beginRead())
  })

  it('keeps the profile name in the cache identity', () => {
    expect(connectionConfigQueryOptions('work', createOwner()).queryKey)
      .toEqual(['settings', 'maa-config', 'work'])
  })

  it('turns an unusable payload into a contract failure', async () => {
    apiMocks.getConfig.mockResolvedValue({ success: true, data: 'not-a-profile' })

    const error = await createQueryClient()
      .fetchQuery(connectionConfigQueryOptions('default', createOwner()))
      .catch(cause => cause)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({
      kind: 'contract',
      code: 'INVALID_DOMAIN_PAYLOAD',
    })
  })

  it('turns a failed read envelope into a query error', async () => {
    apiMocks.getConfig.mockResolvedValue({ success: false, message: '配置服务不可用' })

    const error = await createQueryClient()
      .fetchQuery(connectionConfigQueryOptions('default', createOwner()))
      .catch(cause => cause)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ message: '配置服务不可用' })
  })
})
