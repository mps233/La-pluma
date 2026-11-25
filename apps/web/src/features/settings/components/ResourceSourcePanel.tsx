import { useState } from 'react'
import { ConfigFieldCheckbox, ConfigFieldInput, ConfigFieldSelect } from './ConfigFieldControls'
import SwitchSettingRow from './SwitchSettingRow'
import { SETTINGS_CONFIG_RESOURCE_SOURCE_NOTICE_ID } from '@/shared/notifications'
import { isRunStatusBusy, useStatusStore } from '@/features/runtime-status'
import { useAutoSave } from '../hooks/useAutoSave'
import { useConfigDraftPanel } from '../hooks/useConfigDraftPanel'
import { useSettingsResourceSource } from '../hooks/useSettingsResourceSource'
import ConfigEditorCard from './ConfigEditorCard'
import { DEFAULT_MIRRORCHYAN_CHECK_INTERVAL } from '../model/resourceSource'
import { GIT_BACKENDS, RESOURCE_SOURCE_TYPES } from '../types'
import type {
  GitBackend,
  ResourceSecretKind,
  ResourceSourceDraft,
  ResourceSourceType,
} from '../types'

const SOURCE_LABELS: Record<ResourceSourceType, string> = {
  git: 'Git 仓库',
  mirrorchyan: 'MirrorChyan',
}

const SOURCE_OPTIONS = RESOURCE_SOURCE_TYPES.map(source => ({
  value: source,
  label: SOURCE_LABELS[source],
}))

const BACKEND_LABELS: Record<GitBackend, string> = {
  git: 'git（系统命令）',
  libgit2: 'libgit2（内置）',
}

const BACKEND_OPTIONS = GIT_BACKENDS.map(backend => ({
  value: backend,
  label: BACKEND_LABELS[backend],
}))

const describeCdk = (kind: ResourceSecretKind): string => {
  switch (kind) {
    case 'plain':
      return '已保存 CDK，留空保持不变'
    case 'env':
      return 'CDK 来自环境变量，留空保持不变'
    case 'command':
      return 'CDK 由命令提供，留空保持不变'
    case 'prompt':
      return 'CDK 在运行时交互输入，留空保持不变'
    case 'none':
    default:
      return '尚未保存 CDK'
  }
}

export default function ResourceSourcePanel() {
  const {
    draft,
    update,
    save: saveResourceSourceDraft,
    syncState,
    error,
    dirty,
    revision,
    getState,
    loadError,
    loaded,
    reload,
  } = useSettingsResourceSource(undefined)
  const saving = syncState === 'saving'
  const getAutoSaveState = () => {
    const current = getState()
    return {
      loaded: current.loaded,
      dirty: current.dirty,
      saving: current.syncState === 'saving',
      revision: current.revision,
    }
  }
  const runBusy = useStatusStore(state => isRunStatusBusy(state.runStatus))
  const [cdkFocused, setCdkFocused] = useState(false)
  const {
    feedback: configFeedback,
    save: saveResourceSource,
  } = useConfigDraftPanel({
    label: '资源源配置',
    noticeId: SETTINGS_CONFIG_RESOURCE_SOURCE_NOTICE_ID,
    loadError,
    syncState,
    error,
    save: saveResourceSourceDraft,
  })
  const { flush } = useAutoSave({
    state: { loaded, dirty, saving, revision },
    getState: getAutoSaveState,
    save: saveResourceSource,
    locked: runBusy,
    paused: cdkFocused,
    saveBlocked: syncState === 'failed',
  })

  const updateMirrorChyan = (patch: Partial<ResourceSourceDraft['mirrorchyan']>) => {
    update({ mirrorchyan: { ...draft.mirrorchyan, ...patch } })
  }

  const updateNow = (patch: Partial<ResourceSourceDraft>) => {
    update(patch)
    flush()
  }

  const handleRetrySave = () => {
    void saveResourceSource()
  }

  const handleCheckIntervalChange = (value: string) => {
    const parsed = Number.parseInt(value, 10)
    updateMirrorChyan({
      checkInterval: Number.isFinite(parsed) ? Math.max(0, parsed) : DEFAULT_MIRRORCHYAN_CHECK_INTERVAL,
    })
  }

  return (
    <ConfigEditorCard
      feedback={configFeedback}
      onRetryLoad={loadError ? reload : undefined}
      onRetrySave={handleRetrySave}
      retryDisabled={runBusy}
      onFieldBlur={flush}
    >
      {runBusy && (
        <p role="status" className="text-xs leading-5 text-muted-foreground">
          MAA 运行中，资源设置暂不可修改
        </p>
      )}
      <ConfigFieldSelect
        id="resource-source"
        label="资源来源"
        value={draft.source}
        onValueChange={(value) => {
          updateNow({ source: value as ResourceSourceType })
        }}
        disabled={!loaded || runBusy}
        items={SOURCE_OPTIONS}
      />

      {draft.source === 'git' && (
        <ConfigFieldSelect
          id="resource-git-backend"
          label="Git 后端"
          value={draft.git.backend}
          onValueChange={(value) => {
            updateNow({ git: { backend: value as GitBackend } })
          }}
          disabled={!loaded || runBusy}
          items={BACKEND_OPTIONS}
        />
      )}

      {draft.source === 'mirrorchyan' && (
        <>
          <ConfigFieldInput
            id="resource-mirrorchyan-cdk"
            label="MirrorChyan CDK"
            type="password"
            value={draft.mirrorchyan.cdk}
            onChange={(event) => {
              updateMirrorChyan({ cdk: event.target.value, clearCdk: false })
            }}
            onFocus={() => setCdkFocused(true)}
            onBlur={() => setCdkFocused(false)}
            disabled={!loaded || runBusy || draft.mirrorchyan.clearCdk}
            hint={describeCdk(draft.mirrorchyan.cdkKind)}
          />
          {draft.mirrorchyan.cdkKind !== 'none' && (
            <ConfigFieldCheckbox
              id="resource-clear-cdk"
              label="清除已保存的 CDK"
              checked={draft.mirrorchyan.clearCdk}
              onCheckedChange={(checked: boolean) => {
                updateNow({ mirrorchyan: { ...draft.mirrorchyan, clearCdk: checked, cdk: checked ? '' : draft.mirrorchyan.cdk } })
              }}
              disabled={!loaded || runBusy}
            />
          )}
          <ConfigFieldInput
            id="resource-mirrorchyan-interval"
            label="检查间隔（秒）"
            type="number"
            value={draft.mirrorchyan.checkInterval}
            onChange={event => handleCheckIntervalChange(event.target.value)}
            disabled={!loaded || runBusy}
            hint="0 表示禁用缓存；默认 600 秒"
          />
        </>
      )}

      <SwitchSettingRow
        id="resource-auto-update"
        label="自动更新资源"
        checked={draft.autoUpdate}
        onCheckedChange={(checked: boolean) => {
          updateNow({ autoUpdate: checked })
        }}
        disabled={!loaded || runBusy}
      />
      <SwitchSettingRow
        id="resource-warn-on-update-failure"
        label="更新失败时告警"
        checked={draft.warnOnUpdateFailure}
        onCheckedChange={(checked: boolean) => {
          updateNow({ warnOnUpdateFailure: checked })
        }}
        disabled={!loaded || runBusy}
      />
    </ConfigEditorCard>
  )
}
