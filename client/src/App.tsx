import { lazy, Suspense } from 'react'
import Layout from './components/Layout'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import { Loading } from './components/common'

const Dashboard = lazy(() => import('./components/Dashboard'))
const AutomationTasks = lazy(() => import('./components/AutomationTasks'))
const CombatTasks = lazy(() => import('./components/CombatTasks'))
const RoguelikeTasks = lazy(() => import('./components/RoguelikeTasks'))
const OperatorTraining = lazy(() => import('./components/OperatorTraining'))
const LogViewer = lazy(() => import('./components/LogViewer'))
const DataStatistics = lazy(() => import('./components/DataStatistics'))
const ConfigManager = lazy(() => import('./components/ConfigManager'))

function App() {
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
          <Suspense fallback={<div className="p-6"><Loading text="页面加载中..." /></div>}>
            {renderActivePage(activeTab)}
          </Suspense>
        )}
      </Layout>
      <PWAInstallPrompt />
    </>
  )
}

export default App
