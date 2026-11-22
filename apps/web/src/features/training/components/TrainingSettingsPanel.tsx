import { Card } from '@/shared/ui/card'
import { Switch } from '@/shared/ui/switch'
import type { TrainingSettings } from '../types'

export interface TrainingSettingsPanelProps {
  settings: TrainingSettings
  settingsReady: boolean
  onUpdate: (patch: Partial<TrainingSettings>) => void
}

export default function TrainingSettingsPanel({
  settings,
  settingsReady,
  onUpdate,
}: TrainingSettingsPanelProps) {
  const descriptionId = 'training-settings-status'
  return (
    <Card role="region" aria-labelledby="training-settings-title" className="min-w-0 gap-0 p-0!">
      <div className="training-settings">
        <h2 id="training-settings-title" className="text-sm font-semibold text-foreground">自动化设置</h2>
        {!settingsReady && <span id={descriptionId} className="mt-1 block text-xs text-muted-foreground">设置尚未读取完成，暂不可编辑</span>}
        <div className="training-settings-grid">
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-foreground">自动切换</span>
              <span className="mt-1 block text-xs text-muted-foreground">当前目标材料齐备后，继续筹备下一位</span>
            </span>
            <Switch size="sm" aria-label="自动切换" aria-describedby={settingsReady ? undefined : descriptionId} disabled={!settingsReady} checked={settings.autoSwitch} onCheckedChange={checked => onUpdate({ autoSwitch: checked })} />
          </label>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-foreground">完成通知</span>
              <span className="mt-1 block text-xs text-muted-foreground">目标材料筹备完成时发送通知</span>
            </span>
            <Switch size="sm" aria-label="完成通知" aria-describedby={settingsReady ? undefined : descriptionId} disabled={!settingsReady} checked={settings.notifyOnComplete} onCheckedChange={checked => onUpdate({ notifyOnComplete: checked })} />
          </label>
        </div>
      </div>
    </Card>
  )
}
