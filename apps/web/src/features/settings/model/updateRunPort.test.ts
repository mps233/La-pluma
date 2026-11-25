// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '@/shared/api'
import { ExecutionController } from '@/features/task-execution'
import type { AgentRun, RunSnapshot } from '@/features/task-execution'
import { SettingsUpdateOwner, type UpdateCommandOutcome } from './updateCommands'
import {
  createSettingsUpdateRunPort,
  type UpdateRunTerminal,
} from './updateRunPort'

const UNKNOWN_TERMINAL: UpdateRunTerminal = {
  state: 'unknown',
  message: null,
  errorDetails: {},
  result: null,
}

const createRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
  runId: 'run-1',
  operationId: 'update_core',
  state: 'running',
  links: { self: '/api/agent/runs/run-1' },
  ...overrides,
})

const emptySnapshot = (): RunSnapshot => ({
  run: null,
  activeRuns: [],
  lastRun: null,
  occupancy: {
    state: 'idle',
    runId: null,
    runState: null,
    sources: [],
    lease: { state: 'free' },
    task: { isRunning: false, taskName: null, taskType: null, stopRequested: false },
    schedule: {},
  },
})

const createHarness = (runOverrides: Partial<AgentRun> = {}) => {
  const run = createRun(runOverrides)
  const api = {
    fetchSnapshot: vi.fn(async () => ({
      success: true,
      data: emptySnapshot(),
    }) as ApiResponse<RunSnapshot>),
    fetchRun: vi.fn(async () => ({
      success: false,
      errorInfo: { code: 'AGENT_RUN_NOT_FOUND', message: 'run 已失效' },
    }) as ApiResponse<AgentRun>),
    stopRun: vi.fn(async () => ({ success: true }) as ApiResponse),
  }
  const controller = new ExecutionController({ api, storage: null })
  return { controller, api, run }
}

const submission = (run: AgentRun): ApiResponse => ({
  success: true,
  message: '更新已接受',
  data: { runId: run.runId, run },
})

