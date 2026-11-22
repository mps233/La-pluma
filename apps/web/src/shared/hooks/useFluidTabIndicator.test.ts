// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { measureFluidTabRect, useFluidTabIndicator } from './useFluidTabIndicator'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

  it('falls back to offset geometry when the container rect is visually scaled', () => {
    const container = document.createElement('div')
    const button = document.createElement('button')
    container.appendChild(button)
    document.body.appendChild(container)
    Object.defineProperties(container, {
      offsetWidth: { configurable: true, value: 600 },
      offsetHeight: { configurable: true, value: 52 },
    })
    Object.defineProperties(button, {
      offsetLeft: { configurable: true, value: 200 },
      offsetTop: { configurable: true, value: 0 },
      offsetWidth: { configurable: true, value: 200 },
      offsetHeight: { configurable: true, value: 52 },
    })
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      bottom: 249.4,
      height: 49.4,
      left: 95,
      right: 665,
      top: 200,
      width: 570,
      x: 95,
      y: 200,
      toJSON: () => ({}),
    })
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      bottom: 249.4,
      height: 49.4,
      left: 285,
      right: 475,
      top: 200,
      width: 190,
      x: 285,
      y: 200,
      toJSON: () => ({}),
    })

    expect(measureFluidTabRect(container, button)).toEqual({
      x: 200,
      y: 0,
      width: 200,
      height: 52,
    })
    container.remove()
  })
})

interface ProbeRect {
  x: number
  y: number
  width: number
  height: number
}

const rectOf = (left: number, top: number, width: number, height: number): DOMRect => ({
  bottom: top + height,
  height,
  left,
  right: left + width,
  top,
  width,
  x: left,
  y: top,
  toJSON: () => ({}),
})

let mountPoint: HTMLDivElement
let root: Root
let containerRect: DOMRect
let tabRect: DOMRect

function IndicatorProbe({
  mount,
  layoutKey,
}: {
  mount: 'detached' | 'container' | 'tabs'
  layoutKey?: unknown
}) {
  const { containerRef, activeRect, setTabRef } = useFluidTabIndicator('first', layoutKey)

  return createElement(
    'div',
    null,
    createElement('output', {
      'data-probe-rect': `${activeRect.x},${activeRect.y},${activeRect.width},${activeRect.height}`,
    }),
    mount === 'detached'
      ? null
      : createElement(
        'div',
        { ref: containerRef, id: 'probe-container' },
        mount === 'tabs'
          ? createElement('button', { ref: setTabRef('first'), type: 'button' }, '第一个')
          : null,
      ),
  )
}

const probeRect = (): ProbeRect => {
  const [x, y, width, height] = (mountPoint.querySelector('[data-probe-rect]')?.getAttribute('data-probe-rect') ?? '')
    .split(',')
    .map(Number)
  return { x: x ?? 0, y: y ?? 0, width: width ?? 0, height: height ?? 0 }
}

const renderProbe = async (props: { mount: 'detached' | 'container' | 'tabs'; layoutKey?: unknown }) => {
  await act(async () => {
    root.render(createElement(IndicatorProbe, props))
  })
}

describe('useFluidTabIndicator', () => {
  beforeEach(() => {
    containerRect = rectOf(100, 200, 600, 52)
    tabRect = rectOf(300, 200, 200, 52)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.id === 'probe-container' ? containerRect : tabRect
    })
    mountPoint = document.createElement('div')
    document.body.appendChild(mountPoint)
    root = createRoot(mountPoint)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    mountPoint.remove()
    vi.restoreAllMocks()
  })

  it('measures the active tab once the container and tabs mount later', async () => {
    await renderProbe({ mount: 'detached' })
    expect(probeRect()).toEqual({ x: 0, y: 0, width: 0, height: 0 })

    await renderProbe({ mount: 'container' })
    expect(probeRect()).toEqual({ x: 0, y: 0, width: 0, height: 0 })

    await renderProbe({ mount: 'tabs', layoutKey: true })
    expect(probeRect()).toEqual({ x: 200, y: 0, width: 200, height: 52 })
  })

  it('measures when the container mounts together with its tabs', async () => {
    await renderProbe({ mount: 'detached' })
    expect(probeRect()).toEqual({ x: 0, y: 0, width: 0, height: 0 })

    await renderProbe({ mount: 'tabs' })
    expect(probeRect()).toEqual({ x: 200, y: 0, width: 200, height: 52 })
  })

  it('re-measures when layoutKey changes while the tabs stay mounted', async () => {
    await renderProbe({ mount: 'tabs', layoutKey: false })
    expect(probeRect()).toEqual({ x: 200, y: 0, width: 200, height: 52 })

    containerRect = rectOf(0, 0, 480, 52)
    tabRect = rectOf(160, 0, 160, 52)
    await renderProbe({ mount: 'tabs', layoutKey: true })
    expect(probeRect()).toEqual({ x: 160, y: 0, width: 160, height: 52 })
  })

  it('resets the rect when the container unmounts', async () => {
    await renderProbe({ mount: 'tabs' })
    expect(probeRect()).toEqual({ x: 200, y: 0, width: 200, height: 52 })

    await renderProbe({ mount: 'detached' })
    expect(probeRect()).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})
