// @vitest-environment jsdom

import { act, useLayoutEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appTabRoute, useActiveAppTab, type AppTab } from '@/shared/navigation'
import Layout from './Layout'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  loadDailyOperatorQuote: vi.fn(),
}))

vi.mock('./ThemeToggle', () => ({ default: () => <button type="button">主题</button> }))
vi.mock('@/features/operator-quotes', () => ({
  DEFAULT_OPERATOR_QUOTE: {
    operatorId: 'char_002_amiya',
    operator: '阿米娅',
    quote: '今天也请多指教',
  },
  getOperatorAvatarUrl: (operatorId: string) =>
    `http://localhost:3000/game-assets/avatar/${operatorId}.png`,
  loadDailyOperatorQuote: mocks.loadDailyOperatorQuote,
}))

let container: HTMLDivElement
let root: Root
let currentScrollY = 0
let availableScroll = Number.POSITIVE_INFINITY
let clampViewportOnTabSwitch = false
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
  return container.querySelector<HTMLElement>('main')!
}

function installScrollModel() {
  const host = getScrollHost()
  Object.defineProperty(host, 'scrollTop', {
    configurable: true,
    get: () => Math.min(currentScrollY, availableScroll),
    set: (value: number) => {
      currentScrollY = Math.min(value, availableScroll)
    },
  })
}

/**
 * 模拟页面切换时真实发生的视口裁剪：旧页面被 Activity 隐藏后内容高度骤减，
 * 浏览器会把 scrollTop 夹到新页面的可滚动范围。它的 layout effect 在 Layout 之前
 * 执行（子组件先于父组件提交），因此能证明滚动快照必须发生在提交之前。
 */
function ViewportClamp({ activeTab }: { activeTab: AppTab }) {
  const mounted = useRef(false)
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (!clampViewportOnTabSwitch) return
    availableScroll = activeTab === 'dashboard' ? 1000 : 0
  }, [activeTab])
  return null
}

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

let asyncNavigationGate: Deferred | null = null

function createDeferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = () => resolvePromise()
  })
  return { promise, resolve }
}

function AsyncNavigator() {
  const navigate = useNavigate()
  const started = useRef(false)

  const startNavigation = () => {
    if (started.current) return
    started.current = true
    // 模拟概览快捷入口：先 await 数据请求，再跨页跳转。由测试显式放行，
    // 避免定时器与手动滚动竞争导致用例不稳定。
    const gate = createDeferred()
    asyncNavigationGate = gate
    void gate.promise.then(() => {
      if (asyncNavigationGate === gate) asyncNavigationGate = null
      navigate(appTabRoute('automation'))
    })
  }

  return <button type="button" onClick={startNavigation}>async-automation</button>
}

function LayoutHarness() {
  const activeTab = useActiveAppTab()
  const navigate = useNavigate()

  return (
    <Layout activeTab={activeTab}>
      <output data-testid="active-tab">{activeTab}</output>
      <button type="button" onClick={() => navigate(appTabRoute('automation'))}>programmatic-automation</button>
      <AsyncNavigator />
      <ViewportClamp activeTab={activeTab} />
    </Layout>
  )
}

async function renderLayout() {
  await act(async () => root.render(
    <BrowserRouter>
      <LayoutHarness />
    </BrowserRouter>,
  ))
  installScrollModel()
}

function activeTabLabel() {
  return container.querySelector('[data-testid="active-tab"]')?.textContent
}

function pageTitle() {
  return container.querySelector<HTMLElement>('[data-region="page-title"]')!
}

/** 侧栏品牌区是非交互标识，不应引入按钮或链接焦点停点。 */
function sidebarBrand() {
  return container.querySelector<HTMLElement>('[data-region="sidebar-brand"]')!
}

function desktopLink(tab: string) {
  return container.querySelector<HTMLButtonElement>(`nav[aria-label="工作台"] button[data-app-tab="${tab}"]`)!
}

function mobileMoreTrigger() {
  return document.querySelector<HTMLButtonElement>('button[aria-label="更多页面"]')!
}

function mobileTabLinks() {
  return container.querySelectorAll<HTMLButtonElement>('footer[data-region="tabbar"] button[data-app-tab]')
}

/** 侧边栏身份区以「干员：台词」作为无障碍名称，不依赖包裹类名。 */
function sidebarIdentity() {
  return container.querySelector<HTMLElement>('aside [aria-label*="："]')!
}

function moreSheet() {
  return document.querySelector<HTMLElement>('[data-slot="sheet-content"]')
}

