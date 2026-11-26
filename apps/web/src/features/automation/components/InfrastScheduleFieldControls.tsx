import { useId, type ComponentProps } from 'react'
import { Checkbox } from '@/shared/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

export function FieldInput({
  id,
  label,
  hint,
  className,
  ...inputProps
}: {
  id: string
  label: string
  hint?: string
  className?: string
} & ComponentProps<'input'>) {
  const hintId = `${id}-hint`
  return (
    <Field className={className} data-disabled={inputProps.disabled || undefined}>
      <FieldLabel htmlFor={id} className="text-muted-foreground">{label}</FieldLabel>
      <Input id={id} autoComplete="off" aria-describedby={hint ? hintId : undefined} {...inputProps} />
      {hint && <FieldDescription id={hintId} className="text-xs text-tertiary">{hint}</FieldDescription>}
    </Field>
  )
}

export interface FieldSelectProps {
  id: string
  label: string
  ariaLabel?: string
  className?: string
  items: ReadonlyArray<{ value: string; label: string }>
  value: string
  hint?: string
  disabled?: boolean
  onValueChange: (value: string) => void
}

export function FieldSelect({
  id,
  label,
  ariaLabel,
  className,
  items,
  value,
  hint,
  disabled,
  onValueChange,
}: FieldSelectProps) {
  const hintId = `${id}-hint`
  return (
    <Field className={className} data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id} className="text-muted-foreground">{label}</FieldLabel>
      <Select
        items={items}
        value={value}
        onValueChange={(next, details) => { if (details.reason !== 'none' && next !== null) onValueChange(next) }}
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-label={ariaLabel} aria-describedby={hint ? hintId : undefined} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(item => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <FieldDescription id={hintId} className="text-xs text-tertiary">{hint}</FieldDescription>}
    </Field>
  )
}

export function FieldFlagCheckbox({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const id = useId().replace(/:/g, '')
  return (
    <Field
      orientation="horizontal"
      data-disabled={disabled || undefined}
      className="group min-h-11 gap-2 text-sm text-muted-foreground"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <FieldLabel htmlFor={id} className="cursor-pointer font-normal transition-colors group-hover:text-primary">{label}</FieldLabel>
    </Field>
  )
}
