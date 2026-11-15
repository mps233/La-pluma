// 非 connection section 时返回 null 但组件保持挂载：section 切换不重建 Query 观察者，
// 也不清空草稿与保存/读取反馈。

import { useCallback } from 'react'
import { Switch } from '@/shared/ui/switch'
import { ConfigFieldInput, ConfigFieldSelect } from './ConfigFieldControls'
import { notify, SETTINGS_CONFIG_CONNECTION_NOTICE_ID } from '@/shared/notifications'
import { useConfigDraftPanel } from '../hooks/useConfigDraftPanel'
import { useSettingsConnectionConfig } from '../hooks/useSettingsConnectionConfig'
import { useClearConnectionTestFeedback } from '../hooks/useSettingsDeviceConnection'
import { CONFIG_SECTION_VIEWS } from './configSectionViews'
import ConfigEditorCard from './ConfigEditorCard'
import DeviceConnectionPanel from './DeviceConnectionPanel'
import { MAA_CONNECTION_PRESETS } from '../types'
import type { MaaConnectionConfig, MaaConnectionPreset } from '../types'

const PRESET_LABELS: Record<MaaConnectionPreset, string> = {
  ADB: 'ADB（通用）',
  MuMuPro: 'MuMuPro（MuMu 模拟器）',
  PlayCover: 'PlayCover（PlayTools）',
  Waydroid: 'Waydroid',
  Androws: 'Androws',
}

const PRESET_OPTIONS = MAA_CONNECTION_PRESETS.map(preset => ({
  value: preset,
  label: PRESET_LABELS[preset],
}))

export interface ConnectionConfigPanelProps {
  /** 只有 connection section 渲染可写表单；隐藏时仍保留订阅与本地反馈。 */
  readonly isActive: boolean
}

export default function ConnectionConfigPanel({ isActive }: ConnectionConfigPanelProps) {
  const {
    draft: configData,
    update: updateConnectionDraft,
    restoreDefaults,
    save: saveConnectionDraft,
    syncState: connectionSyncState,
    loadError: connectionLoadError,
    loaded: connectionLoaded,
    reload: reloadConnectionConfig,
  } = useSettingsConnectionConfig()
  const clearTestFeedback = useClearConnectionTestFeedback()
  const connectionSaving = connectionSyncState === 'saving'
  const {
    feedback: configFeedback,
    setFeedback: setConfigFeedback,
    saveBlockedReason,
    save: saveConnectionConfig,
  } = useConfigDraftPanel({
    label: '连接配置',
    noticeId: SETTINGS_CONFIG_CONNECTION_NOTICE_ID,
    savingMessage: '正在保存配置...',
    loadError: connectionLoadError,
    loaded: connectionLoaded,
    saving: connectionSaving,
    save: saveConnectionDraft,
  })

  const updateConnectionConfig = (patch: Partial<MaaConnectionConfig>) => {
    updateConnectionDraft(patch)
    setConfigFeedback(null)
  }

  const handleSave = () => {
    void saveConnectionConfig()
  }

  const handleReset = () => {
    restoreDefaults()
    setConfigFeedback(null)
    notify('已重置为默认值')
  }

  // 地址输入变更清除旧测试反馈；不取消在途测试，与迁移前一致。
  const clearConfigFeedback = useCallback(() => setConfigFeedback(null), [setConfigFeedback])

  if (!isActive) return null

  return (
    <ConfigEditorCard
      title={CONFIG_SECTION_VIEWS.connection.name}
      feedback={configFeedback}
      saving={connectionSaving}
      saveDisabled={!connectionLoaded}
      saveBlockedReason={saveBlockedReason}
      editingDisabled={!connectionLoaded}
      onRetryLoad={connectionLoadError ? reloadConnectionConfig : undefined}
      onSave={handleSave}
      onReset={handleReset}
    >
      <div className="grid min-w-0 gap-3.5 md:grid-cols-2">
        <ConfigFieldInput
          id="connection-adb-path"
          label="ADB 路径"
          value={configData.adb_path}
          onChange={(event) => {
            updateConnectionConfig({ adb_path: event.target.value })
          }}
          disabled={!connectionLoaded}
          hint="ADB 可执行文件的完整路径"
        />
        <ConfigFieldInput
          id="connection-address"
          label="连接地址"
          value={configData.address}
          onChange={(event) => {
            updateConnectionConfig({ address: event.target.value })
            clearTestFeedback()
          }}
          disabled={!connectionLoaded}
          hint="模拟器地址，例如 127.0.0.1:16384"
        />
      </div>

      <DeviceConnectionPanel
        adbPath={configData.adb_path}
        address={configData.address}
        onSelectDeviceStart={clearConfigFeedback}
        disabled={!connectionLoaded}
      />

      <div className="grid min-w-0 gap-3.5 md:grid-cols-2 md:items-end">
        <ConfigFieldSelect
          id="connection-preset"
          label="连接预设"
          value={configData.preset}
          onValueChange={(value) => {
            updateConnectionConfig({ preset: value as MaaConnectionPreset })
          }}
          disabled={!connectionLoaded}
          items={PRESET_OPTIONS}
          hint="预设提供默认 ADB 路径与平台配置；显式填写的值优先"
        />
        <ConfigFieldSelect
          id="connection-platform-config"
          label="平台配置"
          value={configData.config}
          onValueChange={(value) => {
            updateConnectionConfig({ config: value })
          }}
          disabled={!connectionLoaded}
          items={[
            { value: 'CompatMac', label: 'CompatMac (macOS)' },
            { value: 'CompatPOSIXShell', label: 'CompatPOSIXShell (Linux)' },
            { value: 'General', label: 'General (Windows)' },
          ]}
          hint="选择与服务器系统匹配的平台预设"
        />
      </div>
      <div className="config-reconnect-row flex min-h-14 items-center justify-between gap-3.5 py-1">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">自动重连</div>
          <div className="mt-1 text-xs leading-5 text-tertiary">连接中断后自动尝试恢复</div>
        </div>
        <Switch
          aria-label="启用自动重连"
          checked={configData.auto_reconnect !== false}
          onCheckedChange={(checked: boolean) => {
            updateConnectionConfig({ auto_reconnect: checked })
          }}
          disabled={!connectionLoaded}
        />
      </div>
    </ConfigEditorCard>
  )
}
