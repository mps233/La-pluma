import { useId } from 'react'
import { Camera, EyeOff, Radio } from 'lucide-react'
import { GlassSegmented } from '@zakisheriff/liquid-glass'
import { usePreviewStore, useUIStore, type PreviewMode } from '../stores'
import { Switch } from './common'

const PREVIEW_MODES: ReadonlyArray<{
  value: PreviewMode
  label: string
  Icon: typeof EyeOff
}> = [
  { value: 'off', label: '关闭', Icon: EyeOff },
  { value: 'snapshot', label: '快照', Icon: Camera },
  { value: 'live', label: '实时', Icon: Radio },
]

/**
 * 预览模式开关，使用 Liquid Glass 分段控件；模式只在当前会话内保留。
 * 自动恢复是单独的显式偏好。
 */
export function PreviewModeControls() {
  const theme = useUIStore(state => state.theme)
  const mode = usePreviewStore(state => state.mode)
  const setMode = usePreviewStore(state => state.setMode)
  const activeIndex = Math.max(0, PREVIEW_MODES.findIndex(option => option.value === mode))
  const options = PREVIEW_MODES.map(({ label, Icon }) => ({
    label,
    icon: (
      <Icon
        className="h-3.5 w-3.5"
        strokeWidth={1.8}
        aria-hidden="true"
      />
    ),
  }))

  return (
    <div
      className="preview-mode-shell"
      data-theme={theme === 'system' ? undefined : theme}
    >
      <GlassSegmented
        size="sm"
        options={options}
        value={activeIndex}
        onChange={(index) => {
          const nextMode = PREVIEW_MODES[index]?.value
          if (nextMode) setMode(nextMode)
        }}
        aria-label="预览模式"
        className="preview-mode-segmented"
      />
    </div>
  )
}

/** 头部紧凑开关：重新打开应用后是否恢复上次模式；默认关闭。 */
export function PreviewAutoStartToggle() {
  const autoStart = usePreviewStore(state => state.autoStart)
  const setAutoStart = usePreviewStore(state => state.setAutoStart)
  const inputId = `preview-auto-start-${useId()}`

  return (
    <div className="dashboard-preview-auto-toggle" title="重新打开应用时恢复上次预览模式">
      <label htmlFor={inputId} className="dashboard-preview-auto-label">自动恢复</label>
      <Switch
        id={inputId}
        compact
        label="重新打开应用时恢复上次预览模式"
        checked={autoStart}
        onChange={setAutoStart}
      />
    </div>
  )
}

export default PreviewModeControls
