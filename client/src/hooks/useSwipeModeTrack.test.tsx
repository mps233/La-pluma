// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SwipeModePager from '../components/common/SwipeModePager'
import { useSwipeModeTrack } from './useSwipeModeTrack'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

let container: HTMLDivElement
let root: Root
let widthSpy: PropertyDescriptor | undefined

describe('useSwipeModeTrack', () => {
  beforeEach(async () => {
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
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    if (widthSpy) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthSpy)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('moves the track with the finger and commits after the release spring', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(<Harness onChange={onChange} />))
    const host = container.querySelector<HTMLElement>('[data-testid="host"]')!
    const track = container.querySelector<HTMLElement>('.swipe-mode-track')!

    await act(async () => {
      host.dispatchEvent(touchEvent('touchstart', 240, 200, host))
      host.dispatchEvent(touchEvent('touchmove', 160, 202, host))
    })
    expect(track.style.transform).toBe('translate3d(-80px, 0, 0)')

    await act(async () => {
      host.dispatchEvent(touchEvent('touchend', 160, 202, host))
    })
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(onChange).toHaveBeenCalledWith(1)
    expect(container.querySelector<HTMLElement>('[data-testid="index"]')?.textContent).toBe('1')
    expect(track.style.transform).toBe('translate3d(-320px, 0, 0)')
  })

  it('resists past the first and last mode', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(<Harness onChange={onChange} />))
    const host = container.querySelector<HTMLElement>('[data-testid="host"]')!
    const track = container.querySelector<HTMLElement>('.swipe-mode-track')!

    await act(async () => {
      host.dispatchEvent(touchEvent('touchstart', 200, 200, host))
      host.dispatchEvent(touchEvent('touchmove', 280, 202, host))
    })
    expect(track.style.transform).toContain('translate3d(22.4')

    await act(async () => {
      host.dispatchEvent(touchEvent('touchend', 280, 202, host))
      vi.advanceTimersByTime(1200)
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(track.style.transform).toBe('translate3d(0px, 0, 0)')
  })
})