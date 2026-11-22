// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '@/shared/api'
import type { ResourceInvalidation } from '@/features/resource-invalidation'
import type { TrainingSettings } from '../types'
import {
  DEFAULT_TRAINING_SETTINGS,
  TRAINING_SETTINGS_FAILURE_MESSAGE,
  TrainingSettingsOwner,
  type TrainingSettingsPatch,
} from './settingsCommands'

interface DeferredResult<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

const deferred = <T,>(): DeferredResult<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const settings = (overrides: Partial<TrainingSettings> = {}): TrainingSettings => ({
  ...DEFAULT_TRAINING_SETTINGS,
  ...overrides,
})

const settle = async <T,>(target: DeferredResult<T>, value: T): Promise<void> => {
  target.resolve(value)
  await target.promise
}

const createOwner = (
  write: (value: TrainingSettingsPatch) => Promise<ApiResponse<unknown>> = vi.fn(async () => ({ success: true })),
  publish: (invalidation: ResourceInvalidation) => void = vi.fn(),
) => new TrainingSettingsOwner({ write, publish })


describe('training settings owner', () => {
  it('starts from the documented defaults', () => {
    const owner = createOwner()

    expect(owner.getState()).toEqual({
      settings: DEFAULT_TRAINING_SETTINGS,
      persisted: DEFAULT_TRAINING_SETTINGS,
      revision: 0,
      syncState: 'idle',
      error: null,
    })
  })

  it('serializes edits and never lets an older response overwrite the latest value', async () => {
    const first = deferred<ApiResponse<unknown>>()
    const second = deferred<ApiResponse<unknown>>()
    const write = vi.fn((_value: TrainingSettingsPatch) => first.promise)
    write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const owner = createOwner(write)

    const firstUpdate = owner.update(settings({ autoSwitch: false }))
    expect(owner.getState()).toMatchObject({
      settings: settings({ autoSwitch: false }),
      revision: 1,
      syncState: 'saving',
    })

    const secondUpdate = owner.update(settings())
    expect(owner.getState()).toMatchObject({
      settings: settings(),
      revision: 2,
      syncState: 'saving',
    })
    await Promise.resolve()
    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenLastCalledWith(settings({ autoSwitch: false }))

    await settle(first, { success: true, data: settings({ autoSwitch: false }) })
    const firstOutcome = await firstUpdate

    expect(firstOutcome).toMatchObject({ status: 'saved', superseded: true })
    // 旧响应只推进 persisted；页面仍显示后一次编辑。
    expect(owner.getState()).toMatchObject({
      settings: settings(),
      persisted: settings({ autoSwitch: false }),
      revision: 2,
      syncState: 'saving',
    })
    await Promise.resolve()
    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith(settings())

    await settle(second, { success: true, data: settings() })
    expect(await secondUpdate).toMatchObject({ status: 'saved', superseded: false })
    expect(owner.getState()).toMatchObject({
      settings: settings(),
      persisted: settings(),
      revision: 2,
      syncState: 'idle',
    })
  })

  it('rolls back only the latest failed edit and ignores an older failure', async () => {
    const first = deferred<ApiResponse<unknown>>()
    const second = deferred<ApiResponse<unknown>>()
    const write = vi.fn((_value: TrainingSettingsPatch) => first.promise)
    write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const owner = createOwner(write)

    const firstUpdate = owner.update(settings({ autoSwitch: false }))
    const secondUpdate = owner.update(settings())

    await settle(first, { success: false, message: '设置服务不可用' })
    const firstOutcome = await firstUpdate
    expect(firstOutcome).toMatchObject({ status: 'failed', superseded: true })
    expect(owner.getState()).toMatchObject({
      settings: settings(),
      syncState: 'saving',
      error: null,
    })

    await settle(second, { success: false, message: '设置服务不可用' })
    const secondOutcome = await secondUpdate
    expect(secondOutcome).toMatchObject({
      status: 'failed',
      superseded: false,
      message: '设置服务不可用',
    })
    // 第二次编辑的值本来就等于已确认值，回滚不制造一次无意义的 revision。
    expect(owner.getState()).toMatchObject({
      settings: settings(),
      revision: 2,
      syncState: 'failed',
      error: '设置服务不可用',
    })
  })

  it('uses the server-normalized value only for the latest edit', async () => {
    const write = vi.fn(async (_value: TrainingSettingsPatch) => ({
      success: true,
      data: settings({ useMedicine: 0 }),
    }))
    const owner = createOwner(write)

    await owner.update(settings({ useMedicine: 3 }))

    expect(owner.getState()).toMatchObject({
      settings: settings({ useMedicine: 0 }),
      persisted: settings({ useMedicine: 0 }),
      revision: 2,
      syncState: 'idle',
    })
  })

  it('falls back to the requested settings when the response omits them', async () => {
    const owner = createOwner(vi.fn(async () => ({ success: true })))

    await owner.update(settings({ notifyOnComplete: false }))

    expect(owner.getState()).toMatchObject({
      settings: settings({ notifyOnComplete: false }),
      persisted: settings({ notifyOnComplete: false }),
      syncState: 'idle',
    })
  })

  it('submits only the fields provided by a patch', async () => {
    const write = vi.fn(async (_value: TrainingSettingsPatch) => ({
      success: true,
      data: settings({ autoSwitch: false }),
    }))
    const owner = createOwner(write)

    await owner.update({ autoSwitch: false })

    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith({ autoSwitch: false })
  })

  it('merges a patch into hydrated settings and adopts hidden response fields', async () => {
    const pending = deferred<ApiResponse<unknown>>()
    const owner = createOwner(vi.fn(async () => pending.promise))

    owner.hydrate(settings({ useMedicine: 5, useStone: 3 }))
    const update = owner.update({ autoSwitch: false })

    expect(owner.getState()).toMatchObject({
      settings: settings({ useMedicine: 5, useStone: 3, autoSwitch: false }),
      persisted: settings({ useMedicine: 5, useStone: 3 }),
      syncState: 'saving',
    })

    await settle(pending, {
      success: true,
      data: { useMedicine: 7, useStone: 3, autoSwitch: false },
    })
    await update

    expect(owner.getState()).toMatchObject({
      settings: settings({ useMedicine: 7, useStone: 3, autoSwitch: false }),
      persisted: settings({ useMedicine: 7, useStone: 3, autoSwitch: false }),
      syncState: 'idle',
    })
  })

  it('serializes patches and keeps persisted at the last confirmed value when the later patch fails', async () => {
    const first = deferred<ApiResponse<unknown>>()
    const second = deferred<ApiResponse<unknown>>()
    const write = vi.fn((_value: TrainingSettingsPatch) => first.promise)
    write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const owner = createOwner(write)

    const firstUpdate = owner.update({ autoSwitch: false })
    const secondUpdate = owner.update({ notifyOnComplete: false })
    await Promise.resolve()

    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenLastCalledWith({ autoSwitch: false })

    await settle(first, {
      success: true,
      data: settings({ autoSwitch: false }),
    })
    expect(await firstUpdate).toMatchObject({ status: 'saved', superseded: true })
    expect(owner.getState()).toMatchObject({
      settings: settings({ autoSwitch: false, notifyOnComplete: false }),
      persisted: settings({ autoSwitch: false }),
      syncState: 'saving',
    })

    await Promise.resolve()
    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith({ notifyOnComplete: false })

    await settle(second, { success: false, message: '设置服务不可用' })
    expect(await secondUpdate).toMatchObject({
      status: 'failed',
      superseded: false,
      message: '设置服务不可用',
    })
    expect(owner.getState()).toMatchObject({
      settings: settings({ autoSwitch: false }),
      persisted: settings({ autoSwitch: false }),
      syncState: 'failed',
      error: '设置服务不可用',
    })
  })

  it('still accepts a complete settings object', async () => {
    const write = vi.fn(async (_value: TrainingSettingsPatch) => ({
      success: true,
      data: settings({ autoSwitch: false }),
    }))
    const owner = createOwner(write)

    await owner.update(settings({ autoSwitch: false }))

    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith(settings({ autoSwitch: false }))
    expect(owner.getState()).toMatchObject({
      settings: settings({ autoSwitch: false }),
      persisted: settings({ autoSwitch: false }),
      syncState: 'idle',
    })
  })

  it('ignores an edit that does not change the observable settings', async () => {
    const write = vi.fn(async () => ({ success: true }))
    const owner = createOwner(write)

    const outcome = await owner.update(settings())

    expect(outcome).toMatchObject({ status: 'ignored', superseded: false })
    expect(write).not.toHaveBeenCalled()
    expect(owner.getState()).toMatchObject({ revision: 0, syncState: 'idle' })
  })

  it('hydrates once and never lets a later snapshot overwrite a local edit', async () => {
    const owner = createOwner()

    expect(owner.hydrate(settings({ autoSwitch: false }))).toBe(true)
    expect(owner.getState()).toMatchObject({
      settings: settings({ autoSwitch: false }),
      persisted: settings({ autoSwitch: false }),
      revision: 1,
    })

    expect(owner.hydrate(settings())).toBe(false)
    expect(owner.getState().settings).toEqual(settings({ autoSwitch: false }))

    await owner.update(settings())
    expect(owner.hydrate(settings({ autoSwitch: false }))).toBe(false)
    expect(owner.getState().settings).toEqual(settings())
  })

  it('does not hydrate a server snapshot after an edit that started before it', async () => {
    const owner = createOwner()

    await owner.update(settings({ autoSwitch: false }))

    expect(owner.hydrate(settings())).toBe(false)
    expect(owner.getState().settings).toEqual(settings({ autoSwitch: false }))
  })

  it('ignores snapshots while a write is in flight and adopts an explicit reload afterwards', async () => {
    const pending = deferred<ApiResponse<unknown>>()
    const owner = createOwner(vi.fn(async () => pending.promise))

    const update = owner.update(settings({ autoSwitch: false }))

    expect(owner.adopt(settings())).toBe(false)
    expect(owner.getState().settings).toEqual(settings({ autoSwitch: false }))

    await settle(pending, { success: true, data: settings({ autoSwitch: false }) })
    await update

    expect(owner.adopt(settings())).toBe(true)
    expect(owner.getState()).toMatchObject({
      settings: settings(),
      persisted: settings(),
      revision: 2,
      syncState: 'idle',
    })
  })

  it('drops a write that resolves after an explicit reset', async () => {
    const pending = deferred<ApiResponse<unknown>>()
    const owner = createOwner(vi.fn(async () => pending.promise))

    const update = owner.update(settings({ autoSwitch: false }))
    owner.reset()
    await settle(pending, { success: true, data: settings({ autoSwitch: false }) })
    const outcome = await update

    expect(outcome.superseded).toBe(true)
    expect(owner.getState()).toEqual({
      settings: DEFAULT_TRAINING_SETTINGS,
      persisted: DEFAULT_TRAINING_SETTINGS,
      revision: 0,
      syncState: 'idle',
      error: null,
    })
  })

  it('publishes a plan invalidation only after a confirmed write', async () => {
    const publish = vi.fn((_invalidation: ResourceInvalidation) => undefined)
    const write = vi.fn()
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true, data: settings({ autoSwitch: false }) })
    const owner = createOwner(write, publish)

    await owner.update(settings({ autoSwitch: false }))
    expect(publish).not.toHaveBeenCalled()

    await owner.update(settings({ autoSwitch: false }))
    expect(publish).toHaveBeenCalledWith({
      resources: ['training-plan'],
      cause: 'training-settings',
      detail: { source: 'training-settings-owner' },
    })
  })

  it('reports the fallback failure message when the response has no reason', async () => {
    const owner = createOwner(vi.fn(async () => ({ success: false })))

    const outcome = await owner.update(settings({ autoSwitch: false }))

    expect(outcome).toMatchObject({
      status: 'failed',
      superseded: false,
      message: TRAINING_SETTINGS_FAILURE_MESSAGE,
    })
    expect(owner.getState()).toMatchObject({
      settings: settings(),
      revision: 2,
      syncState: 'failed',
      error: TRAINING_SETTINGS_FAILURE_MESSAGE,
    })
  })
})
