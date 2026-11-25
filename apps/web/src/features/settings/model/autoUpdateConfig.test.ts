// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '@/shared/api'
import type { AutoUpdateConfig } from '../types'
import {
  AUTO_UPDATE_STORAGE_KEY,
  INVALID_UPDATE_TIME_MESSAGE,
  AutoUpdateConfigOwner,
} from './autoUpdateConfig'
import { DEFAULT_AUTO_UPDATE_CONFIG } from './configNormalization'

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

interface OwnerHarness {
  owner: AutoUpdateConfigOwner
  load: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  schedule: ReturnType<typeof vi.fn>
  store: Map<string, string>
  writeLocal: ReturnType<typeof vi.fn>
}

const createOwner = (stored?: AutoUpdateConfig): OwnerHarness => {
  const store = new Map<string, string>()
  if (stored) store.set(AUTO_UPDATE_STORAGE_KEY, JSON.stringify(stored))

  const load = vi.fn().mockResolvedValue({
    success: true,
    data: { enabled: false, time: '04:00', updateCore: true, updateCli: true },
  })
  const save = vi.fn().mockResolvedValue({ success: true })
  const schedule = vi.fn().mockResolvedValue({ success: true })
  const writeLocal = vi.fn((value: string) => {
    store.set(AUTO_UPDATE_STORAGE_KEY, value)
  })

  return {
    owner: new AutoUpdateConfigOwner({
      loadConfig: () => load(),
      saveConfig: (config: AutoUpdateConfig) => save(config),
      applySchedule: (config: AutoUpdateConfig) => schedule(config),
      readLocal: () => store.get(AUTO_UPDATE_STORAGE_KEY) ?? null,
      writeLocal,
    }),
    load,
    save,
    schedule,
    store,
    writeLocal,
  }
}

const enabledConfig: AutoUpdateConfig = {
  enabled: true,
  time: '05:30',
  updateCore: true,
  updateCli: false,
}

describe('AutoUpdateConfigOwner load', () => {
  it('starts from the documented defaults', () => {
    const { owner } = createOwner()
    expect(owner.getState()).toEqual({
      draft: DEFAULT_AUTO_UPDATE_CONFIG,
      dirty: false,
      saving: false,
      feedback: null,
    })
  })

  it('adopts the server policy and caches it as the local fallback', async () => {
    const { owner, store, writeLocal } = createOwner()

    const outcome = await owner.load()

    expect(outcome).toEqual({ status: 'loaded', feedback: null })
    expect(owner.getState()).toMatchObject({ dirty: false, feedback: null })
    expect(store.get(AUTO_UPDATE_STORAGE_KEY)).toBe(JSON.stringify(DEFAULT_AUTO_UPDATE_CONFIG))
    expect(writeLocal).toHaveBeenCalledOnce()
  })

  it('clears a stale fallback warning when a later server read is adopted', async () => {
    const { owner, load } = createOwner(enabledConfig)
    load.mockResolvedValueOnce({ success: false, message: '配置目录不可读' })
    await owner.load()
    expect(owner.getState().feedback?.type).toBe('warning')

    load.mockResolvedValueOnce({ success: true, data: { enabled: false, time: '04:00' } })
    const outcome = await owner.load()

    expect(outcome).toEqual({ status: 'loaded', feedback: null })
    expect(owner.getState()).toMatchObject({
      draft: { enabled: false, time: '04:00', updateCore: true, updateCli: true },
      dirty: false,
      feedback: null,
    })
  })

  it('does not let a late server read overwrite a newer edit', async () => {
    const pending = deferred<ApiResponse>()
    const { owner, load, store } = createOwner()
    load.mockReturnValueOnce(pending.promise)

    const loading = owner.load()
    owner.update({ time: '06:30' })
    pending.resolve({
      success: true,
      data: { enabled: true, time: '04:00', updateCore: true, updateCli: true },
    })
    await loading

    expect(owner.getState().draft.time).toBe('06:30')
    expect(owner.getState().dirty).toBe(true)
    expect(store.get(AUTO_UPDATE_STORAGE_KEY)).toBe(JSON.stringify(owner.getState().draft))
  })

  it('falls back to the local draft with a warning when the server read fails', async () => {
    const { owner, load } = createOwner(enabledConfig)
    load.mockResolvedValue({ success: false, message: '配置目录不可读' })

    const outcome = await owner.load()

    expect(outcome.status).toBe('local-fallback')
    expect(owner.getState().draft).toEqual(enabledConfig)
    expect(owner.getState().dirty).toBe(true)
    expect(owner.getState().feedback).toEqual({
      type: 'warning',
      message: '自动更新设置读取失败: 配置目录不可读，已显示此设备上次保存的设置，修改后将自动同步',
    })
  })

  it('reports a server read failure when no local fallback exists', async () => {
    const { owner, load } = createOwner()
    load.mockResolvedValue({ success: false, message: '服务不可用' })

    const outcome = await owner.load()

    expect(outcome.status).toBe('failed')
    expect(owner.getState().feedback).toEqual({
      type: 'error',
      message: '自动更新设置读取失败: 服务不可用',
    })
  })

  it('uses the local draft without a server error message for a bad server payload', async () => {
    const { owner, load } = createOwner(enabledConfig)
    load.mockResolvedValue({ success: true, data: 'not-a-config' })

    const outcome = await owner.load()

    expect(outcome.status).toBe('local-fallback')
    expect(owner.getState().draft).toEqual(enabledConfig)
    expect(owner.getState().feedback).toEqual({
      type: 'warning',
      message: '已载入此设备上次保存的自动更新设置，修改后将自动同步',
    })
  })

  it('reports a malformed local draft instead of inventing a config', async () => {
    const malformed = new AutoUpdateConfigOwner({
      loadConfig: vi.fn().mockResolvedValue({ success: false, message: '离线' }),
      readLocal: () => '{bad json',
      writeLocal: vi.fn(),
    })

    const outcome = await malformed.load()

    expect(outcome.status).toBe('failed')
    expect(malformed.getState().feedback?.type).toBe('error')
    expect(malformed.getState().feedback?.message).toContain('自动更新设置读取失败')
  })
})

