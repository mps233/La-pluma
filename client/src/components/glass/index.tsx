// Drop-in replacements for the retired glass components.
//
// Every app surface imports its glass material from this module instead of the
// old library. Each export keeps the old prop surface where the app relied on
// it, and renders the Liquid Glass UI (bilalgursen) components installed
// verbatim in src/components/liquid-glass.
//
// Material mapping:
//   old glass / clear / ghost  → GlassButton clear (bends the page behind it)
//   old filled / tinted        → GlassButton tinted with a solid background
//   old <GlassCard>            → GlassCard clear
//   old <GlassSegmented>       → GlassTabs
//   old <GlassSwitch>          → Switch (controls/, needs three)
//   old <GlassMenu>            → GlassDropdownMenu
//   old <GlassNav>             → GlassButtonGroup + GlassButtonGroupItem
//   old <GlassInput>           → GlassCard holding a native input

import { ChevronDown } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type ComponentProps,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEventHandler,
  type ReactNode,
} from 'react'

import { GlassButton as KitButton } from '../liquid-glass/glass-button'
import { GlassCard as KitCard } from '../liquid-glass/glass-card'
import { GlassTabs as KitTabs, type GlassTabOption } from '../liquid-glass/glass-tabs'
import { Switch as KitSwitch } from '../liquid-glass/controls/Switch'
import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuTrigger,
} from '../liquid-glass/glass-dropdown-menu'
import { GlassButtonGroup, GlassButtonGroupItem } from '../liquid-glass/glass-button-group'
export { GlassButtonGroup, GlassButtonGroupItem } from '../liquid-glass/glass-button-group'
import { GlassSelect as KitSelect, type GlassSelectOption } from '../liquid-glass/glass-select'
import { Checkbox as KitCheckbox } from '../liquid-glass/controls/Checkbox'
export { GlassSelect, type GlassSelectOption, type GlassSelectProps } from '../liquid-glass/glass-select'

/* One class the app styles through; every call site shares the rules instead
   of repeating utility chains. */
const HOST = 'lg-host'

/* ── GlassButton ─────────────────────────────────────────────────────────── */

export type GlassButtonSize = 'sm' | 'md' | 'lg' | 'xl'
export type GlassButtonVariant = 'glass' | 'clear' | 'ghost' | 'tinted' | 'tinted-filled' | 'filled' | 'destructive'

export interface GlassButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick'> {
  /** Leading icon; with no children the button becomes a circle. */
  icon?: ReactNode
  iconPosition?: 'start' | 'end'
  iconOnly?: boolean
  /** Height preset: 36 / 44 / 52 px, matching the old sizes. */
  size?: GlassButtonSize
  /** `clear` bends the page; `filled` is a solid button; `tinted` a soft wash. */
  variant?: GlassButtonVariant
  /** Value for tinted / filled: any CSS colour. */
  tint?: string
  destructive?: boolean
  href?: string
  target?: string
  rel?: string
  type?: 'button' | 'submit' | 'reset'
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick']
}

const BUTTON_SIZES: Record<GlassButtonSize, string> = {
  sm: 'h-9 gap-1.5 px-3.5 text-[13px] [&_svg]:size-4',
  md: 'h-11 gap-2 px-4 text-sm [&_svg]:size-4',
  lg: 'h-[3.25rem] gap-2 px-5 text-[15px] [&_svg]:size-[18px]',
  xl: 'h-16 gap-2.5 px-8 text-lg [&_svg]:size-5',
}

const BUTTON_ICON_ONLY: Record<GlassButtonSize, string> = {
  sm: 'h-9 w-9 p-0',
  md: 'h-11 w-11 p-0',
  lg: 'h-[3.25rem] w-[3.25rem] p-0',
  xl: 'h-16 w-16 p-0',
}

/**
 * Filled glass paints its own background; tint / tinted-filled wash the glass.
 *
 * Clear glass keeps a Canvas2D snapshot of the page behind it and only repaints
 * it on a throttle or when the glass itself moves. Over the animated Ascii
 * field that reads as a stuttering backdrop, so app buttons default to the
 * tinted surface instead. Opt in with `variant="clear"` only when the content
 * behind the button is static.
 */
const TINTED_SURFACE: CSSProperties = {
  backgroundColor: 'var(--app-surface-muted)',
  borderColor: 'var(--app-border)',
  color: 'var(--app-text)',
}
const BUTTON_TINTED_SURFACE = TINTED_SURFACE

