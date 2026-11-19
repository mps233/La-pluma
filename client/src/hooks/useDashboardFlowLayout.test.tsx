// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDashboardFlowLayout } from './useDashboardFlowLayout'

let resizeCallback: ResizeObserverCallback | null = null
let flowHeight = 474

const rect = (width: number, height: number): DOMRect => ({
  x: 0,
  y: 0,
  top: 0,
  right: width,
  bottom: height,
  left: 0,
  width,
  height,
  toJSON: () => ({}),
})

function Harness({ showFeedback }: { showFeedback: boolean }) {
  const {
    flowGridRef,
    flowCardRef,
    flowPreviewRef,
    flowGridStyle,
  } = useDashboardFlowLayout()

  return (
    <div ref={flowGridRef} data-testid="grid" style={flowGridStyle}>
      <div ref={flowCardRef} data-testid="flow">
        {showFeedback && <div data-dashboard-flow-feedback />}
      </div>
      <div ref={flowPreviewRef}>
        <div data-dashboard-preview-card>
          <div data-dashboard-preview-frame />
        </div>
      </div>
    </div>
  )
}

describe('useDashboardFlowLayout', () => {
  beforeEach(() => {
    flowHeight = 474
    resizeCallback = null

    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      media: '(min-width: 1280px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      observe() {}
      disconnect() {}
      unobserve() {}
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps the columns stable when transient feedback is removed', async () => {
    const { rerender } = render(<Harness showFeedback />)

    const grid = screen.getByTestId('grid')
    const flow = screen.getByTestId('flow')
    const feedback = document.querySelector<HTMLElement>('[data-dashboard-flow-feedback]')!
    const previewCard = document.querySelector<HTMLElement>('[data-dashboard-preview-card]')!
    const previewFrame = document.querySelector<HTMLElement>('[data-dashboard-preview-frame]')!

    grid.getBoundingClientRect = () => rect(1116, flowHeight)
    flow.getBoundingClientRect = () => rect(390, flowHeight)
    feedback.getBoundingClientRect = () => rect(390, 37)
    previewCard.getBoundingClientRect = () => rect(706, 437)
    previewFrame.getBoundingClientRect = () => rect(706, 397)

    await act(async () => resizeCallback?.([], {} as ResizeObserver))

    const stableColumns = 'minmax(0, 390px) minmax(0, 706px)'
    expect(grid.style.getPropertyValue('--dashboard-flow-columns')).toBe(stableColumns)

    flowHeight = 437
    rerender(<Harness showFeedback={false} />)
    await act(async () => resizeCallback?.([], {} as ResizeObserver))

    expect(grid.style.getPropertyValue('--dashboard-flow-columns')).toBe(stableColumns)
  })
})