describe('top-level application navigation', () => {
  beforeEach(() => {
    currentScrollY = 0
    availableScroll = Number.POSITIVE_INFINITY
    clampViewportOnTabSwitch = false
    asyncNavigationGate = null
    document.title = ''
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
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.querySelectorAll('[data-slot="sheet-portal"]').forEach(node => node.remove())
    document.title = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('syncs tab selection with the URL and restores scroll per tab on popstate', async () => {
    await renderLayout()
    currentScrollY = 240

    await act(async () => desktopLink('automation').click())

    expect(window.location.pathname).toBe('/app/automation')
    expect(activeTabLabel()).toBe('automation')
    expect(desktopLink('automation').getAttribute('aria-current')).toBe('page')
    expect(getScrollHost().scrollTop).toBe(0)

    currentScrollY = 510
    await act(async () => {
      window.history.replaceState({}, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(activeTabLabel()).toBe('dashboard')
    expect(getScrollHost().scrollTop).toBe(240)

    await act(async () => {
      window.history.replaceState({}, '', '/app/automation')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(activeTabLabel()).toBe('automation')
    expect(getScrollHost().scrollTop).toBe(510)
  })

  it('uses the URL for installed-app navigation instead of history state', async () => {
    window.matchMedia = vi.fn((query: string) => mediaQueryList(
      query,
      query === '(display-mode: standalone)',
    ))
    await renderLayout()

    await act(async () => desktopLink('automation').click())

    expect(window.location.pathname).toBe('/app/automation')
    expect(window.history.state?.laPlumaTab).toBeUndefined()
    expect(activeTabLabel()).toBe('automation')

    await act(async () => {
      window.history.replaceState({}, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(window.location.pathname).toBe('/app/dashboard')
    expect(activeTabLabel()).toBe('dashboard')
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

  it('captures scroll before a shorter page can clamp the viewport', async () => {
    clampViewportOnTabSwitch = true
    availableScroll = 1000
    await renderLayout()
    currentScrollY = 420

    await act(async () => desktopLink('automation').click())
    expect(getScrollHost().scrollTop).toBe(0)

    await act(async () => {
      window.history.replaceState({}, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    // 若快照发生在 tab 提交（裁剪）之后，这里会恢复成 0 而不是 420。
    expect(getScrollHost().scrollTop).toBe(420)
  })

  it('snapshots scroll for navigation initiated outside the layout nav handlers', async () => {
    clampViewportOnTabSwitch = true
    availableScroll = 1000
    await renderLayout()
    currentScrollY = 420

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find(button => button.textContent === 'programmatic-automation')
        ?.click()
    })
    expect(activeTabLabel()).toBe('automation')

    await act(async () => {
      window.history.replaceState({}, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(getScrollHost().scrollTop).toBe(420)
  })

  it('keeps scrolling that happens while an async navigation is pending', async () => {
    clampViewportOnTabSwitch = true
    availableScroll = 1000
    await renderLayout()
    currentScrollY = 100

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find(button => button.textContent === 'async-automation')
        ?.click()
    })
    expect(activeTabLabel()).toBe('dashboard')

    currentScrollY = 800
    await act(async () => {
      getScrollHost().dispatchEvent(new Event('scroll'))
    })

    const gate = asyncNavigationGate
    expect(gate).not.toBeNull()
    await act(async () => {
      gate?.resolve()
      await gate?.promise
      await new Promise(resolve => { window.setTimeout(resolve, 0) })
    })
    expect(activeTabLabel()).toBe('automation')

    await act(async () => {
      window.history.replaceState({}, '', '/app/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(getScrollHost().scrollTop).toBe(800)
  })

  it('keeps all desktop workspaces in one flat navigation list', async () => {
    await renderLayout()

    const sidebar = container.querySelector<HTMLElement>('aside[data-region="sidebar"][aria-label="主要功能"]')!
    const sidebarNav = sidebar.querySelector<HTMLElement>('nav[aria-label="工作台"]')!
    expect(sidebarNav.querySelectorAll('ul')).toHaveLength(1)
    expect([...sidebarNav.querySelectorAll<HTMLButtonElement>('button[data-app-tab]')]
      .map(button => button.dataset.appTab)).toEqual([
      'dashboard',
      'automation',
      'combat',
      'roguelike',
      'training',
      'statistics',
      'logs',
      'config',
    ])

    const mobileDestinations = [...mobileTabLinks()]
      .map(button => button.dataset.appTab)
    expect(mobileDestinations).toEqual([
      'dashboard',
      'automation',
      'combat',
      'config',
    ])
    expect(container.querySelectorAll('a[href^="/app/"]')).toHaveLength(0)

    await act(async () => desktopLink('statistics').click())
    expect(sidebar.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(sidebar.querySelector<HTMLElement>('[aria-current="page"]')?.dataset.appTab).toBe('statistics')
  })

  it('renders the active workspace name as the single page heading and document title', async () => {
    await renderLayout()

    expect(pageTitle().tagName).toBe('H1')
    expect(pageTitle().textContent).toBe('概览')
    expect(document.title).toBe('概览 · La Pluma Next')

    await act(async () => desktopLink('automation').click())

    expect(pageTitle().textContent).toBe('日常')
    expect(document.title).toBe('日常 · La Pluma Next')
  })

  it('labels the theme gallery route from the same page title source', async () => {
    window.history.replaceState({}, '', '/dev/theme-gallery')
    await renderLayout()

    expect(pageTitle().textContent).toBe('主题画廊')
    expect(document.title).toBe('主题画廊 · La Pluma Next')
  })

  it('keeps the brand in a non-interactive sidebar header', async () => {
    await renderLayout()

    const brand = sidebarBrand()
    expect(brand.tagName).toBe('DIV')
    expect(brand.textContent).toBe('La Pluma Next')
    expect(brand.querySelector('button, a')).toBeNull()
    expect(brand.querySelector('img')?.getAttribute('alt')).toBe('')
    expect(sidebarIdentity()).not.toBeNull()
  })

  it('shows the daily operator portrait, name, and quote in the desktop identity area', async () => {
    await renderLayout()
    await act(async () => {
      await Promise.resolve()
    })

    const identity = sidebarIdentity()
    const avatar = identity.querySelector<HTMLImageElement>('img')!
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

    const identity = sidebarIdentity()
    expect(identity.getAttribute('aria-label')).toBe('阿米娅：今天也请多指教')
    expect(identity.querySelector('strong')?.textContent).toBe('阿米娅')
    expect(identity.querySelector('small')?.textContent).toBe('今天也请多指教')
    expect(identity.querySelector('img')?.getAttribute('src')).toContain('/avatar/char_002_amiya.png')
  })

  it('exposes the GitHub repository as a secure external action', async () => {
    await renderLayout()

    const githubLink = container.querySelector<HTMLAnchorElement>('a[aria-label="打开 GitHub 仓库"]')!
    expect(githubLink.getAttribute('aria-label')).toBe('打开 GitHub 仓库')
    expect(githubLink.getAttribute('href')).toBe('https://github.com/dongwlin/La-pluma-next')
    expect(githubLink.getAttribute('target')).toBe('_blank')
    expect(githubLink.getAttribute('rel')?.split(/\s+/).sort()).toEqual(['noopener', 'noreferrer'])
  })

  it('opens the mobile overflow sheet with an accessible title and the remaining workspaces', async () => {
    await renderLayout()
    const trigger = mobileMoreTrigger()
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    trigger.focus()
    await act(async () => trigger.click())

    const sheet = moreSheet()
    expect(sheet?.getAttribute('role')).toBe('dialog')
    expect(document.querySelector('[data-slot="sheet-title"]')?.textContent).toBe('更多工作区')
    expect(sheet?.querySelector('[aria-label="关闭更多工作区"]')).not.toBeNull()
    expect([...sheet!.querySelectorAll<HTMLButtonElement>('button[data-app-tab]')]
      .map(button => button.dataset.appTab)).toEqual([
      'roguelike',
      'training',
      'statistics',
      'logs',
    ])
  })

  it('dismisses the mobile overflow sheet through close, backdrop, and escape', async () => {
    await renderLayout()
    const trigger = mobileMoreTrigger()

    trigger.focus()
    await act(async () => trigger.click())
    expect(moreSheet()).not.toBeNull()

    await act(async () => {
      moreSheet()?.querySelector<HTMLButtonElement>('[aria-label="关闭更多工作区"]')?.click()
    })
    await act(async () => new Promise(resolve => { window.setTimeout(resolve, 0) }))
    expect(moreSheet()).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await act(async () => trigger.click())
    await act(async () => {
      document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]')?.click()
    })
    await act(async () => new Promise(resolve => { window.setTimeout(resolve, 0) }))
    expect(moreSheet()).toBeNull()
    expect(document.activeElement).toBe(trigger)

    await act(async () => trigger.click())
    expect(moreSheet()).not.toBeNull()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await act(async () => new Promise(resolve => { window.setTimeout(resolve, 0) }))
    expect(moreSheet()).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes the mobile overflow sheet when a workspace is chosen', async () => {
    await renderLayout()
    const trigger = mobileMoreTrigger()

    trigger.focus()
    await act(async () => trigger.click())
    const overflowLink = moreSheet()?.querySelector<HTMLButtonElement>('button[data-app-tab="roguelike"]')
    expect(overflowLink).toBeTruthy()

    await act(async () => overflowLink?.click())

    expect(activeTabLabel()).toBe('roguelike')
    await act(async () => new Promise(resolve => { window.setTimeout(resolve, 0) }))
    expect(moreSheet()).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
