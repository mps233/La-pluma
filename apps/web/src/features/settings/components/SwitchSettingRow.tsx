import { Field, FieldLabel } from '@/shared/ui/field'
import { Switch } from '@/shared/ui/switch'

export interface SwitchSettingRowProps {
  readonly id: string
  readonly label: string
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly disabled?: boolean
}

export default function SwitchSettingRow({
  id,
  label,
  checked,
  onCheckedChange,
  disabled = false,
}: SwitchSettingRowProps) {
  return (
    <Field orientation="horizontal" className="min-h-11 gap-3.5">
      <FieldLabel htmlFor={id} className="text-sm font-medium whitespace-nowrap text-foreground">{label}</FieldLabel>
      <Switch
        id={id}
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </Field>
  )
}
