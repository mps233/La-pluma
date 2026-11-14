import { HintTooltip } from '@/shared/components'

interface AutomationFieldLabelProps {
  htmlFor: string
  label: string
  hint?: string
}

export function AutomationFieldLabel({ htmlFor, label, hint }: AutomationFieldLabelProps) {
  const labelElement = <label htmlFor={htmlFor} className="automation-field-label">{label}</label>

  if (!hint) return labelElement

  return (
    <span className="inline-flex min-w-max items-center gap-1">
      {labelElement}
      <HintTooltip id={`${htmlFor}-hint`} label={label} hint={hint} />
    </span>
  )
}

interface AutomationFieldLegendProps {
  label: string
  hintId: string
  hint?: string
}

export function AutomationFieldLegend({ label, hintId, hint }: AutomationFieldLegendProps) {
  if (!hint) return <legend className="automation-field-label mb-2 block">{label}</legend>

  return (
    <legend className="automation-field-label mb-2 block">
      <span className="inline-flex items-center gap-1">
        {label}
        <HintTooltip id={hintId} label={label} hint={hint} />
      </span>
    </legend>
  )
}

interface AutomationCheckboxFieldProps {
  id: string
  label: string
  checked: boolean
  disabled: boolean
  hint?: string
  onChange: (checked: boolean) => void
}

export function AutomationCheckboxField({ id, label, checked, disabled, hint, onChange }: AutomationCheckboxFieldProps) {
  const control = (
    <label htmlFor={id} className="group flex min-h-11 cursor-pointer items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="custom-checkbox cursor-pointer"
      />
      <span className="group-hover:text-primary transition-colors">{label}</span>
    </label>
  )

  if (!hint) return control

  return (
    <div className="flex items-center gap-1">
      {control}
      <HintTooltip id={`${id}-hint`} label={label} hint={hint} />
    </div>
  )
}
