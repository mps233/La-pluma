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
    `/api/maa-assets/avatar/${operatorId}`,
  loadDailyOperatorQuote: mocks.loadDailyOperatorQuote,
}))

let container: HTMLDivElement
let root: Root
let currentScrollY = 0
let availableScroll = Number.POSITIVE_INFINITY
let frameClock = 0
let scrollToMock: ReturnType<typeof vi.fn>

function mediaQueryList(query: string, matches = false): MediaQueryList {
  return {
    matches,
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
  return container.querySelector<HTMLButtonElement>(`.la-pluma-sidebar-nav button[data-app-tab="${tab}"]`)!
}

function mobileMoreTrigger() {
  return container.querySelector<HTMLButtonElement>('.la-pluma-tabbar-more-anchor .lg-button')!
}

describe('top-level application navigation', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    frameClock = 0
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
      frameClock += 16
      callback(frameClock)
      return frameClock
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

  it('keeps the installed-app URL stable while restoring tabs from history state', async () => {
    window.matchMedia = vi.fn((query: string) => mediaQueryList(
      query,
      query === '(display-mode: standalone)',
    ))
    await renderLayout()

    await act(async () => desktopLink('automation').click())

    expect(window.location.pathname).toBe('/app/dashboard')
    expect(window.history.state.laPlumaTab).toBe('automation')
    expect(container.querySelector('[data-testid="active-tab"]')?.textContent).toBe('automation')

    await act(async () => {
      const state = { ...window.history.state, laPlumaTab: 'dashboard' }
      window.history.replaceState(state, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate', { state }))
    })

    expect(window.location.pathname).toBe('/app/dashboard')
    expect(container.querySelector('[data-testid="active-tab"]')?.textContent).toBe('dashboard')
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
    expect(sidebar.querySelectorAll('.la-pluma-sidebar-nav button[data-app-tab]')).toHaveLength(9)
    expect(sidebar.querySelectorAll('.la-pluma-sidebar-icon > svg[aria-hidden="true"]')).toHaveLength(9)

    const mobileNav = container.querySelector<HTMLElement>('.la-pluma-tabbar-nav')!
    const mobileTrack = mobileNav.querySelector<HTMLElement>('.lg-track:not([data-lg-copy])')!
    const mobileDestinations = [...mobileTrack.querySelectorAll<HTMLButtonElement>(':scope > [data-lg-item]')]
      .map(button => button.getAttribute('aria-label'))
    const dashboardIcon = mobileTrack.querySelector('[data-lg-item="0"] svg')
    expect(mobileTrack.getAttribute('role')).toBe('tablist')
    expect(mobileTrack.getAttribute('aria-label')).toBe('主要功能')
    expect(dashboardIcon?.classList.contains('lucide-layout-grid')).toBe(true)
    expect(mobileDestinations).toEqual([
      '控制台',
      '自动化',
      '作业',
      '配置',
    ])
    expect(mobileTrack.querySelector('[data-lg-item="0"]')?.getAttribute('aria-selected')).toBe('true')
    const moreTrigger = mobileMoreTrigger()
    expect(moreTrigger.getAttribute('aria-label')).toBe('更多工作区')
    expect(moreTrigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(container.querySelectorAll('a[href^="/app/"]')).toHaveLength(0)

    const search = sidebar.querySelector<HTMLInputElement>('input[aria-label="搜索工作区"]')!
    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setInputValue?.call(search, '数据')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const filteredLinks = [...sidebar.querySelectorAll<HTMLButtonElement>('.la-pluma-sidebar-nav button[data-app-tab]')]
    expect(filteredLinks.map(button => button.dataset.appTab)).toEqual(['statistics'])
    expect(mobileDestinations).toHaveLength(4)

    await act(async () => filteredLinks[0]?.click())
    expect(sidebar.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(sidebar.querySelector<HTMLElement>('[aria-current="page"]')?.dataset.appTab).toBe('statistics')
    expect(container.querySelector('.la-pluma-tabbar-more-anchor')?.classList.contains('is-active')).toBe(true)
    expect(container.querySelector('.la-pluma-tabbar-nav .lg-track:not([data-lg-copy]) > [data-lg-item][aria-selected="true"]')).toBeNull()

    await act(async () => {
      sidebar.querySelector<HTMLButtonElement>('button[aria-label="清除搜索"]')?.click()
    })
    expect(sidebar.querySelectorAll('.la-pluma-sidebar-nav button[data-app-tab]')).toHaveLength(9)
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
    expect(avatar.getAttribute('src')).toContain('/avatar/char_172_svrash')
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
    expect(identity.querySelector('img')?.getAttribute('src')).toContain('/avatar/char_002_amiya')
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

  it('opens the overflow menu, navigates, and restores trigger focus on Escape', async () => {
    await renderLayout()
    const trigger = mobileMoreTrigger()
    trigger.focus()

    await act(async () => trigger.click())

    const anchor = container.querySelector<HTMLElement>('.la-pluma-tabbar-more-anchor')!
    const menu = anchor.querySelector<HTMLElement>('[role="menu"]')
    expect(menu?.getAttribute('aria-label')).toBe('更多工作区')
    const items = [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    expect(items.map(item => item.textContent)).toEqual([
      expect.stringContaining('肉鸽'),
      expect.stringContaining('养成'),
      expect.stringContaining('小工具'),
      expect.stringContaining('日志'),
      expect.stringContaining('数据'),
    ])
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(items[0])
    expect(anchor.classList.contains('is-active')).toBe(false)

    await act(async () => items[0]?.click())
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="active-tab"]')?.textContent).toBe('roguelike')
    expect(anchor.classList.contains('is-active')).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await act(async () => trigger.click())
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })
})
