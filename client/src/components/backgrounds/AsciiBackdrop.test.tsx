// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AsciiBackdrop from './AsciiBackdrop'

describe('AsciiBackdrop', () => {
  it('renders a decorative canvas layer hidden from assistive tech', () => {
    const { container } = render(<AsciiBackdrop />)
    const layer = container.querySelector('.ascii-field')
    expect(layer).not.toBeNull()
    expect(layer?.getAttribute('aria-hidden')).toBe('true')
    expect(layer?.querySelector('canvas.ascii-field-canvas')).not.toBeNull()
  })

  it('merges a caller className and exposes the intensity token', () => {
    const { container } = render(<AsciiBackdrop className="page-ambient" intensity={0.09} />)
    const layer = container.querySelector<HTMLElement>('.ascii-field')
    expect(layer?.className).toBe('ascii-field page-ambient')
    expect(layer?.style.getPropertyValue('--ascii-field-opacity')).toBe('0.09')
  })

  it('survives a canvas without a 2d context', () => {
    expect(() => render(<AsciiBackdrop cellSize={18} pattern="rings" seed={3} />)).not.toThrow()
  })
})
