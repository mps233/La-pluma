import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { BarChart3, Bot, Dices, FileText, Gamepad2, GitBranch, GraduationCap, LayoutDashboard, MoreHorizontal, Settings2, Swords, X } from 'lucide-react'
import { Link, NavLeft, NavRight, NavTitle, Navbar, Page as F7Page, Sheet, Toolbar, View } from 'framework7-react'
import '../framework7'
import ThemeToggle from './ThemeToggle'
import { useUIStore } from '@/stores'
import { appTabFromPath, appTabPath, isAppTab, type AppTab } from '@/stores/uiStore'

const AccessibleSheet = Sheet as unknown as ComponentType<Record<string, unknown>>
const ExternalLink = Link as unknown as ComponentType<Record<string, unknown>>

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

const mobileTabs = tabs.filter(tab => ['dashboard', 'automation', 'combat', 'training', 'config'].includes(tab.id))
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

function restoreMoreSheetFocus() {
  window.requestAnimationFrame(() => {
    const isDesktop = window.matchMedia?.('(min-width: 1024px)').matches ?? false
    const selector = isDesktop
      ? '.la-pluma-sidebar a[aria-current="page"]'
      : '.la-pluma-tabbar [aria-label="更多页面"]'
    const target = document.querySelector<HTMLElement>(selector)
      ?? document.querySelector<HTMLElement>('.la-pluma-navbar a')
    target?.focus({ preventScroll: true })
  })
}

function TabIcon({ tab, size = 'h-4 w-4' }: { tab: typeof tabs[number]; size?: string }) {
  const Icon = tab.icon
  return <Icon className={size} strokeWidth={1.9} aria-hidden="true" />
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
  return (
    <Link
      href={appTabPath(tab.id)}
      tabLink={mobile || undefined}
      tabLinkActive={mobile ? active : undefined}
      tabbarLabel={mobile || undefined}
      text={mobile ? tab.name : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => onNavigate(event as ReactMouseEvent<HTMLAnchorElement>, tab.id, mobile)}
      className={`la-pluma-tab-link ${active ? 'is-active' : ''} ${mobile ? 'is-mobile-tab' : 'is-desktop-tab'}`}
    >
      <TabIcon tab={tab} size={mobile ? 'h-5 w-5' : 'h-[1.125rem] w-[1.125rem]'} />
      {!mobile && <span>{tab.name}</span>}
    </Link>
  )
}

