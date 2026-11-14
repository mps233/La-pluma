export interface CombatSegmentedOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

export interface CombatSegmentedControlProps<T extends string> {
  ariaLabel: string
  value: T
  options: readonly CombatSegmentedOption<T>[]
  onChange: (value: T) => void
  fullWidth?: boolean
  disabled?: boolean
  className?: string
}

export default function CombatSegmentedControl<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  fullWidth = false,
  disabled = false,
  className = '',
}: CombatSegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`${fullWidth ? 'flex w-full' : 'inline-flex'} min-w-0 items-stretch gap-0.5 rounded-xl p-0.5 control-surface ${className}`}
    >
      {options.map((option) => {
        const isActive = option.value === value
        const isDisabled = disabled || option.disabled
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            disabled={isDisabled}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-lg px-1.5 text-xs font-medium sm:px-2.5 sm:text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${
              fullWidth ? 'flex-1' : ''
            } ${isActive ? 'brand-action text-white' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