describe('AutoUpdateConfigOwner draft', () => {
  it('marks every edit dirty, clears feedback and writes the local fallback', async () => {
    const { owner, store } = createOwner()
    await owner.load()
    owner.update({ time: '07:15' })
    owner.update({ enabled: true })

    expect(owner.getState()).toMatchObject({
      draft: { enabled: true, time: '07:15', updateCore: true, updateCli: true },
      dirty: true,
      feedback: null,
    })
    expect(store.get(AUTO_UPDATE_STORAGE_KEY)).toBe(JSON.stringify(owner.getState().draft))
  })

  it('ignores an edit that does not change any field', async () => {
    const { owner, writeLocal } = createOwner()
    await owner.load()
    const before = owner.getState().draft
    writeLocal.mockClear()

    owner.update({ enabled: false, time: '04:00', updateCore: true, updateCli: true })

    expect(owner.getState().draft).toBe(before)
    expect(owner.getState().dirty).toBe(false)
    expect(writeLocal).not.toHaveBeenCalled()
  })
})

describe('AutoUpdateConfigOwner save', () => {
  it('rejects an invalid time before any request', async () => {
    const { owner, save, schedule } = createOwner()
    owner.update({ enabled: true, time: '24:00' })

    const outcome = await owner.save()

    expect(outcome).toEqual({
      status: 'invalid',
      feedback: { type: 'error', message: INVALID_UPDATE_TIME_MESSAGE },
    })
    expect(save).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
    expect(owner.getState().saving).toBe(false)
    expect(owner.getState().dirty).toBe(true)
  })

  it('writes the policy then applies the schedule before clearing dirty', async () => {
    const { owner, save, schedule, store } = createOwner()
    owner.update({ enabled: true, time: '05:30', updateCli: false })

    const outcome = await owner.save()

    expect(outcome).toEqual({
      status: 'saved',
      feedback: { type: 'success', message: '自动更新已启用，每天 05:30 执行' },
    })
    expect(save).toHaveBeenCalledWith({ ...enabledConfig })
    expect(schedule).toHaveBeenCalledWith({ ...enabledConfig })
    expect(save.mock.invocationCallOrder[0]!).toBeLessThan(schedule.mock.invocationCallOrder[0]!)
    expect(owner.getState()).toMatchObject({ saving: false, dirty: false })
    expect(store.get(AUTO_UPDATE_STORAGE_KEY)).toBe(JSON.stringify(enabledConfig))
  })

  it('still requires a successful scheduler call when auto-update is disabled', async () => {
    const { owner, schedule } = createOwner()
    schedule.mockResolvedValue({ success: false, message: '无法停止任务' })
    owner.update({ enabled: false, time: '05:30' })

    const outcome = await owner.save()

    expect(outcome.status).toBe('failed')
    expect(owner.getState().feedback?.message).toContain('自动更新设置应用失败')
    expect(owner.getState().dirty).toBe(true)
  })

  it('does not apply the schedule when saving the user config fails', async () => {
    const { owner, save, schedule, store } = createOwner()
    save.mockResolvedValue({ success: false, message: '配置目录不可写' })
    owner.update({ enabled: true, time: '06:15' })
    const before = store.get(AUTO_UPDATE_STORAGE_KEY)

    const outcome = await owner.save()

    expect(outcome.status).toBe('failed')
    expect(schedule).not.toHaveBeenCalled()
    expect(owner.getState()).toMatchObject({ saving: false, dirty: true })
    expect(owner.getState().feedback).toEqual({
      type: 'error',
      message: '自动更新设置保存失败: 配置目录不可写',
    })
    expect(store.get(AUTO_UPDATE_STORAGE_KEY)).toBe(before)
  })

  it('reports an inner scheduler failure as an apply failure and keeps the draft', async () => {
    const { owner, schedule } = createOwner()
    schedule.mockResolvedValue({
      success: true,
      data: { success: false, message: '无法创建定时任务' },
    })
    owner.update({ enabled: true, time: '04:30' })

    const outcome = await owner.save()

    expect(outcome.status).toBe('failed')
    expect(owner.getState()).toMatchObject({ saving: false, dirty: true })
    expect(owner.getState().feedback).toEqual({
      type: 'error',
      message: '自动更新设置应用失败: 无法创建定时任务',
    })
  })

  it('adopts a newer server copy after a confirmed save', async () => {
    const harness = createOwner()
    harness.owner.update({ enabled: true, time: '05:30' })
    await harness.owner.save()
    expect(harness.owner.getState().dirty).toBe(false)

    harness.load.mockResolvedValueOnce({
      success: true,
      data: { enabled: true, time: '08:00', updateCore: false, updateCli: true },
    })
    await harness.owner.load()

    expect(harness.owner.getState()).toMatchObject({
      draft: { enabled: true, time: '08:00', updateCore: false, updateCli: true },
      dirty: false,
      feedback: null,
    })
  })

  it('does not let a read started before a save overwrite the saved draft', async () => {
    const harness = createOwner()
    const pendingLoad = deferred<ApiResponse>()
    harness.load.mockReturnValueOnce(pendingLoad.promise)

    const loading = harness.owner.load()
    harness.owner.update({ enabled: true, time: '05:30' })
    await harness.owner.save()

    pendingLoad.resolve({
      success: true,
      data: { enabled: false, time: '04:00', updateCore: true, updateCli: true },
    })
    await loading

    expect(harness.owner.getState().draft.time).toBe('05:30')
    expect(harness.owner.getState().dirty).toBe(false)
  })

  it('does not mark edits made during a save as persisted', async () => {
    const pending = deferred<ApiResponse>()
    const harness = createOwner()
    harness.owner.update({ enabled: true, time: '05:30' })
    harness.save.mockReturnValueOnce(pending.promise)

    const saving = harness.owner.save()
    harness.owner.update({ time: '06:45' })
    pending.resolve({ success: true })
    const outcome = await saving

    expect(outcome).toEqual({
      status: 'superseded',
      feedback: { type: 'warning', message: '此前设置已保存，当前更改尚未保存' },
    })
    expect(harness.schedule).toHaveBeenCalledWith({
      enabled: true,
      time: '05:30',
      updateCore: true,
      updateCli: true,
    })
    expect(harness.owner.getState().draft.time).toBe('06:45')
    expect(harness.owner.getState()).toMatchObject({ dirty: true, saving: false })
    expect(harness.store.get(AUTO_UPDATE_STORAGE_KEY)).toContain('06:45')
  })

  it('ignores a second save while one is in flight', async () => {
    const pending = deferred<ApiResponse>()
    const harness = createOwner()
    harness.owner.update({ enabled: true, time: '05:30' })
    harness.save.mockReturnValueOnce(pending.promise)

    const first = harness.owner.save()
    const second = await harness.owner.save()

    expect(second).toEqual({ status: 'ignored', feedback: null })
    expect(harness.save).toHaveBeenCalledOnce()

    pending.resolve({ success: true })
    await first
  })

  it('reports a thrown scheduler error through the save failure path', async () => {
    const harness = createOwner()
    harness.owner.update({ enabled: true, time: '05:30' })
    harness.schedule.mockRejectedValue(new Error('命令行超时'))

    const outcome = await harness.owner.save()

    expect(outcome.status).toBe('failed')
    expect(harness.owner.getState()).toMatchObject({ saving: false, dirty: true })
    expect(harness.owner.getState().feedback).toEqual({
      type: 'error',
      message: '自动更新设置保存失败: 命令行超时',
    })
  })
})

describe('AutoUpdateConfigOwner reset', () => {
  it('restores defaults and forgets prior edits', async () => {
    const harness = createOwner()
    await harness.owner.load()
    harness.owner.update({ enabled: true, time: '09:00' })

    harness.owner.reset()

    expect(harness.owner.getState()).toEqual({
      draft: DEFAULT_AUTO_UPDATE_CONFIG,
      dirty: false,
      saving: false,
      feedback: null,
    })
  })
})
