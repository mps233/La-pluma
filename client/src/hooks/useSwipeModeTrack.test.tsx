// @vitest-environment jsdom

import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SwipeModePager from '../components/common/SwipeModePager'
import { useSwipeModeTrack } from './useSwipeModeTrack'

function Harness({ onChange }: { onChange: (index: number) => void }) {
  const [index, setIndex] = useState(0)
  const track = useSwipeModeTrack({
    count: 3,
    index,
    onChange: (next) => {
      setIndex(next)
      onChange(next)
    },
  })

  return (
    <div data-testid="host" {...track.handlers}>
      <SwipeModePager track={track} index={index}>
        <div>one</div>
        <div>two</div>
        <div>three</div>
      </SwipeModePager>
      <output data-testid="index">{index}</output>
    </div>
  )
}

function touchEvent(type: string, x: number, y: number, target: Element): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const touch = { clientX: x, clientY: y, identifier: 1, target } as unknown as Touch
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [touch] })
  Object.defineProperty(event, 'targetTouches', { value: type === 'touchend' ? [] : [touch] })
  Object.defineProperty(event, 'changedTouches', { value: [touch] })
  return event
}

let widthSpy: PropertyDescriptor | undefined

describe('useSwipeModeTrack', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === '(max-width: 639px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
    widthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 320 })
  })

  afterEach(cleanup)

  afterEach(() => {
    cleanup()
    if (widthSpy) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthSpy)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('moves the track with the finger and commits after the release spring', async () => {
    const onChange = vi.fn()
    const { container } = render(<Harness onChange={onChange} />)
    const host = screen.getByTestId('host')
    const track = container.querySelector<HTMLElement>('.swipe-mode-track')!

    fireEvent(host, touchEvent('touchstart', 240, 200, host))
    fireEvent(host, touchEvent('touchmove', 160, 202, host))

    expect(track.style.transform).toBe('translate3d(-80px, 0, 0)')

    fireEvent(host, touchEvent('touchend', 160, 202, host))
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(onChange).toHaveBeenCalledWith(1)
    expect(screen.getByTestId('index').textContent).toBe('1')
    expect(track.style.transform).toBe('translate3d(-320px, 0, 0)')
  })

  it('resists past the first and last mode', async () => {
    const onChange = vi.fn()
    const { container } = render(<Harness onChange={onChange} />)
    const host = screen.getByTestId('host')
    const track = container.querySelector<HTMLElement>('.swipe-mode-track')!

    fireEvent(host, touchEvent('touchstart', 200, 200, host))
    fireEvent(host, touchEvent('touchmove', 280, 202, host))

    expect(track.style.transform).toContain('translate3d(22.4')

    fireEvent(host, touchEvent('touchend', 280, 202, host))
    await act(async () => {
      vi.advanceTimersByTime(1200)
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(track.style.transform).toBe('translate3d(0px, 0, 0)')
  })
})
