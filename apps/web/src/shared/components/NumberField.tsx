import type { ComponentProps } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from 'cn'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/shared/ui/input-group'

export interface NumberFieldProps
  extends Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange' | 'className' | 'min' | 'max' | 'step' | 'ref'> {
  readonly id: string
  readonly label: string
  readonly value: string | number
  readonly onValueChange: (value: string) => void
  readonly min?: number | string
  readonly max?: number | string
  readonly step?: number | string
  readonly disabled?: boolean
  readonly className?: string
  readonly inputClassName?: string
  readonly controlsClassName?: string
}

function readBound(value: number | string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readNumber(value: string | number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function readStep(step: number | string | undefined): number {
  const parsed = readBound(step)
  return parsed !== undefined && parsed > 0 ? parsed : 1
}

function clamp(value: number, min: number | undefined, max: number | undefined): number {
  if (min !== undefined && value < min) return min
  if (max !== undefined && value > max) return max
  return value
}

function isAtMin(value: string | number, min: number | string | undefined): boolean {
  const bound = readBound(min)
  return bound !== undefined && readNumber(value) <= bound
}

function isAtMax(value: string | number, max: number | string | undefined): boolean {
  const bound = readBound(max)
  return bound !== undefined && readNumber(value) >= bound
}

export default function NumberField({
  id,
  label,
  value,
  onValueChange,
  min,
  max,
  step,
  disabled = false,
  className,
  inputClassName,
  controlsClassName,
  ...inputProps
}: NumberFieldProps) {
  const adjust = (direction: -1 | 1) => {
    const next = clamp(readNumber(value) + direction * readStep(step), readBound(min), readBound(max))
    onValueChange(String(next))
  }

  return (
    <InputGroup className={className}>
      <InputGroupInput
        {...inputProps}
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={event => onValueChange(event.target.value)}
        className={cn('tabular-nums', inputClassName)}
      />
      <InputGroupAddon
        align="inline-end"
        className={cn('mr-0! h-full gap-0 overflow-hidden rounded-r-lg p-0', controlsClassName)}
      >
        <InputGroupButton
          size="icon-sm"
          aria-label={`减少${label}`}
          disabled={disabled || isAtMin(value, min)}
          onClick={() => adjust(-1)}
          className="h-full rounded-none border-r border-border text-tertiary hover:bg-primary-soft hover:text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <Minus strokeWidth={2.2} aria-hidden="true" />
        </InputGroupButton>
        <InputGroupButton
          size="icon-sm"
          aria-label={`增加${label}`}
          disabled={disabled || isAtMax(value, max)}
          onClick={() => adjust(1)}
          className="h-full rounded-none text-tertiary hover:bg-primary-soft hover:text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <Plus strokeWidth={2.2} aria-hidden="true" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
