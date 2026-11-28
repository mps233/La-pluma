import { useEffect, useRef, type ComponentProps } from 'react'

import { GlassCheckbox as KitCheckbox, GlassSelect as KitSelect, type GlassSelectOption } from '@/components/glass'

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
 * The app's select surface. Production renders the official GlassSelect; the
 * native branch exists only for jsdom tests, where the UI SDK's top-layer
 * popover cannot present. Browser verification covers the real control.
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
    // The official select's trigger is clear glass; over the app's light cards
    // that sample the dark ASCII field. Fill it with the app's solid surface so
    // day mode stays light and the popup reads the same tint.
    trigger.setAttribute('data-glass-fill', '')
    trigger.style.backgroundColor = 'var(--app-surface-solid)'
    if (id) trigger.id = id
    if (label) trigger.setAttribute('aria-label', label)
    if (describedBy) trigger.setAttribute('aria-describedby', describedBy)
    if (invalid) trigger.setAttribute('aria-invalid', 'true')
    if (errorMessage) trigger.setAttribute('aria-errormessage', errorMessage)
  }, [id, label, describedBy, invalid, errorMessage])

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

/**
 * Official GlassSelect for call sites that need a richer option label than
 * SelectField's plain string. It applies the same solid-fill treatment so the
 * trigger and its popup do not sample the dark backdrop in day mode.
 */
export function GlassSelectWithFill({ className = '', ...props }: ComponentProps<typeof KitSelect>) {
  const hostRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const trigger = hostRef.current?.querySelector<HTMLElement>('[role="combobox"]')
    if (!trigger) return
    trigger.setAttribute('data-glass-fill', '')
    trigger.style.backgroundColor = 'var(--app-surface-solid)'
  }, [])

  return (
    <span ref={hostRef} className="glass-select-field">
      <KitSelect {...props} className={className} />
    </span>
  )
}

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
 * Production renders the official glass Checkbox. The native branch is only for
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
