import React, { Activity, lazy, Suspense, useEffect, useState } from 'react'
import Dashboard from './components/Dashboard'
import Layout from './components/Layout'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import AccessTokenGate from './components/AccessTokenGate'
import { PageSkeleton } from './components/common'
import { useBackendStatusMonitor } from './hooks/useBackendStatusMonitor'
import { useRunStatusMonitor } from './hooks/useRunStatusMonitor'
import { useUIStore } from './stores'
import { PreviewSessionProvider } from './contexts/PreviewSessionContext'
import { pageLoaders } from './utils/pagePreload'

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

/** Keep recently visited workspaces alive without retaining the whole app. */
const MAX_VISITED_WORKSPACES = 4

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
  const [visitedOrder] = useState<string[]>(() => [activeTab])
  const existingIndex = visitedOrder.indexOf(activeTab)
  if (existingIndex >= 0) visitedOrder.splice(existingIndex, 1)
  visitedOrder.push(activeTab)
  while (visitedOrder.length > MAX_VISITED_WORKSPACES) visitedOrder.shift()

  const visiblePages = new Set(visitedOrder)
  return appPages
    .filter(({ id }) => visiblePages.has(id))
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
  useRunStatusMonitor()
  const theme = useUIStore(state => state.theme)
  const isDark = theme === 'dark'
    || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    document.getElementById('app-root')?.classList.toggle('dark', isDark)
  }, [isDark])

  return (
    <div id="app-root" className="la-pluma-app">
      <div className="desktop-titlebar" aria-hidden="true" />
      <PreviewSessionProvider>
        <Layout>
          {({ activeTab }) => <VisitedWorkspaces activeTab={activeTab} />}
        </Layout>
      </PreviewSessionProvider>
      <PWAInstallPrompt />
      <AccessTokenGate />
    </div>
  )
}

export default App
