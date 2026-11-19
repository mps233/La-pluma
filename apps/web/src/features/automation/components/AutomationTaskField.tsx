import { Info, Minus, Plus } from 'lucide-react'
import { Checkbox } from '@/shared/ui/checkbox'
import { Input } from '@/shared/ui/input'
import AutomationStageEditor from './AutomationStageEditor'
import AutomationSelectField from './AutomationSelectField'
import { asSelectItems } from './automationSelectItems'
import { AutomationCheckboxField, AutomationFieldLabel, AutomationFieldLegend } from './AutomationFieldControls'
import InfrastScheduleField from './InfrastScheduleField'
import OperProgressPlansEditor from './OperProgressPlansEditor'
import ThemeListEditor from './ThemeListEditor'
import { resolveFieldHelperTooltip } from '../model/taskFieldHelper'
import type { TaskFlowItem, TaskParamField, TaskParamKey, TaskParamValue } from '../types'

interface AutomationTaskFieldProps {
  task: TaskFlowItem
  field: TaskParamField
  taskIndex: number
  isEditingLocked: boolean
  onUpdateParam: (taskIndex: number, key: TaskParamKey, value: TaskParamValue) => void
  onSuccess: (message: string) => void
  onError: (message: string) => void
}

const readCheckboxValue = (value: TaskParamValue): boolean => Boolean(value)

const readNumberSelection = (value: TaskParamValue): number[] => (
  Array.isArray(value) ? value as number[] : []
)

const readStringSelection = (value: TaskParamValue): string[] => (
  Array.isArray(value) ? value as string[] : []
)

const readInputValue = (value: TaskParamValue): string | number => (
  typeof value === 'string' || typeof value === 'number' ? value || '' : ''
)

const readSelectValue = (value: TaskParamValue, fallback: string): string => (
  (value as string | null | undefined) || fallback
)

