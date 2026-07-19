import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import ThemeToggle from './ThemeToggle'
import { useUIStore } from '@/stores'
import { appTabFromPath, appTabPath, isAppTab, type AppTab } from '@/stores/uiStore'

interface LayoutProps {
  children: (props: { activeTab: string }) => React.ReactNode
}

const tabs = [
  { id: 'dashboard', name: '控制台' },
  { id: 'automation', name: '自动化' },
  { id: 'combat', name: '作业' },
  { id: 'roguelike', name: '肉鸽' },
  { id: 'training', name: '养成' },
  { id: 'logs', name: '日志' },
  { id: 'statistics', name: '数据' },
  { id: 'config', name: '配置' },
] satisfies Array<{ id: AppTab; name: string }>

export default function Layout({ children }: LayoutProps) {
  const storedActiveTab = useUIStore(state => state.activeTab)
  const setActiveTab = useUIStore(state => state.setActiveTab)
  const activeTab: AppTab = isAppTab(storedActiveTab) ? storedActiveTab : 'dashboard'
  const shouldReduceMotion = useReducedMotion()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const scrollPositions = useRef(new Map<AppTab, number>())
  const previousTab = useRef<AppTab>(activeTab)
  const navigationSource = useRef<'initial' | 'store' | 'link' | 'popstate'>('initial')
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
      window.scrollTo({ top, left: 0, behavior: 'auto' })
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

    const content = document.querySelector('main')
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
        scrollPositions.current.set(previousTab.current, window.scrollY)
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
      savedScrollPositions.set(previousTab.current, window.scrollY)
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
      scrollPositions.current.set(previousTab.current, window.scrollY)
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

  const closeMobileMenu = useCallback((restoreFocus = false) => {
    setMobileMenuOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => mobileMenuTriggerRef.current?.focus({ preventScroll: true }))
    }
  }, [])

  useEffect(() => {
    if (!mobileMenuOpen) return undefined

    const focusFrame = window.requestAnimationFrame(() => {
      const activeLink = mobileMenuRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
      const firstLink = mobileMenuRef.current?.querySelector<HTMLElement>('a[href]')
      ;(activeLink ?? firstLink)?.focus({ preventScroll: true })
    })
    const handlePointerDown = (event: PointerEvent) => {
      if (!mobileMenuRef.current?.contains(event.target as Node)
        && !mobileMenuTriggerRef.current?.contains(event.target as Node)) {
        closeMobileMenu()
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMobileMenu(true)
      }
    }
    const desktopQuery = window.matchMedia('(min-width: 1024px)')
    const handleDesktopChange = (event: MediaQueryListEvent) => {
      if (event.matches) closeMobileMenu()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    desktopQuery.addEventListener('change', handleDesktopChange)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      desktopQuery.removeEventListener('change', handleDesktopChange)
    }
  }, [closeMobileMenu, mobileMenuOpen])

  const navigateToTab = (event: ReactMouseEvent<HTMLAnchorElement>, tab: AppTab, mobile = false) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (mobile) closeMobileMenu(true)
    if (tab !== activeTab) {
      scrollPositions.current.set(activeTab, window.scrollY)
      navigationSource.current = 'link'
      setActiveTab(tab)
    }
  }

  return (
    <div className="min-h-screen transition-colors">
      {/* 顶部导航栏 - 包含标题和标签页 */}
      <header className="nav-shell sticky top-0 z-50 transition-colors">
        <div className="app-shell">
          <div className="flex justify-between items-center h-14 sm:h-16">
            {/* 左侧：Logo 和标题 */}
            <div className="flex items-center gap-2 sm:gap-3">
              <img 
                src={`${import.meta.env.BASE_URL}logo-graphite.svg?v=1`}
                alt="La Pluma Logo" 
                className="h-7 w-7 object-contain sm:h-8 sm:w-8"
              />
              <h1 className="text-primary text-base font-semibold sm:text-lg">
                La Pluma
              </h1>
            </div>

            {/* 右侧：标签页导航 + 系统信息 */}
            <div className="flex items-center gap-3 sm:gap-5">
              {/* 桌面端标签页导航 */}
              <nav aria-label="主要功能" className="surface-soft hidden gap-1 rounded-2xl p-1.5 lg:flex">
                {tabs.map((tab) => (
                  <a
                    key={tab.id}
                    href={appTabPath(tab.id)}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    onClick={(event) => navigateToTab(event, tab.id)}
                    className={`
                      relative flex items-center px-3.5 py-2 font-medium text-sm rounded-xl transition-colors active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]
                      ${activeTab === tab.id ? 'nav-item-active' : 'nav-item-idle'}
                    `}
                  >
                    <span>{tab.name}</span>
                  </a>
                ))}
              </nav>

              {/* 主题切换器 */}
              <ThemeToggle />

              {/* 移动端汉堡菜单按钮 */}
              <div className="relative lg:hidden">
                <button
                  ref={mobileMenuTriggerRef}
                  type="button"
                  onClick={() => setMobileMenuOpen((open) => !open)}
                  aria-label={mobileMenuOpen ? '关闭导航菜单' : '打开导航菜单'}
                  aria-expanded={mobileMenuOpen}
                  aria-controls="mobile-navigation"
                  className="text-secondary hover:text-primary flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-colors active:scale-[0.96] hover:bg-white/60 dark:hover:bg-white/10"
                >
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    {mobileMenuOpen ? (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                    )}
                  </svg>
                </button>
                <AnimatePresence>
                  {mobileMenuOpen && (
                    <motion.nav
                      ref={mobileMenuRef}
                      id="mobile-navigation"
                      aria-label="移动端主要功能"
                      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: shouldReduceMotion ? 0.08 : 0.16, ease: 'easeOut' }}
                      className="surface-panel absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(18rem,calc(100vw-1.75rem))] origin-top-right rounded-xl p-2 shadow-xl"
                    >
                      <div className="flex flex-col space-y-1">
                        {tabs.map((tab) => (
                          <a
                            key={tab.id}
                            href={appTabPath(tab.id)}
                            aria-current={activeTab === tab.id ? 'page' : undefined}
                            onClick={(event) => navigateToTab(event, tab.id, true)}
                            className={`
                              flex min-h-11 items-center rounded-xl px-4 py-3 text-sm font-medium transition-colors active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]
                              ${activeTab === tab.id ? 'nav-item-active' : 'nav-item-idle'}
                            `}
                          >
                            <span>{tab.name}</span>
                          </a>
                        ))}
                      </div>
                    </motion.nav>
                  )}
                </AnimatePresence>
              </div>

              {/* GitHub 链接 */}
              <a
                href="https://github.com/mps233/La-pluma"
                target="_blank"
                rel="noopener noreferrer"
                className="text-secondary hover:text-primary hidden items-center justify-center rounded-lg p-2 transition-all hover:bg-white/60 dark:hover:bg-white/10 sm:flex"
                title="GitHub 仓库"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
          </div>

        </div>
      </header>

      {/* 主内容区域 */}
      <main className="app-shell py-3 sm:py-8">
        <div>
          {children({ activeTab })}
        </div>
      </main>
    </div>
  )
}
