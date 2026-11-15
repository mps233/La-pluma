import type { ComponentProps } from 'react'
import { LoaderCircle, Play, Square } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { FieldHint } from '@/shared/components'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import type { StopMode } from '@/features/task-execution'
import {
  getRoguelikeAdvancedOptions,
  getRoguelikeOptionChoices,
  isRoguelikeOptionVisible,
  resolveRoguelikeAdvancedValue,
} from '../model/roguelikeTasks'
import RoguelikeCoreOperatorField from './RoguelikeCoreOperatorField'
import type { RoguelikeAdvancedOption, RoguelikeAdvancedValues, RoguelikeTask } from '../types'

interface RoguelikeSelectProps {
  id: string
  label: string
  name?: string
  items: ReadonlyArray<{ value: string; label: string }>
  value: string
  hint?: string
  hintPlacement?: 'below' | 'tooltip'
  disabled?: boolean
  onValueChange: (value: string) => void
}

function RoguelikeSelect({
  id,
  label,
  name,
  items,
  value,
  hint,
  hintPlacement = 'below',
  disabled,
  onValueChange,
}: RoguelikeSelectProps) {
  const hintId = `${id}-hint`
  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium text-muted-foreground">{label}</label>
        {hintPlacement === 'tooltip' && hint && (
          <FieldHint id={hintId} label={label} hint={hint} />
        )}
      </div>
      <Select
        name={name}
        items={items}
        value={value}
        onValueChange={(next, details) => { if (details.reason === 'none' || next === null) return; onValueChange(next) }}
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-describedby={hint && hintPlacement === 'below' ? hintId : undefined} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(item => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && hintPlacement === 'below' && <p id={hintId} className="mt-2 text-xs text-tertiary">{hint}</p>}
    </div>
  )
}

interface RoguelikeFieldInputProps {
  id: string
  label: string
  hint?: string
  hintPlacement?: 'below' | 'tooltip'
  className?: string
}

function RoguelikeFieldInput({
  id,
  label,
  hint,
  hintPlacement = 'below',
  className,
  ...inputProps
}: RoguelikeFieldInputProps & ComponentProps<'input'>) {
  const hintId = `${id}-hint`
  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium text-muted-foreground">{label}</label>
        {hintPlacement === 'tooltip' && hint && (
          <FieldHint id={hintId} label={label} hint={hint} />
        )}
      </div>
      <Input id={id} autoComplete="off" aria-describedby={hint && hintPlacement === 'below' ? hintId : undefined} {...inputProps} />
      {hint && hintPlacement === 'below' && <p id={hintId} className="mt-2 text-xs text-tertiary">{hint}</p>}
    </div>
  )
}

interface RoguelikeExecutionControls {
  isRunning: boolean
  isStopping: boolean
  isWaitingForCombat: boolean
  pendingStopMode: StopMode | null
  isSubmitting: boolean
  automationAvailable: boolean
  unavailableMessage: string
  onExecute: () => void
  onStop: (mode: StopMode) => void
}

interface RoguelikeSettingsPanelProps {
  task: RoguelikeTask
  theme: string
  advanced: RoguelikeAdvancedValues
  onAdvancedChange: (key: string, value: string | number | boolean) => void
  execution: RoguelikeExecutionControls
}