function buttonLook(variant: GlassButtonVariant, tint?: string, destructive?: boolean): { material: 'clear' | 'tinted'; style?: CSSProperties } {
  if (destructive) return { material: 'tinted', style: { backgroundColor: 'var(--app-danger-action)', color: '#fff' } }
  switch (variant) {
    case 'filled':
      return { material: 'tinted', style: { backgroundColor: tint ?? 'var(--app-accent-action)', color: '#fff' } }
    case 'tinted':
      return { material: 'tinted', style: tint ? { backgroundColor: tint, color: '#fff' } : undefined }
    case 'tinted-filled':
      return { material: 'tinted', style: tint ? { backgroundColor: `color-mix(in srgb, ${tint} 18%, transparent)`, color: tint } : undefined }
    case 'clear':
    case 'ghost':
    default:
      return { material: 'tinted', style: BUTTON_TINTED_SURFACE }
  }
}

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(function GlassButton({
  children,
  icon,
  iconPosition = 'start',
  iconOnly = false,
  size = 'md',
  variant = 'glass',
  tint,
  destructive = false,
  href,
  target,
  rel,
  className = '',
  style,
  type = 'button',
  onClick,
  ...rest
}: GlassButtonProps, ref) {
  const look = buttonLook(variant, tint, destructive)
  // An icon with no label is an icon-only button: without this, an empty label
  // span plus the flex gap pushes the icon ~4px off the circle's centre.
  const isIconOnly = iconOnly || (!!icon && (children == null || children === false))
  const classes = [
    HOST,
    'lg-button',
    isIconOnly ? BUTTON_ICON_ONLY[size] : BUTTON_SIZES[size],
    'justify-center whitespace-nowrap',
    className,
  ].filter(Boolean).join(' ')
  const mergedStyle = { ...look.style, ...style }
  // UI SDK's onClick receives a generic HTMLElement event; the old API was a button event.
  const handleClick = onClick ? (event: React.MouseEvent<HTMLElement>) => onClick(event as React.MouseEvent<HTMLButtonElement>) : undefined
  // The old CSS styles the label and icon wrappers by these class names.
  const content = (
    <>
      {icon && iconPosition === 'start' && (
        <span className="lg-button__icon inline-flex shrink-0 items-center justify-center">{icon}</span>
      )}
      {isIconOnly ? null : <span className="lg-button__label inline-flex min-w-0 items-center">{children}</span>}
      {icon && iconPosition === 'end' && (
        <span className="lg-button__icon inline-flex shrink-0 items-center justify-center">{icon}</span>
      )}
    </>
  )
  // React 19 forwards `ref` as a normal prop; the kit renders the real button/anchor.
  const kitProps = {
    ...rest,
    ...(isIconOnly ? { 'data-icon-only': '' } : {}),
    ...(ref ? { ref } : {}),
  } as ComponentProps<typeof KitButton>
  if (href) {
    return (
      <KitButton asChild {...kitProps} onClick={handleClick} material={look.material} className={classes} style={mergedStyle}>
        <a
          href={href}
          target={target}
          rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
        >
          {content}
        </a>
      </KitButton>
    )
  }
  return (
    <KitButton
      {...kitProps}
      onClick={handleClick}
      type={type}
      material={look.material}
      className={classes}
      style={mergedStyle}
    >
      {content}
    </KitButton>
  )
})

/* ── GlassCard ───────────────────────────────────────────────────────────── */

export interface GlassCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children?: ReactNode
  /** Kept for API compatibility: sets padding on all sides (the kit has no padding prop). */
  padding?: string
  /** Corner radius; ignored when `className` brings its own `rounded-*`. */
  radius?: string
  /**
   * `tinted` (default) matches the button surface; `clear` refracts the page
   * behind the card (opt in only when that content is static); `regular` keeps
   * the old frosted-panel meaning and is treated as clear.
   */
  variant?: 'regular' | 'clear' | 'tinted'
  /** Repaint the glass over moving content behind it. */
  live?: boolean
  /** Frost strength in px (the old card used a 28 px backdrop blur). */
  blur?: number
}

