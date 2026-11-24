// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { keepPreviousData } from '@tanstack/react-query'
import { ApiRequestError } from '@/shared/api'
import { createQueryClient } from '@/shared/query'
import { gameDataKeys } from '@/features/game-data'
import { trainingCandidatesQueryOptions, trainingQueueQueryOptions, trainingStatusCountsQueryOptions } from './queries'
import { TRAINING_DOMAIN, trainingKeys } from './queryKeys'

const apiMocks = vi.hoisted(() => ({
  getOperatorList: vi.fn(),
  getTrainingQueue: vi.fn(),
  getAllOperators: vi.fn(),
  getOperBoxData: vi.fn(),
}))

vi.mock('../api', () => ({
  getOperatorList: apiMocks.getOperatorList,
  getTrainingQueue: apiMocks.getTrainingQueue,
}))

vi.mock('@/features/game-data/api', () => ({
  getAllOperators: apiMocks.getAllOperators,
  getDepotData: vi.fn(),
  getOperBoxData: apiMocks.getOperBoxData,
  getItemIconUrl: () => '',
}))

const operatorRow = (id: string, rarity = 6) => ({
  id,
  name: id,
  rarity,
  profession: 'SNIPER',
  currentElite: 0,
  targetElite: 2,
})

describe('training queue query options', () => {
  beforeEach(() => {
    apiMocks.getTrainingQueue.mockReset()
  })

  it('uses the reserved queue resource identity inside the training domain', () => {
    expect(trainingQueueQueryOptions().queryKey).toEqual(trainingKeys.resource('queue'))
    expect(trainingQueueQueryOptions().queryKey).toEqual(['training', 'queue'])
  })

  it('reads the queue snapshot and keeps its metadata', async () => {
    apiMocks.getTrainingQueue.mockResolvedValue({
      success: true,
      data: {
        queue: [{ operatorId: 'char_1' }],
        settings: { useMedicine: 1, useStone: 0, autoSwitch: true, notifyOnComplete: false },
        revision: 'revision-1',
        lastUpdated: '2026-10-26T00:00:00.000Z',
        flowSync: { status: 'synced', flowName: '自动任务', taskName: 'Fight' },
      },
    })

    const data = await createQueryClient().fetchQuery(trainingQueueQueryOptions())

    expect(data).toMatchObject({
      queue: [{ operatorId: 'char_1' }],
      revision: 'revision-1',
      flowSync: { status: 'synced' },
    })
  })
})

