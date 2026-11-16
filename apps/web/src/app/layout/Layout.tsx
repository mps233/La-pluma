import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router'
import { appTabRoute, type AppTab } from '@/shared/navigation'
import { resolvePageTitle } from '../router/pageTitle'
import AppNavbar from './AppNavbar'
import AppSidebar from './AppSidebar'
import AppTabbar from './AppTabbar'

interface LayoutProps {
  activeTab: AppTab
  children: ReactNode
}

function getScrollHost() {
  return document.querySelector<HTMLElement>('[data-region="scroll"]')
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

export default function Layout({ activeTab, children }: LayoutProps) {
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const { pathname } = useLocation()
  const pageTitle = resolvePageTitle(pathname, activeTab)
  const mainRef = useRef<HTMLElement>(null)
  const announcementRef = useRef<HTMLDivElement>(null)
  const previousPathname = useRef(pathname)
  const dialogNavigationTargetRef = useRef<string | null>(null)
  const scrollPositions = useRef(new Map<AppTab, number>())
  const activeTabRef = useRef<AppTab>(activeTab)
  const restoreFrame = useRef<number | null>(null)
  const scrollRestoreCleanupRef = useRef<(() => void) | null>(null)

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
    window.history.scrollRestoration = 'manual'
    return () => {
      window.history.scrollRestoration = previousScrollRestoration
      scrollRestoreCleanupRef.current?.()
      if (restoreFrame.current !== null) window.cancelAnimationFrame(restoreFrame.current)
    }
  }, [])

  useEffect(() => {
    const host = getScrollHost()
    if (!host) return undefined

    const handleScroll = () => {
      scrollPositions.current.set(activeTabRef.current, host.scrollTop)
    }
    host.addEventListener('scroll', handleScroll, { passive: true })
    return () => host.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const snapshotActiveScroll = () => {
      scrollPositions.current.set(activeTabRef.current, getScrollTop())
    }

    window.addEventListener('popstate', snapshotActiveScroll)
    window.addEventListener('click', snapshotActiveScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('popstate', snapshotActiveScroll)
      window.removeEventListener('click', snapshotActiveScroll, { capture: true })
    }
  }, [])

  useLayoutEffect(() => {
    activeTabRef.current = activeTab
    restoreScroll(activeTab)
  }, [activeTab, restoreScroll])

  const navigateToTab = useCallback((tab: AppTab) => {
    if (tab === activeTab) return
    const target = appTabRoute(tab)
    const focused = document.activeElement
    dialogNavigationTargetRef.current = focused instanceof Element
      && focused.closest('[role="dialog"], [role="alertdialog"]')
      ? target
      : null
    scrollPositions.current.set(activeTab, getScrollTop())
    navigate(target)
  }, [activeTab, navigate])

  useEffect(() => {
    document.title = `${pageTitle} · La Pluma Next`
  }, [pageTitle])

  useEffect(() => {
    if (previousPathname.current === pathname) return
    previousPathname.current = pathname

    const startedFromDialog = dialogNavigationTargetRef.current === pathname
    dialogNavigationTargetRef.current = null

    if (navigationType === 'REPLACE') return

    if (announcementRef.current) announcementRef.current.textContent = `已切换到${pageTitle}`
    if (startedFromDialog) return

    const focused = document.activeElement
    if (focused instanceof Element && focused.closest('[role="dialog"], [role="alertdialog"]')) return
    mainRef.current?.focus({ preventScroll: true })
  }, [navigationType, pathname, pageTitle])

  return (
    <div className="view la-pluma-view">
      <div className="page la-pluma-page">
        <a className="la-pluma-skip-link" href="#main-content">跳到主要内容</a>
        <a className="la-pluma-skip-link la-pluma-skip-link-desktop" href="#app-sidebar-navigation">
          跳到主导航
        </a>
        <a className="la-pluma-skip-link la-pluma-skip-link-mobile" href="#app-tabbar-navigation">
          跳到主导航
        </a>
        <div
          ref={announcementRef}
          id="page-announcement"
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        />
        <div className="la-pluma-page-body">
          <AppNavbar pageTitle={pageTitle} />
          <AppSidebar activeTab={activeTab} onNavigate={navigateToTab} />
          <main
            ref={mainRef}
            id="main-content"
            className="la-pluma-scroll-host"
            data-region="scroll"
            tabIndex={-1}
          >
            <div className="la-pluma-content" data-region="page-content">
              {children}
            </div>
          </main>
        </div>
        <AppTabbar activeTab={activeTab} onNavigate={navigateToTab} />
      </div>
    </div>
  )
}
