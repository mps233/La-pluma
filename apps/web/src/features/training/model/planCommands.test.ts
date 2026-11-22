// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceInvalidation } from '@/features/resource-invalidation'
import type { ApiResponse } from '@/shared/api'
import {
  TRAINING_FLOW_SYNCED_SCOPES,
  TRAINING_PLAN_APPLIED_SCOPES,
  TRAINING_PLAN_APPLIED_SOURCE,
  TRAINING_PLAN_BASIS_CHANGED_MESSAGE,
  TRAINING_PLAN_BLOCKED_CONFIG_MESSAGE,
  TRAINING_PLAN_PARTIAL_REFRESH_MESSAGE,
  TRAINING_PLAN_PARTIAL_SCHEDULE_MESSAGE,
  TRAINING_PLAN_STALE_CLIENT_TYPE_MESSAGE,
  TRAINING_PLAN_STALE_GAME_DAY_MESSAGE,
  TRAINING_PLAN_STALE_MESSAGE,
  TRAINING_PLAN_STALE_STAGE_CLOSED_MESSAGE,
  TrainingPlanOwner,
  type TrainingPlanQueueContext,
} from './planCommands'
import type { TrainingSettingsOwnerState } from './settingsCommands'
import type {
  TrainingFlowSync,
  TrainingPlan,
  TrainingQueueItem,
  TrainingQueueSnapshot,
  TrainingSettings,
} from '../types'

const baseSettings: TrainingSettings = {
  useMedicine: 0,
  useStone: 0,
  autoSwitch: true,
  notifyOnComplete: true,
}

const settingsState = (revision = 0): TrainingSettingsOwnerState => ({
  settings: { ...baseSettings },
  persisted: { ...baseSettings },
  revision,
  syncState: 'idle',
  error: null,
})

const queueItem = (operatorId: string, name: string): TrainingQueueItem => ({
  operatorId,
  operator: { name, rarity: 6, profession: 'SNIPER' },
  currentElite: 1,
  targetElite: 2,
  materials: [],
  progress: 25,
})

const flowSync = (status: TrainingFlowSync['status'] = 'synced'): TrainingFlowSync => ({
  status,
  flowName: '自动任务',
  taskName: 'Fight',
  ...(status === 'synced' ? { syncedRevision: 'queue-1' } : {}),
})

const snapshot = (
  revision = 'queue-1',
  queue: TrainingQueueItem[] = [queueItem('char_current', '阿米娅')],
  sync: TrainingFlowSync = flowSync('not_applied'),
  context: { gameDate?: string; clientType?: string } = {},
): TrainingQueueSnapshot => ({
  queue,
  revision,
  settings: { ...baseSettings },
  flowSync: sync,
  ...context,
})

const plan = (
  revision = 'queue-1',
  summary?: TrainingPlan['summary'],
): TrainingPlan => ({
  mode: 'current',
  queueRevision: revision,
  focusOperator: { id: 'char_current', name: '阿米娅', rarity: 6 },
  stages: [
    { stage: '1-7', totalTimes: 5, sanityPerRun: 6, isOpen: true },
    { stage: 'CE-6', totalTimes: 2, isOpen: false },
  ],
  openStages: [{ stage: '1-7', totalTimes: 5, isOpen: true }],
  totalSanity: 30,
  ...(summary ? { summary } : {}),
})

const staleResponse = (
  details: { reason?: string; closedStages?: string[] },
  code: string | null = 'AGENT_TRAINING_PLAN_STALE',
): ApiResponse => ({
  success: false,
  message: '计划已过期',
  errorInfo: {
    ...(code ? { code } : {}),
    message: '计划已过期',
    details,
  },
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  started: Promise<void>
  markStarted: () => void
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let markStarted!: () => void
  const started = new Promise<void>(resolveStarted => {
    markStarted = resolveStarted
  })
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve, started, markStarted }
}

