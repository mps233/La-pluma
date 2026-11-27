import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { BarChart3, Bot, Dices, Ellipsis, FileText, GraduationCap, LayoutGrid, Search, Settings2, Swords, Wrench } from 'lucide-react'
import { GlassButton, GlassCard } from '@/components/liquid-glass'
import { GlassLiveCardButton } from '@/components/common/GlassLiveCardButton'
import { GlassInput, GlassMenu, GlassNav } from './LayoutGlassChrome'
import ThemeToggle from './ThemeToggle'
import RunIsland from './RunIsland'
import SanityBatteryIsland from './SanityBatteryIsland'
import MaaUpdateIsland from './MaaUpdateIsland'
import MasteryIsland from './MasteryIsland'
import AsciiFieldBackdrop from './backgrounds/AsciiFieldBackdrop'
import { Island } from '@/lib/island'
import { IslandContext } from '@/lib/island/context'
import { useUIStore } from '@/stores'
import { appTabFromPath, appTabPath, isAppTab, type AppTab } from '@/stores/uiStore'
import { useResolvedTheme } from '@/hooks/useResolvedTheme'
import { useTabBarFold } from '@/hooks/useTabBarFold'
import { brandMarkUrl } from '@/utils/brandAssets'
import { preloadPage } from '@/utils/pagePreload'
import {
  DEFAULT_OPERATOR_QUOTE,
  getOperatorAvatarUrl,
  loadDailyOperatorQuote,
} from '@/services/operatorQuotes'



interface LayoutProps {
  children: (props: { activeTab: string }) => ReactNode
}

const tabs = [
  { id: 'dashboard', name: '控制台', icon: LayoutGrid },
  { id: 'automation', name: '自动化', icon: Bot },
  { id: 'combat', name: '作业', icon: Swords },
  { id: 'roguelike', name: '肉鸽', icon: Dices },
  { id: 'training', name: '养成', icon: GraduationCap },
  { id: 'tools', name: '小工具', icon: Wrench },
  { id: 'logs', name: '日志', icon: FileText },
  { id: 'statistics', name: '数据', icon: BarChart3 },
  { id: 'config', name: '配置', icon: Settings2 },
] satisfies Array<{ id: AppTab; name: string; icon: typeof LayoutGrid }>

const desktopTabGroups = [
  {
    id: 'tasks',
    label: '任务与执行',
    tabs: tabs.filter(tab => ['dashboard', 'automation', 'combat', 'roguelike', 'training', 'tools'].includes(tab.id)),
  },
  {
    id: 'library',
    label: '记录与设置',
    tabs: tabs.filter(tab => ['logs', 'statistics', 'config'].includes(tab.id)),
  },
]

// Keep the compact mobile rail focused on the four destinations used most often.
// The remaining workspaces stay available from the adjacent more button.
const mobileTabs = tabs.filter(tab => ['dashboard', 'automation', 'combat', 'config'].includes(tab.id))
const overflowTabs = tabs.filter(tab => !mobileTabs.some(primary => primary.id === tab.id))

function getScrollHost() {
  return document.querySelector<HTMLElement>('.la-pluma-scroll-host')
}

function getScrollTop() {
  return getScrollHost()?.scrollTop ?? window.scrollY
}

function setScrollTop(top: number) {
  const host = getScrollHost()
  if (host) {
    host.scrollTop = top
    return
  }
  window.scrollTo({ top, left: 0, behavior: 'auto' })
}

function isStandaloneWebApp() {
  const standaloneNavigator = window.navigator as Navigator & { standalone?: boolean }
  return document.documentElement.classList.contains('la-pluma-standalone')
    || window.matchMedia?.('(display-mode: standalone)').matches === true
    || window.matchMedia?.('(display-mode: fullscreen)').matches === true
    || standaloneNavigator.standalone === true
}

function appTabFromHistoryState(state: unknown): AppTab | null {
  if (!state || typeof state !== 'object') return null
  const tab = (state as { laPlumaTab?: unknown }).laPlumaTab
  return typeof tab === 'string' && isAppTab(tab) ? tab : null
}

