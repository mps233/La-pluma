// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSwipePager } from './useSwipePager'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

async function swipe(element: Element, fromX: number, fromY: number, toX: number, toY: number) {
  await act(async () => {
    element.dispatchEvent(touchEvent('touchstart', fromX, fromY, element))
    element.dispatchEvent(touchEvent('touchend', toX, toY, element))
  })
}

let container: HTMLDivElement
let root: Root

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
  beforeEach(async () => {
    installMobileMatchMedia()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  const pager = () => container.querySelector<HTMLElement>('[data-testid="pager"]')!
  const index = () => container.querySelector<HTMLElement>('[data-testid="index"]')?.textContent

  it('advances on a left swipe and goes back on a right swipe', async () => {
    await swipe(pager(), 200, 200, 100, 205)
    expect(index()).toBe('1')

    await swipe(pager(), 100, 200, 180, 200)
    expect(index()).toBe('0')
  })

  it('ignores mostly vertical drags', async () => {
    await swipe(pager(), 200, 200, 180, 300)
    expect(index()).toBe('0')
  })

  it('ignores swipes that start on an interactive control', async () => {
    const button = container.querySelector<HTMLElement>('[data-testid="button"]')!
    await swipe(button, 200, 200, 100, 200)
    expect(index()).toBe('0')
  })

  it('clamps at the last page', async () => {
    await swipe(pager(), 200, 200, 100, 200)
    await swipe(pager(), 200, 200, 100, 200)
    expect(index()).toBe('2')

    await swipe(pager(), 200, 200, 100, 200)
    expect(index()).toBe('2')
  })

  it('stays idle outside mobile viewports', async () => {
    installMobileMatchMedia(false)
    await swipe(pager(), 200, 200, 100, 200)
    expect(index()).toBe('0')
  })

  it('ignores gestures that start on the extra ignore selector', async () => {
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

    await act(async () => root.render(<Probe />))
    const ignored = container.querySelector<HTMLElement>('[data-testid="ignored"]')!

    await swipe(ignored, 200, 200, 100, 200)
    expect(container.querySelector<HTMLElement>('[data-testid="probe-index"]')?.textContent).toBe('0')

    await swipe(container.querySelector<HTMLElement>('[data-testid="probe"]')!, 200, 200, 100, 200)
    expect(container.querySelector<HTMLElement>('[data-testid="probe-index"]')?.textContent).toBe('1')
  })

  it('reports drag offsets and release commits without changing the index', async () => {
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

    await act(async () => root.render(<Probe />))
    const probe = container.querySelector<HTMLElement>('[data-testid="probe"]')!

    await act(async () => {
      probe.dispatchEvent(touchEvent('touchstart', 200, 200, probe))
      probe.dispatchEvent(touchEvent('touchmove', 120, 200, probe))
    })
    expect(onMove).toHaveBeenLastCalledWith(-80)

    await act(async () => {
      probe.dispatchEvent(touchEvent('touchend', 120, 200, probe))
    })
    expect(onRelease).toHaveBeenLastCalledWith({ direction: 1, nextIndex: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })
})