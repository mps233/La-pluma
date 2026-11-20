// 作业搜索分两类 Query：默认请求在挂载时预取并按 5 分钟新鲜度复用，显式搜索使用
// `staleTime: 0` 且每次重新读取。显式搜索返回的 outcome 带请求代次，被取消或被新
// 搜索取代的 Promise 返回 `cancelled`；Activity 隐藏/卸载只取消在途显式搜索、不自动
// 重放，默认缓存与已成功结果保留。`reset` 只清显式检索状态，不删除默认查询缓存。

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isCancelledError,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { ApiRequestError, isAbortError, type ApiFailureKind } from '@/shared/api'
import type { CopilotSearchResult, ParadoxSearchResult } from '../types'
import type { CopilotSearchRequest } from '../model/copilotDiscovery'
import {
  copilotSearchQueryOptions,
  paradoxSearchQueryOptions,
} from '../model/queries'

export type CopilotSearchOutcome<T> =
  | { readonly status: 'success'; readonly result: T }
  | {
      readonly status: 'failed'
      readonly message: string
      readonly kind: ApiFailureKind | 'unknown'
      readonly code: string
      readonly details?: unknown
    }
  | { readonly status: 'cancelled' }

export interface UseCopilotSearchResult<TInput, TResult> {
  readonly result: TResult | null
  /** 显式搜索是否在途；默认查询的后台刷新不计入。 */
  readonly searching: boolean
  /** 默认查询是否在读取；仅用于无缓存首次加载的占位。 */
  readonly refreshing: boolean
  /** 最近一次显式搜索或默认列表读取的可读失败原因；取消、重置与成功读取后清空。 */
  readonly error: string | null
  /** 提交一次搜索；返回本次代次是否仍当前以及成功/失败结论。 */
  readonly search: (input: TInput) => Promise<CopilotSearchOutcome<TResult>>
  /** 读取指定页但不推进代次、不改当前结果；失败返回 null。 */
  readonly loadMore: (input: TInput) => Promise<TResult | null>
  /** 更新默认请求并在后台刷新；失败设置错误并保留旧缓存。 */
  readonly refreshDefault: (next: TInput) => void
  /** 重跑最后一次显式搜索；没有显式搜索时重试当前默认列表。 */
  readonly retry: () => void
  /** 取消在途显式搜索；保留默认查询与上次成功结果。 */
  readonly cancel: () => void
  /** 清空显式检索状态；保留默认查询缓存。 */
  readonly reset: () => void
}

interface CombatSearchSpec<TInput> {
  readonly placeholder: TInput
  readonly toOptions: (input: TInput) => Record<string, unknown>
  readonly initialDefaultRequest?: TInput
}

const DEFAULT_STALE_TIME_MS = 5 * 60_000

interface CombatSearchFailure {
  readonly source: 'explicit' | 'default'
  readonly message: string
}

const isSearchCancellation = (error: unknown): boolean => (
  isAbortError(error) || isCancelledError(error)
)

function describeSearchFailure(
  error: unknown,
): { message: string; kind: ApiFailureKind | 'unknown'; code: string; details?: unknown } {
  if (error instanceof ApiRequestError) {
    return {
      message: error.message,
      kind: error.kind,
      code: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
    }
  }
  if (error instanceof Error && error.message) return { message: error.message, kind: 'unknown', code: 'UNKNOWN' }
  return { message: '搜索失败', kind: 'unknown', code: 'UNKNOWN' }
}