function TabIcon({ tab, size = 'h-4 w-4' }: { tab: typeof tabs[number]; size?: string }) {
  const Icon = tab.icon
  return <Icon className={size} strokeWidth={1.9} aria-hidden="true" />
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" focusable="false" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.335-1.756-1.335-1.756-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 3.003-.404c1.02.005 2.045.138 3.003.404 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function TabLink({
  tab,
  active,
  onNavigate,
}: {
  tab: typeof tabs[number]
  active: boolean
  onNavigate: (tab: AppTab) => void
}) {
  return (
    <GlassButton
      type="button"
      data-app-tab={tab.id}
      aria-current={active ? 'page' : undefined}
      onPointerEnter={() => preloadPage(tab.id)}
      onFocus={() => preloadPage(tab.id)}
      onClick={() => onNavigate(tab.id)}
      icon={<span className="la-pluma-sidebar-icon"><TabIcon tab={tab} size="h-4 w-4" /></span>}
      iconPosition="start"
      material="tinted"
      size="md"
      className={`lg-host lg-button la-pluma-tab-link link is-desktop-tab ${active ? 'is-active bg-[var(--app-accent-action)] text-white' : 'bg-[var(--app-surface-muted)] text-[var(--app-text)]'}`}
    >
      <span className="la-pluma-sidebar-label">{tab.name}</span>
    </GlassButton>
  )
}

