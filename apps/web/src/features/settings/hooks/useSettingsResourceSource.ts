import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  resourceSourceQueryOptions,
  settingsResourceSourceOwner,
  type ResourceSourceOwner,
  type ResourceSourceSaveOutcome,
  type ResourceSourceState,
} from '../model/resourceSource'
import type { ResourceSourceDraft } from '../types'

export interface UseSettingsResourceSourceResult extends ResourceSourceState {
  /** 初始读取失败的错误；已有服务端数据或草稿时不再报告后台刷新失败。 */
  readonly loadError: string | null
  readonly update: (patch: Partial<ResourceSourceDraft>) => void
  readonly getState: () => ResourceSourceState
  readonly save: () => Promise<ResourceSourceSaveOutcome>
  /** 初始读取失败后的显式重试入口。 */
  readonly reload: () => void
}

const describeLoadError = (error: unknown): string => (
  error instanceof Error && error.message ? error.message : '资源源配置读取失败，请稍后重试'
)

export function useSettingsResourceSource(
  owner: ResourceSourceOwner = settingsResourceSourceOwner,
): UseSettingsResourceSourceResult {
  const options = useMemo(() => resourceSourceQueryOptions(owner), [owner])
  const query = useQuery(options)
  const { refetch } = query
  const queryClient = useQueryClient()
  const state = useSyncExternalStore(owner.subscribe, owner.getState, owner.getState)

  useEffect(() => {
    if (query.data) owner.adoptServer(query.data)
  }, [owner, query.data])

  const update = useCallback((patch: Partial<ResourceSourceDraft>) => {
    owner.update(patch)
  }, [owner])

  const save = useCallback(async () => {
    const outcome = await owner.save()
    if (outcome.status === 'saved' && !outcome.superseded) {
      // 保存成功后重新读取：服务端会归一化默认值并只回传凭据形态。
      await queryClient.refetchQueries({ queryKey: options.queryKey })
    }
    return outcome
  }, [options.queryKey, owner, queryClient])

  const reload = useCallback(() => {
    void refetch()
  }, [refetch])

  const loadError = query.isError && !query.data && !state.loaded
    ? describeLoadError(query.error)
    : null

  return {
    ...state,
    loadError,
    update,
    getState: owner.getState,
    save,
    reload,
  }
}
