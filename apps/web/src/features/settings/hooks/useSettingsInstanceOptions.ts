import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  instanceOptionsQueryOptions,
  settingsInstanceOptionsOwner,
  type InstanceOptionsOwner,
  type InstanceOptionsSaveOutcome,
  type InstanceOptionsState,
} from '../model/instanceOptions'
import type { MaaInstanceOptions } from '../types'

export interface UseSettingsInstanceOptionsResult extends InstanceOptionsState {
  /** 初始读取失败的错误；已有服务端数据或草稿时不再报告后台刷新失败。 */
  readonly loadError: string | null
  readonly update: (patch: Partial<MaaInstanceOptions>) => void
  readonly getState: () => InstanceOptionsState
  readonly save: () => Promise<InstanceOptionsSaveOutcome>
  /** 初始读取失败后的显式重试入口。 */
  readonly reload: () => void
}

const describeLoadError = (error: unknown): string => (
  error instanceof Error && error.message ? error.message : '实例选项读取失败，请稍后重试'
)

export function useSettingsInstanceOptions(
  owner: InstanceOptionsOwner = settingsInstanceOptionsOwner,
  profileName = 'default',
): UseSettingsInstanceOptionsResult {
  const options = useMemo(
    () => instanceOptionsQueryOptions(profileName, owner),
    [owner, profileName],
  )
  const query = useQuery(options)
  const { refetch } = query
  const state = useSyncExternalStore(owner.subscribe, owner.getState, owner.getState)

  useEffect(() => {
    if (query.data) owner.adoptServer(query.data)
  }, [owner, query.data])

  const update = useCallback((patch: Partial<MaaInstanceOptions>) => {
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
