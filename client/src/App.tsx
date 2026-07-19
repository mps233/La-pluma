import React, { lazy, Suspense, useEffect } from 'react'
import { MotionConfig } from 'framer-motion'
import Layout from './components/Layout'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import { PageSkeleton } from './components/common'
import { useBackendStatusMonitor } from './hooks/useBackendStatusMonitor'

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

class PageErrorBoundary extends React.Component<{ activeKey: string; children: React.ReactNode }, { hasError: boolean; errorMessage: string }> {
  constructor(props: { activeKey: string; children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, errorMessage: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error?.message || '页面渲染失败' }
  }

  componentDidCatch(error: Error) {
    console.error('Page render error:', error)
  }

  componentDidUpdate(prevProps: { activeKey: string }) {
    if (prevProps.activeKey !== this.props.activeKey && this.state.hasError) {
      this.setState({ hasError: false, errorMessage: '' })
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-300">
            页面渲染失败：{this.state.errorMessage}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function App() {
  useBackendStatusMonitor()

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

  const renderActivePage = (activeTab: string) => {
    switch (activeTab) {
      case 'automation': return <AutomationTasks />
      case 'combat': return <CombatTasks />
      case 'roguelike': return <RoguelikeTasks />
      case 'training': return <OperatorTraining />
      case 'logs': return <LogViewer />
      case 'statistics': return <DataStatistics />
      case 'config': return <ConfigManager />
      case 'dashboard':
      default: return <Dashboard />
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <Layout>
        {({ activeTab }) => (
          <PageErrorBoundary activeKey={activeTab}>
            <Suspense fallback={<PageSkeleton variant={activeTab} />}>
              {renderActivePage(activeTab)}
            </Suspense>
          </PageErrorBoundary>
        )}
      </Layout>
      <PWAInstallPrompt />
    </MotionConfig>
  )
}

export default App
