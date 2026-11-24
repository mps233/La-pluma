import { queryOptions, type QueryClient, type QueryFunctionContext } from '@tanstack/react-query'
import { isAbortError, unwrapApiResponse } from '@/shared/api'
import { getAllOperators, getDepotData, getOperBoxData } from '../api'
import type { DepotDataDetailed, OperBoxCatalogOperator, OperBoxData, OperatorDetailed } from '../types'
import { gameDataKeys } from './queryKeys'

/**
 * 仓库快照：旧服务端可能返回 `data: null`（尚无识别结果），保留 null 交给页面
 * 展示空状态；缺失的 `items` 归一为空数组，其余字段保持原样。
 */
export const depotQueryOptions = () => queryOptions({
  queryKey: gameDataKeys.resource('depot'),
  queryFn: async ({ signal }): Promise<DepotDataDetailed | null> => {
    const data = unwrapApiResponse<DepotDataDetailed | null>(await getDepotData(signal))
    return data ? { ...data, items: data.items ?? [] } : null
  },
})

/** 持有干员快照：空结果保留 null；缺失的 `data` 归一为空数组。 */
export const operBoxQueryOptions = () => queryOptions({
  queryKey: gameDataKeys.resource('operbox'),
  queryFn: async ({ signal }): Promise<OperBoxData | null> => {
    const data = unwrapApiResponse<OperBoxData | null>(await getOperBoxData(signal))
    return data ? { ...data, data: data.data ?? [] } : null
  },
})

export type OperatorCatalogSource = 'remote' | 'snapshot'

export interface OperatorCatalogWithSource {
  operators: OperatorDetailed[]
  source: OperatorCatalogSource
}

const toSnapshotCatalogOperator = (entry: OperBoxCatalogOperator): OperatorDetailed => ({
  id: entry.id,
  name: entry.name,
  rarity: entry.rarity ?? 0,
  profession: '',
  level: 0,
  elite: 0,
  potential: 0,
})

type RemoteCatalogRead =
  | { status: 'loaded'; operators: OperatorDetailed[] }
  | { status: 'failed'; failure: unknown }

const readRemoteOperatorCatalog = async (signal: AbortSignal): Promise<RemoteCatalogRead> => {
  try {
    const data = unwrapApiResponse<OperatorDetailed[]>(await getAllOperators(signal))
    return { status: 'loaded', operators: Array.isArray(data) ? data : [] }
  } catch (error) {
    if (isAbortError(error)) throw error
    return { status: 'failed', failure: error }
  }
}

const readSnapshotOperatorCatalog = async (
  client: QueryClient,
  signal: AbortSignal,
): Promise<OperatorDetailed[]> => {
  signal.throwIfAborted()
  // 兜底读缓存：旧快照也优于无数据，且共享请求不随 catalog 取消，避免跨域污染。
  const cached = client.getQueryData(operBoxQueryOptions().queryKey)
  if (cached !== undefined) {
    return (cached?.allOpers ?? []).map(toSnapshotCatalogOperator)
  }

  const operBox = await client.fetchQuery({ ...operBoxQueryOptions(), retry: false })
  signal.throwIfAborted()
  return (operBox?.allOpers ?? []).map(toSnapshotCatalogOperator)
}

const readSnapshotOperatorCatalogQuietly = async (
  client: QueryClient,
  signal: AbortSignal,
): Promise<OperatorDetailed[]> => {
  try {
    return await readSnapshotOperatorCatalog(client, signal)
  } catch (error) {
    if (isAbortError(error)) throw error
    return []
  }
}

const resolveOperatorCatalog = async ({
  client,
  signal,
}: QueryFunctionContext): Promise<OperatorCatalogWithSource> => {
  const remote = await readRemoteOperatorCatalog(signal)
  if (remote.status === 'loaded' && remote.operators.length > 0) {
    return { operators: remote.operators, source: 'remote' }
  }
  const remoteFailure = remote.status === 'failed' ? remote.failure : null

  const snapshotOperators = await readSnapshotOperatorCatalogQuietly(client, signal)
  if (snapshotOperators.length === 0 && remoteFailure !== null) {
    throw remoteFailure
  }
  return { operators: snapshotOperators, source: 'snapshot' }
}

export const operatorCatalogWithSourceQueryOptions = () => queryOptions({
  queryKey: gameDataKeys.resource('catalog'),
  queryFn: resolveOperatorCatalog,
})

// 仅供 useQuery 观察者使用：select 只在观察者层生效，fetchQuery 请改用 withSource 入口。
export const operatorCatalogQueryOptions = () => queryOptions({
  queryKey: gameDataKeys.resource('catalog'),
  queryFn: resolveOperatorCatalog,
  select: catalog => catalog.operators,
})
