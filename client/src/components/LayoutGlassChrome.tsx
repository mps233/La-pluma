import { lazy, Suspense, useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type KeyboardEventHandler, type ReactNode } from 'react'

import { GlassCard, GlassButtonGroup, GlassButtonGroupItem } from '@/components/glass'
import {
  DEFAULT_MENU_TRIGGER_CLASS,
  MENU_TRIGGER_SIZES,
  type GlassMenuProps,
} from './GlassMenuTypes'

export type { GlassMenuItem, GlassMenuProps } from './GlassMenuTypes'

const HOST = 'lg-host'

// The glass menu pulls the popup, menu, and select foundations. Load it when
// the trigger is hovered or activated; the placeholder keeps the same button.
const GlassMenuImpl = lazy(() => import('./GlassMenuImpl'))

interface GlassMenuTriggerPlaceholderProps {
  icon: ReactNode
  ariaLabel: string
  size: NonNullable<GlassMenuProps['size']>
  triggerClassName: string
  plainTrigger: boolean
  onPreload: () => void
  onOpen: () => void
}

function GlassMenuTriggerPlaceholder({
  icon,
  ariaLabel,
  size,
  triggerClassName,
  plainTrigger,
  onPreload,
  onOpen,
}: GlassMenuTriggerPlaceholderProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-haspopup="menu"
      aria-expanded={false}
      data-icon-only=""
      data-glass-host=""
      {...(plainTrigger ? { 'data-glass-plain': '' } : {})}
      className={`lg-button ${MENU_TRIGGER_SIZES[size]} ${triggerClassName || DEFAULT_MENU_TRIGGER_CLASS}`}
      onPointerEnter={onPreload}
      onClick={onOpen}
    >
      {icon}
    </button>
  )
}

export function GlassMenu({
  icon,
  items,
  'aria-label': ariaLabel,
  align = 'end',
  size = 'md',
  className = '',
  menuClassName = '',
  triggerClassName = '',
  plainTrigger = false,
}: GlassMenuProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [openOnLoad, setOpenOnLoad] = useState(false)

  const preload = () => setLoaded(true)
  const open = () => {
    setOpenOnLoad(true)
    setLoaded(true)
  }
  const placeholder = (
    <GlassMenuTriggerPlaceholder
      icon={icon}
      ariaLabel={ariaLabel}
      size={size}
      triggerClassName={triggerClassName}
      plainTrigger={plainTrigger}
      onPreload={preload}
      onOpen={open}
    />
  )

  return (
    <div ref={setContainer} className={`${HOST} lg-menu relative inline-flex ${className}`.trim()}>
      {loaded ? (
        <Suspense fallback={placeholder}>
          <GlassMenuImpl
            container={container}
            initialOpen={openOnLoad}
            icon={icon}
            items={items}
            aria-label={ariaLabel}
            align={align}
            size={size}
            menuClassName={menuClassName}
            triggerClassName={triggerClassName}
            plainTrigger={plainTrigger}
          />
        </Suspense>
      ) : placeholder}
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
  /**
   * Body material. Tinted glass is a fixed frosted body; clear glass bends the
   * page behind it and repaints on every scroll, so the touch tab bar uses
   * tinted to keep scrolling cheap.
   */
  material?: 'clear' | 'tinted'
}

export function GlassNav({ items, activeIndex, onChange, className = '', 'aria-label': ariaLabel = '主导航', material = 'clear' }: GlassNavProps) {
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
        data-material={material}
        material={material}
        size="lg"
        className={`lg-track h-[var(--la-pluma-tabbar-floating-height)] w-full text-[var(--app-text)] ${material === 'tinted' ? 'bg-[var(--app-surface)]' : ''} ${className}`.trim()}
      >
        {/* The current-view capsule travels between equal-width items; it is
            hidden while the bar is folded onto a single view. */}
        <span
          aria-hidden="true"
          className="la-pluma-tabbar-indicator"
          style={{
            width: `calc((100% - 0.5rem) / ${items.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
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
