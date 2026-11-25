// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '@/shared/api'
import {
  SETTINGS_UPDATE_RESOURCE_SCOPES,
  SettingsUpdateOwner,
  coreChannelLabel,
  readUpdateFailureDetails,
  resolveCoreChannel,
  shouldRetryUpdateResources,
} from './updateCommands'
import type { SettingsUpdateRunPort, UpdateRunTerminal } from './updateRunPort'

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

interface OwnerMocks {
  updateCore: ReturnType<typeof vi.fn<(version?: string) => Promise<ApiResponse>>>
  updateCli: ReturnType<typeof vi.fn<() => Promise<ApiResponse>>>
  updateResources: ReturnType<typeof vi.fn<() => Promise<ApiResponse>>>
}

const createLegacyRunPort = (): SettingsUpdateRunPort => ({
  adopt: () => null,
  wait: vi.fn(),
  release: vi.fn(),
  cancel: vi.fn(),
  tracked: () => null,
  subscribe: () => () => undefined,
})

const createOwner = (
  responses: Partial<Record<keyof OwnerMocks, Promise<ApiResponse>>> = {},
  runPort: SettingsUpdateRunPort = createLegacyRunPort(),
): { owner: SettingsUpdateOwner; mocks: OwnerMocks } => {
  const mocks: OwnerMocks = {
    updateCore: vi.fn<(version?: string) => Promise<ApiResponse>>()
      .mockResolvedValue({ success: true, message: 'core ok' }),
    updateCli: vi.fn<() => Promise<ApiResponse>>()
      .mockResolvedValue({ success: true, message: 'cli ok' }),
    updateResources: vi.fn<() => Promise<ApiResponse>>()
      .mockResolvedValue({ success: true, message: 'resources ok' }),
  }
  if (responses.updateCore) mocks.updateCore.mockReturnValueOnce(responses.updateCore)
  if (responses.updateCli) mocks.updateCli.mockReturnValueOnce(responses.updateCli)
  if (responses.updateResources) mocks.updateResources.mockReturnValueOnce(responses.updateResources)

  return {
    owner: new SettingsUpdateOwner({
      updateCore: version => mocks.updateCore(version),
      updateCli: () => mocks.updateCli(),
      updateResources: () => mocks.updateResources(),
      runPort,
    }),
    mocks,
  }
}

describe('core channel policy', () => {
  it('reads the installed channel from the version string', () => {
    expect(resolveCoreChannel('v5.0.0')).toBe('stable')
    expect(resolveCoreChannel('v5.0.0-beta.1')).toBe('beta')
    expect(resolveCoreChannel('v5.0.0-alpha.2')).toBe('alpha')
    expect(resolveCoreChannel(undefined)).toBe('stable')
    expect(resolveCoreChannel(null)).toBe('stable')
    expect(coreChannelLabel('stable')).toBe('正式版')
    expect(coreChannelLabel('beta')).toBe('Beta')
    expect(coreChannelLabel('alpha')).toBe('Alpha')
  })

  it('reads failure details from the typed error envelope', () => {
    expect(readUpdateFailureDetails({
      success: false,
      errorInfo: { details: { failedStep: 'resources', coreUpdated: true } },
    })).toEqual({ failedStep: 'resources', coreUpdated: true })

    expect(readUpdateFailureDetails({ success: false })).toEqual({})
  })

  it('only offers the resource retry for a resource or post-core failure', () => {
    expect(shouldRetryUpdateResources({
      success: false,
      errorInfo: { details: { failedStep: 'resources' } },
    })).toBe(true)
    expect(shouldRetryUpdateResources({
      success: false,
      errorInfo: { details: { coreUpdated: true } },
    })).toBe(true)
    expect(shouldRetryUpdateResources({
      success: false,
      errorInfo: { details: { failedStep: 'core', coreUpdated: false } },
    })).toBe(false)
  })

  it('declares only the scopes actually changed by a resource update', () => {
    expect([...SETTINGS_UPDATE_RESOURCE_SCOPES]).toEqual([
      'catalog',
      'materials',
      'training-plan',
      'dashboard-snapshot',
    ])
  })
})