export default function Layout({ children }: LayoutProps) {
  const storedActiveTab = useUIStore(state => state.activeTab)
  const setActiveTab = useUIStore(state => state.setActiveTab)
  const theme = useUIStore(state => state.theme)
  const resolvedTheme = useResolvedTheme()
  const brandMark = brandMarkUrl(resolvedTheme)
  const hasIslandProvider = useContext(IslandContext) !== null
  const activeTab: AppTab = isAppTab(storedActiveTab) ? storedActiveTab : 'dashboard'
  const [sidebarQuery, setSidebarQuery] = useState('')
  const [sidebarIdentity, setSidebarIdentity] = useState(DEFAULT_OPERATOR_QUOTE)
  const pageRef = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef(new Map<AppTab, number>())
  const previousTab = useRef<AppTab>(activeTab)
  const navigationSource = useRef<'initial' | 'store' | 'link' | 'popstate'>('initial')
  const restoreFrame = useRef<number | null>(null)
  const scrollRestoreCleanupRef = useRef<(() => void) | null>(null)
  const { folded: tabBarFolded, open: openTabBar, barRef: tabBarRef } = useTabBarFold()
  // Clear glass repaints on every scroll frame (and snapshots the page).
  // A touch tab bar uses the fixed tinted body instead; a mouse keeps clear.
  // (The tab bar is tinted in every compact layout, so the pointer type no longer decides its material.)

  // The folded capsule is as wide as the current view's icon and label plus
  // 14 px either side. Measuring it before paint lets max-width animate from
  // the open plate instead of jumping to an arbitrary width.
  useLayoutEffect(() => {
    if (!tabBarFolded) return
    const bar = tabBarRef.current
    const content = bar?.querySelector<HTMLElement>('.lg-nav-item.is-active > span')
    if (!bar || !content) return
    const width = content.getBoundingClientRect().width
    if (width > 0) {
      bar.style.setProperty('--la-pluma-tabbar-fold-width', `${Math.ceil(width + 28)}px`)
    }
  }, [tabBarFolded, tabBarRef])

  useEffect(() => {
    let subscribed = true

    void loadDailyOperatorQuote().then((quote) => {
      if (subscribed) setSidebarIdentity(quote)
    }).catch(() => undefined)

    return () => {
      subscribed = false
    }
  }, [])

  const restoreScroll = useCallback((tab: AppTab) => {
    scrollRestoreCleanupRef.current?.()
    const top = scrollPositions.current.get(tab) ?? 0
    let observer: ResizeObserver | null = null
    let maxTimer: number | null = null
    let cancelled = false

    const applyScroll = () => {
      if (cancelled) return
      setScrollTop(top)
    }
    const scheduleScroll = () => {
      if (restoreFrame.current !== null) window.cancelAnimationFrame(restoreFrame.current)
      restoreFrame.current = window.requestAnimationFrame(() => {
        restoreFrame.current = null
        applyScroll()
      })
    }
    const cleanup = () => {
      if (cancelled) return
      cancelled = true
      observer?.disconnect()
      observer = null
      if (maxTimer !== null) window.clearTimeout(maxTimer)
      maxTimer = null
      if (restoreFrame.current !== null) window.cancelAnimationFrame(restoreFrame.current)
      restoreFrame.current = null
      window.removeEventListener('wheel', cleanup)
      window.removeEventListener('touchstart', cleanup)
      window.removeEventListener('pointerdown', cleanup)
      window.removeEventListener('keydown', handleUserKeyDown)
      if (scrollRestoreCleanupRef.current === cleanup) scrollRestoreCleanupRef.current = null
    }
    const handleUserKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cleanup()
    }

    scrollRestoreCleanupRef.current = cleanup
    applyScroll()
    scheduleScroll()

    if (top <= 0) return

    const content = getScrollHost()
    if (content && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(scheduleScroll)
      observer.observe(content)
    }
    window.addEventListener('wheel', cleanup, { passive: true })
    window.addEventListener('touchstart', cleanup, { passive: true })
    window.addEventListener('pointerdown', cleanup, { passive: true })
    window.addEventListener('keydown', handleUserKeyDown)
    maxTimer = window.setTimeout(cleanup, 10_000)
  }, [])

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration
    const savedScrollPositions = scrollPositions.current
    window.history.scrollRestoration = 'manual'
    const handlePopState = (event: PopStateEvent) => {
      const standalone = isStandaloneWebApp()
      const pathTab = appTabFromPath(window.location.pathname)
      const historyTab = standalone ? appTabFromHistoryState(event.state) : null
      const nextTab = historyTab ?? pathTab ?? 'dashboard'
      if (nextTab !== previousTab.current) {
        savedScrollPositions.set(previousTab.current, getScrollTop())
      }
      navigationSource.current = 'popstate'
      if (standalone && !historyTab) {
        window.history.replaceState({ ...window.history.state, laPlumaTab: nextTab }, '')
      } else if (!standalone && !pathTab) {
        window.history.replaceState({ ...window.history.state, laPlumaTab: nextTab }, '', appTabPath(nextTab))
      }
      if (nextTab === useUIStore.getState().activeTab) {
        restoreScroll(nextTab)
        navigationSource.current = 'store'
      } else {
        setActiveTab(nextTab)
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => {
      savedScrollPositions.set(previousTab.current, getScrollTop())
      window.history.scrollRestoration = previousScrollRestoration
      window.removeEventListener('popstate', handlePopState)
      scrollRestoreCleanupRef.current?.()
      if (restoreFrame.current !== null) window.cancelAnimationFrame(restoreFrame.current)
    }
  }, [restoreScroll, setActiveTab])

  useLayoutEffect(() => {
    if (storedActiveTab !== activeTab) {
      setActiveTab(activeTab)
      return
    }

    const source = navigationSource.current
    const isInitial = source === 'initial'
    if (!isInitial && source === 'store' && previousTab.current !== activeTab) {
      scrollPositions.current.set(previousTab.current, getScrollTop())
    }

    const targetPath = appTabPath(activeTab)
    const state = { ...window.history.state, laPlumaTab: activeTab }
    if (isStandaloneWebApp()) {
      if (isInitial || source === 'popstate' || previousTab.current === activeTab) {
        window.history.replaceState(state, '')
      } else {
        window.history.pushState(state, '')
      }
    } else if (window.location.pathname !== targetPath) {
      if (isInitial || source === 'popstate') window.history.replaceState(state, '', targetPath)
      else window.history.pushState(state, '', targetPath)
    }

    previousTab.current = activeTab
    navigationSource.current = 'store'
    // Any view change (including browser back) leaves the bar open.
    openTabBar()
    restoreScroll(activeTab)
  }, [activeTab, openTabBar, restoreScroll, setActiveTab, storedActiveTab])

  const navigateToTab = (tab: AppTab) => {
    if (tab !== activeTab) {
      preloadPage(tab)
      scrollPositions.current.set(activeTab, getScrollTop())
      navigationSource.current = 'link'
      setActiveTab(tab)
    }
    // A view change or a repeat tap always leaves the bar open.
    openTabBar()
  }

  const scrollPageToTop = useCallback(() => {
    const host = getScrollHost()
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth'
    if (host) host.scrollTo({ top: 0, behavior })
    else window.scrollTo({ top: 0, left: 0, behavior })
  }, [])

  // Browser form restore and password managers can write a saved value into the
  // search field while it is not focused. Such a value is not a workspace filter
  // and would hide every destination, so it is dropped and the controlled value
  // is written back instead of becoming sidebar state.
  const handleSidebarQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    if (document.activeElement !== input) {
      input.value = sidebarQuery
      return
    }
    setSidebarQuery(input.value)
  }

  const activePrimaryMobileIndex = mobileTabs.findIndex(tab => tab.id === activeTab)
  const isOverflowActive = overflowTabs.some(tab => tab.id === activeTab)
  const mobileNavItems = mobileTabs.map(tab => ({
    id: tab.id,
    label: tab.name,
    icon: <TabIcon tab={tab} size="h-6 w-6" />,
  }))
  const overflowMenuItems = [
    ...overflowTabs.map(tab => ({
      label: tab.name,
      // The kit sizes a menu row's icon with `size-4`, and `--spacing-4` is remapped to the
      // app's card gap (12 px), so the row's icon is pinned to the kit's real 16 px here.
      // `!` because the kit's descendant rule outranks a plain utility on the icon.
      icon: <TabIcon tab={tab} size="!h-[1rem] !w-[1rem]" />,
      checked: tab.id === activeTab,
      onSelect: () => navigateToTab(tab.id),
    })),
  ]
  const handleMobileNavChange = (index: number) => {
    const tab = mobileTabs[index]
    if (!tab) return
    if (tab.id === activeTab) {
      // Tapping the current view takes the page back to its top.
      scrollPageToTop()
      openTabBar()
      return
    }
    navigateToTab(tab.id)
  }
  // Sidebar search is local to Layout; memoizing the page render keeps every
  // keystroke from re-rendering the active workspace.
  const pageContent = useMemo(() => children({ activeTab }), [children, activeTab])

  const normalizedSidebarQuery = sidebarQuery.trim().toLocaleLowerCase()
  const visibleDesktopGroups = desktopTabGroups
    .map(group => ({
      ...group,
      tabs: group.tabs.filter(tab => (
        !normalizedSidebarQuery
        || `${tab.name} ${tab.id}`.toLocaleLowerCase().includes(normalizedSidebarQuery)
      )),
    }))
    .filter(group => group.tabs.length > 0)
  const visibleDesktopTabCount = visibleDesktopGroups.reduce((count, group) => count + group.tabs.length, 0)

  return (
    <div className="view view-main la-pluma-view">
      <div ref={pageRef} className="page no-swipeback la-pluma-page" data-name="la-pluma">
        <AsciiFieldBackdrop />
        <div className="la-pluma-sidebar-frame" aria-hidden="true">
          {/* Static colour for the clear GlassCard to frost; the animated ASCII field is left to the page. */}
          <div className="la-pluma-sidebar-aurora" />
          <GlassCard material="clear" className="lg-host lg-card la-pluma-sidebar-surface h-full w-full rounded-[1.625rem]" />
        </div>
        <header className="navbar la-pluma-navbar">
          <div className="navbar-bg" aria-hidden="true" />
          <div className="navbar-inner">
            <div className="left">
              <div className="la-pluma-navbar-left">
                <GlassLiveCardButton
                  type="button"
                  className="link la-pluma-brand"
                  icon={<img src={brandMark} alt="" className="la-pluma-brand-mark" />}
                  aria-label="La Pluma 控制台"
                  onClick={() => navigateToTab('dashboard')}
                >
                  <span>La Pluma</span>
                </GlassLiveCardButton>
              </div>
            </div>
            <div className="title">
              <h1 className="la-pluma-navbar-title">{tabs.find(tab => tab.id === activeTab)?.name}</h1>
            </div>
            <div className="right">
              <div className="la-pluma-navbar-actions">
                <ThemeToggle />
                <GlassLiveCardButton
                  href="https://github.com/mps233/La-pluma"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link la-pluma-github-link h-11 w-11"
                  icon={<GitHubMark />}
                  aria-label="打开 GitHub 仓库"
                />
              </div>
            </div>
            {hasIslandProvider && (
              <div className="la-pluma-island-layer">
                <Island placement="container" label="La Pluma 活动" />
                <RunIsland />
                <MaaUpdateIsland />
                <MasteryIsland />
                <SanityBatteryIsland />
              </div>
            )}
          </div>
        </header>

        <div className="la-pluma-page-body">
          <aside className="la-pluma-sidebar" aria-label="主要功能">
            <search className="la-pluma-sidebar-search" role="search">
              <GlassInput
                type="search"
                icon={<Search aria-hidden="true" />}
                value={sidebarQuery}
                onChange={handleSidebarQueryChange}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && sidebarQuery) {
                    event.preventDefault()
                    setSidebarQuery('')
                  }
                }}
                onFocus={(event) => {
                  // A value written without an input event (some password
                  // managers only touch the DOM) never reaches sidebar state;
                  // clear it as soon as the user focuses the real field.
                  const input = event.currentTarget
                  if (input.value !== sidebarQuery) input.value = sidebarQuery
                }}
                onClear={() => setSidebarQuery('')}
                placeholder="搜索工作区"
                aria-label="搜索工作区"
                name="workspace-search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-form-type="other"
              />
            </search>

            <div
              className="la-pluma-sidebar-identity"
              aria-label={`${sidebarIdentity.operator}：${sidebarIdentity.quote}`}
            >
              <span className="la-pluma-sidebar-avatar" aria-hidden="true">
                <img
                  key={sidebarIdentity.operatorId}
                  src={getOperatorAvatarUrl(sidebarIdentity.operatorId)}
                  alt=""
                  decoding="async"
                  onError={(event) => {
                    const target = event.currentTarget
                    if (target.dataset.fallbackApplied === 'true') return
                    target.dataset.fallbackApplied = 'true'
                    target.src = brandMark
                  }}
                />
              </span>
              <span className="la-pluma-sidebar-identity-copy">
                <strong title={sidebarIdentity.operator}>{sidebarIdentity.operator}</strong>
                <small title={sidebarIdentity.quote}>{sidebarIdentity.quote}</small>
              </span>
            </div>

            <nav className="la-pluma-sidebar-nav" aria-label="工作台">
              {visibleDesktopGroups.map(group => (
                <div
                  key={group.id}
                  className="la-pluma-sidebar-nav-group"
                  role="group"
                  aria-label={group.label}
                >
                  <span className="la-pluma-sidebar-nav-label" aria-hidden="true">{group.label}</span>
                  {group.tabs.map(tab => (
                    <TabLink key={tab.id} tab={tab} active={activeTab === tab.id} onNavigate={navigateToTab} />
                  ))}
                </div>
              ))}
              {visibleDesktopTabCount === 0 && (
                <div className="la-pluma-sidebar-empty" role="status">
                  <p>没有匹配的工作区</p>
                  <GlassButton
                    type="button"
                    size="sm"
                    material="tinted"
                    onClick={() => setSidebarQuery('')}
                  >
                    清除搜索
                  </GlassButton>
                </div>
              )}
            </nav>
          </aside>

          <main className="la-pluma-scroll-host">
            <div className="la-pluma-content app-shell">
              {pageContent}
            </div>
          </main>
        </div>

        <footer
          ref={tabBarRef}
          className="la-pluma-tabbar"
          data-folded={tabBarFolded ? 'true' : undefined}
          onPointerDownCapture={(event) => {
            // Folded, the bar's only job is to open on the next tap. A drag
            // that starts on the capsule still scrolls the page.
            if (!tabBarFolded) return
            event.stopPropagation()
          }}
          onClickCapture={(event) => {
            if (!tabBarFolded) return
            event.preventDefault()
            event.stopPropagation()
            openTabBar()
          }}
          onFocusCapture={() => openTabBar()}
        >
          <div
            className="la-pluma-tabbar-inner"
            data-theme={theme === 'system' ? undefined : theme}
          >
            <div className="la-pluma-tabbar-nav">
              <GlassNav
                items={mobileNavItems}
                activeIndex={activePrimaryMobileIndex}
                onChange={handleMobileNavChange}
                aria-label="主要功能"
                // The bar only exists in the compact layout, where it sits over the page:
                // a clear surface there bends the content behind it until controls show
                // through it. Tinted keeps the bar reading as a surface, not a lens.
                material="tinted"
                className="la-pluma-tabbar-glass"
              />
            </div>
            <GlassMenu
              items={overflowMenuItems}
              icon={<Ellipsis strokeWidth={2.1} aria-hidden="true" />}
              aria-label="更多工作区"
              align="end"
              plainTrigger
              className={`la-pluma-tabbar-more-anchor${isOverflowActive ? ' is-active' : ''}`}
            />
          </div>
        </footer>

      </div>
    </div>
  )
}
