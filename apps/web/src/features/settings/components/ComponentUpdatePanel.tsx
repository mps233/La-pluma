import { useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { Button, Select } from '@/shared/components'
import { useStatusStore } from '@/features/runtime-status'
import { saveUpdateChannel } from '../api'
import { resolveCoreChannel } from '../model/updateCommandPolicy'
import {
  CLI_UPDATE_CHANNEL_LABELS,
  CLI_UPDATE_CHANNELS,
  CORE_UPDATE_CHANNEL_LABELS,
  CORE_UPDATE_CHANNELS,
} from '../types'
import type { CliUpdateChannel, CoreUpdateChannel, UpdateChannelScope } from '../types'
import { useSettingsUpdates } from '../hooks/useSettingsUpdates'
import { useSettingsVersion } from '../hooks/useSettingsVersion'

const CORE_CHANNEL_OPTIONS = CORE_UPDATE_CHANNELS.map(value => ({
  value,
  label: CORE_UPDATE_CHANNEL_LABELS[value],
}))

const CLI_CHANNEL_OPTIONS = CLI_UPDATE_CHANNELS.map(value => ({
  value,
  label: CLI_UPDATE_CHANNEL_LABELS[value],
}))

export default function ComponentUpdatePanel() {
  const setStatusMessage = useStatusStore(state => state.setMessage)
  const [channelSaving, setChannelSaving] = useState<UpdateChannelScope | null>(null)
  const {
    version: versionInfo,
    reload: reloadVersion,
  } = useSettingsVersion()
  const {
    running: updateOperation,
    feedback: updateFeedback,
    busy: updateBusy,
    canceling: updateCanceling,
    updateCore,
    switchCoreChannel,
    updateCli,
    updateResources,
    cancelUpdate,
  } = useSettingsUpdates(setStatusMessage, reloadVersion)
  const updatingCore = updateOperation === 'core' || updateOperation === 'core-channel'
  const updatingCli = updateOperation === 'cli'
  const hotUpdating = updateOperation === 'resources'

  const handleUpdateCore = () => {
    void updateCore()
  }

  const handleUpdateCli = () => {
    void updateCli()
  }

  const handleToggleCoreVersion = () => {
    void switchCoreChannel(versionInfo?.core)
  }

  const handleHotUpdate = () => {
    void updateResources()
  }

  const handleCancelUpdate = () => {
    void cancelUpdate()
  }

  const installedCoreChannel = resolveCoreChannel(versionInfo?.core)
  const coreChannel: CoreUpdateChannel = versionInfo?.updateChannels?.core ?? installedCoreChannel
  const cliChannel: CliUpdateChannel = versionInfo?.updateChannels?.cli ?? 'stable'
  const channelSavingBusy = channelSaving !== null

  const handleChannelChange = async (scope: UpdateChannelScope, channel: string) => {
    setChannelSaving(scope)
    setStatusMessage('正在保存更新渠道...', 'info')
    const result = await saveUpdateChannel(scope, channel)
    if (!result.success) {
      setStatusMessage(`更新渠道保存失败: ${result.message || '未知错误'}`, 'error')
      setChannelSaving(null)
      return
    }
    setStatusMessage('更新渠道已保存')
    await reloadVersion()
    setChannelSaving(null)
  }

  return (
    <>
      <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-1">
        <section className="surface-soft flex min-w-0 flex-col rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">MaaCore</h3>
            {versionInfo && <span className="text-sm brand-text">{versionInfo.core}</span>}
            <Select
              aria-label="MaaCore 更新渠道"
              value={coreChannel}
              options={CORE_CHANNEL_OPTIONS}
              onChange={value => void handleChannelChange('core', value)}
              disabled={channelSavingBusy}
              className="ml-auto w-32"
            />
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">核心组件与游戏资源</p>
          {versionInfo?.resource && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-tertiary">
                资源更新：{versionInfo.resource.lastUpdated
                  ? new Date(versionInfo.resource.lastUpdated.replace(' ', 'T')).toLocaleString('zh-CN', { hour12: false })
                  : '未知'}
              </span>
              <span className={`rounded-full px-2 py-1 font-medium ${versionInfo.resource.status === 'current' ? 'status-success' : 'status-warning'}`}>
                {versionInfo.resource.status === 'current' ? '资源正常' : '需要同步'}
              </span>
            </div>
          )}
          {versionInfo?.resource && versionInfo.resource.status !== 'current' && (
            <p className="mt-2 text-xs leading-5 text-warning">{versionInfo.resource.message}</p>
          )}
          <div className="mt-auto grid gap-2 pt-4 sm:grid-cols-2">
            <Button
              onClick={handleUpdateCore}
              disabled={updateBusy || channelSavingBusy}
              loading={updatingCore}
              loadingText="更新中"
              variant="primary"
              className="w-full"
              icon={<Download size={16} aria-hidden="true" />}
            >
              更新 MaaCore
            </Button>
            <Button
              type="button"
              onClick={handleToggleCoreVersion}
              disabled={updateBusy || channelSavingBusy}
              variant="secondary"
              className="w-full"
              icon={<RefreshCw size={16} aria-hidden="true" />}
            >
              {installedCoreChannel === 'beta' ? '切换正式版' : '切换测试版'}
            </Button>
            <Button
              onClick={handleHotUpdate}
              disabled={updateBusy || channelSavingBusy}
              loading={hotUpdating}
              loadingText="同步中"
              variant="outline"
              className="w-full sm:col-span-2"
              icon={<RefreshCw size={16} aria-hidden="true" />}
            >
              仅同步游戏资源
            </Button>
          </div>
        </section>

        <section className="surface-soft flex min-w-0 flex-col rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">MAA CLI</h3>
            {versionInfo && <span className="text-sm brand-text">{versionInfo.cli}</span>}
            <Select
              aria-label="MAA CLI 更新渠道"
              value={cliChannel}
              options={CLI_CHANNEL_OPTIONS}
              onChange={value => void handleChannelChange('cli', value)}
              disabled={channelSavingBusy}
              className="ml-auto w-32"
            />
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">命令行工具与任务运行入口</p>
          <div className="mt-auto pt-4">
            <Button
              onClick={handleUpdateCli}
              disabled={updateBusy || channelSavingBusy}
              loading={updatingCli}
              loadingText="更新中"
              variant="primary"
              fullWidth
              icon={<Download size={16} aria-hidden="true" />}
            >
              更新 MAA CLI
            </Button>
          </div>
        </section>
      </div>

      {updateOperation && (
        <div className="mt-3">
          <Button
            type="button"
            onClick={handleCancelUpdate}
            disabled={updateCanceling}
            loading={updateCanceling}
            loadingText="停止中"
            variant="outline"
            fullWidth
          >
            停止更新
          </Button>
        </div>
      )}

      {updateFeedback && (
        <div className={`rounded-lg px-3 py-2.5 text-xs leading-5 ${updateFeedback.type === 'success' ? 'status-success' : 'status-warning'}`} role={updateFeedback.type === 'error' ? 'alert' : 'status'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>{updateFeedback.message}</p>
            {updateFeedback.resourceRetry && (
              <Button
                type="button"
                onClick={handleHotUpdate}
                disabled={updateBusy || channelSavingBusy}
                variant="ghost"
                size="sm"
                className="min-h-11! lg:min-h-0!"
                icon={<RefreshCw size={16} aria-hidden="true" />}
              >
                重试资源同步
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
