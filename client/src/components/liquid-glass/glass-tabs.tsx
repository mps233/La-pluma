'use client'

// GlassTabs — a segmented control whose selection slides as a liquid glass lens.
//
//   const [view, setView] = useState('week')
//   <GlassTabs
//     aria-label="Range"
//     value={view}
//     onValueChange={setView}
//     options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]}
//   />
//
// Behaviour comes from UI SDK's segmented control: a radiogroup with one tab stop, arrow
// keys that move the selection, and a hidden radio per option so `name` submits with a
// form. Needs @ui-sdk/core and @ui-sdk/react. Colours come from the classes below:
// change `highlightClassName` to recolour the lens. COPY VERBATIM. MIT.

import { SegmentedControl, SegmentedControlItem } from '@ui-sdk/react/segmented-control'
import type { ReactNode } from 'react'

import { GlassLens } from './glass-lens'

export type GlassTabOption<T extends string> = { value: T; label: ReactNode; icon?: ReactNode; 'aria-label'?: string }

export type GlassTabsProps<T extends string> = {
  options: readonly GlassTabOption<T>[]
  value: T | null
  onValueChange: (value: T) => void
  'aria-label': string
  /** Submits the selected value under this name with the form around it. */
  name?: string
  size?: 'sm' | 'md' | 'lg'
  /** Classes of the selected (resting) pill; its background colour is the lens colour. */
  highlightClassName?: string
  className?: string
}

const sizes = {
  sm: 'h-7 px-3 text-xs gap-1.5 [&_svg]:size-3.5',
  md: 'h-8 px-3.5 text-[13px] gap-1.5 [&_svg]:size-4',
  lg: 'h-10 px-4 text-sm gap-2 [&_svg]:size-4',
}

export function GlassTabs<T extends string>({
  options,
  value,
  onValueChange,
  name,
  size = 'md',
  highlightClassName = 'bg-white dark:bg-neutral-700',
  className = '',
  ...aria
}: GlassTabsProps<T>) {
  return (
    <SegmentedControl<T>
      aria-label={aria['aria-label']}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next)
      }}
      name={name}
      data-glass-host=""
      className={`relative isolate inline-flex items-center gap-1 rounded-full bg-black/[0.05] p-1 dark:bg-white/[0.08] ${className}`}
    >
      <GlassLens value={value} />
      {options.map((o) => {
        const selected = o.value === value
        return (
          <SegmentedControlItem
            key={o.value}
            value={o.value}
            aria-label={o['aria-label']}
            className={`relative inline-flex cursor-pointer items-center justify-center rounded-full font-semibold whitespace-nowrap transition-colors duration-200 outline-none select-none focus-visible:ring-2 focus-visible:ring-[#3291FF] [&_svg]:shrink-0 ${sizes[size]} ${
              selected
                ? 'text-neutral-900 dark:text-white [[data-glass-traveling]_&]:text-neutral-500 dark:[[data-glass-traveling]_&]:text-neutral-400'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
            }`}
          >
            {selected && (
              <span
                aria-hidden
                data-glass-highlight=""
                className={`absolute inset-0 rounded-full [[data-glass-moving]_&]:opacity-0 ${highlightClassName}`}
              />
            )}
            {o.icon && <span className="relative z-20 flex">{o.icon}</span>}
            {o.label !== undefined && o.label !== null && o.label !== '' && <span className="relative z-20">{o.label}</span>}
          </SegmentedControlItem>
        )
      })}
    </SegmentedControl>
  )
}

export default GlassTabs
