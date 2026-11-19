import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import type { AutomationSelectItem } from './automationSelectItems'

interface AutomationSelectFieldProps {
  id?: string
  items: AutomationSelectItem[]
  value?: string | null
  disabled?: boolean
  onValueChange: (value: string) => void
  className?: string
  'aria-label'?: string
}

export default function AutomationSelectField({
  id,
  items,
  value,
  disabled,
  onValueChange,
  className,
  'aria-label': ariaLabel,
}: AutomationSelectFieldProps) {
  return (
    <Select items={items} value={value} onValueChange={(next, details) => { if (details.reason === 'none' || next === null) return; onValueChange(next) }} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className ?? 'w-full'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(item => (
          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