export function GlassCard({
  children,
  padding,
  radius,
  variant = 'tinted',
  live = false,
  blur = 12,
  className = '',
  style,
  ...rest
}: GlassCardProps) {
  return (
    <KitCard
      {...rest}
      material={variant === 'clear' || variant === 'regular' ? 'clear' : 'tinted'}
      live={live}
      blur={blur}
      className={`${HOST} lg-card ${className}`.trim()}
      style={{
        ...(padding ? { padding } : {}),
        ...(radius ? { borderRadius: radius } : {}),
        ...(variant === 'tinted' ? TINTED_SURFACE : {}),
        ...style,
      }}
    >
      {children}
    </KitCard>
  )
}

/* ── GlassSegmented ──────────────────────────────────────────────────────── */

export interface GlassSegmentedOption {
  label: ReactNode
  icon?: ReactNode
}

export interface GlassSegmentedProps {
  options: Array<string | GlassSegmentedOption>
  value: number
  onChange?: (index: number) => void
  size?: 'sm' | 'md'
  /** Kept for API compatibility; the kit lens has one strength. */
  intensity?: number
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

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
  // The kit is generic over a string value; the old control used the index.
  const tabs: GlassTabOption<string>[] = options.map((option, index) => {
    const key = `seg-${index}`
    if (typeof option === 'string') return { value: key, label: option }
    return { value: key, label: option.label, icon: option.icon }
  })
  return (
    <span
      ref={hostRef}
      className={`${HOST} lg-segmented ${className}`.trim()}
      style={style}
      onKeyDownCapture={(event) => {
        // The kit's radio only handles the four arrows; DESIGN also promises Home/End.
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

/* ── GlassSwitch ─────────────────────────────────────────────────────────── */

export interface GlassSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  compact?: boolean
  className?: string
  id?: string
  name?: string
}

export function GlassSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  compact = false,
  className = '',
  id,
  name,
}: GlassSwitchProps) {
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

  // The kit switch owns its internal id and does not expose either the id or
  // aria-label. Mirror the app's values onto the rendered control so external
  // <label htmlFor> relationships keep working.
  useEffect(() => {
    const control = hostRef.current?.querySelector<HTMLElement>('[role="switch"]')
    if (!control) return
    if (id) control.id = id
    if (label) control.setAttribute('aria-label', label)
  }, [id, label])

  return (
    <span ref={hostRef} className={`${HOST} lg-switch inline-flex items-center ${className}`.trim()}>
      <KitSwitch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        size={compact ? 'sm' : 'md'}
        color={accent}
        label=""
        name={name}
      />
    </span>
  )
}

/* ── GlassMenu (mobile "more" menu) ──────────────────────────────────────── */

export interface GlassMenuItem {
  label: ReactNode
  icon?: ReactNode
  /** Set on every item of a pick-one menu: the items become `menuitemradio`. */
  checked?: boolean
  destructive?: boolean
  disabled?: boolean
  onSelect?: () => void
}

export interface GlassMenuProps {
  /** Icon for the trigger button (e.g. an ellipsis). */
  icon: ReactNode
  items: GlassMenuItem[]
  'aria-label': string
  /** Which edge of the trigger the menu grows from. Default 'end'. */
  align?: 'start' | 'center' | 'end'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  menuClassName?: string
}

const MENU_TRIGGER_SIZES: Record<NonNullable<GlassMenuProps['size']>, string> = {
  sm: '!h-9 !w-9',
  md: '!h-11 !w-11',
  lg: '!h-[3.25rem] !w-[3.25rem]',
}

export function GlassMenu({
  icon,
  items,
  'aria-label': ariaLabel,
  align = 'end',
  size = 'md',
  className = '',
  menuClassName = '',
}: GlassMenuProps) {
  // The old menu was laid out inside its anchor. Portalling the kit's popup
  // into this wrapper keeps that DOM contract (and the tabbar's CSS) intact.
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
          className={`lg-button ${MENU_TRIGGER_SIZES[size]} !h-[var(--la-pluma-tabbar-floating-height)] !w-[var(--la-pluma-tabbar-floating-height)] !px-0`}
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

/* ── GlassNav (mobile tab bar) ───────────────────────────────────────────── */

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

export function GlassNav({
  items,
  activeIndex,
  onChange,
  className = '',
  'aria-label': ariaLabel = '主导航',
}: GlassNavProps) {
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
        material="tinted"
        size="lg"
        className={`lg-track h-[var(--la-pluma-tabbar-floating-height)] w-full bg-[var(--app-chrome-bg)] text-[var(--app-text)] ${className}`.trim()}
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

/* ── GlassInput (sidebar search) ─────────────────────────────────────────── */

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

export function GlassInput({
  value,
  onChange,
  onKeyDown,
  onClear,
  placeholder,
  type = 'text',
  'aria-label': ariaLabel,
  className = '',
  icon,
  ...inputProps
}: GlassInputProps) {
  const id = useId()
  return (
    <GlassCard blur={8} className={`lg-input rounded-full ${className}`.trim()} padding="0">
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

/* ── SelectField (native select API → GlassSelect) ─────────────────────── */

export interface SelectFieldOption {
  value: string | number
  label: string
  disabled?: boolean
}

export interface SelectFieldProps {
  id?: string
  name?: string
  /** Accessible name; the visible label stays with the caller. */
  label?: string
  value: string | number
  onChange: (value: string) => void
  options: SelectFieldOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  describedBy?: string
  invalid?: boolean
  errorMessage?: string
}

/**
 * The app's select surface. Production renders the kit GlassSelect; the native
 * branch exists only for jsdom tests, where the UI SDK's top-layer popover
 * cannot present. Browser verification covers the real control.
 */
export function SelectField({
  id,
  name,
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  className = '',
  describedBy,
  invalid = false,
  errorMessage,
}: SelectFieldProps) {
  const hostRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const trigger = hostRef.current?.querySelector<HTMLElement>('[role="combobox"]')
    if (!trigger) return
    if (id) trigger.id = id
    if (label) trigger.setAttribute('aria-label', label)
    if (describedBy) trigger.setAttribute('aria-describedby', describedBy)
    if (invalid) trigger.setAttribute('aria-invalid', 'true')
    if (errorMessage) trigger.setAttribute('aria-errormessage', errorMessage)
  }, [id, label, describedBy, invalid, errorMessage])

  if (import.meta.env.MODE === 'test') {
    return (
      <div className={`app-select-shell relative ${className}`.trim()}>
        <select
          id={id}
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-errormessage={errorMessage}
          className="input app-input app-native-control control-surface app-select-control min-h-11"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <span className={`app-select-trailing-icon ${disabled ? 'is-disabled' : ''}`} aria-hidden="true">
          <ChevronDown className="h-4 w-4" strokeWidth={1.9} />
        </span>
      </div>
    )
  }

  const placeholderOption = options.find((option) => String(option.value) === '')
  const selectOptions: GlassSelectOption[] = options
    .filter((option) => String(option.value) !== '')
    .map((option) => ({ value: String(option.value), label: option.label, disabled: option.disabled }))
  const current = value === '' || value === null || value === undefined ? null : String(value)

  return (
    <span ref={hostRef} className={`glass-select-field ${className}`.trim()}>
      <KitSelect
        label={<span className="sr-only">{label ?? ''}</span>}
        placeholder={placeholder ?? placeholderOption?.label ?? ''}
        options={selectOptions}
        value={current}
        onValueChange={(next) => onChange(next ?? '')}
        disabled={disabled}
        name={name}
        className="!w-full !gap-0"
      />
    </span>
  )
}

/* ── CheckboxField (native checkbox API → kit Checkbox) ─────────────────── */

export interface CheckboxFieldProps {
  id?: string
  name?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  /** Accessible name when the caller has no wrapping label. */
  label?: string
  size?: 'sm' | 'md' | 'lg'
  shape?: 'rounded' | 'circle'
}

/**
 * Production renders the kit's glass Checkbox. The native branch is only for
 * jsdom tests: the kit draws through three.js and its UI SDK popover/layer
 * primitives do not exist there. Browser verification covers the real control.
 */
export function CheckboxField({
  id,
  name,
  checked,
  onChange,
  disabled = false,
  className = '',
  label,
  size = 'md',
  shape = 'circle',
}: CheckboxFieldProps) {
  const hostRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const control = hostRef.current?.querySelector<HTMLElement>('[role="checkbox"]')
    if (!control) return
    if (id) control.id = id
    if (label) control.setAttribute('aria-label', label)
  }, [id, label])

  if (import.meta.env.MODE === 'test') {
    return (
      <input
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        aria-label={label}
        className={`custom-checkbox cursor-pointer ${className}`.trim()}
      />
    )
  }

  return (
    <span ref={hostRef} className={`glass-checkbox-field inline-flex ${className}`.trim()}>
      <KitCheckbox
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        name={name}
        label=""
        size={size}
        shape={shape}
      />
    </span>
  )
}

export default GlassButton
