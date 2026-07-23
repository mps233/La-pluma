import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'framer-motion'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { BarChart3, Bot, Dices, Ellipsis, FileText, GraduationCap, LayoutDashboard, Search, Settings2, Swords, X } from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import { useUIStore } from '@/stores'
import { appTabFromPath, appTabPath, isAppTab, type AppTab } from '@/stores/uiStore'
import {
  DEFAULT_OPERATOR_QUOTE,
  getOperatorAvatarUrl,
  loadDailyOperatorQuote,
} from '@/services/operatorQuotes'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',')
const SHEET_DISMISS_OFFSET = 96
const SHEET_DISMISS_VELOCITY = 650
const SHEET_EASE = [0.32, 0.72, 0, 1] as const

interface LayoutProps {
  children: (props: { activeTab: string }) => ReactNode
}

const tabs = [
  { id: 'dashboard', name: '控制台', icon: LayoutDashboard },
  { id: 'automation', name: '自动化', icon: Bot },
  { id: 'combat', name: '作业', icon: Swords },
  { id: 'roguelike', name: '肉鸽', icon: Dices },
  { id: 'training', name: '养成', icon: GraduationCap },
  { id: 'logs', name: '日志', icon: FileText },
  { id: 'statistics', name: '数据', icon: BarChart3 },
  { id: 'config', name: '配置', icon: Settings2 },
] satisfies Array<{ id: AppTab; name: string; icon: typeof LayoutDashboard }>

const desktopTabGroups = [
  {
    id: 'tasks',
    label: '任务与执行',
    tabs: tabs.filter(tab => ['dashboard', 'automation', 'combat', 'roguelike', 'training'].includes(tab.id)),
  },
  {
    id: 'library',
    label: '记录与设置',
    tabs: tabs.filter(tab => ['logs', 'statistics', 'config'].includes(tab.id)),
  },
]

// Keep the compact mobile rail focused on the four destinations used most often.
// The remaining workspaces stay available from the adjacent more control.
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
  mobile = false,
}: {
  tab: typeof tabs[number]
  active: boolean
  onNavigate: (event: ReactMouseEvent<HTMLAnchorElement>, tab: AppTab, mobile?: boolean) => void
  mobile?: boolean
}) {
  const frameworkClasses = mobile
    ? `tab-link${active ? ' tab-link-active' : ''}`
    : 'link'

  return (
    <a
      href={appTabPath(tab.id)}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => onNavigate(event, tab.id, mobile)}
      className={`la-pluma-tab-link ${frameworkClasses} ${active ? 'is-active' : ''} ${mobile ? 'is-mobile-tab' : 'is-desktop-tab'}`}
    >
      {mobile ? (
        <TabIcon tab={tab} size="h-5 w-5" />
      ) : (
        <span className="la-pluma-sidebar-icon">
          <TabIcon tab={tab} size="h-4 w-4" />
        </span>
      )}
      <span className={mobile ? 'tabbar-label' : 'la-pluma-sidebar-label'}>{tab.name}</span>
    </a>
  )
}