describe('SettingsUpdateOwner', () => {
  it('starts idle without feedback', () => {
    const { owner } = createOwner()
    expect(owner.getState()).toEqual({ running: null, feedback: null, canceling: false })
  })

  it('reports in-progress state and succeeds with resource and version changes', async () => {
    const pending = deferred<ApiResponse>()
    const { owner, mocks } = createOwner({ updateCore: pending.promise })

    const promise = owner.updateCore()
    expect(owner.getState().running).toBe('core')
    expect(mocks.updateCore).toHaveBeenCalledWith(undefined)

    pending.resolve({ success: true, message: 'MaaCore 和资源已更新' })
    const outcome = await promise

    expect(outcome).toMatchObject({
      status: 'succeeded',
      operation: 'core',
      message: 'MaaCore 和资源已更新',
      resourcesChanged: true,
      versionChanged: true,
      feedback: { type: 'success', message: 'MaaCore 和资源已更新' },
    })
    expect(owner.getState()).toEqual({
      running: null,
      feedback: { type: 'success', message: 'MaaCore 和资源已更新', resourceRetry: false },
      canceling: false,
    })
  })

  it('clears older feedback when a core or resource command starts', async () => {
    const failed = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        message: '资源同步失败',
        errorInfo: { details: { failedStep: 'resources' } },
      })
      .mockResolvedValueOnce({ success: true, message: '资源文件更新成功' })
    const owner = new SettingsUpdateOwner({
      updateCore: () => failed(),
      updateCli: vi.fn(),
      updateResources: () => failed(),
    })

    await owner.updateCore()
    expect(owner.getState().feedback).toMatchObject({ resourceRetry: true })

    await owner.updateResources()
    expect(owner.getState().running).toBeNull()
    expect(owner.getState().feedback).toEqual({
      type: 'success',
      message: '资源已更新',
      resourceRetry: false,
    })
  })

  it('offers a resource retry on core failures that already updated core or resources', async () => {
    const { owner } = createOwner({
      updateCore: Promise.resolve({
        success: false,
        message: '资源同步失败',
        errorInfo: { details: { failedStep: 'resources', coreUpdated: true } },
      }),
    })

    const outcome = await owner.updateCore()

    expect(outcome.status).toBe('failed')
    expect(outcome.message).toBe('资源同步失败')
    expect(outcome.messageType).toBe('error')
    expect(outcome.resourcesChanged).toBe(false)
    expect(outcome.versionChanged).toBe(false)
    expect(owner.getState().feedback).toEqual({
      type: 'error',
      message: '资源同步失败',
      resourceRetry: true,
    })
  })

  it('reports network failures without retrying the command', async () => {
    const updateCore = vi.fn().mockRejectedValue(new Error('服务未启动'))
    const owner = new SettingsUpdateOwner({ updateCore })

    const outcome = await owner.updateCore()

    expect(updateCore).toHaveBeenCalledOnce()
    expect(outcome.status).toBe('failed')
    expect(outcome.message).toBe('网络错误: 服务未启动')
    expect(outcome.feedback).toEqual({
      type: 'error',
      message: '网络错误: 服务未启动',
      resourceRetry: false,
    })
    expect(owner.getState().running).toBeNull()
  })

  it('keeps CLI updates out of the inline feedback area', async () => {
    const updateCli = vi.fn().mockResolvedValue({ success: true })
    const owner = new SettingsUpdateOwner({
      updateCore: vi.fn(),
      updateCli,
      updateResources: vi.fn().mockResolvedValue({ success: true, message: '资源文件更新成功' }),
    })

    await owner.updateResources()
    const success = await owner.updateCli()

    expect(success.status).toBe('succeeded')
    expect(success.message).toBe('MAA CLI 更新成功')
    expect(success.feedback).toBeNull()
    expect(success.resourcesChanged).toBe(false)
    expect(success.versionChanged).toBe(true)
    // CLI 更新不清空此前的资源更新反馈。
    expect(owner.getState().feedback).toEqual({
      type: 'success',
      message: '资源已更新',
      resourceRetry: false,
    })

    updateCli.mockResolvedValueOnce({ success: false, message: 'brew 不可用' })
    const failure = await owner.updateCli()
    expect(failure.status).toBe('failed')
    expect(failure.feedback).toBeNull()
    expect(failure.message).toBe('更新失败: brew 不可用')
  })

  it('passes an explicit CLI channel through to the request', async () => {
    const updateCli = vi.fn().mockResolvedValue({ success: true, message: 'MAA CLI 更新完成（测试版 渠道）' })
    const owner = new SettingsUpdateOwner({ updateCli })

    const outcome = await owner.updateCli('beta')

    expect(updateCli).toHaveBeenCalledWith('beta')
    expect(outcome.message).toBe('MAA CLI 更新成功')
    expect(outcome.versionChanged).toBe(true)
  })

  it('installs an explicit core channel and reports the target label', async () => {
    const { owner, mocks } = createOwner()

    const stabilized = await owner.updateCore('stable')
    expect(mocks.updateCore).toHaveBeenLastCalledWith('stable')
    expect(stabilized).toMatchObject({
      status: 'succeeded',
      operation: 'core-channel',
      message: '已切换到 正式版 渠道并同步最新资源',
      resourcesChanged: true,
    })

    await owner.updateCore('beta')
    expect(mocks.updateCore).toHaveBeenLastCalledWith('beta')
  })

  it('marks every resource-only failure as retryable and keeps the server message', async () => {
    const { owner } = createOwner({
      updateResources: Promise.resolve({
        success: false,
        message: '资源同步失败: 下载超时',
        errorInfo: { details: { failedStep: 'resources' } },
      }),
    })

    const outcome = await owner.updateResources()

    expect(outcome.status).toBe('failed')
    expect(outcome.message).toBe('资源同步失败: 下载超时')
    expect(outcome.feedback).toEqual({
      type: 'error',
      message: '资源同步失败: 下载超时',
      resourceRetry: true,
    })
  })

  it('shows the concurrent update conflict message and keeps the resource retry entry', async () => {
    const message = '已有资源更新正在进行（runId: run-active，状态：执行中），请等待当前更新完成'
    const { owner } = createOwner({
      updateResources: Promise.resolve({
        success: false,
        message,
        errorInfo: {
          code: 'AGENT_MAA_RESOURCE_UPDATE_IN_PROGRESS',
          details: { activeRunId: 'run-active', activeRunState: 'running', runId: 'run-rejected' },
          retryable: true,
          status: 409,
        },
      }),
    })

    const outcome = await owner.updateResources()

    expect(outcome).toMatchObject({
      status: 'failed',
      message,
      messageType: 'error',
      feedback: { type: 'error', message, resourceRetry: true },
    })
  })

  it('tracks the running slot for CLI and resource commands', async () => {
    const pendingCli = deferred<ApiResponse>()
    const pendingResources = deferred<ApiResponse>()
    const owner = new SettingsUpdateOwner({
      updateCore: vi.fn(),
      updateCli: () => pendingCli.promise,
      updateResources: () => pendingResources.promise,
    })

    const cli = owner.updateCli()
    expect(owner.getState().running).toBe('cli')
    pendingCli.resolve({ success: true })
    await cli
    expect(owner.getState().running).toBeNull()

    const resources = owner.updateResources()
    expect(owner.getState().running).toBe('resources')
    pendingResources.resolve({ success: true })
    await resources
    expect(owner.getState().running).toBeNull()
  })

  it('shares one in-flight slot across all update commands', async () => {
    const pending = deferred<ApiResponse>()
    const { owner, mocks } = createOwner({ updateCore: pending.promise })

    const core = owner.updateCore()
    const cli = await owner.updateCli()
    const resources = await owner.updateResources()
    const channel = await owner.updateCore('beta')

    expect(cli).toMatchObject({ status: 'ignored', operation: 'cli', message: null })
    expect(resources).toMatchObject({ status: 'ignored', operation: 'resources' })
    expect(channel).toMatchObject({ status: 'ignored', operation: 'core-channel' })
    expect(mocks.updateCli).not.toHaveBeenCalled()
    expect(mocks.updateResources).not.toHaveBeenCalled()
    expect(mocks.updateCore).toHaveBeenCalledOnce()

    pending.resolve({ success: true })
    await core

    expect((await owner.updateCli()).status).toBe('succeeded')
    expect(mocks.updateCli).toHaveBeenCalledOnce()
  })

  it('ignores a duplicate call for the same command while one is in flight', async () => {
    const pending = deferred<ApiResponse>()
    const { owner, mocks } = createOwner({ updateCore: pending.promise })

    const first = owner.updateCore()
    expect((await owner.updateCore()).status).toBe('ignored')
    expect(mocks.updateCore).toHaveBeenCalledOnce()

    pending.resolve({ success: true })
    await first
  })

  it('resets state for tests and explicit global resets', async () => {
    const { owner } = createOwner()
    await owner.updateCore()
    expect(owner.getState().feedback).not.toBeNull()

    owner.reset()
    expect(owner.getState()).toEqual({ running: null, feedback: null, canceling: false })
  })
})

