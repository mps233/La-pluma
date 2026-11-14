// 实例选项与连接配置分属同一 MAA profile 的不同 section：面板只在 instance
// section 渲染，但草稿与读取反馈由模块级 owner 持有，切换 section 不丢草稿。

import { Switch } from '@/shared/ui/switch'
import { ConfigFieldSelect } from './ConfigFieldControls'
import { useStatusStore } from '@/features/runtime-status'
import { useConfigDraftPanel } from '../hooks/useConfigDraftPanel'
import { useSettingsInstanceOptions } from '../hooks/useSettingsInstanceOptions'
import { CONFIG_SECTION_VIEWS } from './configSectionViews'
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

export interface InstanceOptionsPanelProps {
  /** 只有 instance section 渲染可写表单；隐藏时保留订阅与反馈。 */
  readonly isActive: boolean
}

export default function InstanceOptionsPanel({ isActive }: InstanceOptionsPanelProps) {
  const setStatusMessage = useStatusStore(state => state.setMessage)
  const {
    draft,
    update,
    restoreDefaults,
    save: saveInstanceOptionsDraft,
    syncState,
    loadError,
    loaded,
    reload,
  } = useSettingsInstanceOptions(undefined, 'default', isActive)
  const saving = syncState === 'saving'
  const {
    feedback: configFeedback,
    setFeedback: setConfigFeedback,
    saveBlockedReason,
    save: saveInstanceOptions,
  } = useConfigDraftPanel({
    label: '实例选项',
    savingMessage: '正在保存实例选项...',
    loadError,
    loaded,
    saving,
    save: saveInstanceOptionsDraft,
  })

  const updateInstanceOptions = (patch: Parameters<typeof update>[0]) => {
    update(patch)
    setConfigFeedback(null)
  }

  const handleSave = () => {
    void saveInstanceOptions()
  }

  const handleReset = () => {
    restoreDefaults()
    setConfigFeedback(null)
    setStatusMessage('已重置实例选项为默认值')
  }

  if (!isActive) return null

  return (
    <ConfigEditorCard
      title={CONFIG_SECTION_VIEWS.instance.name}
      feedback={configFeedback}
      saving={saving}
      saveDisabled={!loaded}
      saveBlockedReason={saveBlockedReason}
      editingDisabled={!loaded}
      onRetryLoad={loadError ? reload : undefined}
      onSave={handleSave}
      onReset={handleReset}
    >
      <ConfigFieldSelect
        id="instance-touch-mode"
        label="触控模式"
        value={draft.touch_mode}
        onValueChange={(value) => {
          updateInstanceOptions({ touch_mode: value as MaaTouchMode })
        }}
        disabled={!loaded}
        items={TOUCH_MODE_OPTIONS}
        hint="ADB 兼容性最好；MaaTouch 触控更接近真实点击"
      />

      <div className="config-switch-list flex flex-col gap-3.5">
        <div className="config-reconnect-row flex min-h-14 items-center justify-between gap-3.5 py-1">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">部署时暂停</div>
            <div className="mt-1 text-xs leading-5 text-tertiary">开启后部署干员时暂停游戏，适用于部分特殊关卡</div>
          </div>
          <Switch
            aria-label="部署时暂停"
            checked={draft.deployment_with_pause}
            onCheckedChange={(checked: boolean) => {
              updateInstanceOptions({ deployment_with_pause: checked })
            }}
            disabled={!loaded}
          />
        </div>
        <div className="config-reconnect-row flex min-h-14 items-center justify-between gap-3.5 py-1">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">ADB Lite</div>
            <div className="mt-1 text-xs leading-5 text-tertiary">使用 AdbLite 减少 ADB 调用开销</div>
          </div>
          <Switch
            aria-label="启用 ADB Lite"
            checked={draft.adb_lite_enabled}
            onCheckedChange={(checked: boolean) => {
              updateInstanceOptions({ adb_lite_enabled: checked })
            }}
            disabled={!loaded}
          />
        </div>
        <div className="config-reconnect-row flex min-h-14 items-center justify-between gap-3.5 py-1">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">退出时结束 ADB</div>
            <div className="mt-1 text-xs leading-5 text-tertiary">任务结束后由 MAA 关闭自己启动的 ADB 进程</div>
          </div>
          <Switch
            aria-label="退出时结束 ADB"
            checked={draft.kill_adb_on_exit}
            onCheckedChange={(checked: boolean) => {
              updateInstanceOptions({ kill_adb_on_exit: checked })
            }}
            disabled={!loaded}
          />
        </div>
      </div>

    </ConfigEditorCard>
  )
}
