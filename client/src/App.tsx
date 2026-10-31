import React, { Activity, lazy, Suspense, useState, useEffect } from 'react'
import { MotionConfig } from 'framer-motion'
import Dashboard from './components/Dashboard'
import Layout from './components/Layout'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import { PageSkeleton } from './components/common'
import { useBackendStatusMonitor } from './hooks/useBackendStatusMonitor'
import { useUIStore } from './stores'

const pageLoaders = {
  automation: () => import('./components/AutomationTasks'),
  combat: () => import('./components/CombatTasks'),
  roguelike: () => import('./components/RoguelikeTasks'),
  training: () => import('./components/OperatorTraining'),
  tools: () => import('./components/CustomTools'),
  logs: () => import('./components/LogViewer'),
  statistics: () => import('./components/DataStatistics'),
  config: () => import('./components/ConfigManager'),
}

const AutomationTasks = lazy(pageLoaders.automation)
const CombatTasks = lazy(pageLoaders.combat)
const RoguelikeTasks = lazy(pageLoaders.roguelike)
const OperatorTraining = lazy(pageLoaders.training)
const CustomTools = lazy(pageLoaders.tools)
const LogViewer = lazy(pageLoaders.logs)
const DataStatistics = lazy(pageLoaders.statistics)
const ConfigManager = lazy(pageLoaders.config)

const appPages = [
  { id: 'dashboard', Component: Dashboard },
  { id: 'automation', Component: AutomationTasks },
  { id: 'combat', Component: CombatTasks },
  { id: 'roguelike', Component: RoguelikeTasks },
  { id: 'training', Component: OperatorTraining },
  { id: 'tools', Component: CustomTools },
  { id: 'logs', Component: LogViewer },
  { id: 'statistics', Component: DataStatistics },
  { id: 'config', Component: ConfigManager },
] as const

const BACKGROUND_PRELOAD_DELAY = 2000

interface PageErrorBoundaryProps {
  activeKey: string
  pageKey: string
  children: React.ReactNode
}

class PageErrorBoundary extends React.Component<PageErrorBoundaryProps, { hasError: boolean; errorMessage: string }> {
  constructor(props: PageErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, errorMessage: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error?.message || '页面渲染失败' }
  }

  componentDidCatch(error: Error) {
    console.error('Page render error:', error)
  }

  componentDidUpdate(prevProps: PageErrorBoundaryProps) {
    if (prevProps.activeKey !== this.props.activeKey && this.state.hasError) {
      this.setState({ hasError: false, errorMessage: '' })
    }
  }

  render() {
    const content = this.state.hasError ? (
        <div className="p-6">
          <div className="rounded-2xl border border-transparent p-4 text-sm status-danger">
            页面渲染失败：{this.state.errorMessage}
          </div>
        </div>
    ) : this.props.children

    return (
      <Activity
        name={`${this.props.pageKey}-workspace`}
        mode={this.props.activeKey === this.props.pageKey ? 'visible' : 'hidden'}
      >
        {content}
      </Activity>
    )
  }
}

function VisitedWorkspaces({ activeTab }: { activeTab: string }) {
  const [visitedPages] = useState(() => new Set([activeTab]))
  // The active tab prop already drives renders; keep history mutable to avoid a second render on navigation.
  visitedPages.add(activeTab)

  return appPages
    .filter(({ id }) => id === activeTab || visitedPages.has(id))
    .map(({ id, Component }) => (
      <PageErrorBoundary key={id} activeKey={activeTab} pageKey={id}>
        <Suspense fallback={<PageSkeleton variant={id} />}>
          <Component />
        </Suspense>
      </PageErrorBoundary>
    ))
}

function App() {
  useBackendStatusMonitor()
  const theme = useUIStore(state => state.theme)
  const isDark = theme === 'dark'
    || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    document.getElementById('app-root')?.classList.toggle('dark', isDark)
  }, [isDark])

  useEffect(() => {
    const connection = (navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean }
    }).connection
    if (connection?.saveData || connection?.effectiveType?.includes('2g')) return undefined

    const loaders = Object.values(pageLoaders)
    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    let cancelled = false
    let nextLoader = 0
    let idleId: number | undefined
    let fallbackTimer: number | undefined

    const scheduleNext = () => {
      if (cancelled || nextLoader >= loaders.length) return

      const preloadNext = () => {
        idleId = undefined
        fallbackTimer = undefined
        if (cancelled) return

        const loadPage = loaders[nextLoader]
        nextLoader += 1
        if (!loadPage) return
        void loadPage().catch(() => undefined).finally(scheduleNext)
      }

      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleId = idleWindow.requestIdleCallback(preloadNext, { timeout: 1000 })
      } else {
        fallbackTimer = window.setTimeout(preloadNext, 0)
      }
    }

    const startTimer = window.setTimeout(scheduleNext, BACKGROUND_PRELOAD_DELAY)
    return () => {
      cancelled = true
      window.clearTimeout(startTimer)
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId)
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer)
    }
  }, [])

  return (
    <div id="app-root" className="la-pluma-app">
      <MotionConfig reducedMotion="user">
        <Layout>
          {({ activeTab }) => <VisitedWorkspaces activeTab={activeTab} />}
        </Layout>
        <PWAInstallPrompt />
      </MotionConfig>
    </div>
  )
}

export default App