export default function Layout({ children }: LayoutProps) {
  const storedActiveTab = useUIStore(state => state.activeTab)
  const setActiveTab = useUIStore(state => state.setActiveTab)
  const activeTab: AppTab = isAppTab(storedActiveTab) ? storedActiveTab : 'dashboard'
  const [moreOpen, setMoreOpen] = useState(false)
  const scrollPositions = useRef(new Map<AppTab, number>())
  const previousTab = useRef<AppTab>(activeTab)
  const navigationSource = useRef<'initial' | 'store' | 'link' | 'popstate'>('initial')
  const restoreFrame = useRef<number | null>(null)
  const scrollRestoreCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!moreOpen) return undefined

    const focusFrame = window.requestAnimationFrame(() => {
      const sheet = document.getElementById('la-pluma-more-sheet')
      const activeLink = sheet?.querySelector<HTMLElement>('[aria-current="page"]')
      const firstFocusable = sheet?.querySelector<HTMLElement>('a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])')
      ;(activeLink ?? firstFocusable)?.focus({ preventScroll: true })
    })

    const handleSheetKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMoreOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const sheet = document.getElementById('la-pluma-more-sheet')
      if (!sheet) return
      const focusable = [...sheet.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length > 0)
      if (focusable.length === 0) return

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', handleSheetKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleSheetKeyDown)
    }
  }, [moreOpen])

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

  return (
    <View main router={false} className="la-pluma-view">
      <F7Page name="la-pluma" pageContent={false} noSwipeback className="la-pluma-page">
        <Navbar className="la-pluma-navbar">
          <NavLeft slot="left">
            <Link href={appTabPath('dashboard')} className="la-pluma-brand" aria-label="La Pluma 控制台" onClick={(event) => navigateToTab(event as ReactMouseEvent<HTMLAnchorElement>, 'dashboard')}>
              <img src={`${import.meta.env.BASE_URL}logo-graphite.svg?v=1`} alt="" className="la-pluma-brand-mark" />
              <span>La Pluma</span>
            </Link>
          </NavLeft>
          <NavTitle slot="title" className="la-pluma-navbar-title">{tabs.find(tab => tab.id === activeTab)?.name}</NavTitle>
          <NavRight slot="right">
            <ThemeToggle />
            <ExternalLink
              href="https://github.com/mps233/La-pluma"
              target="_blank"
              rel="noopener noreferrer"
              external
              className="la-pluma-github-link"
              tooltip="打开 GitHub 仓库"
              aria-label="打开 GitHub 仓库"
            >
              <GitBranch className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
            </ExternalLink>
          </NavRight>
        </Navbar>

        <div className="la-pluma-page-body">
          <aside className="la-pluma-sidebar" aria-label="主要功能">
            <div className="la-pluma-sidebar-caption">工作台</div>
            <nav className="la-pluma-sidebar-nav">
              {tabs.map(tab => (
                <TabLink key={tab.id} tab={tab} active={activeTab === tab.id} onNavigate={navigateToTab} />
              ))}
            </nav>
            <div className="la-pluma-sidebar-footnote">
              <Gamepad2 className="h-4 w-4" aria-hidden="true" />
              <span>MAA 本地控制台</span>
            </div>
          </aside>

          <main className="la-pluma-scroll-host">
            <div className="la-pluma-content app-shell">
              {children({ activeTab })}
            </div>
          </main>
        </div>

        <Toolbar tabbar icons bottom className="la-pluma-tabbar">
          {mobileTabs.map(tab => (
            <TabLink key={tab.id} tab={tab} active={activeTab === tab.id} onNavigate={navigateToTab} mobile />
          ))}
          <Link
            tabLink
            tabLinkActive={isOverflowActive || moreOpen}
            href="#la-pluma-more-sheet"
            sheetOpen={moreOpen ? '#la-pluma-more-sheet' : undefined}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-controls="la-pluma-more-sheet"
            onClick={(event) => {
              event?.preventDefault()
              setMoreOpen(true)
            }}
            className={`la-pluma-tab-link is-mobile-tab ${isOverflowActive ? 'is-active' : ''}`}
            aria-label="更多页面"
          >
            <MoreHorizontal className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
            <span>更多</span>
          </Link>
        </Toolbar>

        <AccessibleSheet
          id="la-pluma-more-sheet"
          className="la-pluma-more-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="la-pluma-more-sheet-title"
          opened={moreOpen}
          bottom
          backdrop
          closeByBackdropClick
          closeOnEscape
          swipeToClose
          onSheetClosed={() => {
            setMoreOpen(false)
            restoreMoreSheetFocus()
          }}
        >
          <div className="la-pluma-sheet-grabber" aria-hidden="true" />
          <div className="la-pluma-sheet-heading">
            <div>
              <span className="la-pluma-eyebrow">LA PLUMA</span>
              <h2 id="la-pluma-more-sheet-title">更多工作区</h2>
            </div>
            <Link
              sheetClose="#la-pluma-more-sheet"
              iconOnly
              aria-label="关闭更多工作区"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Link>
          </div>
          <nav aria-label="更多功能" className="la-pluma-sheet-nav">
            {overflowTabs.map(tab => (
              <TabLink key={tab.id} tab={tab} active={activeTab === tab.id} onNavigate={navigateToTab} mobile />
            ))}
          </nav>
        </AccessibleSheet>
      </F7Page>
    </View>
  )
}
