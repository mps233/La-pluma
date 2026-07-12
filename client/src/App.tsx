import React, { lazy, Suspense } from 'react'
import Layout from './components/Layout'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import { Loading } from './components/common'
import { useBackendStatusMonitor } from './hooks/useBackendStatusMonitor'

const Dashboard = lazy(() => import('./components/Dashboard'))
const AutomationTasks = lazy(() => import('./components/AutomationTasks'))
const CombatTasks = lazy(() => import('./components/CombatTasks'))
const RoguelikeTasks = lazy(() => import('./components/RoguelikeTasks'))
const OperatorTraining = lazy(() => import('./components/OperatorTraining'))
const LogViewer = lazy(() => import('./components/LogViewer'))
const DataStatistics = lazy(() => import('./components/DataStatistics'))
const ConfigManager = lazy(() => import('./components/ConfigManager'))

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
    <>
      <Layout>
        {({ activeTab }) => (
          <PageErrorBoundary activeKey={activeTab}>
            <Suspense fallback={<div className="p-6"><Loading text="页面加载中..." /></div>}>
              {renderActivePage(activeTab)}
            </Suspense>
          </PageErrorBoundary>
        )}
      </Layout>
      <PWAInstallPrompt />
    </>
  )
}

export default App
