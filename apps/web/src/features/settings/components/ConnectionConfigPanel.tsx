import { ConfigFieldInput, ConfigFieldSelect } from './ConfigFieldControls'
import SwitchSettingRow from './SwitchSettingRow'
import { SETTINGS_CONFIG_CONNECTION_NOTICE_ID } from '@/shared/notifications'
import { useAutoSave } from '../hooks/useAutoSave'
import { useConfigDraftPanel } from '../hooks/useConfigDraftPanel'
import { useSettingsConnectionConfig } from '../hooks/useSettingsConnectionConfig'
import { useClearConnectionTestFeedback } from '../hooks/useSettingsDeviceConnection'
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

export default function ConnectionConfigPanel() {
  const {
    draft: configData,
    update: updateConnectionDraft,
    save: saveConnectionDraft,
    syncState: connectionSyncState,
    error: connectionError,
    dirty: connectionDirty,
    revision: connectionRevision,
    getState: getConnectionState,
    loadError: connectionLoadError,
    loaded: connectionLoaded,
    reload: reloadConnectionConfig,
  } = useSettingsConnectionConfig()
  const clearTestFeedback = useClearConnectionTestFeedback()
  const connectionSaving = connectionSyncState === 'saving'
  const {
    feedback: configFeedback,
    save: saveConnectionConfig,
  } = useConfigDraftPanel({
    label: '连接配置',
    noticeId: SETTINGS_CONFIG_CONNECTION_NOTICE_ID,
    loadError: connectionLoadError,
    syncState: connectionSyncState,
    error: connectionError,
    save: saveConnectionDraft,
  })
  const { flush } = useAutoSave({
    state: {
      loaded: connectionLoaded,
      dirty: connectionDirty,
      saving: connectionSaving,
      revision: connectionRevision,
    },
    getState: () => {
      const current = getConnectionState()
      return {
        loaded: current.loaded,
        dirty: current.dirty,
        saving: current.syncState === 'saving',
        revision: current.revision,
      }
    },
    save: saveConnectionConfig,
    saveBlocked: connectionSyncState === 'failed',
  })

  const updateConnectionConfig = (patch: Partial<MaaConnectionConfig>) => {
    updateConnectionDraft(patch)
  }

  const updateConnectionConfigNow = (patch: Partial<MaaConnectionConfig>) => {
    updateConnectionDraft(patch)
    flush()
  }

  const handleRetrySave = () => {
    void saveConnectionConfig()
  }

  // 地址输入变更清除旧测试反馈；不取消在途测试，与迁移前一致。
  const handleAddressChange = (address: string) => {
    updateConnectionConfig({ address })
    clearTestFeedback()
  }

  return (
    <ConfigEditorCard
      feedback={configFeedback}
      onRetryLoad={connectionLoadError ? reloadConnectionConfig : undefined}
      onRetrySave={handleRetrySave}
      onFieldBlur={flush}
    >
      <ConfigFieldInput
        id="connection-adb-path"
        label="ADB 路径"
        value={configData.adb_path}
        onChange={(event) => {
          updateConnectionConfig({ adb_path: event.target.value })
        }}
        disabled={!connectionLoaded}
      />
      <ConfigFieldInput
        id="connection-address"
        label="连接地址"
        value={configData.address}
        onChange={(event) => {
          handleAddressChange(event.target.value)
        }}
        disabled={!connectionLoaded}
      />

      <DeviceConnectionPanel
        adbPath={configData.adb_path}
        address={configData.address}
        disabled={!connectionLoaded}
      />

      <ConfigFieldSelect
        id="connection-preset"
        label="连接预设"
        value={configData.preset}
        onValueChange={(value) => {
          updateConnectionConfigNow({ preset: value as MaaConnectionPreset })
        }}
        disabled={!connectionLoaded}
        items={PRESET_OPTIONS}
      />
      <ConfigFieldSelect
        id="connection-platform-config"
        label="平台配置"
        value={configData.config}
        onValueChange={(value) => {
          updateConnectionConfigNow({ config: value })
        }}
        disabled={!connectionLoaded}
        items={[
          { value: 'CompatMac', label: 'CompatMac (macOS)' },
          { value: 'CompatPOSIXShell', label: 'CompatPOSIXShell (Linux)' },
          { value: 'General', label: 'General (Windows)' },
        ]}
      />
      <SwitchSettingRow
        id="connection-auto-reconnect"
        label="自动重连"
        checked={configData.auto_reconnect !== false}
        onCheckedChange={(checked: boolean) => {
          updateConnectionConfigNow({ auto_reconnect: checked })
        }}
        disabled={!connectionLoaded}
      />
    </ConfigEditorCard>
  )
}
