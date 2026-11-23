// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AsciiFieldBackdrop from './AsciiFieldBackdrop'

describe('AsciiFieldBackdrop', () => {
  it('renders a decorative ambient layer', () => {
    const { container } = render(<AsciiFieldBackdrop />)
    const layer = container.querySelector('.ascii-field')
    expect(layer).not.toBeNull()
    expect(layer?.getAttribute('aria-hidden')).toBe('true')
  })

  it('merges a caller className and exposes the intensity token', () => {
    const { container } = render(<AsciiFieldBackdrop className="page-ambient" intensity={0.09} />)
    const layer = container.querySelector<HTMLElement>('.ascii-field')
    expect(layer?.className).toBe('ascii-field page-ambient')
    expect(layer?.style.getPropertyValue('--ascii-field-opacity')).toBe('0.09')
  })
})
