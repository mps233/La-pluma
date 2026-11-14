import type { ComponentProps } from 'react'
import { Checkbox } from '@/shared/ui/checkbox'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

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
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-muted-foreground">{label}</label>
      <Input id={id} autoComplete="off" aria-describedby={hint ? hintId : undefined} {...inputProps} />
      {hint && <p id={hintId} className="mt-2 text-xs text-tertiary">{hint}</p>}
    </div>
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
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-muted-foreground">{label}</label>
      <Select
        items={items}
        value={value}
        onValueChange={(next, details) => { if (details.reason === 'none' || next === null) return; onValueChange(next) }}
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-describedby={hint ? hintId : undefined} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(item => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p id={hintId} className="mt-2 text-xs text-tertiary">{hint}</p>}
    </div>
  )
}

export function ConfigFieldCheckbox({
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
  return (
    <label className="group flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <span className="transition-colors group-hover:text-primary">{label}</span>
    </label>
  )
}
