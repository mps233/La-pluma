import { DashboardSkeleton } from '@/features/dashboard'
import { DashboardWorkspace } from '@/features/dashboard'
import { useDashboardSnapshotRefresh } from '@/features/dashboard'
import { useDashboardStore } from '@/features/dashboard'

export default function Dashboard() {
  const hasLoaded = useDashboardStore(state => state.hasLoaded)
  const { refreshDashboard } = useDashboardSnapshotRefresh()

  if (!hasLoaded) {
    return <DashboardSkeleton />
  }

  return (
    <div className="app-page dashboard-page" data-page="dashboard">
      <div className="app-stack-section">
        <DashboardWorkspace refreshDashboard={refreshDashboard} />
      </div>
    </div>
  )
}
