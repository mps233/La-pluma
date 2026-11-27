import { useId } from 'react'
import { Camera, EyeOff, Radio } from 'lucide-react'
import { usePreviewStore, type PreviewMode } from '@/state'
import { Switch } from './common'
import GlassTabs from '@/components/liquid-glass/glass-tabs'

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
function PreviewModeControls() {
  const mode = usePreviewStore(state => state.mode)
  const setMode = usePreviewStore(state => state.setMode)
  const options = PREVIEW_MODES.map(({ value, label, Icon }) => ({
    value,
    label,
    icon: <Icon strokeWidth={1.8} aria-hidden="true" />,
  }))

  return (
    <div className="preview-mode-shell">
      <GlassTabs
        aria-label="预览模式"
        size="sm"
        value={mode}
        onValueChange={setMode}
        options={options}
        className="preview-mode-glass-tabs w-full"
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
