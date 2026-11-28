'use client'

import { useEffect, useRef } from 'react'

import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuTrigger,
} from '@/components/glass'
import {
  DEFAULT_MENU_TRIGGER_CLASS,
  MENU_TRIGGER_SIZES,
  type GlassMenuProps,
} from './GlassMenuTypes'

export interface GlassMenuImplProps extends GlassMenuProps {
  container: HTMLElement | null
  initialOpen?: boolean
}

/**
 * The real glass menu. Kept behind `GlassMenu`'s lazy boundary so the popup,
 * menu, and select foundations stay out of the entry chunk.
 */
export default function GlassMenuImpl({
  container,
  initialOpen = false,
  icon,
  items,
  'aria-label': ariaLabel,
  align = 'end',
  size = 'md',
  menuClassName = '',
  triggerClassName = '',
  plainTrigger = false,
}: GlassMenuImplProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!initialOpen) return undefined
    let cancelled = false
    const open = () => {
      if (cancelled) return
      rootRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click()
    }
    const useFrame = typeof window.requestAnimationFrame === 'function'
    const frame = useFrame ? window.requestAnimationFrame(open) : window.setTimeout(open, 0)
    return () => {
      cancelled = true
      if (useFrame) window.cancelAnimationFrame(frame)
      else window.clearTimeout(frame)
    }
  }, [initialOpen])

  useEffect(() => {
    if (!container) return
    const fix = () => {
      container.querySelectorAll<HTMLElement>('[role="menuitem"][aria-checked]').forEach((el) => {
        el.setAttribute('role', 'menuitemradio')
      })
    }
    fix()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(fix)
    observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['role', 'aria-checked'] })
    return () => observer.disconnect()
  }, [container])

  return (
    <div ref={rootRef} className="contents">
      <GlassDropdownMenu container={container}>
        <GlassDropdownMenuTrigger
          aria-label={ariaLabel}
          data-icon-only=""
          {...(plainTrigger ? { 'data-glass-plain': '' } : {})}
          className={`lg-button ${MENU_TRIGGER_SIZES[size]} ${triggerClassName || DEFAULT_MENU_TRIGGER_CLASS}`}
        >
          {icon}
        </GlassDropdownMenuTrigger>
        <GlassDropdownMenuContent align={align} aria-label={ariaLabel} className={menuClassName}>
          {items.map((item, index) => {
            const isRadio = typeof item.checked === 'boolean'
            return (
              <GlassDropdownMenuItem
                key={index}
                role={isRadio ? 'menuitemradio' : undefined}
                aria-checked={isRadio ? item.checked : undefined}
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                <span className="inline-flex items-center gap-2">
                  {item.icon}
                  <span>{item.label}</span>
                  {isRadio && (
                    <span aria-hidden="true" className="ml-auto pl-2">{item.checked ? '✓' : ''}</span>
                  )}
                </span>
              </GlassDropdownMenuItem>
            )
          })}
        </GlassDropdownMenuContent>
      </GlassDropdownMenu>
    </div>
  )
}
