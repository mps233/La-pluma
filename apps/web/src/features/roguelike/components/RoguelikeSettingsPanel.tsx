import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { FieldHint } from '@/shared/components'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import type { ConfigLoadState } from '@/features/user-config'
import type { StopMode } from '@/features/task-execution'
import {
  getRoguelikeAdvancedOptions,
  getRoguelikeOptionChoices,
  isRoguelikeOptionVisible,
  resolveRoguelikeAdvancedValue,
} from '../model/roguelikeTasks'
import type { RoguelikeFieldError } from '../model/roguelikeValidation'
import RoguelikeCoreOperatorField from './RoguelikeCoreOperatorField'
import type { RoguelikeAdvancedOption, RoguelikeAdvancedValues, RoguelikeTask } from '../types'

function UnavailableAction({
  action,
  reason,
  children,
}: {
  action: string
  reason: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="flex w-full min-w-0" aria-label={`${action}：${reason}`} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent role="tooltip">{reason}</TooltipContent>
    </Tooltip>
  )
}

interface RoguelikeSelectProps {
  id: string
  label: string
  name?: string
  items: ReadonlyArray<{ value: string; label: string }>
  value: string
  hint?: string
  error?: string
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
  error,
  disabled,
  onValueChange,
}: RoguelikeSelectProps) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium text-muted-foreground">{label}</label>
        {hint && <FieldHint id={hintId} label={label} hint={hint} />}
      </div>
      <Select
        name={name}
        items={items}
        value={value}
        onValueChange={(next, details) => {
          if (disabled || details.reason === 'none' || next === null) return
          onValueChange(next)
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? errorId : undefined}
          className="w-full"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(item => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p id={errorId} className="mt-2 text-xs form-error-text">{error}</p>}
    </div>
  )
}

interface RoguelikeFieldInputProps {
  id: string
  label: string
  hint?: string
  error?: string
  className?: string
}

function RoguelikeFieldInput({
  id,
  label,
  hint,
  error,
  className,
  ...inputProps
}: RoguelikeFieldInputProps & ComponentProps<'input'>) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium text-muted-foreground">{label}</label>
        {hint && <FieldHint id={hintId} label={label} hint={hint} />}
      </div>
      <Input
        id={id}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? errorId : undefined}
        {...inputProps}
      />
      {error && <p id={errorId} className="mt-2 text-xs form-error-text">{error}</p>}
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
  editable: boolean
  fieldError: RoguelikeFieldError | null
  configReady: boolean
  configLoadState: ConfigLoadState
  configLoadError: string | null
  onReloadConfig: () => void
  onAdvancedChange: (key: string, value: string | number | boolean) => void
  execution: RoguelikeExecutionControls
}

