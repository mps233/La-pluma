import { useId, type ChangeEvent, type InputHTMLAttributes } from 'react'

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
  compact?: boolean
}

export default function Switch({
  id,
  checked,
  label,
  onChange,
  compact = false,
  disabled = false,
  className = '',
  ...props
}: SwitchProps) {
  const generatedId = useId().replace(/:/g, '')
  const inputId = id ?? `switch-${generatedId}`

  return (
    <label
      htmlFor={inputId}
      className={`app-switch${compact ? ' app-switch-compact' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
    >
      <input
        {...props}
        id={inputId}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
      />
      <span className="app-switch-track" aria-hidden="true">
        <span className="app-switch-thumb" />
      </span>
    </label>
  )
}
