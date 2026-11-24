// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { ApiRequestError } from '@/shared/api'
import { createQueryClient } from '@/shared/query'
import { GAME_DATA_DOMAIN, gameDataKeys } from './queryKeys'
import {
  depotQueryOptions,
  operBoxQueryOptions,
  operatorCatalogQueryOptions,
  operatorCatalogWithSourceQueryOptions,
} from './queries'

const apiMocks = vi.hoisted(() => ({
  getAllOperators: vi.fn(),
  getDepotData: vi.fn(),
  getOperBoxData: vi.fn(),
}))

vi.mock('../api', () => apiMocks)

describe('game data query options', () => {
  beforeEach(() => {
    apiMocks.getAllOperators.mockReset()
    apiMocks.getDepotData.mockReset()
    apiMocks.getOperBoxData.mockReset()
  })

  it('keeps the game-data domain as the invalidation scope', () => {
    expect(GAME_DATA_DOMAIN).toBe('game-data')
    expect(gameDataKeys.all).toEqual(['game-data'])
  })

  it('uses one cache identity per shared resource in the game-data domain', () => {
    expect(depotQueryOptions().queryKey).toEqual(gameDataKeys.resource('depot'))
    expect(operBoxQueryOptions().queryKey).toEqual(gameDataKeys.resource('operbox'))
    expect(operatorCatalogQueryOptions().queryKey).toEqual(gameDataKeys.resource('catalog'))
  })

  it('keeps the empty depot snapshot', async () => {
    apiMocks.getDepotData.mockResolvedValue({ success: true, data: null })

    const data = await createQueryClient().fetchQuery(depotQueryOptions())

    expect(data).toBeNull()
    expect(apiMocks.getDepotData).toHaveBeenCalledOnce()
  })

  it('normalizes a depot snapshot without an items array', async () => {
    apiMocks.getDepotData.mockResolvedValue({
      success: true,
      data: { itemCount: 2, timestamp: '2026-10-25T00:00:00.000Z' },
    })

    const data = await createQueryClient().fetchQuery(depotQueryOptions())

    expect(data).toEqual({ itemCount: 2, timestamp: '2026-10-25T00:00:00.000Z', items: [] })
  })

  it('keeps an empty operbox snapshot and normalizes a missing data list', async () => {
    apiMocks.getOperBoxData
      .mockResolvedValueOnce({ success: true, data: null })
      .mockResolvedValueOnce({
        success: true,
        data: { operCount: 1, timestamp: '2026-10-25T00:00:00.000Z' },
      })

    const empty = await createQueryClient().fetchQuery(operBoxQueryOptions())
    const normalized = await createQueryClient().fetchQuery(operBoxQueryOptions())

    expect(empty).toBeNull()
    expect(normalized).toEqual({
      operCount: 1,
      timestamp: '2026-10-25T00:00:00.000Z',
      data: [],
    })
  })

  it('falls back to the operbox snapshot catalogue when the catalog read fails', async () => {
    apiMocks.getAllOperators.mockResolvedValue({ success: false, message: '目录读取失败' })
    apiMocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 1,
        data: [],
        allOpers: [
          { id: 'char_002_amiya', name: '阿米娅', rarity: 5, owned: true },
          { id: 'char_010_chen', name: '陈', owned: false },
        ],
        timestamp: '2026-10-25T00:00:00.000Z',
      },
    })

    const data = await createQueryClient().fetchQuery(operatorCatalogWithSourceQueryOptions())

    expect(data).toEqual({
      operators: [
        { id: 'char_002_amiya', name: '阿米娅', rarity: 5, profession: '', level: 0, elite: 0, potential: 0 },
        { id: 'char_010_chen', name: '陈', rarity: 0, profession: '', level: 0, elite: 0, potential: 0 },
      ],
      source: 'snapshot',
    })
    expect(apiMocks.getAllOperators).toHaveBeenCalledOnce()
    expect(apiMocks.getOperBoxData).toHaveBeenCalledOnce()
  })

  it('falls back to the operbox snapshot catalogue when the catalog is empty', async () => {
    apiMocks.getAllOperators.mockResolvedValue({ success: true, data: [] })
    apiMocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 1,
        data: [],
        allOpers: [{ id: 'char_002_amiya', name: '阿米娅', rarity: 5, owned: true }],
        timestamp: '2026-10-25T00:00:00.000Z',
      },
    })

    const data = await createQueryClient().fetchQuery(operatorCatalogWithSourceQueryOptions())

    expect(data).toEqual({
      operators: [
        { id: 'char_002_amiya', name: '阿米娅', rarity: 5, profession: '', level: 0, elite: 0, potential: 0 },
      ],
      source: 'snapshot',
    })
  })

  it('keeps the remote catalog and skips the snapshot when the catalog read succeeds', async () => {
    apiMocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [{ id: 'char_002_amiya', name: '阿米娅', rarity: 5, profession: 'CASTER', level: 70, elite: 1, potential: 1 }],
    })

    const data = await createQueryClient().fetchQuery(operatorCatalogWithSourceQueryOptions())

    expect(data).toEqual({
      operators: [
        { id: 'char_002_amiya', name: '阿米娅', rarity: 5, profession: 'CASTER', level: 70, elite: 1, potential: 1 },
      ],
      source: 'remote',
    })
    expect(apiMocks.getOperBoxData).not.toHaveBeenCalled()
  })

  it('reuses a fresh operbox snapshot from the cache for the fallback', async () => {
    apiMocks.getAllOperators.mockResolvedValue({ success: true, data: [] })
    const client = createQueryClient()
    client.setQueryData(gameDataKeys.resource('operbox'), {
      operCount: 1,
      data: [],
      allOpers: [{ id: 'char_010_chen', name: '陈', rarity: 6, owned: false }],
      timestamp: '2026-10-25T00:00:00.000Z',
    })

    const data = await client.fetchQuery(operatorCatalogWithSourceQueryOptions())

    expect(data).toEqual({
      operators: [
        { id: 'char_010_chen', name: '陈', rarity: 6, profession: '', level: 0, elite: 0, potential: 0 },
      ],
      source: 'snapshot',
    })
    expect(apiMocks.getOperBoxData).not.toHaveBeenCalled()
  })

  it('uses a stale cached operbox snapshot for the fallback without re-reading it', async () => {
    apiMocks.getAllOperators.mockResolvedValue({ success: false, message: '目录读取失败' })
    const client = createQueryClient()
    client.setQueryData(
      gameDataKeys.resource('operbox'),
      {
        operCount: 1,
        data: [],
        allOpers: [{ id: 'char_010_chen', name: '陈', rarity: 6, owned: false }],
        timestamp: '2026-10-25T00:00:00.000Z',
      },
      { updatedAt: Date.now() - 5 * 60_000 },
    )

    const data = await client.fetchQuery(operatorCatalogWithSourceQueryOptions())

    expect(data).toEqual({
      operators: [
        { id: 'char_010_chen', name: '陈', rarity: 6, profession: '', level: 0, elite: 0, potential: 0 },
      ],
      source: 'snapshot',
    })
    expect(apiMocks.getOperBoxData).not.toHaveBeenCalled()
  })

  it('does not multiply operbox reads when both endpoints fail', async () => {
    const networkFailure = () => new ApiRequestError({
      kind: 'transport',
      code: 'NETWORK_ERROR',
      message: '无法连接后端服务',
      retryable: true,
    })
    apiMocks.getAllOperators.mockRejectedValue(networkFailure())
    apiMocks.getOperBoxData.mockRejectedValue(networkFailure())
    const client = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0 } } })

    const error = await client
      .fetchQuery(operatorCatalogWithSourceQueryOptions())
      .catch(cause => cause)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect(apiMocks.getAllOperators).toHaveBeenCalledTimes(3)
    expect(apiMocks.getOperBoxData).toHaveBeenCalledTimes(3)
  })

  it('keeps the catalog read failure when the snapshot fallback is unavailable', async () => {
    apiMocks.getAllOperators.mockResolvedValue({ success: false, message: '目录读取失败' })
    apiMocks.getOperBoxData.mockResolvedValue({ success: false, message: '识别快照读取失败' })

    const error = await createQueryClient()
      .fetchQuery(operatorCatalogWithSourceQueryOptions())
      .catch(cause => cause)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error.message).toBe('目录读取失败')
  })

  it('keeps the catalog read failure when the snapshot has no catalogue entries', async () => {
    apiMocks.getAllOperators.mockResolvedValue({ success: false, message: '目录读取失败' })
    apiMocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: { operCount: 0, data: [], timestamp: '2026-10-25T00:00:00.000Z' },
    })

    const error = await createQueryClient()
      .fetchQuery(operatorCatalogWithSourceQueryOptions())
      .catch(cause => cause)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error.message).toBe('目录读取失败')
  })

  it('treats a cached snapshot without catalogue entries as unavailable', async () => {
    apiMocks.getAllOperators.mockResolvedValue({ success: false, message: '目录读取失败' })
    const client = createQueryClient()
    client.setQueryData(gameDataKeys.resource('operbox'), {
      operCount: 0,
      data: [],
      allOpers: [],
      timestamp: '2026-10-25T00:00:00.000Z',
    })

    const error = await client
      .fetchQuery(operatorCatalogWithSourceQueryOptions())
      .catch(cause => cause)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error.message).toBe('目录读取失败')
    expect(apiMocks.getOperBoxData).not.toHaveBeenCalled()
  })

  it('keeps an empty snapshot-sourced catalog when the remote catalog is empty and the snapshot read fails', async () => {
    apiMocks.getAllOperators.mockResolvedValue({ success: true, data: [] })
    apiMocks.getOperBoxData.mockResolvedValue({ success: false, message: '识别快照读取失败' })

    const data = await createQueryClient().fetchQuery(operatorCatalogWithSourceQueryOptions())

    expect(data).toEqual({ operators: [], source: 'snapshot' })
  })

  it('normalizes a catalog that is not an array to an empty list', async () => {
    apiMocks.getAllOperators.mockResolvedValue({ success: true, data: undefined })
    apiMocks.getOperBoxData.mockResolvedValue({ success: true, data: null })

    const data = await createQueryClient().fetchQuery(operatorCatalogWithSourceQueryOptions())

    expect(data).toEqual({ operators: [], source: 'snapshot' })
  })

  it('serves the snapshot fallback to catalog observers', async () => {
    apiMocks.getAllOperators.mockResolvedValue({ success: false, message: '目录读取失败' })
    const client = createQueryClient()
    client.setQueryData(gameDataKeys.resource('operbox'), {
      operCount: 1,
      data: [],
      allOpers: [{ id: 'char_010_chen', name: '陈', rarity: 6, owned: false }],
      timestamp: '2026-10-25T00:00:00.000Z',
    })
    const observer = new QueryObserver(client, operatorCatalogQueryOptions())
    const unsubscribe = observer.subscribe(() => {})

    const result = await observer.refetch()
    unsubscribe()

    expect(result.data).toEqual([
      { id: 'char_010_chen', name: '陈', rarity: 6, profession: '', level: 0, elite: 0, potential: 0 },
    ])
    expect(result.isError).toBe(false)
  })

  it('propagates an aborted catalog read without reading the snapshot', async () => {
    apiMocks.getAllOperators.mockRejectedValue(new DOMException('请求已取消', 'AbortError'))

    const error = await createQueryClient()
      .fetchQuery(operatorCatalogWithSourceQueryOptions())
      .catch(cause => cause)

    expect(error).toMatchObject({ name: 'AbortError' })
    expect(apiMocks.getOperBoxData).not.toHaveBeenCalled()
  })

  it('rejects with an abort error before reading the snapshot when the caller already aborted', async () => {
    apiMocks.getAllOperators.mockResolvedValue({ success: true, data: [] })
    apiMocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 1,
        data: [],
        allOpers: [{ id: 'char_010_chen', name: '陈', rarity: 6, owned: false }],
        timestamp: '2026-10-25T00:00:00.000Z',
      },
    })
    const controller = new AbortController()
    controller.abort()
    const options = operatorCatalogWithSourceQueryOptions()

    const error = await Promise.resolve<unknown>(options.queryFn!({
      client: createQueryClient(),
      queryKey: options.queryKey,
      signal: controller.signal,
      meta: undefined,
    })).catch(cause => cause)

    expect(error).toMatchObject({ name: 'AbortError' })
    expect(apiMocks.getOperBoxData).not.toHaveBeenCalled()
  })
})
