import { FieldHint } from '@/shared/components'
import { Checkbox } from '@/shared/ui/checkbox'
import { Field, FieldLabel, FieldLegend } from '@/shared/ui/field'

interface AutomationFieldLabelProps {
  htmlFor: string
  label: string
  hint?: string
}

export function AutomationFieldLabel({ htmlFor, label, hint }: AutomationFieldLabelProps) {
  return (
    <Field orientation="horizontal" className="min-w-max gap-1">
      <FieldLabel htmlFor={htmlFor} className="text-muted-foreground">{label}</FieldLabel>
      {hint && <FieldHint id={`${htmlFor}-hint`} label={label} hint={hint} />}
    </Field>
  )
}

interface AutomationFieldLegendProps {
  label: string
  hintId?: string
  hint?: string
}

export function AutomationFieldLegend({ label, hintId, hint }: AutomationFieldLegendProps) {
  return (
    <FieldLegend variant="label" className="mb-2">
      <span className="inline-flex items-center gap-1">
        {label}
        {hint && hintId && <FieldHint id={hintId} label={label} hint={hint} />}
      </span>
    </FieldLegend>
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
  return (
    <Field
      orientation="horizontal"
      data-disabled={disabled || undefined}
      className="group min-h-11 w-fit gap-1"
    >
      <FieldLabel
        htmlFor={id}
        className="min-h-11 cursor-pointer gap-2 rounded-md text-sm font-normal text-gray-700 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-data-checked:bg-transparent dark:text-gray-300 dark:has-data-checked:bg-transparent"
      >
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={nextChecked => onChange(nextChecked)}
          disabled={disabled}
        />
        <span className="transition-colors group-hover:text-primary">{label}</span>
      </FieldLabel>
      {hint && <FieldHint id={`${id}-hint`} label={label} hint={hint} />}
    </Field>
  )
}
