import Layout from './components/Layout'
import AutomationTasks from './components/AutomationTasks'
import CombatTasks from './components/CombatTasks'
import RoguelikeTasks from './components/RoguelikeTasks'
import LogViewer from './components/LogViewer'
import ConfigManager from './components/ConfigManager'
import DataStatistics from './components/DataStatistics'
import OperatorTraining from './components/OperatorTraining'
import PWAInstallPrompt from './components/PWAInstallPrompt'

function App() {
  return (
    <>
      <Layout>
        {({ activeTab }) => (
          <>
            <div style={{ display: activeTab === 'automation' ? 'block' : 'none' }}>
              <AutomationTasks />
            </div>
            <div style={{ display: activeTab === 'combat' ? 'block' : 'none' }}>
              <CombatTasks />
            </div>
            <div style={{ display: activeTab === 'roguelike' ? 'block' : 'none' }}>
              <RoguelikeTasks />
            </div>
            <div style={{ display: activeTab === 'training' ? 'block' : 'none' }}>
              <OperatorTraining />
            </div>
            <div style={{ display: activeTab === 'logs' ? 'block' : 'none' }}>
              <LogViewer />
            </div>
            <div style={{ display: activeTab === 'statistics' ? 'block' : 'none' }}>
              <DataStatistics />
            </div>
            <div style={{ display: activeTab === 'config' ? 'block' : 'none' }}>
              <ConfigManager />
            </div>
          </>
        )}
      </Layout>
      <PWAInstallPrompt />
    </>
  )
}

export default App
