import { Play, Square } from 'lucide-react'
import { Button, Input, Select, SmoothPanel, Switch } from '@/shared/components'
import type { StopMode } from '@/features/task-execution'
import {
  getRoguelikeAdvancedOptions,
  getRoguelikeOptionChoices,
  isRoguelikeOptionVisible,
  resolveRoguelikeAdvancedValue,
} from '../model/roguelikeTasks'
import RoguelikeCoreOperatorField from './RoguelikeCoreOperatorField'
import type { RoguelikeAdvancedOption, RoguelikeAdvancedValues, RoguelikeTask } from '../types'

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
    <SmoothPanel className="roguelike-panel roguelike-settings-panel">
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
                  <Select
                    id={`roguelike-${task.id}-${option.key}`}
                    name={`maa-${task.id}-${option.key}`}
                    label={option.label}
                    value={displayValue}
                    onChange={(value: string) => onAdvancedChange(option.key, value)}
                    options={selectOptionsFor(option, theme, displayValue, task.id)}
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
                  <Input
                    id={`roguelike-${task.id}-${option.key}`}
                    name={`maa-${task.id}-${option.key}`}
                    type={option.type === 'number' ? 'number' : 'text'}
                    min={option.type === 'number' ? option.numberRange?.min : undefined}
                    max={option.type === 'number' ? option.numberRange?.max : undefined}
                    step={option.type === 'number' ? 1 : undefined}
                    label={option.label}
                    value={displayValue}
                    onChange={(value: string) => onAdvancedChange(option.key, value)}
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
              <div key={option.key} className="roguelike-toggle-row">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={`roguelike-${task.id}-${option.key}`}
                    className="roguelike-toggle-label min-h-11"
                  >
                    {option.label}
                  </label>
                  {option.hint && (
                    <p
                      id={`roguelike-${task.id}-${option.key}-hint`}
                      className="pb-2 pr-2 text-xs leading-5 text-tertiary"
                    >
                      {option.hint}
                    </p>
                  )}
                </div>
                <Switch
                  id={`roguelike-${task.id}-${option.key}`}
                  name={`maa-${task.id}-${option.key}`}
                  checked={resolveRoguelikeAdvancedValue(option, advanced, theme, task.id) === true}
                  onChange={(checked: boolean) => onAdvancedChange(option.key, checked)}
                  label={option.label}
                  aria-describedby={option.hint ? `roguelike-${task.id}-${option.key}-hint` : undefined}
                />
              </div>
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
              loading={execution.pendingStopMode === 'now'
                || (execution.isStopping && execution.pendingStopMode !== 'after-combat')}
              loadingText="正在终止"
              variant="danger"
              size="md"
              icon={!execution.isStopping ? <Square size={14} fill="currentColor" aria-hidden="true" /> : undefined}
              className="roguelike-run-button min-h-11"
            >
              立即终止
            </Button>
            <Button
              onClick={() => execution.onStop('after-combat')}
              disabled={execution.isWaitingForCombat || execution.isStopping || execution.pendingStopMode !== null}
              loading={execution.isWaitingForCombat || execution.pendingStopMode === 'after-combat'}
              loadingText="等待战斗结束"
              title={execution.isWaitingForCombat ? '最多等待 10 分钟' : undefined}
              variant="secondary"
              size="md"
              className="roguelike-run-button min-h-11"
            >
              等待战斗结束
            </Button>
          </div>
        ) : (
          <Button
            onClick={execution.onExecute}
            disabled={!execution.automationAvailable}
            loading={execution.isSubmitting}
            loadingText="正在启动"
            title={!execution.automationAvailable ? execution.unavailableMessage : undefined}
            variant="primary"
            size="md"
            icon={<Play size={15} fill="currentColor" aria-hidden="true" />}
            className="roguelike-run-button"
          >
            立即执行
          </Button>
        )}
      </div>
    </SmoothPanel>
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