interface Harness {
  owner: TrainingPlanOwner
  context: TrainingPlanQueueContext
  generatePlan: ReturnType<typeof vi.fn>
  applyPlan: ReturnType<typeof vi.fn>
  retrySync: ReturnType<typeof vi.fn>
  published: ResourceInvalidation[]
  refetch: ReturnType<typeof vi.fn>
  adoptSettings: ReturnType<typeof vi.fn>
  setSnapshot: (next: TrainingQueueSnapshot | undefined) => void
  setSettingsRevision: (revision: number) => void
  enqueueRefetch: (...results: Array<TrainingQueueSnapshot | null>) => void
  setRefreshFailed: (failed: boolean) => void
  setQueueMutationPending: (pending: boolean) => void
  setSettleAutomationConfig: (result: { pendingKeys: readonly string[] } | Promise<{ pendingKeys: readonly string[] }>) => void
}

function createHarness(): Harness {
  let currentSnapshot: TrainingQueueSnapshot | undefined = snapshot()
  let settings = settingsState()
  let refreshFailed = false
  let queueMutationPending = false
  let settleResult: { pendingKeys: readonly string[] } | Promise<{ pendingKeys: readonly string[] }> =
    { pendingKeys: [] }
  const settingsListeners = new Set<() => void>()
  const refetchResults: Array<TrainingQueueSnapshot | null> = []
  const published: ResourceInvalidation[] = []

  const generatePlan = vi.fn(async (): Promise<ApiResponse> => ({ success: true, data: plan() }))
  const applyPlan = vi.fn(async (): Promise<ApiResponse> => ({
    success: true,
    data: {
      stageCount: 1,
      flowName: '自动任务',
      taskName: 'Fight',
      flowSync: flowSync('synced'),
    },
  }))
  const retrySync = vi.fn(async (): Promise<ApiResponse> => ({
    success: true,
    data: { flowSync: flowSync('synced') },
  }))

  const adoptSettings = vi.fn((next?: TrainingSettings | null) => {
    if (!next) return false
    const same = (Object.keys(baseSettings) as Array<keyof TrainingSettings>)
      .every(key => next[key] === settings.settings[key])
    if (same) return false
    settings = {
      ...settings,
      settings: { ...next },
      persisted: { ...next },
      revision: settings.revision + 1,
    }
    for (const listener of [...settingsListeners]) listener()
    return true
  })

  const refetch = vi.fn(async (): Promise<TrainingQueueSnapshot | null> => {
    if (refetchResults.length > 0) {
      const next = refetchResults.shift() ?? null
      currentSnapshot = next ?? undefined
      return next
    }
    return currentSnapshot ?? null
  })

  const owner = new TrainingPlanOwner({
    generatePlan,
    applyPlan,
    retrySync,
    publish: invalidation => {
      published.push(invalidation)
    },
    settleAutomationConfig: async () => settleResult,
    readSettings: () => settings,
    subscribeSettings: listener => {
      settingsListeners.add(listener)
      return () => settingsListeners.delete(listener)
    },
  })

  const context: TrainingPlanQueueContext = {
    getSnapshot: () => currentSnapshot,
    refetch,
    isRefreshFailed: () => refreshFailed,
    isQueueMutationPending: () => queueMutationPending,
    adoptSettings,
  }

  return {
    owner,
    context,
    generatePlan,
    applyPlan,
    retrySync,
    published,
    refetch,
    adoptSettings,
    setSnapshot: next => {
      currentSnapshot = next
    },
    setSettingsRevision: revision => {
      settings = { ...settings, revision }
      for (const listener of [...settingsListeners]) listener()
    },
    enqueueRefetch: (...results) => {
      refetchResults.push(...results)
    },
    setRefreshFailed: failed => {
      refreshFailed = failed
    },
    setQueueMutationPending: pending => {
      queueMutationPending = pending
    },
    setSettleAutomationConfig: result => {
      settleResult = result
    },
  }
}

let harness: Harness

beforeEach(() => {
  harness = createHarness()
})

