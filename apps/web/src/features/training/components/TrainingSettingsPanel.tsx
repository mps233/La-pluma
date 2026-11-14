import { Switch } from '@/shared/components'
import type { TrainingSettings } from '../types'

export interface TrainingSettingsPanelProps {
  settings: TrainingSettings
  onUpdate: (settings: TrainingSettings) => void
}

export default function TrainingSettingsPanel({
  settings,
  onUpdate,
}: TrainingSettingsPanelProps) {
  return (
    <details className="training-surface training-settings"><summary>自动化设置<span>自动切换与完成通知</span></summary><div className="training-settings-grid">
      <div><div><h3>自动切换</h3><p>当前目标材料齐备后，继续筹备下一位</p></div><Switch compact label="自动切换" checked={settings.autoSwitch} onChange={checked => onUpdate({ ...settings, autoSwitch: checked })} /></div>
      <div><div><h3>完成通知</h3><p>目标材料筹备完成时发送通知</p></div><Switch compact label="完成通知" checked={settings.notifyOnComplete} onChange={checked => onUpdate({ ...settings, notifyOnComplete: checked })} /></div>
    </div></details>
  )
}
