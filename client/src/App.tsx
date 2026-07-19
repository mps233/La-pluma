import React, { lazy, Suspense, useEffect } from 'react'
import { MotionConfig } from 'framer-motion'
import { App as Framework7App } from 'framework7-react'
import './framework7'
import { Framework7RuntimeProvider } from './framework7Context'
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
  const theme = useUIStore(state => state.theme)
  const isDark = theme === 'dark'
    || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    document.getElementById('framework7-root')?.classList.toggle('dark', isDark)
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
    <Framework7App
      name="La Pluma"
      theme="ios"
      // Framework7 9.1.1 registers Sheet swipe listeners against a
      // `sheetDestroy` event, while Modal.destroy emits `beforeDestroy`.
      // Bridge the two events so StrictMode/HMR teardown cannot leave a stale
      // touch listener that later reads from a destroyed instance.
      sheet={{
        on: {
          // The internal listener is registered for `sheetDestroy`, which is
          // missing from Framework7's public event types.
          beforeDestroy: (sheet) => {
            const emitInternal = sheet.emit as unknown as (event: string) => void
            emitInternal.call(sheet, 'sheetDestroy')
          },
        },
      }}
      // Theme state is applied by uiStore to both document roots. Leaving this
      // undefined lets Framework7 snapshot that state without installing its
      // own MediaQueryList listeners (which are not available in older iOS
      // WebViews and are already managed by the store).
      darkMode={undefined}
      iosTranslucentBars
      iosTranslucentModals
      colors={{ primary: '#007AFF' }}
      className="la-pluma-framework7"
    >
      <Framework7RuntimeProvider>
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
      </Framework7RuntimeProvider>
    </Framework7App>
  )
}

export default App
