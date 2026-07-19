// @vitest-environment jsdom

import { act, forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/stores'
import Layout from './Layout'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const motionState = vi.hoisted(() => ({ reduced: false }))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  useReducedMotion: () => motionState.reduced,
  motion: {
    nav: forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & {
      initial?: unknown
      animate?: unknown
      exit?: unknown
      transition?: unknown
    }>(function MockMotionNav({ initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) {
      return <nav ref={ref} data-motion-initial={JSON.stringify(initial)} {...props} />
    }),
  },
}))

vi.mock('./ThemeToggle', () => ({ default: () => <button type="button">主题</button> }))

let container: HTMLDivElement
let root: Root
let currentScrollY = 0
let scrollToMock: ReturnType<typeof vi.fn>

function mediaQueryList(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }
}

async function renderLayout() {
  await act(async () => root.render(
    <Layout>
      {({ activeTab }) => <output data-testid="active-tab">{activeTab}</output>}
    </Layout>,
  ))
}

function desktopLink(tab: string) {
  return container.querySelector<HTMLAnchorElement>(`nav[aria-label="主要功能"] a[href="/app/${tab}"]`)!
}

describe('top-level application navigation', () => {
  beforeEach(() => {
    motionState.reduced = false
    currentScrollY = 0
    window.history.replaceState({}, '', '/app/dashboard')
    window.matchMedia = vi.fn(mediaQueryList)
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => currentScrollY,
    })
    scrollToMock = vi.fn((options: ScrollToOptions | number, y?: number) => {
      currentScrollY = typeof options === 'number' ? y ?? 0 : options.top ?? 0
    })
    window.scrollTo = scrollToMock as typeof window.scrollTo
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    window.cancelAnimationFrame = vi.fn()
    useUIStore.setState({ activeTab: 'dashboard' })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('syncs tab selection with the URL and restores scroll per tab on popstate', async () => {
    await renderLayout()
    currentScrollY = 240

    await act(async () => desktopLink('automation').click())

    expect(window.location.pathname).toBe('/app/automation')
    expect(container.querySelector('[data-testid="active-tab"]')?.textContent).toBe('automation')
    expect(desktopLink('automation').getAttribute('aria-current')).toBe('page')
    expect(currentScrollY).toBe(0)

    currentScrollY = 510
    await act(async () => {
      window.history.replaceState({}, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(container.querySelector('[data-testid="active-tab"]')?.textContent).toBe('dashboard')
    expect(currentScrollY).toBe(240)

    await act(async () => {
      window.history.replaceState({}, '', '/app/automation')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(container.querySelector('[data-testid="active-tab"]')?.textContent).toBe('automation')
    expect(currentScrollY).toBe(510)
  })

  it('retries scroll restoration when lazy content grows after navigation', async () => {
    let availableScroll = 1000
    let resizeCallback: ResizeObserverCallback | null = null
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    window.scrollTo = vi.fn((options: ScrollToOptions | number, y?: number) => {
      const requested = typeof options === 'number' ? y ?? 0 : options.top ?? 0
      currentScrollY = Math.min(requested, availableScroll)
    }) as typeof window.scrollTo

    await renderLayout()
    currentScrollY = 640
    await act(async () => desktopLink('automation').click())

    availableScroll = 0
    await act(async () => {
      window.history.replaceState({}, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(currentScrollY).toBe(0)

    availableScroll = 1000
    await act(async () => resizeCallback?.([], {} as ResizeObserver))
    expect(currentScrollY).toBe(640)
  })

  it('captures scroll before a shorter lazy page can clamp the viewport', async () => {
    await renderLayout()
    currentScrollY = 420
    const unsubscribe = useUIStore.subscribe((state, previousState) => {
      if (state.activeTab !== previousState.activeTab) currentScrollY = 0
    })

    await act(async () => desktopLink('automation').click())
    expect(currentScrollY).toBe(0)

    await act(async () => {
      window.history.replaceState({}, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(currentScrollY).toBe(420)
    unsubscribe()
  })

  it('uses an anchored mobile menu with focus entry, Escape restoration, and outside dismissal', async () => {
    motionState.reduced = true
    await renderLayout()
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-controls="mobile-navigation"]')!

    await act(async () => trigger.click())

    const menu = container.querySelector<HTMLElement>('#mobile-navigation')!
    expect(menu.className).toContain('absolute')
    expect(menu.className).not.toContain('height')
    expect(menu.getAttribute('data-motion-initial')).toBe(JSON.stringify({ opacity: 0 }))
    expect(document.activeElement?.getAttribute('aria-current')).toBe('page')

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('#mobile-navigation')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    await act(async () => trigger.click())
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    expect(container.querySelector('#mobile-navigation')).toBeNull()
  })
})