describe('plan generation', () => {
  it('refreshes the authoritative queue before freezing the basis and accepts a matching plan', async () => {
    await expect(harness.owner.generate('current', harness.context)).resolves.toMatchObject({
      status: 'generated',
      basis: { queueRevision: 'queue-1', settingsRevision: 0 },
    })

    expect(harness.refetch).toHaveBeenCalledOnce()
    expect(harness.generatePlan).toHaveBeenCalledWith({ mode: 'current' })
    expect(harness.owner.getState().plan).toEqual(plan())
    expect(harness.owner.getState().basis).toEqual({
      queueRevision: 'queue-1',
      settingsRevision: 0,
      gameDate: null,
      clientType: null,
    })
  })

  it('freezes the game day and client type from the generated plan summary', async () => {
    const context = { gameDate: '2026-11-22', clientType: 'Official' }
    harness.setSnapshot(snapshot('queue-1', undefined, flowSync('not_applied'), context))
    harness.generatePlan.mockResolvedValueOnce({
      success: true,
      data: plan('queue-1', { gameDate: '2026-11-22', clientType: 'Official' }),
    })

    await expect(harness.owner.generate('current', harness.context)).resolves.toMatchObject({
      status: 'generated',
      basis: {
        queueRevision: 'queue-1',
        settingsRevision: 0,
        gameDate: '2026-11-22',
        clientType: 'Official',
      },
    })
    expect(harness.owner.getState().basis).toEqual({
      queueRevision: 'queue-1',
      settingsRevision: 0,
      gameDate: '2026-11-22',
      clientType: 'Official',
    })
  })

  it('discards a generated plan whose summary belongs to another game day', async () => {
    harness.setSnapshot(snapshot(
      'queue-1',
      undefined,
      flowSync('not_applied'),
      { gameDate: '2026-11-23', clientType: 'Official' },
    ))
    harness.generatePlan.mockResolvedValueOnce({
      success: true,
      data: plan('queue-1', { gameDate: '2026-11-22', clientType: 'Official' }),
    })

    await expect(harness.owner.generate('current', harness.context)).resolves.toEqual({
      status: 'failed',
      message: TRAINING_PLAN_BASIS_CHANGED_MESSAGE,
    })
    expect(harness.owner.getState().plan).toBeNull()
  })

  it('refuses to generate when the forced queue refresh fails', async () => {
    harness.enqueueRefetch(null)

    await expect(harness.owner.generate('current', harness.context)).resolves.toEqual({
      status: 'failed',
      message: '队列刷新失败，请重新加载后预览',
    })
    expect(harness.generatePlan).not.toHaveBeenCalled()
    expect(harness.owner.getState().plan).toBeNull()
  })

  it('captures the basis after an authoritative reload adopts external settings', async () => {
    harness.enqueueRefetch({
      ...snapshot(),
      settings: { ...baseSettings, autoSwitch: false },
    })

    const result = await harness.owner.generate('current', harness.context)

    // 重读先采用外部设置并推进 revision；basis 必须使用采用后的版本，
    // 否则 React Effect 的后续通知会把刚生成的计划误判为过期。
    expect(result).toMatchObject({
      status: 'generated',
      basis: { queueRevision: 'queue-1', settingsRevision: 1 },
    })
    expect(harness.owner.getState().plan).not.toBeNull()
  })

  it('discards a plan response when the settings revision changes while it is in flight', async () => {
    const request = deferred<ApiResponse>()
    harness.generatePlan.mockImplementationOnce(() => {
      request.markStarted()
      return request.promise
    })

    const generating = harness.owner.generate('current', harness.context)
    await request.started

    harness.setSettingsRevision(1)
    request.resolve({ success: true, data: plan() })

    await expect(generating).resolves.toEqual({
      status: 'stale',
      message: TRAINING_PLAN_BASIS_CHANGED_MESSAGE,
    })
    expect(harness.owner.getState().plan).toBeNull()
    expect(harness.owner.getState().error).toBe(TRAINING_PLAN_BASIS_CHANGED_MESSAGE)
  })

  it('rejects a response whose queue revision differs and refreshes the queue again', async () => {
    harness.enqueueRefetch(snapshot('queue-1'), snapshot('queue-2'))
    harness.generatePlan.mockResolvedValueOnce({ success: true, data: plan('queue-2') })

    await expect(harness.owner.generate('current', harness.context)).resolves.toEqual({
      status: 'failed',
      message: '养成队列已变化，请重新预览计划',
    })
    expect(harness.refetch).toHaveBeenCalledTimes(2)
    expect(harness.owner.getState().plan).toBeNull()
  })

  it('checks the live queue revision when the page has not observed the change yet', async () => {
    const request = deferred<ApiResponse>()
    harness.generatePlan.mockImplementationOnce(() => {
      request.markStarted()
      return request.promise
    })

    const generating = harness.owner.generate('current', harness.context)
    await request.started

    harness.setSnapshot(snapshot('queue-2'))
    request.resolve({ success: true, data: plan('queue-1') })

    await expect(generating).resolves.toEqual({
      status: 'failed',
      message: TRAINING_PLAN_BASIS_CHANGED_MESSAGE,
    })
    expect(harness.owner.getState().plan).toBeNull()
  })

  it('serializes duplicate previews into a single request', async () => {
    const request = deferred<ApiResponse>()
    harness.generatePlan.mockImplementationOnce(() => {
      request.markStarted()
      return request.promise
    })

    const first = harness.owner.generate('current', harness.context)
    await expect(harness.owner.generate('current', harness.context)).resolves.toEqual({ status: 'ignored' })
    await request.started
    request.resolve({ success: true, data: plan() })
    await expect(first).resolves.toMatchObject({ status: 'generated' })

    expect(harness.generatePlan).toHaveBeenCalledOnce()
  })
})

