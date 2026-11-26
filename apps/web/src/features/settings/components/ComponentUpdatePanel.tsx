import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/shared/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { notify, notifyProgress, SETTINGS_UPDATE_CHANNEL_NOTICE_ID } from '@/shared/notifications'
import { InlineAlert } from '@/shared/components'
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

const formatResourceTime = (value: string | null) => (
  value
    ? new Date(value.replace(' ', 'T')).toLocaleString('zh-CN', { hour12: false })
    : '未知'
)

export default function ComponentUpdatePanel() {
  const [channelSaving, setChannelSaving] = useState<UpdateChannelScope | null>(null)
  const {
    version: versionInfo,
    reload: reloadVersion,
  } = useSettingsVersion()
  const {
    running: updateOperation,
    busy: updateBusy,
    canceling: updateCanceling,
    updateCore,
    updateCli,
    updateResources,
    cancelUpdate,
  } = useSettingsUpdates(notify, reloadVersion)
  const updatingCore = updateOperation === 'core' || updateOperation === 'core-channel'
  const updatingCli = updateOperation === 'cli'
  const hotUpdating = updateOperation === 'resources'

  const installedCoreChannel = resolveCoreChannel(versionInfo?.core)
  const coreChannel: CoreUpdateChannel = versionInfo?.updateChannels?.core ?? installedCoreChannel
  const cliChannel: CliUpdateChannel = versionInfo?.updateChannels?.cli ?? 'stable'
  const channelSavingBusy = channelSaving !== null

  const handleUpdateCore = () => {
    void updateCore(coreChannel === installedCoreChannel ? undefined : coreChannel)
  }

  const handleUpdateCli = () => {
    void updateCli()
  }

  const handleHotUpdate = () => {
    void updateResources()
  }

  const handleCancelUpdate = () => {
    void cancelUpdate()
  }

  const handleChannelChange = async (scope: UpdateChannelScope, channel: string) => {
    setChannelSaving(scope)
    notifyProgress('正在保存更新渠道...', SETTINGS_UPDATE_CHANNEL_NOTICE_ID)
    try {
      const result = await saveUpdateChannel(scope, channel)
      if (!result.success) {
        notify(`更新渠道保存失败: ${result.message || '未知错误'}`, 'error', {
          id: SETTINGS_UPDATE_CHANNEL_NOTICE_ID,
        })
        return
      }
      notify('更新渠道已保存', 'success', { id: SETTINGS_UPDATE_CHANNEL_NOTICE_ID })
      try {
        await reloadVersion()
      } catch (error) {
        notify(`更新渠道已保存，但版本刷新失败: ${error instanceof Error ? error.message : '未知错误'}`, 'warning', {
          id: SETTINGS_UPDATE_CHANNEL_NOTICE_ID,
        })
      }
    } catch (error) {
      notify(`更新渠道保存失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error', {
        id: SETTINGS_UPDATE_CHANNEL_NOTICE_ID,
      })
    } finally {
      setChannelSaving(null)
    }
  }

  const resource = versionInfo?.resource

  return (
    <>
      <Field orientation="horizontal" className="min-h-11 gap-3.5">
        <FieldContent className="gap-0.5">
          <FieldLabel htmlFor="settings-cli-channel" className="text-sm font-medium text-foreground">MAA CLI</FieldLabel>
          {versionInfo && <FieldDescription className="text-sm text-muted-foreground">{versionInfo.cli}</FieldDescription>}
        </FieldContent>
        <Select
          items={CLI_CHANNEL_OPTIONS}
          value={cliChannel}
          onValueChange={(value, details) => { if (details.reason !== 'none' && value !== null) void handleChannelChange('cli', value) }}
          disabled={channelSavingBusy}
        >
          <SelectTrigger id="settings-cli-channel" aria-label="MAA CLI 更新渠道" className="min-w-0 flex-1 sm:max-w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLI_CHANNEL_OPTIONS.map(item => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field orientation="horizontal" className="min-h-11 gap-3.5">
        <FieldContent className="gap-0.5">
          <FieldLabel htmlFor="settings-core-channel" className="text-sm font-medium text-foreground">MaaCore</FieldLabel>
          {versionInfo && <FieldDescription className="text-sm text-muted-foreground">{versionInfo.core}</FieldDescription>}
        </FieldContent>
        <Select
          items={CORE_CHANNEL_OPTIONS}
          value={coreChannel}
          onValueChange={(value, details) => { if (details.reason !== 'none' && value !== null) void handleChannelChange('core', value) }}
          disabled={channelSavingBusy}
        >
          <SelectTrigger id="settings-core-channel" aria-label="MaaCore 更新渠道" className="min-w-0 flex-1 sm:max-w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CORE_CHANNEL_OPTIONS.map(item => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {resource && (
        <Field orientation="horizontal" className="min-h-11 gap-3.5">
          <FieldContent className="gap-0.5">
            <FieldTitle className="text-sm font-medium text-foreground">游戏资源</FieldTitle>
            <FieldDescription className="text-sm text-muted-foreground">{formatResourceTime(resource.lastUpdated)}</FieldDescription>
          </FieldContent>
          <Badge
            variant="ghost"
            className={`shrink-0 ${resource.status === 'current' ? 'status-success' : 'status-warning'}`}
          >
            {resource.status === 'current' ? '资源正常' : '需要同步'}
          </Badge>
        </Field>
      )}

      {resource && resource.status !== 'current' && (
        <InlineAlert tone="warning" className="text-xs [&_[data-slot=alert-description]]:text-xs">
          {resource.message}
        </InlineAlert>
      )}

      <div className="flex min-h-11 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        <Button
          onClick={handleUpdateCli}
          disabled={updateBusy || channelSavingBusy || updatingCli}
          aria-busy={updatingCli || undefined}
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
        >
          {updatingCli
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />更新中</>
            : '更新 MAA CLI'}
        </Button>
        <Button
          onClick={handleUpdateCore}
          disabled={updateBusy || channelSavingBusy || updatingCore}
          aria-busy={updatingCore || undefined}
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
        >
          {updatingCore
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />更新中</>
            : '更新 MaaCore'}
        </Button>
        <Button
          onClick={handleHotUpdate}
          disabled={updateBusy || channelSavingBusy || hotUpdating}
          aria-busy={hotUpdating || undefined}
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
        >
          {hotUpdating
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />更新中</>
            : '更新资源'}
        </Button>
        {updateOperation && (
          <Button
            type="button"
            onClick={handleCancelUpdate}
            disabled={updateCanceling}
            aria-busy={updateCanceling || undefined}
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
          >
            {updateCanceling
              ? <><LoaderCircle className="animate-spin" aria-hidden="true" />停止中</>
              : '停止更新'}
          </Button>
        )}
      </div>
    </>
  )
}
