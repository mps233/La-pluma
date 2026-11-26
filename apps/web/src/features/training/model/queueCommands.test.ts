// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '@/shared/api'
import {
  TRAINING_QUEUE_FLOW_SYNC_SCOPES,
  TRAINING_QUEUE_MUTATION_SCOPES,
  TRAINING_QUEUE_MUTATION_SOURCE,
  TRAINING_QUEUE_UNCERTAIN_MESSAGE,
  TrainingQueueCommandOwner,
  isTrainingQueueMutationInvalidation,
  type TrainingQueueCommandContext,
} from './queueCommands'
import type {
  TrainingOperator,
  TrainingQueueItem,
  TrainingQueueMutationData,
  TrainingQueueSnapshot,
  TrainingSettings,
} from '../types'

const settings: TrainingSettings = {
  useMedicine: 0,
  useStone: 0,
  autoSwitch: true,
  notifyOnComplete: true,
}

const operator = (id: string, name: string): TrainingOperator => ({
  id,
  name,
  rarity: 6,
  profession: 'SNIPER',
  currentElite: 1,
  targetElite: 2,
  owned: true,
  hasMaterialData: true,
  canTrain: true,
})

const queueItem = (operatorId: string, name: string): TrainingQueueItem => ({
  operatorId,
  operator: { name, rarity: 6, profession: 'SNIPER' },
  currentElite: 1,
  targetElite: 2,
  materials: [],
  progress: 25,
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

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const success = (
  data: TrainingQueueMutationData = {},
): ApiResponse<TrainingQueueMutationData> => ({ success: true, data })

const createHarness = (initialQueue: TrainingQueueItem[]) => {
  let server = [...initialQueue]
  let committed: TrainingQueueSnapshot | undefined = {
    queue: [...initialQueue],
    settings,
    revision: 'revision-1',
    lastUpdated: '2026-10-26T00:00:00.000Z',
  }
  const add = vi.fn(async (data: {
    operatorId: string
    currentElite?: number
    targetElite?: number
    position?: number
  }): Promise<ApiResponse<TrainingQueueMutationData>> => {
    const existing = server.find(item => item.operatorId === data.operatorId)
    const item = existing ?? queueItem(data.operatorId, data.operatorId)
    const rest = server.filter(entry => entry.operatorId !== data.operatorId)
    const position = Math.min(Math.max(data.position ?? rest.length, 0), rest.length)
    rest.splice(position, 0, item)
    server = rest
    return success({ queueUpdated: true, queueRevision: 'revision-2' })
  })
  const remove = vi.fn(async (operatorId: string): Promise<ApiResponse<TrainingQueueMutationData>> => {
    server = server.filter(item => item.operatorId !== operatorId)
    return success({ queueUpdated: true, queueRevision: 'revision-2' })
  })
  const applyReorder = (operatorIds: string[]): ApiResponse<TrainingQueueMutationData> => {
    server = operatorIds.map(operatorId => {
      const item = server.find(entry => entry.operatorId === operatorId)
      if (!item) throw new Error(`missing ${operatorId}`)
      return item
    })
    return success({ queueUpdated: true, queueRevision: 'revision-2' })
  }
  const reorder = vi.fn(async (operatorIds: string[]) => applyReorder(operatorIds))
  const readQueue = vi.fn(async (): Promise<TrainingQueueSnapshot> => ({
    queue: [...server],
    settings,
    revision: 'revision-2',
    lastUpdated: '2026-10-26T00:00:01.000Z',
  }))
  const publish = vi.fn()
  const owner = new TrainingQueueCommandOwner({ readQueue, add, remove, reorder, publish })
  const context: TrainingQueueCommandContext = {
    getSnapshot: () => committed,
    commitSnapshot: snapshot => {
      committed = snapshot
    },
    cancelReads: vi.fn(async () => undefined),
  }

  return {
    owner,
    context,
    add,
    remove,
    reorder,
    applyReorder,
    readQueue,
    publish,
    getServer: () => server,
    getCommitted: () => committed,
    setCommitted: (snapshot: TrainingQueueSnapshot | undefined) => {
      committed = snapshot
    },
  }
}

describe('TrainingQueueCommandOwner', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('serializes reorders against the latest committed queue instead of a stale payload', async () => {
    const harness = createHarness([
      queueItem('char_a', '阿米娅'),
      queueItem('char_b', '能天使'),
      queueItem('char_c', '艾雅法拉'),
    ])
    const firstWrite = deferred<ApiResponse<TrainingQueueMutationData>>()
    harness.reorder.mockImplementationOnce(async operatorIds => {
      await firstWrite.promise
      return harness.applyReorder(operatorIds)
    })

    const first = harness.owner.run(
      { type: 'reorder', operatorId: 'char_c', destination: 0 },
      harness.context,
    )
    const second = harness.owner.run(
      { type: 'reorder', operatorId: 'char_b', destination: 0 },
      harness.context,
    )

    expect(harness.owner.getState().pending).toHaveLength(2)
    await flush()
    expect(harness.context.cancelReads).toHaveBeenCalledTimes(1)
    expect(harness.reorder).toHaveBeenCalledTimes(1)

    firstWrite.resolve(success({ queueUpdated: true, queueRevision: 'revision-2' }))
    const [firstOutcome, secondOutcome] = await Promise.all([first, second])

    expect(harness.reorder.mock.calls.map(([ids]) => ids)).toEqual([
      ['char_c', 'char_a', 'char_b'],
      ['char_b', 'char_c', 'char_a'],
    ])
    expect(harness.getServer().map(item => item.operatorId)).toEqual(['char_b', 'char_c', 'char_a'])
    expect(harness.getCommitted()?.queue.map(item => item.operatorId))
      .toEqual(['char_b', 'char_c', 'char_a'])
    expect(firstOutcome).toMatchObject({ status: 'applied', message: '养成顺序已更新' })
    expect(secondOutcome).toMatchObject({ status: 'applied', message: '养成顺序已更新' })
    expect(harness.owner.getState().pending).toEqual([])
  })

  it('keeps both destinations when the same operator is reordered twice', async () => {
    const harness = createHarness([
      queueItem('char_a', '阿米娅'),
      queueItem('char_b', '能天使'),
      queueItem('char_c', '艾雅法拉'),
    ])
    const firstWrite = deferred<ApiResponse<TrainingQueueMutationData>>()
    harness.reorder.mockImplementationOnce(async operatorIds => {
      await firstWrite.promise
      return harness.applyReorder(operatorIds)
    })

    const first = harness.owner.run(
      { type: 'reorder', operatorId: 'char_a', destination: 2 },
      harness.context,
    )
    const second = harness.owner.run(
      { type: 'reorder', operatorId: 'char_a', destination: 0 },
      harness.context,
    )

    expect(harness.owner.getState().pending).toHaveLength(2)
    firstWrite.resolve(success({ queueUpdated: true, queueRevision: 'revision-2' }))
    await Promise.all([first, second])

    expect(harness.reorder.mock.calls.map(([ids]) => ids)).toEqual([
      ['char_b', 'char_c', 'char_a'],
      ['char_a', 'char_b', 'char_c'],
    ])
    expect(harness.getCommitted()?.queue.map(item => item.operatorId))
      .toEqual(['char_a', 'char_b', 'char_c'])
  })

  it('coalesces a duplicate add while the first request is pending', async () => {
    const harness = createHarness([])
    const write = deferred<ApiResponse<TrainingQueueMutationData>>()
    harness.add.mockReturnValueOnce(write.promise)
    const command = { type: 'add' as const, operator: operator('char_added', '能天使') }

    const first = harness.owner.run(command, harness.context)
    const duplicate = await harness.owner.run(command, harness.context)

    expect(duplicate).toMatchObject({ status: 'ignored', type: 'add' })
    expect(harness.owner.getState().pending).toHaveLength(1)
    await flush()
    expect(harness.add).toHaveBeenCalledTimes(1)

    write.resolve(success({ queueRevision: 'revision-2' }))
    await first
    expect(harness.owner.getState().pending).toEqual([])
  })

  it('keeps a local fallback and marks the queue uncertain when a successful write cannot be refreshed', async () => {
    const harness = createHarness([queueItem('char_a', '阿米娅')])
    harness.add.mockResolvedValueOnce(success({
      queueRevision: 'revision-2',
      flowSync: { status: 'synced', flowName: '日常刷图', taskName: 'Fight' },
    }))
    harness.readQueue.mockRejectedValueOnce(new Error('队列服务暂不可用'))

    const outcome = await harness.owner.run(
      { type: 'add', operator: operator('char_added', '能天使') },
      harness.context,
    )

    expect(outcome.status).toBe('uncertain')
    if (outcome.status !== 'uncertain') return
    expect(outcome.message).toContain('队列刷新失败')
    expect(outcome.snapshot.queue.map(item => item.operatorId))
      .toEqual(['char_a', 'char_added'])
    expect(outcome.snapshot.uncertain).toBe(TRAINING_QUEUE_UNCERTAIN_MESSAGE)
    expect(outcome.snapshot.revision).toBe('revision-2')
    expect(outcome.snapshot.settings).toEqual(settings)
    expect(outcome.flowSync).toMatchObject({ status: 'synced', flowName: '日常刷图' })
    expect(harness.getCommitted()).toBe(outcome.snapshot)
    expect(harness.publish).toHaveBeenCalledOnce()
    expect(harness.publish).toHaveBeenCalledWith({
      resources: [...TRAINING_QUEUE_MUTATION_SCOPES, ...TRAINING_QUEUE_FLOW_SYNC_SCOPES],
      cause: 'training-queue',
      detail: { source: TRAINING_QUEUE_MUTATION_SOURCE },
    })
    // 自动同步不重注册 cron，因此不能声明 automation-schedule 已变化。
    const firstCall = harness.publish.mock.calls[0]!
    expect((firstCall[0] as { resources: readonly string[] }).resources)
      .not.toContain('automation-schedule')
  })

  it('does not announce automation changes when the queue write could not sync the flow', async () => {
    const harness = createHarness([queueItem('char_a', '阿米娅')])
    harness.add.mockResolvedValueOnce(success({
      queueRevision: 'revision-2',
      flowSync: { status: 'failed', flowName: '日常刷图', taskName: 'Fight', error: '配置不可写' },
    }))

    const outcome = await harness.owner.run(
      { type: 'add', operator: operator('char_added', '能天使') },
      harness.context,
    )

    expect(outcome.status).toBe('applied')
    expect(harness.publish).toHaveBeenCalledWith({
      resources: [...TRAINING_QUEUE_MUTATION_SCOPES],
      cause: 'training-queue',
      detail: { source: TRAINING_QUEUE_MUTATION_SOURCE },
    })
  })

  it('applies a reorder to the latest cached queue when the refresh fails', async () => {
    const harness = createHarness([
      queueItem('char_a', '阿米娅'),
      queueItem('char_b', '能天使'),
      queueItem('char_c', '艾雅法拉'),
    ])
    harness.reorder.mockResolvedValueOnce(success({ queueRevision: 'revision-2' }))
    harness.readQueue.mockRejectedValueOnce(new Error('队列服务暂不可用'))

    const outcome = await harness.owner.run(
      { type: 'reorder', operatorId: 'char_c', destination: 0 },
      harness.context,
    )

    expect(outcome).toMatchObject({
      status: 'uncertain',
      message: '顺序已更新，但队列刷新失败，请重试',
    })
    if (outcome.status !== 'uncertain') return
    expect(outcome.snapshot.queue.map(item => item.operatorId))
      .toEqual(['char_c', 'char_a', 'char_b'])
    expect(outcome.snapshot.revision).toBe('revision-2')
    expect(outcome.snapshot.uncertain).toBe(TRAINING_QUEUE_UNCERTAIN_MESSAGE)
    expect(harness.publish).toHaveBeenCalledOnce()
  })

  it('applies a remove to the latest cache when the refresh fails', async () => {
    const harness = createHarness([
      queueItem('char_a', '阿米娅'),
      queueItem('char_b', '能天使'),
    ])
    const removed = harness.getCommitted()!.queue[1]!
    harness.remove.mockResolvedValueOnce(success({ queueRevision: 'revision-2' }))
    harness.readQueue.mockRejectedValueOnce(new Error('队列服务暂不可用'))

    const outcome = await harness.owner.run(
      { type: 'remove', operatorId: 'char_b' },
      harness.context,
    )

    expect(outcome.status).toBe('uncertain')
    if (outcome.status !== 'uncertain') return
    expect(outcome.snapshot.queue.map(item => item.operatorId)).toEqual(['char_a'])
    expect(outcome.snapshot.revision).toBe('revision-2')
    expect(outcome.snapshot.uncertain).toBe(TRAINING_QUEUE_UNCERTAIN_MESSAGE)
    expect(outcome.removed).toEqual({ item: removed, index: 1 })
  })

  it('deduplicates fallback adds and keeps the revision advanced during the write', async () => {
    const harness = createHarness([queueItem('char_a', '阿米娅')])
    const write = deferred<ApiResponse<TrainingQueueMutationData>>()
    harness.add.mockReturnValueOnce(write.promise)
    harness.readQueue.mockRejectedValueOnce(new Error('队列服务暂不可用'))

    const pending = harness.owner.run(
      { type: 'add', operator: operator('char_added', '能天使') },
      harness.context,
    )
    await flush()

    const externallyAdded = { ...queueItem('char_added', '能天使'), progress: 60 }
    harness.setCommitted({
      queue: [queueItem('char_a', '阿米娅'), externallyAdded],
      settings,
      revision: 'revision-3',
      lastUpdated: '2026-10-26T00:00:02.000Z',
    })

    write.resolve(success({ queueRevision: 'revision-2' }))
    const outcome = await pending

    expect(outcome.status).toBe('uncertain')
    if (outcome.status !== 'uncertain') return
    expect(outcome.snapshot.queue.map(item => item.operatorId))
      .toEqual(['char_a', 'char_added'])
    expect(outcome.snapshot.queue[1]).toBe(externallyAdded)
    expect(outcome.snapshot.revision).toBe('revision-3')
    expect(outcome.snapshot.uncertain).toBe(TRAINING_QUEUE_UNCERTAIN_MESSAGE)
  })

  it('ignores undo when the latest snapshot already contains the operator', async () => {
    const harness = createHarness([])
    const restored = queueItem('char_b', '能天使')
    harness.setCommitted({
      queue: [queueItem('char_a', '阿米娅'), restored],
      settings,
      revision: 'revision-3',
      lastUpdated: '2026-10-26T00:00:02.000Z',
    })

    const outcome = await harness.owner.run(
      { type: 'undo', item: restored, index: 1 },
      harness.context,
    )

    expect(outcome).toEqual({ status: 'ignored', type: 'undo', operatorId: 'char_b' })
    expect(harness.add).not.toHaveBeenCalled()
    expect(harness.readQueue).not.toHaveBeenCalled()
    expect(harness.publish).not.toHaveBeenCalled()
  })

  it('keeps the cached queue untouched and publishes nothing when the write fails', async () => {
    const harness = createHarness([queueItem('char_a', '阿米娅')])
    const before = harness.getCommitted()
    harness.add.mockResolvedValueOnce({ success: false, message: '干员已在养成队列中' })

    const outcome = await harness.owner.run(
      { type: 'add', operator: operator('char_new', '新干员') },
      harness.context,
    )

    expect(outcome).toMatchObject({
      status: 'failed',
      type: 'add',
      message: '干员已在养成队列中',
    })
    expect(harness.getCommitted()).toBe(before)
    expect(harness.readQueue).not.toHaveBeenCalled()
    expect(harness.publish).not.toHaveBeenCalled()
    expect(harness.owner.getState().pending).toEqual([])
  })

  it('serializes a queued undo after a removal and restores the original index once', async () => {
    const harness = createHarness([
      queueItem('char_a', '阿米娅'),
      queueItem('char_b', '能天使'),
      queueItem('char_c', '艾雅法拉'),
    ])
    const removed = harness.getCommitted()!.queue[1]!

    const remove = harness.owner.run(
      { type: 'remove', operatorId: 'char_b' },
      harness.context,
    )
    const undo = harness.owner.run(
      { type: 'undo', item: removed, index: 1 },
      harness.context,
    )

    const [removeOutcome, undoOutcome] = await Promise.all([remove, undo])

    expect(harness.remove).toHaveBeenCalledOnce()
    expect(harness.add).toHaveBeenCalledWith({
      operatorId: 'char_b',
      currentElite: 1,
      targetElite: 2,
      position: 1,
    })
    expect(harness.getCommitted()?.queue.map(item => item.operatorId))
      .toEqual(['char_a', 'char_b', 'char_c'])
    expect(removeOutcome).toMatchObject({
      status: 'applied',
      removed: { item: removed, index: 1 },
    })
    expect(undoOutcome).toMatchObject({
      status: 'applied',
      message: '能天使 已恢复',
    })
    expect(harness.owner.getState().pending).toEqual([])
  })

  it('rejects a reorder whose operator is no longer in the latest queue', async () => {
    const harness = createHarness([queueItem('char_a', '阿米娅')])

    const outcome = await harness.owner.run(
      { type: 'reorder', operatorId: 'char_missing', destination: 0 },
      harness.context,
    )

    expect(outcome).toMatchObject({ status: 'failed', message: '队列已变化，请重新排序' })
    expect(harness.reorder).not.toHaveBeenCalled()
    expect(harness.publish).not.toHaveBeenCalled()
  })

  it('cancels in-flight queue reads before and after the write', async () => {
    const harness = createHarness([])
    harness.add.mockResolvedValueOnce(success({ queueRevision: 'revision-2' }))

    await harness.owner.run(
      { type: 'add', operator: operator('char_added', '能天使') },
      harness.context,
    )

    expect(harness.context.cancelReads).toHaveBeenCalledTimes(2)
    const cancelOrder = vi.mocked(harness.context.cancelReads!).mock.invocationCallOrder[0]!
    const writeOrder = harness.add.mock.invocationCallOrder[0]!
    expect(cancelOrder).toBeLessThan(writeOrder)
  })
})

describe('isTrainingQueueMutationInvalidation', () => {
  const base = {
    resources: ['training-queue'] as const,
    cause: 'training-queue' as const,
  }

  it('recognizes only queue mutations published by the training command owner', () => {
    expect(isTrainingQueueMutationInvalidation({
      ...base,
      detail: { source: TRAINING_QUEUE_MUTATION_SOURCE },
    })).toBe(true)
    expect(isTrainingQueueMutationInvalidation(base)).toBe(false)
    expect(isTrainingQueueMutationInvalidation({
      ...base,
      cause: 'resource-update',
      detail: { source: TRAINING_QUEUE_MUTATION_SOURCE },
    })).toBe(false)
    expect(isTrainingQueueMutationInvalidation({
      ...base,
      detail: { source: 'another-source' },
    })).toBe(false)
  })
})