describe('plan application', () => {
  const generatePreview = async () => {
    await harness.owner.generate('current', harness.context)
    expect(harness.owner.getState().plan).not.toBeNull()
  }

  it('applies only the open stages with the latest settings and publishes the cross-domain scopes', async () => {
    await generatePreview()

    await expect(harness.owner.apply(harness.context)).resolves.toMatchObject({
      status: 'applied',
      flowName: '自动任务',
      stageCount: 1,
    })

    expect(harness.applyPlan).toHaveBeenCalledWith({
      plan: { ...plan(), stages: plan().openStages },
      settings: baseSettings,
    })
    expect(harness.published).toEqual([{
      resources: [...TRAINING_PLAN_APPLIED_SCOPES],
      cause: 'plan-applied',
      detail: {
        stageCount: 1,
        flowName: '自动任务',
        taskName: 'Fight',
        source: TRAINING_PLAN_APPLIED_SOURCE,
      },
    }])
    expect(harness.owner.getState().flowSync).toEqual(flowSync('synced'))
    expect(harness.owner.getState().plan).not.toBeNull()
  })

  it('waits for the automation config channel and rejects the apply while a draft remains pending', async () => {
    await generatePreview()
    harness.setSettleAutomationConfig({ pendingKeys: ['automation-tasks'] })

    await expect(harness.owner.apply(harness.context)).resolves.toEqual({
      status: 'blocked',
      message: TRAINING_PLAN_BLOCKED_CONFIG_MESSAGE,
    })
    expect(harness.applyPlan).not.toHaveBeenCalled()
    expect(harness.owner.getState().plan).not.toBeNull()
  })

  it('revalidates the basis after the automation save barrier', async () => {
    await generatePreview()
    const settle = deferred<{ pendingKeys: readonly string[] }>()
    harness.setSettleAutomationConfig(settle.promise)

    const applying = harness.owner.apply(harness.context)
    await Promise.resolve()
    harness.setSettingsRevision(1)
    settle.resolve({ pendingKeys: [] })

    await expect(applying).resolves.toEqual({
      status: 'failed',
      message: TRAINING_PLAN_BASIS_CHANGED_MESSAGE,
    })
    expect(harness.applyPlan).not.toHaveBeenCalled()
    expect(harness.owner.getState().plan).toBeNull()
    expect(harness.owner.getState().error).toBe(TRAINING_PLAN_BASIS_CHANGED_MESSAGE)
  })

  it('does not apply a plan whose queue revision is no longer current', async () => {
    await generatePreview()
    harness.setSnapshot(snapshot('queue-2'))

    await expect(harness.owner.apply(harness.context)).resolves.toEqual({
      status: 'failed',
      message: TRAINING_PLAN_BASIS_CHANGED_MESSAGE,
    })
    expect(harness.applyPlan).not.toHaveBeenCalled()
    expect(harness.owner.getState().plan).not.toBeNull()
  })

  it('does not apply a plan when only the queue game context changed', async () => {
    harness.setSnapshot(snapshot(
      'queue-1',
      undefined,
      flowSync('not_applied'),
      { gameDate: '2026-11-22', clientType: 'Official' },
    ))
    harness.generatePlan.mockResolvedValueOnce({
      success: true,
      data: plan('queue-1', { gameDate: '2026-11-22', clientType: 'Official' }),
    })
    await generatePreview()

    harness.setSnapshot(snapshot(
      'queue-1',
      undefined,
      flowSync('not_applied'),
      { gameDate: '2026-11-23', clientType: 'Official' },
    ))

    await expect(harness.owner.apply(harness.context)).resolves.toEqual({
      status: 'failed',
      message: TRAINING_PLAN_BASIS_CHANGED_MESSAGE,
    })
    expect(harness.applyPlan).not.toHaveBeenCalled()
    expect(harness.owner.getState().plan).not.toBeNull()
  })

  it('serializes duplicate applies into a single request', async () => {
    await generatePreview()
    const request = deferred<ApiResponse>()
    harness.applyPlan.mockImplementationOnce(() => {
      request.markStarted()
      return request.promise
    })

    const first = harness.owner.apply(harness.context)
    await expect(harness.owner.apply(harness.context)).resolves.toEqual({ status: 'ignored' })
    await request.started
    request.resolve({ success: true, data: { flowSync: flowSync('synced') } })
    await expect(first).resolves.toMatchObject({ status: 'applied' })

    expect(harness.applyPlan).toHaveBeenCalledOnce()
  })

  it('clears the preview and refreshes the queue after a failed apply', async () => {
    await generatePreview()
    harness.applyPlan.mockResolvedValueOnce({ success: false, message: '养成队列已变化，请重新生成计划后应用' })

    await expect(harness.owner.apply(harness.context)).resolves.toEqual({
      status: 'failed',
      message: '养成队列已变化，请重新生成计划后应用',
    })
    expect(harness.refetch).toHaveBeenCalledTimes(2)
    expect(harness.owner.getState().plan).toBeNull()
    expect(harness.owner.getState().error).toBe('养成队列已变化，请重新生成计划后应用')
  })

  it('clears the preview and reports the closed stages when the server rejects a stale plan', async () => {
    await generatePreview()
    harness.applyPlan.mockResolvedValueOnce(staleResponse({
      reason: 'stage_closed',
      closedStages: ['CE-6'],
    }))

    await expect(harness.owner.apply(harness.context)).resolves.toEqual({
      status: 'failed',
      message: '计划中的资源关卡已关闭（CE-6），请重新预览计划后再应用',
    })
    expect(harness.owner.getState()).toMatchObject({
      plan: null,
      basis: null,
      error: '计划中的资源关卡已关闭（CE-6），请重新预览计划后再应用',
    })
  })

  it('uses the generic closed-stage message when the server omits stage codes', async () => {
    await generatePreview()
    harness.applyPlan.mockResolvedValueOnce(staleResponse({ reason: 'stage_closed' }))

    await expect(harness.owner.apply(harness.context)).resolves.toEqual({
      status: 'failed',
      message: TRAINING_PLAN_STALE_STAGE_CLOSED_MESSAGE,
    })
  })

  it.each([
    ['game_day', TRAINING_PLAN_STALE_GAME_DAY_MESSAGE],
    ['client_type', TRAINING_PLAN_STALE_CLIENT_TYPE_MESSAGE],
  ])('reports the %s stale reason from the server rejection', async (reason, message) => {
    await generatePreview()
    harness.applyPlan.mockResolvedValueOnce(staleResponse({ reason }))

    await expect(harness.owner.apply(harness.context)).resolves.toEqual({
      status: 'failed',
      message,
    })
    expect(harness.owner.getState().plan).toBeNull()
    expect(harness.owner.getState().basis).toBeNull()
    expect(harness.owner.getState().error).toBe(message)
  })

  it('recognizes a stale rejection from its reason even without the stable code', async () => {
    await generatePreview()
    harness.applyPlan.mockResolvedValueOnce(staleResponse({ reason: 'game_day' }, null))

    await expect(harness.owner.apply(harness.context)).resolves.toEqual({
      status: 'failed',
      message: TRAINING_PLAN_STALE_GAME_DAY_MESSAGE,
    })
  })

  it('reports a generic stale message for an unknown stale reason', async () => {
    await generatePreview()
    harness.applyPlan.mockResolvedValueOnce(staleResponse({ reason: 'unknown' }))

    await expect(harness.owner.apply(harness.context)).resolves.toEqual({
      status: 'failed',
      message: TRAINING_PLAN_STALE_MESSAGE,
    })
  })

  it('keeps an earlier schedule warning when a retry is rejected as stale', async () => {
    await generatePreview()
    harness.applyPlan.mockResolvedValueOnce({
      success: true,
      data: {
        stageCount: 1,
        flowName: '自动任务',
        flowSync: flowSync('synced'),
        scheduleSync: { attempted: true, success: false, message: '定时任务设置失败' },
      },
    })
    await harness.owner.apply(harness.context)
    expect(harness.owner.getState().warning).toContain(TRAINING_PLAN_PARTIAL_SCHEDULE_MESSAGE)

    harness.applyPlan.mockResolvedValueOnce(staleResponse({ reason: 'game_day' }))
    await expect(harness.owner.apply(harness.context)).resolves.toEqual({
      status: 'failed',
      message: TRAINING_PLAN_STALE_GAME_DAY_MESSAGE,
    })

    expect(harness.owner.getState()).toMatchObject({
      plan: null,
      basis: null,
      error: TRAINING_PLAN_STALE_GAME_DAY_MESSAGE,
    })
    expect(harness.owner.getState().warning).toContain(TRAINING_PLAN_PARTIAL_SCHEDULE_MESSAGE)
  })

  it('keeps a schedule partial warning until the plan is applied again', async () => {
    await generatePreview()
    harness.applyPlan.mockResolvedValueOnce({
      success: true,
      data: {
        stageCount: 1,
        flowName: '自动任务',
        flowSync: flowSync('synced'),
        scheduleSync: { attempted: true, success: false, message: '定时任务设置失败' },
      },
    })

    await harness.owner.apply(harness.context)
    expect(harness.owner.getState().warning).toContain(TRAINING_PLAN_PARTIAL_SCHEDULE_MESSAGE)

    harness.enqueueRefetch(snapshot('queue-1'))
    await harness.owner.reload(harness.context)
    // 一次成功的队列读取不能清除仍需重新应用才能修复的定时失败。
    expect(harness.owner.getState().warning).toContain(TRAINING_PLAN_PARTIAL_SCHEDULE_MESSAGE)
  })

  it('reports a partial apply when the registered schedule could not be refreshed', async () => {
    await generatePreview()
    harness.applyPlan.mockResolvedValueOnce({
      success: true,
      data: {
        stageCount: 1,
        flowName: '自动任务',
        taskName: 'Fight',
        flowSync: flowSync('synced'),
        scheduleSync: { attempted: true, success: false, message: '定时任务设置失败' },
      },
    })

    const outcome = await harness.owner.apply(harness.context)

    expect(outcome).toMatchObject({
      status: 'partial',
      flowName: '自动任务',
      stageCount: 1,
    })
    expect((outcome as { message: string }).message).toContain(TRAINING_PLAN_PARTIAL_SCHEDULE_MESSAGE)
    expect((outcome as { message: string }).message).toContain('定时任务设置失败')
    expect(harness.published).toHaveLength(1)
    expect(harness.owner.getState().plan).not.toBeNull()
    expect(harness.owner.getState().warning).toContain(TRAINING_PLAN_PARTIAL_SCHEDULE_MESSAGE)
  })

  it('keeps the applied plan and exposes a retryable warning when the follow-up queue read fails', async () => {
    await generatePreview()
    harness.enqueueRefetch(null)

    await expect(harness.owner.apply(harness.context)).resolves.toMatchObject({
      status: 'partial',
      message: TRAINING_PLAN_PARTIAL_REFRESH_MESSAGE,
    })
    expect(harness.published).toHaveLength(1)
    expect(harness.owner.getState().warning).toBe(TRAINING_PLAN_PARTIAL_REFRESH_MESSAGE)
    expect(harness.owner.getState().plan).not.toBeNull()

    harness.enqueueRefetch(snapshot('queue-1'))
    await expect(harness.owner.reload(harness.context)).resolves.not.toBeNull()
    expect(harness.owner.getState().warning).toBeNull()
  })
})