describe('training candidate query options', () => {
  beforeEach(() => {
    apiMocks.getOperatorList.mockReset()
    apiMocks.getAllOperators.mockReset()
    apiMocks.getOperBoxData.mockReset()
  })

  it('scopes candidates to the training domain and keeps filters in the cache identity', () => {
    expect(TRAINING_DOMAIN).toBe('training')
    expect(trainingCandidatesQueryOptions({
      status: 'trainable',
      rarity: 6,
      needsElite2: true,
    }).queryKey).toEqual(trainingKeys.query('candidates', 'trainable', 6, true))
    expect(trainingCandidatesQueryOptions({ status: 'all' }).queryKey)
      .toEqual(['training', 'candidates', 'all', null, false])
    expect(trainingKeys.resource('candidates')).toEqual(['training', 'candidates'])
    expect(trainingKeys.resource('counts')).toEqual(['training', 'counts'])
  })

  it('reads the endpoint with normalized filters', async () => {
    apiMocks.getOperatorList.mockResolvedValue({
      success: true,
      data: { operators: [operatorRow('char_1')] },
    })

    const data = await createQueryClient().fetchQuery(
      trainingCandidatesQueryOptions({ status: 'owned', rarity: 6, needsElite2: true }),
    )

    expect(data.operators).toEqual([operatorRow('char_1')])
    // 旧服务端没有识别概要时保留 null，页面不会伪造“完整识别”。
    expect(data.recognition).toBeNull()
    expect(apiMocks.getOperatorList.mock.calls[0]?.[0])
      .toEqual({ status: 'owned', rarity: 6, needsElite2: true })
    expect(apiMocks.getAllOperators).not.toHaveBeenCalled()
    expect(apiMocks.getOperBoxData).not.toHaveBeenCalled()
  })

  it('rebuilds an empty status=all list from the shared catalogue and operbox', async () => {
    apiMocks.getOperatorList.mockResolvedValue({ success: true, data: { operators: [] } })
    apiMocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [
        { id: 'char_owned', name: '识别名', rarity: 6, profession: 'SNIPER', level: 0, elite: 0, potential: 0 },
        { id: 'char_unowned', name: '未拥有', rarity: 5, profession: 'SNIPER', level: 0, elite: 0, potential: 0 },
      ],
    })
    apiMocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 1,
        data: [{ id: 'char_owned', name: '识别名', rarity: 6, profession: 'SNIPER', level: 80, elite: 1, potential: 2 }],
        timestamp: '2026-10-26T00:00:00.000Z',
      },
    })

    const data = await createQueryClient().fetchQuery(
      trainingCandidatesQueryOptions({ status: 'all' }),
    )

    expect(data.operators.map(operator => [operator.id, operator.name, operator.owned])).toEqual([
      ['char_owned', '识别名', true],
      ['char_unowned', '未拥有', false],
    ])
  })

  it('rebuilds the status=all list from the snapshot fallback when the catalog endpoint is empty', async () => {
    apiMocks.getOperatorList.mockResolvedValue({ success: true, data: { operators: [] } })
    apiMocks.getAllOperators.mockResolvedValue({ success: true, data: [] })
    apiMocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 0,
        data: [],
        allOpers: [{ id: 'char_unowned', name: '未拥有', rarity: 5, owned: false }],
        timestamp: '2026-10-26T00:00:00.000Z',
      },
    })

    const data = await createQueryClient().fetchQuery(
      trainingCandidatesQueryOptions({ status: 'all' }),
    )

    expect(data.operators).toEqual([
      {
        id: 'char_unowned',
        name: '未拥有',
        rarity: 5,
        profession: '未知',
        currentElite: 0,
        currentLevel: 0,
        targetElite: 2,
        owned: false,
        hasMaterialData: false,
        canTrain: false,
        disabledReason: 'unowned',
        trainingStatus: 'unowned',
      },
    ])
    expect(apiMocks.getOperBoxData).toHaveBeenCalledOnce()
  })

  it('reuses the shared game-data snapshots for the all-status fallback', async () => {
    apiMocks.getOperatorList.mockResolvedValue({ success: true, data: { operators: [] } })
    apiMocks.getAllOperators.mockResolvedValue({ success: true, data: [] })
    apiMocks.getOperBoxData.mockResolvedValue({ success: true, data: { data: [] } })
    const client = createQueryClient()

    await client.fetchQuery(trainingCandidatesQueryOptions({ status: 'all' }))
    await client.fetchQuery(trainingCandidatesQueryOptions({ status: 'all', rarity: 5 }))

    expect(apiMocks.getAllOperators).toHaveBeenCalledOnce()
    expect(apiMocks.getOperBoxData).toHaveBeenCalledOnce()
  })

  it('carries the recognition summary from the candidate endpoint', async () => {
    apiMocks.getOperatorList.mockResolvedValue({
      success: true,
      data: {
        operators: [operatorRow('char_1')],
        recognition: {
          status: 'partial',
          recognizedAt: '2026-11-06T00:00:00.000Z',
          total: 335,
          owned: 120,
          unknown: 215,
          missing: ['char_2', 'char_3'],
        },
      },
    })

    const data = await createQueryClient().fetchQuery(
      trainingCandidatesQueryOptions({ status: 'all' }),
    )

    expect(data.recognition).toEqual({
      status: 'partial',
      recognizedAt: '2026-11-06T00:00:00.000Z',
      total: 335,
      owned: 120,
      unknown: 215,
      missing: ['char_2', 'char_3'],
    })
    expect(data.operators).toEqual([operatorRow('char_1')])
  })

  it('surfaces a failed candidate envelope without falling back to the catalogue', async () => {
    apiMocks.getOperatorList.mockResolvedValue({ success: false, message: '干员列表服务不可用' })

    const error = await createQueryClient()
      .fetchQuery(trainingCandidatesQueryOptions({ status: 'all' }))
      .catch(cause => cause)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect(apiMocks.getAllOperators).not.toHaveBeenCalled()
  })
})

