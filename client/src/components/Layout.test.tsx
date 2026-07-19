// @vitest-environment jsdom

import { act, createElement, useEffect, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/stores'
import Layout from './Layout'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/*
 * Layout owns navigation state and history. Framework7 owns the DOM details of
 * its chrome, so keep those details out of this unit test and expose the
 * semantic elements that Layout's behavior actually controls.
 */
vi.mock('../framework7', () => ({ default: {} }))
vi.mock('framework7-react', () => {
  const frameworkProps = new Set([
    'bottom',
    'closeByBackdropClick',
    'closeOnEscape',
    'external',
    'icons',
    'iconOnly',
    'main',
    'noSwipeback',
    'opened',
    'onSheetClosed',
    'pageContent',
    'router',
    'sheetClose',
    'sheetOpen',
    'slot',
    'swipeToClose',
    'tabLink',
    'tabLinkActive',
    'tabbarLabel',
    'text',
    'tooltip',
  ])

  type MockProps = Record<string, unknown> & { children?: ReactNode }

  const domProps = (props: MockProps) => Object.fromEntries(
    Object.entries(props).filter(([key]) => key !== 'children' && !frameworkProps.has(key)),
  )

  const MockContainer = ({ as = 'div', children, ...props }: MockProps & { as?: string }) => (
    createElement(as, domProps(props), children)
  )

  const MockLink = ({ children, text, ...props }: MockProps & { text?: string }) => (
    createElement('a', domProps(props), children, text ? createElement('span', {}, text) : null)
  )

  const MockSheet = ({ children, opened = false, onSheetClosed, id, ...props }: MockProps & {
    opened?: boolean
    onSheetClosed?: () => void
    id?: string
  }) => {
    const wasOpened = useRef(Boolean(opened))

    useEffect(() => {
      if (wasOpened.current && !opened) onSheetClosed?.()
      wasOpened.current = Boolean(opened)
    }, [onSheetClosed, opened])

    useEffect(() => {
      if (!opened) return undefined

      const close = (event: KeyboardEvent | PointerEvent) => {
        if (event instanceof KeyboardEvent && event.key !== 'Escape') return
        if (event instanceof PointerEvent && id && document.getElementById(id)?.contains(event.target as Node)) return
        onSheetClosed?.()
      }
      document.addEventListener('keydown', close)
      document.addEventListener('pointerdown', close)
      return () => {
        document.removeEventListener('keydown', close)
        document.removeEventListener('pointerdown', close)
      }
    }, [id, onSheetClosed, opened])

    if (!opened) return null
    return createElement('section', {
      ...domProps({ ...props, id }),
      id,
      role: 'dialog',
    }, children)
  }

  return {
    App: ({ children, ...props }: MockProps) => createElement('div', { ...domProps(props), 'data-framework7-app': 'true' }, children),
    Link: MockLink,
    NavLeft: MockContainer,
    NavRight: MockContainer,
    NavTitle: MockContainer,
    Navbar: ({ children, ...props }: MockProps) => createElement('header', domProps(props), children),
    Page: MockContainer,
    Sheet: MockSheet,
    Toolbar: ({ children, ...props }: MockProps) => createElement('nav', domProps(props), children),
    View: MockContainer,
    Button: MockContainer,
    Card: MockContainer,
    CardHeader: MockContainer,
    CardContent: MockContainer,
  }
})

vi.mock('./ThemeToggle', () => ({ default: () => <button type="button">主题</button> }))

let container: HTMLDivElement
let root: Root
let currentScrollY = 0
let availableScroll = Number.POSITIVE_INFINITY
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

function getScrollHost() {
  return container.querySelector<HTMLElement>('.la-pluma-scroll-host')!
}

function installScrollModel() {
  const host = getScrollHost()
  Object.defineProperty(host, 'scrollTop', {
    configurable: true,
    get: () => currentScrollY,
    set: (value: number) => {
      currentScrollY = Math.min(value, availableScroll)
    },
  })
}

async function renderLayout() {
  await act(async () => root.render(
    <Layout>
      {({ activeTab }) => <output data-testid="active-tab">{activeTab}</output>}
    </Layout>,
  ))
  installScrollModel()
}

function desktopLink(tab: string) {
  return container.querySelector<HTMLAnchorElement>(`.la-pluma-sidebar-nav a[href="/app/${tab}"]`)!
}

function mobileMoreTrigger() {
  return container.querySelector<HTMLAnchorElement>('.la-pluma-tabbar a[aria-label="更多页面"]')!
}

describe('top-level application navigation', () => {
  beforeEach(() => {
    currentScrollY = 0
    availableScroll = Number.POSITIVE_INFINITY
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
    expect(getScrollHost().scrollTop).toBe(0)

    currentScrollY = 510
    await act(async () => {
      window.history.replaceState({}, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(container.querySelector('[data-testid="active-tab"]')?.textContent).toBe('dashboard')
    expect(getScrollHost().scrollTop).toBe(240)

    await act(async () => {
      window.history.replaceState({}, '', '/app/automation')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(container.querySelector('[data-testid="active-tab"]')?.textContent).toBe('automation')
    expect(getScrollHost().scrollTop).toBe(510)
  })

  it('retries scroll restoration when lazy content grows after navigation', async () => {
    availableScroll = 1000
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

    await renderLayout()
    currentScrollY = 640
    await act(async () => desktopLink('automation').click())

    availableScroll = 0
    await act(async () => {
      window.history.replaceState({}, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(getScrollHost().scrollTop).toBe(0)

    availableScroll = 1000
    await act(async () => resizeCallback?.([], {} as ResizeObserver))
    expect(getScrollHost().scrollTop).toBe(640)
  })

  it('captures scroll before a shorter lazy page can clamp the viewport', async () => {
    await renderLayout()
    currentScrollY = 420
    const unsubscribe = useUIStore.subscribe((state, previousState) => {
      if (state.activeTab !== previousState.activeTab) currentScrollY = 0
    })

    await act(async () => desktopLink('automation').click())
    expect(getScrollHost().scrollTop).toBe(0)

    await act(async () => {
      window.history.replaceState({}, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(getScrollHost().scrollTop).toBe(420)
    unsubscribe()
  })

  it('opens the mobile overflow sheet, navigates from it, and restores trigger focus', async () => {
    await renderLayout()
    const trigger = mobileMoreTrigger()
    trigger.focus()

    await act(async () => trigger.click())

    const sheet = container.querySelector<HTMLElement>('#la-pluma-more-sheet')
    expect(sheet?.getAttribute('role')).toBe('dialog')
    const overflowLink = sheet?.querySelector<HTMLAnchorElement>('a[href="/app/roguelike"]')
    expect(overflowLink).toBeTruthy()

    await act(async () => overflowLink?.click())

    expect(container.querySelector('[data-testid="active-tab"]')?.textContent).toBe('roguelike')
    expect(container.querySelector('#la-pluma-more-sheet')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    await act(async () => {
      trigger.focus()
      trigger.click()
    })
    expect(container.querySelector('#la-pluma-more-sheet')).toBeTruthy()
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('#la-pluma-more-sheet')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