export default function AutomationTaskField({
  task,
  field,
  taskIndex,
  isEditingLocked,
  onUpdateParam,
  onSuccess,
  onError,
}: AutomationTaskFieldProps) {
  if (field.visibleWhen && String(task.params[field.visibleWhen.key] ?? '') !== String(field.visibleWhen.value)) {
    return null
  }
  if (field.hiddenWhen && String(task.params[field.hiddenWhen.key] ?? '') === String(field.hiddenWhen.value)) {
    return null
  }

  const fieldId = `automation-${task.id}-${field.key}`
  const helperTooltip = resolveFieldHelperTooltip(field)
  const disabled = isEditingLocked || !task.enabled

  return (
    <div className={`automation-param-field is-${field.type}`}>
      {field.type === 'oper-progress-plans' ? (
        <OperProgressPlansEditor plans={task.params.plans ?? []} disabled={disabled} onChange={plans => onUpdateParam(taskIndex, 'plans', plans)} />
      ) : field.type === 'theme-list' ? (
        <ThemeListEditor themes={task.params.themes ?? []} disabled={disabled} onChange={themes => onUpdateParam(taskIndex, 'themes', themes)} />
      ) : field.type === 'infrast-schedule' ? (
        <InfrastScheduleField
          fieldId={fieldId}
          filename={typeof task.params.filename === 'string' ? task.params.filename : ''}
          planIndex={task.params.plan_index ?? 0}
          disabled={disabled}
          onChange={(key, value) => onUpdateParam(taskIndex, key, value)}
        />
      ) : field.type === 'checkbox' ? (
        <AutomationCheckboxField
          id={fieldId}
          label={field.label}
          checked={readCheckboxValue(task.params[field.key])}
          disabled={disabled}
          hint={helperTooltip}
          onChange={(checked) => onUpdateParam(taskIndex, field.key, checked)}
        />
      ) : field.type === 'multi-stages' ? (
        <AutomationStageEditor
          field={field}
          fieldId={fieldId}
          task={task}
          taskIndex={taskIndex}
          isRunning={isEditingLocked}
          hint={helperTooltip}
          onUpdate={onUpdateParam}
          onSuccess={onSuccess}
          onError={onError}
        />
      ) : field.type === 'star-select' ? (
        <fieldset>
          <AutomationFieldLegend label={field.label} hintId={`${fieldId}-hint`} hint={helperTooltip} />
          <div className="flex items-center space-x-2 flex-wrap">
            {[3, 4, 5, 6].map(star => {
              const currentValue = readNumberSelection(task.params[field.key]);
              const isChecked = currentValue.includes(star);
              const optionId = `${fieldId}-${star}`
              return (
                <label key={star} className="group flex min-h-11 cursor-pointer items-center space-x-1 text-sm text-gray-700 dark:text-gray-300">
                  <Checkbox
                    id={optionId}
                    checked={isChecked}
                    onCheckedChange={(checked) => {
                      const newValue = checked
                        ? [...currentValue, star].sort()
                        : currentValue.filter((s: number) => s !== star);
                      onUpdateParam(taskIndex, field.key, newValue);
                    }}
                    disabled={disabled}
                  />
                  <span className="group-hover:text-primary transition-colors flex items-center space-x-1">
                    <span>{star}</span>
                    <svg className="w-3.5 h-3.5 brand-text" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  </span>
                </label>
              );
            })}
          </div>
          {task.id === 'recruit' && field.key === 'select' && Array.isArray(task.params.select) && task.params.select.includes(6) && (
            <div className="mt-2 rounded-xl px-3 py-2 text-xs brand-chip">
              已开启 6 星自动公招：遇到高级资深干员等高价值标签时，会优先保留并自动选择。
            </div>
          )}
        </fieldset>
      ) : field.type === 'facility-select' ? (
        <fieldset>
          <legend className="automation-field-label mb-2 block">{field.label}</legend>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'Mfg', label: '制造站' },
              { value: 'Trade', label: '贸易站' },
              { value: 'Power', label: '发电站' },
              { value: 'Control', label: '控制中枢' },
              { value: 'Reception', label: '会客室' },
              { value: 'Office', label: '办公室' },
              { value: 'Recycle', label: '回收站' },
              { value: 'Dorm', label: '宿舍' },
              { value: 'Processing', label: '加工站' },
              { value: 'Training', label: '训练室' },
              { value: 'AssistantChange', label: '副手换人' }
            ].map(facility => {
              const currentValue = readStringSelection(task.params[field.key]);
              const isChecked = currentValue.includes(facility.value);
              const optionId = `${fieldId}-${facility.value}`
              return (
                <label key={facility.value} className="group flex min-h-11 cursor-pointer items-center space-x-1 text-sm text-gray-700 dark:text-gray-300">
                  <Checkbox
                    id={optionId}
                    checked={isChecked}
                    onCheckedChange={(checked) => {
                      const newValue = checked
                        ? [...currentValue, facility.value]
                        : currentValue.filter((f: string) => f !== facility.value);
                      onUpdateParam(taskIndex, field.key, newValue);
                    }}
                    disabled={disabled}
                  />
                  <span className="group-hover:text-primary transition-colors">{facility.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : field.type === 'select' ? (
        <div className="automation-field-row">
          <AutomationFieldLabel htmlFor={fieldId} label={field.label} hint={helperTooltip} />
          <AutomationSelectField
            id={fieldId}
            items={asSelectItems(field.options)}
            value={readSelectValue(task.params[field.key], asSelectItems(field.options)[0]?.value ?? '')}
            disabled={disabled}
            onValueChange={(value) => onUpdateParam(taskIndex, field.key, value)}
          />
        </div>
      ) : (
        <div className="automation-field-row">
          <AutomationFieldLabel htmlFor={fieldId} label={field.label} hint={helperTooltip} />
          {field.type === 'number' ? (
            <div className="number-input-wrapper flex-1">
              <Input
                id={fieldId}
                type="number"
                autoComplete="off"
                value={readInputValue(task.params[field.key])}
                onChange={(e) => onUpdateParam(taskIndex, field.key, e.target.value)}
                placeholder={field.placeholder}
                step={field.step}
                min={field.min}
                max={field.max}
                disabled={disabled}
                className="min-w-0 workbench:pr-16"
              />
              <div className="number-input-controls hidden workbench:flex">
                <button
                  type="button"
                  onClick={() => {
                    const currentValue = Number(task.params[field.key]) || 0;
                    const step = Number(field.step) || 1;
                    const min = field.min !== undefined ? Number(field.min) : -Infinity;
                    const newValue = Math.max(currentValue - step, min);
                    onUpdateParam(taskIndex, field.key, newValue.toString());
                  }}
                  disabled={disabled}
                  aria-label={`减少${field.label}`}
                >
                  <Minus size={14} strokeWidth={2.2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const currentValue = Number(task.params[field.key]) || 0;
                    const step = Number(field.step) || 1;
                    const max = field.max !== undefined ? Number(field.max) : Infinity;
                    const newValue = Math.min(currentValue + step, max);
                    onUpdateParam(taskIndex, field.key, newValue.toString());
                  }}
                  disabled={disabled}
                  aria-label={`增加${field.label}`}
                >
                  <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <Input
              id={fieldId}
              type={field.type}
              autoComplete="off"
              value={readInputValue(task.params[field.key])}
              onChange={(e) => onUpdateParam(taskIndex, field.key, e.target.value)}
              placeholder={field.placeholder}
              step={field.step}
              min={field.min}
              max={field.max}
              disabled={disabled}
            />
          )}
        </div>
      )}
      {field.helper && !helperTooltip && (
        <p className="automation-field-helper">
          <Info size={13} strokeWidth={1.8} aria-hidden="true" />
          <span>{field.helper}</span>
        </p>
      )}
    </div>
  )
}
