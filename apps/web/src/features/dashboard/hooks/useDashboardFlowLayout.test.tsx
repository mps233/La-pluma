// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDashboardFlowLayout } from './useDashboardFlowLayout'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
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

function Harness({ showFeedback, showStages = false }: { showFeedback: boolean; showStages?: boolean }) {
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
        {showStages && (
          <div data-dashboard-flow-stages style={{ paddingBottom: 12 }}>
            <div data-testid="stages-content" />
          </div>
        )}
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
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      media: '(width >= 1280px)',
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

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('keeps the columns stable when transient feedback is removed', async () => {
    await act(async () => root.render(<Harness showFeedback />))

    const grid = container.querySelector<HTMLElement>('[data-testid="grid"]')!
    const flow = container.querySelector<HTMLElement>('[data-testid="flow"]')!
    const feedback = container.querySelector<HTMLElement>('[data-dashboard-flow-feedback]')!
    const previewCard = container.querySelector<HTMLElement>('[data-dashboard-preview-card]')!
    const previewFrame = container.querySelector<HTMLElement>('[data-dashboard-preview-frame]')!

    grid.getBoundingClientRect = () => rect(1116, flowHeight)
    flow.getBoundingClientRect = () => rect(390, flowHeight)
    feedback.getBoundingClientRect = () => rect(390, 37)
    previewCard.getBoundingClientRect = () => rect(706, 437)
    previewFrame.getBoundingClientRect = () => rect(706, 397)

    await act(async () => resizeCallback?.([], {} as ResizeObserver))

    const stableColumns = 'minmax(0, 390px) minmax(0, 706px)'
    expect(grid.style.getPropertyValue('--dashboard-flow-columns')).toBe(stableColumns)

    flowHeight = 437
    await act(async () => root.render(<Harness showFeedback={false} />))
    await act(async () => resizeCallback?.([], {} as ResizeObserver))

    expect(grid.style.getPropertyValue('--dashboard-flow-columns')).toBe(stableColumns)
  })

  it('keeps the columns stable when the stage section stretches to match the preview', async () => {
    await act(async () => root.render(<Harness showFeedback={false} showStages />))

    const grid = container.querySelector<HTMLElement>('[data-testid="grid"]')!
    const flow = container.querySelector<HTMLElement>('[data-testid="flow"]')!
    const stages = container.querySelector<HTMLElement>('[data-dashboard-flow-stages]')!
    const stagesContent = container.querySelector<HTMLElement>('[data-testid="stages-content"]')!
    const previewCard = container.querySelector<HTMLElement>('[data-dashboard-preview-card]')!
    const previewFrame = container.querySelector<HTMLElement>('[data-dashboard-preview-frame]')!

    grid.getBoundingClientRect = () => rect(1116, flowHeight)
    flow.getBoundingClientRect = () => rect(390, flowHeight)
    stages.getBoundingClientRect = () => rect(390, flowHeight)
    stagesContent.getBoundingClientRect = () => rect(390, 425)
    previewCard.getBoundingClientRect = () => rect(706, 437)
    previewFrame.getBoundingClientRect = () => rect(706, 397)

    flowHeight = 533
    await act(async () => resizeCallback?.([], {} as ResizeObserver))
    expect(grid.style.getPropertyValue('--dashboard-flow-columns')).toBe('minmax(0, 390px) minmax(0, 706px)')

    flowHeight = 629
    await act(async () => resizeCallback?.([], {} as ResizeObserver))
    expect(grid.style.getPropertyValue('--dashboard-flow-columns')).toBe('minmax(0, 390px) minmax(0, 706px)')
  })
})