function useCombatSearch<TInput, TResult>(
  spec: CombatSearchSpec<TInput>,
): UseCopilotSearchResult<TInput, TResult> {
  const { placeholder, toOptions, initialDefaultRequest } = spec
  const client = useQueryClient()
  const [input, setInput] = useState<TInput | null>(null)
  const [defaultRequest, setDefaultRequest] = useState<TInput | null>(initialDefaultRequest ?? null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<CombatSearchFailure | null>(null)
  const generation = useRef(0)
  const explicitEpoch = useRef(0)
  const defaultFlight = useRef(0)
  const defaultEpoch = useRef(0)
  const explicitKey = useRef<readonly unknown[] | null>(null)

  const defaultQuery = useQuery({
    ...toOptions(defaultRequest ?? placeholder),
    enabled: initialDefaultRequest !== undefined,
    staleTime: DEFAULT_STALE_TIME_MS,
  } as never) as UseQueryResult<TResult>

  const query = useQuery({
    ...toOptions(input ?? defaultRequest ?? placeholder),
    enabled: input !== null,
  } as never) as UseQueryResult<TResult>

  useEffect(() => {
    if (!defaultQuery.isError || isSearchCancellation(defaultQuery.error)) return
    if (defaultEpoch.current !== explicitEpoch.current) return
    const { message } = describeSearchFailure(defaultQuery.error)
    setFailure(current => (
      current?.source === 'explicit' ? current : { source: 'default', message }
    ))
  }, [defaultQuery.error, defaultQuery.isError])

  useEffect(() => {
    if (!defaultQuery.isSuccess) return
    setFailure(current => (current?.source === 'default' ? null : current))
  }, [defaultQuery.isSuccess])

  const cancel = useCallback(() => {
    generation.current += 1
    explicitEpoch.current += 1
    defaultFlight.current += 1
    setPending(false)
    setFailure(current => (current?.source === 'explicit' ? null : current))
    if (explicitKey.current) {
      void client.cancelQueries({ queryKey: explicitKey.current, exact: true })
    }
  }, [client])

  const reset = useCallback(() => {
    generation.current += 1
    explicitEpoch.current += 1
    defaultFlight.current += 1
    setPending(false)
    setFailure(null)
    setInput(null)
    if (explicitKey.current) {
      void client.cancelQueries({ queryKey: explicitKey.current, exact: true })
      explicitKey.current = null
    }
  }, [client])

  // Activity 隐藏与真正卸载都会走清理；只取消显式搜索，不打断默认预取。
  useEffect(() => cancel, [cancel])

  const loadDefault = useCallback((next: TInput) => {
    const requestId = ++defaultFlight.current
    defaultEpoch.current = explicitEpoch.current
    setDefaultRequest(next)
    setFailure(current => (current?.source === 'default' ? null : current))
    void client.fetchQuery({
      ...toOptions(next),
      staleTime: 0,
    } as never).then(
      () => {
        if (defaultFlight.current !== requestId) return
        setFailure(current => (current?.source === 'default' ? null : current))
      },
      (error: unknown) => {
        if (defaultFlight.current !== requestId || isSearchCancellation(error)) return
        if (defaultEpoch.current !== explicitEpoch.current) return
        const { message } = describeSearchFailure(error)
        setFailure(current => (
          current?.source === 'explicit' ? current : { source: 'default', message }
        ))
      },
    )
  }, [client, toOptions])

  const search = useCallback(async (next: TInput): Promise<CopilotSearchOutcome<TResult>> => {
    const requestId = ++generation.current
    explicitEpoch.current += 1
    const options = toOptions(next) as { queryKey: readonly unknown[] }
    explicitKey.current = options.queryKey
    setInput(next)
    setPending(true)
    setFailure(null)
    try {
      // 显式搜索总是重新读取；被取消或取代的 Promise 由代次裁决。
      const result = await client.fetchQuery({
        ...options,
        staleTime: 0,
      } as never) as TResult
      if (generation.current !== requestId) return { status: 'cancelled' }
      explicitEpoch.current += 1
      setFailure(null)
      return { status: 'success', result }
    } catch (error) {
      if (generation.current !== requestId || isSearchCancellation(error)) {
        return { status: 'cancelled' }
      }
      const failure = describeSearchFailure(error)
      setFailure({ source: 'explicit', message: failure.message })
      return { status: 'failed', ...failure }
    } finally {
      if (generation.current === requestId) setPending(false)
    }
  }, [client, toOptions])

  const loadMore = useCallback(async (next: TInput): Promise<TResult | null> => {
    try {
      return await client.fetchQuery({
        ...toOptions(next),
        staleTime: 0,
      } as never) as TResult
    } catch {
      return null
    }
  }, [client, toOptions])

  const retry = useCallback(() => {
    if (input !== null) {
      void search(input)
      return
    }
    if (defaultRequest === null) return
    loadDefault(defaultRequest)
  }, [defaultRequest, input, loadDefault, search])

  return {
    result: query.data ?? defaultQuery.data ?? null,
    searching: pending,
    refreshing: defaultQuery.isFetching,
    error: failure?.message ?? null,
    search,
    loadMore,
    refreshDefault: loadDefault,
    retry,
    cancel,
    reset,
  }
}

export function useCopilotSearch(
  initialDefaultRequest: CopilotSearchRequest,
): UseCopilotSearchResult<CopilotSearchRequest, CopilotSearchResult> {
  return useCombatSearch<CopilotSearchRequest, CopilotSearchResult>({
    placeholder: initialDefaultRequest,
    toOptions: copilotSearchQueryOptions,
    initialDefaultRequest,
  })
}

export function useParadoxSearch(): UseCopilotSearchResult<string, ParadoxSearchResult> {
  const searchRun = useCombatSearch<string, ParadoxSearchResult>({
    placeholder: '',
    toOptions: paradoxSearchQueryOptions,
  })
  const { search } = searchRun
  const searchByOperator = useCallback(
    async (name: string): Promise<CopilotSearchOutcome<ParadoxSearchResult>> => {
      const trimmed = name.trim()
      if (!trimmed) return { status: 'cancelled' }
      return search(trimmed)
    },
    [search],
  )
  return { ...searchRun, search: searchByOperator }
}
