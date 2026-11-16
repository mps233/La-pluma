// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDashboardFlowLayout } from './useDashboardFlowLayout'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let rootUnmounted = false
let resizeCallback: ResizeObserverCallback | null = null
let observedTargets: Element[]
let disconnectSpy: ReturnType<typeof vi.fn<() => void>>
let resizeObserverConstructions = 0
let mediaMatches = true
let mediaChangeListeners: Array<(event: MediaQueryListEvent) => void>
let mediaAddEventListener: ReturnType<typeof vi.fn>
let mediaRemoveEventListener: ReturnType<typeof vi.fn>
let frameCallbacks: Map<number, FrameRequestCallback>
let nextFrameId = 1
let cancelAnimationFrameSpy: ReturnType<typeof vi.fn>
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

function Harness({
  enabled = true,
  showFeedback,
  showPreview = true,
  showStages = false,
}: {
  enabled?: boolean
  showFeedback: boolean
  showPreview?: boolean
  showStages?: boolean
}) {
  const {
    flowGridRef,
    flowCardRef,
    flowPreviewRef,
    flowGridStyle,
  } = useDashboardFlowLayout(enabled)

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
      <div ref={flowPreviewRef} data-testid="preview-shell">
        {showPreview && (
          <div data-dashboard-preview-card>
            <div data-dashboard-preview-frame />
          </div>
        )}
      </div>
    </div>
  )
}

function gridElement(): HTMLElement {
  return container.querySelector<HTMLElement>('[data-testid="grid"]')!
}

function flowElement(): HTMLElement {
  return container.querySelector<HTMLElement>('[data-testid="flow"]')!
}

function previewCardElement(): HTMLElement {
  return container.querySelector<HTMLElement>('[data-dashboard-preview-card]')!
}

function previewFrameElement(): HTMLElement {
  return container.querySelector<HTMLElement>('[data-dashboard-preview-frame]')!
}

function flowColumns(): string {
  return gridElement().style.getPropertyValue('--dashboard-flow-columns')
}

function applyDesktopGeometry() {
  gridElement().getBoundingClientRect = () => rect(1116, flowHeight)
  flowElement().getBoundingClientRect = () => rect(390, flowHeight)
  previewCardElement().getBoundingClientRect = () => rect(706, 437)
  previewFrameElement().getBoundingClientRect = () => rect(706, 397)
}

async function flushFrames() {
  const callbacks = [...frameCallbacks.values()]
  frameCallbacks.clear()
  await act(async () => {
    for (const callback of callbacks) callback(0)
  })
}

async function dispatchResize() {
  await act(async () => {
    window.dispatchEvent(new Event('resize'))
  })
  await flushFrames()
}

async function changeMediaMatch(matches: boolean) {
  mediaMatches = matches
  await act(async () => {
    for (const listener of [...mediaChangeListeners]) {
      listener({ matches } as MediaQueryListEvent)
    }
  })
  await flushFrames()
}

