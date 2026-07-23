// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { measureFluidTabRect } from './useFluidTabIndicator'

describe('measureFluidTabRect', () => {
  it('uses layout geometry instead of a transformed visual rectangle', () => {
    const container = document.createElement('div')
    const button = document.createElement('button')
    button.style.transform = 'scale(0.95)'
    container.appendChild(button)
    document.body.appendChild(container)
    Object.defineProperties(button, {
      offsetLeft: { configurable: true, value: 416 },
      offsetTop: { configurable: true, value: 0 },
      offsetWidth: { configurable: true, value: 416 },
      offsetHeight: { configurable: true, value: 52 },
    })
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      bottom: 50.7,
      height: 49.4,
      left: 426.4,
      right: 821.6,
      top: 1.3,
      width: 395.2,
      x: 426.4,
      y: 1.3,
      toJSON: () => ({}),
    })

    expect(measureFluidTabRect(container, button)).toEqual({
      x: 416,
      y: 0,
      width: 416,
      height: 52,
    })
    expect(button.getBoundingClientRect).not.toHaveBeenCalled()
    container.remove()
  })

  it('preserves subpixel precision when the button is not transformed', () => {
    const container = document.createElement('div')
    const button = document.createElement('button')
    container.appendChild(button)
    document.body.appendChild(container)
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      bottom: 252,
      height: 52,
      left: 100.25,
      right: 932.25,
      top: 200,
      width: 832,
      x: 100.25,
      y: 200,
      toJSON: () => ({}),
    })
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      bottom: 252,
      height: 52,
      left: 516.75,
      right: 932.25,
      top: 200,
      width: 415.5,
      x: 516.75,
      y: 200,
      toJSON: () => ({}),
    })

    expect(measureFluidTabRect(container, button)).toEqual({
      x: 416.5,
      y: 0,
      width: 415.5,
      height: 52,
    })
    container.remove()
  })
})
