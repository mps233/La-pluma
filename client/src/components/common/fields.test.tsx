// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CheckboxField } from './fields'

afterEach(cleanup)

describe('CheckboxField', () => {
  it('renders a solid fallback that tracks the checked state and shape', () => {
    const { container, rerender } = render(
      <CheckboxField checked={false} label="启用选项" onChange={() => undefined} />,
    )

    const fallback = container.querySelector<HTMLElement>('[data-glass-fallback="checkbox"]')
    expect(fallback?.getAttribute('aria-hidden')).toBe('true')
    expect(fallback?.classList.contains('is-checked')).toBe(false)
    expect(fallback?.classList.contains('is-circle')).toBe(true)

    rerender(<CheckboxField checked shape="rounded" label="启用选项" onChange={() => undefined} />)

    const next = container.querySelector<HTMLElement>('[data-glass-fallback="checkbox"]')
    expect(next?.classList.contains('is-checked')).toBe(true)
    expect(next?.classList.contains('is-circle')).toBe(false)
  })
})
