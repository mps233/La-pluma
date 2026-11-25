import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Checkbox } from '@/shared/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

const controlClassName = 'min-w-0 flex-1 sm:max-w-72'

export function ConfigFieldInput({
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
    <Field orientation="horizontal" className={cn('min-h-11 gap-3.5', className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <FieldLabel htmlFor={id} className="text-sm font-medium whitespace-nowrap text-foreground">{label}</FieldLabel>
        {hint && <FieldDescription id={hintId} className="text-xs leading-5 text-muted-foreground">{hint}</FieldDescription>}
      </div>
      <Input
        id={id}
        autoComplete="off"
        aria-describedby={hint ? hintId : undefined}
        className={controlClassName}
        {...inputProps}
      />
    </Field>
  )
}

export interface ConfigFieldSelectProps {
  id: string
  label: string
  items: ReadonlyArray<{ value: string; label: string }>
  value: string
  hint?: string
  disabled?: boolean
  className?: string
  onValueChange: (value: string) => void
}

export function ConfigFieldSelect({
  id,
  label,
  items,
  value,
  hint,
  disabled,
  className,
  onValueChange,
}: ConfigFieldSelectProps) {
  const hintId = `${id}-hint`
  return (
    <Field orientation="horizontal" className={cn('min-h-11 gap-3.5', className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <FieldLabel htmlFor={id} className="text-sm font-medium whitespace-nowrap text-foreground">{label}</FieldLabel>
        {hint && <FieldDescription id={hintId} className="text-xs leading-5 text-muted-foreground">{hint}</FieldDescription>}
      </div>
      <Select
        items={items}
        value={value}
        onValueChange={(next, details) => { if (details.reason === 'none' || next === null) return; onValueChange(next) }}
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-describedby={hint ? hintId : undefined} className={controlClassName}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(item => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

export function ConfigFieldCheckbox({
  id,
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <Field orientation="horizontal" className="min-h-11 gap-3.5">
      <FieldLabel htmlFor={id} className="text-sm font-medium whitespace-nowrap text-foreground">{label}</FieldLabel>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </Field>
  )
}
