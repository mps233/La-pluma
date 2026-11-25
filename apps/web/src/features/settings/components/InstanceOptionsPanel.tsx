import { ConfigFieldSelect } from './ConfigFieldControls'
import SwitchSettingRow from './SwitchSettingRow'
import { SETTINGS_CONFIG_INSTANCE_NOTICE_ID } from '@/shared/notifications'
import { useAutoSave } from '../hooks/useAutoSave'
import { useConfigDraftPanel } from '../hooks/useConfigDraftPanel'
import { useSettingsInstanceOptions } from '../hooks/useSettingsInstanceOptions'
import ConfigEditorCard from './ConfigEditorCard'
import { MAA_TOUCH_MODES } from '../types'
import type { MaaTouchMode } from '../types'

const TOUCH_MODE_LABELS: Record<MaaTouchMode, string> = {
  Adb: 'ADB',
  MiniTouch: 'MiniTouch',
  MaaTouch: 'MaaTouch（推荐）',
  MacPlayTools: 'MacPlayTools（PlayCover）',
  MaaFwAdb: 'MaaFwAdb',
}

const TOUCH_MODE_OPTIONS = MAA_TOUCH_MODES.map(mode => ({
  value: mode,
  label: TOUCH_MODE_LABELS[mode],
}))

export default function InstanceOptionsPanel() {
  const {
    draft,
    update,
    save: saveInstanceOptionsDraft,
    syncState,
    error,
    dirty,
    revision,
    getState,
    loadError,
    loaded,
    reload,
  } = useSettingsInstanceOptions(undefined, 'default')
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
  const {
    feedback: configFeedback,
    save: saveInstanceOptions,
  } = useConfigDraftPanel({
    label: '实例选项',
    noticeId: SETTINGS_CONFIG_INSTANCE_NOTICE_ID,
    loadError,
    syncState,
    error,
    save: saveInstanceOptionsDraft,
  })
  const { flush } = useAutoSave({
    state: { loaded, dirty, saving, revision },
    getState: getAutoSaveState,
    save: saveInstanceOptions,
    saveBlocked: syncState === 'failed',
  })

  const updateInstanceOptionsNow = (patch: Parameters<typeof update>[0]) => {
    update(patch)
    flush()
  }

  const handleRetrySave = () => {
    void saveInstanceOptions()
  }

  return (
    <ConfigEditorCard
      feedback={configFeedback}
      onRetryLoad={loadError ? reload : undefined}
      onRetrySave={handleRetrySave}
      onFieldBlur={flush}
    >
      <ConfigFieldSelect
        id="instance-touch-mode"
        label="触控模式"
        value={draft.touch_mode}
        onValueChange={(value) => {
          updateInstanceOptionsNow({ touch_mode: value as MaaTouchMode })
        }}
        disabled={!loaded}
        items={TOUCH_MODE_OPTIONS}
      />

      <SwitchSettingRow
        id="instance-deployment-with-pause"
        label="部署时暂停"
        checked={draft.deployment_with_pause}
        onCheckedChange={(checked: boolean) => {
          updateInstanceOptionsNow({ deployment_with_pause: checked })
        }}
        disabled={!loaded}
      />
      <SwitchSettingRow
        id="instance-adb-lite"
        label="ADB Lite"
        checked={draft.adb_lite_enabled}
        onCheckedChange={(checked: boolean) => {
          updateInstanceOptionsNow({ adb_lite_enabled: checked })
        }}
        disabled={!loaded}
      />
      <SwitchSettingRow
        id="instance-kill-adb-on-exit"
        label="退出时结束 ADB"
        checked={draft.kill_adb_on_exit}
        onCheckedChange={(checked: boolean) => {
          updateInstanceOptionsNow({ kill_adb_on_exit: checked })
        }}
        disabled={!loaded}
      />
    </ConfigEditorCard>
  )
}