describe('useDashboardFlowLayout', () => {
  beforeEach(() => {
    flowHeight = 474
    resizeCallback = null
    observedTargets = []
    resizeObserverConstructions = 0
    mediaMatches = true
    mediaChangeListeners = []
    frameCallbacks = new Map()
    nextFrameId = 1
    cancelAnimationFrameSpy = vi.fn((id: number) => {
      frameCallbacks.delete(id)
    })
    disconnectSpy = vi.fn<() => void>()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    rootUnmounted = false

    mediaAddEventListener = vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === 'change') mediaChangeListeners.push(listener)
    })
    mediaRemoveEventListener = vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type !== 'change') return
      const index = mediaChangeListeners.indexOf(listener)
      if (index >= 0) mediaChangeListeners.splice(index, 1)
    })

    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return mediaMatches
      },
      media: '(width >= 1280px)',
      onchange: null,
      addEventListener: mediaAddEventListener,
      removeEventListener: mediaRemoveEventListener,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++
      frameCallbacks.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameSpy)
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverConstructions += 1
        resizeCallback = callback
      }

      observe(target: Element) {
        observedTargets.push(target)
      }

      disconnect() {
        disconnectSpy()
      }

      unobserve() {}
    })
  })

  afterEach(async () => {
    if (!rootUnmounted) await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('leaves the columns to the stylesheet until the first measurement', async () => {
    await act(async () => root.render(<Harness showFeedback />))

    expect(flowColumns()).toBe('')

    applyDesktopGeometry()
    await flushFrames()

    expect(flowColumns()).toBe('minmax(0, 360px) minmax(0, 736px)')
  })

  it('keeps the columns stable when transient feedback is removed', async () => {
    await act(async () => root.render(<Harness showFeedback />))

    gridElement().getBoundingClientRect = () => rect(1116, flowHeight)
    flowElement().getBoundingClientRect = () => rect(390, flowHeight)
    container.querySelector<HTMLElement>('[data-dashboard-flow-feedback]')!
      .getBoundingClientRect = () => rect(390, 37)
    previewCardElement().getBoundingClientRect = () => rect(706, 437)
    previewFrameElement().getBoundingClientRect = () => rect(706, 397)

    await flushFrames()

    const stableColumns = 'minmax(0, 390px) minmax(0, 706px)'
    expect(flowColumns()).toBe(stableColumns)

    flowHeight = 437
    await act(async () => root.render(<Harness showFeedback={false} />))
    await act(async () => resizeCallback?.([], {} as ResizeObserver))
    await flushFrames()

    expect(flowColumns()).toBe(stableColumns)
  })

  it('keeps the columns stable when the stage section stretches to match the preview', async () => {
    await act(async () => root.render(<Harness showFeedback={false} showStages />))

    gridElement().getBoundingClientRect = () => rect(1116, flowHeight)
    flowElement().getBoundingClientRect = () => rect(390, flowHeight)
    const stages = container.querySelector<HTMLElement>('[data-dashboard-flow-stages]')!
    const stagesContent = container.querySelector<HTMLElement>('[data-testid="stages-content"]')!
    stages.getBoundingClientRect = () => rect(390, flowHeight)
    stagesContent.getBoundingClientRect = () => rect(390, 425)
    previewCardElement().getBoundingClientRect = () => rect(706, 437)
    previewFrameElement().getBoundingClientRect = () => rect(706, 397)

    flowHeight = 533
    await flushFrames()
    expect(flowColumns()).toBe('minmax(0, 390px) minmax(0, 706px)')

    flowHeight = 629
    await act(async () => resizeCallback?.([], {} as ResizeObserver))
    await flushFrames()
    expect(flowColumns()).toBe('minmax(0, 390px) minmax(0, 706px)')
  })

  it('recomputes the columns when the grid resizes', async () => {
    await act(async () => root.render(<Harness showFeedback={false} />))

    applyDesktopGeometry()
    await flushFrames()
    expect(flowColumns()).toBe('minmax(0, 360px) minmax(0, 736px)')

    gridElement().getBoundingClientRect = () => rect(900, flowHeight)
    await dispatchResize()

    expect(flowColumns()).toBe('minmax(0, 360px) minmax(0, 520px)')
  })

  it('clears the inline override below the wide breakpoint and restores it above', async () => {
    await act(async () => root.render(<Harness showFeedback={false} />))

    applyDesktopGeometry()
    await flushFrames()
    expect(flowColumns()).not.toBe('')

    await changeMediaMatch(false)
    expect(flowColumns()).toBe('')

    await changeMediaMatch(true)
    expect(flowColumns()).toBe('minmax(0, 360px) minmax(0, 736px)')
  })

  it('leaves the columns to the stylesheet when the preview anchors are missing', async () => {
    await act(async () => root.render(<Harness showFeedback={false} showPreview={false} />))

    gridElement().getBoundingClientRect = () => rect(1116, flowHeight)
    flowElement().getBoundingClientRect = () => rect(390, flowHeight)

    await flushFrames()

    expect(flowColumns()).toBe('')
  })

  it('drops the inline override while measurements are unavailable', async () => {
    await act(async () => root.render(<Harness showFeedback={false} />))

    await flushFrames()
    expect(flowColumns()).toBe('')

    applyDesktopGeometry()
    await dispatchResize()
    expect(flowColumns()).toBe('minmax(0, 360px) minmax(0, 736px)')

    gridElement().getBoundingClientRect = () => rect(0, flowHeight)
    await dispatchResize()
    expect(flowColumns()).toBe('')
  })

  it('observes the grid, flow card, preview shell, card and frame', async () => {
    await act(async () => root.render(<Harness showFeedback={false} />))

    expect(resizeObserverConstructions).toBe(1)
    expect(new Set(observedTargets)).toEqual(new Set([
      gridElement(),
      flowElement(),
      container.querySelector<HTMLElement>('[data-testid="preview-shell"]')!,
      previewCardElement(),
      previewFrameElement(),
    ]))
  })

  it('releases observers, listeners and the pending frame on unmount', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    await act(async () => root.render(<Harness showFeedback={false} />))

    const resizeListener = addEventListenerSpy.mock.calls.find(([type]) => type === 'resize')?.[1]
    expect(resizeListener).toBeDefined()

    await act(async () => root.unmount())
    rootUnmounted = true

    expect(disconnectSpy).toHaveBeenCalledTimes(1)
    expect(mediaRemoveEventListener).toHaveBeenCalledWith('change', resizeListener)
    expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', resizeListener)
    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(1)
  })

  it('does not observe or listen while disabled', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

    await act(async () => root.render(<Harness enabled={false} showFeedback={false} />))

    expect(resizeObserverConstructions).toBe(0)
    expect(observedTargets).toEqual([])
    expect(mediaAddEventListener).not.toHaveBeenCalled()
    expect(addEventListenerSpy.mock.calls
      .filter(([type]) => type === 'resize')).toEqual([])
    expect(flowColumns()).toBe('')
  })

  it('coalesces a burst of notifications into one measurement pass', async () => {
    await act(async () => root.render(<Harness showFeedback={false} />))
    applyDesktopGeometry()
    await flushFrames()

    const measure = vi.spyOn(gridElement(), 'getBoundingClientRect')
    const before = measure.mock.calls.length

    await act(async () => {
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('resize'))
    })

    expect(frameCallbacks.size).toBe(1)

    await flushFrames()

    expect(measure.mock.calls.length - before).toBe(1)
    expect(flowColumns()).toBe('minmax(0, 360px) minmax(0, 736px)')
  })
})
