// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSwipePager } from './useSwipePager'

afterEach(cleanup)

function Harness() {
  const [index, setIndex] = useState(0)
  const handlers = useSwipePager<HTMLDivElement>({
    count: 3,
    index,
    onChange: setIndex,
    threshold: 50,
  })

  return (
    <div data-testid="pager" {...handlers}>
      <button type="button" data-testid="button">button</button>
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

function swipe(element: Element, fromX: number, fromY: number, toX: number, toY: number) {
  fireEvent(element, touchEvent('touchstart', fromX, fromY, element))
  fireEvent(element, touchEvent('touchend', toX, toY, element))
}

function installMobileMatchMedia(matches = true) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: matches && (query === '(pointer: coarse)' || query === '(max-width: 639px)'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

describe('useSwipePager', () => {
  beforeEach(() => {
    installMobileMatchMedia()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderPager = () => render(<Harness />)
  const pager = () => screen.getByTestId('pager')
  const index = () => screen.getByTestId('index').textContent

  it('advances on a left swipe and goes back on a right swipe', () => {
    renderPager()

    swipe(pager(), 200, 200, 100, 205)
    expect(index()).toBe('1')

    swipe(pager(), 100, 200, 180, 200)
    expect(index()).toBe('0')
  })

  it('ignores mostly vertical drags', () => {
    renderPager()

    swipe(pager(), 200, 200, 180, 300)
    expect(index()).toBe('0')
  })

  it('ignores swipes that start on an interactive control', () => {
    renderPager()

    const button = screen.getByTestId('button')
    swipe(button, 200, 200, 100, 200)
    expect(index()).toBe('0')
  })

  it('clamps at the last page', () => {
    renderPager()

    swipe(pager(), 200, 200, 100, 200)
    swipe(pager(), 200, 200, 100, 200)
    expect(index()).toBe('2')

    swipe(pager(), 200, 200, 100, 200)
    expect(index()).toBe('2')
  })

  it('stays idle outside mobile viewports', () => {
    renderPager()

    installMobileMatchMedia(false)
    swipe(pager(), 200, 200, 100, 200)
    expect(index()).toBe('0')
  })

  it('ignores gestures that start on the extra ignore selector', () => {
    function Probe() {
      const [index, setIndex] = useState(0)
      const handlers = useSwipePager<HTMLDivElement>({
        count: 3,
        index,
        onChange: setIndex,
        threshold: 50,
        extraIgnoreSelector: '.ignore-me',
      })
      return (
        <div data-testid="probe" {...handlers}>
          <div data-testid="ignored" className="ignore-me">ignored</div>
          <output data-testid="probe-index">{index}</output>
        </div>
      )
    }

    render(<Probe />)
    const ignored = screen.getByTestId('ignored')

    swipe(ignored, 200, 200, 100, 200)
    expect(screen.getByTestId('probe-index').textContent).toBe('0')

    swipe(screen.getByTestId('probe'), 200, 200, 100, 200)
    expect(screen.getByTestId('probe-index').textContent).toBe('1')
  })

  it('reports drag offsets and release commits without changing the index', () => {
    const onChange = vi.fn()
    const onMove = vi.fn()
    const onRelease = vi.fn()

    function Probe() {
      const handlers = useSwipePager<HTMLDivElement>({
        count: 3,
        index: 0,
        onChange,
        onMove,
        onRelease,
        threshold: 50,
      })
      return <div data-testid="probe" {...handlers} />
    }

    render(<Probe />)
    const probe = screen.getByTestId('probe')

    fireEvent(probe, touchEvent('touchstart', 200, 200, probe))
    fireEvent(probe, touchEvent('touchmove', 120, 200, probe))
    expect(onMove).toHaveBeenLastCalledWith(-80)

    fireEvent(probe, touchEvent('touchend', 120, 200, probe))
    expect(onRelease).toHaveBeenLastCalledWith({ direction: 1, nextIndex: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })
})