describe('SettingsUpdateOwner run semantics', () => {
  const terminal = (overrides: Partial<UpdateRunTerminal> = {}): UpdateRunTerminal => ({
    state: 'succeeded',
    message: null,
    errorDetails: {},
    ...overrides,
  })

  const createRunPort = (
    wait: () => Promise<UpdateRunTerminal>,
    overrides: Partial<SettingsUpdateRunPort> = {},
  ): SettingsUpdateRunPort => ({
    adopt: response => {
      const data = response.data as { runId?: unknown } | undefined
      return typeof data?.runId === 'string' ? data.runId : null
    },
    wait,
    release: vi.fn(),
    cancel: vi.fn(),
    tracked: () => null,
    subscribe: () => () => undefined,
    ...overrides,
  })

  const submitted = (runId = 'run-core'): Promise<ApiResponse> => Promise.resolve({
    success: true,
    message: '更新已接受',
    data: { runId },
  })

  it('waits for the submitted run before reporting core update success', async () => {
    const pendingTerminal = deferred<UpdateRunTerminal>()
    const released: string[] = []
    const adopted: string[] = []
    const runPort = createRunPort(
      () => pendingTerminal.promise,
      {
        adopt: (response, operationId) => {
          adopted.push(operationId)
          const data = response.data as { runId?: unknown } | undefined
          return typeof data?.runId === 'string' ? data.runId : null
        },
        release: runId => { released.push(runId) },
      },
    )
    const { owner } = createOwner({ updateCore: submitted('run-core') }, runPort)

    const promise = owner.updateCore()
    expect(owner.getState().running).toBe('core')
    pendingTerminal.resolve(terminal())
    const outcome = await promise

    expect(adopted).toEqual(['update_core'])
    expect(outcome).toMatchObject({
      status: 'succeeded',
      operation: 'core',
      message: 'MaaCore 和资源已更新',
      resourcesChanged: true,
      versionChanged: true,
    })
    expect(released).toEqual(['run-core'])
    expect(owner.getState()).toMatchObject({ running: null, canceling: false })
  })

  it('maps a failed run to the existing failure feedback and resource retry policy', async () => {
    const runPort = createRunPort(() => Promise.resolve(terminal({
      state: 'failed',
      message: '资源同步失败: 下载超时',
      errorDetails: { failedStep: 'resources' },
    })))
    const { owner } = createOwner({ updateResources: submitted('run-resources') }, runPort)

    const outcome = await owner.updateResources()

    expect(outcome).toMatchObject({
      status: 'failed',
      operation: 'resources',
      message: '资源同步失败: 下载超时',
      messageType: 'error',
      resourcesChanged: false,
      versionChanged: false,
    })
    expect(outcome.feedback).toEqual({
      type: 'error',
      message: '资源同步失败: 下载超时',
      resourceRetry: true,
    })
  })

  it('reports a stopped run as a canceled command without publishing invalidation', async () => {
    const runPort = createRunPort(() => Promise.resolve(terminal({ state: 'stopped' })))
    const { owner } = createOwner({ updateCore: submitted('run-stopped') }, runPort)

    const outcome = await owner.updateCore()

    expect(outcome).toMatchObject({
      status: 'canceled',
      message: '更新已取消',
      resourcesChanged: false,
      versionChanged: true,
    })
    expect(outcome.feedback).toBeNull()
  })

  it('treats an interrupted run as unknown rather than success', async () => {
    const runPort = createRunPort(() => Promise.resolve(terminal({ state: 'interrupted' })))
    const { owner } = createOwner({ updateResources: submitted('run-interrupted') }, runPort)

    const outcome = await owner.updateResources()

    expect(outcome.status).toBe('failed')
    expect(outcome.message).toContain('无法确认更新结果')
    expect(outcome.feedback).toEqual({
      type: 'error',
      message: outcome.message,
      resourceRetry: true,
    })
  })

  it('stops the tracked run and keeps the command pending until the terminal state', async () => {
    const pendingTerminal = deferred<UpdateRunTerminal>()
    const waitStarted = deferred<void>()
    const cancel = vi.fn(() => Promise.resolve({ success: true, data: {} } as ApiResponse))
    const runPort = createRunPort(() => {
      waitStarted.resolve()
      return pendingTerminal.promise
    }, { cancel })
    const { owner } = createOwner({ updateCli: submitted('run-cli') }, runPort)

    const promise = owner.updateCli()
    await waitStarted.promise
    const canceled = await owner.cancel()

    expect(canceled).toEqual({ ok: true, message: null })
    expect(cancel).toHaveBeenCalledWith('run-cli')
    expect(owner.getState().canceling).toBe(true)

    pendingTerminal.resolve(terminal({ state: 'stopped' }))
    const outcome = await promise

    expect(outcome.status).toBe('canceled')
    expect(owner.getState()).toMatchObject({ running: null, canceling: false })
  })

  it('restores the cancelable state when the stop request is rejected', async () => {
    const pendingTerminal = deferred<UpdateRunTerminal>()
    const waitStarted = deferred<void>()
    const cancel = vi.fn(() => Promise.resolve({
      success: false,
      errorInfo: { code: 'AGENT_RUN_NOT_CURRENT', message: '目标 run 不是当前执行' },
    } as ApiResponse))
    const runPort = createRunPort(() => {
      waitStarted.resolve()
      return pendingTerminal.promise
    }, { cancel })
    const { owner } = createOwner({ updateCore: submitted('run-busy') }, runPort)

    const promise = owner.updateCore()
    await waitStarted.promise
    const canceled = await owner.cancel()

    expect(canceled.ok).toBe(false)
    expect(canceled.message).toContain('目标 run 不是当前执行')
    expect(owner.getState().canceling).toBe(false)

    pendingTerminal.resolve(terminal())
    await promise
  })

  it('refuses to stop a legacy command without a run identity', async () => {
    const pending = deferred<ApiResponse>()
    const { owner } = createOwner({ updateCore: pending.promise })
    const running = owner.updateCore()

    const canceled = await owner.cancel()

    expect(canceled.ok).toBe(false)
    expect(canceled.message).toContain('尚未获得执行身份')
    pending.resolve({ success: true })
    await running
  })
})
