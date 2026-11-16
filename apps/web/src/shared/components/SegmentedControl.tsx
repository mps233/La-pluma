import { cva } from 'class-variance-authority'
import { cn } from 'cn'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'

export interface SegmentedControlOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  ariaLabel: string
  value: T
  options: readonly SegmentedControlOption<T>[]
  onChange: (value: T) => void
  fullWidth?: boolean
  disabled?: boolean
  className?: string
}

const segmentedControlGroupVariants = cva(
  'min-w-0 items-stretch rounded-xl p-0.5 control-surface',
  {
    variants: {
      fullWidth: {
        true: 'flex w-full',
        false: 'inline-flex w-fit',
      },
    },
    defaultVariants: {
      fullWidth: false,
    },
  },
)

const segmentedControlItemVariants = cva(
  [
    'inline-flex h-auto min-h-11 min-w-0 items-center justify-center whitespace-nowrap',
    'rounded-lg px-1.5 text-xs font-medium transition-colors sm:px-2.5 sm:text-sm',
    'text-muted-foreground hover:bg-muted hover:text-muted-foreground',
    'focus-visible:outline-hidden focus-visible:ring-2! focus-visible:ring-primary!',
    'disabled:pointer-events-auto! disabled:cursor-not-allowed disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      fullWidth: {
        true: 'flex-1',
        false: '',
      },
      selected: {
        true: [
          'brand-action text-primary-foreground',
          'aria-pressed:bg-primary-action!',
          'aria-pressed:hover:bg-primary-action-hover! aria-pressed:hover:text-primary-foreground!',
        ].join(' '),
        false: '',
      },
    },
    defaultVariants: {
      fullWidth: false,
      selected: false,
    },
  },
)

export function SegmentedControl<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  fullWidth = false,
  disabled = false,
  className,
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={[value]}
      onValueChange={(next) => {
        const nextValue = next[0] as T | undefined
        if (nextValue && nextValue !== value) onChange(nextValue)
      }}
      disabled={disabled}
      multiple={false}
      spacing={0.5}
      className={cn(segmentedControlGroupVariants({ fullWidth }), className)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={segmentedControlItemVariants({
            fullWidth,
            selected: option.value === value,
          })}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
