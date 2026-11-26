import { DialogBody, DialogFrame, DialogFrameFooter, InlineAlert, Loading } from '@/shared/components'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/shared/ui/field'
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
  operatorsLoading?: boolean
  operatorsError?: string | null
  onRetryData?: () => void
  onChange: (settings: CombatCopilotMatchSettings) => void
  onClose: () => void
}

const ALL_MODES = COPILOT_MATCH_MODES.map(({ mode }) => mode)

export default function CombatCopilotMatchDialog({
  isOpen,
  settings,
  ownedOperatorNames,
  operatorsLoading = false,
  operatorsError = null,
  onRetryData,
  onChange,
  onClose,
}: CombatCopilotMatchDialogProps) {
  const hasOwnedOperators = ownedOperatorNames.size > 0
  const unavailable = operatorsLoading || Boolean(operatorsError)
  const matchingAvailable = hasOwnedOperators && !unavailable

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
          <Field orientation="horizontal" className="combat-copilot-match-toggle items-center! gap-3">
            <FieldContent className="gap-0.5">
              <FieldTitle className="text-[0.8125rem] font-semibold text-foreground">按持有干员匹配</FieldTitle>
              <FieldDescription className="text-xs">使用最近一次持有干员识别结果</FieldDescription>
            </FieldContent>
            <Switch
              aria-label="按持有干员匹配"
              checked={matchingAvailable ? settings.enabled : false}
              disabled={!matchingAvailable}
              onCheckedChange={handleEnabledChange}
            />
          </Field>

          {operatorsLoading ? (
            <Loading size="sm" text="正在识别持有干员…" />
          ) : operatorsError ? (
            <InlineAlert title="持有干员读取失败" onRetry={() => onRetryData?.()}>
              {operatorsError}
            </InlineAlert>
          ) : !hasOwnedOperators ? (
            <InlineAlert tone="warning">
              还没有识别到持有干员，先识别持有干员后再启用匹配。
            </InlineAlert>
          ) : null}

          <p className="combat-copilot-match-note">
            按精英化阶段与等级估算；技能等级与模组尚未识别，相关作业统一归入“待确认”。
            匹配只过滤当前搜索结果，不会重新请求作业站。
          </p>

          <div className="combat-copilot-match-modes" role="group" aria-label="匹配模式">
            <FieldTitle className="text-xs font-normal text-muted-foreground">显示以下匹配结论</FieldTitle>
            <div className="combat-copilot-match-mode-list">
              {COPILOT_MATCH_MODES.map(({ mode, label }) => (
                <Field key={mode} orientation="horizontal" className="min-h-11 gap-2">
                  <Checkbox
                    id={`combat-copilot-match-${mode}`}
                    checked={settings.modes.includes(mode)}
                    onCheckedChange={checked => handleModeChange(mode, checked)}
                  />
                  <FieldLabel
                    htmlFor={`combat-copilot-match-${mode}`}
                    className="cursor-pointer text-sm font-normal text-muted-foreground transition-colors hover:text-primary"
                  >
                    {label}
                  </FieldLabel>
                </Field>
              ))}
            </div>
          </div>
        </div>
      </DialogBody>
    </DialogFrame>
  )
}