const settledWithin = async <T,>(promise: Promise<T>, ms = 100): Promise<T | 'pending'> => {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<'pending'>(resolve => {
    timer = setTimeout(() => resolve('pending'), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('settings update run port', () => {
  it('reports the terminal state of the tracked run', async () => {
    const { controller, run } = createHarness({
      state: 'failed',
      error: { code: 'AGENT_MAA_RESOURCE_UPDATE_FAILED', message: '资源同步失败', details: { failedStep: 'resources' } },
    })
    const port = createSettingsUpdateRunPort(controller)
    const runId = port.adopt(submission(run), 'update_core')
    if (!runId) throw new Error('expected an adopted run id')

    await expect(port.wait(runId)).resolves.toEqual({
      state: 'failed',
      message: '资源同步失败',
      errorDetails: { failedStep: 'resources' },
      result: null,
    })
  })

  it('exposes the terminal result so callers can read success payload facts', async () => {
    const { controller, run } = createHarness({
      state: 'succeeded',
      result: { channelPersisted: false },
    })
    const port = createSettingsUpdateRunPort(controller)
    const runId = port.adopt(submission(run), 'update_core')
    if (!runId) throw new Error('expected an adopted run id')

    await expect(port.wait(runId)).resolves.toEqual({
      state: 'succeeded',
      message: null,
      errorDetails: {},
      result: { channelPersisted: false },
    })
  })

  it('settles as unknown when the controller can no longer confirm the run identity', async () => {
    const { controller, run } = createHarness()
    const port = createSettingsUpdateRunPort(controller)
    const runId = port.adopt(submission(run), 'update_core')
    if (!runId) throw new Error('expected an adopted run id')

    const pending = port.wait(runId)
    await controller.refresh('reconnect')

    expect(controller.getState()).toMatchObject({
      identity: 'unknown',
      trackedRunId: runId,
      trackedRun: { state: 'running' },
    })
    expect(await settledWithin(pending)).toEqual(UNKNOWN_TERMINAL)
  })

  it('keeps waiting while the server run is still active instead of settling on a local ceiling', async () => {
    vi.useFakeTimers()
    const { controller, run, api } = createHarness()
    const port = createSettingsUpdateRunPort(controller)
    const runId = port.adopt(submission(run), 'update_core')
    if (!runId) throw new Error('expected an adopted run id')

    const pending = port.wait(runId)
    let settled = false
    void pending.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(settled).toBe(false)

    api.fetchRun.mockResolvedValue({
      success: true,
      data: { ...run, state: 'succeeded' },
    } as ApiResponse<AgentRun>)
    await controller.refresh('reconnect')

    await expect(pending).resolves.toEqual({
      state: 'succeeded',
      message: null,
      errorDetails: {},
      result: null,
    })
  })

  it('keeps the running slot and stop entry for a long update and settles on the server terminal state', async () => {
    vi.useFakeTimers()
    const { controller, run, api } = createHarness()
    const port = createSettingsUpdateRunPort(controller)
    const owner = new SettingsUpdateOwner({
      updateCore: () => Promise.resolve(submission(run)),
      runPort: port,
    })

    const pending = owner.updateCore()
    await vi.advanceTimersByTimeAsync(0)
    expect(owner.getState().running).toBe('core')
    expect(controller.getState().trackedRunId).toBe(run.runId)

    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(owner.getState().running).toBe('core')

    await expect(owner.cancel()).resolves.toEqual({ ok: true, message: null })
    expect(api.stopRun).toHaveBeenCalledWith(run.runId)

    api.fetchRun.mockResolvedValue({
      success: true,
      data: { ...run, state: 'stopped' },
    } as ApiResponse<AgentRun>)
    await controller.refresh('reconnect')

    const outcome = await pending
    expect(outcome).toMatchObject({ status: 'canceled', operation: 'core' })
    expect(owner.getState()).toMatchObject({ running: null, canceling: false })
  })

  it('recovers a tracked settings update after a refresh and keeps the stop entry', async () => {
    const { controller, run, api } = createHarness()
    const resourcesRun: AgentRun = { ...run, operationId: 'update_resources' }
    const port = createSettingsUpdateRunPort(controller)
    controller.adoptSubmission(submission(resourcesRun), 'update_resources', { scope: 'settings' })
    expect(port.tracked()).toEqual({ runId: resourcesRun.runId, operationId: 'update_resources' })

    const owner = new SettingsUpdateOwner({ runPort: port })
    const outcomes: UpdateCommandOutcome[] = []
    const stopObserving = owner.observeTrackedRun(outcome => outcomes.push(outcome))

    expect(owner.getState().running).toBe('resources')
    await expect(owner.cancel()).resolves.toEqual({ ok: true, message: null })

    api.fetchRun.mockResolvedValue({
      success: true,
      data: { ...resourcesRun, state: 'succeeded' },
    } as ApiResponse<AgentRun>)
    await controller.refresh('reconnect')

    await vi.waitFor(() => expect(outcomes).toHaveLength(1))
    expect(outcomes[0]).toMatchObject({
      status: 'succeeded',
      operation: 'resources',
      resourcesChanged: true,
      versionChanged: true,
    })
    expect(owner.getState()).toMatchObject({ running: null, canceling: false })
    stopObserving()
  })

  it('keeps the channel persistence warning when recovering a tracked channel switch', async () => {
    const { controller, run, api } = createHarness()
    const port = createSettingsUpdateRunPort(controller)
    controller.adoptSubmission(submission(run), 'update_core', { scope: 'settings' })

    const owner = new SettingsUpdateOwner({ runPort: port })
    const outcomes: UpdateCommandOutcome[] = []
    const stopObserving = owner.observeTrackedRun(outcome => outcomes.push(outcome))

    api.fetchRun.mockResolvedValue({
      success: true,
      data: { ...run, state: 'succeeded', result: { channelPersisted: false } },
    } as ApiResponse<AgentRun>)
    await controller.refresh('reconnect')

    await vi.waitFor(() => expect(outcomes).toHaveLength(1))
    expect(outcomes[0]).toMatchObject({
      status: 'succeeded',
      message: 'MaaCore 和资源已更新，但渠道配置未能持久化',
      resourcesChanged: true,
      versionChanged: true,
    })
    stopObserving()
  })

  it('does not recover runs owned by other scopes or already terminal runs', async () => {
    const { controller, run } = createHarness()
    const port = createSettingsUpdateRunPort(controller)
    controller.adoptSubmission(submission(run), 'update_core', { scope: 'automation' })
    expect(port.tracked()).toBeNull()

    controller.observeRun(null)
    controller.adoptSubmission(submission({ ...run, state: 'succeeded' }), 'update_core', { scope: 'settings' })
    expect(port.tracked()).toBeNull()
  })

  it('only releases or stops the run it adopted', async () => {
    const { controller, run, api } = createHarness()
    const port = createSettingsUpdateRunPort(controller)
    const runId = port.adopt(submission(run), 'update_core')
    if (!runId) throw new Error('expected an adopted run id')

    await expect(port.cancel('other-run')).resolves.toBeNull()
    port.release('other-run')
    expect(controller.getState().trackedRunId).toBe(runId)
    expect(api.stopRun).not.toHaveBeenCalled()

    await expect(port.cancel(runId)).resolves.toMatchObject({ success: true })
    expect(api.stopRun).toHaveBeenCalledWith(runId)

    port.release(runId)
    expect(controller.getState().trackedRunId).toBeNull()
  })

  it('releases the pending update command instead of leaving it running forever', async () => {
    const { controller, run } = createHarness()
    const port = createSettingsUpdateRunPort(controller)
    const owner = new SettingsUpdateOwner({
      updateCore: () => Promise.resolve(submission(run)),
      runPort: port,
    })

    const pending = owner.updateCore()
    await vi.waitFor(() => expect(controller.getState().trackedRunId).toBe(run.runId))
    expect(owner.getState().running).toBe('core')

    await controller.refresh('reconnect')

    const outcome = await settledWithin(pending)
    expect(outcome).not.toBe('pending')
    if (outcome === 'pending') throw new Error('update command never settled')
    expect(outcome).toMatchObject({
      status: 'failed',
      operation: 'core',
      messageType: 'error',
    })
    expect(outcome.message).toContain('无法确认更新结果')
    expect(owner.getState()).toMatchObject({ running: null, canceling: false })
    expect(controller.getState().trackedRunId).toBeNull()
  })
})
