// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TruncatedText from './TruncatedText'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let clientWidth = 96
let scrollWidth = 240

const getTrigger = () => container.querySelector<HTMLElement>('span.inline-flex')
const getTooltip = () => document.querySelector<HTMLElement>('[role="tooltip"]')

describe('TruncatedText', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => clientWidth,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => scrollWidth,
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
    container.remove()
  })

  it('shows the full text only when the line is actually cut', async () => {
    clientWidth = 96
    scrollWidth = 240

    await act(async () => root.render(
      <TruncatedText tooltip="固源岩×10、基础作战记录×9">
        固源岩×10、基础作战记录×9
      </TruncatedText>,
    ))

    expect(container.querySelector('.app-truncate')?.getAttribute('data-truncated')).toBe('true')

    await act(async () => {
      getTrigger()?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: null }))
    })
    expect(getTooltip()).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    expect(getTooltip()?.textContent).toBe('固源岩×10、基础作战记录×9')
  })

  it('does not open a tooltip when the text fits', async () => {
    clientWidth = 200
    scrollWidth = 180

    await act(async () => root.render(
      <TruncatedText tooltip="完整文本">完整文本</TruncatedText>,
    ))

    expect(container.querySelector('.app-truncate')?.getAttribute('data-truncated')).toBeNull()

    await act(async () => {
      getTrigger()?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: null }))
      vi.advanceTimersByTime(400)
    })
    expect(getTooltip()).toBeNull()
  })
})