export default function RoguelikeSettingsPanel({
  task,
  theme,
  advanced,
  onAdvancedChange,
  execution,
}: RoguelikeSettingsPanelProps) {
  const options = getRoguelikeAdvancedOptions(task.id)
    .filter(option => isRoguelikeOptionVisible(option, task.id, theme, advanced))
  const fieldOptions = options.filter(option => option.type !== 'checkbox')
  const toggleOptions = options.filter(option => option.type === 'checkbox')

  return (
    <Card className="roguelike-panel roguelike-settings-panel gap-0 p-0!">
      <div className="roguelike-panel-heading">
        <div>
          <h3>策略设置</h3>
          <p>{task.name}</p>
        </div>
        <span>{options.length} 项</span>
      </div>
      <div className="roguelike-panel-body roguelike-settings-body">
        <div className="roguelike-field-grid">
          {fieldOptions.map(option => {
            const displayValue = String(resolveRoguelikeAdvancedValue(option, advanced, theme, task.id) ?? '')
            return (
              <div
                key={option.key}
                className={option.span === 'full' ? 'roguelike-field-span-full' : undefined}
              >
                {option.type === 'select' ? (
                  <RoguelikeSelect
                    id={`roguelike-${task.id}-${option.key}`}
                    label={option.label}
                    name={`maa-${task.id}-${option.key}`}
                    value={displayValue}
                    onValueChange={value => onAdvancedChange(option.key, value)}
                    items={selectOptionsFor(option, theme, displayValue, task.id)}
                    hint={option.hint}
                    hintPlacement={option.hintPlacement}
                  />
                ) : option.type === 'operator' ? (
                  <RoguelikeCoreOperatorField
                    id={`roguelike-${task.id}-${option.key}`}
                    label={option.label}
                    value={displayValue}
                    onChange={(value: string) => onAdvancedChange(option.key, value)}
                  />
                ) : (
                  <RoguelikeFieldInput
                    id={`roguelike-${task.id}-${option.key}`}
                    name={`maa-${task.id}-${option.key}`}
                    type={option.type === 'number' ? 'number' : 'text'}
                    min={option.type === 'number' ? option.numberRange?.min : undefined}
                    max={option.type === 'number' ? option.numberRange?.max : undefined}
                    step={option.type === 'number' ? 1 : undefined}
                    label={option.label}
                    value={displayValue}
                    onChange={event => onAdvancedChange(option.key, event.target.value)}
                    placeholder={option.placeholder}
                    hint={option.hint}
                    hintPlacement={option.hintPlacement}
                  />
                )}
              </div>
            )
          })}
        </div>
        {toggleOptions.length > 0 && (
          <div className="roguelike-toggle-list">
            {toggleOptions.map(option => (
              <label key={option.key} className="roguelike-toggle-row">
                <span className="min-w-0 flex-1">
                  <span className="roguelike-toggle-label min-h-11">{option.label}</span>
                  {option.hint && (
                    <span
                      id={`roguelike-${task.id}-${option.key}-hint`}
                      className="block pb-2 pr-2 text-xs leading-5 text-tertiary"
                    >
                      {option.hint}
                    </span>
                  )}
                </span>
                <Switch
                  name={`maa-${task.id}-${option.key}`}
                  checked={resolveRoguelikeAdvancedValue(option, advanced, theme, task.id) === true}
                  onCheckedChange={checked => onAdvancedChange(option.key, checked)}
                  aria-label={option.label}
                  aria-describedby={option.hint ? `roguelike-${task.id}-${option.key}-hint` : undefined}
                />
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="roguelike-panel-footer">
        {execution.isRunning ? (
          <div className="roguelike-stop-actions">
            <Button
              onClick={() => execution.onStop('now')}
              disabled={execution.isStopping || execution.pendingStopMode !== null}
              aria-busy={execution.isStopping || undefined}
              variant="destructive"
              className="roguelike-run-button min-h-11"
            >
              {execution.pendingStopMode === 'now' || (execution.isStopping && execution.pendingStopMode !== 'after-combat')
                ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在终止</>
                : (
                  <>
                    {execution.isStopping
                      ? null
                      : <Square size={14} fill="currentColor" aria-hidden="true" />}
                    立即终止
                  </>
                )}
            </Button>
            <Button
              onClick={() => execution.onStop('after-combat')}
              disabled={execution.isWaitingForCombat || execution.isStopping || execution.pendingStopMode !== null}
              aria-busy={execution.isWaitingForCombat || undefined}
              title={execution.isWaitingForCombat ? '最多等待 10 分钟' : undefined}
              variant="secondary"
              className="roguelike-run-button min-h-11"
            >
              {execution.isWaitingForCombat
                ? <><LoaderCircle className="animate-spin" aria-hidden="true" />等待战斗结束</>
                : '等待战斗结束'}
            </Button>
          </div>
        ) : (
          <Button
            onClick={execution.onExecute}
            disabled={!execution.automationAvailable || execution.isSubmitting}
            aria-busy={execution.isSubmitting || undefined}
            title={!execution.automationAvailable ? execution.unavailableMessage : undefined}
            className="roguelike-run-button"
          >
            {execution.isSubmitting
              ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在启动</>
              : (
                <>
                  <Play size={15} fill="currentColor" aria-hidden="true" />
                  立即执行
                </>
              )}
          </Button>
        )}
      </div>
    </Card>
  )
}

/**
 * 下拉项来自当前主题；草稿里保留了旧主题的取值时补一项回显并标注不受支持，
 * 避免原生 select 因为找不到匹配项而显示空白，也不把越界值伪装成合法候选。
 */
function selectOptionsFor(
  option: RoguelikeAdvancedOption,
  theme: string,
  displayValue: string,
  taskId: string,
) {
  const choices = getRoguelikeOptionChoices(option, theme, taskId) ?? []
  if (displayValue === '' || choices.some(choice => choice.value === displayValue)) return choices
  return [...choices, { value: displayValue, label: `${displayValue}（不适用于当前主题）` }]
}
