// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/stores'
import Layout from './Layout'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  loadDailyOperatorQuote: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const motionComponent = (tag: 'div' | 'section') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      drag: _drag,
      dragConstraints: _dragConstraints,
      dragElastic: _dragElastic,
      dragMomentum: _dragMomentum,
      dragDirectionLock: _dragDirectionLock,
      onDragEnd: _onDragEnd,
      ...props
    }, ref) => React.createElement(tag, { ...props, ref }, children as ReactNode),
  )

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: {
      div: motionComponent('div'),
      section: motionComponent('section'),
    },
    useReducedMotion: () => false,
  }
})

vi.mock('./ThemeToggle', () => ({ default: () => <button type="button">主题</button> }))
vi.mock('@/services/operatorQuotes', () => ({
  DEFAULT_OPERATOR_QUOTE: {
    operatorId: 'char_002_amiya',
    operator: '阿米娅',
    quote: '今天也请多指教',
  },
  getOperatorAvatarUrl: (operatorId: string) =>
    `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${operatorId}.png`,
  loadDailyOperatorQuote: mocks.loadDailyOperatorQuote,
}))

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
    mocks.loadDailyOperatorQuote.mockReset()
    mocks.loadDailyOperatorQuote.mockResolvedValue({
      operatorId: 'char_172_svrash',
      operator: '银灰',
      quote: '战术安排已就绪',
    })
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

  it('groups and filters desktop workspaces without changing the mobile destinations', async () => {
    await renderLayout()

    const sidebar = container.querySelector<HTMLElement>('.la-pluma-sidebar')!
    const groups = [...sidebar.querySelectorAll<HTMLElement>('[role="group"]')]
    expect(groups.map(group => group.getAttribute('aria-label'))).toEqual([
      '任务与执行',
      '记录与设置',
    ])
    expect(sidebar.querySelectorAll('.la-pluma-sidebar-nav a')).toHaveLength(8)
    expect(sidebar.querySelectorAll('.la-pluma-sidebar-icon > svg[aria-hidden="true"]')).toHaveLength(8)

    const mobileDestinations = [...container.querySelectorAll<HTMLAnchorElement>('.la-pluma-tabbar-pill a')]
      .map(link => link.getAttribute('href'))
    expect(container.querySelector('.la-pluma-tabbar-pill')?.classList.contains('app-liquid-tab-pill')).toBe(true)
    expect(mobileDestinations).toEqual([
      '/app/dashboard',
      '/app/automation',
      '/app/combat',
      '/app/config',
    ])

    const search = sidebar.querySelector<HTMLInputElement>('input[aria-label="搜索工作区"]')!
    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setInputValue?.call(search, '数据')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const filteredLinks = [...sidebar.querySelectorAll<HTMLAnchorElement>('.la-pluma-sidebar-nav a')]
    expect(filteredLinks.map(link => link.getAttribute('href'))).toEqual(['/app/statistics'])
    expect(mobileDestinations).toHaveLength(4)

    await act(async () => filteredLinks[0]?.click())
    expect(sidebar.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(sidebar.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/app/statistics')

    await act(async () => {
      sidebar.querySelector<HTMLButtonElement>('button[aria-label="清除搜索"]')?.click()
    })
    expect(sidebar.querySelectorAll('.la-pluma-sidebar-nav a')).toHaveLength(8)
  })

  it('shows the daily operator portrait, name, and quote in the desktop identity area', async () => {
    await renderLayout()
    await act(async () => {
      await Promise.resolve()
    })

    const identity = container.querySelector<HTMLElement>('.la-pluma-sidebar-identity')!
    const avatar = identity.querySelector<HTMLImageElement>('.la-pluma-sidebar-avatar img')!
    expect(mocks.loadDailyOperatorQuote).toHaveBeenCalledTimes(1)
    expect(identity.getAttribute('aria-label')).toBe('银灰：战术安排已就绪')
    expect(identity.querySelector('strong')?.textContent).toBe('银灰')
    expect(identity.querySelector('small')?.textContent).toBe('战术安排已就绪')
    expect(avatar.getAttribute('src')).toContain('/avatar/char_172_svrash.png')
    expect(avatar.getAttribute('decoding')).toBe('async')
  })

  it('keeps the fallback operator identity when the daily quote cannot load', async () => {
    mocks.loadDailyOperatorQuote.mockRejectedValueOnce(new Error('offline'))
    await renderLayout()
    await act(async () => {
      await Promise.resolve()
    })

    const identity = container.querySelector<HTMLElement>('.la-pluma-sidebar-identity')!
    expect(identity.getAttribute('aria-label')).toBe('阿米娅：今天也请多指教')
    expect(identity.querySelector('strong')?.textContent).toBe('阿米娅')
    expect(identity.querySelector('small')?.textContent).toBe('今天也请多指教')
    expect(identity.querySelector('img')?.getAttribute('src')).toContain('/avatar/char_002_amiya.png')
  })

  it('exposes the GitHub repository as a secure external action', async () => {
    await renderLayout()

    const githubLink = container.querySelector<HTMLAnchorElement>('.la-pluma-github-link')!
    expect(githubLink.getAttribute('aria-label')).toBe('打开 GitHub 仓库')
    expect(githubLink.getAttribute('href')).toBe('https://github.com/mps233/La-pluma')
    expect(githubLink.getAttribute('target')).toBe('_blank')
    expect(githubLink.getAttribute('rel')?.split(/\s+/).sort()).toEqual(['noopener', 'noreferrer'])
    expect(githubLink.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
  })

  it('opens and dismisses the mobile overflow sheet without losing trigger focus', async () => {
    await renderLayout()
    const trigger = mobileMoreTrigger()
    trigger.focus()

    await act(async () => trigger.click())

    let sheet = container.querySelector<HTMLElement>('#la-pluma-more-sheet')
    expect(sheet?.getAttribute('role')).toBe('dialog')
    expect(sheet?.getAttribute('aria-modal')).toBe('true')
    expect(sheet?.querySelector('[aria-label="关闭更多工作区"]')?.classList.contains('la-pluma-sheet-close')).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    expect(getScrollHost().style.overflow).toBe('hidden')

    await act(async () => {
      sheet?.querySelector<HTMLButtonElement>('[aria-label="关闭更多工作区"]')?.click()
    })
    expect(container.querySelector('#la-pluma-more-sheet')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).toBe('')
    expect(getScrollHost().style.overflow).toBe('')

    await act(async () => trigger.click())
    await act(async () => container.querySelector<HTMLElement>('.sheet-backdrop')?.click())
    expect(container.querySelector('#la-pluma-more-sheet')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    await act(async () => trigger.click())
    expect(container.querySelector('#la-pluma-more-sheet')).toBeTruthy()
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('#la-pluma-more-sheet')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    await act(async () => trigger.click())
    sheet = container.querySelector<HTMLElement>('#la-pluma-more-sheet')
    const overflowLink = sheet?.querySelector<HTMLAnchorElement>('a[href="/app/roguelike"]')
    expect(overflowLink).toBeTruthy()

    await act(async () => overflowLink?.click())

    expect(container.querySelector('[data-testid="active-tab"]')?.textContent).toBe('roguelike')
    expect(container.querySelector('#la-pluma-more-sheet')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
