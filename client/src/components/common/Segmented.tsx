import { useRef, type CSSProperties, type ReactNode } from 'react'

import { GlassTabs as KitTabs, type GlassTabOption } from '@/components/liquid-glass'

export interface GlassSegmentedOption {
  label: ReactNode
  icon?: ReactNode
}

export interface GlassSegmentedProps {
  options: Array<string | GlassSegmentedOption>
  value: number
  onChange?: (index: number) => void
  size?: 'sm' | 'md'
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

/** App segmented control backed by the official GlassTabs lens. */
export function GlassSegmented({
  options,
  value,
  onChange,
  size = 'md',
  className = '',
  style,
  'aria-label': ariaLabel,
}: GlassSegmentedProps) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const moveTo = (index: number) => {
    if (index < 0 || index >= options.length) return
    onChange?.(index)
    requestAnimationFrame(() => {
      hostRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus()
    })
  }
  const tabs: GlassTabOption<string>[] = options.map((option, index) => {
    const key = `seg-${index}`
    if (typeof option === 'string') return { value: key, label: option }
    return { value: key, label: option.label, icon: option.icon }
  })
  return (
    <span
      ref={hostRef}
      className={`lg-host lg-segmented ${className}`.trim()}
      style={style}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Home' && event.key !== 'End') return
        event.preventDefault()
        moveTo(event.key === 'Home' ? 0 : options.length - 1)
      }}
    >
      <KitTabs
        aria-label={ariaLabel ?? '分段选择'}
        size={size === 'sm' ? 'sm' : 'md'}
        value={`seg-${value}`}
        onValueChange={(next: string) => onChange?.(Number(next.slice(4)))}
        options={tabs}
      />
    </span>
  )
}

export default GlassSegmented
