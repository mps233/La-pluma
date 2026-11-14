import { Checkbox, Input, Select, Switch } from '@/shared/components'
import { useStatusStore } from '@/features/runtime-status'
import { useConfigDraftPanel } from '../hooks/useConfigDraftPanel'
import { useSettingsResourceSource } from '../hooks/useSettingsResourceSource'
import { CONFIG_SECTION_VIEWS } from './configSectionViews'
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

export interface ResourceSourcePanelProps {
  /** 只有 resource section 渲染可写表单；隐藏时保留订阅与反馈。 */
  readonly isActive: boolean
}

export default function ResourceSourcePanel({ isActive }: ResourceSourcePanelProps) {
  const setStatusMessage = useStatusStore(state => state.setMessage)
  const {
    draft,
    update,
    restoreDefaults,
    save: saveResourceSourceDraft,
    syncState,
    loadError,
    loaded,
    reload,
  } = useSettingsResourceSource(undefined, isActive)
  const saving = syncState === 'saving'
  const {
    feedback: configFeedback,
    setFeedback: setConfigFeedback,
    saveBlockedReason,
    save: saveResourceSource,
  } = useConfigDraftPanel({
    label: '资源源配置',
    savingMessage: '正在保存资源源配置...',
    loadError,
    loaded,
    saving,
    save: saveResourceSourceDraft,
  })

  const updateMirrorChyan = (patch: Partial<ResourceSourceDraft['mirrorchyan']>) => {
    update({ mirrorchyan: { ...draft.mirrorchyan, ...patch } })
    setConfigFeedback(null)
  }

  const handleSave = () => {
    void saveResourceSource()
  }

  const handleReset = () => {
    restoreDefaults()
    setConfigFeedback(null)
    setStatusMessage('已重置资源源配置为默认值')
  }

  const handleCheckIntervalChange = (value: string) => {
    const parsed = Number.parseInt(value, 10)
    updateMirrorChyan({
      checkInterval: Number.isFinite(parsed) ? Math.max(0, parsed) : DEFAULT_MIRRORCHYAN_CHECK_INTERVAL,
    })
  }

  if (!isActive) return null

  return (
    <ConfigEditorCard
      title={CONFIG_SECTION_VIEWS.resource.name}
      feedback={configFeedback}
      saving={saving}
      saveDisabled={!loaded}
      saveBlockedReason={saveBlockedReason}
      editingDisabled={!loaded}
      onRetryLoad={loadError ? reload : undefined}
      onSave={handleSave}
      onReset={handleReset}
    >
      <Select
        label="资源来源"
        value={draft.source}
        onChange={(value: string) => {
          update({ source: value as ResourceSourceType })
          setConfigFeedback(null)
        }}
        disabled={!loaded}
        options={SOURCE_OPTIONS}
      />

      {draft.source === 'git' && (
        <Select
          label="Git 后端"
          value={draft.git.backend}
          onChange={(value: string) => {
            update({ git: { backend: value as GitBackend } })
            setConfigFeedback(null)
          }}
          disabled={!loaded}
          options={BACKEND_OPTIONS}
        />
      )}

      {draft.source === 'mirrorchyan' && (
        <>
          <Input
            label="MirrorChyan CDK"
            type="password"
            value={draft.mirrorchyan.cdk}
            onChange={(value: string) => {
              updateMirrorChyan({ cdk: value, clearCdk: false })
            }}
            disabled={!loaded || draft.mirrorchyan.clearCdk}
            hint={describeCdk(draft.mirrorchyan.cdkKind)}
          />
          {draft.mirrorchyan.cdkKind !== 'none' && (
            <Checkbox
              label="清除已保存的 CDK"
              checked={draft.mirrorchyan.clearCdk}
              onChange={(checked: boolean) => {
                updateMirrorChyan({ clearCdk: checked, cdk: checked ? '' : draft.mirrorchyan.cdk })
              }}
              disabled={!loaded}
            />
          )}
          <Input
            label="检查间隔（秒）"
            type="number"
            value={draft.mirrorchyan.checkInterval}
            onChange={handleCheckIntervalChange}
            disabled={!loaded}
            hint="0 表示禁用缓存；默认 600 秒"
          />
        </>
      )}

      <div className="config-switch-list flex flex-col gap-3.5">
        <div className="config-reconnect-row flex min-h-14 items-center justify-between gap-3.5 py-1">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">自动更新资源</div>
            <div className="mt-1 text-xs leading-5 text-tertiary">由 maa-cli 在运行前按需同步 MaaResource</div>
          </div>
          <Switch
            label="自动更新资源"
            checked={draft.autoUpdate}
            onChange={(checked: boolean) => {
              update({ autoUpdate: checked })
              setConfigFeedback(null)
            }}
            disabled={!loaded}
          />
        </div>
        <div className="config-reconnect-row flex min-h-14 items-center justify-between gap-3.5 py-1">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">更新失败时告警</div>
            <div className="mt-1 text-xs leading-5 text-tertiary">资源自动更新失败时输出警告而不是静默跳过</div>
          </div>
          <Switch
            label="更新失败时告警"
            checked={draft.warnOnUpdateFailure}
            onChange={(checked: boolean) => {
              update({ warnOnUpdateFailure: checked })
              setConfigFeedback(null)
            }}
            disabled={!loaded}
          />
        </div>
      </div>

    </ConfigEditorCard>
  )
}
