import { Card } from '@/shared/ui/card'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
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
        <FieldGroup className="mt-4 gap-4">
          <Field orientation="horizontal" className="min-h-11 justify-between gap-4 has-[>[data-slot=field-content]]:items-center">
            <FieldContent className="gap-1">
              <FieldLabel htmlFor="training-auto-switch" className="text-foreground">自动切换</FieldLabel>
              <FieldDescription className="text-xs">当前目标材料齐备后，继续筹备下一位</FieldDescription>
            </FieldContent>
            <Switch id="training-auto-switch" size="sm" aria-label="自动切换" aria-describedby={settingsReady ? undefined : descriptionId} disabled={!settingsReady} checked={settings.autoSwitch} onCheckedChange={checked => onUpdate({ autoSwitch: checked })} />
          </Field>
          <Field orientation="horizontal" className="min-h-11 justify-between gap-4 has-[>[data-slot=field-content]]:items-center">
            <FieldContent className="gap-1">
              <FieldLabel htmlFor="training-notify-on-complete" className="text-foreground">完成通知</FieldLabel>
              <FieldDescription className="text-xs">目标材料筹备完成时发送通知</FieldDescription>
            </FieldContent>
            <Switch id="training-notify-on-complete" size="sm" aria-label="完成通知" aria-describedby={settingsReady ? undefined : descriptionId} disabled={!settingsReady} checked={settings.notifyOnComplete} onCheckedChange={checked => onUpdate({ notifyOnComplete: checked })} />
          </Field>
        </FieldGroup>
      </div>
    </Card>
  )
}
