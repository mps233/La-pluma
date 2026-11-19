// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TruncatedText from './TruncatedText'

afterEach(cleanup)

let clientWidth = 96
let scrollWidth = 240

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
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
  })

  const renderTruncated = async (element: React.ReactElement) => {
    const result = render(element)
    // The component measures in a queued microtask after its layout effect.
    await act(async () => {
      await Promise.resolve()
    })
    return result
  }

  it('shows the full text only when the line is actually cut', async () => {
    clientWidth = 96
    scrollWidth = 240

    const { container } = await renderTruncated(
      <TruncatedText tooltip="固源岩×10、基础作战记录×9">
        固源岩×10、基础作战记录×9
      </TruncatedText>,
    )

    expect(container.querySelector('.app-truncate')?.getAttribute('data-truncated')).toBe('true')

    fireEvent.pointerOver(screen.getByText('固源岩×10、基础作战记录×9'), { relatedTarget: null })
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(screen.getByRole('tooltip').textContent).toBe('固源岩×10、基础作战记录×9')
  })

  it('does not open a tooltip when the text fits', async () => {
    clientWidth = 200
    scrollWidth = 180

    const { container } = await renderTruncated(
      <TruncatedText tooltip="完整文本">完整文本</TruncatedText>,
    )

    expect(container.querySelector('.app-truncate')?.getAttribute('data-truncated')).toBeNull()

    fireEvent.pointerOver(screen.getByText('完整文本'), { relatedTarget: null })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