export default function Layout({ children }: LayoutProps) {
  const storedActiveTab = useUIStore(state => state.activeTab)
  const setActiveTab = useUIStore(state => state.setActiveTab)
  const activeTab: AppTab = isAppTab(storedActiveTab) ? storedActiveTab : 'dashboard'
  const [moreOpen, setMoreOpen] = useState(false)
  const [sidebarQuery, setSidebarQuery] = useState('')
  const [sidebarIdentity, setSidebarIdentity] = useState(DEFAULT_OPERATOR_QUOTE)
  const shouldReduceMotion = useReducedMotion()
  const moreTriggerRef = useRef<HTMLAnchorElement>(null)
  const scrollPositions = useRef(new Map<AppTab, number>())
  const previousTab = useRef<AppTab>(activeTab)
  const navigationSource = useRef<'initial' | 'store' | 'link' | 'popstate'>('initial')
  const restoreFrame = useRef<number | null>(null)
  const scrollRestoreCleanupRef = useRef<(() => void) | null>(null)

  const closeMoreSheet = useCallback(() => setMoreOpen(false), [])

  useEffect(() => {
    let subscribed = true

    void loadDailyOperatorQuote().then((quote) => {
      if (subscribed) setSidebarIdentity(quote)
    }).catch(() => undefined)

    return () => {
      subscribed = false
    }
  }, [])

  useEffect(() => {
    if (!moreOpen) return undefined

    const scrollHost = getScrollHost()
    const focusReturnTarget = moreTriggerRef.current
    const previousBodyOverflow = document.body.style.overflow
    const previousScrollHostOverflow = scrollHost?.style.overflow ?? ''
    document.body.style.overflow = 'hidden'
    if (scrollHost) scrollHost.style.overflow = 'hidden'

    const focusFrame = window.requestAnimationFrame(() => {
      const sheet = document.getElementById('la-pluma-more-sheet')
      const activeLink = sheet?.querySelector<HTMLElement>('[aria-current="page"]')
      const firstFocusable = sheet?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(activeLink ?? firstFocusable)?.focus({ preventScroll: true })
    })

    const handleSheetKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMoreSheet()
        return
      }
      if (event.key !== 'Tab') return

      const sheet = document.getElementById('la-pluma-more-sheet')
      if (!sheet) return
      const focusable = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      if (focusable.length === 0) return

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (!sheet.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus({ preventScroll: true })
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', handleSheetKeyDown, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleSheetKeyDown, true)
      document.body.style.overflow = previousBodyOverflow
      if (scrollHost) scrollHost.style.overflow = previousScrollHostOverflow
      window.requestAnimationFrame(() => {
        if (focusReturnTarget?.isConnected) focusReturnTarget.focus({ preventScroll: true })
      })
    }
  }, [closeMoreSheet, moreOpen])

  const handleMoreSheetDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.y >= SHEET_DISMISS_OFFSET || info.velocity.y >= SHEET_DISMISS_VELOCITY) {
      closeMoreSheet()
    }
  }

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 1024px)')
    const closeOnDesktop = (event?: MediaQueryListEvent) => {
      if (event?.matches ?? desktopQuery.matches) setMoreOpen(false)
    }

    if (typeof desktopQuery.addEventListener === 'function') {
      desktopQuery.addEventListener('change', closeOnDesktop)
    } else {
      desktopQuery.addListener(closeOnDesktop)
    }
    closeOnDesktop()

    return () => {
      if (typeof desktopQuery.removeEventListener === 'function') {
        desktopQuery.removeEventListener('change', closeOnDesktop)
      } else {
        desktopQuery.removeListener(closeOnDesktop)
      }
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
    const handlePopState = () => {
      const nextTab = appTabFromPath(window.location.pathname) ?? 'dashboard'
      if (nextTab !== previousTab.current) {
        savedScrollPositions.set(previousTab.current, getScrollTop())
      }
      navigationSource.current = 'popstate'
      if (!appTabFromPath(window.location.pathname)) {
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
    if (window.location.pathname !== targetPath) {
      const state = { ...window.history.state, laPlumaTab: activeTab }
      if (isInitial || source === 'popstate') window.history.replaceState(state, '', targetPath)
      else window.history.pushState(state, '', targetPath)
    }

    previousTab.current = activeTab
    navigationSource.current = 'store'
    restoreScroll(activeTab)
  }, [activeTab, restoreScroll, setActiveTab, storedActiveTab])

  const navigateToTab = (event: ReactMouseEvent<HTMLAnchorElement>, tab: AppTab, mobile = false) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (mobile) setMoreOpen(false)
    if (tab !== activeTab) {
      scrollPositions.current.set(activeTab, getScrollTop())
      navigationSource.current = 'link'
      setActiveTab(tab)
    }
  }

  const isOverflowActive = overflowTabs.some(tab => tab.id === activeTab)
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
      <div className="page no-swipeback la-pluma-page" data-name="la-pluma">
        <div className="la-pluma-sidebar-frame" aria-hidden="true" />
        <header className="navbar la-pluma-navbar">
          <div className="navbar-bg" aria-hidden="true" />
          <div className="navbar-inner">
            <div className="left">
              <div className="la-pluma-navbar-left">
                <a href={appTabPath('dashboard')} className="link la-pluma-brand" aria-label="La Pluma 控制台" onClick={(event) => navigateToTab(event, 'dashboard')}>
                  <img src={`${import.meta.env.BASE_URL}logo-graphite.svg?v=1`} alt="" className="la-pluma-brand-mark" />
                  <span>La Pluma</span>
                </a>
              </div>
            </div>
            <div className="title">
              <div className="la-pluma-navbar-title">{tabs.find(tab => tab.id === activeTab)?.name}</div>
            </div>
            <div className="right">
              <div className="la-pluma-navbar-actions">
                <ThemeToggle />
                <a
                  href="https://github.com/mps233/La-pluma"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link la-pluma-github-link"
                  aria-label="打开 GitHub 仓库"
                >
                  <GitHubMark />
                </a>
              </div>
            </div>
          </div>
        </header>

        <div className="la-pluma-page-body">
          <aside className="la-pluma-sidebar" aria-label="主要功能">
            <div className="la-pluma-sidebar-search" role="search">
              <Search size={17} strokeWidth={2} aria-hidden="true" />
              <input
                type="search"
                value={sidebarQuery}
                onChange={(event) => setSidebarQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && sidebarQuery) {
                    event.preventDefault()
                    setSidebarQuery('')
                  }
                }}
                placeholder="搜索工作区"
                aria-label="搜索工作区"
                autoComplete="off"
                spellCheck={false}
              />
              {sidebarQuery && (
                <button
                  type="button"
                  className="la-pluma-sidebar-search-clear"
                  onClick={() => setSidebarQuery('')}
                  title="清除搜索"
                  aria-label="清除搜索"
                >
                  <X size={13} strokeWidth={2.2} aria-hidden="true" />
                </button>
              )}
            </div>

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
              {children({ activeTab })}
            </div>
          </main>
        </div>

        <footer className="toolbar toolbar-bottom tabbar tabbar-icons la-pluma-tabbar">
          <div className="toolbar-inner">
            <nav className="la-pluma-tabbar-pill app-liquid-tab-pill" aria-label="主要功能">
              {mobileTabs.map(tab => (
                <TabLink key={tab.id} tab={tab} active={activeTab === tab.id} onNavigate={navigateToTab} mobile />
              ))}
            </nav>
            <a
              ref={moreTriggerRef}
              href="#la-pluma-more-sheet"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-controls="la-pluma-more-sheet"
              onClick={(event) => {
                event.preventDefault()
                setMoreOpen(true)
              }}
              className={`tab-link la-pluma-tabbar-search ${isOverflowActive || moreOpen ? 'is-active tab-link-active' : ''}`}
              aria-label="更多页面"
            >
              <Ellipsis className="la-pluma-tabbar-search-icon" strokeWidth={2.1} aria-hidden="true" />
            </a>
          </div>
        </footer>

        <AnimatePresence>
          {moreOpen && (
            <>
              <motion.div
                key="more-sheet-backdrop"
                className="sheet-backdrop backdrop-in"
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: shouldReduceMotion ? 0.12 : 0.16, ease: SHEET_EASE }}
                style={{ transition: 'none' }}
                onClick={closeMoreSheet}
              />
              <motion.section
                key="more-sheet"
                id="la-pluma-more-sheet"
                className="sheet-modal sheet-modal-bottom modal-in la-pluma-more-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="la-pluma-more-sheet-title"
                tabIndex={-1}
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: '100%' }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: '100%' }}
                transition={shouldReduceMotion
                  ? { duration: 0.12, ease: SHEET_EASE }
                  : {
                      y: { duration: 0.28, ease: SHEET_EASE },
                      opacity: { duration: 0.16, ease: SHEET_EASE },
                    }}
                drag={shouldReduceMotion ? false : 'y'}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.06, bottom: 0.72 }}
                dragMomentum={false}
                dragDirectionLock
                onDragEnd={handleMoreSheetDragEnd}
                style={{
                  touchAction: shouldReduceMotion ? undefined : 'pan-x',
                  transition: 'none',
                }}
              >
                <div className="sheet-modal-inner">
                  <div className="la-pluma-sheet-grabber" aria-hidden="true" />
                  <div className="la-pluma-sheet-heading">
                    <div>
                      <span className="la-pluma-eyebrow">LA PLUMA</span>
                      <h2 id="la-pluma-more-sheet-title">更多工作区</h2>
                    </div>
                    <button
                      type="button"
                      className="link icon-only sheet-close la-pluma-sheet-close"
                      aria-label="关闭更多工作区"
                      onClick={closeMoreSheet}
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>
                  <nav aria-label="更多功能" className="la-pluma-sheet-nav">
                    {overflowTabs.map(tab => (
                      <TabLink key={tab.id} tab={tab} active={activeTab === tab.id} onNavigate={navigateToTab} mobile />
                    ))}
                  </nav>
                </div>
              </motion.section>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