describe('training status count query options', () => {
  beforeEach(() => {
    apiMocks.getOperatorList.mockReset()
    apiMocks.getAllOperators.mockReset()
    apiMocks.getOperBoxData.mockReset()
  })

  it('keeps rarity and the elite condition in the counts cache identity', () => {
    expect(trainingStatusCountsQueryOptions({ rarity: 6, needsElite2: true }).queryKey)
      .toEqual(trainingKeys.query('counts', 6, true))
    expect(trainingStatusCountsQueryOptions({}).queryKey).toEqual(['training', 'counts', null, false])
    expect(trainingStatusCountsQueryOptions({ rarity: 6 }).placeholderData).toBe(keepPreviousData)
  })

  it('reads catalogue and operbox from the existing game-data cache', async () => {
    apiMocks.getOperatorList.mockResolvedValue({ success: true, data: { operators: [operatorRow('char_a')] } })
    const client = createQueryClient()
    client.setQueryData(gameDataKeys.resource('catalog'), {
      operators: [
        { id: 'char_a', name: 'A', rarity: 6, profession: 'SNIPER', level: 0, elite: 0, potential: 0 },
      ],
      source: 'remote',
    })
    client.setQueryData(gameDataKeys.resource('operbox'), {
      operCount: 1,
      data: [{ id: 'char_a', name: 'A', rarity: 6, profession: 'SNIPER', level: 80, elite: 2, potential: 0 }],
      timestamp: '2026-10-26T00:00:00.000Z',
    })

    await client.fetchQuery(trainingStatusCountsQueryOptions({}))

    expect(apiMocks.getAllOperators).not.toHaveBeenCalled()
    expect(apiMocks.getOperBoxData).not.toHaveBeenCalled()
  })

  it('builds all three counts from the endpoint and shared snapshots', async () => {
    apiMocks.getOperatorList.mockImplementation(async (filters: { status?: string }) => {
      if (filters.status === 'trainable') {
        return {
          success: true,
          data: { operators: [operatorRow('char_a'), operatorRow('char_b')] },
        }
      }
      return { success: true, data: { operators: [operatorRow('char_a')] } }
    })
    apiMocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [
        { id: 'char_a', name: 'A', rarity: 6, profession: 'SNIPER', level: 0, elite: 0, potential: 0 },
        { id: 'char_b', name: 'B', rarity: 6, profession: 'SNIPER', level: 0, elite: 0, potential: 0 },
        { id: 'char_c', name: 'C', rarity: 5, profession: 'SNIPER', level: 0, elite: 0, potential: 0 },
      ],
    })
    apiMocks.getOperBoxData.mockResolvedValue({ success: true, data: { data: [] } })

    const counts = await createQueryClient().fetchQuery(
      trainingStatusCountsQueryOptions({ rarity: 6, needsElite2: true }),
    )

    expect(counts).toEqual({ trainable: 2, owned: 1, all: 2 })
    expect(apiMocks.getOperatorList.mock.calls.map(call => call[0])).toEqual([
      { status: 'trainable', rarity: 6, needsElite2: true },
      { status: 'owned', rarity: 6, needsElite2: true },
    ])
  })

  it('keeps the previous all count when a real refetch returns an empty catalogue', async () => {
    apiMocks.getOperatorList.mockResolvedValue({ success: true, data: { operators: [] } })
    apiMocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [
        { id: 'char_a', name: 'A', rarity: 6, profession: 'SNIPER', level: 0, elite: 0, potential: 0 },
        { id: 'char_b', name: 'B', rarity: 6, profession: 'SNIPER', level: 0, elite: 0, potential: 0 },
      ],
    })
    apiMocks.getOperBoxData.mockResolvedValue({ success: true, data: { data: [] } })

    const client = createQueryClient()
    const options = trainingStatusCountsQueryOptions({})
    expect(await client.fetchQuery(options)).toEqual({ trainable: 0, owned: 0, all: 2 })

    apiMocks.getAllOperators.mockResolvedValue({ success: true, data: [] })
    await client.fetchQuery({ ...options, staleTime: 0 })

    // `fetchQuery` 返回本次原始结果；观察者读到的是 structuralSharing 合并后的缓存值。
    expect(client.getQueryData(options.queryKey)).toEqual({ trainable: 0, owned: 0, all: 2 })
  })
})
