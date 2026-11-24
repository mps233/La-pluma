import { keepPreviousData, queryOptions, type QueryClient } from '@tanstack/react-query'
import { unwrapApiResponse } from '@/shared/api'
import {
  operBoxQueryOptions,
  operatorCatalogWithSourceQueryOptions,
  type OperatorDetailed,
} from '@/features/game-data'
import { getOperatorList, getTrainingQueue } from '../api'
import type {
  OperatorRecognitionSummary,
  TrainingOperator,
  TrainingQueueSnapshot,
  TrainingStatusCounts,
} from '../types'
import {
  buildAllCandidateRows,
  extractOperatorRecognition,
  extractOperatorRows,
  type TrainingCandidateFilters,
} from './candidates'
import { trainingKeys } from './queryKeys'
import { buildTrainingStatusCounts, mergeTrainingStatusCounts } from './statusCounts'

export interface TrainingStatusCountsFilters {
  rarity?: number | null
  needsElite2?: boolean
}

/**
 * 养成队列的唯一读取入口。
 *
 * 页面与 Dashboard 不再各自保存队列副本；写成功后由领域命令把权威快照写入
 * 同一 key。失败转换为 Query 错误，取消保持 `AbortError`。
 */
export const trainingQueueQueryOptions = () => queryOptions({
  queryKey: trainingKeys.resource('queue'),
  queryFn: async ({ signal }): Promise<TrainingQueueSnapshot> => (
    unwrapApiResponse<TrainingQueueSnapshot>(await getTrainingQueue(signal))
  ),
})

const toOperatorListFilters = (filters: TrainingCandidateFilters) => ({
  status: filters.status,
  rarity: filters.rarity ?? undefined,
  needsElite2: filters.needsElite2 ?? false,
})

/** 候选行与同一端点返回的识别概要；概要不受筛选条件影响。 */
export interface TrainingCandidatePage {
  operators: TrainingOperator[]
  recognition: OperatorRecognitionSummary | null
}

const readCandidatePage = async (
  filters: TrainingCandidateFilters,
  signal: AbortSignal,
): Promise<TrainingCandidatePage> => {
  const response = await getOperatorList(toOperatorListFilters(filters), signal)
  const payload = unwrapApiResponse(response)
  return {
    operators: extractOperatorRows(payload),
    recognition: extractOperatorRecognition(payload),
  }
}

const readCandidateRows = async (
  filters: TrainingCandidateFilters,
  signal: AbortSignal,
): Promise<TrainingOperator[]> => (await readCandidatePage(filters, signal)).operators

/**
 * 目录与持有干员属于 `game-data` 的共享只读资源。这里通过 QueryClient 的
 * `fetchQuery` 复用同一 key，缓存新鲜时不会重复下载大载荷，也避免与统计页
 * 各自维护一份同义快照。
 */
const readOperatorCatalog = async (
  client: QueryClient,
  signal: AbortSignal,
): Promise<OperatorDetailed[]> => {
  const options = operatorCatalogWithSourceQueryOptions()
  const catalog = await client.fetchQuery({
    ...options,
    // fetchQuery 没有外置 signal 参数；把调用方 signal 交给共享 queryFn，
    // 训练请求取消时同时中止底层目录读取。
    queryFn: context => options.queryFn!({ ...context, signal }),
  })
  return catalog.operators
}

const readOperBoxRows = async (
  client: QueryClient,
  signal: AbortSignal,
): Promise<OperatorDetailed[]> => {
  const options = operBoxQueryOptions()
  const operBox = await client.fetchQuery({
    ...options,
    queryFn: context => options.queryFn!({ ...context, signal }),
  })
  return operBox?.data ?? []
}

/**
 * 候选列表按状态、稀有度与“未精二”条件区分缓存身份；识别概要沿用同一份
 * 端点载荷，不参与缓存身份。`status=all` 且端点返回空列表时沿用旧兼容补齐。
 */
export const trainingCandidatesQueryOptions = (filters: TrainingCandidateFilters) => queryOptions({
  queryKey: trainingKeys.query(
    'candidates',
    filters.status,
    filters.rarity ?? null,
    filters.needsElite2 ?? false,
  ),
  queryFn: async ({ client, signal }): Promise<TrainingCandidatePage> => {
    const page = await readCandidatePage(filters, signal)
    if (filters.status !== 'all' || page.operators.length > 0) return page

    const [catalog, ownedOperators] = await Promise.all([
      readOperatorCatalog(client, signal),
      readOperBoxRows(client, signal),
    ])
    return {
      operators: buildAllCandidateRows(catalog, ownedOperators, filters.rarity ?? null),
      recognition: page.recognition,
    }
  },
})

/**
 * 三种状态计数使用固定筛选（稀有度、未精二），与当前列表状态无关。
 * 同 key 刷新失败时 Query 保留上次数据；`all` 为 0 时由 structuralSharing
 * 保留旧值，避免目录暂不可用时把“全部”显示成 0。
 */
export const trainingStatusCountsQueryOptions = (
  filters: TrainingStatusCountsFilters,
) => queryOptions({
  queryKey: trainingKeys.query('counts', filters.rarity ?? null, filters.needsElite2 ?? false),
  queryFn: async ({ client, signal }): Promise<TrainingStatusCounts> => {
    const [trainableRows, ownedRows, catalog, operBoxRows] = await Promise.all([
      readCandidateRows({ status: 'trainable', ...filters }, signal),
      readCandidateRows({ status: 'owned', ...filters }, signal),
      readOperatorCatalog(client, signal),
      readOperBoxRows(client, signal),
    ])

    return buildTrainingStatusCounts({
      trainableRows,
      ownedRows,
      catalog,
      operBoxRows,
      filters,
    })
  },
  placeholderData: keepPreviousData,
  structuralSharing: (previous, next) => mergeTrainingStatusCounts(
    previous as TrainingStatusCounts | undefined,
    next as TrainingStatusCounts,
  ),
})
