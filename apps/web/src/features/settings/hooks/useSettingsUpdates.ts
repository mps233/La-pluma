// 命令确认成功后依次：推进物品图标缓存 epoch；发布 catalog/materials/training-plan/
// dashboard-snapshot 失效（CLI 更新不发布）；重取 settings/version。完成提示在 HTTP
// 返回后立即发出，版本重取在后台继续；失败只发全局提示，不自动重发。

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { invalidateItemIconCache } from '@/features/game-data'
import { publishResourceInvalidation } from '@/features/resource-invalidation'
import {
  detectNoticeType,
  dismissNotice,
  notifyProgress,
  SETTINGS_UPDATE_NOTICE_ID,
  type Notify,
} from '@/shared/notifications'
import {
  SETTINGS_UPDATE_RESOURCE_SCOPES,
  coreChannelLabel,
  settingsUpdateOwner,
  type SettingsUpdateOwner,
  type UpdateCommandOutcome,
  type UpdateOperation,
} from '../model/updateCommands'
import type { CoreUpdateChannel } from '../types'

export interface UseSettingsUpdatesResult {
  readonly running: UpdateOperation | null
  readonly busy: boolean
  readonly canceling: boolean
  readonly updateCore: (version?: CoreUpdateChannel) => Promise<UpdateCommandOutcome>
  readonly updateCli: (channel?: string) => Promise<UpdateCommandOutcome>
  readonly updateResources: () => Promise<UpdateCommandOutcome>
  /** 停止在途更新；停止意图记录后仍等待 run 终态，不把请求返回当作已停止。 */
  readonly cancelUpdate: () => Promise<void>
}

export function useSettingsUpdates(
  notify: Notify,
  reloadVersion: () => Promise<void>,
  owner: SettingsUpdateOwner = settingsUpdateOwner,
): UseSettingsUpdatesResult {
  const state = useSyncExternalStore(owner.subscribe, owner.getState, owner.getState)
  const retryResourcesRef = useRef<(() => void) | null>(null)

  const finish = useCallback(async (outcome: UpdateCommandOutcome) => {
    if (outcome.message) {
      const action = outcome.feedback?.resourceRetry
        ? {
            label: '重试资源同步',
            onClick: () => { retryResourcesRef.current?.() },
          }
        : undefined
      notify(outcome.message, outcome.messageType ?? detectNoticeType(outcome.message), {
        id: SETTINGS_UPDATE_NOTICE_ID,
        ...(action ? { action } : {}),
      })
    } else {
      dismissNotice(SETTINGS_UPDATE_NOTICE_ID)
    }

    if (outcome.status === 'succeeded' && outcome.resourcesChanged) {
      // 图片 URL 与目录/材料数据是两套缓存：先推进图标 epoch，再发布
      // 作用域，使接收方重新渲染时拿到新的 <img src>。
      invalidateItemIconCache()
      publishResourceInvalidation({
        resources: SETTINGS_UPDATE_RESOURCE_SCOPES,
        cause: 'resource-update',
      })
    }
    if ((outcome.status === 'succeeded' || outcome.status === 'canceled') && outcome.versionChanged) {
      // 版本资源的失效在后台继续；Activity 隐藏时保留失效标记，
      // 恢复显示后重取。
      await reloadVersion()
    }

    return outcome
  }, [notify, reloadVersion])

  const run = useCallback(async (
    startMessage: string,
    action: () => Promise<UpdateCommandOutcome>,
  ): Promise<UpdateCommandOutcome> => {
    // 已有一条命令在途时不再显示第二条开始提示；owner 会返回 ignored。
    if (owner.getState().running === null) {
      notifyProgress(startMessage, SETTINGS_UPDATE_NOTICE_ID)
    }
    const outcome = await action()
    if (outcome.status === 'ignored') return outcome
    return finish(outcome)
  }, [finish, owner])

  // 刷新后服务端更新可能仍在运行：恢复观察、占回命令槽位并保留停止入口。
  useEffect(() => (
    owner.observeTrackedRun(outcome => {
      void finish(outcome)
    })
  ), [finish, owner])

  const updateCore = useCallback((version?: CoreUpdateChannel) => (
    run(
      version
        ? `正在切换到 ${coreChannelLabel(version)} 渠道（大包下载最长可能需要约 15 分钟）...`
        : '正在更新 MaaCore 并同步最新资源（大包下载最长可能需要约 15 分钟）...',
      () => owner.updateCore(version),
    )
  ), [owner, run])

  const updateCli = useCallback((channel?: string) => (
    run('正在更新 MAA CLI...', () => owner.updateCli(channel))
  ), [owner, run])

  const updateResources = useCallback(() => (
    run('正在更新资源...', () => owner.updateResources())
  ), [owner, run])

  useEffect(() => {
    retryResourcesRef.current = () => { void updateResources() }
  }, [updateResources])

  const cancelUpdate = useCallback(async () => {
    const result = await owner.cancel()
    if (!result.ok) {
      if (result.message) {
        notify(`停止更新失败: ${result.message}`, 'error', { id: SETTINGS_UPDATE_NOTICE_ID })
      }
      return
    }
    notify('已发送停止请求，等待更新退出...', 'info', { id: SETTINGS_UPDATE_NOTICE_ID })
  }, [notify, owner])

  return {
    running: state.running,
    busy: state.running !== null,
    canceling: state.canceling,
    updateCore,
    updateCli,
    updateResources,
    cancelUpdate,
  }
}
