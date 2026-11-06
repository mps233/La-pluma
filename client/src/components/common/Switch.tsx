import { useId, type ButtonHTMLAttributes } from 'react'
import { GlassSwitch } from '@zakisheriff/liquid-glass'

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type' | 'value'> {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
  compact?: boolean
}

/**
 * Liquid Glass switch with native button semantics. `label` is the accessible
 * name only; visible titles stay in the surrounding setting row.
 */
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
  const switchId = id ?? `switch-${generatedId}`

  return (
    <span
      className={`app-switch${compact ? ' app-switch-compact' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
    >
      <GlassSwitch
        {...props}
        id={switchId}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        tint="var(--app-accent)"
        aria-label={label}
        className="app-switch-control"
      />
    </span>
  )
}