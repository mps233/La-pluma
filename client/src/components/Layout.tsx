import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BarChart3, Bot, Dices, Ellipsis, FileText, GraduationCap, LayoutGrid, Settings2, Swords, Wrench } from 'lucide-react'
import { GlassButton, GlassCard, GlassInput, GlassMenu, GlassNav } from '@zakisheriff/liquid-glass'
import ThemeToggle from './ThemeToggle'
import RunIsland from './RunIsland'
import SanityBatteryIsland from './SanityBatteryIsland'
import MaaUpdateIsland from './MaaUpdateIsland'
import AeroBackdrop from './backgrounds/AeroBackdrop'
import { Island } from '@/lib/island'
import { IslandContext } from '@/lib/island/context'
import { useUIStore } from '@/stores'
import { appTabFromPath, appTabPath, isAppTab, type AppTab } from '@/stores/uiStore'
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
      variant={active ? 'filled' : 'clear'}
      tint={active ? 'var(--app-accent-action)' : undefined}
      size="md"
      className={`la-pluma-tab-link link is-desktop-tab ${active ? 'is-active' : ''}`}
    >
      <span className="la-pluma-sidebar-label">{tab.name}</span>
    </GlassButton>
  )
}

export default function Layout({ children }: LayoutProps) {
  const storedActiveTab = useUIStore(state => state.activeTab)
  const setActiveTab = useUIStore(state => state.setActiveTab)
  const theme = useUIStore(state => state.theme)
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
    restoreScroll(activeTab)
  }, [activeTab, restoreScroll, setActiveTab, storedActiveTab])

  const navigateToTab = (tab: AppTab) => {
    if (tab !== activeTab) {
      preloadPage(tab)
      scrollPositions.current.set(activeTab, getScrollTop())
      navigationSource.current = 'link'
      setActiveTab(tab)
    }
  }

  const activePrimaryMobileIndex = mobileTabs.findIndex(tab => tab.id === activeTab)
  const isOverflowActive = overflowTabs.some(tab => tab.id === activeTab)
  const mobileNavItems = mobileTabs.map(tab => ({
    label: tab.name,
    icon: <TabIcon tab={tab} size="h-6 w-6" />,
  }))
  const overflowMenuItems = overflowTabs.map(tab => ({
    label: tab.name,
    icon: <TabIcon tab={tab} size="h-5 w-5" />,
    checked: tab.id === activeTab,
    onSelect: () => navigateToTab(tab.id),
  }))
  const handleMobileNavChange = (index: number) => {
    const tab = mobileTabs[index]
    if (tab) navigateToTab(tab.id)
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
        <AeroBackdrop />
        <div className="la-pluma-sidebar-frame" aria-hidden="true">
          <GlassCard className="la-pluma-sidebar-surface" padding="0" radius="1.625rem" />
        </div>
        <header className="navbar la-pluma-navbar">
          <div className="navbar-bg" aria-hidden="true" />
          <div className="navbar-inner">
            <div className="left">
              <div className="la-pluma-navbar-left">
                <GlassButton
                  type="button"
                  className="link la-pluma-brand"
                  icon={<img src={`${import.meta.env.BASE_URL}logo-graphite.svg?v=1`} alt="" className="la-pluma-brand-mark" />}
                  variant="clear"
                  size="md"
                  aria-label="La Pluma 控制台"
                  onClick={() => navigateToTab('dashboard')}
                >
                  <span>La Pluma</span>
                </GlassButton>
              </div>
            </div>
            <div className="title">
              <h1 className="la-pluma-navbar-title">{tabs.find(tab => tab.id === activeTab)?.name}</h1>
            </div>
            <div className="right">
              <div className="la-pluma-navbar-actions">
                <ThemeToggle />
                <GlassButton
                  href="https://github.com/mps233/La-pluma"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link la-pluma-github-link"
                  icon={<GitHubMark />}
                  variant="glass"
                  size="md"
                  aria-label="打开 GitHub 仓库"
                />
              </div>
            </div>
            {hasIslandProvider && (
              <div className="la-pluma-island-layer">
                <Island placement="container" label="La Pluma 活动" />
                <RunIsland />
                <MaaUpdateIsland />
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
                value={sidebarQuery}
                onChange={(event) => setSidebarQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && sidebarQuery) {
                    event.preventDefault()
                    setSidebarQuery('')
                  }
                }}
                onClear={() => setSidebarQuery('')}
                placeholder="搜索工作区"
                aria-label="搜索工作区"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
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
                    target.src = `${import.meta.env.BASE_URL}logo-graphite.svg?v=1`
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
                  {group.tabs.map(tab => (
                    <TabLink key={tab.id} tab={tab} active={activeTab === tab.id} onNavigate={navigateToTab} />
                  ))}
                </div>
              ))}
              {visibleDesktopTabCount === 0 && (
                <p className="la-pluma-sidebar-empty" role="status">没有匹配的工作区</p>
              )}
            </nav>
          </aside>

          <main className="la-pluma-scroll-host">
            <div className="la-pluma-content app-shell">
              {pageContent}
            </div>
          </main>
        </div>

        <footer className="la-pluma-tabbar">
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
                className="la-pluma-tabbar-glass"
              />
            </div>
            <GlassMenu
              items={overflowMenuItems}
              icon={<Ellipsis strokeWidth={2.1} aria-hidden="true" />}
              aria-label="更多工作区"
              align="end"
              className={`la-pluma-tabbar-more-anchor${isOverflowActive ? ' is-active' : ''}`}
            />
          </div>
        </footer>
      </div>
    </div>
  )
}
