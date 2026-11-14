import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { appTabRoute, type AppTab } from '@/shared/navigation'
import AppNavbar from './AppNavbar'
import AppSidebar from './AppSidebar'
import AppTabbar from './AppTabbar'

interface LayoutProps {
  activeTab: AppTab
  children: ReactNode
}

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

export default function Layout({ activeTab, children }: LayoutProps) {
  const navigate = useNavigate()
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
    scrollPositions.current.set(activeTab, getScrollTop())
    navigate(appTabRoute(tab))
  }, [activeTab, navigate])

  return (
    <div className="view view-main la-pluma-view">
      <div className="page no-swipeback la-pluma-page" data-name="la-pluma">
        <div className="la-pluma-page-body">
          <AppNavbar activeTab={activeTab} />
          <AppSidebar activeTab={activeTab} onNavigate={navigateToTab} />
          <main className="la-pluma-scroll-host">
            <div className="la-pluma-content app-shell">
              {children}
            </div>
          </main>
        </div>
        <AppTabbar activeTab={activeTab} onNavigate={navigateToTab} />
      </div>
    </div>
  )
}
