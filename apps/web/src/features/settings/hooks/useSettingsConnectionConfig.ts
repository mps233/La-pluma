import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  connectionConfigQueryOptions,
  settingsConnectionOwner,
  type ConnectionConfigOwner,
  type ConnectionConfigSaveOutcome,
  type ConnectionConfigState,
} from '../model/connectionConfig'
import type { MaaConnectionConfig } from '../types'

export interface UseSettingsConnectionConfigResult extends ConnectionConfigState {
  /** 初始读取失败的错误；已有服务端数据或草稿时不再报告后台刷新失败。 */
  readonly loadError: string | null
  readonly update: (patch: Partial<MaaConnectionConfig>) => void
  readonly getState: () => ConnectionConfigState
  readonly save: () => Promise<ConnectionConfigSaveOutcome>
  /** 初始读取失败后的显式重试入口。 */
  readonly reload: () => void
}

const describeLoadError = (error: unknown): string => (
  error instanceof Error && error.message ? error.message : '连接配置读取失败，请稍后重试'
)

export function useSettingsConnectionConfig(
  owner: ConnectionConfigOwner = settingsConnectionOwner,
  profileName = 'default',
): UseSettingsConnectionConfigResult {
  const options = useMemo(
    () => connectionConfigQueryOptions(profileName, owner),
    [owner, profileName],
  )
  const query = useQuery(options)
  const { refetch } = query
  const state = useSyncExternalStore(owner.subscribe, owner.getState, owner.getState)

  useEffect(() => {
    if (query.data) owner.adoptServer(query.data)
  }, [owner, query.data])

  const update = useCallback((patch: Partial<MaaConnectionConfig>) => {
    owner.update(patch)
  }, [owner])

  const save = useCallback(() => owner.save(), [owner])

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