export default function RoguelikeSettingsPanel({
  task,
  theme,
  advanced,
  editable,
  fieldError,
  configReady,
  configLoadState,
  configLoadError,
  onReloadConfig,
  onAdvancedChange,
  execution,
}: RoguelikeSettingsPanelProps) {
  const stopButtonRef = useRef<HTMLButtonElement>(null)
  const executeButtonRef = useRef<HTMLButtonElement>(null)
  const focusStopAfterStartRef = useRef(false)
  const focusExecuteAfterTerminalRef = useRef(false)
  const options = getRoguelikeAdvancedOptions(task.id)
    .filter(option => isRoguelikeOptionVisible(option, task.id, theme, advanced))
  const fieldOptions = options.filter(option => option.type !== 'checkbox')
  const toggleOptions = options.filter(option => option.type === 'checkbox')
  const errorFor = (key: string) => fieldError?.key === key ? fieldError.message : undefined

  useEffect(() => {
    if (execution.isRunning && focusStopAfterStartRef.current) {
      focusStopAfterStartRef.current = false
      stopButtonRef.current?.focus()
    }
    if (!execution.isRunning && !execution.isSubmitting) {
      focusStopAfterStartRef.current = false
    }
  }, [execution.isRunning, execution.isSubmitting])

  useEffect(() => {
    if (!execution.isRunning && focusExecuteAfterTerminalRef.current) {
      focusExecuteAfterTerminalRef.current = false
      executeButtonRef.current?.focus()
    }
  }, [execution.isRunning])

  const handleExecuteClick = () => {
    if (!editable || !execution.automationAvailable) return
    focusStopAfterStartRef.current = true
    execution.onExecute()
  }

  const handleStopClick = (mode: StopMode) => {
    focusExecuteAfterTerminalRef.current = true
    execution.onStop(mode)
  }

  const handleFieldChange = (key: string, value: string | number | boolean) => {
    if (!editable) return
    onAdvancedChange(key, value)
  }

  const executeButton = (
    <Button
      ref={executeButtonRef}
      onClick={handleExecuteClick}
      disabled={!editable || !execution.automationAvailable}
      aria-busy={execution.isSubmitting || undefined}
      className="roguelike-run-button min-h-11"
    >
      {execution.isSubmitting
        ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在启动</>
        : '开始'}
    </Button>
  )

  return (
    <Card className="roguelike-panel roguelike-settings-panel gap-0 p-0!" data-monitor-area="settings">
      <div className="roguelike-panel-heading">
        <h2>策略设置</h2>
      </div>
      <div className="roguelike-panel-body">
        {configReady ? (
          <>
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
                        onValueChange={value => handleFieldChange(option.key, value)}
                        items={selectOptionsFor(option, theme, displayValue, task.id)}
                        hint={option.hint}
                        error={errorFor(option.key)}
                        disabled={!editable}
                      />
                    ) : option.type === 'operator' ? (
                      <RoguelikeCoreOperatorField
                        id={`roguelike-${task.id}-${option.key}`}
                        label={option.label}
                        value={displayValue}
                        error={errorFor(option.key)}
                        disabled={!editable}
                        onChange={(value: string) => handleFieldChange(option.key, value)}
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
                        onChange={event => handleFieldChange(option.key, event.target.value)}
                        placeholder={option.placeholder}
                        hint={option.hint}
                        error={errorFor(option.key)}
                        disabled={!editable}
                      />
                    )}
                  </div>
                )
              })}
            </div>
            {toggleOptions.length > 0 && (
              <div className="roguelike-toggle-list">
                {toggleOptions.map(option => {
                  const switchId = `roguelike-${task.id}-${option.key}`
                  return (
                    <div key={option.key} className="roguelike-toggle-row">
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <label htmlFor={switchId} className="roguelike-toggle-label min-h-11">{option.label}</label>
                        {option.hint && (
                          <>
                            <span id={`${switchId}-description`} className="sr-only">{option.hint}</span>
                            <FieldHint id={`${switchId}-hint`} label={option.label} hint={option.hint} />
                          </>
                        )}
                      </div>
                      <Switch
                        id={switchId}
                        name={`maa-${task.id}-${option.key}`}
                        checked={resolveRoguelikeAdvancedValue(option, advanced, theme, task.id) === true}
                        onCheckedChange={checked => handleFieldChange(option.key, checked)}
                        disabled={!editable}
                        aria-label={option.label}
                        aria-describedby={option.hint ? `${switchId}-description` : undefined}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : configLoadState === 'failed' ? (
          <div
            role="alert"
            aria-live="assertive"
            className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-4 text-center"
          >
            <AlertTriangle size={22} strokeWidth={1.9} className="text-destructive" aria-hidden="true" />
            <div className="w-full min-w-0 space-y-1">
              <p className="text-sm font-medium">肉鸽配置暂时不可用</p>
              <p className="line-clamp-2 wrap-break-word text-xs text-muted-foreground">
                {configLoadError ?? '请稍后重新加载'}
              </p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={onReloadConfig}>
              重新加载
            </Button>
          </div>
        ) : (
          <div
            role="status"
            aria-live="polite"
            className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-4 text-center"
          >
            <LoaderCircle size={22} strokeWidth={1.9} className="animate-spin" aria-hidden="true" />
            <p className="text-sm font-medium">正在读取肉鸽配置…</p>
          </div>
        )}
      </div>
      <div className="roguelike-panel-footer">
        {execution.isRunning ? (
          <div className="roguelike-stop-actions">
            <Button
              ref={stopButtonRef}
              onClick={() => handleStopClick('now')}
              disabled={execution.isStopping || execution.pendingStopMode !== null}
              aria-busy={execution.isStopping || undefined}
              variant="destructive"
              className="roguelike-run-button min-h-11"
            >
              {execution.pendingStopMode === 'now' || (execution.isStopping && execution.pendingStopMode !== 'after-combat')
                ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在终止</>
                : '终止'}
            </Button>
            {execution.isWaitingForCombat ? (
              <UnavailableAction action="等待战斗结束" reason="最多等待 10 分钟">
                <Button
                  onClick={() => handleStopClick('after-combat')}
                  disabled
                  aria-busy
                  variant="secondary"
                  className="roguelike-run-button min-h-11"
                >
                  <><LoaderCircle className="animate-spin" aria-hidden="true" />等待战斗结束</>
                </Button>
              </UnavailableAction>
            ) : (
              <Button
                onClick={() => handleStopClick('after-combat')}
                disabled={execution.isStopping || execution.pendingStopMode !== null}
                variant="secondary"
                className="roguelike-run-button min-h-11"
              >
                等待战斗结束
              </Button>
            )}
          </div>
        ) : execution.automationAvailable ? (
          executeButton
        ) : (
          <UnavailableAction action="开始" reason={execution.unavailableMessage}>
            {executeButton}
          </UnavailableAction>
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
