import { BrowserRouter, useLocation } from 'react-router'
import type { AppTab } from '@/shared/navigation'
import Layout from './layout/Layout'
import PWAInstallPrompt from './layout/PWAInstallPrompt'
import { AppProviders } from './providers'
import { AppRoutes } from './router'
import ThemeGalleryPage from '@/pages/dev/ThemeGalleryPage'
import { isDevRoutePathname, routerBasename, useActiveAppTab } from '@/shared/navigation'
import { useBackendStatusMonitor, useRunStatusProjection } from '@/features/runtime-status'
import { useExecutionObservation } from '@/features/task-execution'
import { PreviewSessionProvider } from '@/features/device-mirror'

function AppShell({ activeTab }: { activeTab: AppTab }) {
  // 应用级观察/投影/探针必须位于 AppProviders 内，后续接入 Query 时才能拿到客户端。
  useExecutionObservation()
  useRunStatusProjection()
  useBackendStatusMonitor()

  return (
    <PreviewSessionProvider>
      <Layout activeTab={activeTab}>
        <AppRoutes activeTab={activeTab} />
      </Layout>
      <PWAInstallPrompt />
    </PreviewSessionProvider>
  )
}

function AppSurface() {
  const { pathname } = useLocation()
  const activeTab = useActiveAppTab()

  // dev 画布绕开 AppShell 的应用级观察轮询；布局 chrome 由画廊按主题契约直接检查。
  if (isDevRoutePathname(pathname)) {
    return (
      <Layout activeTab={activeTab}>
        <ThemeGalleryPage />
      </Layout>
    )
  }

  return <AppShell activeTab={activeTab} />
}

function App() {
  return (
    <div id="app-root" className="la-pluma-app">
      <BrowserRouter basename={routerBasename() || undefined}>
        <AppProviders>
          <AppSurface />
        </AppProviders>
      </BrowserRouter>
    </div>
  )
}

export default App
