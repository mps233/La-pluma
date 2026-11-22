// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '@/shared/api'
import { createQueryClient } from '@/shared/query'
import { trainingKeys } from '../model/queryKeys'
import {
  TrainingQueueCommandOwner,
} from '../model/queueCommands'
import type {
  TrainingOperator,
  TrainingQueueItem,
  TrainingQueueMutationData,
  TrainingQueueSnapshot,
  TrainingSettings,
} from '../types'
import { useTrainingQueueCommands, type TrainingQueueCommands } from './useTrainingQueueCommands'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

const success = (): ApiResponse<TrainingQueueMutationData> => ({
  success: true,
  data: { queueUpdated: true, queueRevision: 'revision-2' },
})

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

let root: Root
let container: HTMLDivElement
let queryClient: ReturnType<typeof createQueryClient>
let owner: TrainingQueueCommandOwner
let commands: TrainingQueueCommands | null = null
let writes: Map<string, Deferred<ApiResponse<TrainingQueueMutationData>>>

const queueSnapshot = (): TrainingQueueSnapshot => ({
  queue: [
    queueItem('char_remove', '能天使'),
    queueItem('char_undo', '艾雅法拉'),
    queueItem('char_reorder', '银灰'),
  ],
  settings,
  revision: 'revision-1',
  lastUpdated: '2026-10-26T00:00:00.000Z',
})

const writeFor = (key: string): Promise<ApiResponse<TrainingQueueMutationData>> => {
  const write = deferred<ApiResponse<TrainingQueueMutationData>>()
  writes.set(key, write)
  return write.promise
}

function Harness() {
  const current = useTrainingQueueCommands(owner)
  useEffect(() => {
    commands = current
  }, [current])
  return null
}

describe('useTrainingQueueCommands pending groups', () => {
  beforeEach(async () => {
    const snapshot = queueSnapshot()
    queryClient = createQueryClient()
    queryClient.setQueryData(trainingKeys.resource('queue'), snapshot)
    writes = new Map()
    owner = new TrainingQueueCommandOwner({
      readQueue: vi.fn(async () => snapshot),
      add: vi.fn(data => writeFor(`add:${data.operatorId}`)),
      remove: vi.fn(operatorId => writeFor(`remove:${operatorId}`)),
      reorder: vi.fn(() => writeFor('reorder')),
      publish: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    commands = null
    await act(async () => root.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    ))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    queryClient.clear()
    vi.restoreAllMocks()
  })

  it('maps pending operators into type-specific groups while keeping the queue busy', async () => {
    await act(async () => {
      void commands!.run({ type: 'add', operator: operator('char_add', '能天使') })
      void commands!.run({ type: 'remove', operatorId: 'char_remove' })
      void commands!.run({
        type: 'undo',
        item: queueItem('char_undo', '艾雅法拉'),
        index: 1,
      })
      void commands!.run({ type: 'reorder', operatorId: 'char_reorder', destination: 0 })
    })
    await flush()

    expect([...commands!.pendingAdds]).toEqual(['char_add'])
    expect([...commands!.pendingRemoves]).toEqual(['char_remove'])
    expect([...commands!.pendingUndoOperatorIds]).toEqual(['char_undo'])
    expect([...commands!.pendingOperatorIds].sort())
      .toEqual(['char_add', 'char_remove', 'char_reorder', 'char_undo'])
    expect(commands!.pendingAdds.has('char_reorder')).toBe(false)
    expect(commands!.pendingRemoves.has('char_reorder')).toBe(false)
    expect(commands!.pendingUndoOperatorIds.has('char_reorder')).toBe(false)
    expect(commands!.pending).toHaveLength(4)
    expect(commands!.queueMutationPending).toBe(true)

    writes.get('add:char_add')!.resolve(success())
    await flush()
    writes.get('remove:char_remove')!.resolve(success())
    await flush()
    writes.get('reorder')!.resolve(success())
    await flush()

    expect(commands!.queueMutationPending).toBe(false)
    expect(commands!.pending).toEqual([])
  })

  it('keeps one pending add when the same operator is requested again', async () => {
    const command = { type: 'add' as const, operator: operator('char_add', '能天使') }

    await act(async () => {
      void commands!.run(command)
      void commands!.run(command)
    })
    await flush()

    expect([...commands!.pendingAdds]).toEqual(['char_add'])
    expect(commands!.pending).toHaveLength(1)
    expect(commands!.queueMutationPending).toBe(true)

    writes.get('add:char_add')!.resolve(success())
    await flush()
  })
})
