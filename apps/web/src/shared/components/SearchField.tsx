import { useRef, type ComponentProps } from 'react'
import { Search, X } from 'lucide-react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/shared/ui/input-group'

export interface SearchFieldProps
  extends Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange' | 'className' | 'aria-label' | 'ref'> {
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly ariaLabel: string
  readonly className?: string
  readonly inputClassName?: string
  readonly clearable?: boolean
  readonly clearLabel?: string
  readonly onClear?: () => void
}

export default function SearchField({
  value,
  onValueChange,
  ariaLabel,
  className,
  inputClassName,
  clearable = false,
  clearLabel = '清除搜索',
  onClear,
  autoComplete = 'off',
  disabled,
  ...inputProps
}: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const clear = () => {
    onValueChange('')
    onClear?.()
    inputRef.current?.focus()
  }

  return (
    <InputGroup className={className}>
      <InputGroupAddon align="inline-start">
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        {...inputProps}
        ref={inputRef}
        type="text"
        value={value}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-label={ariaLabel}
        className={inputClassName}
        onChange={event => onValueChange(event.target.value)}
      />
      {clearable && value !== '' && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={clearLabel}
            title={clearLabel}
            disabled={disabled}
            onClick={clear}
          >
            <X data-icon="inline-start" aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