describe('flow sync retry', () => {
  it('retries the flow sync, republishes automation changes, and updates the banner', async () => {
    await expect(harness.owner.retrySync(harness.context)).resolves.toMatchObject({
      status: 'synced',
      flowSync: flowSync('synced'),
    })

    expect(harness.retrySync).toHaveBeenCalledOnce()
    expect(harness.published).toEqual([expect.objectContaining({
      resources: [...TRAINING_FLOW_SYNCED_SCOPES],
      cause: 'plan-applied',
    })])
    expect(harness.owner.getState().flowSync).toEqual(flowSync('synced'))
  })

  it('keeps a failed sync retry visible on the banner instead of pretending it synced', async () => {
    harness.retrySync.mockResolvedValueOnce({
      success: true,
      data: { flowSync: flowSync('failed') },
    })

    await expect(harness.owner.retrySync(harness.context)).resolves.toMatchObject({
      status: 'failed',
    })
    expect(harness.published).toHaveLength(0)
    expect(harness.owner.getState().flowSync.status).toBe('failed')
  })

  it('reports a partial retry when the sync succeeded but the queue read failed', async () => {
    harness.enqueueRefetch(null)

    await expect(harness.owner.retrySync(harness.context)).resolves.toMatchObject({
      status: 'partial',
      message: TRAINING_PLAN_PARTIAL_REFRESH_MESSAGE,
    })
    expect(harness.published).toHaveLength(1)
    expect(harness.owner.getState().warning).toBe(TRAINING_PLAN_PARTIAL_REFRESH_MESSAGE)
  })
})

