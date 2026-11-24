// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePanelScrollTop } from './usePanelScrollTop'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fakeRect = (top: number, bottom: number, left = 0, right = 400) => ({
  top,
  bottom,
  left,
  right,
  width: right - left,
  height: bottom - top,
  x: left,
  y: top,
  toJSON: () => ({}),
})

type FakeRect = ReturnType<typeof fakeRect>

const stubRect = (element: Element, read: () => FakeRect) => {
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: read })
}

function Harness() {
  const {
    setScrollNode,
    setContentBandNode,
    isScrolled,
    isInContentBand,
    scrollMetrics,
    handleScroll,
  } = usePanelScrollTop(true)
  return (
    <div>
      <div data-scroll-clip="panel" data-clip="">
        <div ref={setContentBandNode} data-band="" />
      </div>
      <div ref={setScrollNode} data-scroll="" onScroll={handleScroll} />
      <output>{`${isScrolled}:${isInContentBand}:${scrollMetrics.hasOverflow}`}</output>
    </div>
  )
}

let container: HTMLDivElement
let navbar: HTMLElement
let tabbar: HTMLElement
let root: Root

const clipNode = () => container.querySelector<HTMLElement>('[data-clip]')!
const bandNode = () => container.querySelector<HTMLElement>('[data-band]')!
const scrollNode = () => container.querySelector<HTMLElement>('[data-scroll]')!
const gateState = () => container.querySelector('output')!.textContent

const renderHook = async () => {
  await act(async () => {
    root.render(<Harness />)
  })
}

const setBandTop = (top: number, height = 28) => {
  stubRect(bandNode(), () => fakeRect(top, top + height, 180, 220))
}

const setClip = (top: number, bottom: number) => {
  stubRect(clipNode(), () => fakeRect(top, bottom))
}

const dispatchHostScroll = async () => {
  await act(async () => {
    container.dispatchEvent(new Event('scroll'))
  })
}

const dispatchWindowScroll = async () => {
  await act(async () => {
    window.dispatchEvent(new Event('scroll'))
  })
}

const scrollPanelTo = async (top: number) => {
  const node = scrollNode()
  node.scrollTop = top
  await act(async () => {
    node.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
}

describe('usePanelScrollTop content band gate', () => {
  beforeEach(() => {
    document.body.innerHTML = ''

    navbar = document.createElement('header')
    navbar.dataset.region = 'navbar'
    stubRect(navbar, () => fakeRect(0, 76))
    tabbar = document.createElement('footer')
    tabbar.dataset.region = 'tabbar'
    stubRect(tabbar, () => fakeRect(696, 768))
    document.body.append(navbar, tabbar)

    container = document.createElement('div')
    container.dataset.region = 'scroll'
    stubRect(container, () => fakeRect(0, 768))
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    navbar.remove()
    tabbar.remove()
  })

  it('opens the gate only while the full anchor sits between the navbar and the tabbar', async () => {
    await renderHook()
    await scrollPanelTo(400)

    setBandTop(700)
    await dispatchHostScroll()
    expect(gateState()).toBe('true:false:false')

    setBandTop(92)
    await dispatchHostScroll()
    expect(gateState()).toBe('true:true:false')
  })

  it('keeps the gate closed while the anchor is behind the navbar', async () => {
    await renderHook()
    await scrollPanelTo(400)

    setBandTop(60)
    await dispatchHostScroll()
    expect(gateState()).toBe('true:false:false')

    setBandTop(76)
    await dispatchHostScroll()
    expect(gateState()).toBe('true:true:false')
  })

  it('requires the whole anchor to clear the tabbar reserved height', async () => {
    await renderHook()
    await scrollPanelTo(400)

    setBandTop(668)
    await dispatchHostScroll()
    expect(gateState()).toBe('true:true:false')

    setBandTop(669)
    await dispatchHostScroll()
    expect(gateState()).toBe('true:false:false')
  })

  it('commits the gate inside the scroll dispatch so no frame paints before it', async () => {
    await renderHook()
    await scrollPanelTo(400)
    setBandTop(92)
    await dispatchHostScroll()
    expect(gateState()).toBe('true:true:false')

    const observed: string[] = []
    const probe = () => observed.push(gateState())
    container.addEventListener('scroll', probe)

    setBandTop(700)
    await dispatchHostScroll()
    container.removeEventListener('scroll', probe)

    expect(observed).toEqual(['true:false:false'])
    expect(gateState()).toBe('true:false:false')
  })

  it('hides the button when the panel clip cuts the anchor short', async () => {
    await renderHook()
    await scrollPanelTo(400)
    setBandTop(92)

    setClip(0, 110)
    await dispatchHostScroll()
    expect(gateState()).toBe('true:false:false')

    setClip(0, 120)
    await dispatchHostScroll()
    expect(gateState()).toBe('true:true:false')
  })

  it('extends the content band to the host bottom when the tabbar is hidden', async () => {
    stubRect(tabbar, () => fakeRect(0, 0))
    await renderHook()
    await scrollPanelTo(400)

    setBandTop(700)
    await dispatchHostScroll()
    expect(gateState()).toBe('true:true:false')
    expect(tabbar.getBoundingClientRect().height).toBe(0)
  })

  it('re-measures the content band when the viewport chrome changes', async () => {
    await renderHook()
    await scrollPanelTo(400)

    setBandTop(700)
    await dispatchHostScroll()
    expect(gateState()).toBe('true:false:false')

    stubRect(tabbar, () => fakeRect(768, 768))
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(gateState()).toBe('true:true:false')

    setBandTop(100)
    stubRect(navbar, () => fakeRect(0, 120))
    await act(async () => {
      window.dispatchEvent(new Event('orientationchange'))
    })
    expect(gateState()).toBe('true:false:false')
  })

  it('falls back to the viewport band when the panel is rendered outside the shell scroll host', async () => {
    document.body.removeChild(container)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await renderHook()
    await scrollPanelTo(400)

    setBandTop(700)
    await dispatchWindowScroll()
    expect(gateState()).toBe('true:false:false')

    setBandTop(92)
    await dispatchWindowScroll()
    expect(gateState()).toBe('true:true:false')
  })

  it('derives scroll progress and viewport ratio from the real scroll geometry', async () => {
    await renderHook()
    setBandTop(92)
    await dispatchHostScroll()

    const node = scrollNode()
    Object.defineProperty(node, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(node, 'clientHeight', { configurable: true, value: 500 })

    await scrollPanelTo(250)
    expect(gateState()).toBe('true:true:true')
    expect(node.scrollTop).toBe(250)

    await scrollPanelTo(0)
    expect(gateState()).toBe('false:true:true')
  })
})
