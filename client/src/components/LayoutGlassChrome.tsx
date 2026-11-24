import { useEffect, useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type KeyboardEventHandler, type ReactNode } from 'react'

import { GlassCard, GlassButtonGroup, GlassButtonGroupItem } from '@/components/liquid-glass'
import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuTrigger,
} from '@/components/liquid-glass/glass-dropdown-menu'

const HOST = 'lg-host'

export interface GlassMenuItem {
  label: ReactNode
  icon?: ReactNode
  checked?: boolean
  destructive?: boolean
  disabled?: boolean
  onSelect?: () => void
}

export interface GlassMenuProps {
  icon: ReactNode
  items: GlassMenuItem[]
  'aria-label': string
  align?: 'start' | 'center' | 'end'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  menuClassName?: string
  /** Override the trigger geometry (the tabbar More uses the floating height). */
  triggerClassName?: string
}

const MENU_TRIGGER_SIZES: Record<NonNullable<GlassMenuProps['size']>, string> = {
  sm: '!h-9 !w-9',
  md: '!h-11 !w-11',
  lg: '!h-[3.25rem] !w-[3.25rem]',
}

export function GlassMenu({ icon, items, 'aria-label': ariaLabel, align = 'end', size = 'md', className = '', menuClassName = '', triggerClassName = '' }: GlassMenuProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

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
    <div ref={setContainer} className={`${HOST} lg-menu relative inline-flex ${className}`.trim()}>
      <GlassDropdownMenu container={container}>
        <GlassDropdownMenuTrigger
          aria-label={ariaLabel}
          data-icon-only=""
          className={`lg-button ${MENU_TRIGGER_SIZES[size]} ${triggerClassName || '!h-[var(--la-pluma-tabbar-floating-height)] !w-[var(--la-pluma-tabbar-floating-height)] !px-0'}`}
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

export interface GlassNavItem {
  id?: string
  label: string
  icon?: ReactNode
}

export interface GlassNavProps {
  items: GlassNavItem[]
  activeIndex: number
  onChange: (index: number) => void
  className?: string
  'aria-label'?: string
}

export function GlassNav({ items, activeIndex, onChange, className = '', 'aria-label': ariaLabel = '主导航' }: GlassNavProps) {
  const navRef = useRef<HTMLElement>(null)
  const moveTo = (index: number) => {
    if (index < 0 || index >= items.length) return
    onChange(index)
    requestAnimationFrame(() => {
      navRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus()
    })
  }
  return (
    <nav
      ref={navRef}
      className={`${HOST} lg-nav`}
      onKeyDown={(event) => {
        let next: number | null = null
        if (event.key === 'ArrowLeft') next = (activeIndex - 1 + items.length) % items.length
        else if (event.key === 'ArrowRight') next = (activeIndex + 1) % items.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = items.length - 1
        if (next === null) return
        event.preventDefault()
        moveTo(next)
      }}
    >
      <GlassButtonGroup
        role="tablist"
        aria-label={ariaLabel}
        material="clear"
        size="lg"
        className={`lg-track h-[var(--la-pluma-tabbar-floating-height)] w-full text-[var(--app-text)] ${className}`.trim()}
      >
        {items.map((item, index) => {
          const active = index === activeIndex
          return (
            <GlassButtonGroupItem
              key={item.id ?? index}
              data-lg-item={index}
              role="tab"
              aria-label={item.label}
              aria-selected={active}
              aria-current={active ? 'page' : undefined}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(index)}
              className={`lg-nav-item h-full flex-1 ${active ? 'is-active bg-[var(--la-pluma-tabbar-active-bg)] text-[var(--app-accent-strong)]' : ''}`.trim()}
            >
              <span className="inline-flex flex-col items-center gap-0.5 text-[11px] leading-none">
                {item.icon}
                <span>{item.label}</span>
              </span>
            </GlassButtonGroupItem>
          )
        })}
      </GlassButtonGroup>
    </nav>
  )
}

export interface GlassInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onKeyDown' | 'type' | 'placeholder' | 'className' | 'aria-label'> {
  value: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
  onClear?: () => void
  placeholder?: string
  type?: string
  'aria-label'?: string
  className?: string
  icon?: ReactNode
}

export function GlassInput({ value, onChange, onKeyDown, onClear, placeholder, type = 'text', 'aria-label': ariaLabel, className = '', icon, ...inputProps }: GlassInputProps) {
  const id = useId()
  return (
    <GlassCard material="clear" blur={8} className={`lg-host lg-card lg-input rounded-full ${className}`.trim()}>
      <label
        htmlFor={id}
        className="lg-input-row flex min-h-9 w-full items-center gap-2 rounded-full px-3 text-sm transition-shadow focus-within:ring-2 focus-within:ring-[var(--app-accent)]"
      >
        {icon ? <span aria-hidden="true" className="lg-input-icon shrink-0 text-[var(--app-text-muted)]">{icon}</span> : null}
        <input
          {...inputProps}
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="lg-input-field min-w-0 flex-1 bg-transparent text-[var(--app-text)] outline-none placeholder:text-[var(--app-text-soft)] [&::-webkit-search-cancel-button]:hidden"
        />
        {value && onClear ? (
          <button
            type="button"
            className="lg-input-clear flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
            aria-label="Clear"
            onClick={onClear}
          >
            ×
          </button>
        ) : null}
      </label>
    </GlassCard>
  )
}