describe('version observation and invalidation', () => {
  it('invalidates a displayed plan when the settings revision advances', async () => {
    await harness.owner.generate('current', harness.context)
    expect(harness.owner.getState().plan).not.toBeNull()

    harness.setSettingsRevision(3)

    expect(harness.owner.getState().plan).toBeNull()
    expect(harness.owner.getState().basis).toBeNull()
  })

  it('adopts flow sync from queue snapshots and invalidates on an external revision change', async () => {
    harness.owner.observeQueueSnapshot(snapshot('queue-1', undefined, flowSync('synced')))
    expect(harness.owner.getState().flowSync).toEqual(flowSync('synced'))

    await harness.owner.generate('current', harness.context)
    expect(harness.owner.getState().plan).not.toBeNull()

    harness.owner.observeQueueSnapshot(snapshot('queue-2'))

    expect(harness.owner.getState().plan).toBeNull()
  })

  it('clears a shown plan and its error on explicit invalidation', async () => {
    await harness.owner.generate('current', harness.context)
    harness.owner.invalidate()

    expect(harness.owner.getState()).toMatchObject({
      plan: null,
      basis: null,
      error: null,
      warning: null,
    })
  })

  it('keeps a partial schedule warning when an unrelated invalidation clears the preview', async () => {
    await harness.owner.generate('current', harness.context)
    harness.applyPlan.mockResolvedValueOnce({
      success: true,
      data: {
        stageCount: 1,
        flowName: '自动任务',
        flowSync: flowSync('synced'),
        scheduleSync: { attempted: true, success: false, message: '定时任务设置失败' },
      },
    })
    await harness.owner.apply(harness.context)
    expect(harness.owner.getState().warning).toContain(TRAINING_PLAN_PARTIAL_SCHEDULE_MESSAGE)

    harness.owner.invalidate()

    expect(harness.owner.getState()).toMatchObject({
      plan: null,
      basis: null,
      error: null,
    })
    expect(harness.owner.getState().warning).toContain(TRAINING_PLAN_PARTIAL_SCHEDULE_MESSAGE)
  })
})
