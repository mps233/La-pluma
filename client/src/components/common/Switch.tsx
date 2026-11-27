import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react'

import { GlassSwitch as OfficialSwitch } from '@/components/glass'

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type' | 'value'> {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
  compact?: boolean
}

/**
 * Official Liquid Glass switch with native button semantics. `label` is the
 * accessible name only; visible titles stay in the surrounding setting row.
 */
export default function Switch({
  id,
  checked,
  label,
  onChange,
  compact = false,
  disabled = false,
  name,
  className = '',
}: SwitchProps) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const [accent, setAccent] = useState('#007aff')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const root = document.documentElement
    const read = () => {
      const value = window.getComputedStyle(root).getPropertyValue('--app-accent').trim()
      if (value) setAccent(value)
    }
    read()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const control = hostRef.current?.querySelector<HTMLElement>('[role="switch"]')
    if (!control) return
    if (id) control.id = id
    if (label) control.setAttribute('aria-label', label)
  }, [id, label])

  return (
    <span
      className={`app-switch${compact ? ' app-switch-compact' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
    >
      <span ref={hostRef} className="lg-host lg-switch app-switch-control inline-flex items-center">
        <OfficialSwitch
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          size={compact ? 'sm' : 'md'}
          color={accent}
          label=""
          name={name}
        />
      </span>
    </span>
  )
}
