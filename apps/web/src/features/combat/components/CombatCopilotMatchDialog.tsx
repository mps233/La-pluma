import { DialogBody, DialogFrame, DialogFrameFooter } from '@/shared/components'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Switch } from '@/shared/ui/switch'
import {
  COPILOT_MATCH_MODES,
  type CopilotMatchMode,
} from '../model/copilotDiscovery'
import type { CombatCopilotMatchSettings } from './combatPanelTypes'

export interface CombatCopilotMatchDialogProps {
  isOpen: boolean
  settings: CombatCopilotMatchSettings
  ownedOperatorNames: ReadonlySet<string>
  onChange: (settings: CombatCopilotMatchSettings) => void
  onClose: () => void
}

const ALL_MODES = COPILOT_MATCH_MODES.map(({ mode }) => mode)

export default function CombatCopilotMatchDialog({
  isOpen,
  settings,
  ownedOperatorNames,
  onChange,
  onClose,
}: CombatCopilotMatchDialogProps) {
  const hasOwnedOperators = ownedOperatorNames.size > 0

  const handleEnabledChange = (enabled: boolean) => {
    onChange({ ...settings, enabled })
  }

  const handleModeChange = (mode: CopilotMatchMode, checked: boolean) => {
    const next = new Set(settings.modes)
    if (checked) next.add(mode)
    else next.delete(mode)
    onChange({ ...settings, modes: ALL_MODES.filter(candidate => next.has(candidate)) })
  }

  return (
    <DialogFrame
      open={isOpen}
      onOpenChange={open => { if (!open) onClose() }}
      title="干员匹配"
      size="md"
      footer={(
        <DialogFrameFooter>
          <Button variant="secondary" onClick={onClose}>关闭</Button>
        </DialogFrameFooter>
      )}
    >
      <DialogBody>
        <div className="combat-copilot-match">
          <div className="combat-copilot-match-toggle">
            <div className="combat-copilot-match-toggle-copy">
              <span className="combat-copilot-match-toggle-title">按持有干员匹配</span>
              <span className="combat-copilot-match-toggle-hint">使用最近一次持有干员识别结果</span>
            </div>
            <Switch
              aria-label="按持有干员匹配"
              checked={settings.enabled}
              disabled={!hasOwnedOperators}
              onCheckedChange={handleEnabledChange}
            />
          </div>

          {!hasOwnedOperators && (
            <p className="combat-copilot-match-warning" role="status">
              还没有识别到持有干员，先识别持有干员后再启用匹配。
            </p>
          )}

          <p className="combat-copilot-match-note">
            按精英化阶段与等级估算；技能等级与模组尚未识别，相关作业统一归入“待确认”。
            匹配只过滤当前搜索结果，不会重新请求作业站。
          </p>

          <div className="combat-copilot-match-modes" role="group" aria-label="匹配模式">
            <span className="combat-copilot-match-modes-title">显示以下匹配结论</span>
            <div className="combat-copilot-match-mode-list">
              {COPILOT_MATCH_MODES.map(({ mode, label }) => (
                <label key={mode} className="group flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={settings.modes.includes(mode)}
                    onCheckedChange={checked => handleModeChange(mode, checked)}
                  />
                  <span className="transition-colors group-hover:text-primary">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </DialogBody>
    </DialogFrame>
  )
}
