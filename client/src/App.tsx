import React, { Activity, lazy, Suspense, useEffect } from 'react'
import { MotionConfig } from 'framer-motion'
import Layout from './components/Layout'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import { PageSkeleton } from './components/common'
import { useBackendStatusMonitor } from './hooks/useBackendStatusMonitor'
import { useUIStore } from './stores'

const pageLoaders = {
  dashboard: () => import('./components/Dashboard'),
  automation: () => import('./components/AutomationTasks'),
  combat: () => import('./components/CombatTasks'),
  roguelike: () => import('./components/RoguelikeTasks'),
  training: () => import('./components/OperatorTraining'),
  logs: () => import('./components/LogViewer'),
  statistics: () => import('./components/DataStatistics'),
  config: () => import('./components/ConfigManager'),
}

const Dashboard = lazy(pageLoaders.dashboard)
const AutomationTasks = lazy(pageLoaders.automation)
const CombatTasks = lazy(pageLoaders.combat)
const RoguelikeTasks = lazy(pageLoaders.roguelike)
const OperatorTraining = lazy(pageLoaders.training)
const LogViewer = lazy(pageLoaders.logs)
const DataStatistics = lazy(pageLoaders.statistics)
const ConfigManager = lazy(pageLoaders.config)

const appPages = [
  { id: 'dashboard', Component: Dashboard },
  { id: 'automation', Component: AutomationTasks },
  { id: 'combat', Component: CombatTasks },
  { id: 'roguelike', Component: RoguelikeTasks },
  { id: 'training', Component: OperatorTraining },
  { id: 'logs', Component: LogViewer },
  { id: 'statistics', Component: DataStatistics },
  { id: 'config', Component: ConfigManager },
] as const

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
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-300">
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

function App() {
  useBackendStatusMonitor()
  const theme = useUIStore(state => state.theme)
  const isDark = theme === 'dark'
    || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    document.getElementById('app-root')?.classList.toggle('dark', isDark)
  }, [isDark])

  useEffect(() => {
    const preloadPages = () => {
      void Promise.allSettled(Object.values(pageLoaders).map(loadPage => loadPage()))
    }
    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    if (typeof idleWindow.requestIdleCallback === 'function') {
      const idleId = idleWindow.requestIdleCallback(preloadPages, { timeout: 2000 })
      return () => idleWindow.cancelIdleCallback?.(idleId)
    }

    const timer = window.setTimeout(preloadPages, 600)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div id="app-root" className="la-pluma-app">
      <MotionConfig reducedMotion="user">
        <Layout>
          {({ activeTab }) => appPages.map(({ id, Component }) => (
            <PageErrorBoundary key={id} activeKey={activeTab} pageKey={id}>
                <Suspense fallback={<PageSkeleton variant={id} />}>
                  <Component />
                </Suspense>
            </PageErrorBoundary>
          ))}
        </Layout>
        <PWAInstallPrompt />
      </MotionConfig>
    </div>
  )
}

export default App
