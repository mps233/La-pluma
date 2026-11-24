// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '@/shared/api'
import {
  ResourceInvalidationHub,
  type ResourceInvalidation,
} from '@/features/resource-invalidation'
import type { AgentRun } from '@/features/task-execution'
import {
  StatisticsCommandOwner,
  type StatisticsCommandExecutionPort,
  type StatisticsCommandOwnerOptions,
} from './commandOwner'

const depotPayload = {
  success: true,
  data: {
    itemCount: 2,
    items: [
      { id: '30012', name: '固源岩', iconId: 'rock', count: 12, classifyType: 'MATERIAL' },
      { id: '30013', name: '装置', iconId: 'device', count: 4, classifyType: 'MATERIAL' },
    ],
    path: '/data/depot.json',
  },
}

const operBoxPayload = {
  success: true,
  data: {
    operCount: 1,
    data: [{ id: 'char_001', name: '测试干员', rarity: 6, profession: 'SNIPER' }],
    path: '/data/operbox.json',
  },
}

const submittedRun = (runId: string, state: string = 'succeeded'): ApiResponse => ({
  success: true,
  data: {
    runId,
    run: { runId, state },
  },
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/** 命令请求只会在 signal 中止时失败，用来验证超时/取消不会等待真实网络。 */
const abortable = (signal: AbortSignal | null): Promise<ApiResponse> => new Promise((_, reject) => {
  signal?.addEventListener('abort', () => {
    reject(new DOMException('The operation was aborted.', 'AbortError'))
  })
})

interface ExecutionHarness extends StatisticsCommandExecutionPort {
  readonly intents: Array<{ operationId: string; idempotencyKey: string; scope: string | null }>
}

const createExecution = (): ExecutionHarness => {
  const intents: ExecutionHarness['intents'] = []
  let sequence = 0
  return {
    intents,
    beginExecutionIntent: vi.fn((operationId, options = {}) => {
      sequence += 1
      const idempotencyKey = options.idempotencyKey ?? `key-${sequence}`
      intents.push({ operationId, idempotencyKey, scope: options.scope ?? null })
      return { operationId, idempotencyKey, scope: options.scope ?? null, sequence }
    }),
    settleExecutionIntent: vi.fn(() => true),
  }
}

interface OwnerHarness {
  owner: StatisticsCommandOwner
  execution: ExecutionHarness
  runCommand: ReturnType<typeof vi.fn>
  readRun: ReturnType<typeof vi.fn>
  parseDepot: ReturnType<typeof vi.fn>
  parseOperBox: ReturnType<typeof vi.fn>
  fetchMaterials: ReturnType<typeof vi.fn>
  publish: ReturnType<typeof vi.fn<(invalidation: ResourceInvalidation) => void>>
}

const createOwner = (overrides: StatisticsCommandOwnerOptions = {}): OwnerHarness => {
  const execution = createExecution()
  const runCommand = vi.fn()
  const readRun = vi.fn()
  const parseDepot = vi.fn()
  const parseOperBox = vi.fn()
  const fetchMaterials = vi.fn()
  const publish = vi.fn<(invalidation: ResourceInvalidation) => void>()
  const owner = new StatisticsCommandOwner({
    execution,
    runCommand,
    readRun,
    parseDepot,
    parseOperBox,
    fetchMaterials,
    publish,
    timeouts: { command: 1_000, run: 1_000, parse: 1_000, materials: 1_000 },
    runPollMs: 10,
    parsePollMs: 10,
    ...overrides,
  })
  return { owner, execution, runCommand, readRun, parseDepot, parseOperBox, fetchMaterials, publish }
}

const terminalRun = (state: string, message?: string): AgentRun => ({
  runId: 'run-1',
  state,
  ...(message ? { error: { message } } : {}),
}) as AgentRun

describe('statistics command owner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('submits depot recognition through the idempotent execution intent and publishes dependent resources', async () => {
    const harness = createOwner()
    harness.runCommand.mockResolvedValue({ success: true, data: {} })
    harness.parseDepot.mockResolvedValue(depotPayload)
    const progress: string[] = []

    const result = await harness.owner.run('depot', { onProgress: message => progress.push(message) })

    expect(result).toMatchObject({ status: 'succeeded', kind: 'depot', depot: { itemCount: 2 } })
    expect(harness.execution.intents).toEqual([
      { operationId: 'run_task', idempotencyKey: 'key-1', scope: 'statistics' },
    ])
    expect(harness.runCommand).toHaveBeenCalledWith(
      'run',
      ['depot'],
      expect.objectContaining({ name: '仓库识别', type: 'Depot' }),
      expect.any(AbortSignal),
      '仓库识别',
      'statistics',
      true,
      { idempotencyKey: 'key-1' },
    )
    expect(harness.execution.settleExecutionIntent).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'key-1' }),
      expect.objectContaining({ success: true }),
    )
    expect(harness.parseDepot).toHaveBeenCalledTimes(1)
    expect(harness.publish).toHaveBeenCalledWith({
      resources: ['depot', 'materials', 'training-queue', 'dashboard-snapshot'],
      cause: 'recognition',
    })
    expect(progress[0]).toBe('正在识别仓库物品...')
    expect(progress[progress.length - 1]).toBe('识别完成！共识别 2 种物品')
    expect(harness.owner.getState()).toMatchObject({
      kind: 'depot',
      phase: 'succeeded',
      resumeMode: null,
    })
  })

  it('applies the authoritative snapshot before publishing recognition invalidation', async () => {
    const harness = createOwner()
    harness.runCommand.mockResolvedValue({ success: true, data: {} })
    harness.parseDepot.mockResolvedValue(depotPayload)
    const order: string[] = []
    const snapshotApplied = deferred<void>()
    harness.publish.mockImplementation(() => {
      order.push('publish')
    })

    const run = harness.owner.run('depot', {
      applyRecognitionSnapshot: async snapshot => {
        order.push(`apply:${snapshot.kind}`)
        await snapshotApplied.promise
        order.push('applied')
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    // 快照写入尚未完成时不能发布失效，否则监听器会先发起旧 GET。
    expect(order).toEqual(['apply:depot'])

    snapshotApplied.resolve()
    await expect(run).resolves.toMatchObject({ status: 'succeeded', kind: 'depot' })
    expect(order).toEqual(['apply:depot', 'applied', 'publish'])
  })

  it('publishes owned operator and shared training resources after operbox recognition', async () => {
    const harness = createOwner()
    harness.runCommand.mockResolvedValue({ success: true, data: {} })
    harness.parseOperBox.mockResolvedValue(operBoxPayload)

    const result = await harness.owner.run('operbox')

    expect(result).toMatchObject({ status: 'succeeded', kind: 'operbox', operBox: { operCount: 1 } })
    expect(harness.parseDepot).not.toHaveBeenCalled()
    expect(harness.publish).toHaveBeenCalledWith({
      resources: ['operbox', 'catalog', 'materials', 'training-queue', 'dashboard-snapshot'],
      cause: 'recognition',
    })
  })

  it('invalidates the shared catalog after operbox recognition so a snapshot fallback is re-read', async () => {
    const hub = new ResourceInvalidationHub()
    const harness = createOwner({ publish: invalidation => hub.publish(invalidation) })
    const catalogue = vi.fn()
    hub.subscribe(event => {
      if (event.resources.includes('catalog')) catalogue(event.resources)
    })
    harness.runCommand.mockResolvedValue({ success: true, data: {} })
    harness.parseOperBox.mockResolvedValue(operBoxPayload)

    await harness.owner.run('operbox')

    expect(catalogue).toHaveBeenCalledWith([
      'operbox',
      'catalog',
      'materials',
      'training-queue',
      'dashboard-snapshot',
    ])
  })

  it('refreshes materials once and publishes the resources derived from material data', async () => {
    const harness = createOwner()
    harness.fetchMaterials.mockResolvedValue({ success: true, data: { operatorCount: 1 } })

    const result = await harness.owner.run('materials')

    expect(result).toMatchObject({ status: 'succeeded', kind: 'materials' })
    expect(harness.fetchMaterials).toHaveBeenCalledTimes(1)
    expect(harness.runCommand).not.toHaveBeenCalled()
    expect(harness.parseDepot).not.toHaveBeenCalled()
    expect(harness.publish).toHaveBeenCalledWith({
      resources: ['materials', 'training-queue', 'dashboard-snapshot'],
      cause: 'recognition',
    })
  })

  it('reports a materials-specific message when the materials refresh times out', async () => {
    const harness = createOwner({
      timeouts: { command: 1_000, run: 1_000, parse: 1_000, materials: 20 },
    })
    harness.fetchMaterials.mockImplementation((signal: AbortSignal) => abortable(signal))

    const promise = harness.owner.run('materials')
    await vi.advanceTimersByTimeAsync(30)
    const result = await promise

    expect(result).toMatchObject({
      status: 'timed-out',
      kind: 'materials',
      message: '等待材料数据结果超时',
    })
    expect(harness.owner.getState()).toMatchObject({ phase: 'timed-out', resumeMode: null })
    expect(harness.publish).not.toHaveBeenCalled()
  })

  it('reports a materials-specific message when the materials wait is cancelled', async () => {
    const harness = createOwner()
    harness.fetchMaterials.mockImplementation((signal: AbortSignal) => abortable(signal))

    const promise = harness.owner.run('materials')
    await vi.advanceTimersByTimeAsync(1)
    harness.owner.cancel()
    const result = await promise

    expect(result).toMatchObject({
      status: 'cancelled',
      kind: 'materials',
      message: '已取消等待材料数据',
    })
    expect(harness.owner.getState()).toMatchObject({ phase: 'cancelled', resumeMode: null })
  })

  it('does not submit a second device command while one is in flight', async () => {
    const harness = createOwner()
    const command = deferred<ApiResponse>()
    harness.runCommand.mockReturnValue(command.promise)
    harness.parseDepot.mockResolvedValue(depotPayload)

    const first = harness.owner.run('depot')
    const second = await harness.owner.run('depot')

    expect(second).toMatchObject({ status: 'busy', kind: 'depot' })
    expect(harness.runCommand).toHaveBeenCalledTimes(1)

    command.resolve({ success: true, data: {} })
    await expect(first).resolves.toMatchObject({ status: 'succeeded' })
    expect(harness.runCommand).toHaveBeenCalledTimes(1)
  })

  it('waits for a parsable recognition result instead of a fixed delay', async () => {
    const harness = createOwner()
    harness.runCommand.mockResolvedValue({ success: true, data: {} })
    harness.parseDepot
      .mockResolvedValueOnce({ success: true, data: null })
      .mockResolvedValueOnce({
        success: false,
        message: '未找到有效仓库识别结果',
        errorInfo: { code: 'AGENT_RECOGNITION_NO_RESULT', retryable: true },
      })
      .mockResolvedValueOnce(depotPayload)

    const promise = harness.owner.run('depot')
    await vi.advanceTimersByTimeAsync(30)
    const result = await promise

    expect(result).toMatchObject({ status: 'succeeded', kind: 'depot', depot: { itemCount: 2 } })
    expect(harness.runCommand).toHaveBeenCalledTimes(1)
    expect(harness.parseDepot).toHaveBeenCalledTimes(3)
    expect(harness.publish).toHaveBeenCalledTimes(1)
  })

  it('times out a stuck parse and resumes parsing without re-executing the command', async () => {
    const harness = createOwner({
      timeouts: { command: 1_000, run: 1_000, parse: 30, materials: 1_000 },
    })
    harness.runCommand.mockResolvedValue({ success: true, data: {} })
    harness.parseDepot.mockResolvedValue({ success: true, data: null })

    const promise = harness.owner.run('depot')
    await vi.advanceTimersByTimeAsync(50)
    const timedOut = await promise

    expect(timedOut).toMatchObject({ status: 'timed-out', kind: 'depot' })
    expect(harness.owner.getState()).toMatchObject({
      phase: 'timed-out',
      resumeMode: 'parse',
    })
    expect(harness.runCommand).toHaveBeenCalledTimes(1)
    expect(harness.publish).not.toHaveBeenCalled()

    harness.parseDepot.mockResolvedValue(depotPayload)
    const resumed = await harness.owner.resume()

    expect(resumed).toMatchObject({ status: 'succeeded', kind: 'depot' })
    expect(harness.runCommand).toHaveBeenCalledTimes(1)
    expect(harness.execution.intents).toHaveLength(1)
    expect(harness.publish).toHaveBeenCalledTimes(1)
  })

  it('times out while a replayed run is still active without parsing or resubmitting', async () => {
    const harness = createOwner({
      timeouts: { command: 1_000, run: 20, parse: 1_000, materials: 1_000 },
    })
    harness.runCommand.mockResolvedValue(submittedRun('run-1', 'running'))
    harness.readRun.mockResolvedValue({ success: true, data: terminalRun('running') })

    const promise = harness.owner.run('depot')
    await vi.advanceTimersByTimeAsync(30)
    const timedOut = await promise

    expect(timedOut).toMatchObject({
      status: 'timed-out',
      kind: 'depot',
      message: '识别命令仍在执行，可继续等待结果',
    })
    expect(harness.owner.getState()).toMatchObject({ phase: 'timed-out', resumeMode: 'parse' })
    expect(harness.parseDepot).not.toHaveBeenCalled()
    expect(harness.runCommand).toHaveBeenCalledTimes(1)
    expect(harness.readRun).toHaveBeenCalledWith('run-1', expect.any(AbortSignal))
  })

  it('reuses the same idempotency key after a command timeout and waits for the replayed run', async () => {
    const harness = createOwner({
      timeouts: { command: 20, run: 1_000, parse: 1_000, materials: 1_000 },
    })
    harness.runCommand.mockImplementationOnce((_command: string, _args: string[], _task: unknown, signal: AbortSignal) =>
      abortable(signal),
    )

    const promise = harness.owner.run('depot')
    await vi.advanceTimersByTimeAsync(30)
    const timedOut = await promise

    expect(timedOut).toMatchObject({ status: 'timed-out', kind: 'depot' })
    expect(harness.owner.getState()).toMatchObject({ resumeMode: 'command' })
    expect(harness.execution.intents).toHaveLength(1)

    harness.runCommand.mockResolvedValueOnce(submittedRun('run-1', 'running'))
    harness.readRun.mockResolvedValueOnce({ success: true, data: terminalRun('succeeded') })
    harness.parseDepot.mockResolvedValue(depotPayload)

    const resumed = await harness.owner.resume()

    expect(resumed).toMatchObject({ status: 'succeeded', kind: 'depot' })
    expect(harness.execution.intents).toHaveLength(2)
    expect(harness.execution.intents[1]?.idempotencyKey).toBe(harness.execution.intents[0]?.idempotencyKey)
    expect(harness.runCommand).toHaveBeenCalledTimes(2)
    expect(harness.readRun).toHaveBeenCalledWith('run-1', expect.any(AbortSignal))
    expect(harness.parseDepot).toHaveBeenCalledTimes(1)
  })

  it('does not parse a failed run and clears the resume path', async () => {
    const harness = createOwner()
    harness.runCommand.mockResolvedValue(submittedRun('run-1', 'failed'))
    harness.parseDepot.mockResolvedValue(depotPayload)

    const result = await harness.owner.run('depot')

    expect(result).toMatchObject({ status: 'failed', kind: 'depot' })
    expect(harness.parseDepot).not.toHaveBeenCalled()
    expect(harness.publish).not.toHaveBeenCalled()
    expect(harness.owner.getState()).toMatchObject({ resumeMode: null })
  })

  it('fails an unclassifiable submitted run state without parsing or publishing', async () => {
    const harness = createOwner()
    harness.runCommand.mockResolvedValue(submittedRun('run-1', 'teleported'))
    harness.parseDepot.mockResolvedValue(depotPayload)

    const result = await harness.owner.run('depot')

    expect(result).toMatchObject({
      status: 'failed',
      kind: 'depot',
      message: '无法确认识别命令的执行结果',
    })
    expect(harness.parseDepot).not.toHaveBeenCalled()
    expect(harness.publish).not.toHaveBeenCalled()
    expect(harness.owner.getState()).toMatchObject({ phase: 'failed', resumeMode: 'command' })
  })

  it('treats a rejected command as a definite failure and allows a fresh intent later', async () => {
    const harness = createOwner()
    harness.runCommand
      .mockResolvedValueOnce({ success: false, message: '设备正被其他任务占用' })
      .mockResolvedValueOnce({ success: true, data: {} })
    harness.parseDepot.mockResolvedValue(depotPayload)

    const failed = await harness.owner.run('depot')
    expect(failed).toMatchObject({ status: 'failed', kind: 'depot' })
    expect(harness.parseDepot).not.toHaveBeenCalled()
    expect(harness.execution.intents).toHaveLength(1)

    const retried = await harness.owner.run('depot')

    expect(retried).toMatchObject({ status: 'succeeded', kind: 'depot' })
    expect(harness.execution.intents).toHaveLength(2)
    expect(harness.execution.intents[1]?.idempotencyKey).not.toBe(harness.execution.intents[0]?.idempotencyKey)
  })

  it('cancels only the local wait and resumes the accepted command without a second submission', async () => {
    const harness = createOwner()
    harness.runCommand.mockResolvedValue({ success: true, data: {} })
    const firstParse = deferred<ApiResponse>()
    harness.parseDepot.mockImplementationOnce((signal: AbortSignal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
      void firstParse.promise.then(resolve)
    }))

    const promise = harness.owner.run('depot')
    await vi.advanceTimersByTimeAsync(11)
    harness.owner.cancel()
    const cancelled = await promise

    expect(cancelled).toMatchObject({ status: 'cancelled', kind: 'depot' })
    expect(harness.owner.getState()).toMatchObject({ phase: 'cancelled', resumeMode: 'parse' })
    expect(harness.runCommand).toHaveBeenCalledTimes(1)

    harness.parseDepot.mockResolvedValue(depotPayload)
    const resumed = await harness.owner.resume()

    expect(resumed).toMatchObject({ status: 'succeeded', kind: 'depot' })
    expect(harness.runCommand).toHaveBeenCalledTimes(1)
    expect(harness.execution.intents).toHaveLength(1)
  })

  it('publishes recognition results through the invalidation port for training and dashboard observers', async () => {
    const hub = new ResourceInvalidationHub()
    const harness = createOwner({ publish: invalidation => hub.publish(invalidation) })
    const training = vi.fn()
    const dashboard = vi.fn()
    hub.subscribe(event => {
      if (event.resources.includes('training-queue')) training(event.resources)
    })
    hub.subscribe(event => {
      if (event.resources.includes('dashboard-snapshot')) dashboard(event.resources)
    })
    harness.runCommand.mockResolvedValue({ success: true, data: {} })
    harness.parseDepot.mockResolvedValue(depotPayload)

    await harness.owner.run('depot')

    expect(training).toHaveBeenCalledWith([
      'depot',
      'materials',
      'training-queue',
      'dashboard-snapshot',
    ])
    expect(dashboard).toHaveBeenCalledTimes(1)
  })

  it('cancels a command response wait and re-confirms with the same key', async () => {
    const harness = createOwner()
    harness.runCommand.mockImplementationOnce((_command: string, _args: string[], _task: unknown, signal: AbortSignal) =>
      abortable(signal),
    )

    const promise = harness.owner.run('depot')
    await vi.advanceTimersByTimeAsync(1)
    harness.owner.cancel()
    const cancelled = await promise

    expect(cancelled).toMatchObject({ status: 'cancelled', kind: 'depot' })
    expect(harness.owner.getState()).toMatchObject({ resumeMode: 'command' })
    expect(harness.execution.intents).toHaveLength(1)

    harness.runCommand.mockResolvedValueOnce({ success: true, data: {} })
    harness.parseDepot.mockResolvedValue(depotPayload)
    const resumed = await harness.owner.resume()

    expect(resumed).toMatchObject({ status: 'succeeded', kind: 'depot' })
    expect(harness.execution.intents).toHaveLength(2)
    expect(harness.execution.intents[1]?.idempotencyKey).toBe(harness.execution.intents[0]?.idempotencyKey)
  })
})
