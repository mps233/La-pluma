import { configure } from '@testing-library/react'
import React from 'react'
import { vi } from 'vitest'

// jsdom has no layout, so the UI SDK menu's initial-focus scroll would throw.
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: () => undefined,
  })
}

// The Liquid Glass select and checkbox draw through three.js and the UI SDK's
// top-layer popover, neither of which jsdom can present. Render accessible
// native controls with the same value/checked contract so application code
// exercises its real path (no test-only branches in the components).
vi.mock('@/components/glass', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/glass')>()
  type SelectOption = { value: string; label: React.ReactNode; disabled?: boolean }
  interface SelectProps {
    label?: React.ReactNode
    placeholder?: string
    options?: SelectOption[]
    value?: string | null
    onValueChange?: (value: string | null) => void
    disabled?: boolean
    name?: string
    className?: string
  }
  const MockGlassSelect = ({ label, placeholder, options, value, onValueChange, disabled, name, className }: SelectProps) => (
    React.createElement(
      'select',
      {
        role: 'combobox',
        'aria-label': typeof label === 'string' ? label : placeholder || undefined,
        value: value ?? '',
        disabled,
        name,
        className: `input app-input app-native-control control-surface app-select-control min-h-11 ${className ?? ''}`.trim(),
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(event.target.value || null),
      },
      placeholder ? React.createElement('option', { key: '__placeholder', value: '' }, placeholder) : null,
      ...(options ?? []).map(option => (
        React.createElement('option', { key: option.value, value: option.value, disabled: option.disabled }, option.label)
      )),
    )
  )
  interface CheckboxProps {
    checked?: boolean
    onChange?: (checked: boolean) => void
    disabled?: boolean
    name?: string
    label?: string
    color?: string
    size?: string
    shape?: string
  }
  const MockGlassCheckbox = ({ checked, onChange, disabled, name, label }: CheckboxProps) => (
    React.createElement('input', {
      type: 'checkbox',
      role: 'checkbox',
      checked: Boolean(checked),
      'aria-label': label || undefined,
      disabled,
      name,
      className: 'custom-checkbox cursor-pointer',
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange?.(event.target.checked),
    })
  )
  return {
    ...actual,
    GlassSelect: MockGlassSelect,
    GlassSelectWithFill: MockGlassSelect,
    GlassCheckbox: MockGlassCheckbox,
  }
})

configure({ asyncUtilTimeout: 5000 })

// jsdom has no ResizeObserver; the Liquid Glass components observe their
// surfaces on mount. Keep a no-op implementation for every test file.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// jsdom has no matchMedia; Liquid Glass checks it for haptics on pointer down.
// Existing tests that need a specific result still stub it themselves.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// jsdom does not implement pointer capture or Web Animations. The Liquid Glass
// registry calls both from pointer handlers and presence transitions; no-op
// stubs keep component tests focused on app behavior.
if (typeof Element !== 'undefined') {
  if (typeof Element.prototype.setPointerCapture !== 'function') {
    Element.prototype.setPointerCapture = () => {}
  }
  if (typeof Element.prototype.releasePointerCapture !== 'function') {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (typeof Element.prototype.hasPointerCapture !== 'function') {
    Element.prototype.hasPointerCapture = () => false
  }
  if (typeof Element.prototype.getAnimations !== 'function') {
    Element.prototype.getAnimations = () => []
  }
}
